/**
 * Colour Utilities
 *
 * The maths behind theming the overlay from a film's poster. Pure — it takes
 * raw pixel data and returns colours — so `npm run verify:color` can check it
 * without a canvas, and so the contrast guarantees below are actually
 * verifiable rather than merely intended.
 *
 * Both poster CDNs (`m.media-amazon.com`, `image.tmdb.org`) send
 * `Access-Control-Allow-Origin: *`, which is what makes reading the pixels
 * possible at all — a tainted canvas would throw on `getImageData`.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  /**
   * The poster's most characteristic colour, at full strength. Decorative
   * only — bars, borders, glows. Text is *not* placed on this, because at
   * mid lightness neither white nor black clears the contrast floor against a
   * saturated colour, and no choice of text colour can fix that.
   */
  accent: Rgb;
  /**
   * The accent darkened until white text is guaranteed readable on it. This is
   * what chips and badges use.
   */
  accentSurface: Rgb;
  /** A dark ground derived from the accent, for the card itself */
  surface: Rgb;
  /** Text colour guaranteed readable on `surface` */
  onSurface: Rgb;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 17, g: 17, b: 19 };

/**
 * Contrast floor for body text, from WCAG AA.
 *
 * Posters are arbitrary images, so a palette taken from one can land anywhere;
 * without a floor the card would occasionally render dark grey on black. Every
 * colour returned by `extractPalette` is checked against this.
 */
const MIN_CONTRAST = 4.5;

/**
 * Relative luminance, per WCAG 2.1.
 */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio between two colours, from 1 (identical) to 21 (black/white).
 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];

  return (light + 0.05) / (dark + 0.05);
}

/**
 * Pick whichever of white or near-black reads better on a background.
 *
 * Near-black rather than pure black: a true #000 against a coloured card looks
 * like a hole rather than like text.
 */
export function readableOn(background: Rgb): Rgb {
  return contrast(WHITE, background) >= contrast(NEAR_BLACK, background)
    ? WHITE
    : NEAR_BLACK;
}

/**
 * Saturation and lightness, on 0-1, without the full HSL conversion.
 */
function saturationOf({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;

  const lightness = (max + min) / 2;
  return lightness > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
}

function lightnessOf({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) / 255 + Math.min(r, g, b) / 255) / 2;
}

/**
 * Move a colour towards black.
 */
export function darken(color: Rgb, amount: number): Rgb {
  const keep = Math.max(0, Math.min(1, 1 - amount));
  return {
    r: Math.round(color.r * keep),
    g: Math.round(color.g * keep),
    b: Math.round(color.b * keep),
  };
}

/**
 * Push a colour away from grey, so a washed-out poster still gives the card
 * some character rather than a wall of slate.
 */
export function vivify(color: Rgb, amount: number): Rgb {
  const mean = (color.r + color.g + color.b) / 3;
  const push = (channel: number): number =>
    Math.round(Math.max(0, Math.min(255, mean + (channel - mean) * (1 + amount))));

  return { r: push(color.r), g: push(color.g), b: push(color.b) };
}

export function toCss({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function toCssAlpha({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * How much a colour is worth using as an accent.
 *
 * Posters are mostly dark backgrounds and skin tones; the colour worth pulling
 * out is the one that is *saturated* rather than the one that is most common.
 * Near-black and near-white are excluded outright — a poster is usually
 * majority black, and taking the most frequent colour would return that every
 * time, making every card identical.
 */
function accentScore(color: Rgb, count: number): number {
  const saturation = saturationOf(color);
  const lightness = lightnessOf(color);

  if (lightness < 0.12 || lightness > 0.93) return 0;
  if (saturation < 0.12) return 0;

  // Mid lightness reads best against a dark card
  const lightnessFit = 1 - Math.abs(lightness - 0.5) * 1.4;

  return count * saturation * Math.max(0.1, lightnessFit);
}

/**
 * Derive a palette from an image's pixels.
 *
 * @param pixels - RGBA bytes, as `CanvasRenderingContext2D.getImageData` returns
 * @returns A palette, or null when the image gave nothing usable
 */
export function extractPalette(pixels: Uint8ClampedArray): Palette | null {
  if (pixels.length < 4) return null;

  // Quantize to 4 bits per channel: enough to group shades of the same colour
  // without merging genuinely different ones
  const buckets = new Map<number, { total: Rgb; count: number }>();

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 128) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.total.r += r;
      bucket.total.g += g;
      bucket.total.b += b;
      bucket.count++;
    } else {
      buckets.set(key, { total: { r, g, b }, count: 1 });
    }
  }

  if (buckets.size === 0) return null;

  let best: Rgb | null = null;
  let bestScore = 0;

  for (const { total, count } of buckets.values()) {
    const average: Rgb = {
      r: Math.round(total.r / count),
      g: Math.round(total.g / count),
      b: Math.round(total.b / count),
    };

    const score = accentScore(average, count);
    if (score > bestScore) {
      bestScore = score;
      best = average;
    }
  }

  // A poster with no saturated colour at all — black and white film, stark
  // artwork — gets a neutral treatment rather than a bad guess
  if (!best) return null;

  const accent = vivify(best, 0.25);
  const surface = darken(accent, 0.86);

  return {
    accent,
    accentSurface: darkenUntilReadable(accent, WHITE),
    surface,
    onSurface: ensureContrast(readableOn(surface), surface),
  };
}

/**
 * Darken a colour until the given text colour is readable on it.
 *
 * A saturated mid-lightness colour — crimson, teal, orange — fails the
 * contrast floor against both white and black, so a badge using it as a
 * background cannot be made readable by picking a different text colour. The
 * background itself has to move. Terminates because black clears the floor
 * against white at ratio 21.
 */
function darkenUntilReadable(color: Rgb, text: Rgb): Rgb {
  let candidate = color;

  for (let step = 0; step < 20; step++) {
    if (contrast(text, candidate) >= MIN_CONTRAST) return candidate;
    candidate = darken(candidate, 0.12);
  }

  return { r: 0, g: 0, b: 0 };
}

/**
 * Guarantee a text colour clears the contrast floor, falling back to plain
 * white or black if the derived pair doesn't.
 */
function ensureContrast(text: Rgb, background: Rgb): Rgb {
  if (contrast(text, background) >= MIN_CONTRAST) return text;

  return contrast(WHITE, background) >= contrast({ r: 0, g: 0, b: 0 }, background)
    ? WHITE
    : { r: 0, g: 0, b: 0 };
}
