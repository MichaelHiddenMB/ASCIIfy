// Seashells and starfish lying on the beach, seen from above.
//
// Each one is a small shape drawn with the Pen, like the animals: a function that says, for
// any point (u forward, v across, in units of the shell's size), whether the shell covers it
// and what color it is there. They don't move, so they're placed once when the window changes
// size, mostly on the damp sand the waves reach and along the line of washed-up seaweed,
// where shells really end up.
import { INK_DARK, INK_SCALE, INK_SPOT, ink } from '../engine/ink.js';
import { clamp, frac, hash3, rand, TAU } from '../engine/math.js';
import { lineGlyph } from '../engine/renderer.js';

const SCALLOP = [[240, 200, 170], [232, 156, 124], [246, 226, 200], [214, 140, 170]];
const CLAM = [[236, 232, 224], [196, 176, 214], [170, 166, 160], [226, 196, 160]];
const WHELK = [[226, 204, 170], [214, 176, 132]];
const WHELK_BAND = [132, 84, 52];
const WHELK_INSIDE = [244, 192, 180];
const SAND_DOLLAR = [222, 214, 192];
const STARFISH = [[236, 120, 56], [214, 66, 60], [156, 84, 176], [214, 156, 88]];

// Which kinds turn up, and how often.
const KINDS = [['scallop', 0.28], ['clam', 0.22], ['whelk', 0.16], ['dollar', 0.12], ['starfish', 0.22]];
function pickKind() {
  let x = Math.random();
  for (const [kind, w] of KINDS) if ((x -= w) <= 0) return kind;
  return 'scallop';
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lit = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export function placeShells(shore, w, h) {
  const shells = [];
  const want = Math.round(clamp((w * h) / 100000, 6, 20));
  const scale = clamp(Math.min(w, h) / 900, 0.8, 1.25);
  let id = 70000;
  for (let tries = 0; tries < want * 40 && shells.length < want; tries++) {
    const x = rand(20, w - 20), y = rand(20, h - 20);
    const d = shore.distance(x, y);
    // Mostly on damp sand and along the seaweed line; a few further up the beach.
    const damp = d < -14 && d > -shore.runup * 2.1;
    if (d > -14 || (!damp && Math.random() > 0.05)) continue;
    if (Math.abs(x - w / 2) < 330 && Math.abs(y - (h * 0.5 - 40)) < 170) continue; // clear of the clock
    const kind = pickKind();
    const span = (kind === 'starfish' ? rand(90, 120) : kind === 'dollar' ? rand(60, 72) : rand(58, 78)) * scale;
    if (shells.some((s) => Math.hypot(s.x - x, s.y - y) < (s.span + span) * 0.7)) continue;
    const color = kind === 'scallop' ? pick(SCALLOP) : kind === 'clam' ? pick(CLAM) : kind === 'whelk' ? pick(WHELK) : kind === 'starfish' ? pick(STARFISH) : SAND_DOLLAR;
    shells.push({ x, y, kind, span, color, heading: rand(0, TAU), curl: rand(-0.6, 0.6), depth: 1, id: id++ });
  }
  return shells;
}

export function drawShells(shells, pen) {
  for (const s of shells) SAMPLERS[s.kind](s, pen);
}

const SAMPLERS = {
  // A scallop: a ribbed fan with two little "ears" at the hinge and paler growth bands.
  scallop(s, pen) {
    const out = pen.ink;
    pen.shape(s, 0.55, (u, v) => {
      const ru = u + 0.3, a = Math.atan2(v, ru), r = Math.hypot(ru, v);
      if (Math.abs(v) < 0.2 && u > -0.36 && u < -0.2) return ink(out, ...lit(s.color, 0.85), INK_SCALE, '='); // the ears
      if (Math.abs(a) > 1.15 || r > 0.66 * (1 - 0.05 * Math.abs(Math.cos(a * 7)))) return false;
      const rib = Math.abs(frac((a / Math.PI) * 7 + 0.5) - 0.5) < 0.12;
      const band = 0.9 + 0.15 * Math.sin(r * 30);
      return rib ? ink(out, ...lit(s.color, 0.72), INK_SCALE, lineGlyph(a + s.heading)) : ink(out, ...lit(s.color, band), INK_SCALE, ' ');
    }, { fog: 0 });
  },

  // A clam: an oval with rings of growth around the hinge.
  clam(s, pen) {
    const out = pen.ink;
    pen.shape(s, 0.5, (u, v) => {
      const e = (u / 0.44) ** 2 + (v / 0.34) ** 2;
      if (e > 1) return false;
      const ring = frac(Math.hypot(u + 0.32, v) * 9);
      if (e > 0.82) return ink(out, ...lit(s.color, 0.75), INK_SCALE, '.');
      return ring < 0.22 ? ink(out, ...lit(s.color, 0.8), INK_SCALE, '~') : ink(out, ...lit(s.color, 1.05), INK_SCALE, ' ');
    }, { fog: 0 });
  },

  // A whelk: a pointed spiral shell with brown bands, and the pink opening on one side.
  whelk(s, pen) {
    const out = pen.ink;
    pen.shape(s, 0.55, (u, v) => {
      if (u < -0.5 || u > 0.52) return false;
      const t = (u + 0.5) / 1.02; // 0 at the wide end, 1 at the point
      const half = 0.27 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.15)) ** 0.6 * (1 - 0.75 * t);
      if (Math.abs(v - 0.04 * (1 - t)) > half) return false;
      if (v > 0.02 && t < 0.45 && Math.abs(v - 0.1) < half * 0.5) return ink(out, ...WHELK_INSIDE, INK_SCALE, ' ');
      const band = frac(u * 5 + v * 1.6) < 0.22;
      return band ? ink(out, ...WHELK_BAND, INK_DARK, '/') : ink(out, ...lit(s.color, 1.05 - 0.3 * Math.abs(v) / (half + 0.01)), INK_SCALE, ' ');
    }, { fog: 0 });
  },

  // A sand dollar: a flat pale disc with a five-petal flower on top.
  dollar(s, pen) {
    const out = pen.ink;
    pen.shape(s, 0.52, (u, v) => {
      const r = Math.hypot(u, v);
      if (r > 0.48) return false;
      const a = Math.atan2(v, u);
      const petal = r > 0.1 && r < 0.34 && Math.abs(frac((a / TAU) * 5) - 0.5) > 0.36;
      if (petal) return ink(out, ...lit(SAND_DOLLAR, 0.74), INK_SCALE, ':');
      if (r < 0.05) return ink(out, ...lit(SAND_DOLLAR, 0.7), INK_DARK, '.');
      return ink(out, ...lit(SAND_DOLLAR, r > 0.42 ? 0.86 : 1), INK_SCALE, r > 0.42 ? '.' : ' ');
    }, { fog: 0 });
  },

  // A starfish: five tapering arms, each curling a little, covered in pale bumps.
  starfish(s, pen) {
    const out = pen.ink;
    pen.shape(s, 0.55, (u, v) => {
      const r = Math.hypot(u, v);
      if (r > 0.52) return false;
      const a = Math.atan2(v, u) - s.curl * r * r * 2; // arms bend more toward their tips
      const off = Math.abs(frac((a / TAU) * 5 + 0.5) - 0.5) * (TAU / 5); // angle from the nearest arm
      const half = 0.12 * (1 - r / 0.55) + 0.02;
      if (r > 0.14 && off * r > half) return false;
      const edge = r > 0.14 && off * r > half * 0.7;
      const bump = hash3(Math.round(u * 26), Math.round(v * 26), s.id) > 0.7;
      if (bump && !edge) return ink(out, ...lit(s.color, 1.45), INK_SPOT, '.');
      return ink(out, ...lit(s.color, edge ? 0.72 : 1), INK_SCALE, ' ');
    }, { fog: 0 });
  },
};

