// The list of scenes the settings panel can switch between. To add a scene, write a
// create(options) function in its own file (see koi-pond.js for what it must return)
// and register it here.
import { createKoiPond } from './koi-pond.js';

export const DEFAULT_SCENE = 'koi-pond';

export const SCENES = {
  'koi-pond': { label: 'Koi pond', create: createKoiPond },
};
