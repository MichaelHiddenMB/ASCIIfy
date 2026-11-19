// Settings are saved with chrome.storage.sync: Chrome remembers them between tabs and syncs
// them to any computer you're signed into Chrome on. Chrome also announces every change,
// and we listen for that so every open new tab updates instantly.
//
// If the page is opened outside the extension (e.g. from a local web server while
// developing), chrome.storage doesn't exist, so we quietly fall back to keeping settings
// in memory for that one page.
export const DEFAULTS = {
  scene: 'koi-pond',
  speed: 1,
  density: 1,
  pads: 1, // how many lily pads, relative to the default for the screen size
  flowers: 1, // how many flowers in the meadow
  meadowPond: true, // the little pond with koi, and the tree beside it, in the meadow
  sunset: false, // sunset lighting and fireflies in the meadow
  beachSunset: false, // sunset over the sea at the beach
  waves: 1, // how fast the beach's waves roll in
  name: '',
  showClock: true,
  showSearch: true,
  showBookmarks: true, // our own bookmarks bar along the top (see src/ui/bookmarks.js)
  light: true, // the moonlight reflection on the water
  clock24: false,
};

const area = globalThis.chrome?.storage?.sync;
const localListeners = [];

export async function loadSettings() {
  if (!area) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(await area.get(DEFAULTS)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  if (area) return area.set(patch);
  for (const fn of localListeners) fn(patch);
  return Promise.resolve();
}

// Calls fn(patch) with just the settings that changed.
export function watchSettings(fn) {
  if (!area) {
    localListeners.push(fn);
    return;
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const patch = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) patch[key] = newValue ?? DEFAULTS[key];
    }
    if (Object.keys(patch).length) fn(patch);
  });
}
