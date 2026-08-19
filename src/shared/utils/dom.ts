/**
 * DOM Utilities
 *
 * The DOM half of title detection. These functions read the streaming site's
 * page; the decisions about what the strings mean live in
 * `src/shared/utils/titleDetect.ts`, which stays pure so it can be verified
 * without a browser (`npm run verify:detection`).
 *
 * Detection runs in layers, most trustworthy first:
 *
 *   1. The URL must look like a title page at all. This is a hard gate — the
 *      heading selectors below are deliberately broad, and without it they
 *      match the browse grid, search results, and the account page.
 *   2. Platform CSS selectors, tried in order. Read from the live DOM, so they
 *      always reflect the title currently on screen.
 *   3. schema.org JSON-LD, then Open Graph tags, then the document title.
 *      These are structured and stable across redesigns, but they're baked
 *      into the document at load — on a single-page app they go stale the
 *      moment the user navigates, so they're only consulted while the document
 *      is still showing what it was served with.
 */

import { SUPPORTED_SITES, type SupportedSite } from "@shared/constants";
import {
  isTitleUrl,
  contentTypeFromUrl,
  parseJsonLd,
  parseMetadataText,
  selectTitle,
  type TitleCandidate,
  type TitleInfo,
} from "@shared/utils/titleDetect";

export type { TitleInfo } from "@shared/utils/titleDetect";

/**
 * The URL the document was served with.
 *
 * Captured at module load, which for a content script is the moment the page
 * loads. If the current URL still matches, nothing has client-side navigated
 * and the document's baked-in metadata still describes what's on screen.
 */
const initialHref = typeof window !== "undefined" ? window.location.href : "";

/**
 * Detect which streaming site we're on
 *
 * @returns Site key or null if not on a supported site
 */
export function detectSite(): SupportedSite | null {
  const hostname = window.location.hostname;
  const href = window.location.href;

  for (const [siteKey, config] of Object.entries(SUPPORTED_SITES)) {
    // Prime Video lives under a path on amazon.com, so some host patterns
    // include one and have to be matched against the full URL
    const matches = config.hostPatterns.some((pattern) =>
      pattern.includes("/") ? href.includes(pattern) : hostname.includes(pattern)
    );
    if (matches) return siteKey as SupportedSite;
  }

  return null;
}

/**
 * Is the current page showing a single title?
 *
 * Exposed separately from `detectCurrentTitle` because "not a title page" and
 * "title page whose heading hasn't rendered yet" call for different handling —
 * the first means hide the overlay, the second means wait.
 *
 * @returns True if the URL identifies a single title
 */
export function isOnTitlePage(): boolean {
  const site = detectSite();
  if (!site) return false;

  return isTitleUrl(SUPPORTED_SITES[site], new URL(window.location.href));
}

/**
 * Detect if we're on a title detail page and extract title information
 *
 * @returns Title info or null if not on a title page
 */
export function detectCurrentTitle(): TitleInfo | null {
  const site = detectSite();
  if (!site) return null;

  const config = SUPPORTED_SITES[site];
  const url = new URL(window.location.href);

  // Gate: nothing below is trustworthy on a browse or account page
  if (!isTitleUrl(config, url)) return null;

  const urlType = contentTypeFromUrl(config, url);

  // The platform's own metadata line, where it has one. This is the only place
  // a year comes from on most pages, and the year is what separates a remake
  // from its original.
  const metadata = readMetadata(config.selectors.metadata, config.selectors.titlePage);

  const candidates: TitleCandidate[] = [];

  // Layer 1 — live DOM, ordered from most to least specific selector
  for (const selector of config.selectors.titleText) {
    const raw = readTitleText(selector);
    if (raw) candidates.push({ raw, source: "dom" });
  }

  // Layer 2 — structured metadata, only while it still describes this page
  if (isDocumentFresh()) {
    candidates.push(...readStructuredCandidates());
  }

  // Layer 3 — the tab title, which is exempt from the freshness rule above.
  // JSON-LD and og:title are baked into the served HTML and go stale the
  // moment a single-page app navigates; the tab title is the opposite — the
  // router actively maintains it, because users navigate by it. On Netflix it
  // is the only correct title on the page after opening a preview modal.
  const docTitle = document.title?.trim();
  if (docTitle && docTitle.toLowerCase() !== config.name.toLowerCase()) {
    candidates.push({ raw: docTitle, source: "documentTitle" });
  }

  const info = selectTitle(
    candidates,
    urlType ?? metadata.type ?? detectContentType(site)
  );

  // A year read off the page beats none; a year already carried by a candidate
  // (JSON-LD's release date) is more precise and keeps precedence.
  return info && info.year === undefined && metadata.year !== undefined
    ? { ...info, year: metadata.year }
    : info;
}

/**
 * How much of a detail view to scan when no dedicated metadata element matched.
 *
 * These pages put the facts line above the synopsis, so the opening stretch of
 * text is metadata and the rest is prose. Reading the whole thing would let a
 * synopsis — "set in 1929", "a series of events" — override the real answer.
 */
const METADATA_SCAN_LIMIT = 220;

/**
 * Read the year and type out of the platform's metadata region.
 *
 * Tries the dedicated selectors first. When none matches — which is the normal
 * case on a site that has changed its markup since these were written — it
 * falls back to the opening text of the detail view itself. That fallback is
 * what makes this survive a selector going stale, which on the evidence so far
 * is a matter of when rather than whether.
 *
 * @param selectors - Candidate selectors for the metadata element
 * @param containerSelectors - The detail view, used as a last resort
 * @returns Whatever could be established
 */
function readMetadata(
  selectors: readonly string[],
  containerSelectors: readonly string[]
): { year?: number; type?: "movie" | "series" } {
  for (const selector of selectors) {
    const text = safeQuerySelector(selector)?.textContent?.trim();
    if (!text) continue;

    const parsed = parseMetadataText(text);
    if (parsed.year !== undefined || parsed.type !== undefined) return parsed;
  }

  for (const selector of containerSelectors) {
    const text = safeQuerySelector(selector)?.textContent?.trim();
    if (!text) continue;

    // Strict: this text may be prose, and a year in a synopsis produced a
    // confidently wrong answer on a live page
    const parsed = parseMetadataText(text.slice(0, METADATA_SCAN_LIMIT), undefined, {
      strictYear: true,
    });
    if (parsed.year !== undefined || parsed.type !== undefined) return parsed;
  }

  return {};
}

/**
 * Has the document navigated since it was served?
 *
 * Single-page apps rewrite the URL without reloading, which leaves JSON-LD,
 * Open Graph tags, and often the document title describing the previous page.
 */
function isDocumentFresh(): boolean {
  return window.location.href === initialHref;
}

/**
 * Read title text from an element, handling the image-based title treatments
 * Disney+ and Netflix use in place of a text heading.
 */
function readTitleText(selector: string): string | null {
  const element = safeQuerySelector(selector);
  if (!element) return null;

  // A logo image carries the title in its alt text
  if (element instanceof HTMLImageElement) {
    const alt = element.alt?.trim();
    return alt && alt.length > 0 ? alt : null;
  }

  const text = element.textContent?.trim();
  return text && text.length > 0 ? text : null;
}

/**
 * Collect title candidates from the document's structured metadata.
 *
 * Only the parts baked in at load — the tab title is handled by the caller,
 * which trusts it regardless of navigation.
 *
 * @returns Candidates in descending order of trust
 */
function readStructuredCandidates(): TitleCandidate[] {
  const candidates: TitleCandidate[] = [];

  // schema.org JSON-LD — carries the year and the movie/series distinction
  for (const script of safeQuerySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent;
    if (!text) continue;

    const info = parseJsonLd(text);
    if (info) {
      candidates.push({
        raw: info.title,
        source: "jsonld",
        year: info.year,
        type: info.type,
      });
    }
  }

  // Open Graph / Twitter card titles
  for (const selector of [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="title"]',
  ]) {
    const meta = safeQuerySelector(selector);
    const content = meta?.getAttribute("content")?.trim();
    if (content) candidates.push({ raw: content, source: "meta" });
  }

  return candidates;
}

/**
 * Detect if current content is a movie or series from DOM markers.
 *
 * Only reached when the URL didn't say. Every supported site renders an
 * episode list or season picker for series and nothing equivalent for films.
 *
 * @param site - Current streaming site
 * @returns Content type or undefined if unknown
 */
function detectContentType(site: SupportedSite): "movie" | "series" | undefined {
  const indicators = SUPPORTED_SITES[site].selectors.seriesIndicator;

  if (indicators.some((selector) => safeQuerySelector(selector))) {
    return "series";
  }

  // No marker isn't proof it's a film — the episode list may not have
  // rendered yet — so stay undecided and let the backend match on title alone.
  return undefined;
}

/**
 * Where the overlay should be spliced into the page's own layout.
 *
 * Returning null means this platform has no verified splice point and the
 * overlay falls back to floating — which is the honest answer for the three
 * sites whose structure has never been checked against reality.
 *
 * @returns The reference element and which side to insert on, or null
 */
export function getInlineTarget(): {
  reference: Element;
  placement: "before" | "after";
} | null {
  const site = detectSite();
  if (!site) return null;

  const inline = SUPPORTED_SITES[site].selectors.inline;
  if (!inline) return null;

  for (const selector of inline.anchor) {
    const anchor = safeQuerySelector(selector);
    if (!anchor) continue;

    // The element identifying the spot is often nested inside the one that
    // occupies the layout slot; insert next to the outer one
    const lifted = inline.lift ? anchor.closest(inline.lift) : null;
    const reference = lifted ?? anchor;

    if (reference.parentElement) {
      return { reference, placement: inline.placement };
    }
  }

  return null;
}

/**
 * Get the best anchor element for positioning the overlay
 *
 * @returns DOM element to anchor the overlay to, or null
 */
export function getOverlayAnchor(): Element | null {
  const site = detectSite();
  if (!site) return null;

  for (const selector of SUPPORTED_SITES[site].selectors.overlayAnchor) {
    const element = safeQuerySelector(selector);
    if (element) return element;
  }

  return null;
}

/**
 * Poll for a readable title until one appears or the deadline passes.
 *
 * Waiting for the *container* to render is not enough, and assuming otherwise
 * was a real bug: Netflix inserts its modal immediately but fills in the story
 * art and updates the tab title afterwards, so a check triggered by the
 * container's arrival ran while the title was still milliseconds away and gave
 * up. The only reliable signal that a title is readable is reading it.
 *
 * @param timeout - Maximum time to wait in ms
 * @param intervalMs - Gap between attempts
 * @returns The title once readable, or null on timeout
 */
export function waitForTitle(
  timeout: number = 5000,
  intervalMs: number = 200
): Promise<TitleInfo | null> {
  const deadline = Date.now() + timeout;

  return new Promise((resolve) => {
    const attempt = (): void => {
      const info = detectCurrentTitle();
      if (info) {
        resolve(info);
        return;
      }

      // Re-check the gate each time: the user may have closed the modal or
      // navigated away while we were waiting, and continuing to poll a page
      // that is no longer a title page just delays the caller
      if (!isOnTitlePage() || Date.now() >= deadline) {
        resolve(null);
        return;
      }

      setTimeout(attempt, intervalMs);
    };

    attempt();
  });
}

/**
 * Wait for an element to appear in the DOM
 *
 * @param selector - CSS selector for the element
 * @param timeout - Maximum time to wait in ms
 * @returns Promise resolving to the element or null on timeout
 */
export function waitForElement(
  selector: string,
  timeout: number = 5000
): Promise<Element | null> {
  return new Promise((resolve) => {
    // Check if already present
    const existing = safeQuerySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    // Set up observer
    const observer = new MutationObserver((_, obs) => {
      const element = safeQuerySelector(selector);
      if (element) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Timeout
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * Safely query for an element with error handling
 *
 * @param selector - CSS selector
 * @param context - Optional parent element to search within
 * @returns Element or null
 */
export function safeQuerySelector(
  selector: string,
  context: ParentNode = document
): Element | null {
  try {
    return context.querySelector(selector);
  } catch (error) {
    console.warn("[Clapboard] Invalid selector:", selector, error);
    return null;
  }
}

/**
 * Safely query for multiple elements with error handling
 *
 * @param selector - CSS selector
 * @param context - Optional parent element to search within
 * @returns Array of elements (empty if error)
 */
export function safeQuerySelectorAll(
  selector: string,
  context: ParentNode = document
): Element[] {
  try {
    return Array.from(context.querySelectorAll(selector));
  } catch (error) {
    console.warn("[Clapboard] Invalid selector:", selector, error);
    return [];
  }
}

/**
 * Create a unique ID for the Clapboard overlay container
 *
 * @returns Unique ID string
 */
export function createOverlayId(): string {
  return `clapboard-overlay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
