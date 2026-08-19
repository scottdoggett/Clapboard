/**
 * usePosterPalette Hook
 *
 * Derives the overlay's colours from the film's own poster, so the card looks
 * like it belongs to what you're looking at rather than like a browser
 * extension bolted onto the page.
 *
 * This works only because both poster CDNs (`m.media-amazon.com` and
 * `image.tmdb.org`) send `Access-Control-Allow-Origin: *`. Without that the
 * canvas would be tainted and `getImageData` would throw — which is exactly
 * what the try/catch below is for, since a CDN could change its mind.
 *
 * The palette is a nicety. Every failure path returns null and the card falls
 * back to its neutral theme.
 */

import { useState, useEffect } from "react";
import { extractPalette, type Palette } from "@shared/utils/color";

/**
 * Downsample size for sampling.
 *
 * Sampling every pixel of a 500px poster is ~250k iterations for a result that
 * is visually identical to this. The browser's own scaler does the averaging.
 */
const SAMPLE_SIZE = 48;

/**
 * Read a poster's palette.
 *
 * @param posterUrl - Poster URL, or undefined when the title has none
 * @returns The palette once loaded, or null
 */
export function usePosterPalette(posterUrl: string | undefined): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);

  useEffect(() => {
    setPalette(null);
    if (!posterUrl) return;

    // The poster may still be loading when the user navigates on; this flag
    // stops a late decode from theming the card for the previous film
    let active = true;

    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (!active) return;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;

        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        if (active) setPalette(extractPalette(data));
      } catch (error) {
        // A tainted canvas throws here. Nothing to do but stay neutral.
        console.warn("[Clapboard] Couldn't read poster colours:", error);
      }
    };

    image.onerror = () => {
      if (active) setPalette(null);
    };

    image.src = posterUrl;

    return () => {
      active = false;
    };
  }, [posterUrl]);

  return palette;
}

export default usePosterPalette;
