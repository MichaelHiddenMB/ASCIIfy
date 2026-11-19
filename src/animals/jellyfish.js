// Jellyfish, seen from above, pulsing slowly through the sea.
// Adapted from ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt). The original pulses along one course across the
// screen; here each jelly drifts its own way and stays in open water (the scene says where
// that is, with `keepIn`). The original's drifting "marine snow" is left out: this is a sunny sea.
//
// Swimming is pulse-and-coast: the bell squeezes (narrower and longer), which shoves the jelly
// forward, then it relaxes and coasts until the next pulse. Each pulse also lights it up: the
// glow surges as the bell snaps shut and then eases out through the rest of the stroke.
//
//   bell       lit from within: brightest at the rim and the crown, with ribs running out
//              from the middle and a dusting of white dots over the top
//   halo       a faint glow spilling into the water around it
//   rim        a row of small scalloped lobes all along the edge
//   oral arms  long frilly ribbons from the middle, twisting as they trail, with bright
//              ruffled edges around a dim core
//   tentacles  hair-thin, faint threads
import { SHARED_TUNING } from '../engine/flock.js';
import { INK_GLOW, INK_LIT, ink } from '../engine/ink.js';
import { angleDiff, clamp, frac, hash3, rand, smoothstep, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';

const DEFAULTS = {
  ...SHARED_TUNING,
  speed: 1.05,
  sway: 0,
  spread: 0,
  farthest: 0.35,
  farBias: 1.4,
  grip: 1.4,
  trail: 0,
  sparkle: 0.1,
  pulseRate: 1,
  pulsePower: 1,
  pulseGlow: 1,
  tentacles: 1, // length of the frilly arms and the thin tentacles
  wander: 0.35, // how quickly each jelly's own direction drifts
};

const CROWN = [255, 168, 230];
const BODY = [232, 56, 182];
const RIM = [255, 200, 240];
const LOBES = [255, 214, 244];
const DOTS = [255, 240, 250];
const FRILL = [255, 214, 240];
const CORE = [204, 56, 172];
const TENTACLE = [232, 100, 204];

const at = { x: 0, y: 0 };
const bt = { x: 0, y: 0 };
const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

export const jellyfish = {
  key: 'jellyfish',
  label: 'Jellyfish',
  defaults: DEFAULTS,
  area: 95000,
  scale: 1.1,
  speed: 40,

  create: (c) => ({
    ...c,
    phase: rand(0, TAU), // where it is in its pulse
    squeeze: 0, // 0 relaxed, 1 fully squeezed
    turn: 0, // how fast it's turning (smoothed), so the arms swing out on the outside of a turn
    drift: rand(0, TAU), // its own wandering direction
  }),

  enter(j) {
    j.heading = j.drift;
  },

  update(j, flock, dt) {
    const k = flock.tuning;
    const t = flock.time;
    j.phase += dt * TAU * 0.5 * k.pulseRate * (0.9 + 0.2 * j.roll);
    const p = frac(j.phase / TAU);
    // A quick squeeze, then a slow relax.
    j.squeeze = p < 0.22 ? smoothstep(0, 0.22, p) : 1 - smoothstep(0.22, 1, p);

    // Wander, and turn back from the edges of open water.
    j.drift += (noise1(t * 0.12 + j.id * 9.1) - 0.5) * 2 * k.wander * dt;
    const home = flock.keepIn ? flock.keepIn(j) : flock.inward(j, Math.max(100, j.span));
    if (home.push > 0) j.drift += angleDiff(j.drift, home.angle) * Math.min(1, home.push * 2 * dt);

    // Lazily turn toward that direction; jellies can't steer hard.
    const before = j.heading;
    j.heading += clamp(angleDiff(j.heading, j.drift), -0.6 * k.grip * dt, 0.6 * k.grip * dt);
    j.turn += (angleDiff(before, j.heading) / dt - j.turn) * Math.min(1, dt * 3);

    const cruise = flock.cruise(j);
    const acc = flock.begin();
    // Thrust only while squeezing; drag the rest of the time, so it coasts.
    const thrust = p < 0.22 ? 6.2 * cruise * k.pulsePower : 0;
    acc.x += Math.cos(j.heading) * thrust - j.vx * 1.4;
    acc.y += Math.sin(j.heading) * thrust - j.vy * 1.4;
    flock.separate(j, k.separation, 0.5);
    flock.move(j, dt, cruise * 3);
  },

  // A hard pulse right now that surges it ahead the way it's already going (no turning).
  startle(j, _dx, _dy, strength, flock) {
    j.phase = Math.floor(j.phase / TAU) * TAU + TAU;
    const boost = 260 * strength * j.depth;
    j.vx += Math.cos(j.heading) * boost;
    j.vy += Math.sin(j.heading) * boost;
    j.startledUntil = flock.time + 0.8;
  },

  draw(j, pen, flock) {
    drawJelly(j, pen, flock);
  },
};

// How brightly a jelly is glowing right now (0 to 1), e.g. for a scene to add a halo.
export function jellyGlow(j) {
  return pulseGlow(j);
}

// The glow's surge on each pulse: quick to light as the bell snaps shut, then easing out.
function pulseGlow(j) {
  const p = frac(j.phase / TAU);
  return p < 0.16 ? smoothstep(0, 0.16, p) : Math.exp(-(p - 0.16) * 4.5);
}

function drawJelly(j, pen, flock) {
  const k = flock.tuning;
  const S = j.span;
  const sq = j.squeeze;
  const t = pen.t;
  const pose = { x: j.x, y: j.y, heading: j.heading, span: S, depth: j.depth, id: j.id };
  const len = k.tentacles;
  const base = pen.fogFor(j.depth);
  const a = 0.32 * (1 + 0.14 * sq);
  const b = 0.3 * (1 - 0.2 * sq);
  const u0 = -0.04;
  const sway = clamp(-j.turn * 0.5, -0.5, 0.5);
  const flash = pulseGlow(j) * k.pulseGlow;

  // Hair-thin tentacles: faint threads, roots toward the middle of the rim.
  for (let n = 0; n < 8; n++) {
    const v0 = (n / 7 - 0.5) * 2 * b * 0.6;
    let pu = u0 - 0.02;
    let pv = v0;
    const segs = 14;
    const length = 1.5 * len * (0.75 + 0.35 * hash3(j.id, n, 4));
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const u = u0 - 0.02 - f * length * (1 - 0.12 * sq);
      const v = v0 * (1 - 0.3 * f) + 0.04 * Math.sin(j.phase - f * 3.5 + n * 1.3) * f + sway * f * f * 0.4;
      pen.toWorld(pose, pu, pv, at);
      pen.toWorld(pose, u, v, bt);
      pen.line(at.x, at.y, bt.x, bt.y, TENTACLE, j.depth, undefined, Math.min(0.95, base + 0.45 + 0.35 * f));
      pu = u;
      pv = v;
    }
  }

  // Oral arms: frilly ribbons that twist as they trail, bright ruffled edges around a dim core.
  for (let n = 0; n < 4; n++) {
    const v0 = (n / 3 - 0.5) * 0.11;
    const segs = 26;
    const length = 1.05 * len * (0.8 + 0.3 * hash3(j.id, n, 7));
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const u = u0 - f * length;
      const v = v0 * (1 - 0.4 * f) + 0.05 * Math.sin(j.phase * 0.9 - f * 4.5 + n * 1.7) * f + sway * f * 0.25;
      // The twist: the ribbon's width swings through zero and back as it spirals.
      const w = 0.055 * (1 - 0.5 * f) * Math.cos(f * 9 + n * 1.3 + t * 0.6);
      const fog = Math.min(0.95, base + 0.3 * f);
      pen.toWorld(pose, u, v, at);
      pen.dot(at.x, at.y, i % 3 ? ':' : '|', CORE, j.depth, Math.min(0.95, fog + 0.15));
      for (const side of [-1, 1]) {
        pen.toWorld(pose, u, v + w * side, at);
        pen.dot(at.x, at.y, '{}~§'[(i + n + (side > 0 ? 1 : 0)) % 4], FRILL, j.depth, fog);
      }
    }
  }

  // A faint halo where the glow spills into the water, brighter and wider while the pulse glows.
  const out = pen.ink;
  const h = 1.3 * (1 + 0.18 * flash);
  pen.shape(pose, 0.32 * h + 0.1, (u, v) => {
    const r = Math.hypot((u - u0) / (a * h), v / (b * h));
    return r < 1 && u > u0 - 0.08 && ink(out, ...RIM, INK_GLOW, '.');
  }, { fog: clamp(base + 0.55 - 0.3 * flash, 0, 0.95) });

  // The bell, lit from within.
  pen.shape(pose, 0.42, (u, v) => {
    const du = (u - u0) / a;
    const dv = v / b;
    const r2 = du * du + dv * dv;
    const margin = u0 - 0.04 * dv * dv;
    if (r2 > 1 || u < margin) {
      // A row of scalloped lobes hanging just off the edge.
      if (Math.abs(dv) > 1 || u > margin || u < margin - 0.04) return false;
      const lobe = 0.04 * Math.sin(frac((dv + 1) * 5.5) * Math.PI);
      return u > margin - lobe && ink(out, ...LOBES, INK_LIT, 'o');
    }
    const r = Math.sqrt(r2);
    if (r > 0.88) return ink(out, ...RIM, INK_LIT, ':;');
    const th = Math.atan2(dv, du);
    // A dusting of white dots over the top of the dome.
    if (du > 0.3) {
      const gu = Math.round(du * 11);
      const gv = Math.round(dv * 13);
      const near = Math.hypot(du * 11 - gu, dv * 13 - gv) < 0.32;
      if (near && hash3(gu, gv, j.id) > 0.45) return ink(out, ...DOTS, INK_LIT, ".'");
    }
    // Ribs running out from the middle, brighter toward the rim.
    if (r > 0.35 && frac((th / Math.PI) * 6) < 0.1) return ink(out, ...RIM, INK_LIT, '|');
    // Glow: brightest at the crown and toward the rim, a little dimmer in the middle.
    const glow = 0.75 + 0.25 * Math.max(clamp(du, 0, 1), r * r);
    const c = mix(BODY, CROWN, clamp(du, 0, 1) * 0.8);
    return ink(out, c[0] * glow, c[1] * glow, c[2] * glow, INK_LIT, ' .');
  }, { light: (0.92 + 0.18 * sq) * (1 + 0.6 * flash) });
}
