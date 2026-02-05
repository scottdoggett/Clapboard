/**
 * DOM Utilities
 *
 * Helper functions for interacting with streaming site DOMs.
 * Each supported site has unique selectors and structures, so these
 * utilities abstract away the platform-specific details.
 */

import { SUPPORTED_SITES, type SupportedSite } from "@shared/constants";

/**
 * Title information extracted from the page
 */
export interface TitleInfo {
  title: string;
  year?: number;
  type?: "movie" | "series";
}

/**
 * Detect which streaming site we're on
 *
 * @returns Site key or null if not on a supported site
 */
export function detectSite(): SupportedSite | null {
  const hostname = window.location.hostname;

  for (const [siteKey, config] of Object.entries(SUPPORTED_SITES)) {
    if (config.hostPatterns.some((pattern) => hostname.includes(pattern))) {
      return siteKey as SupportedSite;
    }
  }

  return null;
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

  // Check if we're on a title page
  const titlePageElement = document.querySelector(config.selectors.titlePage);
  if (!titlePageElement) return null;

  // Extract title text
  const titleElement = document.querySelector(config.selectors.titleText);
  if (!titleElement) return null;

  const rawTitle = titleElement.textContent?.trim();
  if (!rawTitle) return null;

  // Parse title and year (many titles include year in format "Title (2023)")
  const { title, year } = parseTitle(rawTitle);

  return {
    title,
    year,
    type: detectContentType(site),
  };
}

/**
 * Parse title string to extract year if present
 *
 * @param rawTitle - Raw title string, possibly with year
 * @returns Parsed title and year
 */
function parseTitle(rawTitle: string): { title: string; year?: number } {
  // Match patterns like "Movie Title (2023)" or "Show Name (2019-2023)"
  const yearMatch = rawTitle.match(/^(.+?)\s*\((\d{4})(?:-\d{4})?\)\s*$/);

  if (yearMatch) {
    return {
      title: yearMatch[1].trim(),
      year: parseInt(yearMatch[2], 10),
    };
  }

  return { title: rawTitle };
}

/**
 * Detect if current content is a movie or series
 *
 * @param site - Current streaming site
 * @returns Content type or undefined if unknown
 */
function detectContentType(site: SupportedSite): "movie" | "series" | undefined {
  // TODO: Implement platform-specific detection logic
  // Each platform has different indicators for movies vs series
  // (e.g., presence of episode list, "Season" text, URL patterns)

  // Placeholder: try to detect from URL
  const url = window.location.href.toLowerCase();

  if (url.includes("/movie/") || url.includes("/film/")) {
    return "movie";
  }

  if (url.includes("/series/") || url.includes("/show/") || url.includes("/tv/")) {
    return "series";
  }

  return undefined;
}

/**
 * Get the best anchor element for positioning the overlay
 *
 * @returns DOM element to anchor the overlay to, or null
 */
export function getOverlayAnchor(): Element | null {
  const site = detectSite();
  if (!site) return null;

  const config = SUPPORTED_SITES[site];
  return document.querySelector(config.selectors.overlayAnchor);
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
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    // Set up observer
    const observer = new MutationObserver((_, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Timeout
    setTimeout(() => {
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
