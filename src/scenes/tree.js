// A tree seen from straight above: what you see is its canopy, a cluster of overlapping round
// clumps of leaves.
//
// Each clump is shaded as if it were a dome lit by the sun from the top left: points on the
// top-left side of a clump are brighter, the bottom-right side darker. That one trick makes a
// flat circle read as a round, leafy mound. Smaller clumps sit on top of bigger ones, and a
// noise texture scatters lighter and darker leaves across the whole canopy.
//
// The clumps sway a little in the breeze, and can be pushed by stronger wind (the mouse's
// wind stream, passed in to sway()).
import { INK_SCALE, ink } from '../engine/ink.js';
import { clamp, rand, TAU } from '../engine/math.js';
import { noise2 } from '../engine/noise.js';

const DEEP = [26, 58, 28]; // leaves in shadow
const LEAF = [54, 104, 44];
const LIT = [118, 168, 76]; // leaves catching the sun
const SUN = { x: -0.55, y: -0.65 }; // the direction the light comes from (top left)

export function makeTree(x, y, span) {
  // A big central clump and a ring of smaller ones around it.
  const clumps = [{ u: 0, v: 0, r: 0.3 }];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.3, 0.3);
    const d = rand(0.2, 0.3);
    clumps.push({ u: Math.cos(a) * d, v: Math.sin(a) * d, r: rand(0.15, 0.22) });
  }
  // A few small clumps on top, toward the sunny side, to give it some height.
  for (let i = 0; i < 3; i++) clumps.push({ u: rand(-0.18, 0.05), v: rand(-0.18, 0.05), r: rand(0.09, 0.13), top: true });
  for (const c of clumps) {
    c.du = 0; // how far the wind has pushed this clump
    c.dv = 0;
    c.phase = rand(0, TAU);
  }
  return { x, y, span, clumps, id: 70000 + Math.floor(rand(0, 1000)), seed: rand(0, 100) };
}

// Moves the clumps: a slow breeze sway, plus `wind` (pixels per second) from the mouse.
export function swayTree(tree, t, dt, wind) {
  const push = 0.00008 * tree.span;
  for (const c of tree.clumps) {
    const sway = c.top ? 0.012 : 0.008;
    const tu = Math.sin(t * 0.9 + c.phase) * sway + (wind.x / tree.span) * push * 40;
    const tv = Math.cos(t * 0.7 + c.phase) * sway + (wind.y / tree.span) * push * 40;
    const k = Math.min(1, dt * 3);
    c.du += (clamp(tu, -0.05, 0.05) - c.du) * k;
    c.dv += (clamp(tv, -0.05, 0.05) - c.dv) * k;
  }
}

export function drawTree(tree, pen) {
  const out = pen.ink;
  const { clumps, seed } = tree;
  const pose = { x: tree.x, y: tree.y, heading: 0, span: tree.span, depth: 1, id: tree.id };
  pen.shape(pose, 0.6, (u, v) => {
    // Find the top-most clump this point is inside (top clumps win, then smaller ones).
    let hit = null;
    for (const c of clumps) {
      const du = u - c.u - c.du, dv = v - c.v - c.dv;
      const d = Math.hypot(du, dv) / c.r;
      if (d > 1) continue;
      if (!hit || (c.top && !hit.top) || (c.top === hit.top && c.r < hit.r)) hit = { c, du, dv, d };
    }
    if (!hit) return false;
    const { c, du, dv, d } = hit;
    // Dome lighting: the surface tilts toward the edge; light from the top left.
    const nu = du / c.r, nv = dv / c.r;
    const light = (nu * SUN.x + nv * SUN.y) * 0.5 + 0.5 * (1 - d * d); // brighter facing the sun, and in the middle
    const leaves = noise2(u * 26 + seed, v * 26, 3) - 0.5;
    const k = clamp(0.45 + light * 0.75 + leaves * 0.5, 0, 1.25);
    let R, G, B;
    if (k < 0.6) {
      const s = k / 0.6;
      R = DEEP[0] + (LEAF[0] - DEEP[0]) * s; G = DEEP[1] + (LEAF[1] - DEEP[1]) * s; B = DEEP[2] + (LEAF[2] - DEEP[2]) * s;
    } else {
      const s = Math.min(1, (k - 0.6) / 0.6);
      R = LEAF[0] + (LIT[0] - LEAF[0]) * s; G = LEAF[1] + (LIT[1] - LEAF[1]) * s; B = LEAF[2] + (LIT[2] - LEAF[2]) * s;
    }
    // The edge of each clump, where it sits over the one below, is a little darker.
    if (d > 0.85) { R *= 0.8; G *= 0.8; B *= 0.8; }
    return ink(out, R, G, B, INK_SCALE, k > 0.6 ? '%&' : '&@8');
  }, { fog: 0 });
}

// Where the canopy is lit... and where its shadow falls: away from the sun, down and to the right.
export function treeShadow(tree) {
  return { x: tree.x + tree.span * 0.18, y: tree.y + tree.span * 0.24, radius: tree.span * 0.52, strength: 0.5 };
}
