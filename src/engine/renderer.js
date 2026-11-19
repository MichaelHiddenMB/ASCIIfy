// The renderer turns a scene into a grid of ASCII cells painted on a <canvas>.
// Adapted from ascii-animals (MIT, see licenses/ascii-animals-LICENSE.txt).
//
// Each frame it paints, in order:
//   1. the background color
//   2. the ground, if the scene has one (water.js for the pond, grass.js for the meadow):
//      a smooth shaded surface, plus characters (ripples, grass) underneath everything else
//   3. a faint grid of cell lines (painted once, then copied each frame)
//   4. the "trail": a field of energy that animals leave behind, which spreads out and
//      fades, drawn as tiny dots
//   5. the animals, through a Pen.
//
// How animals become characters: an animal is a SHAPE, a function that answers "is this
// point inside me, and what color is it?" For every cell near the animal, the renderer asks
// that question at the middle of the cell and at four more points around it (this is called
// supersampling). A cell that's mostly covered becomes SOLID: a block of color with a
// character on top. A cell only partly covered becomes a SOFT edge: just a faint character.
// That's what gives the animals smooth-looking outlines even though they're made of text.
import { INK_BODY, INK_DARK, INK_GLASS, INK_GLOW, INK_LIT, INK_SCALE, INK_SHIMMER, INK_SPOT } from './ink.js';
import { clamp, hash3 } from './math.js';

export const FONT_STACK = 'Menlo, Monaco, Consolas, "DejaVu Sans Mono", "Courier New", monospace';

const ALPHA_LEVELS = 6;

// Character sets for different materials: sparse characters on bright skin, dense ones in shadow.
const SCALE_RAMP = '.:;+=*%#';
const DARK_GLYPHS = '#%@';
const SPOT_GLYPHS = 'o*';
const BODY_GLYPHS = '8#@';
const GLOW_RAMP = '.:+*';
const EDGE_HEAVY = ':;';
const EDGE_LIGHT = ".',`";
const SPARKLES = [[255, 255, 255], [228, 246, 255], [200, 244, 255]];

const CELL_NONE = 0; // empty
const CELL_SOLID = 1; // a block of color with a character on top
const CELL_SOFT = 2; // a bare character: soft edges, lines, dots
const CELL_BACK = 3; // a ground character (water, grass): anything may cover it

// The four extra sample points inside each cell, as fractions of the cell (x, y pairs).
const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

const rgb = (r, g, b) => `rgb(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)})`;

// Squeezes a color into one number (0xRRGGBB) so a whole screen of them fits in one fast list.
const pack = (r, g, b) => (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255);

// The line character closest to an angle on screen.
export function lineGlyph(angle) {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  return a < Math.PI / 8 || a >= (7 * Math.PI) / 8 ? '-' : a < (3 * Math.PI) / 8 ? '\\' : a < (5 * Math.PI) / 8 ? '|' : '/';
}

// What animals draw with. Its methods take positions in screen pixels.
export class Pen {
  constructor(renderer) {
    this.r = renderer;
    this.t = 0;
    // While true, shapes are drawn as if seen through the water (bent by ripples).
    this.refract = false;
    // The sampler's output, reset before every sample. au/av are "body coordinates" that
    // stick to the animal, so its texture moves with it instead of sliding across it.
    this.ink = { r: 0, g: 0, b: 0, kind: 0, glyphs: null, au: 0, av: 0 };
    this._a = { x: 0, y: 0 };
    this._b = { x: 0, y: 0 };
  }

  get cw() { return this.r.cw; }
  get ch() { return this.r.ch; }
  get cols() { return this.r.cols; }
  get rows() { return this.r.rows; }

  // A color that reads well against the scene's ground (used for thin details like feelers).
  get contrast() { return this.r.palette.ink || [150, 160, 200]; }

  // Body coordinates (u forward, v across, in units of the animal's size) -> screen pixels.
  toWorld(p, u, v, out) {
    const c = Math.cos(p.heading);
    const s = Math.sin(p.heading);
    out.x = p.x + (u * c - v * s) * p.span;
    out.y = p.y + (u * s + v * c) * p.span;
    return out;
  }

  // How much something at this depth fades into the background (0 near, more when far).
  fogFor(depth) {
    return (1 - depth) * this.r.tuning.fog;
  }

  // Fill in a shape: every cell within `reach` (fraction of the pose's span) gets sampled.
  shape(pose, reach, sample, opts = {}) {
    this.r.shape(pose, reach, sample, opts);
  }

  line(x0, y0, x1, y1, color, depth, tip, fog = this.fogFor(depth)) {
    this.r.line(x0, y0, x1, y1, color, fog, tip);
  }

  lineBody(p, u0, v0, u1, v1, color, tip) {
    const a = this.toWorld(p, u0, v0, this._a);
    const b = this.toWorld(p, u1, v1, this._b);
    this.r.line(a.x, a.y, b.x, b.y, color, this.fogFor(p.depth), tip);
  }

  // A single character at (x, y). Soft dots never cover solid cells.
  dot(x, y, glyph, color, depth, fog = this.fogFor(depth)) {
    this.r.dot(x, y, glyph, color, fog);
  }

  // Exactly one solid cell, over whatever is there. Used for small features like eyes.
  spot(x, y, glyph, color, fill, depth) {
    this.r.spot(x, y, glyph, color, fill, this.fogFor(depth));
  }

  // Leave a little energy in the trail at (x, y): ripples behind a swimming fish.
  shed(x, y, amount) {
    this.r.shed(x, y, amount);
  }

  cellIndex(x, y) {
    return this.r.cellIndex(x, y);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.bg = document.createElement('canvas'); // the background color, painted once and reused
    this.gridCanvas = document.createElement('canvas'); // the cell grid lines, on a see-through canvas
    this.groundCanvas = document.createElement('canvas'); // the shaded ground, one pixel per cell
    this.ground = null;
    this.pen = new Pen(this);
    this.cw = 9;
    this.ch = 13;
    this.cols = 0;
    this.rows = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.tuning = { fog: 0.7, shimmer: 0.3, sparkle: 0.1, trail: 1, trailFade: 1, grid: 1 };
    this.palette = { background: [6, 7, 12], grid: [255, 255, 255, 0.055], trailAlpha: 0.85, trail: [110, 170, 220] };
    this.energy = new Float32Array(0);
    this.energyTmp = new Float32Array(0);
    this.cellFlag = new Uint8Array(0);
    this.cellFill = new Uint32Array(0);
    this.cellColor = new Uint32Array(0);
    this.cellGlyph = new Uint16Array(0);
    this.trailStyles = [];
  }

  // Switch to a scene's colors and settings.
  // `ground` is the surface painted under everything: water, grass, or nothing.
  use(palette, tuning, ground = null) {
    this.palette = palette;
    this.tuning = tuning;
    this.ground = ground;
    this.energy.fill(0);
    this.restyle();
  }

  restyle() {
    const { trail, trailAlpha } = this.palette;
    this.trailStyles = [];
    for (let l = 0; l < ALPHA_LEVELS; l++) {
      this.trailStyles.push(`rgba(${trail[0]},${trail[1]},${trail[2]},${((trailAlpha * (l + 1)) / ALPHA_LEVELS).toFixed(3)})`);
    }
    this.paintBackground();
  }

  // Blends a color toward the background by f (0 = the color, 1 = the background).
  fade(r, g, b, f) {
    const [br, bg, bb] = this.palette.background;
    return pack(r + (br - r) * f, g + (bg - g) * f, b + (bb - b) * f);
  }

  // Sizes everything to the window. Cells are about 1.45 times taller than wide, roughly
  // the shape of a monospace character.
  resize(width, height, dpr, cellWidth) {
    const prevCols = this.cols;
    const prevRows = this.rows;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(cellWidth), 5, 24);
    this.ch = Math.round(this.cw * 1.45);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.bg.width = this.gridCanvas.width = this.canvas.width;
    this.bg.height = this.gridCanvas.height = this.canvas.height;
    this.groundCanvas.width = this.cols;
    this.groundCanvas.height = this.rows;
    if (this.cols !== prevCols || this.rows !== prevRows) {
      const n = this.cols * this.rows;
      this.energy = new Float32Array(n);
      this.energyTmp = new Float32Array(n);
      this.cellFlag = new Uint8Array(n);
      this.cellFill = new Uint32Array(n);
      this.cellColor = new Uint32Array(n);
      this.cellGlyph = new Uint16Array(n);
    }
    this.restyle();
  }

  paintBackground() {
    const g = this.bg.getContext('2d');
    const { width: W, height: H, dpr, cw, ch } = this;
    if (!W || !H) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = rgb(...this.palette.background);
    g.fillRect(0, 0, W, H);
    // The faint grid, lined up with real screen pixels so the lines stay crisp. It's on its
    // own see-through canvas so it can go on top of the ground.
    const gl = this.gridCanvas.getContext('2d');
    gl.setTransform(1, 0, 0, 1, 0, 0);
    gl.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
    const [gr, gg, gb, ga] = this.palette.grid;
    gl.strokeStyle = `rgba(${gr},${gg},${gb},${(ga * (this.tuning.grid ?? 1)).toFixed(3)})`;
    gl.lineWidth = 1;
    gl.beginPath();
    for (let c = 0; c <= Math.ceil(W / cw); c++) {
      const x = Math.round(c * cw * dpr) + 0.5;
      gl.moveTo(x, 0);
      gl.lineTo(x, H * dpr);
    }
    for (let r = 0; r <= Math.ceil(H / ch); r++) {
      const y = Math.round(r * ch * dpr) + 0.5;
      gl.moveTo(0, y);
      gl.lineTo(W * dpr, y);
    }
    gl.stroke();
  }

  // Draws one frame. `scene` provides: time, events (ripples to add), and draw(pen).
  render(scene, dt) {
    const { ctx, dpr, cols, ch } = this;
    if (cols === 0) return;
    this.pen.t = scene.time;

    for (const e of scene.events) this.stamp(e.x, e.y, e.radius, e.amount);
    scene.events.length = 0;
    this.diffuse(dt);

    this.cellFlag.fill(CELL_NONE);
    // Only use the ground if it's sized for the current grid (it's resized just after us).
    const ground = this.ground && this.ground.cols === cols && this.ground.rows === this.rows ? this.ground : null;
    if (ground) {
      // Ground characters go in first, at the lowest priority, so everything covers them.
      ground.surface(scene.time, this.width, this.height);
      const { glyph, glyphColor } = ground;
      for (let i = 0; i < glyph.length; i++) {
        if (!glyph[i]) continue;
        this.cellFlag[i] = CELL_BACK;
        this.cellColor[i] = glyphColor[i];
        this.cellGlyph[i] = glyph[i];
      }
    }
    this.pen.refract = false;
    scene.draw(this.pen);
    this.pen.refract = false;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ground) {
      // The shaded ground is tiny (one pixel per cell); stretching it with smoothing on turns
      // it into soft gradients of light across the whole screen.
      this.groundCanvas.getContext('2d').putImageData(new ImageData(ground.rgba, this.cols, this.rows), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low'; // plain bilinear blending: smooth enough, and much cheaper without a GPU
      ctx.drawImage(this.groundCanvas, 0, 0, this.cols * this.cw, this.rows * this.ch);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.gridCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawTrail(scene.time);
    ctx.font = `600 ${Math.round(ch * 0.74)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.drawCells();
  }

  // ---- the trail (ripples) ----

  cellIndex(x, y) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  shed(x, y, amount) {
    const i = this.cellIndex(x, y);
    if (i >= 0) this.energy[i] = Math.min(1.6, this.energy[i] + amount * this.tuning.trail);
  }

  // Adds a round splash of energy: a ripple starting.
  stamp(x, y, radius, amount) {
    const field = this.energy;
    const c0 = Math.floor(x / this.cw);
    const r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const d = Math.hypot(c - c0, (r - r0) * 1.4);
        if (d > radius + 0.5) continue;
        const i = r * this.cols + c;
        field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
      }
    }
  }

  // Each cell becomes a blend of itself and its four neighbours, a little weaker each time.
  // Repeated every frame, that makes energy spread outward and fade, like a ripple.
  diffuse(dt) {
    const { cols, rows, energy, energyTmp: tmp } = this;
    const decay = Math.exp(-dt * this.tuning.trailFade);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? energy[i - 1] : energy[i];
        const rt = c < cols - 1 ? energy[i + 1] : energy[i];
        const u = r > 0 ? energy[i - cols] : energy[i];
        const d = r < rows - 1 ? energy[i + cols] : energy[i];
        tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
      }
    }
    this.energy = tmp;
    this.energyTmp = energy;
  }

  drawTrail(t) {
    const { ctx, cols, cw, ch, energy, cellFlag } = this;
    const small = Math.max(2, Math.round(cw * 0.19));
    for (let level = 0; level < ALPHA_LEVELS; level++) {
      ctx.fillStyle = this.trailStyles[level];
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i];
        if (e < 0.12 || cellFlag[i] === CELL_SOLID) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const twinkle = 0.75 + 0.25 * Math.sin(t * 5 + hash3(col, row, 3) * 40);
        if (clamp(Math.floor(e * twinkle * 4 * ALPHA_LEVELS) - 1, 0, ALPHA_LEVELS - 1) !== level) continue;
        const size = e > 0.6 ? small + 1 : small;
        ctx.fillRect(Math.round(col * cw + cw * 0.5 - size / 2), Math.round(row * ch + ch * 0.6 - size / 2), size, size);
      }
    }
  }

  // ---- drawing into cells ----

  // Runs the shape's sampler for one screen point, after converting it to body coordinates.
  probe(sample, p, hc, hs, px, py) {
    const ink = this.pen.ink;
    const dx = px - p.x;
    const dy = py - p.y;
    const u = (dx * hc + dy * hs) / p.span;
    const v = (dy * hc - dx * hs) / p.span;
    ink.glyphs = null;
    ink.au = u;
    ink.av = v;
    return sample(u, v, px, py);
  }

  shape(p, reach, sample, { light = 1, tilt = 0, fog = (1 - p.depth) * this.tuning.fog } = {}) {
    const { cellFlag, cellFill, cellColor, cellGlyph, cw, ch, cols, rows } = this;
    const ink = this.pen.ink;
    const t = this.pen.t;
    const { shimmer, sparkle } = this.tuning;
    const S = p.span;
    const hc = Math.cos(p.heading);
    const hs = Math.sin(p.heading);
    const R = reach * S;
    const c0 = Math.max(0, Math.floor((p.x - R) / cw));
    const c1 = Math.min(cols - 1, Math.floor((p.x + R) / cw));
    const r0 = Math.max(0, Math.floor((p.y - R) / ch));
    const r1 = Math.min(rows - 1, Math.floor((p.y + R) / ch));
    const g = this.ground;
    const bend = this.pen.refract && g && g.refX && g.cols === cols ? g : null;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        // Seen through the water, each cell shows what's slightly off to one side.
        const x = c * cw + (bend ? bend.refX[r * cols + c] : 0);
        const y = r * ch + (bend ? bend.refY[r * cols + c] : 0);
        const center = this.probe(sample, p, hc, hs, x + cw / 2, y + ch / 2);
        let hits = center ? 1 : 0;
        let ir = ink.r;
        let ig = ink.g;
        let ib = ink.b;
        const kind = ink.kind;
        const glyphs = ink.glyphs;
        const au = ink.au;
        const av = ink.av;
        for (let k = 0; k < SUBSAMPLES.length; k += 2) {
          if (this.probe(sample, p, hc, hs, x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch)) {
            if (hits === 0) {
              ir = ink.r;
              ig = ink.g;
              ib = ink.b;
            }
            hits++;
          }
        }
        if (hits === 0) continue;
        const coverage = hits / 5;
        const i = r * cols + c;
        const solid = center && coverage >= 0.6;
        if (!solid && cellFlag[i] === CELL_SOLID) continue;

        let k = light * (1 + (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06);
        if (solid && kind === INK_SHIMMER) {
          // Iridescence: brightness rolls across the surface as the animal moves and turns.
          k *= 1 - 0.4 * shimmer + shimmer * Math.sin(t * 2.2 + au * 9 + av * 6 + tilt + p.heading * 2);
        }
        ir *= k;
        ig *= k;
        ib *= k;
        // A key tied to the animal's body, so each character rides along with it.
        const key = (hash3(Math.round((au * S) / (cw * 0.9)), Math.round((av * S) / (cw * 0.9)), p.id) * 4294967295) >>> 0;

        if (!solid) {
          const set = coverage >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          cellFlag[i] = CELL_SOFT;
          cellColor[i] = this.fade(ir, ig, ib, Math.min(1, fog + 0.55 - 0.45 * coverage));
          cellGlyph[i] = set.charCodeAt((key >>> 8) % set.length);
          continue;
        }

        if (kind === INK_GLOW) {
          if (cellFlag[i] === CELL_SOLID) continue;
          const lum = (0.3 * ir + 0.59 * ig + 0.11 * ib) / 255;
          const set = glyphs ?? GLOW_RAMP;
          cellFlag[i] = CELL_SOFT;
          cellColor[i] = this.fade(ir, ig, ib, fog);
          cellGlyph[i] = set.charCodeAt(glyphs ? (key >>> 8) % set.length : clamp(Math.floor(lum * set.length), 0, set.length - 1));
          continue;
        }

        cellFlag[i] = CELL_SOLID;
        const roll = hash3(key, Math.floor(t * 2.4 + (key % 997) / 97), 7);
        if (kind === INK_GLASS) {
          cellFill[i] = this.fade(ir, ig, ib, Math.min(1, 0.62 + fog * 0.38));
          const set = glyphs ?? SCALE_RAMP;
          cellColor[i] = this.fade(ir, ig, ib, fog);
          cellGlyph[i] = set.charCodeAt((key >>> 8) % set.length);
          if (roll < sparkle) cellColor[i] = pack(...SPARKLES[key % SPARKLES.length]);
          continue;
        }
        if (kind === INK_LIT) {
          cellFill[i] = this.fade(ir * 0.58, ig * 0.58, ib * 0.58, fog);
          const set = glyphs ?? '.:*';
          cellColor[i] = roll < sparkle
            ? pack(...SPARKLES[key % SPARKLES.length])
            : this.fade(Math.min(255, ir * 1.05 + 50), Math.min(255, ig * 1.05 + 50), Math.min(255, ib * 1.05 + 50), fog);
          cellGlyph[i] = set.charCodeAt((key >>> 8) % set.length);
          continue;
        }
        const fill = this.fade(ir, ig, ib, fog);
        cellFill[i] = fill;
        const fr = fill >>> 16;
        const fg = (fill >>> 8) & 255;
        const fb = fill & 255;
        let set, gr, gg, gb;
        if (kind === INK_BODY) {
          set = glyphs ?? BODY_GLYPHS;
          [gr, gg, gb] = [fr * 1.6 + 44, fg * 1.6 + 40, fb * 1.6 + 36];
        } else if (kind === INK_DARK) {
          set = glyphs ?? DARK_GLYPHS;
          [gr, gg, gb] = [fr * 1.7 + 34, fg * 1.7 + 30, fb * 1.7 + 30];
        } else if (kind === INK_SPOT) {
          set = glyphs ?? SPOT_GLYPHS;
          [gr, gg, gb] = [fr * 0.4, fg * 0.4, fb * 0.4];
        } else {
          set = glyphs ?? SCALE_RAMP;
          [gr, gg, gb] = [fr * 0.42, fg * 0.42, fb * 0.42];
        }
        let glyph;
        if (glyphs || (kind !== INK_SCALE && kind !== INK_SHIMMER)) {
          glyph = set.charCodeAt((key >>> 8) % set.length);
        } else {
          const lum = (0.3 * fr + 0.59 * fg + 0.11 * fb) / 255;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = set.charCodeAt(clamp(Math.floor((1 - lum) * (set.length - 0.01)) + jitter, 0, set.length - 1));
        }
        cellGlyph[i] = glyph;
        const glints = kind === INK_SHIMMER ? sparkle : kind === INK_SCALE ? sparkle / 3 : 0;
        cellColor[i] = roll < glints ? pack(...SPARKLES[key % SPARKLES.length]) : pack(gr, gg, gb);
      }
    }
  }

  line(x0, y0, x1, y1, color, fog, tip) {
    const { cellFlag, cellColor, cellGlyph, cw } = this;
    const packed = this.fade(color[0], color[1], color[2], fog);
    const glyph = lineGlyph(Math.atan2(y1 - y0, x1 - x0)).charCodeAt(0);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cw * 0.5)));
    let last = -1;
    for (let s = 1; s <= steps; s++) {
      const i = this.cellIndex(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
      if (i < 0 || cellFlag[i] === CELL_SOLID) continue;
      cellFlag[i] = CELL_SOFT;
      cellColor[i] = packed;
      cellGlyph[i] = glyph;
      last = i;
    }
    if (tip && last >= 0) cellGlyph[last] = tip.charCodeAt(0);
  }

  dot(x, y, glyph, color, fog) {
    const i = this.cellIndex(x, y);
    if (i < 0 || this.cellFlag[i] === CELL_SOLID) return;
    this.cellFlag[i] = CELL_SOFT;
    this.cellColor[i] = this.fade(color[0], color[1], color[2], fog);
    this.cellGlyph[i] = glyph.charCodeAt(0);
  }

  spot(x, y, glyph, color, fill, fog) {
    const g = this.ground;
    if (this.pen.refract && g && g.refX && g.cols === this.cols) {
      // Move the spot the opposite way to how shapes are sampled, so it stays on the body.
      const j = this.cellIndex(x, y);
      if (j >= 0) {
        x -= g.refX[j];
        y -= g.refY[j];
      }
    }
    const i = this.cellIndex(x, y);
    if (i < 0) return;
    this.cellFlag[i] = CELL_SOLID;
    this.cellFill[i] = this.fade(fill[0], fill[1], fill[2], fog);
    this.cellColor[i] = this.fade(color[0], color[1], color[2], fog);
    this.cellGlyph[i] = glyph.charCodeAt(0);
  }

  drawCells() {
    const { ctx, cols, rows, cw, ch, cellFlag, cellFill, cellColor, cellGlyph } = this;
    const n = cols * rows;

    // Ground characters (water, grass) can fill half the screen, so they're drawn grouped by
    // color: setting the color once per group is much faster than once per character.
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      if (cellFlag[i] !== CELL_BACK) continue;
      const g = cellColor[i];
      let list = groups.get(g);
      if (!list) groups.set(g, (list = []));
      list.push(i);
    }
    for (const [g, list] of groups) {
      ctx.fillStyle = rgb(g >>> 16, (g >>> 8) & 255, g & 255);
      for (const i of list) ctx.fillText(String.fromCharCode(cellGlyph[i]), (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
    }

    for (let i = 0; i < n; i++) {
      const flag = cellFlag[i];
      if (!flag || flag === CELL_BACK) continue;
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      if (flag === CELL_SOLID) {
        const f = cellFill[i];
        ctx.fillStyle = rgb(f >>> 16, (f >>> 8) & 255, f & 255);
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      }
      const g = cellColor[i];
      ctx.fillStyle = rgb(g >>> 16, (g >>> 8) & 255, g & 255);
      ctx.fillText(String.fromCharCode(cellGlyph[i]), x + cw / 2, y + ch / 2 + 1);
    }
  }
}
