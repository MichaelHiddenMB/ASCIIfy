// Small math helpers used everywhere.
// Adapted from ascii-animals (MIT, see licenses/ascii-animals-LICENSE.txt).
export const TAU = Math.PI * 2; // a full circle, in radians

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const frac = (x) => x - Math.floor(x);
export const lerp = (a, b, t) => a + (b - a) * t; // blend from a to b by t (0..1)

// Eases from 0 to 1 as x goes from e0 to e1, with soft ends instead of sharp corners.
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// The shortest turn from angle a to angle b, between -PI and PI.
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Turns three whole numbers into a repeatable "random" number between 0 and 1.
// The same inputs always give the same output, so textures stay put between frames.
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
