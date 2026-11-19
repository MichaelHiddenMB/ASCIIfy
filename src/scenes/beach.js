// Beach: a top-down view of a sandy beach on the left and the sea on the right, with waves
// rolling in, breaking into foam and washing up the sand.
// Same scene shape as koi-pond.js (see the list of what a scene provides at the top of that file).
//
// The ground (shore.js) does the sand, the sea and the waves, and shows the reef (reef.js)
// on the sea floor. Shells and starfish (shells.js) lie on the sand. The mouse makes ripples
// on the sea, and a click on the water makes a splash.
import { Shore } from '../engine/shore.js';
import { clamp } from '../engine/math.js';
import { buildReef, drawReef } from './reef.js';
import { drawShells, placeShells } from './shells.js';

const PALETTE = {
  background: [12, 56, 104], // the deep sea (far-off sea creatures fade toward this)
  grid: [255, 255, 255, 0.03],
  trailAlpha: 0.7,
  trail: [120, 100, 72], // footprints in the sand
  ink: [60, 44, 30], // dark, for thin details like crab legs against the sand
};

export function createBeach() {
  const tuning = { fog: 0.6, shimmer: 0.3, sparkle: 0.1, trail: 0, trailFade: 0.4, grid: 1 };
  const shore = new Shore();
  const water = shore.water;
  let time = 0;
  let lastPointer = null;
  let shells = [];

  return {
    palette: PALETTE,
    tuning,
    ground: shore,
    events: [],
    get time() { return time; },

    resize(w, h, cw, ch) {
      shore.resize(Math.ceil(w / cw), Math.ceil(h / ch), cw, ch);
      shore.reef = buildReef(shore);
      shells = placeShells(shore, w, h);
    },

    step(dt) {
      time += dt;
      shore.step(dt);
    },

    draw(pen) {
      drawReef(shore.reef, shore, pen);
      drawShells(shells, pen);
    },

    tap(x, y) {
      if (shore.distance(x, y) > 0) water.disturb(x, y, 1.2, 1.6);
    },

    // The mouse drags through the sea: the faster it moves, the bigger the wake.
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

    setDensity() {},
  };
}
