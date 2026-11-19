// The previews record.mjs makes, one per README animation.
// What to record. Coordinates are in the scene's own pixels. act(scene, t, w, h) runs before
// every world step, so it can move the "mouse" or click.
const swipe = (from, to, t0, t1, wobble = 30) => (scene, t, w, h) => {
  if (t < t0 || t > t1) return;
  const k = (t - t0) / (t1 - t0);
  const e = k * k * (3 - 2 * k);
  scene.pointer?.(w * (from[0] + (to[0] - from[0]) * e), h * (from[1] + (to[1] - from[1]) * e) + Math.sin(k * Math.PI * 2) * wobble);
};
const tapAt = (x, y, at) => (scene, t, w, h) => { if (Math.abs(t - at) < 0.016) scene.tap(w * x, h * y); };
const all = (...fns) => (...a) => fns.forEach((f) => f(...a));

// "ASCIIfy" written in ASCII cells: the word is drawn in a bold font onto a tiny canvas with one
// pixel per cell, and every covered pixel becomes a character on the real canvas.
function title(canvas, r, text, sub) {
  const { cw, ch, cols, rows, dpr } = r;
  const m = document.createElement('canvas');
  m.width = cols; m.height = rows;
  const g = m.getContext('2d');
  const size = Math.round(rows * 0.5);
  g.font = `900 ${size}px "Arial Black", Helvetica, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.scale(1, cw / ch * 1.5); // cells are taller than wide: stretch so letters keep their shape
  g.fillStyle = '#fff';
  const cy = (rows * 0.44) / (cw / ch * 1.5);
  g.fillText(text, cols / 2, cy);
  const px = g.getImageData(0, 0, cols, rows).data;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.font = `bold ${Math.round(cw * 1.35)}px Menlo, Monaco, monospace`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const ramp = '.:+*#@';
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = px[(y * cols + x) * 4 + 3] / 255;
    if (a < 0.2) continue;
    c.fillStyle = `rgba(4,12,18,${0.55 * a})`;
    c.fillRect(x * cw, y * ch, cw, ch);
    c.fillStyle = `rgba(236,${226 + 20 * a | 0},${200 + 40 * a | 0},${0.35 + 0.65 * a})`;
    c.fillText(ramp[Math.min(ramp.length - 1, a * ramp.length | 0)], x * cw + cw / 2, y * ch + ch / 2 + 1);
  }
  if (sub) {
    c.font = `${Math.round(cw * 1.6)}px Menlo, Monaco, monospace`;
    const y = Math.round(rows * 0.8) * ch + ch / 2;
    const wpx = c.measureText(sub).width + cw * 3;
    c.fillStyle = 'rgba(4,12,18,0.7)';
    c.fillRect(r.width / 2 - wpx / 2, y - ch, wpx, ch * 2);
    c.fillStyle = 'rgba(200,230,240,0.9)';
    c.fillText(sub, r.width / 2, y + 1);
  }
  return canvas;
}

const T = { w: 720, h: 405, cell: 7, frames: 105 };
export const JOBS = [
  { name: 'banner', scene: 'koi-pond', w: 1200, h: 330, cell: 7, frames: 120, seed: 11,
    act: all(tapAt(0.12, 0.5, 2.5), tapAt(0.88, 0.35, 5.5)),
    post: (c, r) => title(c, r, 'ASCIIfy', 'your new tab, as a living ASCII scene') },
  { name: 'koi-pond', scene: 'koi-pond', ...T, seed: 3,
    act: all(swipe([0.05, 0.75], [0.95, 0.3], 0.6, 1.8), tapAt(0.5, 0.5, 3.2)) },
  { name: 'meadow', scene: 'meadow', ...T, seed: 5, act: swipe([0.95, 0.2], [0.3, 0.6], 1.2, 2.2, 40) },
  { name: 'meadow-sunset', scene: 'meadow', options: { sunset: true }, ...T, seed: 9 },
  { name: 'beach', scene: 'beach', ...T, seed: 4, act: swipe([0.45, 0.85], [0.95, 0.2], 1.5, 2.6) },
  { name: 'beach-sunset', scene: 'beach', options: { sunset: true }, ...T, seed: 8 },
];
