// Koi pond: a top-down view of rippling water with koi swimming beneath lily pads.
//
// A scene object is what main.js drives. It provides:
//   palette, tuning, water   colors, settings and the water surface for the renderer
//   time, events             the clock, and trail marks waiting to be added
//   resize(w, h, cw, ch)     the window changed size
//   step(dt)                 move everything forward by dt seconds
//   draw(pen)                draw everything
//   tap(x, y)                the water was clicked
//   pointer(x, y)            the mouse moved to (x, y)
//   setDensity(d)            the "animals" slider moved
//   setLight(on)             the moonlight setting was switched on or off
//   setPads(amount)          the "lily pads" slider moved
import { Flock } from '../engine/flock.js';
import { INK_SCALE, ink } from '../engine/ink.js';
import { lineGlyph } from '../engine/renderer.js';
import { clamp, frac, rand, TAU } from '../engine/math.js';
import { Water } from '../engine/water.js';
import { koi } from '../animals/koi.js';

const PALETTE = {
  background: [4, 12, 18], // deep pond water (far-away koi fade toward this)
  grid: [150, 210, 235, 0.035],
  trailAlpha: 0.85,
  trail: [110, 170, 220],
};

const PAD = [58, 130, 62];
const PAD_RIM = [96, 168, 86];
const PAD_VEIN = [36, 92, 46];
const PETAL = [242, 156, 190];
const PETAL_TIP = [252, 222, 234];
const POLLEN = [246, 204, 80];

export function createKoiPond({ density = 1, pads: padAmount = 1 } = {}) {
  // The koi's ripples now go into the water itself, so the dotted trail is switched off.
  const tuning = { ...koi.defaults, density: koi.defaults.density * density, trail: 0 };
  const flock = new Flock(koi, tuning);
  const water = new Water();
  let pads = [];
  let nextDrop = rand(1, 3);
  let lastPointer = null;

  // Scatter lily pads without overlapping each other or the clock and search bar.
  let nextPadId = 1000;

  // Adds or removes lily pads until there are as many as the setting asks for. Pads that
  // are already floating stay where they are; new ones are placed so they don't overlap
  // each other or the clock and search bar. `fresh` starts over (used when the window resizes).
  function placePads(w, h, fresh = false) {
    if (fresh) pads = [];
    const scale = clamp(Math.min(w, h) / 800, 0.7, 1.3);
    const count = Math.round(clamp((w * h) / 240000, 3, 10) * padAmount);
    while (pads.length > count) pads.splice(Math.floor(Math.random() * pads.length), 1);
    for (let tries = 0; tries < 400 && pads.length < count; tries++) {
      const span = rand(70, 130) * scale;
      const x = rand(span * 0.3, w - span * 0.3);
      const y = rand(span * 0.3, h - span * 0.3);
      // Keep the middle clear, where the clock and search bar are.
      if (Math.abs(x - w / 2) < 340 + span * 0.4 && Math.abs(y - (h * 0.5 - 40)) < 170 + span * 0.4) continue;
      if (pads.some((p) => Math.hypot(p.x0 - x, p.y0 - y) < (p.span + span) * 0.5)) continue;
      pads.push({
        x, y, span,
        x0: x, y0: y, // home position
        ox: 0, oy: 0, vx: 0, vy: 0, // how far ripples have pushed it, and how fast
        turn: 0, // extra spinning from waves
        tiltU: 0, tiltV: 0, // how the wave under it is tilting it (for shading)
        heading: rand(0, TAU),
        spin: rand(-0.03, 0.03), // slow turning, radians per second
        phase: rand(0, TAU),
        id: nextPadId++,
        depth: 1,
        flower: Math.random() < 0.4,
      });
    }
  }

  // A lily pad, seen from above: a slightly wobbly circle with a wedge-shaped notch,
  // veins running out from the middle, and a lighter rim.
  function drawPad(p, pen) {
    const out = pen.ink;
    // A wave passing under the pad tilts it: the side rising toward the light gets brighter,
    // the other side darker. `shade` is that brightness at a point (u, v) on the pad.
    const shade = (u, v) => clamp(1 + (u * p.tiltU + v * p.tiltV) * 45, 0.6, 1.45);
    const lit = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    pen.shape(p, 0.56, (u, v) => {
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      const edge = 0.5 + 0.015 * Math.sin(a * 5 + p.id);
      if (r > edge) return false;
      if (Math.abs(a) < 0.3 && r > 0.03) return false; // the notch
      const spoke = Math.abs(frac((a / TAU) * 11 + 0.5) - 0.5);
      const k = shade(u, v);
      if (spoke < 0.05 && r > 0.08 && r < edge - 0.07) return ink(out, ...lit(PAD_VEIN, k), INK_SCALE, lineGlyph(a + p.heading));
      if (r > edge - 0.06) return ink(out, ...lit(PAD_RIM, k));
      return ink(out, ...lit(PAD, k));
    }, { fog: 0 });

    if (!p.flower) return;
    // A small flower sitting on the pad: six petals around a yellow middle.
    const fx = p.x + Math.cos(p.heading + 2.6) * p.span * 0.14;
    const fy = p.y + Math.sin(p.heading + 2.6) * p.span * 0.14;
    const flower = { x: fx, y: fy, heading: p.heading * 1.7, span: p.span * 0.34, depth: 1, id: p.id + 500 };
    pen.shape(flower, 0.55, (u, v) => {
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      if (r > 0.28 + 0.2 * Math.abs(Math.cos(a * 3))) return false;
      if (r < 0.14) return ink(out, ...POLLEN);
      return r > 0.36 ? ink(out, ...PETAL_TIP) : ink(out, ...PETAL);
    }, { fog: 0 });
  }

  return {
    palette: PALETTE,
    tuning,
    water,
    events: [], // nothing for the dotted trail: ripples live in the water instead
    get time() { return flock.time; },

    resize(w, h, cw, ch) {
      flock.resize(w, h);
      water.resize(Math.ceil(w / cw), Math.ceil(h / ch), cw, ch);
      placePads(w, h, true);
    },

    step(dt) {
      flock.step(dt);
      const t = flock.time;

      // Splashes from the koi's world (food landing, a koi gulping a pellet) become real ripples.
      for (const e of flock.events) water.disturb(e.x, e.y, e.amount * 1.4, 1.2);
      flock.events.length = 0;

      // Koi swimming near the surface push the water aside as they go, leaving a faint wake.
      for (const f of flock.creatures) {
        if (f.depth > 0.6) water.disturb(f.nodes[0], f.nodes[1], 0.05 * (f.depth - 0.6), 1);
      }

      // Every few seconds something drops onto the water (a leaf, a bug, a raindrop).
      nextDrop -= dt;
      if (nextDrop <= 0) {
        nextDrop = rand(1.2, 4);
        water.disturb(rand(0, flock.width), rand(0, flock.height), rand(0.4, 0.9), 1);
      }

      // Lily pads react to the waves around them. They feel the water just outside their rim
      // (the water right under a pad is calmer, so that's where the waves actually hit):
      //   - the slope pushes them downhill, and a spring slowly pulls them back home
      //   - uneven waves spin them a little
      //   - the tilt is remembered so drawPad can shade the pad as if it's rocking
      water.clearCalm();
      for (const p of pads) {
        const s = water.slopeAround(p.x, p.y, p.span * 0.55);
        p.vx += (-s.x * 9000 - p.ox * 2 - p.vx * 1.6) * dt;
        p.vy += (-s.y * 9000 - p.oy * 2 - p.vy * 1.6) * dt;
        p.ox += p.vx * dt;
        p.oy += p.vy * dt;
        // Never let a pad be pushed more than a quarter of its size from home.
        const off = Math.hypot(p.ox, p.oy), limit = p.span * 0.25;
        if (off > limit) {
          p.ox *= limit / off;
          p.oy *= limit / off;
        }
        p.turn = clamp(p.turn + ((s.x - s.y) * 40 - p.turn * 1.5) * dt, -0.6, 0.6);
        p.heading += (p.spin + p.turn) * dt;
        // The tilt, turned to match the pad's own rotation, and eased so it rocks smoothly.
        const c = Math.cos(p.heading), sn = Math.sin(p.heading);
        p.tiltU += ((s.x * c + s.y * sn) - p.tiltU) * Math.min(1, dt * 8);
        p.tiltV += ((-s.x * sn + s.y * c) - p.tiltV) * Math.min(1, dt * 8);
        p.x = p.x0 + Math.sin(t * 0.07 + p.phase) * 6 + p.ox;
        p.y = p.y0 + Math.cos(t * 0.05 + p.phase) * 4 + p.oy;
        water.calmCircle(p.x, p.y, p.span * 0.45, 0.55);
      }

      // Floating food bobs and drifts with the waves too.
      for (const pellet of koi.food(flock)) {
        const s = water.slopeAt(pellet.x, pellet.y);
        pellet.vx -= s.x * 900 * dt;
        pellet.vy -= s.y * 900 * dt;
      }

      water.step(dt);
    },

    // Food floats on top so it isn't bent by the water, but it's drawn first so a koi rising
    // to eat it covers it. Then the koi (bent by ripples), then the pads.
    draw(pen) {
      koi.drawFood(flock, pen);
      pen.refract = true;
      koi.drawFish(flock, pen);
      pen.refract = false;
      for (const p of pads) drawPad(p, pen);
    },

    tap(x, y) {
      flock.startle(x, y); // the koi drop food here (see koi.tap)
      water.disturb(x, y, 1.2, 1.6);
    },

    // The mouse drags through the water: the faster it moves, the bigger the wake.
    pointer(x, y) {
      const now = performance.now();
      if (lastPointer && now - lastPointer.t < 200) {
        const dt = Math.max(0.008, (now - lastPointer.t) / 1000);
        const speed = Math.hypot(x - lastPointer.x, y - lastPointer.y) / dt;
        const amount = clamp(speed / 20000, 0.008, 0.07);
        water.disturbLine(lastPointer.x, lastPointer.y, x, y, amount, 1.1);
      }
      lastPointer = { x, y, t: now };
    },

    setDensity(d) {
      tuning.density = koi.defaults.density * d;
    },

    setPads(amount) {
      padAmount = amount;
      placePads(flock.width, flock.height);
    },

    setLight(on) {
      water.lightOn = on;
    },
  };
}
