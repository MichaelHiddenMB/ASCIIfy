// Grass: the ground of the meadow, seen from above. It plays the same role as water.js does
// for the pond: every frame it works out a shaded color and a character for every cell.
//
// WHAT'S IN IT.
//   - Patches: slow noise decides where the grass is lush, darker, or dry and yellowish, so
//     the field isn't one flat green.
//   - Tufts: most cells get a small mark (" ' , . ;) like the tips of grass blades.
//   - Wildflowers: drifts of tiny flowers in the grass. Each drift is mostly one color,
//     because real wildflowers grow in patches of the same kind.
//
// WIND. Gusts are bands of noise sliding across the field in the wind's direction. Where a
// gust passes, the blades bend over and show their lighter sides, which makes waves of
// light roll across the meadow, like a real field on a windy day.
//
// THE MOUSE, and anything else that pushes the grass, adds to a "bend" stored per cell: an
// arrow saying which way and how far the blades there are pushed over. Each step the bend
// shrinks a little, so the grass springs back up after a moment. Strongly bent cells show a
// line character that points the way the blades are lying.
//
// SHADOWS. The scene hands us a list of shadows (one per flying insect), and we darken the
// grass under each one.
import { clamp, hash3, smoothstep } from './math.js';
import { fbm2, noise2 } from './noise.js';
import { lineGlyph } from './renderer.js';

// A slightly deep, muted green, so the insects (especially the green dragonflies) stand out.
const DARK = [18, 46, 24];
const LUSH = [46, 92, 40];
const DRY = [112, 106, 54];
const SHEEN = [124, 158, 96]; // the lighter color of bent-over blades
const TUFTS = ['"', "'", ',', '.', '`', ';', '"', ','];
// Wildflower colors: daisy white, buttercup yellow, clover purple, campion pink.
const BLOOMS = [[236, 236, 220], [244, 212, 70], [178, 132, 222], [236, 140, 182]];
const BLOOM_GLYPHS = ['*', '+', 'o', '*'];

// Ground characters are drawn in batches of the same color (see renderer.drawCells), so
// colors are rounded to steps of 10 to keep the number of different colors small.
const q = (v) => clamp(Math.round(v / 10) * 10, 0, 250);
const pack = (r, g, b) => (q(r) << 16) | (q(g) << 8) | q(b);

export class Grass {
  constructor({ seed = Math.floor(Math.random() * 1000), flowers = 1 } = {}) {
    this.seed = seed;
    this.flowerAmount = flowers;
    this.cols = 0;
    this.rows = 0;
    this.shadows = []; // { x, y, radius, strength } in pixels, set by the scene each frame
  }

  resize(cols, rows, cw, ch) {
    this.cw = cw;
    this.ch = ch;
    this.aspect = cw / ch;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.bx = new Float32Array(n); // how far the blades are pushed over, sideways...
    this.by = new Float32Array(n); // ...and up/down
    this.windX = new Float32Array(n); // total bend including the wind, from the last frame
    this.windY = new Float32Array(n);
    this.shade = new Float32Array(n); // shadow darkness this frame
    this.rgba = new Uint8ClampedArray(n * 4);
    this.glyph = new Uint16Array(n);
    this.glyphColor = new Uint32Array(n);
    this.lush = new Float32Array(n);
    this.dry = new Float32Array(n);
    this.tuft = new Uint16Array(n);
    this.bloom = new Uint16Array(n);
    this.bloomColor = new Uint32Array(n);

    // Decide once what grows where.
    const { seed } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const y = r / this.aspect; // measure in cell widths so patches come out round
        this.lush[i] = fbm2(c * 0.035, y * 0.035, 3, seed);
        this.dry[i] = smoothstep(0.6, 0.78, fbm2(c * 0.02 + 40, y * 0.02, 2, seed + 5));
        this.tuft[i] = hash3(c, r, seed) < 0.55 ? TUFTS[Math.floor(hash3(c, r, seed + 1) * TUFTS.length)].charCodeAt(0) : 0;
      }
    }
    this.scatterBlooms();
  }

  // Sprinkles the tiny wildflowers, in drifts. `flowerAmount` scales how many.
  scatterBlooms() {
    const { cols, rows, seed } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const y = r / this.aspect;
        const drift = noise2(c * 0.06, y * 0.06, seed + 9);
        const chance = smoothstep(0.62, 0.86, drift) * 0.12 * this.flowerAmount;
        if (hash3(c, r, seed + 3) >= chance) {
          this.bloom[i] = 0;
          continue;
        }
        const kind = Math.floor(noise2(c * 0.03, y * 0.03, seed + 11) * BLOOMS.length * 0.999);
        const [R, G, B] = BLOOMS[kind];
        this.bloom[i] = BLOOM_GLYPHS[kind].charCodeAt(0);
        this.bloomColor[i] = pack(R, G, B);
      }
    }
  }

  setFlowers(amount) {
    this.flowerAmount = amount;
    if (this.cols) this.scatterBlooms();
  }

  // Pushes the blades around (x, y) in pixels toward (dirX, dirY), fading with distance.
  // `radius` is in cells.
  push(x, y, dirX, dirY, amount, radius = 3) {
    const { cols, rows, cw, ch, bx, by } = this;
    if (!cols) return;
    const cx = x / cw - 0.5;
    const cy = y / ch - 0.5;
    const ry = Math.ceil(radius * this.aspect) + 1;
    const c0 = Math.round(cx), r0 = Math.round(cy);
    for (let r = Math.max(0, r0 - ry); r <= Math.min(rows - 1, r0 + ry); r++) {
      for (let c = Math.max(0, c0 - radius - 1); c <= Math.min(cols - 1, c0 + radius + 1); c++) {
        const dx = c - cx;
        const dy = (r - cy) / this.aspect;
        const d = Math.hypot(dx, dy) / radius;
        if (d >= 1) continue;
        const i = r * cols + c;
        const f = amount * (1 - d * d);
        // Mostly the way the push is going, plus a little outward, like grass parting.
        const out = d > 0.01 ? 0.5 : 0;
        bx[i] = clamp(bx[i] + (dirX + (dx / (d * radius || 1)) * out) * f, -1.2, 1.2);
        by[i] = clamp(by[i] + (dirY + (dy / (d * radius || 1)) * out) * f, -1.2, 1.2);
      }
    }
  }

  // Brushes the grass along a path, like running a hand through it (the mouse).
  brush(x0, y0, x1, y1, amount, radius = 3) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) return;
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
    const steps = Math.max(1, Math.ceil(len / this.cw));
    for (let s = 1; s <= steps; s++) {
      this.push(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, dx, dy, amount, radius);
    }
  }

  // A puff of air pushing the grass outward from (x, y), like something landing hard.
  puff(x, y, amount, radius = 7) {
    const { cols, rows, cw, ch, bx, by } = this;
    const cx = x / cw - 0.5, cy = y / ch - 0.5;
    const ry = Math.ceil(radius * this.aspect) + 1;
    for (let r = Math.max(0, Math.round(cy) - ry); r <= Math.min(rows - 1, Math.round(cy) + ry); r++) {
      for (let c = Math.max(0, Math.round(cx) - radius); c <= Math.min(cols - 1, Math.round(cx) + radius); c++) {
        const dx = c - cx, dy = (r - cy) / this.aspect;
        const d = Math.hypot(dx, dy);
        if (d >= radius || d < 0.01) continue;
        const f = amount * (1 - d / radius);
        bx[r * cols + c] = clamp(bx[r * cols + c] + (dx / d) * f, -1.2, 1.2);
        by[r * cols + c] = clamp(by[r * cols + c] + (dy / d) * f, -1.2, 1.2);
      }
    }
  }

  // How the grass at (x, y) is leaning right now (wind included), e.g. to sway a flower.
  bendAt(x, y) {
    const c = clamp(Math.floor(x / this.cw), 0, this.cols - 1);
    const r = clamp(Math.floor(y / this.ch), 0, this.rows - 1);
    const i = r * this.cols + c;
    return { x: this.windX[i] || 0, y: this.windY[i] || 0 };
  }

  step(dt) {
    const k = Math.exp(-dt * 1.8); // springing back: lose a bit of the bend every step
    const { bx, by } = this;
    for (let i = 0; i < bx.length; i++) {
      bx[i] *= k;
      by[i] *= k;
    }
  }

  surface(t, width, height) {
    const { cols, rows, cw, ch, aspect, seed, bx, by, windX, windY, shade, rgba, glyph, glyphColor, lush, dry, tuft, bloom, bloomColor } = this;

    // Shadows: darkest in the middle, fading out to the edge.
    shade.fill(0);
    for (const s of this.shadows) {
      const c0 = Math.floor((s.x - s.radius) / cw), c1 = Math.ceil((s.x + s.radius) / cw);
      const r0 = Math.floor((s.y - s.radius) / ch), r1 = Math.ceil((s.y + s.radius) / ch);
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
          const d = Math.hypot((c + 0.5) * cw - s.x, (r + 0.5) * ch - s.y) / s.radius;
          if (d >= 1) continue;
          const i = r * cols + c;
          shade[i] = Math.max(shade[i], s.strength * (1 - d * d));
        }
      }
    }

    // The wind slowly changes direction over time.
    const wa = 0.35 + 0.45 * Math.sin(t * 0.03);
    const wx = Math.cos(wa), wy = Math.sin(wa);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const y = r / aspect;
        // Position along and across the wind, so gust bands line up with it.
        const along = c * wx + y * wy;
        const across = -c * wy + y * wx;
        const gust = smoothstep(0.55, 0.82, noise2(along * 0.045 - t * 0.55, across * 0.07, seed + 20));
        const sway = 0.08 + 0.32 * gust; // the wind bends blades a little; pushes bend them more
        const Bx = bx[i] + wx * sway;
        const By = by[i] + wy * sway;
        windX[i] = Bx;
        windY[i] = By;
        const bend = Math.hypot(Bx, By);

        // Base color from the patches, then brighter where blades are bent over.
        const l = lush[i], d = dry[i] * 0.8;
        let R = DARK[0] + (LUSH[0] - DARK[0]) * l, G = DARK[1] + (LUSH[1] - DARK[1]) * l, B = DARK[2] + (LUSH[2] - DARK[2]) * l;
        R += (DRY[0] - R) * d; G += (DRY[1] - G) * d; B += (DRY[2] - B) * d;
        const bright = (0.85 + 0.3 * l + (hash3(c, r, seed + 2) - 0.5) * 0.08) * (1 - shade[i]);
        const sheen = Math.min(0.5, bend * 0.6);
        R = (R + (SHEEN[0] - R) * sheen) * bright;
        G = (G + (SHEEN[1] - G) * sheen) * bright;
        B = (B + (SHEEN[2] - B) * sheen) * bright;
        const o = i * 4;
        rgba[o] = R;
        rgba[o + 1] = G;
        rgba[o + 2] = B;
        rgba[o + 3] = 255;

        if (bloom[i] && bend < 0.8) {
          // A wildflower, unless the grass is pushed right over it.
          const f = bloomColor[i];
          const k = 1 - shade[i];
          glyph[i] = bloom[i];
          glyphColor[i] = pack((f >>> 16) * k, ((f >>> 8) & 255) * k, (f & 255) * k);
        } else if (bend > 0.6) {
          // Blades pushed over: a line pointing the way they're lying.
          glyph[i] = lineGlyph(Math.atan2(By, Bx)).charCodeAt(0);
          glyphColor[i] = pack(R * 1.5 + 30, G * 1.5 + 34, B * 1.4 + 20);
        } else if (tuft[i]) {
          glyph[i] = tuft[i];
          glyphColor[i] = pack(R * 1.45 + 16, G * 1.45 + 20, B * 1.35 + 10);
        } else {
          glyph[i] = 0;
        }
      }
    }
  }
}
