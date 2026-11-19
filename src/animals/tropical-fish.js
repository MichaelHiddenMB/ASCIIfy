// Small tropical reef fish, seen from above, schooling over the reef.
// Written for ASCIIfy in the style of ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt): like their animals, each fish is a shape sampler whose
// colors come from patterns tied to its body, drawn with the same Pen.
//
// SPECIES. Each fish is one of a handful of real reef species with bold markings that still
// read at a small size: blue-green chromis, yellow tangs, blue tangs (royal blue with a black
// "palette" mark and a yellow tail), Moorish idols (white, black and yellow bands, and a long
// streamer trailing off the back fin), parrotfish (bigger, teal with pink scales) and clownfish
// (orange with white bands edged in black).
//
// SCHOOLING. Fish of the same species swim in loose schools using three simple urges (the
// classic "boids" recipe): steer toward nearby mates (cohesion), turn to match the way they're
// going (alignment), and don't bump into them (separation). Each also has its own slowly
// wandering direction, so schools drift, split and rejoin instead of moving like one block.
// Their pace rises and falls, so they dawdle over the coral and then hurry on. A click nearby
// makes them dart away, then they regroup.
//
// CLOWNFISH don't school: each one adopts an anemone on the reef (the scene hands the flock
// a list, `anemones`) and darts about close to it, the way real ones do.
//
// THE BODY. Small fish don't need the koi's long spine. The body is one rigid shape, bent a
// little toward whichever way the fish is turning, and its tail wags with a wave that runs
// back along it and grows toward the tip.
import { SHARED_TUNING } from '../engine/flock.js';
import { INK_DARK, INK_GLASS, INK_SHIMMER, ink } from '../engine/ink.js';
import { angleDiff, clamp, hash3, rand, smoothstep, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';

const DEFAULTS = {
  ...SHARED_TUNING,
  fog: 0.45,
  speed: 1,
  sway: 0,
  spread: 0,
  farthest: 0.6,
  farBias: 1.2,
  grip: 3,
  separation: 900,
  trail: 0,
  shimmer: 0.35,
  sparkle: 0.06,
  wander: 0.6, // how quickly each fish's own direction drifts
  cohere: 0.5, // how strongly they're drawn toward their school
  align: 1.1, // how strongly they match their school's direction
  school: 170, // how far away (px) a mate still counts as part of the school
};

const EYE = [14, 14, 20];
const GLINT = [255, 255, 250];
const BLACK = [24, 24, 32];
const WHITE = [244, 244, 236];

// Each species: how often it turns up, its size, and a painter for a point on its body.
// The painter gets u (0.5 at the nose, -0.5 at the tail tip) and a (across the body, -1 to 1).
const SPECIES = {
  chromis: {
    weight: 0.3, size: 0.75,
    paint: (u, a, out) => ink(out, 70 + 40 * (u + 0.5), 190 - 30 * Math.abs(a), 230, INK_SHIMMER),
    fin: [140, 220, 240],
  },
  yellowTang: {
    weight: 0.2, size: 1,
    paint: (u, a, out) => (u < -0.26 && u > -0.31 && Math.abs(a) < 0.5 ? ink(out, ...WHITE) : ink(out, 252, 214 - 20 * Math.abs(a), 40, INK_SHIMMER)),
    fin: [255, 230, 110],
  },
  blueTang: {
    weight: 0.17, size: 1.05,
    paint: (u, a, out) => {
      if (u < -0.3) return ink(out, 250, 206, 40); // the yellow tail
      // The black "palette" mark: a curving band along the back, with a blue window in it.
      const band = Math.abs(a - 0.35 * Math.sin(u * 6)) < 0.38 && u < 0.28 && u > -0.28;
      if (band && !(Math.abs(a + 0.1) < 0.18 && Math.abs(u + 0.05) < 0.08)) return ink(out, ...BLACK, INK_DARK);
      return ink(out, 46, 96 + 30 * (u + 0.5), 226, INK_SHIMMER);
    },
    fin: [80, 130, 240],
  },
  idol: {
    weight: 0.11, size: 1.05, streamer: true,
    paint: (u, a, out) => {
      if (u > 0.36) return ink(out, 238, 150, 60); // orange snout
      if (Math.abs(u - 0.2) < 0.08 || Math.abs(u + 0.12) < 0.09) return ink(out, ...BLACK, INK_DARK);
      if (u < -0.3) return ink(out, ...BLACK, INK_DARK);
      if (u < -0.21) return ink(out, ...WHITE);
      return ink(out, 250, 226 - 30 * Math.abs(u), 120 + 100 * Math.max(0, u));
    },
    fin: [240, 240, 220],
  },
  parrot: {
    weight: 0.09, size: 1.55,
    paint: (u, a, out, f) => {
      if (u > 0.3) return ink(out, 240, 150, 170); // pink face
      const scale = hash3(Math.round(u * 26), Math.round(a * 5), f.id) > 0.72;
      if (scale) return ink(out, 236, 140, 176);
      return ink(out, 60, 196 - 30 * Math.abs(a), 170, INK_SHIMMER);
    },
    fin: [120, 220, 200],
  },
  clown: {
    weight: 0.13, size: 0.8,
    paint: (u, a, out) => {
      // Three white bands, each edged in black.
      for (const [c, w] of [[0.24, 0.05], [-0.01, 0.06], [-0.3, 0.035]]) {
        const d = Math.abs(u - c);
        if (d < w) return ink(out, ...WHITE);
        if (d < w + 0.022) return ink(out, ...BLACK, INK_DARK);
      }
      return ink(out, 246, 118 + 12 * (1 - Math.abs(a)), 30);
    },
    fin: [250, 150, 70],
  },
};
const NAMES = Object.keys(SPECIES);
function pickSpecies() {
  let x = Math.random();
  for (const name of NAMES) if ((x -= SPECIES[name].weight) <= 0) return name;
  return 'chromis';
}

// Half the body's width at u, as a fraction of its length.
function halfWidth(u) {
  if (u > 0.18) return 0.16 * Math.sqrt(Math.max(0, 1 - ((u - 0.18) / 0.32) ** 2));
  if (u > -0.2) return 0.16;
  if (u > -0.33) return 0.16 - 0.11 * smoothstep(-0.2, -0.33, u);
  return 0;
}

export const tropicalFish = {
  key: 'tropicalFish',
  label: 'Tropical fish',
  defaults: DEFAULTS,
  area: 30000,
  scale: 0.58,
  speed: 70,

  create: (c) => ({
    ...c,
    species: pickSpecies(),
    phase: rand(0, TAU), // tail beat
    bend: 0, // how much the body curves into a turn
    drift: rand(0, TAU), // its own wandering direction
    home: null, // a clownfish's anemone
  }),

  enter(f) {
    f.heading = f.drift;
  },

  update(f, flock, dt) {
    const k = flock.tuning;
    const t = flock.time;
    const sp = SPECIES[f.species];
    f.span *= sp.size;
    const cruise = flock.cruise(f);
    f.drift += (noise1(t * 0.2 + f.id * 3.3) - 0.5) * 2 * k.wander * dt;
    const home = flock.keepIn ? flock.keepIn(f) : flock.inward(f, Math.max(80, f.span));
    if (home.push > 0) f.drift += angleDiff(f.drift, home.angle) * Math.min(1, home.push * 3 * dt);

    let want = f.drift;
    let pace = 0.55 + 0.75 * noise1(t * 0.4 + f.id * 1.9); // dawdling, then hurrying on
    if (f.species === 'clown' && flock.anemones?.length) {
      // Stay close to its own anemone, darting about over it.
      if (!f.home || !flock.anemones.includes(f.home)) f.home = flock.anemones[Math.floor(Math.random() * flock.anemones.length)];
      const dx = f.home.x - f.x, dy = f.home.y - f.y, d = Math.hypot(dx, dy);
      const near = f.home.r + 14;
      want = d > near ? Math.atan2(dy, dx) : f.drift;
      pace = d > near * 3 ? 1.2 : 0.35 + 0.5 * noise1(t * 0.9 + f.id);
    } else {
      // School with nearby mates of the same species.
      let cx = 0, cy = 0, hx = 0, hy = 0, n = 0;
      for (const o of flock.creatures) {
        if (o === f || o.species !== f.species) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d > k.school) continue;
        cx += o.x; cy += o.y;
        hx += Math.cos(o.heading); hy += Math.sin(o.heading);
        n++;
      }
      if (n) {
        cx /= n; cy /= n;
        const dc = Math.hypot(cx - f.x, cy - f.y) || 1;
        const pull = k.cohere * clamp(dc / k.school, 0, 1) * 2;
        const wx = Math.cos(f.drift) + (hx / n) * k.align + ((cx - f.x) / dc) * pull;
        const wy = Math.sin(f.drift) + (hy / n) * k.align + ((cy - f.y) / dc) * pull;
        want = Math.atan2(wy, wx);
        // Its own direction slowly comes round to the school's, so they don't keep pulling apart.
        f.drift += angleDiff(f.drift, Math.atan2(hy, hx)) * Math.min(1, dt * 0.6);
      }
      if (home.push > 0.25) want = home.angle; // the edge of the reef wins
    }

    const acc = flock.begin();
    flock.steer(f, want, cruise * pace, k.grip);
    flock.separate(f, k.separation, 0.75);
    // Near the edge of the reef, a firm push back in, so a crowded school can't shove its
    // outer fish against the edge.
    if (home.push > 0) {
      acc.x += Math.cos(home.angle) * home.push * cruise * 12;
      acc.y += Math.sin(home.angle) * home.push * cruise * 12;
    }
    const speed = flock.move(f, dt, cruise * 2);
    const before = f.heading;
    if (speed > 4) flock.face(f, dt, 5);
    const turning = angleDiff(before, f.heading) / dt;
    f.bend += (clamp(turning * 0.25, -0.6, 0.6) - f.bend) * Math.min(1, dt * 6);
    f.phase += dt * (5 + speed / 9);
  },

  // A click nearby: dart away from it.
  startle(f, dx, dy, strength, flock) {
    const kick = (150 + 260 * strength) * (0.6 + 0.4 * f.depth);
    f.vx += dx * kick;
    f.vy += dy * kick;
    f.drift = Math.atan2(dy, dx);
    f.startledUntil = flock.time + rand(0.4, 0.8);
  },

  draw(f, pen) {
    const sp = SPECIES[f.species];
    const out = pen.ink;
    const pose = { x: f.x, y: f.y, heading: f.heading, span: f.span, depth: f.depth, id: f.id };
    // Sideways offset of the body's middle line at u: curving into turns, and the tail wag.
    const offset = (u) => f.bend * u * u * 0.5 + 0.07 * Math.sin(f.phase + u * 5) * clamp(0.12 - u, 0, 1) ** 1.5;
    const finBeat = 0.5 + 0.5 * Math.sin(f.phase * 1.3);

    pen.shape(pose, 0.55, (u, v) => {
      const vb = v - offset(u);
      const av = Math.abs(vb);
      // The tail fin: a fan with a shallow fork.
      if (u < -0.31) {
        if (u < -0.52) return false;
        const fan = 0.05 + 0.14 * ((-0.31 - u) / 0.21);
        if (av > fan || (u < -0.45 && av < (-0.45 - u) * 1.1)) return false;
        return sp.paint(-0.4, vb / fan, out, f); // colored like the back of the body
      }
      const w = halfWidth(u);
      if (av > w) {
        // Small see-through fins behind the head, flicking.
        const pect = u > 0.02 && u < 0.14 && av < w + 0.07 * finBeat * Math.sin(((u - 0.02) / 0.12) * Math.PI);
        return pect && ink(out, ...sp.fin, INK_GLASS, '-');
      }
      return sp.paint(u, vb / (w || 1), out, f);
    });

    // A Moorish idol's long streamer, trailing back from its fin and swaying.
    if (sp.streamer) {
      const sway = Math.sin(f.phase * 0.6) * 0.06;
      pen.lineBody(pose, 0.05, offset(0.05), -0.45, offset(-0.45) + sway + 0.04, WHITE);
    }

    // Eyes, only on fish big enough that they don't swamp the head.
    const ev = halfWidth(0.33) * 0.6 * f.span;
    if (2 * ev >= pen.cw * 1.8) {
      for (const side of [-1, 1]) {
        const u = 0.33, v = offset(u) + side * halfWidth(u) * 0.6;
        const c = Math.cos(f.heading), s = Math.sin(f.heading);
        pen.spot(f.x + (u * c - v * s) * f.span, f.y + (u * s + v * c) * f.span, '●', GLINT, EYE, f.depth);
      }
    }
  },
};
