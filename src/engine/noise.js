// "Noise" is smooth randomness. Plain random numbers jump around like TV static, but noise
// drifts gradually from one value to the next, which is what hills, clouds and wind look like.
// All functions here return numbers between 0 and 1.

// hash() turns whole-number coordinates into a repeatable "random" number: the same inputs
// always give the same output, so a hill or a patch of grass stays put between frames.
export function hash(x, y = 0, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t); // eases in and out so the blend has no sharp corners
const lerp = (a, b, t) => a + (b - a) * t; // "linear interpolation": blend from a to b by t (0..1)

// Value noise: pick a random value at every whole number, then blend smoothly between them.
export function noise1(x, seed = 0) {
  const xi = Math.floor(x);
  return lerp(hash(xi, 0, seed), hash(xi + 1, 0, seed), fade(x - xi));
}

export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const top = lerp(hash(xi, yi, seed), hash(xi + 1, yi, seed), u);
  const bottom = lerp(hash(xi, yi + 1, seed), hash(xi + 1, yi + 1, seed), u);
  return lerp(top, bottom, v);
}

// "Fractal" noise stacks several layers of noise, each finer and fainter than the last:
// big shapes from the first layer, small bumps from the later ones (like a mountain range).
export function fbm1(x, octaves = 3, seed = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(x * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function fbm2(x, y, octaves = 3, seed = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
