# AASCIfy

A Chrome extension that turns your new tab into a living, animated ASCII art scene: a koi
pond seen from above, with koi swimming lazily beneath drifting lily pads. On top there's a
clock, a search bar and a settings panel.

## Install (developer mode)
1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Open a new tab.

After editing any file, open a new tab to see the change. If you edit `manifest.json`,
click the reload icon on the extension's card in `chrome://extensions` first.

## The koi pond
- Koi come in five classic varieties: kohaku, sanke, showa, ogon and chagoi.
- Smaller, fainter koi are deeper down. They move slower and swim beneath the nearer ones.
- The water is a real wave simulation: ripples spread, bounce off the pond's edges and pass
  through each other, catch the light, and bend the koi seen through them. The reflected light
  glitters where the surface moves. Turn it off with **moonlight on the water** in settings.
- **Move the mouse** to drag through the water. The faster you move, the bigger the wake.
- **Click the water** to drop food. It lands with a splash and bobs on the waves, and nearby
  koi swim over to eat it.
- Lily pads rock, drift and turn as waves reach them, then float back to where they were.
- The **animals** slider sets how many koi there are, **speed** how fast everything moves,
  and **text size** how big the ASCII cells are.

## The meadow
- A grassy field seen from above, with patches of lush and dry grass, drifts of tiny
  wildflowers, and clusters of daisies, poppies, cornflowers and buttercups.
- Wind gusts roll across the grass in waves of light.
- Blue morpho butterflies wander, flutter and glide, and now and then land on a flower to rest
  with their wings slowly opening and closing. Emerald dragonflies hover, then dart.
- Every insect casts a soft shadow on the grass.
- **Move the mouse** to brush through the grass. Butterflies resting nearby take off, and
  hovering dragonflies dart away. **Click** to puff the grass and startle everything near it.

Switch between themes, and set how many flowers or lily pads there are, in the settings panel.

## Credits
The renderer, flock, koi, butterflies and dragonflies are adapted from
[ascii-animals](https://github.com/DesignerStephen1/ascii-animals) by drewdi and Stephen Zhang,
used under the MIT License (see `licenses/ascii-animals-LICENSE.txt`).
