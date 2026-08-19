/**
 * Colour Verification
 *
 * The overlay themes itself from the film's poster, which means arbitrary
 * images decide its colours. Two things therefore need to be true rather than
 * hoped for: the accent has to be the colour a person would point at, and the
 * text has to stay readable whatever the poster turns out to be.
 *
 * Run with: npm run verify:color
 */

import {
  extractPalette,
  contrast,
  luminance,
  readableOn,
  darken,
  vivify,
  toCss,
  toCssAlpha,
  type Rgb,
} from "../src/shared/utils/color";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

/** Build RGBA pixel data from a list of [colour, repeat] pairs. */
function pixels(...spec: Array<[Rgb, number]>): Uint8ClampedArray {
  const out: number[] = [];
  for (const [color, count] of spec) {
    for (let i = 0; i < count; i++) out.push(color.r, color.g, color.b, 255);
  }
  return new Uint8ClampedArray(out);
}

const BLACK: Rgb = { r: 8, g: 8, b: 10 };
const CRIMSON: Rgb = { r: 190, g: 30, b: 45 };
const TEAL: Rgb = { r: 20, g: 160, b: 170 };

// --- Contrast primitives ---------------------------------------------------
check("black on white is maximal contrast", Math.round(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })), 21);
check("a colour has no contrast with itself", contrast(CRIMSON, CRIMSON), 1);
check("white is brighter than black", luminance({ r: 255, g: 255, b: 255 }) > luminance({ r: 0, g: 0, b: 0 }), true);
check("light text on a dark ground", readableOn(BLACK), { r: 255, g: 255, b: 255 });
check("dark text on a light ground", readableOn({ r: 245, g: 240, b: 230 }), { r: 17, g: 17, b: 19 });

check("darken moves towards black", darken({ r: 200, g: 100, b: 50 }, 0.5), { r: 100, g: 50, b: 25 });
check("darken is bounded", darken({ r: 200, g: 100, b: 50 }, 5), { r: 0, g: 0, b: 0 });
check("vivify pushes away from grey", vivify({ r: 150, g: 100, b: 100 }, 1).r > 150, true);
check("css formatting", toCss(CRIMSON), "rgb(190, 30, 45)");
check("css alpha formatting", toCssAlpha(CRIMSON, 0.5), "rgba(190, 30, 45, 0.5)");

// --- The accent must be the colour a person would point at -----------------
// A poster is mostly dark. Taking the *most common* colour returns black every
// time and makes every card identical, so frequency alone is not the signal.
{
  const palette = extractPalette(pixels([BLACK, 900], [CRIMSON, 100]));
  check("picks the saturated colour over the dominant black", palette !== null, true);
  check(
    "...and it is recognisably the crimson",
    palette ? palette.accent.r > palette.accent.g && palette.accent.r > palette.accent.b : null,
    true
  );
}

{
  // Two saturated colours: the more plentiful one should win
  const palette = extractPalette(pixels([BLACK, 500], [TEAL, 300], [CRIMSON, 40]));
  check(
    "prefers the more plentiful of two saturated colours",
    palette ? palette.accent.b > palette.accent.r : null,
    true
  );
}

// --- Degenerate posters ----------------------------------------------------
check("an all-black poster yields no palette", extractPalette(pixels([BLACK, 400])), null);
check("a greyscale poster yields no palette", extractPalette(pixels([{ r: 128, g: 128, b: 128 }, 400])), null);
check("an empty buffer yields no palette", extractPalette(new Uint8ClampedArray([])), null);
check(
  "fully transparent pixels are ignored",
  extractPalette(new Uint8ClampedArray([190, 30, 45, 0, 190, 30, 45, 0])),
  null
);

// --- The readability guarantee ---------------------------------------------
// This is the property that matters: a poster is an arbitrary image, and
// without a floor the card would occasionally render dark grey on black.
{
  const samples: Rgb[] = [
    CRIMSON,
    TEAL,
    { r: 250, g: 230, b: 40 },  // bright yellow
    { r: 40, g: 40, b: 200 },   // deep blue
    { r: 255, g: 140, b: 0 },   // orange
    { r: 120, g: 220, b: 120 }, // pale green
    { r: 200, g: 40, b: 200 },  // magenta
  ];

  let worstSurface = Infinity;
  let worstAccent = Infinity;

  for (const color of samples) {
    const palette = extractPalette(pixels([BLACK, 200], [color, 300]));
    if (!palette) {
      failures++;
      console.log(`FAIL  no palette for ${toCss(color)}`);
      continue;
    }
    worstSurface = Math.min(worstSurface, contrast(palette.onSurface, palette.surface));
    worstAccent = Math.min(
      worstAccent,
      contrast({ r: 255, g: 255, b: 255 }, palette.accentSurface)
    );
  }

  check("body text clears WCAG AA on every sampled poster", worstSurface >= 4.5, true);
  check("white text clears WCAG AA on every accent chip", worstAccent >= 4.5, true);

  // A colour that already clears the floor is left alone — crimson against
  // white is ratio 5.6, so darkening it would dull the card for nothing
  const crimson = extractPalette(pixels([BLACK, 200], [CRIMSON, 300]));
  check(
    "an already-readable accent is not darkened",
    crimson ? JSON.stringify(crimson.accent) === JSON.stringify(crimson.accentSurface) : null,
    true
  );

  // A bright one has to move, because no text colour can rescue it
  const yellow = extractPalette(pixels([BLACK, 200], [{ r: 250, g: 230, b: 40 }, 300]));
  check(
    "a bright accent is darkened for its chip",
    yellow ? yellow.accentSurface.g < yellow.accent.g : null,
    true
  );
  check(
    "...and the chip is never lighter than the accent",
    yellow
      ? yellow.accentSurface.r <= yellow.accent.r &&
          yellow.accentSurface.g <= yellow.accent.g &&
          yellow.accentSurface.b <= yellow.accent.b
      : null,
    true
  );
}

// The card sits on the surface, so it must be dark enough to read light text on
{
  const palette = extractPalette(pixels([BLACK, 200], [{ r: 250, g: 230, b: 40 }, 300]));
  check(
    "even a bright yellow poster gives a dark card ground",
    palette ? luminance(palette.surface) < 0.2 : null,
    true
  );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
