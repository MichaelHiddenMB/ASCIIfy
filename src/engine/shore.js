// Shore: the ground of the beach scene, seen from above. Sand on the left, the sea on the
// right, and waves rolling in and washing up the beach. It plays the same role as water.js
// (the pond) and grass.js (the meadow): every frame it works out a color and a character for
// every cell.
//
// THE SHORELINE. For each row of cells there's a "baseline": where the water's edge sits on
// average. It wobbles gently down the screen so the beach curves like a real one. Every cell
// knows its distance `d` from that line, in pixels: negative on the sand, positive out to sea.
//
// THE WAVES are not simulated like the pond's ripples; they follow a recipe, like a dance
// with fixed steps that repeats every `period` seconds:
//   1. Swell. Out at sea, each wave is a long bright crest with a dark trough in front of it,
//      rolling toward the beach. It grows taller as the water gets shallow.
//   2. Breaking. Close to shore, the crest topples over: it turns into a line of white foam,
//      with foam spilling out behind it.
//   3. Swash. The broken wave rushes up the sand as a thin sheet of water with a bright foamy
//      edge, slows, and slides back down (the backwash), leaving the sand dark and wet.
// Each row runs the recipe a little out of step with its neighbours, and each wave has its
// own strength, so the waves come in at a slant and some reach further up the beach than
// others. Wet sand dries slowly, so the high-water mark of the last big wave lingers.
//
// THE MOUSE still makes ripples on the sea: those come from a real wave simulation (water.js),
// which also bends what's underwater (refraction) as ripples and swells pass over it.
import { clamp, hash3, smoothstep } from './math.js';
import { fbm1, fbm2, noise1, noise2 } from './noise.js';
import { lineGlyph } from './renderer.js';
import { Water } from './water.js';

const SAND = [176, 150, 108];
const SAND_PALE = [196, 174, 132];
const SAND_DARK = [146, 120, 84];
const WET = [116, 102, 80]; // freshly soaked sand
const DAMP = [154, 130, 94]; // sand the waves reach now and then
const WRACK = [74, 76, 42]; // dried seaweed along the high-water line
const SHELL_BITS = [224, 214, 192];
const PEBBLE = [128, 120, 110];
const SHALLOW = [64, 178, 172]; // the sea, from the beach outward
const MID = [26, 122, 150];
const DEEP = [12, 56, 104];
const FOAM = [236, 244, 242];
const GLITTER = [250, 252, 240];
const GRAINS = ['.', ',', '`', "'", '.', ':'];

// The reef (if the scene gives the shore one, see scenes/reef.js) marks cells that sway with
// the water, so their characters are picked fresh every frame.
export const REEF_STILL = 1, REEF_GRASS = 2, REEF_ANEMONE = 3;

const q = (v) => clamp(Math.round(v / 10) * 10, 0, 250);
const pack = (r, g, b) => (q(r) << 16) | (q(g) << 8) | q(b);
const mixInto = (out, a, b, t) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

export class Shore {
  constructor({ seed = Math.floor(Math.random() * 1000), period = 7.5 } = {}) {
    this.seed = seed;
    this.period = period; // seconds between waves
    this.water = new Water({ breeze: 0, seed });
    this.cols = 0;
    this.rows = 0;
    this.lastT = 0;
    this.amp = new Float32Array(6); // scratch: the strengths of the next few waves on one row
  }

  resize(cols, rows, cw, ch) {
    this.cw = cw;
    this.ch = ch;
    this.aspect = cw / ch;
    this.water.resize(cols, rows, cw, ch);
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    const W = cols * cw, H = rows * ch;
    const { seed } = this;
    this.width = W;
    this.height = H;
    this.rgba = new Uint8ClampedArray(n * 4);
    this.glyph = new Uint16Array(n);
    this.glyphColor = new Uint32Array(n);
    this.refX = new Float32Array(n);
    this.refY = new Float32Array(n);
    this.dist = new Float32Array(n);
    this.sand = new Float32Array(n * 3); // each cell's dry sand color
    this.grain = new Uint16Array(n); // each cell's sand character (0 for none)
    this.grainColor = new Uint32Array(n);
    this.baseline = new Float32Array(rows); // x of the average waterline on each row
    this.offset = new Float32Array(rows); // how far out of step each row's waves are
    this.edge = new Float32Array(rows); // where the water's edge is right now (as a d)
    this.wet = new Float32Array(rows); // how far up the sand is still wet (as a d)

    // The beach curves gently: a long bend plus small wobbles.
    const a = hash3(seed, 1, 1) * 6.28, b = hash3(seed, 2, 1) * 6.28;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * ch;
      this.baseline[r] = W * 0.42 + W * 0.035 * Math.sin((y / H) * Math.PI * 1.4 + a) + 40 * (fbm1(y / 170, 2, seed) - 0.5);
      this.offset[r] = 0.14 * Math.sin((y / H) * Math.PI * 1.1 + b) + 0.08 * (noise1(y / 110, seed + 3) - 0.5);
    }
    this.runup = clamp(W * 0.05, 40, 90); // how far an average wave runs up the sand, px
    this.seaWidth = W - this.baseline.reduce((m, x) => Math.min(m, x), W);
    this.wavelength = clamp(this.seaWidth * 0.36, 200, 340); // distance between crests, px
    this.breakAt = clamp(this.wavelength * 0.32, 60, 110); // waves break this close to shore
    this.wet.fill(-this.runup);

    // The sand: patches of paler and darker sand, wind ripples on the dry part, a line of
    // seaweed and broken shells where the highest waves reach, and grains everywhere.
    const solid = this.water.solid = new Uint8Array(n);
    const wrackAt = -this.runup * 1.75;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (c + 0.5) * cw, y = (r + 0.5) * ch;
        const d = x - this.baseline[r];
        this.dist[i] = d;
        if (d < 0) solid[i] = 1; // the pond simulation treats the beach as a wall
        const yc = r / this.aspect;
        const patch = fbm2(c * 0.04, yc * 0.04, 3, seed + 4);
        const tone = patch < 0.5 ? mixInto([0, 0, 0], SAND_DARK, SAND, patch * 2) : mixInto([0, 0, 0], SAND, SAND_PALE, (patch - 0.5) * 2);
        const k = 0.96 + hash3(c, r, seed + 5) * 0.08;
        this.sand[i * 3] = tone[0] * k;
        this.sand[i * 3 + 1] = tone[1] * k;
        this.sand[i * 3 + 2] = tone[2] * k;

        const h = hash3(c, r, seed + 6);
        // The wrack line: a ragged band, thicker in places.
        const wrack = Math.abs(d - wrackAt - 30 * (noise1(y / 60, seed + 8) - 0.5)) < 6 + 12 * noise1(y / 40, seed + 9);
        // Wind ripples: wavy lines across the dry sand, bent by noise.
        const ripple = Math.sin((x * 0.8 + y * 0.45) / 11 + fbm2(c * 0.05, yc * 0.05, 2, seed + 10) * 9);
        let glyph = '', color = null;
        if (d < 0 && wrack && h < 0.55) {
          [glyph, color] = h < 0.3 ? [h < 0.12 ? '%' : '~', WRACK] : h < 0.42 ? [',', SHELL_BITS] : ['&', WRACK];
        } else if (h > 0.994) {
          [glyph, color] = ['o', PEBBLE];
        } else if (d < wrackAt - 20 && ripple > 0.9 && h < 0.75) {
          [glyph, color] = ['~', [tone[0] * 0.8, tone[1] * 0.78, tone[2] * 0.74]];
        } else if (h < 0.2) {
          const lighter = hash3(c, r, seed + 7) < 0.5;
          [glyph, color] = [GRAINS[Math.floor(h * 30) % GRAINS.length], lighter ? [tone[0] * 1.14, tone[1] * 1.14, tone[2] * 1.12] : [tone[0] * 0.8, tone[1] * 0.78, tone[2] * 0.75]];
        }
        this.grain[i] = glyph ? glyph.charCodeAt(0) : 0;
        this.grainColor[i] = color ? pack(...color) : 0;
      }
    }
  }

  // Where the water's edge is right now on the row at y, in screen pixels (x).
  waterline(y) {
    const r = clamp(Math.floor(y / this.ch), 0, this.rows - 1);
    return this.baseline[r] + this.edge[r];
  }

  // How far (x, y) is from the average waterline: negative on the sand, positive at sea.
  distance(x, y) {
    const r = clamp(Math.floor(y / this.ch), 0, this.rows - 1);
    return x - this.baseline[r];
  }

  step(dt) {
    this.water.step(dt);
  }

  surface(t, width, height) {
    const { cols, rows, cw, ch, aspect, seed, dist, sand, grain, grainColor, rgba, glyph, glyphColor, refX, refY, amp, edge, wet } = this;
    const { h } = this.water;
    const T = this.period, L = this.wavelength, B = this.breakAt;
    const dt = clamp(t - this.lastT, 0, 0.25);
    this.lastT = t;
    const col = [0, 0, 0], tmp = [0, 0, 0];
    const seaW = this.seaWidth;

    for (let r = 0; r < rows; r++) {
      // Where this row is in the wave recipe: wave number k, and how far through it (p).
      const tau = t / T + this.offset[r];
      const k = Math.floor(tau);
      const p = tau - k;
      // Strengths of the wave that just broke (amp[0]) and the ones on their way in.
      for (let j = 0; j < amp.length; j++) amp[j] = 0.55 + 0.75 * noise2((k + j) * 0.73, r * 0.02, seed + 11);
      const R = this.runup * amp[0];
      // The swash: the edge rushes up the sand fast, then slides back slowly, a little past
      // the baseline, until the next wave arrives.
      const back = 10, rise = 0.24;
      let e;
      if (p < rise) e = back - (R + back) * (1 - (1 - p / rise) ** 2);
      else if (p < 0.9) e = -R + (R + back) * smoothstep(0, 1, (p - rise) / (0.9 - rise));
      else e = back;
      edge[r] = e;
      // Wet sand: as far as the water has reached, drying back slowly.
      wet[r] = Math.min(wet[r] + dt * 5, e);
      const wetTop = wet[r];
      // How strong the foam left behind by the last wave still is.
      const fresh = Math.exp(-p * 2.4) * amp[0];

      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const o = i * 4;
        const d = dist[i];

        if (d <= e) {
          // ---- sand ----
          const s = i * 3;
          // Soaked sand fades in over a few cells (not a hard line), wettest by the water.
          const soaked = smoothstep(wetTop - 8, wetTop + 26, d) * (0.6 + 0.4 * smoothstep(wetTop, e, d));
          const damp = smoothstep(-this.runup * 1.6, -this.runup * 0.2, d) * 0.35;
          const w = Math.max(soaked, damp);
          col[0] = sand[s]; col[1] = sand[s + 1]; col[2] = sand[s + 2];
          if (damp > 0) mixInto(col, col, DAMP, damp);
          if (soaked > 0) mixInto(col, col, WET, soaked);
          rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
          refX[i] = 0;
          refY[i] = 0;
          if (soaked > 0.75 && hash3(c, r, (t * 0.8) | 0) < 0.04) {
            // Freshly wet sand is glossy: the odd glint of sky in it.
            glyph[i] = 39; // '
            glyphColor[i] = pack(col[0] * 1.5 + 40, col[1] * 1.5 + 50, col[2] * 1.5 + 60);
          } else if (grain[i] && w < 0.6) {
            glyph[i] = grain[i];
            const g = grainColor[i];
            const dk = 1 - w * 0.4;
            glyphColor[i] = pack((g >>> 16) * dk, ((g >>> 8) & 255) * dk, (g & 255) * dk);
          } else {
            glyph[i] = 0;
          }
          continue;
        }

        // ---- water ----
        const dd = Math.max(0, d);
        const f = Math.pow(clamp(dd / (seaW * 0.85), 0, 1), 0.7);
        if (f < 0.4) mixInto(col, SHALLOW, MID, f / 0.4);
        else mixInto(col, MID, DEEP, (f - 0.4) / 0.6);

        // The swell: a smooth, rounded crest every `L` pixels. `qq` is how far this cell is
        // behind the nearest crest on its shore side (0 at that crest, 1 at the next one out).
        // The strength switches from one wave to the next halfway between crests, in the flat
        // trough, so there's never a visible seam.
        const sv = dd / L + p;
        const n = Math.floor(sv);
        const qq = sv - n;
        const shoal = 0.3 + 0.7 * smoothstep(L * 1.8, L * 0.2, dd);
        const wave = Math.min(amp.length - 1, qq < 0.5 ? n : n + 1);
        const ampHere = amp[wave] * shoal;
        const bump = 0.5 + 0.5 * Math.cos(qq * Math.PI * 2);
        const height = bump ** 4;
        // Its slope (how fast the height changes going out to sea), for shading and bending.
        const swellSlope = (-4 * bump ** 3 * 0.5 * Math.sin(qq * Math.PI * 2) * Math.PI * 2 * ampHere) / L;

        // Foam. A crest that's close to shore breaks: foam spills behind it, and a bright lip
        // runs along its front.
        let foam = 0;
        const crestBehind = dd - qq * L; // the crest on this cell's shore side
        if (n >= 1 && crestBehind >= 0) {
          const breaking = smoothstep(B, B * 0.3, crestBehind) * amp[Math.min(amp.length - 1, n)];
          foam = breaking * Math.exp(-(qq * L) / (14 + 46 * breaking));
        }
        const crestAhead = dd + (1 - qq) * L;
        const breakingAhead = smoothstep(B, B * 0.3, crestAhead) * amp[Math.min(amp.length - 1, n + 1)];
        foam = Math.max(foam, breakingAhead * smoothstep(16, 0, (1 - qq) * L));
        // The foam the last wave left, in lacy patches, thinning out as the wave runs out.
        const lace = 0.65 * noise2(c * 0.3 + t * 0.05, r * 0.3 / aspect - t * 0.03, seed + 12) + 0.35 * noise2(c * 0.7, r * 0.7 / aspect + t * 0.08, seed + 16);
        const surf = smoothstep(B * 1.4, 0, dd) * fresh;
        foam = Math.max(foam, surf * 0.8 * smoothstep(0.5, 0.72, lace + surf * 0.15));
        // The swash's leading edge: a bright band where the water meets the sand.
        const fromEdge = d - e;
        if (fromEdge < 14) foam = Math.max(foam, (1 - fromEdge / 14) * (0.5 + 0.5 * amp[0]) * (p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45 * 0.6));

        // Ripples from the simulation (the mouse, splashes), for shading and bending.
        const gx = (h[i + 1 < h.length ? i + 1 : i] - h[i > 0 ? i - 1 : i]) * 0.5 + swellSlope * cw;
        const gy = (h[i + cols < h.length ? i + cols : i] - h[i >= cols ? i - cols : i]) * 0.5 * aspect;
        const ripple = Math.hypot(gx - swellSlope * cw, gy);

        // The reef on the sea floor, seen through the water: shifted a little where the
        // surface tilts (so it wobbles as waves pass), and hazier the deeper it is.
        let reefGlyph = 0, haze = 0, rj = 0;
        const reef = this.reef;
        if (reef) {
          const rc = clamp(c + Math.round(gx * 1.6), 0, cols - 1);
          const rr = clamp(r + Math.round(gy * 1.6), 0, rows - 1);
          rj = rr * cols + rc;
          const cover = reef.cover[rj];
          if (cover > 0) {
            haze = 0.12 + 0.62 * f;
            const vis = cover * (1 - haze);
            col[0] += (reef.color[rj * 3] - col[0]) * vis;
            col[1] += (reef.color[rj * 3 + 1] - col[1]) * vis;
            col[2] += (reef.color[rj * 3 + 2] - col[2]) * vis;
            const kind = reef.kind[rj];
            if (kind === REEF_GRASS) reefGlyph = lineGlyph(Math.PI / 2 + 0.55 * Math.sin(t * 1.3 + rc * 0.35 + rr * 0.12) + swellSlope * 25).charCodeAt(0);
            else if (kind === REEF_ANEMONE) reefGlyph = lineGlyph(reef.angle[rj] + 0.5 * Math.sin(t * 2.1 + reef.angle[rj] * 3 + rc)).charCodeAt(0);
            else reefGlyph = reef.glyph[rj];
          }
        }

        // Light: crests brighter, the faces in front of them darker, a slow shimmer, and in
        // the shallows a web of light (caustics) on the bottom.
        let bright = 0.94 + 0.12 * height * ampHere - gx * 0.6 - gy * 0.4;
        bright += (noise2(c * 0.06 + t * 0.15, r * 0.06 / aspect - t * 0.1, seed + 13) - 0.5) * 0.12;
        const n1 = noise2(c * 0.16 + t * 0.12, r * 0.16 / aspect + t * 0.07, seed + 14);
        const n2 = noise2(c * 0.12 - t * 0.09, r * 0.12 / aspect + t * 0.1, seed + 15);
        const caustic = Math.pow(1 - Math.abs(n1 - 0.5) * 2, 8) * Math.pow(1 - Math.abs(n2 - 0.5) * 2, 3);
        bright += caustic * 0.35 * (1 - f) ** 2;
        col[0] *= bright; col[1] *= bright; col[2] *= bright;

        // Water only a few pixels deep, running over the sand, lets the sand show through.
        // It thickens gradually away from the edge, so there's no hard line.
        if (d - e < 60) {
          const s = i * 3;
          tmp[0] = sand[s]; tmp[1] = sand[s + 1]; tmp[2] = sand[s + 2];
          mixInto(tmp, tmp, WET, 0.85);
          mixInto(col, tmp, col, 0.2 + 0.8 * smoothstep(0, 60, d - e));
        }
        if (foam > 0) mixInto(col, col, FOAM, Math.min(0.95, foam));
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;

        // Refraction: things underwater appear shifted where the surface tilts.
        refX[i] = gx * cw * 1.6;
        refY[i] = gy * ch * 1.6;

        // Characters, most important first.
        if (foam > 0.3) {
          const hh = hash3(c, r, (t * 3) | 0);
          glyph[i] = (foam > 0.75 ? (hh < 0.5 ? '*' : '%') : foam > 0.5 ? (hh < 0.5 ? '~' : ':') : hh < 0.5 ? '.' : "'").charCodeAt(0);
          glyphColor[i] = foam > 0.6 ? pack(255, 255, 255) : pack(col[0] * 1.1 + 30, col[1] * 1.1 + 30, col[2] * 1.1 + 30);
        } else if (ripple > 0.12) {
          glyph[i] = lineGlyph(Math.atan2(gy, gx - swellSlope * cw) + Math.PI / 2).charCodeAt(0);
          glyphColor[i] = pack(col[0] * 1.3 + 40, col[1] * 1.3 + 50, col[2] * 1.3 + 50);
        } else if (reefGlyph) {
          const g = reef.glyphColor, k3 = rj * 3, m = haze * 0.85;
          glyphColor[i] = pack(g[k3] + (col[0] - g[k3]) * m, g[k3 + 1] + (col[1] - g[k3 + 1]) * m, g[k3 + 2] + (col[2] - g[k3 + 2]) * m);
          glyph[i] = reefGlyph;
        } else if (height > 0.6 && ampHere > 0.45 && hash3(c, r, n + k) < 0.55) {
          glyph[i] = (hash3(c, r, 5) < 0.6 ? '~' : '-').charCodeAt(0); // the crest line
          glyphColor[i] = pack(col[0] * 1.25 + 30, col[1] * 1.25 + 34, col[2] * 1.2 + 34);
        } else if (dd > 60 && hash3(c, r, (t * 2.5) | 0) < 0.0015 * (0.4 + f)) {
          glyph[i] = (hash3(c, r, 3) < 0.15 ? '+' : "'").charCodeAt(0); // sun glitter
          glyphColor[i] = pack(...GLITTER);
        } else if (f > 0.1 && hash3(c, r, (t * 0.5) | 0) < 0.04) {
          glyph[i] = (gx > 0 ? '~' : '-').charCodeAt(0);
          glyphColor[i] = pack(col[0] * 1.2 + 14, col[1] * 1.2 + 22, col[2] * 1.2 + 26);
        } else {
          glyph[i] = 0;
        }
      }
    }
  }
}
