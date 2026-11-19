// GroundMix: a pond sitting inside a field of grass.
//
// It combines two grounds, land (grass.js) and water (water.js), using a "shape" function
// that says how far any point is from the middle of the pond: below 1 is water, a thin band
// just outside 1 is the muddy, pebbly shore, and beyond that is grass. Every cell is sorted
// into one of those three once (when the window size changes); then each frame it copies the
// color and character for each cell from whichever ground it belongs to.
//
// The water is told which cells are land (water.solid), so ripples bounce off the shore
// instead of spreading into the grass. It's also told the box around the pond (water.box), so
// it only spends time shading the part of the screen where there's actually water.
import { clamp, hash3, smoothstep } from './math.js';
import { AIR } from './grass.js';

const GRASS = 0, SHORE = 1, WATER = 2;
const SHORE_WIDTH = 0.07; // how wide the shore band is, in the shape function's units
const MUD = [78, 64, 42];
const WET_MUD = [48, 42, 30];
const PEBBLE = [138, 130, 116];
const REED = [84, 128, 56];
const SHALLOWS = [54, 86, 70]; // the water's color right at the edge, where it's shallow

const q = (v) => clamp(Math.round(v / 10) * 10, 0, 250);
const pack = (r, g, b) => (q(r) << 16) | (q(g) << 8) | q(b);

export class GroundMix {
  constructor(land, water, shape) {
    this.land = land;
    this.water = water;
    this.shape = shape; // (x, y) in pixels -> distance from the pond's middle (1 = its edge)
    this.cols = 0;
    this.rows = 0;
  }

  resize(cols, rows, cw, ch) {
    const { land, water } = this;
    land.resize(cols, rows, cw, ch);
    water.resize(cols, rows, cw, ch);
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.kind = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.rgba = new Uint8ClampedArray(n * 4);
    this.glyph = new Uint16Array(n);
    this.glyphColor = new Uint32Array(n);
    // Refraction offsets come straight from the water, so koi under it wobble.
    this.refX = water.refX;
    this.refY = water.refY;

    water.solid = new Uint8Array(n);
    let c0 = cols, c1 = 0, r0 = rows, r1 = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const d = this.shape((c + 0.5) * cw, (r + 0.5) * ch);
        this.dist[i] = d;
        this.kind[i] = d < 1 ? WATER : d < 1 + SHORE_WIDTH ? SHORE : GRASS;
        if (this.kind[i] !== WATER) water.solid[i] = 1;
        else {
          c0 = Math.min(c0, c); c1 = Math.max(c1, c);
          r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        }
      }
    }
    water.box = c0 <= c1 ? { c0: Math.max(0, c0 - 2), c1: Math.min(cols - 1, c1 + 2), r0: Math.max(0, r0 - 2), r1: Math.min(rows - 1, r1 + 2) } : { c0: 0, c1: -1, r0: 0, r1: -1 };
  }

  // Blends the pale glow of moving air into one pixel of the ground image.
  addGlow(o, amount) {
    const g = Math.min(0.32, amount);
    if (g <= 0.01) return;
    const { rgba } = this;
    rgba[o] += (AIR[0] - rgba[o]) * g;
    rgba[o + 1] += (AIR[1] - rgba[o + 1]) * g;
    rgba[o + 2] += (AIR[2] - rgba[o + 2]) * g;
  }

  step(dt) {
    this.land.step(dt);
    this.water.step(dt);
  }

  surface(t, width, height) {
    const { land, water, kind, dist, rgba, glyph, glyphColor, cols } = this;
    land.surface(t, width, height);
    water.surface(t, width, height);
    const shade = land.shade; // insect shadows fall on the water and shore too
    const air = land.air; // and the wind's glow shows over them
    for (let i = 0; i < kind.length; i++) {
      const o = i * 4;
      const k = kind[i];
      if (k === GRASS) {
        rgba[o] = land.rgba[o]; rgba[o + 1] = land.rgba[o + 1]; rgba[o + 2] = land.rgba[o + 2]; rgba[o + 3] = 255;
        glyph[i] = land.glyph[i];
        glyphColor[i] = land.glyphColor[i];
        continue;
      }
      const dark = 1 - shade[i] * 0.8;
      if (k === WATER) {
        // Paler and greener right at the edge, where the water is shallow.
        const s = smoothstep(0.84, 1, dist[i]) * 0.55;
        rgba[o] = (water.rgba[o] + (SHALLOWS[0] - water.rgba[o]) * s) * dark;
        rgba[o + 1] = (water.rgba[o + 1] + (SHALLOWS[1] - water.rgba[o + 1]) * s) * dark;
        rgba[o + 2] = (water.rgba[o + 2] + (SHALLOWS[2] - water.rgba[o + 2]) * s) * dark;
        rgba[o + 3] = 255;
        this.addGlow(o, air[i]);
        glyph[i] = water.glyph[i];
        glyphColor[i] = water.glyphColor[i];
        continue;
      }
      // The shore: wet, dark mud by the water, drier further out, with pebbles and a few reeds.
      const c = i % cols, r = (i / cols) | 0;
      const wet = 1 - (dist[i] - 1) / SHORE_WIDTH;
      const h = hash3(c, r, 77);
      const R = (MUD[0] + (WET_MUD[0] - MUD[0]) * wet) * dark;
      const G = (MUD[1] + (WET_MUD[1] - MUD[1]) * wet) * dark;
      const B = (MUD[2] + (WET_MUD[2] - MUD[2]) * wet) * dark;
      rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
      this.addGlow(o, air[i]);
      if (h < 0.18) {
        glyph[i] = (h < 0.07 ? 'o' : '.').charCodeAt(0);
        glyphColor[i] = pack(PEBBLE[0] * dark, PEBBLE[1] * dark, PEBBLE[2] * dark);
      } else if (h > 0.9 && wet < 0.6) {
        glyph[i] = (h > 0.95 ? '|' : "'").charCodeAt(0);
        glyphColor[i] = pack(REED[0] * dark, REED[1] * dark, REED[2] * dark);
      } else if (h > 0.6) {
        glyph[i] = ','.charCodeAt(0);
        glyphColor[i] = pack(R * 1.5 + 14, G * 1.5 + 12, B * 1.4 + 8);
      } else {
        glyph[i] = 0;
      }
    }
  }
}
