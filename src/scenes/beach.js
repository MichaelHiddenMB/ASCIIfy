// Beach: a top-down view of a sandy beach on the left and the sea on the right, with waves
// rolling in, breaking into foam and washing up the sand.
// Same scene shape as koi-pond.js (see the list of what a scene provides at the top of that file).
//
// The ground (shore.js) does the sand, the sea and the waves, and shows the reef (reef.js)
// on the sea floor. Shells and starfish (shells.js) lie on the sand.
//
// In the sea, jellyfish pulse slowly through the open water beyond the reef. Sea creatures
// are drawn farthest (deepest) first and bent by the water's surface, like the pond's koi.
//
// On the beach, a couple of crabs scuttle about. They stay on the sand, keeping fairly close
// to the water, and run up the beach when a wave rushes at them. Their footprints wash away
// when the water runs over them.
//
// The mouse makes ripples on the sea, and a fast flick of it near a crab sends the crab
// running. A click on the water makes a splash; a click on the sand scares nearby crabs.
import { Flock } from '../engine/flock.js';
import { Shore } from '../engine/shore.js';
import { clamp, rand } from '../engine/math.js';
import { buildReef, drawReef } from './reef.js';
import { drawShells, placeShells } from './shells.js';
import { crabs } from '../animals/crabs.js';
import { jellyfish } from '../animals/jellyfish.js';

const PALETTE = {
  background: [12, 56, 104], // the deep sea (far-off sea creatures fade toward this)
  grid: [255, 255, 255, 0.03],
  trailAlpha: 0.7,
  trail: [110, 90, 64], // footprints in the sand
  ink: [60, 44, 30], // dark, for thin details like crab legs against the sand
};

const CRABS = 2;
const JELLIES = 4;

export function createBeach({ density = 1 } = {}) {
  const tuning = { fog: 0.6, shimmer: 0.3, sparkle: 0.1, trail: 0, trailFade: 0.4, grid: 1 };
  const shore = new Shore();
  const water = shore.water;
  const crabTuning = { ...crabs.defaults };
  const crabFlock = new Flock(crabs, crabTuning, Math.round(CRABS * density));
  let lastPointer = null;
  let shells = [];
  let size = { w: 1, h: 1 };

  // ---- the sea creatures ----
  // Each kind keeps to open water at least `out` (a fraction of the sea's width) beyond the
  // average waterline, and away from the screen's edges.
  const jellyTuning = { ...jellyfish.defaults, fog: 0.5 };
  const sea = [
    { animal: jellyfish, tuning: jellyTuning, flock: new Flock(jellyfish, jellyTuning, Math.round(JELLIES * density)), per: JELLIES, out: 0.5 },
  ];
  for (const kind of sea) kind.flock.keepIn = (c) => seaBounds(c, kind.out);

  function seaBounds(c, out) {
    const m = Math.max(50, c.span * 0.5);
    const base = c.x - shore.distance(c.x, c.y);
    const left = base + Math.max(shore.breakAt * 1.8, shore.seaWidth * out), right = size.w - m;
    const ix = c.x < left ? (left - c.x) / 80 : c.x > right ? -(c.x - right) / m : 0;
    const iy = c.y < m ? (m - c.y) / m : c.y > size.h - m ? -(c.y - (size.h - m)) / m : 0;
    return { angle: Math.atan2(iy, ix), push: Math.min(1, Math.hypot(ix, iy)) };
  }

  // Puts a sea creature somewhere in its stretch of open water.
  function placeInSea(c, kind) {
    c.y = rand(60, size.h - 60);
    const base = size.w - shore.seaWidth;
    c.x = rand(base + shore.seaWidth * kind.out + 40, size.w - 60);
    c.drift = rand(0, Math.PI * 2);
    kind.animal.enter?.(c, kind.flock);
  }

  // The strip of beach crabs keep to: not in the sea, not off screen, and not too far up the
  // sand from the water.
  crabFlock.keepIn = (c) => {
    const m = 50;
    const base = c.x - shore.distance(c.x, c.y); // the average waterline on this crab's row
    const right = base - 20, left = Math.max(m, base - Math.max(260, shore.runup * 4));
    const ix = c.x < left ? (left - c.x) / 60 : c.x > right ? -(c.x - right) / 60 : 0;
    const iy = c.y < m ? (m - c.y) / m : c.y > size.h - m ? -(c.y - (size.h - m)) / m : 0;
    return { angle: Math.atan2(iy, ix), push: Math.min(1, Math.hypot(ix, iy)) };
  };

  // Puts a crab somewhere on the damp sand.
  function placeOnBeach(c) {
    c.y = rand(60, size.h - 60);
    const base = c.x - shore.distance(c.x, c.y) || size.w * 0.4;
    c.x = base - rand(30, Math.max(120, shore.runup * 3));
    crabs.enter(c, crabFlock);
  }

  return {
    palette: PALETTE,
    tuning,
    ground: shore,
    events: [],
    get time() { return crabFlock.time; },

    resize(w, h, cw, ch) {
      size = { w, h };
      shore.resize(Math.ceil(w / cw), Math.ceil(h / ch), cw, ch);
      shore.reef = buildReef(shore);
      shells = placeShells(shore, w, h);
      crabFlock.resize(w, h);
      for (const c of crabFlock.creatures) placeOnBeach(c);
      for (const kind of sea) {
        kind.flock.resize(w, h);
        for (const c of kind.flock.creatures) placeInSea(c, kind);
      }
    },

    step(dt) {
      crabFlock.step(dt);
      crabFlock.events.length = 0;
      for (const c of crabFlock.creatures) {
        // A newcomer (or a crab that's somehow got lost) starts out on the beach.
        if (c.y < -40 || c.y > size.h + 40 || c.x < -40 || shore.distance(c.x, c.y) > 40) placeOnBeach(c);
        // A wave rushing up the sand toward it: run up the beach.
        const gap = c.x - shore.waterline(c.y); // how far the water is from the crab (negative = still seaward)
        if (crabFlock.time > c.startledUntil && shore.waveRushing(c.y) && gap > -45) {
          crabs.startle(c, -1, rand(-0.5, 0.5), 0.35, crabFlock);
        }
      }
      for (const kind of sea) {
        kind.flock.step(dt);
        kind.flock.events.length = 0;
        // Newcomers (and any that got lost) start out in open water.
        for (const c of kind.flock.creatures) {
          if (c.y < -c.span || c.y > size.h + c.span || c.x > size.w + c.span || shore.distance(c.x, c.y) < 0) placeInSea(c, kind);
        }
      }
      shore.step(dt);
    },

    draw(pen) {
      const renderer = pen.r;
      drawReef(shore.reef, shore, pen);

      // Sea creatures, deepest first, seen through the water.
      const swimmers = [];
      for (const kind of sea) for (const c of kind.flock.creatures) swimmers.push([c, kind]);
      swimmers.sort((a, b) => a[0].depth - b[0].depth);
      pen.refract = true;
      for (const [c, kind] of swimmers) {
        renderer.tuning = kind.tuning;
        kind.animal.draw(c, pen, kind.flock);
      }
      pen.refract = false;
      renderer.tuning = tuning;

      drawShells(shells, pen);

      // Footprints under the water are washed away.
      const { energy, cols, rows, cw } = renderer;
      if (shore.cols === cols) {
        for (let r = 0; r < rows; r++) {
          const from = Math.max(0, Math.ceil((shore.baseline[r] + shore.edge[r]) / cw));
          for (let c = from; c < cols; c++) energy[r * cols + c] = 0;
        }
      }

      renderer.tuning = crabTuning;
      for (const c of crabFlock.creatures) crabs.draw(c, pen);
      renderer.tuning = tuning;
    },

    tap(x, y) {
      if (shore.distance(x, y) > 0) water.disturb(x, y, 1.2, 1.6);
      crabFlock.startle(x, y);
      for (const kind of sea) kind.flock.startle(x, y);
    },

    pointer(x, y) {
      const now = performance.now();
      if (lastPointer && now - lastPointer.t < 200) {
        const dt = Math.max(0.008, (now - lastPointer.t) / 1000);
        const speed = Math.hypot(x - lastPointer.x, y - lastPointer.y) / dt;
        // The mouse drags through the sea: the faster it moves, the bigger the wake.
        const amount = clamp(speed / 20000, 0.008, 0.07);
        water.disturbLine(lastPointer.x, lastPointer.y, x, y, amount, 1.1);
        // A quick swipe close to a crab makes it bolt.
        if (speed > 350) {
          for (const c of crabFlock.creatures) {
            const d = Math.hypot(c.x - x, c.y - y);
            if (d < 110 && crabFlock.time > c.startledUntil) crabs.startle(c, (c.x - x) / (d || 1), (c.y - y) / (d || 1), 1 - d / 110, crabFlock);
          }
        }
      }
      lastPointer = { x, y, t: now };
    },

    setDensity(d) {
      crabFlock.count = Math.round(CRABS * d);
      for (const kind of sea) kind.flock.count = Math.round(kind.per * d);
    },
  };
}
