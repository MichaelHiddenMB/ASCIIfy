// Meadow: a top-down view of a grassy field with wildflowers, butterflies and dragonflies.
// Same scene shape as koi-pond.js (see the list of what a scene provides at the top of that file).
//
// What happens here:
//   - the grass (grass.js) is the ground, with wind gusts sweeping across it
//   - clusters of larger flowers (daisies, poppies, cornflowers, buttercups) that sway with
//     the grass and that butterflies land on
//   - two flocks: butterflies and dragonflies. They're drawn together, farthest first, so
//     nearer insects always pass over farther ones whichever kind they are
//   - every insect casts a soft shadow on the grass, offset away from the sun (top left);
//     higher ones (the bigger, nearer ones) cast it farther away
//   - the mouse brushes the grass, makes butterflies on flowers take off, and makes nearby
//     hovering dragonflies dart away; a click puffs the grass and startles everything near it
import { Flock } from '../engine/flock.js';
import { Grass } from '../engine/grass.js';
import { INK_SCALE, ink } from '../engine/ink.js';
import { clamp, rand, TAU } from '../engine/math.js';
import { butterflies } from '../animals/butterflies.js';
import { dragonflies } from '../animals/dragonflies.js';

const PALETTE = {
  background: [22, 46, 24], // far-off insects fade toward the meadow's green
  grid: [255, 255, 255, 0.03],
  trailAlpha: 0.8,
  trail: [200, 220, 160],
  ink: [26, 30, 22], // dark, for thin details like butterfly feelers against the grass
};

// The larger flowers. `n` is the number of petals.
const KINDS = [
  { name: 'daisy', petals: [244, 242, 230], tips: [255, 255, 250], center: [246, 196, 60], n: 8, size: 1 },
  { name: 'poppy', petals: [222, 52, 40], tips: [242, 96, 64], center: [34, 24, 26], n: 4, size: 1.25 },
  { name: 'cornflower', petals: [86, 120, 236], tips: [142, 172, 255], center: [64, 40, 96], n: 6, size: 0.95 },
  { name: 'buttercup', petals: [250, 214, 60], tips: [255, 236, 130], center: [214, 150, 30], n: 5, size: 0.8 },
];

export function createMeadow({ density = 1, flowers: flowerAmount = 1 } = {}) {
  // Both insects at their reference look, but fewer of each since they share the screen.
  const bTuning = { ...butterflies.defaults, density: butterflies.defaults.density * 0.6 * density };
  // Less distance haze than in the original, so these green insects don't fade into the green grass.
  const dTuning = { ...dragonflies.defaults, density: dragonflies.defaults.density * 0.4 * density, fog: 0.1 };
  const bFlock = new Flock(butterflies, bTuning);
  const dFlock = new Flock(dragonflies, dTuning);
  const kinds = [[bFlock, butterflies], [dFlock, dragonflies]];
  // The renderer's own settings (fog etc. are swapped per insect while drawing, see draw()).
  const tuning = { fog: 0.6, shimmer: 0.3, sparkle: 0.12, trail: 0, trailFade: 1, grid: 1 };
  const grass = new Grass({ flowers: flowerAmount });
  let flowers = [];
  let nextFlowerId = 60000;
  let lastPointer = null;

  // Flowers grow in clusters of one kind, kept clear of the clock and search bar.
  function placeFlowers(w, h) {
    for (const f of flowers) f.gone = true; // any butterfly sitting on one will fly off
    flowers = [];
    const scale = clamp(Math.min(w, h) / 800, 0.75, 1.3);
    const clusters = Math.round(((w * h) / 140000) * flowerAmount);
    for (let k = 0; k < clusters; k++) {
      const cx = rand(40, w - 40), cy = rand(40, h - 40);
      if (Math.abs(cx - w / 2) < 380 && Math.abs(cy - (h * 0.5 - 40)) < 210) continue;
      const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), r = rand(0, 70) * scale;
        flowers.push({
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          dx: 0, dy: 0, // how far the wind is swaying it
          kind,
          span: rand(36, 50) * kind.size * scale, // big enough that the petals show
          heading: rand(0, TAU),
          id: nextFlowerId++,
          taken: null,
          gone: false,
        });
      }
    }
    bFlock.flowers = flowers;
  }

  // A flower from above: petals around a round middle (the petals are a wavy circle).
  function drawFlower(f, pen) {
    const out = pen.ink;
    const { petals, tips, center, n } = f.kind;
    const pose = { x: f.x + f.dx, y: f.y + f.dy, heading: f.heading, span: f.span, depth: 1, id: f.id };
    pen.shape(pose, 0.55, (u, v) => {
      const r = Math.hypot(u, v);
      const edge = 0.24 + 0.26 * Math.pow(Math.abs(Math.cos((Math.atan2(v, u) * n) / 2)), 0.6);
      if (r > edge) return false;
      if (r < 0.14) return ink(out, ...center);
      return ink(out, ...(r > edge * 0.72 ? tips : petals), INK_SCALE);
    }, { fog: 0 });
  }

  return {
    palette: PALETTE,
    tuning,
    ground: grass,
    events: [],
    get time() { return bFlock.time; },

    resize(w, h, cw, ch) {
      bFlock.resize(w, h);
      dFlock.resize(w, h);
      grass.resize(Math.ceil(w / cw), Math.ceil(h / ch), cw, ch);
      placeFlowers(w, h);
    },

    step(dt) {
      // Flowers lean with the grass around them before the butterflies (who sit on them) move.
      for (const f of flowers) {
        const b = grass.bendAt(f.x, f.y);
        f.dx += (b.x * 5 - f.dx) * Math.min(1, dt * 4);
        f.dy += (b.y * 5 - f.dy) * Math.min(1, dt * 4);
      }
      bFlock.step(dt);
      dFlock.step(dt);
      bFlock.events.length = 0;
      dFlock.events.length = 0;

      // Shadows: the sun is to the top left, so shadows fall down and to the right.
      const shadows = [];
      for (const [flock] of kinds) {
        for (const c of flock.creatures) {
          const height = flock === bFlock ? 0.25 + 0.75 * (c.alt ?? 1) : 1;
          const lift = c.depth * height;
          shadows.push({ x: c.x + 26 * lift, y: c.y + 36 * lift, radius: c.span * 0.34, strength: 0.32 * (0.6 + 0.4 * c.depth) });
        }
      }
      grass.shadows = shadows;
      grass.step(dt);
    },

    draw(pen) {
      for (const f of flowers) drawFlower(f, pen);
      // All insects together, farthest first. Each kind uses its own look settings.
      const all = [];
      for (const [flock, animal] of kinds) for (const c of flock.creatures) all.push([c, animal, flock]);
      all.sort((a, b) => a[0].depth - b[0].depth);
      const renderer = pen.r;
      for (const [c, animal, flock] of all) {
        renderer.tuning = flock.tuning;
        animal.draw(c, pen, flock);
      }
      renderer.tuning = tuning;
    },

    tap(x, y) {
      bFlock.startle(x, y);
      dFlock.startle(x, y);
      grass.puff(x, y, 1, 7);
    },

    // The mouse brushes through the grass and disturbs insects close to it.
    pointer(x, y) {
      const now = performance.now();
      if (lastPointer && now - lastPointer.t < 200) {
        const dt = Math.max(0.008, (now - lastPointer.t) / 1000);
        const dist = Math.hypot(x - lastPointer.x, y - lastPointer.y);
        const speed = dist / dt;
        grass.brush(lastPointer.x, lastPointer.y, x, y, clamp(speed / 3000, 0.05, 0.35), 3);
        if (speed > 150 && dist > 0) {
          for (const b of bFlock.creatures) {
            if (b.state !== 'fly' && Math.hypot(b.x - x, b.y - y) < 70) butterflies.disturb(b, bFlock);
          }
          for (const d of dFlock.creatures) {
            const dx = d.x - x, dy = d.y - y, r = Math.hypot(dx, dy);
            if (d.mode === 'hover' && r < Math.max(90, d.span * 0.5)) dragonflies.startle(d, dx / (r || 1), dy / (r || 1), 0.6, dFlock);
          }
        }
      }
      lastPointer = { x, y, t: now };
    },

    setDensity(d) {
      bTuning.density = butterflies.defaults.density * 0.6 * d;
      dTuning.density = dragonflies.defaults.density * 0.4 * d;
    },

    setFlowers(amount) {
      flowerAmount = amount;
      grass.setFlowers(amount);
      placeFlowers(bFlock.width, bFlock.height);
    },
  };
}
