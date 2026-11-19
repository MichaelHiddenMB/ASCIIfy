// Meadow: a top-down view of a grassy field with wildflowers, butterflies and dragonflies, and
// (optionally) a little pond with koi in the bottom-left corner, with a big tree beside it.
//
// SUNSET (optional). The whole picture is tinted warm and dimmed, darker and more purple
// further from the low sun at the top left, with a glow near the sun; shadows stretch out
// longer; and fireflies drift around blinking. The tint and glow are a "grade" (see
// renderer.js): every color is multiplied (tint, dim) and then brightened toward white (glow)
// by an amount worked out once per cell. Fireflies are painted on top afterwards with the
// "lighter" blend mode (light adds to light), so they glow instead of being dimmed.
// Same scene shape as koi-pond.js (see the list of what a scene provides at the top of that file).
//
// What happens here:
//   - the ground is grass (grass.js), with wind gusts sweeping across it. With the pond on,
//     it's grass and water mixed together (ground-mix.js), with a muddy shore in between
//   - clusters of larger flowers (daisies, poppies, cornflowers, buttercups) that sway with
//     the grass and that butterflies land on
//   - two flocks of insects, butterflies and dragonflies, drawn together farthest first, so
//     nearer insects pass over farther ones whichever kind they are; and, with the pond on,
//     a few koi swimming in it
//   - every insect casts a soft shadow, offset away from the sun (top left); higher ones
//     (the bigger, nearer ones) cast it farther away
//
// THE MOUSE IS A WIND STREAM. As it moves, each little piece of its path is remembered for
// about a second as a moving stream of air, blowing the way the mouse went, as fast as it
// went. Close to the path the wind is strongest; it fades with distance and with age.
// Anything caught in it gets carried along: butterflies (light) are dragged and tumble a
// little, dragonflies (heavier) are nudged and may dart off downwind, butterflies resting on
// flowers are blown off, the tree's leaves rustle, and bits of seed fluff and petals float
// away on it. It also ripples the pond.
//
// The wind itself is shown only as "wisps": pale streaks of air that start across a wide band
// along the mouse's path and drift with the stream, curling a little as they go and fading
// out. Each wisp is just a short trail of faint characters.
import { Flock } from '../engine/flock.js';
import { Grass } from '../engine/grass.js';
import { Water } from '../engine/water.js';
import { GroundMix } from '../engine/ground-mix.js';
import { INK_SCALE, ink } from '../engine/ink.js';
import { clamp, rand, smoothstep, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';
import { FONT_STACK } from '../engine/renderer.js';
import { lineGlyph } from '../engine/renderer.js';
import { makeTree, swayTree, drawTree, treeShadow } from './tree.js';
import { butterflies } from '../animals/butterflies.js';
import { dragonflies } from '../animals/dragonflies.js';
import { koi } from '../animals/koi.js';

const PALETTE = {
  background: [22, 46, 24], // far-off insects fade toward the meadow's green
  grid: [255, 255, 255, 0.03],
  trailAlpha: 0.8,
  trail: [200, 220, 160],
  ink: [26, 30, 22], // dark, for thin details like butterfly feelers against the grass
};

// The larger flowers. `n` is the number of petals.
const KINDS = [
  { name: 'daisy', petals: [244, 242, 230], tips: [255, 255, 250], center: [246, 196, 60], n: 8, size: 1 },
  { name: 'poppy', petals: [222, 52, 40], tips: [242, 96, 64], center: [34, 24, 26], n: 4, size: 1.25 },
  { name: 'cornflower', petals: [86, 120, 236], tips: [142, 172, 255], center: [64, 40, 96], n: 6, size: 0.95 },
  { name: 'buttercup', petals: [250, 214, 60], tips: [255, 236, 130], center: [214, 150, 30], n: 5, size: 0.8 },
];

// Things the wind kicks up: seed fluff (white), petals (pink, yellow), bits of grass (green).
const MOTES = [
  ["'", [236, 236, 222]], ['.', [240, 240, 228]], ['*', [242, 242, 232]],
  ['.', [240, 160, 190]], ["'", [244, 210, 90]], ["'", [130, 176, 86]],
];

const WIND_LIFE = 0.9; // seconds a piece of the mouse's wind stream lasts
const WIND_REACH = 130; // how far from the mouse's path the wind is felt, in pixels
const WISP = [214, 232, 222]; // the pale color of wind wisps
const KOI_PER_POND = 3;
// The pond's colors by day, and at sunset, when it reflects the glowing evening sky.
const DAY_WATER = { deep: [8, 30, 36], shallow: [40, 102, 108], glint: [214, 226, 216] };
const SUNSET_WATER = { deep: [54, 56, 104], shallow: [150, 132, 158], glint: [255, 222, 170] }; // dusky blue-mauve under the warm light

export function createMeadow({ density = 1, flowers: flowerAmount = 1, pond = true, sunset = false } = {}) {
  // Both insects at their reference look, but fewer of each since they share the screen.
  const bTuning = { ...butterflies.defaults, density: butterflies.defaults.density * 0.6 * density };
  // Less distance haze than in the original, so these green insects don't fade into the green grass.
  const dTuning = { ...dragonflies.defaults, density: dragonflies.defaults.density * 0.4 * density, fog: 0.1 };
  const bFlock = new Flock(butterflies, bTuning);
  const dFlock = new Flock(dragonflies, dTuning);
  const kinds = [[bFlock, butterflies], [dFlock, dragonflies]];
  // The renderer's own settings (fog etc. are swapped per animal while drawing, see draw()).
  const tuning = { fog: 0.6, shimmer: 0.3, sparkle: 0.12, trail: 0, trailFade: 1, grid: 1 };
  const treeTuning = { ...tuning, sparkle: 0 }; // no white glints flashing on the leaves
  const grass = new Grass({ flowers: flowerAmount });
  let flowers = [];
  let nextFlowerId = 60000;
  let lastPointer = null;
  const gusts = []; // pieces of the mouse's path: { x0, y0, x1, y1, vx, vy, len, born }
  const motes = []; // seed fluff and petals carried by the wind
  const wisps = []; // pale streaks of moving air
  const fireflies = [];
  let tree = null; // only with the pond
  let size = { w: 1, h: 1 };

  // ---- the optional pond ----
  // Its outline is a slightly wobbly oval near the bottom-left corner. pondShape() says how
  // far a point is from its middle: below 1 is water.
  const P = { cx: 0, cy: 0, rx: 1, ry: 1, a: rand(0, TAU), b: rand(0, TAU) };
  function pondShape(x, y) {
    const dx = (x - P.cx) / P.rx, dy = (y - P.cy) / P.ry;
    const th = Math.atan2(dy, dx);
    return Math.hypot(dx, dy) / (1 + 0.09 * Math.sin(3 * th + P.a) + 0.05 * Math.sin(5 * th + P.b));
  }
  let water = null, koiFlock = null, koiTuning = null, ground = grass, nextDrop = rand(1, 3);
  if (pond) {
    // A brighter, greener daytime water, lit from above the top right of the pond.
    water = new Water({ deep: [8, 30, 36], shallow: [40, 102, 108], glint: [214, 226, 216], light: { x: 0.62, y: 0.3, z: 0.8 }, breeze: 0.45 });
    ground = new GroundMix(grass, water, pondShape);
    // A few smaller koi that stay near the surface (less fading into the meadow-green haze).
    koiTuning = { ...koi.defaults, trail: 0, fog: 0.3, farthest: 0.55, foodRange: 160 };
    koiFlock = new Flock(koi, koiTuning, Math.round(KOI_PER_POND * density));
    // Instead of the screen's edges, the koi turn back as they get near the shore.
    koiFlock.keepIn = (f) => ({ angle: Math.atan2(P.cy - f.y, P.cx - f.x), push: smoothstep(0.6, 0.92, pondShape(f.x, f.y)) });
  }

  // Drops a koi at a random spot well inside the pond, facing a random way.
  function placeInPond(f) {
    for (let tries = 0; tries < 50; tries++) {
      f.x = P.cx + rand(-0.7, 0.7) * P.rx;
      f.y = P.cy + rand(-0.7, 0.7) * P.ry;
      if (pondShape(f.x, f.y) < 0.65) break;
    }
    f.drift = rand(0, TAU);
    f.span = koiFlock.base * f.depth * koiTuning.size;
    koi.enter(f);
  }

  // Where the sun's reflection lands on the pond, and its color: high and white by day, low,
  // warm and toward the sun's side (top left) at sunset.
  function lightWater() {
    if (!water) return;
    const { w, h } = size;
    Object.assign(water, sunset ? SUNSET_WATER : DAY_WATER);
    water.light = sunset
      ? { x: (P.cx - P.rx * 0.35) / w, y: (P.cy - P.ry * 0.45) / h, z: 0.45 }
      : { x: (P.cx + P.rx * 0.35) / w, y: (P.cy - P.ry * 0.35) / h, z: 0.8 };
  }

  // Fireflies drift slowly, steered by noise, and each blinks on its own rhythm: a short,
  // soft pulse of light, then dark for a few seconds.
  function stepFireflies(t, dt) {
    const { w, h } = size;
    const want = Math.round(((w * h) / 36000) * clamp(density, 0.25, 3));
    while (fireflies.length < want) {
      fireflies.push({ x: rand(0, w), y: rand(0, h), vx: 0, vy: 0, seed: rand(0, 1000), period: rand(1.8, 4), offset: rand(0, 4), glow: 0 });
    }
    fireflies.length = Math.min(fireflies.length, want);
    for (const f of fireflies) {
      const tx = (noise1(t * 0.12 + f.seed) - 0.5) * 50, ty = (noise1(t * 0.12 + f.seed + 50) - 0.5) * 40;
      f.vx += (tx - f.vx) * Math.min(1, dt * 1.5);
      f.vy += (ty - f.vy) * Math.min(1, dt * 1.5);
      const wind = windAt(f.x, f.y); // light enough to be carried by the mouse's wind
      f.x += (f.vx + wind.x * 0.12) * dt;
      f.y += (f.vy + wind.y * 0.12) * dt;
      if (f.x < -20) f.x = w + 20; else if (f.x > w + 20) f.x = -20;
      if (f.y < -20) f.y = h + 20; else if (f.y > h + 20) f.y = -20;
      const p = (t + f.offset) % f.period;
      f.glow = p < 1.2 ? Math.sin((p / 1.2) * Math.PI) ** 1.5 : 0;
    }
  }

  // The sunset grade: for every cell, how much to multiply its red, green and blue (a warm
  // tint that gets darker and more purple further from the sun at the top left), and how much
  // to brighten it toward white (the sun's glow). Worked out once per window size.
  let gradeCache = null;
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function sunsetGrade(cols, rows, W, H) {
    if (gradeCache && gradeCache.cols === cols && gradeCache.rows === rows) return gradeCache;
    const n = cols * rows;
    const mul = new Float32Array(n * 3), add = new Float32Array(n * 3);
    const far = Math.hypot(W, H);
    const TINT = [1, 178 / 255, 132 / 255];
    const NEAR = [1, 1, 1], MID = [220 / 255, 190 / 255, 200 / 255], DUSK = [120 / 255, 96 / 255, 140 / 255];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = ((c + 0.5) / cols) * W, y = ((r + 0.5) / rows) * H;
        const d = Math.hypot(x, y) / far;
        const t = Math.min(1, d / 1.05);
        const shade = t < 0.55 ? lerp3(NEAR, MID, t / 0.55) : lerp3(MID, DUSK, (t - 0.55) / 0.45);
        // The glow: strong orange near the sun, fading out by 70% of the way across.
        const s = Math.min(1, d / 0.7);
        const glow = s < 0.4 ? 0.5 + (0.16 - 0.5) * (s / 0.4) : 0.16 * (1 - (s - 0.4) / 0.6);
        const glowColor = s < 0.4 ? [255, 150, 70] : [255, 120, 60];
        for (let k = 0; k < 3; k++) {
          mul[i * 3 + k] = TINT[k] * shade[k];
          add[i * 3 + k] = (glow * glowColor[k]) / 255;
        }
      }
    }
    gradeCache = { cols, rows, mul, add };
    return gradeCache;
  }

  // One firefly's glow, drawn once and stamped (with its own brightness) for every firefly.
  let sprite = null;
  function fireflySprite() {
    if (sprite) return sprite;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 72;
    const g = sprite.getContext('2d');
    const grad = g.createRadialGradient(36, 36, 0, 36, 36, 36);
    grad.addColorStop(0, 'rgba(196, 255, 110, 0.5)');
    grad.addColorStop(0.35, 'rgba(170, 240, 90, 0.16)');
    grad.addColorStop(1, 'rgba(170, 240, 90, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 72, 72);
    return sprite;
  }

  // Flowers grow in clusters of one kind, kept clear of the clock, the search bar and the pond.
  function placeFlowers(w, h) {
    for (const f of flowers) f.gone = true; // any butterfly sitting on one will fly off
    flowers = [];
    const scale = clamp(Math.min(w, h) / 800, 0.75, 1.3);
    const clusters = Math.round(((w * h) / 140000) * flowerAmount);
    for (let k = 0; k < clusters; k++) {
      const cx = rand(40, w - 40), cy = rand(40, h - 40);
      if (Math.abs(cx - w / 2) < 380 && Math.abs(cy - (h * 0.5 - 40)) < 210) continue;
      const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), r = rand(0, 70) * scale;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (koiFlock && pondShape(x, y) < 1.25) continue;
        if (tree && Math.hypot(x - tree.x, y - tree.y) < tree.span * 0.5) continue; // not under the tree
        flowers.push({
          x, y,
          dx: 0, dy: 0, // how far the wind is swaying it
          kind,
          span: rand(36, 50) * kind.size * scale, // big enough that the petals show
          heading: rand(0, TAU),
          id: nextFlowerId++,
          taken: null,
          gone: false,
        });
      }
    }
    bFlock.flowers = flowers;
  }

  // A flower from above: petals around a round middle (the petals are a wavy circle).
  function drawFlower(f, pen) {
    const out = pen.ink;
    const { petals, tips, center, n } = f.kind;
    const pose = { x: f.x + f.dx, y: f.y + f.dy, heading: f.heading, span: f.span, depth: 1, id: f.id };
    pen.shape(pose, 0.55, (u, v) => {
      const r = Math.hypot(u, v);
      const edge = 0.24 + 0.26 * Math.pow(Math.abs(Math.cos((Math.atan2(v, u) * n) / 2)), 0.6);
      if (r > edge) return false;
      if (r < 0.14) return ink(out, ...center);
      return ink(out, ...(r > edge * 0.72 ? tips : petals), INK_SCALE);
    }, { fog: 0 });
  }

  // The wind from the mouse's stream at (x, y), in pixels per second.
  function windAt(x, y) {
    const t = bFlock.time;
    let wx = 0, wy = 0;
    for (const g of gusts) {
      const life = 1 - (t - g.born) / WIND_LIFE;
      if (life <= 0) continue;
      const sx = g.x1 - g.x0, sy = g.y1 - g.y0;
      const q = clamp(((x - g.x0) * sx + (y - g.y0) * sy) / (sx * sx + sy * sy || 1), 0, 1);
      const d = Math.hypot(x - g.x0 - sx * q, y - g.y0 - sy * q);
      if (d > WIND_REACH) continue;
      // Each piece counts in proportion to its length, so a fast mouse (long pieces) and a
      // slow one (short pieces) don't differ just because of how often the browser reports it.
      const f = (1 - d / WIND_REACH) ** 2 * life * life * Math.min(1, g.len / 40);
      wx += g.vx * f;
      wy += g.vy * f;
    }
    const m = Math.hypot(wx, wy);
    if (m > 1800) {
      wx *= 1800 / m;
      wy *= 1800 / m;
    }
    return { x: wx, y: wy, strength: Math.min(m, 1800) };
  }

  return {
    palette: PALETTE,
    tuning,
    ground,
    events: [],
    get time() { return bFlock.time; },

    resize(w, h, cw, ch) {
      // The pond sits in the bottom-left corner (the settings button is bottom right).
      P.rx = clamp(w * 0.15, 130, 280);
      P.ry = clamp(h * 0.19, 90, 190);
      P.cx = P.rx + clamp(w * 0.05, 40, 90);
      P.cy = h - P.ry - clamp(h * 0.06, 40, 70);
      size = { w, h };
      lightWater();
      // The tree stands on the pond's far bank, its canopy hanging over the water.
      tree = pond ? makeTree(P.cx - P.rx * 0.45, P.cy - P.ry * 1.05, clamp(Math.min(w, h) * 0.34, 200, 330)) : null;
      bFlock.resize(w, h);
      dFlock.resize(w, h);
      ground.resize(Math.ceil(w / cw), Math.ceil(h / ch), cw, ch);
      if (koiFlock) {
        koiFlock.resize(w, h);
        koiFlock.base = clamp(Math.min(P.rx, P.ry) * 0.42, 50, 130) * koi.scale; // koi sized to the pond
        for (const f of koiFlock.creatures) placeInPond(f);
      }
      placeFlowers(w, h);
    },

    step(dt) {
      const t = bFlock.time;
      // Forget pieces of the wind stream that have died down.
      while (gusts.length && t - gusts[0].born > WIND_LIFE) gusts.shift();

      // Flowers lean with the grass around them before the butterflies (who sit on them) move.
      for (const f of flowers) {
        const b = grass.bendAt(f.x, f.y);
        f.dx += (b.x * 5 - f.dx) * Math.min(1, dt * 4);
        f.dy += (b.y * 5 - f.dy) * Math.min(1, dt * 4);
      }
      bFlock.step(dt);
      dFlock.step(dt);
      bFlock.events.length = 0;
      dFlock.events.length = 0;

      // The wind stream carries insects along.
      if (gusts.length) {
        for (const b of bFlock.creatures) {
          const w = windAt(b.x, b.y);
          if (w.strength < 20) continue;
          if (b.state !== 'fly' && w.strength > 120) butterflies.disturb(b, bFlock); // blown off its flower
          if (b.state === 'landed') continue;
          b.x += w.x * 0.11 * dt; // dragged along...
          b.y += w.y * 0.11 * dt;
          b.vx += w.x * 0.34 * dt;
          b.vy += w.y * 0.34 * dt;
          b.heading += (Math.random() - 0.5) * Math.min(1, w.strength / 800) * 0.6; // ...tumbling a little
          b.glideUntil = 0;
        }
        for (const d of dFlock.creatures) {
          const w = windAt(d.x, d.y);
          if (w.strength < 20) continue;
          d.x += w.x * 0.05 * dt; // heavier: nudged less
          d.y += w.y * 0.05 * dt;
          d.vx += w.x * 0.18 * dt;
          d.vy += w.y * 0.18 * dt;
          if (d.mode === 'hover' && w.strength > 500 && Math.random() < dt * 3) {
            dragonflies.startle(d, w.x / w.strength, w.y / w.strength, 0.5, dFlock); // darts off downwind
          }
        }
      }

      // Wisps drift with the wind, curling a little, leaving a short fading trail.
      for (let i = wisps.length - 1; i >= 0; i--) {
        const m = wisps[i];
        const age = (t - m.born) / m.life;
        if (age >= 1) {
          wisps.splice(i, 1);
          continue;
        }
        const w = windAt(m.x, m.y);
        const speed = Math.hypot(m.vx, m.vy) || 1;
        const curl = Math.sin(t * 2.6 + m.seed) * 60; // sideways wobble, so the streaks wave
        m.vx += (w.x * 0.9 - (m.vy / speed) * curl) * dt;
        m.vy += (w.y * 0.9 + (m.vx / speed) * curl) * dt;
        const slow = Math.exp(-dt * 0.9);
        m.vx *= slow;
        m.vy *= slow;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.trail.push(m.x, m.y);
        if (m.trail.length > 20) m.trail.splice(0, 2); // keep the last 10 positions
      }

      // The tree's canopy sways, more when the mouse's wind blows through it; a strong gust
      // shakes a few leaves loose.
      const treeWind = tree ? windAt(tree.x, tree.y) : { strength: 0 };
      if (tree) swayTree(tree, t, dt, treeWind);
      if (tree && treeWind.strength > 300 && motes.length < 120 && Math.random() < dt * 10) {
        const a = rand(0, TAU), r = rand(0, tree.span * 0.4);
        motes.push({
          x: tree.x + Math.cos(a) * r, y: tree.y + Math.sin(a) * r,
          vx: treeWind.x * 0.2, vy: treeWind.y * 0.2,
          born: t, life: rand(1.6, 2.8), seed: rand(0, 100), glyph: Math.random() < 0.5 ? "'" : ',', color: [96, 150, 66],
        });
      }

      // Seed fluff and petals ride the wind, then drift and fade.
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        if (t - m.born > m.life) {
          motes.splice(i, 1);
          continue;
        }
        const w = windAt(m.x, m.y);
        m.vx += w.x * 1.2 * dt + Math.sin(t * 2 + m.seed) * 10 * dt;
        m.vy += w.y * 1.2 * dt + Math.cos(t * 1.7 + m.seed) * 10 * dt;
        const slow = Math.exp(-dt * 1.3);
        m.vx *= slow;
        m.vy *= slow;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
      }

      if (koiFlock) {
        koiFlock.step(dt);
        for (const f of koiFlock.creatures) if (pondShape(f.x, f.y) > 1.15) placeInPond(f); // newcomers, or a stray
        // Food landing and koi gulping make ripples; koi near the surface leave a wake.
        for (const e of koiFlock.events) water.disturb(e.x, e.y, e.amount * 1.4, 1.2);
        koiFlock.events.length = 0;
        for (const f of koiFlock.creatures) if (f.depth > 0.75) water.disturb(f.nodes[0], f.nodes[1], 0.04 * (f.depth - 0.75), 1);
        // Floating food bobs on the ripples.
        for (const p of koi.food(koiFlock)) {
          const s = water.slopeAt(p.x, p.y);
          p.vx -= s.x * 900 * dt;
          p.vy -= s.y * 900 * dt;
        }
        // Now and then something touches the water.
        nextDrop -= dt;
        if (nextDrop <= 0) {
          nextDrop = rand(2, 5);
          const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 0.85;
          water.disturb(P.cx + Math.cos(a) * r * P.rx, P.cy + Math.sin(a) * r * P.ry, rand(0.4, 0.8), 1);
        }
      }

      if (sunset) stepFireflies(t, dt);

      // Shadows: the sun is to the top left, so shadows fall down and to the right. At sunset
      // the sun is low, so they stretch out much further.
      const reach = sunset ? 2.4 : 1;
      const shadows = [];
      for (const [flock] of kinds) {
        for (const c of flock.creatures) {
          const height = flock === bFlock ? 0.25 + 0.75 * (c.alt ?? 1) : 1;
          const lift = c.depth * height * reach;
          shadows.push({ x: c.x + 26 * lift, y: c.y + 36 * lift, radius: c.span * 0.34, strength: 0.32 * (0.6 + 0.4 * c.depth) });
        }
      }
      if (tree) {
        const s = treeShadow(tree);
        shadows.push({ ...s, x: tree.x + (s.x - tree.x) * reach, y: tree.y + (s.y - tree.y) * reach });
      }
      grass.shadows = shadows;
      ground.step(dt);
    },

    draw(pen) {
      const renderer = pen.r;
      // Koi first, under the water (bent by its ripples), with their floating food.
      if (koiFlock) {
        renderer.tuning = koiTuning;
        koi.drawFood(koiFlock, pen);
        pen.refract = true;
        koi.drawFish(koiFlock, pen);
        pen.refract = false;
        renderer.tuning = tuning;
      }
      for (const f of flowers) drawFlower(f, pen);
      // All insects together, farthest first. Each kind uses its own look settings.
      const all = [];
      for (const [flock, animal] of kinds) for (const c of flock.creatures) all.push([c, animal, flock]);
      all.sort((a, b) => a[0].depth - b[0].depth);
      for (const [c, animal, flock] of all) {
        renderer.tuning = flock.tuning;
        animal.draw(c, pen, flock);
      }
      // The tree last, over everything else: its canopy hangs over the pond, and insects fly
      // underneath it.
      if (tree) {
        renderer.tuning = treeTuning;
        drawTree(tree, pen);
      }
      renderer.tuning = tuning;
      const t = bFlock.time;
      // Wind wisps: a trail of faint characters, the newest end brightest, all fading with age.
      for (const m of wisps) {
        const age = (t - m.born) / m.life;
        const n = m.trail.length / 2;
        for (let k = 1; k < n; k++) {
          const x = m.trail[k * 2], y = m.trail[k * 2 + 1];
          const along = k / n; // 0 at the oldest end, 1 at the newest
          const glyph = k === n - 1 ? '~' : along > 0.35 ? lineGlyph(Math.atan2(y - m.trail[k * 2 - 1], x - m.trail[k * 2 - 2])) : '.';
          pen.dot(x, y, glyph, WISP, 1, clamp(1 - along * (1 - age) * 0.85 * m.strength, 0.15, 1));
        }
      }
      // Bits carried by the wind, fading as they go.
      for (const m of motes) pen.dot(m.x, m.y, m.glyph, m.color, 1, smoothstep(0.5, 1, (t - m.born) / m.life) * 0.9);
    },

    tap(x, y) {
      if (koiFlock && pondShape(x, y) < 1) {
        koiFlock.startle(x, y); // drops food for the koi (see koi.tap)
        const food = koi.food(koiFlock);
        for (let i = food.length - 1; i >= 0; i--) if (pondShape(food[i].x, food[i].y) > 0.96) food.splice(i, 1); // no food on the grass
        water.disturb(x, y, 1, 1.4);
      } else {
        grass.puff(x, y, 1, 7);
      }
      bFlock.startle(x, y);
      dFlock.startle(x, y);
    },

    pointer(x, y) {
      const now = performance.now();
      if (lastPointer && now - lastPointer.t < 200) {
        const lx = lastPointer.x, ly = lastPointer.y;
        const dt = Math.max(0.008, (now - lastPointer.t) / 1000);
        const dist = Math.hypot(x - lx, y - ly);
        const speed = dist / dt;
        if (dist > 0.5) {
          gusts.push({ x0: lx, y0: ly, x1: x, y1: y, vx: clamp((x - lx) / dt, -2500, 2500), vy: clamp((y - ly) / dt, -2500, 2500), len: dist, born: bFlock.time });
          if (gusts.length > 120) gusts.shift();
          // Wisps start anywhere across a wide band along the path, moving with it.
          if (speed > 120 && wisps.length < 70) {
            const n = speed > 1200 ? 3 : speed > 400 ? 2 : 1;
            const ux = (x - lx) / dist, uy = (y - ly) / dist;
            for (let i = 0; i < n; i++) {
              const side = rand(-1, 1) * WIND_REACH * 0.75;
              const sx = x - uy * side, sy = y + ux * side;
              const k = rand(0.35, 0.6);
              wisps.push({
                x: sx, y: sy, vx: ((x - lx) / dt) * k, vy: ((y - ly) / dt) * k,
                born: bFlock.time, life: rand(0.9, 1.6), seed: rand(0, 100),
                strength: clamp(speed / 1200, 0.4, 1) * (1 - Math.abs(side) / WIND_REACH * 0.5),
                trail: [sx, sy],
              });
            }
          }
          if (water) water.disturbLine(lx, ly, x, y, clamp(speed / 20000, 0.008, 0.07), 1.1);
          // A quick movement kicks up a few bits of fluff and petals.
          if (speed > 250 && motes.length < 120) {
            const n = speed > 1200 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const [glyph, color] = MOTES[Math.floor(Math.random() * MOTES.length)];
              motes.push({
                x: x + rand(-12, 12), y: y + rand(-12, 12),
                vx: ((x - lx) / dt) * 0.3 + rand(-30, 30), vy: ((y - ly) / dt) * 0.3 + rand(-30, 30),
                born: bFlock.time, life: rand(1.4, 2.6), seed: rand(0, 100), glyph, color,
              });
            }
          }
        }
      }
      lastPointer = { x, y, t: now };
    },

    setDensity(d) {
      bTuning.density = butterflies.defaults.density * 0.6 * d;
      dTuning.density = dragonflies.defaults.density * 0.4 * d;
      if (koiFlock) koiFlock.count = Math.round(KOI_PER_POND * d);
    },

    setFlowers(amount) {
      flowerAmount = amount;
      grass.setFlowers(amount);
      placeFlowers(bFlock.width, bFlock.height);
    },

    setSunset(on) {
      sunset = on;
      lightWater();
      if (!on) fireflies.length = 0;
    },

    // The sunset's color grade (see renderer.js), or nothing by day.
    grade(cols, rows, W, H) {
      return sunset ? sunsetGrade(cols, rows, W, H) : null;
    },

    // Fireflies, painted over the finished frame so they glow.
    overlay(ctx, r) {
      if (!sunset) return;
      const sprite = fireflySprite();

      // Fireflies: a soft glow, then a character snapped to the grid so it stays ASCII.
      ctx.globalCompositeOperation = 'lighter';
      const { cw, ch } = r;
      ctx.font = `600 ${Math.round(ch * 0.74)}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const f of fireflies) {
        if (f.glow < 0.03) continue;
        const gx = (Math.floor(f.x / cw) + 0.5) * cw, gy = (Math.floor(f.y / ch) + 0.5) * ch;
        ctx.globalAlpha = f.glow;
        ctx.drawImage(sprite, gx - 36, gy - 36, 72, 72);
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(236, 255, 160, ${f.glow})`;
        ctx.fillText(f.glow > 0.6 ? '*' : '+', gx, gy + 1);
      }
    },
  };
}
