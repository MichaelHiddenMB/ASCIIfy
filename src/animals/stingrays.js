// Rays, seen from above, gliding over the sea floor.
// Written for ASCIIfy in the style of ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt): like their animals, each ray is a shape sampler whose
// pattern is tied to its body, drawn with the same Pen.
//
// Two kinds, which swim in very different ways:
//   - The BLUE-SPOTTED STINGRAY is a round tan disc covered in bright blue spots, with a blue
//     rim and a long tail with a barb. It swims by rippling the edge of its disc: a wave runs
//     from front to back along each side, which from above shows as light and dark bands
//     sliding back across the "wings". It keeps low, near the sea floor, and now and then
//     settles on the bottom to rest for a while before lifting off again.
//   - The SPOTTED EAGLE RAY is dark with white spots, with a duck-bill snout, pointed
//     swept-back wings and a very long, thin tail. It flies through the water like a bird:
//     bouts of slow, deep flaps (the wings look narrower as they rise and fall, since we see
//     them from above), then a glide.
// Both turn gently, and their tails swing out on the outside of a turn.
import { SHARED_TUNING } from '../engine/flock.js';
import { INK_DARK, INK_SCALE, INK_SHIMMER, INK_SPOT, ink } from '../engine/ink.js';
import { angleDiff, clamp, rand, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';
import { spotted } from './shapes.js';

const DEFAULTS = {
  ...SHARED_TUNING,
  fog: 0.5,
  speed: 1,
  sway: 0,
  spread: 0,
  farthest: 0.5,
  farBias: 1,
  grip: 1.6,
  separation: 500,
  trail: 0,
  shimmer: 0.2,
  sparkle: 0.04,
  wander: 0.3, // how quickly each ray's own direction drifts
  rests: 0.03, // chance per second that a stingray settles on the bottom
};

const TAN = [176, 150, 98];
const TAN_DARK = [128, 106, 66];
const BLUE_SPOT = [80, 172, 250];
const BLUE_RIM = [56, 128, 220];
const EAGLE = [58, 68, 98];
const EAGLE_LIGHT = [90, 104, 136];
const WHITE_SPOT = [236, 238, 240];
const TAIL_TAN = [150, 128, 84];
const TAIL_DARK = [120, 132, 164];
const TAIL_FILL = [40, 44, 56]; // a tail's block, where it crosses coral
const EYE = [20, 18, 16];
const GLINT = [255, 252, 240];
const at = { x: 0, y: 0 };
const bt = { x: 0, y: 0 };

export const stingrays = {
  key: 'stingrays',
  label: 'Stingray',
  defaults: DEFAULTS,
  area: 300000,
  scale: 1.15,
  speed: 34,

  create: (c) => {
    const eagle = Math.random() < 0.4;
    return {
      ...c,
      // Stingrays keep to the bottom (deep, so smaller and hazier); eagle rays swim higher.
      roll: eagle ? c.roll : c.roll * 0.45,
      variety: eagle ? 'eagle' : 'stingray',
      phase: rand(0, TAU), // the wing ripple or flap
      drift: rand(0, TAU),
      bend: 0, // how much it's turning (smoothed), for the tail
      resting: false,
      until: 0, // when the current rest, or flapping bout, ends
      flapping: true,
    };
  },

  enter(c) {
    c.heading = c.drift;
  },

  update(c, flock, dt) {
    const k = flock.tuning;
    const t = flock.time;
    const eagle = c.variety === 'eagle';
    if (eagle) c.span *= 1.35; // eagle rays are the bigger of the two
    c.drift += (noise1(t * 0.1 + c.id * 6.1) - 0.5) * 2 * k.wander * dt;
    const home = flock.keepIn ? flock.keepIn(c) : flock.inward(c, Math.max(120, c.span));
    if (home.push > 0) c.drift += angleDiff(c.drift, home.angle) * Math.min(1, home.push * 4 * dt);

    const cruise = flock.cruise(c);
    let pace = 1;
    if (eagle) {
      // Bouts of flapping, then a glide.
      if (t > c.until) {
        c.flapping = !c.flapping;
        c.until = t + (c.flapping ? rand(2.5, 5) : rand(1.5, 3.5));
      }
      c.phase += dt * (c.flapping ? 2.4 : 0.3);
      pace = c.flapping ? 1.1 : 0.85;
    } else {
      // Now and then, settle on the bottom for a rest (not near the edge of its patch).
      if (!c.resting && home.push === 0 && t > c.until && Math.random() < k.rests * dt) {
        c.resting = true;
        c.until = t + rand(5, 12);
      } else if (c.resting && (t > c.until || home.push > 0)) {
        c.resting = false;
        c.until = t + rand(8, 20);
      }
      pace = c.resting ? 0 : 0.75 + 0.35 * noise1(t * 0.3 + c.id);
      c.phase += dt * (c.resting ? 0.6 : 3.2);
    }

    flock.begin();
    flock.steer(c, c.drift, cruise * pace, k.grip * (c.resting ? 2 : 0.8));
    flock.separate(c, k.separation, 0.6);
    const speed = flock.move(c, dt, cruise * 2);
    const before = c.heading;
    if (speed > 3) flock.face(c, dt, 0.5 + 1.5 * home.push);
    c.bend += (clamp((angleDiff(before, c.heading) / dt) * 0.6, -0.8, 0.8) - c.bend) * Math.min(1, dt * 3);
  },

  // A click nearby: wake up and glide quickly away.
  startle(c, dx, dy, strength, flock) {
    c.resting = false;
    c.flapping = true;
    c.until = flock.time + 3;
    c.drift = Math.atan2(dy, dx);
    c.vx += dx * 120 * strength;
    c.vy += dy * 120 * strength;
    c.startledUntil = flock.time + 1;
  },

  draw(c, pen) {
    const eagle = c.variety === 'eagle';
    const S = c.span;
    const pose = { x: c.x, y: c.y, heading: c.heading, span: S, depth: c.depth, id: c.id };

    // The tail first, so the body covers its root: a chain of short lines, waving, and swung
    // out on the outside of a turn. It shows over the coral too (lineOver).
    const length = eagle ? 1.5 : 0.85;
    const segs = 18;
    let pu = -0.3, pv = 0;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const u = -0.3 - f * length;
      const v = 0.05 * Math.sin(c.phase * 0.5 - f * 5) * f - c.bend * f * f * 0.35;
      pen.toWorld(pose, pu, pv, at);
      pen.toWorld(pose, u, v, bt);
      const barb = !eagle && Math.abs(f - 0.3) < 0.03;
      pen.lineOver(at.x, at.y, bt.x, bt.y, eagle ? TAIL_DARK : TAIL_TAN, TAIL_FILL, c.depth, barb ? '+' : i === segs ? '.' : undefined);
      pu = u;
      pv = v;
    }

    pen.shape(pose, 0.58, eagle ? eagleRay(c, pen.ink) : stingray(c, pen.ink));

    // Eyes, on rays big enough for them to show.
    if (S * 0.14 >= pen.cw) {
      for (const side of [-1, 1]) {
        pen.toWorld(pose, eagle ? 0.24 : 0.17, (eagle ? 0.06 : 0.07) * side, at);
        pen.spot(at.x, at.y, '●', GLINT, EYE, c.depth);
      }
    }
  },
};

// The blue-spotted stingray's disc, with the ripple running back along its edges.
function stingray(c, out) {
  const ph = c.phase;
  return (u, v) => {
    const av = Math.abs(v);
    // Small fins at the back, either side of the tail.
    if (u < -0.24 && u > -0.36 && av < 0.1 * Math.sin(((u + 0.36) / 0.12) * Math.PI)) return ink(out, ...TAN_DARK);
    if (u > 0.33 || u < -0.3) return false;
    // A rounded diamond, widest just in front of the middle.
    const w0 = u > 0.03 ? 0.46 * Math.pow(Math.max(0, 1 - ((u - 0.03) / 0.3) ** 1.7), 0.6) : 0.46 * Math.pow(Math.max(0, 1 - ((0.03 - u) / 0.33) ** 1.8), 0.55);
    const ripple = Math.sin(ph - u * 9);
    const w = w0 * (1 + 0.05 * ripple);
    if (av > w) return false;
    const across = av / (w || 1);
    if (across > 0.9) return ink(out, ...BLUE_RIM, INK_SCALE, ' ');
    if (spotted(u, v, 0.075, 0.02, c.id)) return ink(out, ...BLUE_SPOT, INK_SPOT, 'o');
    // Light and dark bands sliding back across the wings with the ripple, stronger toward the edge.
    const k = 1 + 0.2 * ripple * across - (av < 0.03 && u < 0.2 ? 0.18 : 0);
    return ink(out, TAN[0] * k, TAN[1] * k, TAN[2] * k, INK_SCALE, ' ');
  };
}

// The spotted eagle ray: a snout, then long pointed wings swept back, narrowing as they flap.
function eagleRay(c, out) {
  const flap = Math.cos(c.phase);
  const b = 0.5 * (0.74 + 0.26 * flap); // how wide the wings look from above
  const light = 0.88 + 0.2 * flap;
  return (u, v) => {
    const av = Math.abs(v);
    // The rounded snout.
    if (u > 0.18) {
      const su = (u - 0.18) / 0.14, sv = av / 0.075;
      return su * su + sv * sv <= 1 && ink(out, EAGLE_LIGHT[0] * light, EAGLE_LIGHT[1] * light, EAGLE_LIGHT[2] * light, INK_SCALE, ' ');
    }
    if (av > b) return false;
    const f = av / b; // 0 at the body, 1 at the wingtip
    const lead = 0.2 - f * 0.28 - 0.05 * f * f * flap; // the front edge sweeps back to the tip
    const trail = -0.3 + Math.pow(f, 0.6) * 0.2; // the back edge curves in toward the tip
    if (u > lead || u < trail) return false;
    if (spotted(u, v, 0.065, 0.017, c.id)) return ink(out, ...WHITE_SPOT, INK_SPOT, '.');
    const k = light * (1.05 - 0.25 * f) * (av < 0.06 ? 1.15 : 1);
    return ink(out, EAGLE[0] * k, EAGLE[1] * k, EAGLE[2] * k, f > 0.85 ? INK_DARK : INK_SHIMMER, ' ');
  };
}
