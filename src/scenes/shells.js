// Seashells and starfish lying on the beach, seen from above.
//
// Each one is a small shape drawn with the Pen, like the animals: a function that says, for
// any point (u forward, v across, in units of the shell's size), whether the shell covers it
// and what color it is there. Each kind is built around the one feature that makes it
// recognisable at a glance, and every shell has a dark outline so it stands out from the sand:
//   - scallop: a fan of bold ribs with a wavy ("scalloped") edge and two little "ears"
//   - moon snail: a round shell with a spiral winding in to the middle, and its opening
//   - conch: a pointed spire with ridges, knobs on its shoulder and a big pink flared lip
//   - sand dollar: a pale disc with a five-petal flower drawn in dotted lines
//   - starfish: five tapering arms that curl a little, covered in pale bumps
// They're placed once when the window changes size, mostly on the damp sand the waves reach
// and along the line of washed-up seaweed, where shells really end up.
//
// WHEN A WAVE RUNS OVER ONE:
//   - It's covered. Each point of the shell that the water has reached is tinted toward the
//     color of the water there (more where the water is deeper), and where the foam is thick,
//     the foam hides that part of the shell completely, so the frothy edge of the wave is
//     seen washing across it.
//   - It sways. The shore says how fast the water's edge is moving, which is which way the
//     water is flowing: up the beach as a wave rushes in, back down as it drains. A shell
//     under water is dragged by that flow, wobbles in the swirl and rocks a little, while a
//     spring (the grip of the sand) pulls it back to where it was lying. Light shells move
//     most; starfish cling on and barely slide, but their arms curl and wave.
import { INK_DARK, INK_SCALE, INK_SPOT, ink } from '../engine/ink.js';
import { clamp, frac, hash3, rand, TAU } from '../engine/math.js';
import { noise1 } from '../engine/noise.js';
import { lineGlyph } from '../engine/renderer.js';

const SCALLOP = [[242, 150, 108], [236, 116, 118], [248, 244, 236], [206, 146, 216]];
const SNAIL = [[246, 236, 220], [238, 182, 132], [196, 202, 222]];
const SNAIL_SPIRAL = [126, 92, 70];
const SNAIL_INSIDE = [98, 66, 56];
const CONCH = [[240, 218, 176], [236, 200, 160]];
const CONCH_BAND = [170, 108, 66];
const CONCH_LIP = [252, 150, 150];
const DOLLAR = [[240, 232, 210], [232, 224, 214]];
const DOLLAR_LINE = [112, 90, 66];
const STARFISH = [[240, 120, 52], [222, 62, 58], [162, 84, 186], [226, 160, 84]];

// Which kinds turn up, and how often.
const KINDS = [['scallop', 0.27], ['snail', 0.2], ['conch', 0.14], ['dollar', 0.14], ['starfish', 0.25]];
const COLORS = { scallop: SCALLOP, snail: SNAIL, conch: CONCH, dollar: DOLLAR, starfish: STARFISH };
// How easily the moving water shifts each kind (starfish cling on).
const LOOSE = { scallop: 1, snail: 0.8, conch: 0.5, dollar: 1, starfish: 0.3 };
const SIZES = { scallop: [92, 110], snail: [100, 118], conch: [124, 144], dollar: [100, 114], starfish: [104, 128] };
function pickKind() {
  let x = Math.random();
  for (const [kind, w] of KINDS) if ((x -= w) <= 0) return kind;
  return 'scallop';
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lit = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

let nextId = 70000;
// One shell of the given kind (a random kind if none), at (x, y).
export function makeShell(x, y, kind = pickKind(), scale = 1, heading = rand(0, TAU)) {
  const [lo, hi] = SIZES[kind];
  return {
    x, y, kind, span: rand(lo, hi) * scale, color: pick(COLORS[kind]), heading, curl: rand(-0.6, 0.6), depth: 1, id: nextId++,
    ox: 0, oy: 0, rot: 0, vx: 0, vy: 0, vr: 0, // how far the water has pushed and turned it, and how fast
    wet: 0, // how much of it is under water (smoothed), 0 to 1
    spin: Math.random() < 0.5 ? -1 : 1, // which way the flow tends to turn it
  };
}

// Moves the shells with the water washing over them (see the note at the top).
export function stepShells(shells, shore, t, dt) {
  for (const s of shells) {
    const covered = clamp((s.x + s.ox - shore.waterline(s.y)) / (s.span * 0.5) + 0.5, 0, 1);
    s.wet += (covered - s.wet) * Math.min(1, dt * 6);
    const loose = LOOSE[s.kind];
    const flow = shore.flowAt(s.y) * s.wet;
    const swirl = (noise1(t * 2.5 + s.id * 3.1) - 0.5) * 90 * s.wet;
    s.vx += (flow * 2.2 * loose - s.ox * 9 - s.vx * 4) * dt;
    s.vy += (swirl * loose - s.oy * 9 - s.vy * 4) * dt;
    s.vr += ((Math.abs(flow) * 0.02 + Math.abs(swirl) * 0.004) * s.spin * loose - s.rot * 7 - s.vr * 3) * dt;
    s.ox = clamp(s.ox + s.vx * dt, -s.span * 0.15, s.span * 0.15);
    s.oy = clamp(s.oy + s.vy * dt, -s.span * 0.1, s.span * 0.1);
    s.rot = clamp(s.rot + s.vr * dt, -0.4, 0.4);
  }
}

export function placeShells(shore, w, h) {
  const shells = [];
  const beach = (w - shore.seaWidth) * h; // roughly how much sand there is
  const want = Math.round(clamp(beach / 32000, 4, 12));
  const scale = clamp(Math.min(w, h) / 900, 0.8, 1.2);
  const R = shore.runup;
  for (let tries = 0; tries < want * 60 && shells.length < want; tries++) {
    const s = makeShell(0, rand(40, h - 40), pickKind(), scale);
    // About half where the waves reach, most of the rest on the damp sand and along the
    // seaweed line, and a few further up the beach. Never so close that it's always wet.
    const zone = Math.random();
    const nearest = s.span * 0.45 + 6;
    const d = zone < 0.5 ? -rand(nearest, Math.max(nearest + 10, R * 1.05)) : zone < 0.9 ? -rand(R * 1.05, R * 2.1) : -rand(R * 2.1, R * 4);
    const y = s.y;
    const x = s.x = -shore.distance(0, y) + d; // the average waterline on this row, plus d
    if (x < s.span * 0.5) continue;
    if (Math.abs(x - w / 2) < 330 && Math.abs(y - (h * 0.5 - 40)) < 170) continue; // clear of the clock
    if (shells.some((o) => Math.hypot(o.x - x, o.y - y) < (o.span + s.span) * 0.72)) continue;
    shells.push(s);
  }
  return shells;
}

export function drawShells(shells, pen, shore = null) {
  for (const s of shells) drawShell(s, pen, shore);
}

export function drawShell(s, pen, shore = null) {
  const out = pen.ink;
  const pose = { x: s.x + s.ox, y: s.y + s.oy, heading: s.heading + s.rot, span: s.span, depth: 1, id: s.id };
  // Starfish arms wave about while the water is over them.
  s.curlNow = s.curl + 0.45 * s.wet * Math.sin(pen.t * 3.2 + s.id);
  const [reach, inner] = SAMPLERS[s.kind]({ ...s, heading: pose.heading, curl: s.curlNow }, out);
  let sampler = inner;
  if (shore && s.wet > 0.001 && shore.cols === pen.cols) {
    // Under the water: tinted by it, and hidden where the foam is thick.
    const { baseline, edge, rgba, foam, cols } = shore;
    sampler = (u, v, px, py) => {
      if (!inner(u, v, px, py)) return false;
      const i = pen.cellIndex(px, py);
      if (i < 0) return true;
      const r = (i / cols) | 0;
      const under = px - baseline[r] - edge[r]; // how far past the water's edge this point is
      if (under <= 0) return true;
      if (foam[i] > 0.5) return false;
      const m = Math.min(0.85, 0.25 + 0.35 * Math.min(1, under / 40) + 0.5 * foam[i]);
      const o = i * 4;
      out.r += (rgba[o] - out.r) * m;
      out.g += (rgba[o + 1] - out.g) * m;
      out.b += (rgba[o + 2] - out.b) * m;
      return true;
    };
  }
  pen.shape(pose, reach, sampler, { fog: 0 });
}

// Each sampler factory returns [how far the shape reaches, the sampler].
const SAMPLERS = {
  // A scallop: a fan of ribs spreading from the hinge, each rib bulging at the edge.
  scallop(s, out) {
    const base = s.color, rib = lit(base, 0.7), rim = lit(base, 0.45), ear = lit(base, 0.8);
    const RIBS = 9, SPREAD = 1.2;
    return [0.8, (u, v) => {
      // The ears: a little bar across the hinge.
      if (u > -0.46 && u < -0.32 && Math.abs(v) < 0.22 - (u + 0.46) * 0.4) return ink(out, ...ear, INK_SCALE, '=');
      const ru = u + 0.36, r = Math.hypot(ru, v), a = Math.atan2(v, ru);
      if (Math.abs(a) > SPREAD) return false;
      const rp = frac(((a + SPREAD) / (2 * SPREAD)) * RIBS); // where across its rib this point is
      const R = 0.74 - 0.06 * (1 - Math.sin(rp * Math.PI)); // each rib bulges at the edge
      if (r > R) return false;
      if (r > R - 0.08) return ink(out, ...rim, INK_SCALE, ' '); // the outline
      if (rp < 0.45) return ink(out, ...rib, INK_SCALE, lineGlyph(a + s.heading)); // the ribs
      const k = 0.94 + 0.1 * Math.cos(r * 30); // faint growth rings
      return ink(out, ...lit(base, k), INK_SCALE, ' ');
    }];
  },

  // A moon snail: round, with a spiral groove winding in to a dark middle, and its opening.
  snail(s, out) {
    const base = s.color, rim = lit(base, 0.5);
    return [0.48, (u, v) => {
      const r = Math.hypot(u / 0.42, v / 0.38);
      if (r > 1) return false;
      if (r > 0.88) return ink(out, ...rim, INK_SCALE, ' ');
      const a = Math.atan2(v, u);
      // The opening: a crescent on one side, dark inside, with a pale lip.
      if (a > -0.2 && a < 1.7 && r > 0.56) return r < 0.76 ? ink(out, ...SNAIL_INSIDE, INK_DARK, ' ') : ink(out, 252, 246, 238, INK_SCALE, ' ');
      if (r < 0.18) return ink(out, ...SNAIL_SPIRAL, INK_DARK, '@');
      // The spiral: one groove winding outward as it goes round.
      if (frac(r * 1.7 - a / TAU) < 0.34) return ink(out, ...SNAIL_SPIRAL, INK_DARK, lineGlyph(a + Math.PI / 2 + s.heading));
      const k = 1.05 - 0.2 * r - 0.12 * Math.sin(a + 0.8); // lit from one side
      return ink(out, ...lit(base, k), INK_SCALE, ' ');
    }];
  },

  // A conch: a ridged, pointed spire, a knobbly shoulder, a striped body and a flared pink lip.
  conch(s, out) {
    const base = s.color, rim = lit(base, 0.5);
    return [0.66, (u, v) => {
      if (u < -0.6 || u > 0.5) return false;
      let w;
      if (u < -0.18) w = 0.22 * ((u + 0.6) / 0.42) ** 1.25; // the spire, coming to a sharp point
      else if (u < 0.02) w = 0.24;
      else w = 0.24 * Math.max(0, 1 - (u / 0.5) ** 1.6) ** 0.7 + 0.03; // narrowing to the front
      const av = Math.abs(v);
      // The flared lip on one side, pink and glossy.
      const lip = u > -0.16 && u < 0.44 ? w + 0.26 * Math.sin((Math.PI * (u + 0.16)) / 0.6) ** 0.7 : w;
      if (v > w && v < lip) return v > lip - 0.05 ? ink(out, 255, 214, 204, INK_SCALE, ' ') : ink(out, ...CONCH_LIP, INK_SCALE, ' ');
      // Knobs sticking out along the shoulder.
      const kp = frac((u + 0.24) / 0.055);
      const knob = u > -0.24 && u < -0.02 && kp > 0.3 && kp < 0.75 && (v < 0 || u < -0.14);
      if (av > w) return knob && av < w + 0.07 ? ink(out, ...lit(base, 1.1), INK_SCALE, '^') : false;
      if (av > w - 0.05) return ink(out, ...rim, INK_SCALE, ' ');
      if (u < -0.18) return frac((u + 0.6) * 9 + v * 3) < 0.45 ? ink(out, ...CONCH_BAND, INK_DARK, lineGlyph(s.heading + Math.PI / 2 - 0.5)) : ink(out, ...lit(base, 0.92), INK_SCALE, ' '); // the spire's twisting turns
      if (u >= -0.18 && frac(u * 4 + 0.1 * Math.sin(v * 50)) < 0.18) return ink(out, ...CONCH_BAND, INK_SCALE, '~'); // zigzag stripes
      return ink(out, ...lit(base, 1.04 - 0.3 * (av / w)), INK_SCALE, ' ');
    }];
  },

  // A sand dollar: a flat pale disc with a dark five-petal flower on it.
  dollar(s, out) {
    const base = s.color, rim = lit(base, 0.58);
    return [0.5, (u, v) => {
      const r = Math.hypot(u, v) / 0.46;
      if (r > 1) return false;
      if (r > 0.88) return ink(out, ...rim, INK_SCALE, ' ');
      if (r < 0.08) return ink(out, ...DOLLAR_LINE, INK_DARK, '*');
      const a = Math.atan2(v, u);
      const off = Math.abs(frac((a / TAU) * 5 + 0.5) - 0.5) * (TAU / 5); // angle from the nearest petal
      if (r > 0.12 && r < 0.72) {
        const half = 0.44 * Math.sin((Math.PI * (r - 0.12)) / 0.6) ** 0.6;
        if (off < half) return ink(out, ...DOLLAR_LINE, INK_DARK, ':'); // a petal, dotted like the real ones
      }
      return ink(out, ...lit(base, 1.02 - 0.12 * r), INK_SCALE, ' ');
    }];
  },

  // A starfish: five tapering arms, each curling a little, covered in pale bumps.
  starfish(s, out) {
    const rim = lit(s.color, 0.55);
    return [0.55, (u, v) => {
      const r = Math.hypot(u, v);
      if (r > 0.52) return false;
      const a = Math.atan2(v, u) - s.curl * r * r * 2; // arms bend more toward their tips
      const off = Math.abs(frac((a / TAU) * 5 + 0.5) - 0.5) * (TAU / 5); // angle from the nearest arm
      const half = 0.12 * (1 - r / 0.55) + 0.02;
      if (r > 0.14 && off * r > half) return false;
      const edge = r > 0.14 && off * r > half * 0.68;
      if (edge) return ink(out, ...rim, INK_SCALE, ' ');
      if (hash3(Math.round(u * 26), Math.round(v * 26), s.id) > 0.7) return ink(out, ...lit(s.color, 1.45), INK_SPOT, '.');
      return ink(out, ...s.color, INK_SCALE, ' ');
    }];
  },
};
