// Startup: load settings, create the scene, start the game loop and connect the UI.
import { Renderer } from './engine/renderer.js';
import { createLoop } from './engine/loop.js';
import { SCENES, DEFAULT_SCENE } from './scenes/index.js';
import { loadSettings, saveSettings, watchSettings } from './storage.js';
import { initClock } from './ui/clock.js';
import { initSearch } from './ui/search.js';
import { initSettings } from './ui/settings.js';

const canvas = document.getElementById('scene');
const renderer = new Renderer(canvas);
let settings = await loadSettings();
if (!SCENES[settings.scene]) settings.scene = DEFAULT_SCENE; // e.g. a scene that was removed
let scene = null;

const CELL_WIDTH = 9; // how wide each character cell is, in pixels

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2), CELL_WIDTH);
  scene.resize(w, h, renderer.cw, renderer.ch);
}

function buildScene() {
  scene = SCENES[settings.scene].create({ density: settings.density, pads: settings.pads, flowers: settings.flowers });
  scene.setLight?.(settings.light);
  renderer.use(scene.palette, scene.tuning, scene.ground);
  resize();
  renderer.render(scene, 0);
}

const loop = createLoop({
  fps: 30,
  update: (dt) => scene.step(dt),
  render: (elapsed) => renderer.render(scene, elapsed),
});

const clock = initClock();
const search = initSearch();
const panel = initSettings({ scenes: SCENES, onChange: saveSettings });

function applySettings(patch) {
  const prev = settings;
  settings = { ...settings, ...patch };
  if (!SCENES[settings.scene]) settings.scene = DEFAULT_SCENE;
  const changed = (key) => key in patch && patch[key] !== prev[key];
  if (changed('scene')) buildScene();
  else {
    if (changed('density')) scene.setDensity(settings.density);
    if (changed('light')) scene.setLight?.(settings.light);
    if (changed('pads')) scene.setPads?.(settings.pads);
    if (changed('flowers')) scene.setFlowers?.(settings.flowers);
  }
  if (changed('speed')) loop.setSpeed(settings.speed);
  clock.update(settings);
  search.update(settings);
  panel.show(settings);
}

// ---- start everything ----
buildScene();
applySettings({});
loop.setSpeed(settings.speed);
loop.start();
watchSettings(applySettings);

// Clicking the water (not the clock, search bar or settings) is passed to the scene:
// in the koi pond, that drops food.
window.addEventListener('pointerdown', (e) => {
  if (e.target === canvas) scene.tap(e.clientX, e.clientY);
});

// Moving the mouse anywhere over the page drags through the water.
window.addEventListener('pointermove', (e) => scene.pointer?.(e.clientX, e.clientY));

// Resize after the window stops changing size for a moment.
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 150);
});
