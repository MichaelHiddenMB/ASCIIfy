// Beach: a top-down view of a narrow sandy beach on the left and the sea on the right, with waves
// rolling in, breaking into foam and washing up the sand.
// Same scene shape as koi-pond.js (see the list of what a scene provides at the top of that file).
//
// The ground (shore.js) does the sand, the sea and the waves, and shows the reef (reef.js)
// on the sea floor. Shells and starfish (shells.js) lie on the sand; the waves wash over them
// and rock them about.
//
// In the sea, schools of tropical fish swim over the reef (clownfish each keep to an anemone),
// jellyfish pulse slowly through the open water beyond it, and sea turtles row by, rising now
// and then to breathe (which ripples the surface). Rays glide low over the sea floor:
// blue-spotted stingrays rippling their discs (and sometimes resting on the bottom), and
// spotted eagle rays flapping like birds. Sea creatures
// are drawn farthest (deepest) first and bent by the water's surface, like the pond's koi.
//
// On the beach, a couple of crabs scuttle about. They stay on the sand, keeping fairly close
// to the water, and run up the beach when a wave rushes at them. Their footprints wash away
// when the water runs over them.
//
// Every animal, and every shell, casts a soft shadow away from the sun: sea creatures cast
// theirs on the sea floor, further away the higher they swim, so they look like they're
// floating above the reef.
//
// The mouse makes ripples on the sea, and a fast flick of it near a crab sends the crab
// running. A click on the water makes a splash; a click on the sand scares nearby crabs.
import { Flock } from '../engine/flock.js';
import { Shore } from '../engine/shore.js';
import { makeSunsetGrade } from '../engine/sunset.js';
import { clamp, rand } from '../engine/math.js';
import { buildReef, drawReef } from './reef.js';
import { drawShells, placeShells, stepShells } from './shells.js';
import { crabs } from '../animals/crabs.js';
import { jellyfish } from '../animals/jellyfish.js';
import { tropicalFish } from '../animals/tropical-fish.js';
import { turtles } from '../animals/turtles.js';
import { stingrays } from '../animals/stingrays.js';

const PALETTE = {
  background: [12, 56, 104], // the deep sea (far-off sea creatures fade toward this)
  grid: [255, 255, 255, 0.03],
  trailAlpha: 0.7,
  trail: [110, 90, 64], // footprints in the sand
  ink: [60, 44, 30], // dark, for thin details like crab legs against the sand
};

// At sunset the sun is low over the sea, just off the right edge (fractions of the screen).
const SUN = { x: 1.06, y: 0.3 };
const CRABS = 2;
const JELLIES = 4;
const FISH = 22;
const TURTLES = 2;
const RAYS = 2;

export function createBeach({ density = 1, sunset = false } = {}) {
  const tuning = { fog: 0.6, shimmer: 0.3, sparkle: 0.1, trail: 0, trailFade: 0.4, grid: 1 };
  const shore = new Shore();
  shore.setSunset(sunset, SUN);
  const sunsetGrade = makeSunsetGrade(SUN.x, SUN.y, [1, 0.82, 0.72]); // gentler than the meadow's, so the sea stays blue
  const water = shore.water;
  const crabTuning = { ...crabs.defaults };
  const crabFlock = new Flock(crabs, crabTuning, Math.round(CRABS * density));
  let lastPointer = null;
  let shells = [];
  let size = { w: 1, h: 1 };

  // ---- the sea creatures ----
  // Each kind keeps to its own stretch of sea: between `out` and `upTo` (fractions of the
  // sea's width) beyond the average waterline, and away from the screen's edges.
  const jellyTuning = { ...jellyfish.defaults, fog: 0.5 };
  const fishTuning = { ...tropicalFish.defaults };
  const turtleTuning = { ...turtles.defaults };
  const rayTuning = { ...stingrays.defaults };
  const sea = [
    // `shadow`: how big (fraction of size) and dark its shadow is. Jellies are see-through.
    { animal: jellyfish, tuning: jellyTuning, flock: new Flock(jellyfish, jellyTuning, Math.round(JELLIES * density)), per: JELLIES, out: 0.5, upTo: 1, shadow: [0.3, 0.16] },
    { animal: tropicalFish, tuning: fishTuning, flock: new Flock(tropicalFish, fishTuning, Math.round(FISH * density)), per: FISH, out: 0.12, upTo: 0.8, shadow: [0.24, 0.42] },
    { animal: turtles, tuning: turtleTuning, flock: new Flock(turtles, turtleTuning, Math.round(TURTLES * density)), per: TURTLES, out: 0.2, upTo: 1, shadow: [0.36, 0.5] },
    { animal: stingrays, tuning: rayTuning, flock: new Flock(stingrays, rayTuning, Math.round(RAYS * density)), per: RAYS, out: 0.15, upTo: 1, shadow: [0.42, 0.5] },
  ];
  for (const kind of sea) kind.flock.keepIn = (c) => seaBounds(c, kind);

  // The near edge of a kind's stretch of sea (toward the beach) on this creature's row.
  function seaEdge(c, { out }) {
    return c.x - shore.distance(c.x, c.y) + Math.max(shore.breakAt * 1.8, shore.seaWidth * out);
  }

  // The gentle push back toward the middle of its stretch. It starts a little before the
  // edge, so most creatures turn away before they ever touch it.
  function seaBounds(c, kind) {
    const m = Math.max(50, c.span * 0.6);
    const base = c.x - shore.distance(c.x, c.y);
    const left = seaEdge(c, kind) + 70, right = Math.min(size.w - m, base + shore.seaWidth * kind.upTo);
    const ix = c.x < left ? (left - c.x) / 80 : c.x > right ? -(c.x - right) / m : 0;
    const iy = c.y < m ? (m - c.y) / m : c.y > size.h - m ? -(c.y - (size.h - m)) / m : 0;
    return { angle: Math.atan2(iy, ix), push: Math.min(1, Math.hypot(ix, iy)) };
  }

  // WALLS. If a creature does reach the edge of where it may go, it isn't moved anywhere:
  // it's held at the edge, the part of its motion going into the edge is taken away, and its
  // own direction is swung round to run along the edge, so it carries on sideways (like a
  // ball rolling along a wall). The walls are the shore side of its stretch and the screen.
  function slideAlong(c, wall, nx, ny) {
    // (nx, ny) points away from the wall, back into the allowed area.
    const into = c.vx * nx + c.vy * ny;
    if (into < 0) {
      c.vx -= into * nx;
      c.vy -= into * ny;
    }
    // Along the wall, whichever way it was already more heading, tipped slightly away from it.
    const ax = -ny, ay = nx;
    const sign = Math.cos(c.heading) * ax + Math.sin(c.heading) * ay >= 0 ? 1 : -1;
    const along = Math.atan2(ay * sign + ny * 0.25, ax * sign + nx * 0.25);
    if ('walk' in c) c.walk = along; // crabs
    if ('drift' in c) c.drift = along; // everything in the sea
    if (c.fleeDir !== undefined) c.fleeDir = along;
  }
  function holdIn(c, left, right, top, bottom) {
    if (c.x < left) { c.x = left; slideAlong(c, left, 1, 0); }
    if (c.x > right) { c.x = right; slideAlong(c, right, -1, 0); }
    if (c.y < top) { c.y = top; slideAlong(c, top, 0, 1); }
    if (c.y > bottom) { c.y = bottom; slideAlong(c, bottom, 0, -1); }
  }

  // Where the shadows fall. By day the sun is high in the sky, a little to the top left, so
  // shadows fall a short way down and to the right. At sunset the sun is low over the sea, so
  // shadows stretch out long, away from it, toward the beach. A sea creature's shadow is on
  // the sea floor: the higher it swims (the nearer the surface, the bigger its depth), the
  // further away and the softer its shadow.
  function castShadows() {
    const list = [];
    const sx = SUN.x * size.w, sy = SUN.y * size.h;
    const add = (x, y, height, radius, strength) => {
      let dx = 0.6, dy = 0.8, length = 1;
      if (sunset) {
        const d = Math.hypot(x - sx, y - sy) || 1;
        dx = (x - sx) / d; dy = (y - sy) / d; length = 2.6;
      }
      list.push({ x: x + dx * height * length, y: y + dy * height * length, radius: radius * (1 + (height * length) / 160), strength });
    };
    for (const kind of sea) {
      const [size, dark] = kind.shadow;
      for (const c of kind.flock.creatures) add(c.x, c.y, 14 + 75 * c.depth, c.span * size, dark * (1 - 0.25 * c.depth));
    }
    for (const c of crabFlock.creatures) add(c.x, c.y, 8, c.span * 0.3, 0.35);
    for (const s of shells) add(s.x + s.ox, s.y + s.oy, 4, s.span * 0.36, 0.22 * (1 - s.wet * 0.6));
    return list;
  }

  // Puts a sea creature somewhere in its stretch of open water.
  function placeInSea(c, kind) {
    c.y = rand(60, size.h - 60);
    const base = size.w - shore.seaWidth;
    c.x = rand(base + shore.seaWidth * kind.out + 40, Math.min(size.w - 60, base + shore.seaWidth * kind.upTo - 20));
    c.drift = rand(0, Math.PI * 2);
    c.placed = true;
    kind.animal.enter?.(c, kind.flock);
  }

  // The strip of beach crabs keep to: not in the sea, not off screen, and not too far up the
  // sand from the water.
  crabFlock.keepIn = (c) => {
    const m = 50;
    const base = c.x - shore.distance(c.x, c.y); // the average waterline on this crab's row
    const right = base - 45, left = Math.max(m, base - Math.max(260, shore.runup * 4));
    const ix = c.x < left ? (left - c.x) / 60 : c.x > right ? -(c.x - right) / 60 : 0;
    const iy = c.y < m ? (m - c.y) / m : c.y > size.h - m ? -(c.y - (size.h - m)) / m : 0;
    return { angle: Math.atan2(iy, ix), push: Math.min(1, Math.hypot(ix, iy)) };
  };

  // Puts a crab somewhere on the damp sand.
  function placeOnBeach(c) {
    c.y = rand(60, size.h - 60);
    const base = c.x - shore.distance(c.x, c.y) || size.w * 0.2;
    c.x = Math.max(40, base - rand(30, Math.max(120, shore.runup * 3)));
    c.placed = true;
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
      // Clownfish only take anemones they're allowed to swim to (not in the shallows by the surf).
      const fishEdge = Math.max(shore.breakAt * 1.8, shore.seaWidth * sea[1].out) + 25;
      sea[1].flock.anemones = shore.reef.anemones.filter((a) => shore.distance(a.x, a.y) > fishEdge);
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
        // A newcomer starts out on the beach; after that, the beach's edges are walls.
        if (!c.placed) placeOnBeach(c);
        const base = c.x - shore.distance(c.x, c.y);
        const m = c.span * 0.3;
        holdIn(c, m, base - 12, m, size.h - m);
        // A wave rushing up the sand toward it: run up the beach.
        const gap = c.x - shore.waterline(c.y); // how far the water is from the crab (negative = still seaward)
        if (crabFlock.time > c.startledUntil && shore.waveRushing(c.y) && gap > -45) {
          crabs.startle(c, -1, rand(-0.5, 0.5), 0.35, crabFlock);
        }
      }
      for (const kind of sea) {
        kind.flock.step(dt);
        kind.flock.events.length = 0;
        // Newcomers start out in open water; after that, the edges of their stretch are walls.
        for (const c of kind.flock.creatures) {
          if (!c.placed) placeInSea(c, kind);
          const m = c.span * 0.2;
          holdIn(c, seaEdge(c, kind), size.w - m, m, size.h - m);
          // A turtle taking a breath at the surface leaves a ripple by its head.
          if (c.breathing) water.disturb(c.x + Math.cos(c.heading) * c.span * 0.4, c.y + Math.sin(c.heading) * c.span * 0.4, 0.7, 1.3);
        }
      }
      stepShells(shells, shore, crabFlock.time, dt);
      shore.shadows = castShadows();
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

      drawShells(shells, pen, shore);

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

    setSunset(on) {
      sunset = on;
      shore.setSunset(on, SUN);
    },

    // The sunset's color grade (see engine/sunset.js), or nothing by day.
    grade(cols, rows, W, H) {
      return sunset ? sunsetGrade(cols, rows, W, H) : null;
    },

    setDensity(d) {
      crabFlock.count = Math.round(CRABS * d);
      for (const kind of sea) kind.flock.count = Math.round(kind.per * d);
    },
  };
}
