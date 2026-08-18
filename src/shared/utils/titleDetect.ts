/**
 * Title Detection Primitives
 *
 * The pure half of "what is the user looking at?". Everything here takes
 * plain strings and config objects rather than touching the DOM, so it can be
 * exercised by `npm run verify:detection` without a browser — the same split
 * `convex/omdbParse.ts` uses for the OMDb responses.
 *
 * `src/shared/utils/dom.ts` supplies the DOM half: it reads the page and hands
 * the raw strings to these functions.
 */

import type { SiteConfig } from "@shared/constants";
import { PLATFORM_NAMES } from "@shared/constants";

/**
 * Title information extracted from the page
 */
export interface TitleInfo {
  title: string;
  year?: number;
  type?: "movie" | "series";
}

/**
 * A title candidate plus where it came from.
 *
 * The source matters when deciding what to trust: values read from the live
 * DOM follow client-side navigation, values baked into the document at load
 * time do not.
 */
export interface TitleCandidate {
  raw: string;
  source: "dom" | "jsonld" | "meta" | "documentTitle";
  year?: number;
  type?: "movie" | "series";
}

/**
 * Titles that are page furniture rather than content.
 *
 * Streaming sites reuse the same heading element for the browse grid, the
 * account page, and the title detail page, so a heading match alone doesn't
 * mean we found a film.
 */
const NON_TITLE_HEADINGS = new Set([
  "home",
  "browse",
  "search",
  "my list",
  "my stuff",
  "watchlist",
  "continue watching",
  "new and popular",
  "new & popular",
  "movies",
  "tv shows",
  "series",
  "trending now",
  "sign in",
  "account",
  "settings",
  "watch now",
  "error",
  "page not found",
]);

/** Longest title we'll believe. Anything longer is a synopsis or a nav dump. */
const MAX_TITLE_LENGTH = 150;

/**
 * Does this URL look like a page that shows a single title?
 *
 * This is the gate that keeps the overlay off browse and home pages. Every
 * supported platform routes title detail through a distinct path, and Netflix
 * additionally opens a title in a modal over the grid with the id in a query
 * param.
 *
 * @param config - Site configuration from SUPPORTED_SITES
 * @param url - The URL to test
 * @returns True if the URL identifies a single title
 */
export function isTitleUrl(config: SiteConfig, url: URL): boolean {
  const path = url.pathname;

  if (config.urlPatterns.title.some((p) => new RegExp(p, "i").test(path))) {
    return true;
  }

  return config.urlPatterns.titleParams.some((param) => {
    const value = url.searchParams.get(param);
    return value !== null && value.length > 0;
  });
}

/**
 * Infer movie vs. series from the URL alone.
 *
 * Disney+ and Crave both put the content type in the path, which is more
 * reliable than waiting for an episode list to render.
 *
 * @param config - Site configuration from SUPPORTED_SITES
 * @param url - The URL to inspect
 * @returns Content type, or undefined when the path doesn't say
 */
export function contentTypeFromUrl(
  config: SiteConfig,
  url: URL
): "movie" | "series" | undefined {
  const path = url.pathname;

  if (config.urlPatterns.movie.some((p) => new RegExp(p, "i").test(path))) {
    return "movie";
  }

  if (config.urlPatterns.series.some((p) => new RegExp(p, "i").test(path))) {
    return "series";
  }

  return undefined;
}

/**
 * Strip platform chrome from a raw title string.
 *
 * Page titles and headings arrive wrapped in branding ("Watch Inception |
 * Prime Video"), episode markers ("S2 E4 · The Bear"), and trailer labels.
 * OMDb matches on the bare title, so all of that has to come off.
 *
 * @param raw - Title string as read from the page
 * @returns Cleaned title, possibly empty if nothing survived
 */
export function cleanTitle(raw: string): string {
  let title = raw.replace(/\s+/g, " ").trim();

  // Leading "<Platform>: " prefix, e.g. "Prime Video: Inception"
  for (const platform of PLATFORM_NAMES) {
    const prefix = new RegExp(`^${escapeRegExp(platform)}\\s*[:|-]\\s*`, "i");
    title = title.replace(prefix, "");
  }

  // Trailing " | <Platform>" / " - <Platform>" branding, applied repeatedly
  // because some pages stack two ("Inception - Watch Now | Prime Video")
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    const parts = splitOnSeparator(title);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (isPlatformChrome(last)) {
        title = parts.slice(0, -1).join(" | ").trim();
        trimmed = true;
      }
    }
  }

  // "Watch " verb prefix that Prime Video and Netflix put on page titles
  title = title.replace(/^watch\s+/i, "");

  // Episode markers: "S2 E4 · Title", "S2:E4 Title"
  title = title.replace(/^s\d+\s*[:·.\-\s]\s*e\d+\s*[:·.\-\s]*\s*/i, "");

  // Season suffixes: "The Bear - Season 2", "The Bear: Season 2"
  title = title.replace(/\s*[-–—:|]\s*season\s+\d+\s*$/i, "");

  // Trailer and extras labels
  title = title.replace(
    /\s*[-–—:|(]\s*(official\s+)?(trailer|teaser|clip|preview|extras?)\s*\)?\s*$/i,
    ""
  );

  return title.replace(/\s+/g, " ").trim();
}

/**
 * Split a title on the separators platforms use to append branding.
 *
 * Colons are deliberately not separators — far too many films use one
 * ("Spider-Man: No Way Home").
 */
function splitOnSeparator(title: string): string[] {
  return title
    .split(/\s+[|–—]\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Is this trailing segment platform branding rather than part of the title?
 */
function isPlatformChrome(segment: string): boolean {
  const normalized = segment.toLowerCase().replace(/\s+/g, " ").trim();

  if (PLATFORM_NAMES.some((p) => p.toLowerCase() === normalized)) return true;

  return (
    normalized === "watch now" ||
    normalized === "official site" ||
    normalized === "streaming online"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pull a trailing year out of a title.
 *
 * Detail pages often render "Inception (2010)" or "The Bear (2022-2024)" in
 * the heading. The year narrows the OMDb match considerably, so it's worth
 * separating rather than passing through as part of the title.
 *
 * @param raw - Title string, possibly with a parenthesised year
 * @returns The title without the year, plus the year when present
 */
export function parseTitleYear(raw: string): { title: string; year?: number } {
  const match = raw.match(/^(.+?)\s*\((\d{4})(?:\s*[-–—]\s*(?:\d{4})?)?\)\s*$/);

  if (match) {
    const year = parseInt(match[2], 10);
    // Guard against parenthesised numbers that aren't release years
    if (year >= 1888 && year <= new Date().getFullYear() + 5) {
      return { title: match[1].trim(), year };
    }
  }

  return { title: raw.trim() };
}

/**
 * Does this string look like an actual title?
 *
 * The check runs after cleaning, so it's the last line of defence against
 * sending navigation labels and empty headings to OMDb.
 *
 * @param title - Cleaned title string
 * @returns True if the string is worth looking up
 */
export function isPlausibleTitle(title: string): boolean {
  const trimmed = title.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) return false;

  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");

  if (NON_TITLE_HEADINGS.has(normalized)) return false;
  if (PLATFORM_NAMES.some((p) => p.toLowerCase() === normalized)) return false;

  // Needs at least one letter or digit — a heading of punctuation is chrome
  return /[a-z0-9]/i.test(trimmed);
}

/**
 * Schema.org types that identify a watchable title.
 */
const JSONLD_MOVIE_TYPES = new Set(["movie", "videoobject", "creativework"]);
const JSONLD_SERIES_TYPES = new Set([
  "tvseries",
  "tvepisode",
  "tvseason",
  "televisionseries",
  "episode",
]);

/**
 * Extract title information from a JSON-LD block.
 *
 * Streaming sites publish schema.org metadata for search engines, which is
 * both more stable than their CSS class names and already structured — it
 * carries the release date and the movie/series distinction outright.
 *
 * The caveat is freshness: this markup is baked in at page load and these are
 * all single-page apps, so it must only be trusted on a document that hasn't
 * client-side navigated since. `dom.ts` enforces that.
 *
 * @param text - Raw contents of an application/ld+json script tag
 * @returns Title info, or null if the block holds no watchable title
 */
export function parseJsonLd(text: string): TitleInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  for (const node of flattenJsonLd(data)) {
    const info = titleFromJsonLdNode(node);
    if (info) return info;
  }

  return null;
}

/**
 * Walk the shapes JSON-LD arrives in: a bare object, an array of them, or a
 * `@graph` wrapper.
 */
function flattenJsonLd(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.flatMap((item) => flattenJsonLd(item));
  }

  if (data === null || typeof data !== "object") return [];

  const node = data as Record<string, unknown>;
  const nodes = [node];

  if (Array.isArray(node["@graph"])) {
    nodes.push(...flattenJsonLd(node["@graph"]));
  }

  return nodes;
}

function titleFromJsonLdNode(node: Record<string, unknown>): TitleInfo | null {
  const types = normalizeJsonLdTypes(node["@type"]);
  if (types.length === 0) return null;

  const isMovie = types.some((t) => JSONLD_MOVIE_TYPES.has(t));
  const isSeries = types.some((t) => JSONLD_SERIES_TYPES.has(t));
  if (!isMovie && !isSeries) return null;

  // For an episode, the series is what OMDb can match — the episode name
  // alone ("Fishes") is meaningless without it.
  const seriesName = readSeriesName(node);
  const rawName = seriesName ?? readString(node["name"]);
  if (!rawName) return null;

  const cleaned = cleanTitle(rawName);
  if (!isPlausibleTitle(cleaned)) return null;

  const { title, year } = parseTitleYear(cleaned);

  return {
    title,
    year: year ?? readYear(node),
    // A bare CreativeWork says nothing about movie vs. series
    type: isSeries ? "series" : types.includes("creativework") ? undefined : "movie",
  };
}

function normalizeJsonLdTypes(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  }
  return [];
}

function readSeriesName(node: Record<string, unknown>): string | null {
  const parent = node["partOfSeries"];
  if (parent !== null && typeof parent === "object") {
    return readString((parent as Record<string, unknown>)["name"]);
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readYear(node: Record<string, unknown>): number | undefined {
  for (const key of ["datePublished", "dateCreated", "copyrightYear", "startDate"]) {
    const value = node[key];
    if (typeof value === "number" && value >= 1888) return value;
    if (typeof value === "string") {
      const match = value.match(/(\d{4})/);
      if (match) {
        const year = parseInt(match[1], 10);
        if (year >= 1888) return year;
      }
    }
  }
  return undefined;
}

/**
 * Turn a raw candidate string into title info, or null if it doesn't survive
 * cleaning.
 *
 * @param raw - Raw string from the page
 * @param fallbackType - Content type inferred elsewhere (usually from the URL)
 * @returns Title info, or null when the string isn't a usable title
 */
export function buildTitleInfo(
  raw: string,
  fallbackType?: "movie" | "series"
): TitleInfo | null {
  const cleaned = cleanTitle(raw);
  if (!isPlausibleTitle(cleaned)) return null;

  const { title, year } = parseTitleYear(cleaned);
  if (!isPlausibleTitle(title)) return null;

  return { title, year, type: fallbackType };
}

/**
 * Pick the best candidate from everything the page offered.
 *
 * Candidates are already ordered by the caller's trust in their source; this
 * takes the first usable one and fills in fields the winner didn't supply
 * from the ones that follow. A DOM heading knows the current title but rarely
 * the year; JSON-LD knows the year but may be stale.
 *
 * @param candidates - Candidates in descending order of trust
 * @param fallbackType - Content type inferred from the URL
 * @returns Merged title info, or null when nothing was usable
 */
export function selectTitle(
  candidates: TitleCandidate[],
  fallbackType?: "movie" | "series"
): TitleInfo | null {
  const resolved: TitleInfo[] = [];

  for (const candidate of candidates) {
    const info = buildTitleInfo(candidate.raw, candidate.type ?? fallbackType);
    if (info) resolved.push({ ...info, year: info.year ?? candidate.year });
  }

  const winner = resolved[0];
  if (!winner) return null;

  return {
    title: winner.title,
    year: winner.year ?? resolved.find((info) => info.year !== undefined)?.year,
    type: winner.type ?? resolved.find((info) => info.type !== undefined)?.type,
  };
}
