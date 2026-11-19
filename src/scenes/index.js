// The list of themes (scenes) the settings panel can switch between. To add one, write a
// create(options) function in its own file (see koi-pond.js for what it must return)
// and register it here.
import { createKoiPond } from './koi-pond.js';
import { createMeadow } from './meadow.js';
import { createBeach } from './beach.js';

export const DEFAULT_SCENE = 'koi-pond';

export const SCENES = {
  'koi-pond': { label: 'Koi pond', create: createKoiPond },
  meadow: { label: 'Meadow', create: createMeadow },
  beach: { label: 'Beach', create: createBeach },
};
