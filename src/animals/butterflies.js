// Butterflies (blue morphos, and orange monarchs for about 40% of them), seen from above,
// wandering over the meadow and visiting flowers.
// Adapted from ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt). The original flies along one course across the
// screen; here each butterfly wanders on its own, turns back before the edges, and now and
// then lands on a flower to rest with its wings slowly opening and closing.
//
// The wings: each wing (forewing and hindwing) is a fan shape around the point where it joins
// the body. For any point, we work out its angle and distance from that joining point; the
// wing's outline is just "how far the fan reaches at each angle". The flap is done by
// squashing the wings sideways as they rise (seen from above, raised wings look narrower).
//
// The flight: steer the way it wants to go, plus a little random flutter, a push forward on
// every downstroke, and now and then a glide with the wings held flat.
import { SHARED_TUNING } from '../engine/flock.js';
import { INK_BODY, INK_DARK, INK_SCALE, INK_SHIMMER, INK_SPOT, ink } from '../engine/ink.js';
import { angleDiff, clamp, frac, rand, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';

// A wing lobe: angle range (0 = straight out sideways, positive = toward the head), longest
// reach (fraction of wingspan), where along the range it peaks, roundness, wavy edge depth.
const FORE = { from: -0.3, to: 1.0, reach: 0.56, peak: 0.55, round: 0.5, scallop: 0 };
const HIND = { from: -1.45, to: 0.15, reach: 0.44, peak: 0.48, round: 0.42, scallop: 0.04 };
const FORE_ROOT = 0.06; // where each wing pair joins the body (fraction of span ahead of centre)
const HIND_ROOT = -0.02;
// Monarchs have longer, more pointed forewings and rounder, smooth-edged hindwings.
const M_FORE = { from: -0.25, to: 1.0, reach: 0.6, peak: 0.64, round: 0.65, scallop: 0 };
const M_HIND = { from: -1.4, to: 0.15, reach: 0.42, peak: 0.45, round: 0.55, scallop: 0 };
const MONARCHS = 0.4; // share of the butterflies that are monarchs
const BLACK = [20, 15, 12];
const BODY = [30, 30, 42];
const FLAP_HZ = 2.6;
const GLIDE = 0.35;
const FLUTTER = 1.3;

function lobeReach(l, phi, t = (phi - l.from) / (l.to - l.from)) {
  if (t <= 0 || t >= 1) return 0;
  const s = t < l.peak ? (t / l.peak) * 0.5 : 0.5 + ((t - l.peak) / (1 - l.peak)) * 0.5;
  const R = l.reach * Math.pow(Math.sin(Math.PI * s), l.round);
  return l.scallop ? R * (1 - l.scallop * (0.5 + 0.5 * Math.cos(t * Math.PI * 14))) : R;
}

// Body half-width at u (+ toward the head): round head, thorax, tapering abdomen.
function bodyHalfWidth(u) {
  if (u > 0.17 || u < -0.32) return 0;
  if (u > 0.11) return Math.sqrt(Math.max(0, 0.03 * 0.03 - (u - 0.14) ** 2));
  if (u > -0.04) return 0.034;
  return 0.03 * (1 - 0.6 * ((-0.04 - u) / 0.28));
}

// Monarch colouring for a point on a wing (t = position around the fan, r = how far out).
// Orange with black veins, a black border dotted with white, and a black forewing tip
// crossed by a band of pale spots.
function monarchInk(out, part, t, r) {
  if (r > 0.86) {
    const row = r < 0.93 ? 0 : 1; // two rows of dots, offset from each other
    const dot = r > 0.88 && r < 0.98 && Math.abs(frac(t * (part ? 8 : 10) + row * 0.5) - 0.5) < 0.13;
    return dot ? ink(out, 246, 240, 228, INK_SPOT) : ink(out, ...BLACK, INK_DARK);
  }
  if (part === 0 && t > 0.9) return ink(out, ...BLACK, INK_DARK); // dark leading edge
  if (part === 0 && t > 0.62 && r > 0.68) {
    if (r < 0.82 && Math.abs(frac(t * 5) - 0.5) < 0.17) return ink(out, 250, 226, 190, INK_SPOT);
    return ink(out, ...BLACK, INK_DARK);
  }
  // Veins fan out from the root; measuring the gap times r keeps them the same width all along.
  const n = part ? 4 : 5;
  const gap = (0.5 - Math.abs(frac(t * n) - 0.5)) / n;
  if (r < 0.07 || gap * r < 0.006) return ink(out, 30, 18, 10, INK_DARK);
  return ink(out, 196 + 50 * r, 86 + 52 * r, 12 + 14 * r, INK_SCALE);
}

const lobe = { t: 0, r: 0 };
function inLobe(l, du, vw) {
  const phi = Math.atan2(du, vw);
  const t = (phi - l.from) / (l.to - l.from);
  const R = lobeReach(l, phi, t);
  const r = Math.hypot(du, vw);
  if (r > R) return false;
  lobe.t = t;
  lobe.r = r / R;
  return true;
}

const DEFAULTS = {
  ...SHARED_TUNING,
  density: 1.05,
  speed: 1.05,
  sway: 0,
  spread: 0,
  size: 1.25,
  farthest: 0.18,
  farBias: 1.7,
  grip: 5,
  separation: 700,
  trail: 0,
  trailFade: 0.15,
  flutter: 0.35, // how much the path zigzags
  glide: 2.75, // how often they stop flapping and glide
  flapRate: 1,
  wander: 0.9, // how quickly each one's own direction drifts
  visits: 0.12, // chance per second of going to find a flower
  rest: 1, // how long they sit on a flower
};

function takeOff(b, t) {
  if (b.target && b.target.taken === b) b.target.taken = null;
  b.target = null;
  b.state = 'fly';
  b.restless = t + rand(4, 12); // won't look for another flower until then
  b.drift = rand(0, TAU);
  b.vx = Math.cos(b.drift) * 30;
  b.vy = Math.sin(b.drift) * 30;
}

// The closest flower nobody else is on or heading to, within `range` pixels.
function freeFlower(b, flowers, range) {
  let best = null, bestD = range;
  for (const f of flowers) {
    if (f.taken || f.gone) continue;
    const d = Math.hypot(f.x - b.x, f.y - b.y);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

export const butterflies = {
  key: 'butterflies',
  label: 'Butterfly',
  defaults: DEFAULTS,
  area: 48000,
  scale: 1,
  speed: 90,

  create: (c) => ({
    ...c,
    kind: Math.random() < MONARCHS ? 'monarch' : 'morpho',
    phase: rand(0, TAU),
    open: 1, // how flat the wings look from above: ~0.1 raised together, 1 spread open
    glide: 0,
    glideUntil: 0,
    flutterX: 0,
    flutterY: 0,
    drift: rand(0, TAU), // its own wandering direction
    state: 'fly', // 'fly', 'approach' (heading to a flower) or 'landed'
    target: null,
    until: 0,
    since: 0,
    restless: rand(2, 8),
    alt: 1, // height: 1 flying, 0 sitting on a flower (they look a little smaller down there)
  }),

  enter(b) {
    b.flutterX = 0;
    b.flutterY = 0;
    b.heading = b.drift;
  },

  // Called by the scene when something disturbs a butterfly sitting on a flower.
  disturb(b, flock) {
    if (b.state === 'landed' || b.state === 'approach') takeOff(b, flock.time);
  },

  update(b, flock, dt) {
    const k = flock.tuning;
    const t = flock.time;
    const cruise = flock.cruise(b);
    const flowers = flock.flowers || [];

    if (b.state === 'landed') {
      const f = b.target;
      if (!f || f.gone || t > b.until) {
        takeOff(b, t);
      } else {
        // Sit on the flower (which sways in the wind), basking: wings slowly open and close.
        b.x = f.x + (f.dx || 0);
        b.y = f.y + (f.dy || 0);
        b.vx = 0;
        b.vy = 0;
        b.alt = Math.max(0, b.alt - dt * 2);
        b.span *= 0.72 + 0.28 * b.alt;
        b.glide = 0;
        b.open = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 1.3 + b.id));
        return;
      }
    }

    // Wander: its own direction drifts smoothly, and turns back near the edges.
    b.drift += (noise1(t * 0.25 + b.id * 7.3) - 0.5) * 2 * k.wander * dt;
    const edge = flock.inward(b, Math.max(90, b.span));
    if (edge.push > 0) b.drift += angleDiff(b.drift, edge.angle) * Math.min(1, edge.push * 3 * dt);

    // Now and then, go and find a flower.
    if (b.state === 'fly' && t > b.restless && flowers.length && Math.random() < k.visits * dt) {
      const f = freeFlower(b, flowers, 350);
      if (f) {
        b.state = 'approach';
        b.target = f;
        b.since = t;
        f.taken = b;
      }
    }

    let dir = b.drift;
    let pace = 1;
    let calm = 1;
    if (b.state === 'approach') {
      const f = b.target;
      const tx = f.x + (f.dx || 0), ty = f.y + (f.dy || 0);
      const dist = Math.hypot(tx - b.x, ty - b.y);
      if (f.gone || t - b.since > 9) {
        takeOff(b, t); // gave up
      } else if (dist < 7) {
        b.state = 'landed';
        b.until = t + rand(2.5, 7) * k.rest;
        return;
      } else {
        dir = Math.atan2(ty - b.y, tx - b.x);
        pace = clamp(dist / 160, 0.2, 1); // slow down when close
        calm = 0.3; // fly more steadily on the way in
        if (dist < 60) b.alt = Math.max(0.2, b.alt - dt * 1.5); // dropping down to land
      }
    }
    if (b.state === 'fly') b.alt = Math.min(1, b.alt + dt * 1.5);
    b.span *= 0.72 + 0.28 * b.alt;

    const acc = flock.begin();
    flock.steer(b, dir, cruise * pace, k.grip);

    // Flutter: a random wobble that keeps fading back to zero, so the path zigzags.
    const kick = Math.sqrt(dt) * 520 * FLUTTER * k.flutter * calm * (1 - 0.8 * b.glide) * (0.5 + 0.5 * b.depth);
    b.flutterX += -b.flutterX * 3 * dt + (Math.random() * 2 - 1) * kick;
    b.flutterY += -b.flutterY * 3 * dt + (Math.random() * 2 - 1) * kick;
    acc.x += b.flutterX;
    acc.y += b.flutterY;

    // Every downstroke shoves the butterfly forward a little.
    const down = Math.max(0, -Math.sin(b.phase)) * (1 - b.glide);
    acc.x += Math.cos(b.heading) * down * cruise * 1.4 * pace;
    acc.y += Math.sin(b.heading) * down * cruise * 1.4 * pace;

    if (b.state === 'fly') flock.separate(b);
    const speed = flock.move(b, dt, cruise * 2.2);
    if (speed > 12) flock.face(b, dt);

    if (b.glide < 0.5 && t > b.glideUntil && speed > cruise * 0.5 && Math.random() < GLIDE * k.glide * dt) {
      b.glideUntil = t + rand(0.5, 1.4);
    }
    b.glide += ((t < b.glideUntil ? 1 : 0) - b.glide) * Math.min(1, dt * 6);
    const urgency = clamp(speed / (cruise * 2), 0, 1);
    b.phase += dt * TAU * FLAP_HZ * k.flapRate * (0.8 + 0.6 * urgency) * (1 - 0.9 * b.glide);
    const beat = Math.pow(0.5 + 0.5 * Math.cos(b.phase), 0.8);
    b.open = 0.1 + 0.9 * (beat * (1 - b.glide) + 0.96 * b.glide);
  },

  // A click nearby: fly off away from it.
  startle(b, dx, dy, strength, flock) {
    if (b.state !== 'fly') takeOff(b, flock.time);
    const k = strength * 420 * b.depth;
    b.vx += dx * k;
    b.vy += dy * k;
    b.drift = Math.atan2(dy, dx);
    b.startledUntil = flock.time + rand(0.6, 1.2);
    b.glideUntil = 0;
  },

  draw(b, pen) {
    const S = b.span;
    const open = Math.max(0.08, b.open);
    const out = pen.ink;
    // The body yaws a touch with each beat.
    const pose = { x: b.x, y: b.y, heading: b.heading + 0.06 * Math.sin(b.phase), span: S, depth: b.depth, id: b.id };
    const minBody = pen.cw * 0.4;
    const monarch = b.kind === 'monarch';
    const fore = monarch ? M_FORE : FORE;
    const hind = monarch ? M_HIND : HIND;

    pen.shape(pose, 0.75, (u, v) => {
      const av = Math.abs(v);
      const bw = bodyHalfWidth(u);
      if (bw > 0 && av * S <= Math.max(bw * S, minBody)) return ink(out, ...BODY, INK_BODY);
      const vw = av / open;
      let part;
      if (inLobe(fore, u - FORE_ROOT, vw)) part = 0;
      else if (inLobe(hind, u - HIND_ROOT, vw)) part = 1;
      else return false;
      const { t, r } = lobe;
      if (monarch) return monarchInk(out, part, t, r);
      // Black margin with white spots on the forewing, dark roots and leading edge, shimmering blue.
      if (r > 0.86) {
        if (part === 0 && r < 0.95 && Math.abs(frac(t * 5) - 0.5) < 0.14) ink(out, 236, 240, 255, INK_SPOT);
        else ink(out, 22, 28, 62, INK_DARK);
      } else if (r < 0.08) ink(out, 26, 44, 110, INK_DARK);
      else if (part === 0 && t > 0.9) ink(out, 30, 50, 120, INK_DARK);
      else ink(out, 50 + 70 * r, 135 + 60 * r, 255, INK_SHIMMER);
      return true;
    }, { light: 0.6 + 0.4 * b.open, tilt: b.open * 3 });

    // Feelers with clubbed tips.
    const sway = 0.012 * Math.sin(pen.t * 3 + b.id);
    for (const side of [-1, 1]) {
      pen.lineBody(pose, 0.16, 0.012 * side, 0.37 + sway, (0.12 + sway) * side, pen.contrast, S > 120 ? 'o' : undefined);
    }
  },
};
