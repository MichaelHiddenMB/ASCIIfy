// Koi, seen from above, swimming lazily around the pond.
// Adapted from ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt). The original swims along one course across the screen;
// here each koi wanders on its own and turns back before reaching the edge of the pond.
//
// The body: each koi has a "spine" of 14 points. The head swims and every point behind it
// follows the one in front at a fixed distance, like a chain being pulled, with a limit on how
// sharply each joint can bend. On top of that a wave travels down the body, growing toward
// the tail, which gives the swishing swim. The shape is drawn by measuring, for each point
// on screen, how far it is along the spine (snout to tail) and how far across it, then
// looking up how wide the body is at that spot. So the pattern bends along with the fish.
//
// Feeding: click to drop food pellets. Koi close enough turn and swim over (the closer, the
// keener), and gulp a pellet when their head reaches it. Leftovers drift and fade.
import { SHARED_TUNING } from '../engine/flock.js';
import { INK_DARK, INK_GLASS, INK_SHIMMER, ink } from '../engine/ink.js';
import { angleDiff, clamp, hash3, lerp, rand, smoothstep, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';

const NODES = 14;

const DEFAULTS = {
  ...SHARED_TUNING,
  fog: 0.64,
  density: 1.6,
  speed: 1.6,
  spread: 0,
  sway: 0,
  farthest: 0.33,
  farBias: 1.3,
  grip: 2.65,
  separation: 780,
  trail: 4,
  trailFade: 0.4,
  shimmer: 0.35,
  sparkle: 0.08,
  meander: 0.4, // how much they weave in lazy S-curves
  wander: 0.6, // how quickly each koi's own direction drifts
  foodRange: 200, // how close (px) a koi must be to notice food
  tailBeat: 1, // how fast and wide the tail swishes
};

const WHITE = [244, 240, 230];
const RED = [222, 66, 40];
const BLACK = [34, 34, 40];
const GOLD = [238, 182, 64];
const ORANGE = [236, 124, 44];
const FIN = [236, 226, 214];
// Food pellets come in a few colors, like a real mix of koi food.
const FOOD_COLORS = [[204, 128, 62], [226, 162, 84], [176, 98, 50], [150, 132, 64]];
let nextPelletId = 50000;
const EYE = [14, 12, 16];
const GLINT = [255, 252, 246];

// The classic varieties: kohaku (red on white), sanke (kohaku with black flecks),
// showa (black with red and white), ogon (gold) and chagoi (orange).
const VARIETIES = ['kohaku', 'sanke', 'showa', 'ogon', 'chagoi'];

const PELLET_LIFE = 14; // seconds before uneaten food fades away

// How wide the body is at s (0 = snout, 1 = tail tip), as a fraction of its length.
function halfWidth(s) {
  if (s < 0.12) return 0.1 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.6);
  if (s < 0.35) return 0.1 + 0.016 * Math.sin(((s - 0.12) / 0.23) * (Math.PI / 2));
  if (s < 0.82) return 0.116 - 0.088 * smoothstep(0.35, 0.82, s);
  return 0.028 + ((s - 0.82) / 0.18) * 0.1; // the tail fin fans out
}

// A smooth blotchy pattern, different for each fish: where its red patches go.
function blotch(s, a, seed) {
  return (
    Math.sin(s * 11 + seed) * Math.cos(a * 22 + seed * 1.3) +
    0.6 * Math.sin(s * 23 + a * 15 + seed * 2.1) +
    0.35 * Math.sin(s * 5 - seed * 0.7)
  );
}

// Each flock keeps its own list of food pellets.
const pantries = new WeakMap();
function pantry(flock) {
  let food = pantries.get(flock);
  if (!food) pantries.set(flock, (food = []));
  return food;
}

// The nearest pellet within `range` of this koi's head, and how strongly it pulls (0..1).
function nearestFood(f, flock, range) {
  let best = null;
  let bestD = range;
  for (const p of pantry(flock)) {
    const d = Math.hypot(p.x - f.x, p.y - f.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { meal: best, pull: best ? 1 - bestD / range : 0 };
}

export const koi = {
  key: 'koi',
  label: 'Koi',
  defaults: DEFAULTS,
  area: 75000, // screen area per koi at density 1, px²
  scale: 1.15,
  speed: 50, // cruising speed of the nearest koi, px/s

  create: (c) => ({
    ...c,
    nodes: new Float32Array(NODES * 2),
    phase: rand(0, TAU),
    variety: Math.floor(hash3(c.id, 7, 3) * VARIETIES.length),
    drift: rand(0, TAU), // this koi's own wandering direction
  }),

  // Lay the spine out straight behind the head.
  enter(f) {
    f.heading = f.drift;
    const seg = f.span / (NODES - 1);
    for (let k = 0; k < NODES; k++) {
      f.nodes[k * 2] = f.x - Math.cos(f.heading) * seg * k;
      f.nodes[k * 2 + 1] = f.y - Math.sin(f.heading) * seg * k;
    }
  },

  // Pellets drift slowly on the surface and fade away if nobody eats them.
  prepare(flock, dt) {
    const food = pantry(flock);
    for (const p of food) {
      p.vx *= Math.exp(-dt * 0.8);
      p.vy *= Math.exp(-dt * 0.8);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    const t = flock.time;
    for (let i = food.length - 1; i >= 0; i--) if (t - food[i].born > PELLET_LIFE) food.splice(i, 1);
  },

  // A click drops a scatter of food pellets, each landing with a ripple.
  tap(x, y, flock) {
    const food = pantry(flock);
    const n = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r = 70 * Math.sqrt(Math.random());
      const p = {
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        vx: Math.cos(a) * rand(4, 14),
        vy: Math.sin(a) * rand(4, 14),
        born: flock.time,
        id: nextPelletId++,
        size: rand(0.8, 1.25),
        tint: Math.floor(Math.random() * FOOD_COLORS.length),
      };
      food.push(p);
      flock.events.push({ x: p.x, y: p.y, radius: 1, amount: 0.5 });
    }
    if (food.length > 60) food.splice(0, food.length - 60);
  },

  update(f, flock, dt) {
    const k = flock.tuning;
    const t = flock.time;
    const { width: W, height: H } = flock;

    // Wander: the koi's own direction drifts slowly and smoothly (noise, not random jumps).
    f.drift += (noise1(t * 0.15 + f.id * 13.7) - 0.5) * 2 * k.wander * dt;

    // Near the edge of the pond, gently turn that direction back toward the middle.
    const m = Math.max(60, f.span * 0.9);
    const ix = f.x < m ? (m - f.x) / m : f.x > W - m ? -(f.x - (W - m)) / m : 0;
    const iy = f.y < m ? (m - f.y) / m : f.y > H - m ? -(f.y - (H - m)) / m : 0;
    const push = Math.min(1, Math.hypot(ix, iy));
    if (push > 0) f.drift += angleDiff(f.drift, Math.atan2(iy, ix)) * Math.min(1, push * 2.5 * dt);

    // Food nearby? Head for it: the closer it is, the harder the turn and the faster the swim.
    const { meal, pull } = nearestFood(f, flock, k.foodRange);
    const hunger = meal ? 0.25 + 0.75 * pull : 0;
    let want = meal
      ? Math.atan2(meal.y - f.y, meal.x - f.x)
      : f.drift + k.meander * 0.6 * Math.sin(t * 0.35 + f.id * 1.7);

    // Keep some space from neighbours swimming at the same depth.
    const acc = flock.begin();
    flock.separate(f, k.separation, 0.5);
    if (acc.x || acc.y) {
      const cruise = flock.cruise(f);
      want = Math.atan2(Math.sin(want) * cruise + acc.y * 0.3, Math.cos(want) * cruise + acc.x * 0.3);
    }
    const turn = lerp(0.9 * k.grip, 2.6, hunger) * dt;
    f.heading += clamp(angleDiff(f.heading, want), -turn, turn);
    const speed = flock.cruise(f) * lerp(0.85 + 0.25 * Math.sin(t * 0.5 + f.id), 1.8, hunger);
    f.vx = Math.cos(f.heading) * speed;
    f.vy = Math.sin(f.heading) * speed;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.phase += dt * (2 + speed / 25) * k.tailBeat;

    // Follow-the-leader spine with a bending limit at each joint.
    const n = f.nodes;
    const seg = f.span / (NODES - 1);
    n[0] = f.x;
    n[1] = f.y;
    let prev = f.heading + Math.PI;
    for (let i = 1; i < NODES; i++) {
      let a = Math.atan2(n[i * 2 + 1] - n[i * 2 - 1], n[i * 2] - n[i * 2 - 2]);
      a = prev + clamp(angleDiff(prev, a), -0.22, 0.22);
      n[i * 2] = n[i * 2 - 2] + Math.cos(a) * seg;
      n[i * 2 + 1] = n[i * 2 - 1] + Math.sin(a) * seg;
      prev = a;
    }

    // Gulp: the head reached a pellet.
    if (meal && Math.hypot(meal.x - f.x, meal.y - f.y) < f.span * 0.1 + 6) {
      const food = pantry(flock);
      food.splice(food.indexOf(meal), 1);
      flock.events.push({ x: meal.x, y: meal.y, radius: 1, amount: 0.7 });
    }
  },

  // The floating food pellets, so a scene can move them (e.g. let waves push them around).
  food: (flock) => pantry(flock),

  // Food first, so a koi swimming over a pellet covers it. A scene can also call these two
  // separately (the pond draws the food without the underwater bending, since it floats).
  drawFood,
  drawFish(flock, pen) {
    for (const f of flock.creatures) drawKoi(f, pen, flock);
  },
  drawAll(flock, pen) {
    drawFood(flock, pen);
    for (const f of flock.creatures) drawKoi(f, pen, flock);
  },
};

// Each pellet is a little round shape drawn the same way as the koi: a solid block of color
// in the middle with soft edge characters around it. It has a wet shimmer, a lighter
// highlight on the side facing the light, and toward the end of its life it soaks up water
// and fades into the pond.
function drawFood(flock, pen) {
  const t = flock.time;
  const out = pen.ink;
  for (const p of pantry(flock)) {
    const age = (t - p.born) / PELLET_LIFE;
    const fog = Math.min(0.85, Math.max(0, age - 0.55) * 1.9);
    const [r, g, b] = FOOD_COLORS[p.tint];
    const pose = { x: p.x, y: p.y, heading: 0, span: pen.cw * 1.6 * p.size, depth: 1, id: p.id };
    pen.shape(pose, 0.6, (u, v) => {
      const d = Math.hypot(u, v);
      if (d > 0.5) return false;
      if (Math.hypot(u - 0.14, v + 0.14) < 0.2) return ink(out, r + 48, g + 44, b + 34, INK_SHIMMER, 'o');
      return ink(out, r, g, b, INK_SHIMMER, d < 0.3 ? '@o' : 'o:');
    }, { fog });
  }
}

// Draws one koi: body and pattern along the bent spine, see-through fins, a forked tail,
// and glossy eyes on the bigger ones.
function drawKoi(f, pen, flock) {
  const k = flock.tuning;
  const L = f.span;
  const n = f.nodes;
  const out = pen.ink;
  const variety = VARIETIES[f.variety];
  const seed = f.id * 1.37;

  // The drawn spine: the swimming spine plus a wave that travels toward the tail.
  const spine = new Float32Array(NODES * 2);
  const arc = new Float32Array(NODES); // distance along the spine to each point
  for (let i = 0; i < NODES; i++) {
    const s = i / (NODES - 1);
    const a = Math.max(0, i - 1);
    const b = Math.min(NODES - 1, i + 1);
    let tx = n[a * 2] - n[b * 2];
    let ty = n[a * 2 + 1] - n[b * 2 + 1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const off = L * 0.06 * Math.pow(s, 1.6) * Math.sin(f.phase - s * 4.5) * Math.min(1.5, k.tailBeat);
    spine[i * 2] = n[i * 2] - ty * off;
    spine[i * 2 + 1] = n[i * 2 + 1] + tx * off;
    if (i > 0) arc[i] = arc[i - 1] + Math.hypot(spine[i * 2] - spine[i * 2 - 2], spine[i * 2 + 1] - spine[i * 2 - 1]);
  }
  const total = arc[NODES - 1] || 1;
  const mid = (NODES / 2) | 0;
  const pose = { x: spine[mid * 2], y: spine[mid * 2 + 1], heading: f.heading, span: L, depth: f.depth, id: f.id };
  const finBeat = 0.8 + 0.2 * Math.sin(f.phase * 0.7);

  pen.shape(pose, 0.72, (_u, _v, px, py) => {
    // Find the nearest point on the spine: how far along (s) and across (a) the body.
    let best = Infinity;
    let s = 0;
    let a = 0;
    let past = 0; // how far beyond the tail tip, if at all
    for (let i = 0; i < NODES - 1; i++) {
      const ax = spine[i * 2];
      const ay = spine[i * 2 + 1];
      const sx = spine[i * 2 + 2] - ax;
      const sy = spine[i * 2 + 3] - ay;
      const len2 = sx * sx + sy * sy || 1;
      const raw = ((px - ax) * sx + (py - ay) * sy) / len2;
      const q = clamp(raw, 0, 1);
      const sl = Math.sqrt(len2);
      if (i === NODES - 2 && raw > 1) {
        const across = Math.abs(sx * (py - ay) - sy * (px - ax)) / sl;
        if (across * across < best) {
          best = across * across;
          s = 1;
          past = ((raw - 1) * sl) / L;
          a = (across / L) * (sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1);
        }
        continue;
      }
      const d2 = (px - ax - sx * q) ** 2 + (py - ay - sy * q) ** 2;
      if (d2 < best) {
        best = d2;
        s = (arc[i] + q * sl) / total;
        a = (Math.sqrt(d2) / L) * (sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1);
        past = 0;
      }
    }
    const aa = Math.abs(a);
    const w = halfWidth(s);
    out.au = s;
    out.av = a;

    if (past > 0) return false;

    // Fins at the shoulders and further back: see-through.
    const pect = s > 0.17 && s < 0.34 && aa < w + 0.1 * finBeat * Math.sin(((s - 0.17) / 0.17) * Math.PI);
    const pelvic = s > 0.48 && s < 0.6 && aa < w + 0.05 * Math.sin(((s - 0.48) / 0.12) * Math.PI);
    if (aa > w) return (pect || pelvic) && ink(out, ...FIN, INK_GLASS, '-=');
    if (s > 0.82) {
      if (s > 0.93 && aa < ((s - 0.93) / 0.07) * 0.06) return false; // the fork in the tail
      return ink(out, ...FIN, INK_GLASS, s > 0.9 ? '/\\' : '=');
    }

    const patch = blotch(s, a, seed) > 0.25;
    const across = aa / w;
    switch (variety) {
      case 'kohaku':
        return patch && s < 0.8 ? ink(out, ...RED) : ink(out, ...WHITE);
      case 'sanke':
        if (hash3(Math.round(s * 30), Math.round(a * 60), f.id) > 0.9 && s > 0.15) return ink(out, ...BLACK, INK_DARK);
        return patch && s < 0.8 ? ink(out, ...RED) : ink(out, ...WHITE);
      case 'showa':
        if (blotch(s, a, seed + 4) > 0.55) return ink(out, ...WHITE);
        return patch ? ink(out, ...RED) : ink(out, ...BLACK, INK_DARK, '%#');
      case 'ogon':
        return ink(out, ...GOLD, INK_SHIMMER);
      default: // chagoi
        return ink(out, ORANGE[0] * (1 - 0.15 * across), ORANGE[1] * (1 - 0.15 * across), ORANGE[2], INK_SHIMMER);
    }
  });

  // Eyes: one glossy cell each, only on koi big enough for both eyes to fit.
  const across = halfWidth(0.09) * 0.55 * L;
  if (2 * across >= pen.cw) {
    const along = 0.09 * total;
    let i = 0;
    while (i < NODES - 2 && arc[i + 1] < along) i++;
    const sl = arc[i + 1] - arc[i] || 1;
    const q = (along - arc[i]) / sl;
    const dx = (spine[i * 2 + 2] - spine[i * 2]) / sl;
    const dy = (spine[i * 2 + 3] - spine[i * 2 + 1]) / sl;
    const hx = spine[i * 2] + dx * q * sl;
    const hy = spine[i * 2 + 1] + dy * q * sl;
    for (const side of [-1, 1]) pen.spot(hx - dy * across * side, hy + dx * across * side, '●', GLINT, EYE, f.depth);
  }

  // Soft ripples off the tail.
  pen.shed(spine[(NODES - 2) * 2], spine[(NODES - 2) * 2 + 1], 0.02 * f.depth);
}
