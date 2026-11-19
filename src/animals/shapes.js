// Small geometry helpers for building animal outlines out of simple pieces.
// Adapted from ascii-animals by drewdi and Stephen Zhang (MIT, see
// licenses/ascii-animals-LICENSE.txt).
import { clamp, hash3 } from '../engine/math.js';

// Scratch output of toSegment(): how far along the segment (0 to 1) the nearest point is.
export const seg = { t: 0 };

// Distance from (px, py) to the line segment from a to b.
export function toSegment(px, py, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const t = clamp(((px - ax) * sx + (py - ay) * sy) / (sx * sx + sy * sy || 1), 0, 1);
  seg.t = t;
  return Math.hypot(px - ax - sx * t, py - ay - sy * t);
}

// Is (u, v) inside the ellipse centred on (cu, cv), with half-widths a (along u) and b (along v)?
export function inEllipse(u, v, cu, cv, a, b) {
  const x = (u - cu) / a;
  const y = (v - cv) / b;
  return x * x + y * y <= 1;
}

// Round spots scattered on a jittered grid of `cell`-sized squares. The seed gives each animal
// its own pattern.
export function spotted(u, v, cell, radius, seed) {
  const gu = u / cell;
  const gv = v / cell;
  const cu = Math.floor(gu);
  const cv = Math.floor(gv);
  const jx = 0.25 + 0.5 * hash3(cu, cv, seed);
  const jy = 0.25 + 0.5 * hash3(cu, cv, seed + 11);
  const r = (radius / cell) * (0.6 + 0.6 * hash3(cu, cv, seed + 23));
  return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < r * r;
}
