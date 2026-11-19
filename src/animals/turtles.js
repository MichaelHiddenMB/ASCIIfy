// Green sea turtles, seen from above, rowing slowly through the sea.
// Written for ASCIIfy in the style of ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt): like their animals, the turtle is a shape sampler whose
// pattern is tied to its body, drawn with the same Pen.
//
// SWIMMING. Turtles row with their long front flippers: a strong sweep backward (the power
// stroke, which pushes the turtle forward), then the flippers turn edge-on and slide forward
// again (the recovery), then a glide. The small back flippers mostly steer. Each turtle
// wanders its own way and stays in open water (the scene's `keepIn`).
//
// RISING AND DIVING. Over a couple of minutes each turtle slowly rises toward the surface and
// dives again. Nearer the surface it looks bigger and clearer. At the top it takes a breath,
// which the scene shows as a ripple on the water (`breathing`).
//
// THE SHELL is made of real plates ("scutes"): a row of five down the middle, four down each
// side, and a ring of small ones around the rim. The seams between plates are pale, and each
// plate has streaky amber patterns fanning across it. The head and flippers are covered in
// small scales, outlined in dark lines.
import { SHARED_TUNING } from '../engine/flock.js';
import { INK_DARK, INK_SCALE, INK_SHIMMER, ink } from '../engine/ink.js';
import { angleDiff, clamp, frac, hash3, rand, smoothstep, TAU } from '../engine/math.js';
import { noise1, noise2 } from '../engine/noise.js';

const DEFAULTS = {
  ...SHARED_TUNING,
  fog: 0.55,
  speed: 1,
  sway: 0,
  spread: 0,
  farthest: 0.5,
  farBias: 1,
  grip: 1.2,
  separation: 600,
  trail: 0,
  shimmer: 0.2,
  sparkle: 0.04,
  wander: 0.25, // how quickly each turtle's own direction drifts
  strokeRate: 1, // how often they row
};

const SHELL = [96, 80, 44];
const SHELL_LIGHT = [124, 98, 52];
const STREAK = [200, 150, 72];
const SEAM = [214, 204, 156];
const RIM = [92, 80, 50];
const SKIN = [168, 168, 124];
const SKIN_DARK = [84, 84, 58];
const SKIN_EDGE = [222, 220, 186];
const EYE = [16, 14, 12];
const GLINT = [255, 252, 240];

// How far through its stroke (0..1) the front flippers are, and how far swept back they are
// (-0.45 = reaching forward, 1 = swept right back).
function stroke(t) {
  const p = frac(t);
  if (p < 0.32) return { sweep: -0.45 + 1.45 * smoothstep(0, 0.32, p), power: 1, feather: 0 };
  if (p < 0.62) return { sweep: 1 - 1.45 * smoothstep(0.32, 0.62, p), power: 0, feather: 1 };
  return { sweep: -0.45, power: 0, feather: 0 };
}

export const turtles = {
  key: 'turtles',
  label: 'Sea turtle',
  defaults: DEFAULTS,
  area: 300000,
  scale: 1.35,
  speed: 32,

  create: (c) => ({
    ...c,
    stroke: rand(0, 1), // where it is in its rowing cycle
    drift: rand(0, TAU),
    dive: rand(0, TAU), // where it is in its slow rise-and-dive cycle
    breathing: false, // true for one step when it takes a breath at the surface
    breathed: 0,
  }),

  enter(c) {
    c.heading = c.drift;
  },

  update(c, flock, dt) {
    const k = flock.tuning;
    const t = flock.time;
    // Rise and dive: changing its "roll" changes the depth the flock gives it next step.
    c.dive += dt * 0.05 * (0.8 + 0.4 * hash3(c.id, 1, 1));
    c.roll = clamp(0.5 + 0.55 * Math.sin(c.dive), 0, 1);
    c.breathing = c.roll > 0.97 && t - c.breathed > 6;
    if (c.breathing) c.breathed = t;

    c.drift += (noise1(t * 0.08 + c.id * 4.7) - 0.5) * 2 * k.wander * dt;
    const home = flock.keepIn ? flock.keepIn(c) : flock.inward(c, Math.max(120, c.span));
    if (home.push > 0) c.drift += angleDiff(c.drift, home.angle) * Math.min(1, home.push * 4 * dt);

    c.stroke += dt * 0.42 * k.strokeRate;
    const s = stroke(c.stroke);
    const cruise = flock.cruise(c);
    const acc = flock.begin();
    // The power stroke pushes it forward; water drag slows it the rest of the time.
    const thrust = s.power * cruise * 4.2;
    acc.x += Math.cos(c.heading) * thrust - c.vx * 0.9;
    acc.y += Math.sin(c.heading) * thrust - c.vy * 0.9;
    flock.separate(c, k.separation, 0.6);
    flock.move(c, dt, cruise * 2.5);
    const turn = (0.35 + 1.4 * home.push) * k.grip * dt; // slow, gentle turns, but firmer near an edge
    c.heading += clamp(angleDiff(c.heading, c.drift), -turn, turn);
  },

  // A click nearby: a few quick strokes to get away, turning off to one side.
  startle(c, dx, dy, strength, flock) {
    c.drift = Math.atan2(dy, dx);
    const kick = 90 * strength * c.depth;
    c.vx += Math.cos(c.heading) * kick;
    c.vy += Math.sin(c.heading) * kick;
    c.startledUntil = flock.time + 1;
  },

  draw(c, pen) {
    const out = pen.ink;
    const S = c.span;
    const pose = { x: c.x, y: c.y, heading: c.heading, span: S, depth: c.depth, id: c.id };
    const s = stroke(c.stroke);
    const back = stroke(c.stroke + 0.5); // the back flippers paddle a little, out of step
    // Each front flipper: from the shoulder, swung back by `sweep`; seen edge-on (thinner)
    // while it slides forward on the recovery.
    const flippers = [];
    for (const side of [-1, 1]) {
      const a = side * (Math.PI / 2 - 0.25 + s.sweep); // angle from straight ahead
      flippers.push({ u: 0.15, v: 0.15 * side, a, len: 0.44, width: 0.07 * (1 - 0.55 * s.feather), side });
      const b = side * (Math.PI - 0.6 + 0.2 * back.sweep);
      flippers.push({ u: -0.24, v: 0.1 * side, a: b, len: 0.17, width: 0.05, side });
    }

    pen.shape(pose, 0.62, (u, v) => {
      const av = Math.abs(v);
      // ---- the shell: a teardrop, widest a little in front of the middle ----
      const su = u / 0.31;
      const half = 0.235 * Math.sqrt(Math.max(0, 1 - su * su)) * (1 + 0.12 * su);
      if (Math.abs(su) <= 1 && av <= half) {
        const across = av / (half || 1); // 0 down the middle, 1 at the rim
        if (across > 0.84) {
          // The ring of small plates around the rim.
          const seam = Math.abs(frac(Math.atan2(v, u * 1.3) * 3.6) - 0.5) > 0.42;
          return seam ? ink(out, ...SEAM, INK_SCALE, ':') : ink(out, ...RIM, INK_SCALE, ' ');
        }
        // Middle row (5 plates) or side rows (4 each), with pale seams between them.
        const middle = across < 0.36;
        const rowU = middle ? (u + 0.26) / 0.104 : (u + 0.25) / 0.122;
        const cell = Math.floor(rowU);
        const along = rowU - cell;
        const seamAcross = Math.abs(across - 0.36) < 0.05;
        if (seamAcross || along < 0.09 || along > 0.91) return ink(out, ...SEAM, INK_SCALE, seamAcross ? '|' : '-');
        // Streaks fanning out from each plate's back corner.
        const streak = noise2(Math.atan2(along, across - (middle ? 0 : 0.36)) * 3, cell * 3.7 + (v > 0 ? 9 : 0), c.id) > 0.58;
        const k = 1.02 - 0.22 * across + 0.08 * Math.sin(cell * 2.3 + c.id);
        if (streak) return ink(out, STREAK[0] * k, STREAK[1] * k, STREAK[2] * k, INK_SHIMMER, '.');
        const base = middle ? SHELL_LIGHT : SHELL;
        return ink(out, base[0] * k, base[1] * k, base[2] * k, INK_SCALE, ' ');
      }
      // ---- the head ----
      if (u > 0.26 && u < 0.47) {
        const hu = (u - 0.37) / 0.1, hv = v / 0.085;
        if (hu * hu + hv * hv <= 1) return scales(out, u, v, c.id, hu > 0.55);
      }
      // ---- the flippers ----
      for (const f of flippers) {
        const ca = Math.cos(f.a), sa = Math.sin(f.a);
        const du = u - f.u, dv = v - f.v;
        const along = (du * ca + dv * sa) / f.len;
        if (along < 0 || along > 1) continue;
        const bendBack = 0.06 * along * along * f.side * (f.len > 0.3 ? 1 : 0); // the tip curves back
        const off = -du * sa + dv * ca - bendBack;
        const w = f.width * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * along)), 0.5) * (1 - 0.35 * along);
        if (Math.abs(off) > w) continue;
        // The front (leading) edge is pale.
        const leading = off * f.side < -w * 0.55;
        return leading ? ink(out, ...SKIN_EDGE, INK_SCALE, ' ') : scales(out, u, v, c.id, false);
      }
      // ---- a stubby tail ----
      if (u < -0.3 && u > -0.38 && av < 0.025) return ink(out, ...SKIN);
      return false;
    });

    // Eyes, on turtles big enough for them to show.
    if (S * 0.12 >= pen.cw) {
      const c0 = Math.cos(c.heading), s0 = Math.sin(c.heading);
      for (const side of [-1, 1]) {
        const u = 0.39, v = 0.06 * side;
        pen.spot(c.x + (u * c0 - v * s0) * S, c.y + (u * s0 + v * c0) * S, '●', GLINT, EYE, c.depth);
      }
    }
  },
};

// Skin covered in small scales: pale scales outlined in dark lines (on a grid that sticks to
// the body).
function scales(out, u, v, id, snout) {
  const gu = u * 16, gv = v * 16;
  const edge = Math.min(Math.abs(frac(gu) - 0.5), Math.abs(frac(gv + 0.5 * Math.floor(gu)) - 0.5)) < 0.12;
  if (edge) return ink(out, ...SKIN_DARK, INK_DARK, '+');
  const k = 0.92 + 0.16 * hash3(Math.floor(gu), Math.floor(gv), id) + (snout ? 0.08 : 0);
  return ink(out, SKIN[0] * k, SKIN[1] * k, SKIN[2] * k, INK_SCALE, ' ');
}
