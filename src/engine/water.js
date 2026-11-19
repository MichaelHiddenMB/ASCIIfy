// Water: a simulated surface that ripples, catches light, and bends what's under it.
//
// THE WAVES. The surface is stored as one height number per grid cell. Every step, each
// cell's height is pulled toward the average of its four neighbours, while also keeping
// some of the speed it was already moving at. That's a (simplified) "wave equation", and
// it's all it takes: poke a dent into the surface and it spreads out as a ring, bounces off
// the edges of the pond, and passes through other rings. A little damping each step makes
// waves fade out over a few seconds, like real ripples.
//
// THE LIGHT. To shade the water we need to know which way the surface is tilted at each
// cell (its "normal": an arrow pointing straight out of the surface). We get it from how
// much the height changes between neighbouring cells. Then:
//   - tilted toward the light = brighter, tilted away = darker (that's what makes waves visible)
//   - "specular" reflection: where the surface is tilted exactly right to bounce the light
//     straight up at you, you see a bright glint. On calm water that's a soft reflection of
//     the light; on wavy water it breaks up into glitter, like moonlight on a pond.
//   - caustics: the faint wobbly web of light you see on the bottom of shallow water
// On top of the simulated ripples there's a gentle, ever-moving "breeze" texture made from
// noise, so the water is never perfectly still.
//
// THE BENDING (refraction). Looking through a tilted surface shifts what you see beneath it.
// We store a small offset per cell, and the renderer uses it to draw underwater things
// (the koi) slightly shifted, so they wobble as ripples pass over them.
import { clamp, hash3 } from './math.js';
import { noise2 } from './noise.js';
import { lineGlyph } from './renderer.js';

const STEP = 1 / 30; // the wave simulation runs at a fixed 30 steps per second
const WAVE = 0.5; // how strongly cells pull toward their neighbours (must stay below ~0.68)
const DAMP = 0.986; // fraction of motion kept each step: lower = ripples die faster
const MAX_H = 4;

const pack = (r, g, b) => (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255);

export class Water {
  constructor({
    deep = [4, 12, 18], // color of dark, calm water
    shallow = [26, 78, 98], // color of the brightest lit water
    glint = [200, 214, 228], // color of reflected light (kept soft so it isn't glaring)
    light = { x: 0.8, y: 0.16, z: 0.8 }, // where the light is: fractions of the screen, z = height
    breeze = 0.5, // strength of the always-moving background texture
    seed = Math.floor(Math.random() * 1000),
  } = {}) {
    Object.assign(this, { deep, shallow, glint, light, breeze, seed });
    this.lightOn = true; // false = no reflected light at all, just the shading of the waves
    this.cols = 0;
    this.rows = 0;
    this.acc = 0;
  }

  resize(cols, rows, cw, ch) {
    this.cw = cw;
    this.ch = ch;
    this.aspect = cw / ch; // cells are taller than wide, which the maths must allow for
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.h = new Float32Array(n); // height now
    this.prev = new Float32Array(n); // height one step ago (together they give the speed)
    this.calm = new Float32Array(n).fill(1); // 1 = open water, lower = something floating calms it
    this.total = new Float32Array(n); // height including the breeze, for shading
    this.rgba = new Uint8ClampedArray(n * 4); // the shaded water, one pixel per cell
    this.glyph = new Uint16Array(n); // a character to draw in the cell, or 0 for none
    this.glyphColor = new Uint32Array(n);
    this.refX = new Float32Array(n); // refraction offsets in pixels
    this.refY = new Float32Array(n);
    this.solid = null; // optional: 1 for cells that are land (waves bounce off them)
    this.box = null; // optional: { c0, c1, r0, r1 }, the only part of the grid to shade
  }

  // Push a dent into the surface at (x, y) in pixels. `radius` is in cells.
  disturb(x, y, amount, radius = 1.4) {
    const { cols, rows, cw, ch, h } = this;
    if (!cols) return;
    const cx = x / cw - 0.5;
    const cy = y / ch - 0.5;
    const reach = Math.ceil(radius * 2.5);
    const ry = Math.ceil(reach * this.aspect);
    const c0 = Math.round(cx), r0 = Math.round(cy);
    for (let r = Math.max(1, r0 - ry); r <= Math.min(rows - 2, r0 + ry); r++) {
      for (let c = Math.max(1, c0 - reach); c <= Math.min(cols - 2, c0 + reach); c++) {
        const dx = c - cx;
        const dy = (r - cy) / this.aspect; // measure in cell widths so rings come out round
        const d2 = (dx * dx + dy * dy) / (radius * radius);
        if (d2 > 6) continue;
        const i = r * cols + c;
        h[i] = clamp(h[i] - amount * Math.exp(-d2), -MAX_H, MAX_H);
      }
    }
  }

  // Disturb along a line, e.g. the path the mouse moved along since last time.
  disturbLine(x0, y0, x1, y1, amount, radius) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / this.cw));
    for (let s = 1; s <= steps; s++) {
      this.disturb(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, amount, radius);
    }
  }

  // Mark a round area (in pixels) where something floating calms the waves.
  calmCircle(x, y, radius, strength) {
    const { cols, rows, cw, ch, calm } = this;
    const c0 = Math.floor((x - radius) / cw), c1 = Math.ceil((x + radius) / cw);
    const r0 = Math.floor((y - radius) / ch), r1 = Math.ceil((y + radius) / ch);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        if (Math.hypot((c + 0.5) * cw - x, (r + 0.5) * ch - y) < radius) calm[r * cols + c] = strength;
      }
    }
  }

  clearCalm() {
    this.calm.fill(1);
  }

  // Which way the simulated surface slopes at (x, y) in pixels; used to nudge floating things.
  slopeAt(x, y) {
    const { cols, rows, cw, ch, h } = this;
    const c = clamp(Math.floor(x / cw), 1, cols - 2);
    const r = clamp(Math.floor(y / ch), 1, rows - 2);
    const i = r * cols + c;
    return { x: (h[i + 1] - h[i - 1]) * 0.5, y: (h[i + cols] - h[i - cols]) * 0.5 * this.aspect };
  }

  // The average slope at five points: (x, y) and four points `radius` px around it.
  // Smoother than one point, so floating things react to whole waves, not single cells.
  slopeAround(x, y, radius) {
    let sx = 0, sy = 0;
    for (const [dx, dy] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      const s = this.slopeAt(x + dx, y + dy);
      sx += s.x;
      sy += s.y;
    }
    return { x: sx / 5, y: sy / 5 };
  }

  step(dt) {
    this.acc = Math.min(this.acc + dt, STEP * 4);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.simulate();
    }
  }

  simulate() {
    const { cols, rows, h, prev, calm, solid } = this;
    const ky = this.aspect * this.aspect;
    // The outermost ring of cells stays flat, which makes waves bounce off the pond's edge.
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        if (solid && solid[i]) {
          prev[i] = 0; // land never moves, so waves reflect off it like off a shore
          continue;
        }
        const here = h[i];
        const pull = (h[i - 1] + h[i + 1] - 2 * here) + (h[i - cols] + h[i + cols] - 2 * here) * ky;
        const speed = (here - prev[i]) * DAMP * calm[i];
        prev[i] = here + speed + WAVE * pull; // write the NEXT height into the old buffer...
      }
    }
    this.h = prev; // ...then swap, so "prev" becomes "now" and vice versa
    this.prev = h;
  }

  // Works out the color, character and refraction offset for every cell this frame.
  surface(t, width, height) {
    const { cols, rows, cw, ch, h, total, rgba, glyph, glyphColor, refX, refY, deep, shallow, glint, breeze, seed } = this;
    const aspect = this.aspect;
    // Only shade the part of the grid that has water in it (the whole grid by default).
    const { c0 = 0, c1 = cols - 1, r0 = 0, r1 = rows - 1 } = this.box || {};

    // Height including the breeze texture: two layers of slowly drifting noise.
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const b = noise2(c * 0.07 + t * 0.22, r * 0.07 / aspect - t * 0.15, seed)
          + 0.5 * noise2(c * 0.16 - t * 0.35, r * 0.16 / aspect + t * 0.1, seed + 1);
        total[i] = h[i] + b * breeze;
      }
    }

    const lx = this.light.x * width, ly = this.light.y * height, lz = this.light.z * Math.max(width, height);
    const minSide = Math.min(width, height);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const l = c > 0 ? total[i - 1] : total[i];
        const rt = c < cols - 1 ? total[i + 1] : total[i];
        const u = r > 0 ? total[i - cols] : total[i];
        const d = r < rows - 1 ? total[i + cols] : total[i];
        const gx = (rt - l) * 0.5; // slope left-to-right
        const gy = (d - u) * 0.5 * aspect; // slope top-to-bottom
        const slope = Math.hypot(gx, gy);

        // The surface normal, from the slope.
        let nx = -gx * 0.9, ny = -gy * 0.9, nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;

        // Direction from this cell to the light, and the "halfway" direction used for glints.
        const px = (c + 0.5) * cw, py = (r + 0.5) * ch;
        let Lx = lx - px, Ly = ly - py, Lz = lz;
        const Ll = Math.hypot(Lx, Ly, Lz);
        Lx /= Ll; Ly /= Ll; Lz /= Ll;
        let Hx = Lx, Hy = Ly, Hz = Lz + 1;
        const Hl = Math.hypot(Hx, Hy, Hz);
        Hx /= Hl; Hy /= Hl; Hz /= Hl;

        const diffuse = nx * Lx + ny * Ly + nz * Lz - Lz; // brighter/darker than flat water
        // The big power makes the reflection tight: only surfaces tilted almost exactly right glint.
        const spec = this.lightOn ? Math.pow(Math.max(0, nx * Hx + ny * Hy + nz * Hz), 2600) : 0;

        // Caustics: thin bright lines where two noise layers both sit near their middle value.
        const n1 = noise2(c * 0.16 + t * 0.1 + gx * 2, r * 0.16 / aspect + t * 0.06, seed + 2);
        const n2 = noise2(c * 0.12 - t * 0.08, r * 0.12 / aspect + t * 0.09 + gy * 2, seed + 3);
        const caustic = Math.pow(1 - Math.abs(n1 - 0.5) * 2, 8) * Math.pow(1 - Math.abs(n2 - 0.5) * 2, 3);

        // Darker toward the edges of the pond, as if it's deeper in the shade there.
        const edge = Math.min(px, py, width - px, height - py) / minSide;
        const vignette = 0.55 + 0.45 * clamp(edge / 0.22, 0, 1);

        let b = (0.2 + diffuse * 2.4 + caustic * 0.28 + (1 - nz) * 1.4) * vignette;
        b = clamp(b, 0, 1);
        const g = spec * 0.4;
        const R = deep[0] + (shallow[0] - deep[0]) * b + (glint[0] - deep[0]) * g;
        const G = deep[1] + (shallow[1] - deep[1]) * b + (glint[1] - deep[1]) * g;
        const B = deep[2] + (shallow[2] - deep[2]) * b + (glint[2] - deep[2]) * g;
        const o = i * 4;
        rgba[o] = R;
        rgba[o + 1] = G;
        rgba[o + 2] = B;
        rgba[o + 3] = 255;

        // Characters: glitter where light bounces at you, line marks along ripple crests,
        // and a few faint ~ on calmer water.
        if (spec > 0.5) {
          glyph[i] = (spec > 0.9 ? '+' : hash3(c, r, 9) < 0.4 ? '+' : "'").charCodeAt(0);
          const k = 0.55 + 0.45 * spec; // fainter glitter at the edges of the reflection
          glyphColor[i] = pack(glint[0] * k, glint[1] * k, glint[2] * k);
        } else if (slope > 0.12) {
          glyph[i] = lineGlyph(Math.atan2(gy, gx) + Math.PI / 2).charCodeAt(0);
          const k = clamp(slope * 2.2, 0.5, 1.4);
          glyphColor[i] = pack(R * 1.3 + 40 * k, G * 1.3 + 55 * k, B * 1.3 + 60 * k);
        } else if (slope > 0.05 && hash3(c, r, (t * 0.6) | 0) < 0.35) {
          glyph[i] = (gx > 0 ? '~' : '-').charCodeAt(0);
          glyphColor[i] = pack(R * 1.25 + 14, G * 1.25 + 22, B * 1.25 + 26);
        } else {
          glyph[i] = 0;
        }

        // Refraction: things under a tilted surface appear shifted.
        refX[i] = gx * cw * 1.6;
        refY[i] = gy * ch * 1.6;
      }
    }
  }
}
