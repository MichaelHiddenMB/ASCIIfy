# Stitches recorded frames into looping animated WebP images, one per folder of frames.
# The last FADE frames are blended into the first ones, so the end flows back into the start
# instead of jumping. Usage: python3 build.py <frames folder> <output folder>
import glob
import os
import sys

from PIL import Image

FADE = 15
FRAME_MS = 66  # about 15 frames a second

frames_dir, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for d in sorted(glob.glob(os.path.join(frames_dir, '*'))):
    name = os.path.basename(d)
    frames = [Image.open(f).convert('RGB') for f in sorted(glob.glob(os.path.join(d, '*.png')))]
    if len(frames) <= FADE * 2:
        continue
    n = len(frames) - FADE
    loop = []
    for i in range(n):
        if i < FADE:
            k = (i + 1) / (FADE + 1)  # from the tail (0) into the head (1)
            loop.append(Image.blend(frames[n + i], frames[i], k))
        else:
            loop.append(frames[i])
    path = os.path.join(out, f'{name}.webp')
    loop[0].save(path, save_all=True, append_images=loop[1:], duration=FRAME_MS, loop=0, quality=80, method=6)
    print(f'{name}: {len(loop)} frames, {os.path.getsize(path) / 1e6:.1f} MB')
