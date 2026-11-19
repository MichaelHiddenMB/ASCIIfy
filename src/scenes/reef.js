// The reef: coral, sea fans, sponges, anemones, rocks and seagrass on the sea floor of the
// beach scene, seen from above through the water.
//
// The reef doesn't move, so it's worked out once (whenever the window changes size) and stored
// as a "mosaic": for every cell, a color, a character, and how much of the cell it covers.
// It has two layers:
//   - SOLID: the coral itself (heads, fans, sponges, rocks, anemones). These become crisp
//     blocks with a character, like the animals. Every frame drawReef() blends each block
//     toward the color of the water above it (so foam, swells and the haze of deeper water
//     show on it too) and shifts it a little where the surface tilts, so it wobbles.
//   - WASH: faint things (seagrass, rubble, the shadowy gaps between branches). These are
//     mixed into the soft ground by the shore (shore.js), under the water.
// Only two things on the reef sway with the water (seagrass and anemone tentacles), so those
// cells are marked with a `kind`, and their characters are picked fresh every frame.
//
// The reef grows as a few separate PATCH REEFS: rough ovals of coral out beyond the surf, with
// open sand and water between them, the way real reefs look from above. That leaves most of
// the sea clear, so the animals can be seen. Each patch is packed with "heads" (single coral
// colonies, each a different type), and meadows of seagrass grow in the sandy shallows.
//
// KEEPING IT CALM. The coral is scenery, not the star: it's faded well into the color of the
// water above it, a little greyer than its true color, and most of its cells have no
// character on them (the few that do are only a little darker than the block), so the bright,
// busy animals swimming over it stand out.
// Each type has its own little painter that works out, for a cell at (dx, dy) pixels from the
// head's middle, what's there.
import { clamp, frac, hash3, rand, smoothstep, TAU } from '../engine/math.js';
import { fbm2, noise2 } from '../engine/noise.js';
import { lineGlyph } from '../engine/renderer.js';
import { REEF_ANEMONE as ANEMONE, REEF_GRASS as GRASS, REEF_STILL as STILL } from '../engine/shore.js';

const BRAIN = [[196, 166, 100], [160, 176, 96], [206, 146, 104], [186, 120, 140]];
const BRANCH = [[226, 120, 170], [238, 150, 80], [176, 124, 226], [120, 206, 186]];
const TABLE = [[110, 176, 150], [176, 160, 104]];
const FAN = [[176, 84, 180], [210, 74, 86], [236, 180, 80]];
const SPONGE = [[236, 200, 80], [234, 120, 60], [190, 90, 170]];
const ANEMONES = [{ body: [238, 138, 190], tip: [255, 220, 236] }, { body: [150, 220, 120], tip: [220, 150, 236] }, { body: [240, 170, 90], tip: [255, 236, 190] }];
const ROCK = [104, 100, 92];
const RUBBLE = [120, 118, 104];
const SEAGRASS = [64, 132, 82];

// Picks a coral type, more often the common ones.
const TYPES = [['brain', 0.18], ['branch', 0.32], ['table', 0.06], ['fan', 0.12], ['anemone', 0.12], ['sponge', 0.13], ['rock', 0.07]];
function pickType() {
  let x = Math.random();
  for (const [type, w] of TYPES) if ((x -= w) <= 0) return type;
  return 'branch';
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lit = (c, k) => [c[0] * k, c[1] * k, c[2] * k]; // a color made brighter or darker

export function buildReef(shore) {
  const { cols, rows, cw, ch, seaWidth } = shore;
  const W = cols * cw, H = rows * ch;
  const n = cols * rows;
  const seed = Math.floor(Math.random() * 1000);
  const reef = {
    color: new Float32Array(n * 3),
    cover: new Float32Array(n), // 0 = bare sea floor, 1 = fully covered
    glyph: new Uint16Array(n),
    glyphColor: new Float32Array(n * 3),
    kind: new Uint8Array(n),
    angle: new Float32Array(n), // for anemone tentacles: which way each one points
    // The solid layer, packed colors per cell, and the list of its cells.
    solid: new Uint8Array(n),
    fill: new Float32Array(n * 3),
    ink: new Float32Array(n * 3),
    sGlyph: new Uint16Array(n),
    sKind: new Uint8Array(n),
    sAngle: new Float32Array(n),
    haze: new Float32Array(n), // how much the water above hides it (deeper = more)
    cells: [],
  };

  // Writes one cell of the mosaic: solid things into the solid layer, faint ones into the wash.
  function paint(c, r, color, cover, glyph, glyphColor, kind = STILL, angle = 0) {
    const i = r * cols + c;
    if (cover >= 0.8) {
      const g = glyphColor || color;
      if (!reef.solid[i]) reef.cells.push(i);
      reef.solid[i] = 1;
      // A little greyer than its true color, and characters only a little darker than the block.
      const grey = (color[0] + color[1] + color[2]) / 3;
      for (let k = 0; k < 3; k++) {
        const fill = color[k] + (grey - color[k]) * 0.25;
        reef.fill[i * 3 + k] = fill;
        reef.ink[i * 3 + k] = fill + (g[k] - fill) * 0.45;
      }
      // Most cells go without a character (anemone tentacles always keep theirs, they sway).
      const quiet = kind !== ANEMONE && hash3(c, r, seed + 21) < 0.6;
      reef.sGlyph[i] = glyph && !quiet ? glyph.charCodeAt(0) : 32;
      reef.sKind[i] = kind;
      reef.sAngle[i] = angle;
      reef.haze[i] = 0.34 + 0.36 * clamp(shore.distance((c + 0.5) * cw, (r + 0.5) * ch) / seaWidth, 0, 1);
      return;
    }
    if (reef.solid[i] || cover < reef.cover[i] * 0.5) return; // don't let a faint edge wipe out something solid
    reef.color[i * 3] = color[0]; reef.color[i * 3 + 1] = color[1]; reef.color[i * 3 + 2] = color[2];
    reef.cover[i] = cover;
    reef.glyph[i] = glyph ? glyph.charCodeAt(0) : 0;
    const g = glyphColor || color;
    reef.glyphColor[i * 3] = g[0]; reef.glyphColor[i * 3 + 1] = g[1]; reef.glyphColor[i * 3 + 2] = g[2];
    reef.kind[i] = kind;
    reef.angle[i] = angle;
  }

  // ---- seagrass: meadows in the sandy shallows, between the beach and the reef ----
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cw, y = (r + 0.5) * ch;
      const dd = shore.distance(x, y);
      const band = smoothstep(70, 140, dd) * smoothstep(seaWidth * 0.55, seaWidth * 0.3, dd);
      const meadow = smoothstep(0.55, 0.7, fbm2(x / 150, y / 150, 2, seed + 3)) * band;
      if (meadow > 0 && hash3(c, r, seed) < meadow * 0.8) {
        paint(c, r, lit(SEAGRASS, 0.8 + 0.4 * hash3(c, r, seed + 1)), 0.5 * meadow + 0.2, '|', [110, 190, 110], GRASS);
      }
    }
  }

  // ---- the patch reefs: a few rough ovals, well apart ----
  const scale = clamp(Math.min(W, H) / 900, 0.8, 1.3);
  const patches = [];
  const nPatch = clamp(Math.round((H * seaWidth) / 190000), 3, 7);
  for (let tries = 0; tries < 300 && patches.length < nPatch; tries++) {
    const y = rand(H * 0.06, H * 0.94);
    const x = -shore.distance(0, y) + Math.max(170, seaWidth * rand(0.16, 0.62)); // the waterline on this row, plus some
    const rx = rand(70, 130) * scale, ry = rand(55, 100) * scale;
    if (patches.some((p) => Math.hypot((p.x - x) / (p.rx + rx), (p.y - y) / (p.ry + ry)) < 1.3)) continue;
    patches.push({ x, y, rx, ry });
  }
  // How far inside a patch (x, y) is: 1 at its middle, 0 at its ragged edge, below 0 outside.
  const inPatch = (x, y) => {
    let best = -1;
    for (const p of patches) {
      const d = Math.hypot((x - p.x) / p.rx, (y - p.y) / p.ry) * (1 + 0.35 * (noise2(x / 45, y / 45, seed + 7) - 0.5));
      best = Math.max(best, 1 - d);
    }
    return best;
  };

  // ---- the coral heads, packed into the patches ----
  const heads = [];
  const want = Math.round(patches.reduce((sum, p) => sum + Math.PI * p.rx * p.ry, 0) / 1500);
  for (let tries = 0; tries < want * 40 && heads.length < want; tries++) {
    const p = patches[Math.floor(Math.random() * patches.length)];
    const x = p.x + rand(-1, 1) * p.rx, y = p.y + rand(-1, 1) * p.ry;
    if (inPatch(x, y) <= 0.05) continue;
    const type = pickType();
    const R = (type === 'anemone' ? rand(9, 15) : type === 'sponge' ? rand(10, 18) : type === 'fan' ? rand(22, 36) : type === 'branch' ? rand(20, 42) : rand(14, 30)) * scale;
    if (heads.some((h) => Math.hypot(h.x - x, h.y - y) < (h.R + R) * 0.75)) continue;
    heads.push({ x, y, R, type, id: heads.length });
  }
  heads.sort((a, b) => b.R - a.R); // big ones first, so smaller ones can sit on top of their edges

  for (const h of heads) {
    const reach = h.R * 1.25;
    const c0 = Math.max(0, Math.floor((h.x - reach) / cw)), c1 = Math.min(cols - 1, Math.floor((h.x + reach) / cw));
    const r0 = Math.max(0, Math.floor((h.y - reach) / ch)), r1 = Math.min(rows - 1, Math.floor((h.y + reach) / ch));
    const painter = PAINTERS[h.type](h, seed);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - h.x, dy = (r + 0.5) * ch - h.y;
        const out = painter(dx, dy, c, r);
        if (out) paint(c, r, ...out);
      }
    }
  }
  // Where the anemones are, so clownfish can find one to live in.
  reef.anemones = heads.filter((h) => h.type === 'anemone').map((h) => ({ x: h.x, y: h.y, r: h.R }));
  return reef;
}

// Each painter is set up for one head and returns a function of a cell's offset (dx, dy)
// from the head's middle, giving [color, cover, glyph, glyphColor, kind, angle] or nothing.
const PAINTERS = {
  // A round mound covered in winding grooves, lit from the top left.
  brain(h, seed) {
    const base = pick(BRAIN);
    const wob = rand(0, TAU);
    return (dx, dy, c, r) => {
      const a = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy) / (h.R * (1 + 0.08 * Math.sin(a * 3 + wob)));
      if (d > 1) return d < 1.2 ? [RUBBLE, 0.3, hash3(c, r, 1) < 0.3 ? '.' : '', null] : null;
      const shade = 1.08 - 0.3 * ((dx + dy) / (h.R * 1.4)) - 0.25 * d * d;
      const groove = Math.abs(frac(noise2(dx / 9 + h.id * 7, dy / 9, seed + 5) * 5) - 0.5) < 0.16;
      const col = lit(base, shade);
      return groove ? [col, 1, '~', lit(base, shade * 0.55)] : [col, 1, hash3(c, r, 2) < 0.4 ? ':' : '', lit(base, shade * 1.25)];
    };
  },

  // Staghorn: branches forking out from the middle, bright tips.
  branch(h) {
    const color = pick(BRANCH);
    const segs = [];
    const n = 5 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rand(-0.3, 0.3);
      const len = h.R * rand(0.6, 1);
      const mx = Math.cos(a) * len * 0.55, my = Math.sin(a) * len * 0.55;
      segs.push([0, 0, Math.cos(a) * len, Math.sin(a) * len, a]);
      for (const side of [-1, 1]) {
        const b = a + side * rand(0.4, 0.8);
        const l2 = len * rand(0.3, 0.5);
        segs.push([mx, my, mx + Math.cos(b) * l2, my + Math.sin(b) * l2, b]);
      }
    }
    const thick = Math.max(4.5, h.R * 0.09);
    return (dx, dy, c, r) => {
      let best = Infinity, ang = 0, tip = false;
      for (const [ax, ay, bx, by, a] of segs) {
        const sx = bx - ax, sy = by - ay;
        const t = clamp(((dx - ax) * sx + (dy - ay) * sy) / (sx * sx + sy * sy), 0, 1);
        const d = Math.hypot(dx - ax - sx * t, dy - ay - sy * t);
        if (d < best) { best = d; ang = a; tip = t > 0.85; }
      }
      if (best < thick) {
        return tip ? [lit(color, 1.2), 1, 'o', lit(color, 1.5)] : [color, 1, lineGlyph(ang), lit(color, 0.55)];
      }
      if (Math.hypot(dx, dy) < h.R * 0.95) return [lit(color, 0.45), 0.35, '', null]; // shadowy gaps between branches
      return null;
    };
  },

  // A flat plate with fine lines running out from the middle and a paler rim.
  table(h) {
    const color = pick(TABLE);
    const tilt = rand(0, TAU);
    return (dx, dy) => {
      const a = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy) / (h.R * (1 + 0.1 * Math.sin(a * 5 + tilt)));
      if (d > 1) return null;
      const k = 0.9 + 0.2 * Math.cos(a - tilt) * d;
      if (d > 0.86) return [lit(color, k * 1.25), 1, '.', lit(color, 1.6)];
      const spoke = Math.abs(frac((a / TAU) * 16) - 0.5) < 0.12;
      return [lit(color, k), 1, spoke && d > 0.25 ? lineGlyph(a) : '', lit(color, 0.6)];
    };
  },

  // A sea fan: a wide, lacy fan spreading out from its base.
  fan(h) {
    const color = pick(FAN);
    const facing = rand(0, TAU);
    return (dx, dy, c, r) => {
      const a = Math.atan2(dy, dx);
      const off = Math.abs(((a - facing + Math.PI * 3) % TAU) - Math.PI); // angle from the fan's middle
      const d = Math.hypot(dx, dy) / h.R;
      if (off > 1.25 || d > 1 - 0.15 * (off / 1.25) ** 2) return null;
      const lace = hash3(c, r, 9);
      return lace < 0.75 ? [color, 0.85, lace < 0.4 ? '#' : '+', lit(color, 1.45)] : [lit(color, 0.6), 0.5, '', null];
    };
  },

  // An anemone: a round body with tentacles all around (they sway, see the shore).
  anemone(h) {
    const { body, tip } = pick(ANEMONES);
    return (dx, dy) => {
      const d = Math.hypot(dx, dy) / h.R;
      if (d > 1) return null;
      const a = Math.atan2(dy, dx);
      if (d < 0.3) return [lit(body, 0.7), 1, 'o', tip];
      return [body, 1, '', tip, ANEMONE, a];
    };
  },

  // Sponges: a little cluster of round tubes.
  sponge(h) {
    const color = pick(SPONGE);
    const tubes = [];
    for (let k = 0; k < 4; k++) tubes.push([rand(-0.5, 0.5) * h.R, rand(-0.5, 0.5) * h.R, rand(0.35, 0.55) * h.R]);
    return (dx, dy) => {
      for (const [tx, ty, tr] of tubes) {
        const d = Math.hypot(dx - tx, dy - ty) / tr;
        if (d < 1) return d < 0.45 ? [lit(color, 0.35), 1, 'O', lit(color, 0.8)] : [color, 1, '', null];
      }
      return null;
    };
  },

  // A rock: a lumpy grey boulder.
  rock(h) {
    const wob = rand(0, TAU);
    return (dx, dy, c, r) => {
      const a = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy) / (h.R * 0.8 * (1 + 0.15 * Math.sin(a * 4 + wob)));
      if (d > 1) return null;
      const k = 1.05 - 0.3 * ((dx + dy) / h.R) - 0.2 * d;
      return [lit(ROCK, k), 1, hash3(c, r, 4) < 0.35 ? '%' : '', lit(ROCK, k * 0.65)];
    };
  },
};

// Puts the solid coral on screen, through the water (see the note at the top). Called from the
// scene's draw(), after the shore has worked out this frame's water.
const packed = (r, g, b) => (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255);
export function drawReef(reef, shore, pen) {
  const { cols, rows, cw, ch } = pen;
  if (!reef || shore.cols !== cols || shore.rows !== rows) return;
  const { solid, fill, ink, sGlyph, sKind, sAngle, haze, cells } = reef;
  const water = shore.rgba, refX = shore.refX, refY = shore.refY;
  const t = pen.t;
  for (const i of cells) {
    // What's seen in this cell is the bit of reef slightly to one side, where the surface tilts.
    const c = i % cols, r = (i / cols) | 0;
    const j = clamp(r + Math.round(refY[i] / ch), 0, rows - 1) * cols + clamp(c + Math.round(refX[i] / cw), 0, cols - 1);
    if (!solid[j]) continue;
    const hz = haze[i], o = i * 4, k = j * 3;
    const wr = water[o], wg = water[o + 1], wb = water[o + 2];
    let glyph = sGlyph[j];
    if (sKind[j] === ANEMONE) glyph = lineGlyph(sAngle[j] + 0.5 * Math.sin(t * 2.1 + sAngle[j] * 3 + c)).charCodeAt(0);
    const gh = hz * 0.8;
    pen.cell(i, glyph,
      packed(ink[k] + (wr - ink[k]) * gh, ink[k + 1] + (wg - ink[k + 1]) * gh, ink[k + 2] + (wb - ink[k + 2]) * gh),
      packed(fill[k] + (wr - fill[k]) * hz, fill[k + 1] + (wg - fill[k + 1]) * hz, fill[k + 2] + (wb - fill[k + 2]) * hz));
  }
}
