// Sunset lighting, shared by the scenes that have a sunset (the meadow and the beach).
//
// It's a "grade" (see renderer.js): for every cell, how much to multiply its red, green and
// blue (a warm tint that gets darker and more purple further from the sun), and how much to
// brighten it toward white (the sun's glow, strongest near the sun). It's worked out once per
// window size and kept, since it doesn't change from frame to frame.
//
// `sunX` and `sunY` say where the sun is, as fractions of the screen's width and height (it can
// be just off screen, like a sun low on the horizon). `tint` is the warm color everything is
// multiplied by: the meadow's is strong; the beach uses a gentler one so the sea stays blue.
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WARM = [1, 178 / 255, 132 / 255];
const NEAR = [1, 1, 1], MID = [220 / 255, 190 / 255, 200 / 255], DUSK = [120 / 255, 96 / 255, 140 / 255];

export function makeSunsetGrade(sunX, sunY, tint = WARM) {
  let cache = null;
  return function grade(cols, rows, W, H) {
    if (cache && cache.cols === cols && cache.rows === rows) return cache;
    const n = cols * rows;
    const mul = new Float32Array(n * 3), add = new Float32Array(n * 3);
    const far = Math.hypot(W, H);
    const sx = sunX * W, sy = sunY * H;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = ((c + 0.5) / cols) * W, y = ((r + 0.5) / rows) * H;
        const d = Math.hypot(x - sx, y - sy) / far;
        const t = Math.min(1, d / 1.05);
        const shade = t < 0.55 ? lerp3(NEAR, MID, t / 0.55) : lerp3(MID, DUSK, (t - 0.55) / 0.45);
        // The glow: strong orange near the sun, fading out by 70% of the way across.
        const s = Math.min(1, d / 0.7);
        const glow = s < 0.4 ? 0.5 + (0.16 - 0.5) * (s / 0.4) : 0.16 * (1 - (s - 0.4) / 0.6);
        const glowColor = s < 0.4 ? [255, 150, 70] : [255, 120, 60];
        for (let k = 0; k < 3; k++) {
          mul[i * 3 + k] = tint[k] * shade[k];
          add[i * 3 + k] = (glow * glowColor[k]) / 255;
        }
      }
    }
    cache = { cols, rows, mul, add };
    return cache;
  };
}
