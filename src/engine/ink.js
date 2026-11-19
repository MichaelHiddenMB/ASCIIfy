// "Ink" describes what one sampled point of an animal is made of: its color, and what kind
// of material it is. The renderer turns each kind into a different look for the cell.
// Adapted from ascii-animals (MIT, see licenses/ascii-animals-LICENSE.txt).

/** Ordinary skin or scales: a block of color with a sparse-to-dense character. */
export const INK_SCALE = 0;
/** Dark patches and veins: a block with a heavy character. */
export const INK_DARK = 1;
/** Small bright dots such as eyes. */
export const INK_SPOT = 2;
/** Iridescent: brightness rolls across it as the animal turns, and it sparkles more. */
export const INK_SHIMMER = 3;
/** See-through (fins): a faint block that mostly lets the background show. */
export const INK_GLASS = 4;
/** Light with no body: a bare character and no block. */
export const INK_GLOW = 5;
/** Fuzzy bodies: a block with a heavy character. */
export const INK_BODY = 6;
/** Lit from within: a deep block with a bright, nearly white character. */
export const INK_LIT = 7;

// Fills in an ink object. Returns true so a sampler can write `return ink(...)` on a hit.
export function ink(out, r, g, b, kind = INK_SCALE, glyphs = null) {
  out.r = r;
  out.g = g;
  out.b = b;
  out.kind = kind;
  out.glyphs = glyphs;
  return true;
}
