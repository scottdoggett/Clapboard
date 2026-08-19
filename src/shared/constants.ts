/**
 * Clapboard Constants
 *
 * Central location for configuration constants, supported sites,
 * feature flags, and API endpoints.
 */

/**
 * Shape of a single streaming site's configuration.
 *
 * Adding a platform means adding an entry to SUPPORTED_SITES that satisfies
 * this — a host match, the URL shapes that carry a title, and DOM selectors
 * to read the title out of the page.
 */
export interface SiteConfig {
  readonly name: string;
  /** Substrings matched against `location.hostname` */
  readonly hostPatterns: readonly string[];
  readonly urlPatterns: SiteUrlPatterns;
  readonly selectors: SiteSelectors;
}

/**
 * URL shapes that tell us what a page is showing.
 *
 * The `title` patterns are the gate that keeps the overlay off browse, search,
 * and account pages. Without it a broad heading selector matches every page on
 * the site and we send navigation labels to OMDb.
 *
 * Patterns are regular expression sources tested case-insensitively against
 * `location.pathname`. Most platforms prefix the path with a locale segment
 * (`/en-ca/...`), so the patterns allow for an optional one.
 */
export interface SiteUrlPatterns {
  /** Paths that show a single title */
  readonly title: readonly string[];
  /** Paths that additionally identify the title as a film */
  readonly movie: readonly string[];
  /** Paths that additionally identify the title as a series */
  readonly series: readonly string[];
  /** Query params that open a title over another page (Netflix's jbv modal) */
  readonly titleParams: readonly string[];
}

/**
 * DOM selectors for a platform, each a list of candidates tried in order.
 *
 * Streaming sites ship layout changes constantly and run A/B tests, so a
 * single selector per job is a guarantee of breakage. Order runs from the most
 * specific (a stable test id) to the most generic (a bare heading), and the
 * generic entries are only safe because the URL gate has already run.
 */
export interface SiteSelectors {
  /** Confirms the detail view has rendered */
  readonly titlePage: readonly string[];
  /** Holds the title text */
  readonly titleText: readonly string[];
  /** Where the overlay gets appended */
  readonly overlayAnchor: readonly string[];
  /** Present only for series — an episode list or season picker */
  readonly seriesIndicator: readonly string[];
}

/**
 * Streaming platform names, used to strip branding off page titles.
 *
 * Order matters: longer names come first so "Amazon Prime Video" is matched
 * before "Prime Video" leaves "Amazon" behind.
 */
export const PLATFORM_NAMES = [
  "Amazon Prime Video",
  "Prime Video",
  "Disney Plus",
  "Disney+",
  "Netflix",
  "Crave",
] as const;

/**
 * Supported streaming site configurations
 */
export const SUPPORTED_SITES = {
  netflix: {
    name: "Netflix",
    hostPatterns: ["netflix.com"],
    urlPatterns: {
      // /title/81234567 is the detail page, /watch/81234567 the player
      title: ["^(?:/[a-z]{2}(?:-[a-z]{2})?)?/(?:title|watch)/\\d+"],
      movie: [],
      series: [],
      // Netflix opens a title in a modal over the browse grid and moves the
      // id into ?jbv= rather than changing the path
      titleParams: ["jbv"],
    },
    selectors: {
      titlePage: [
        '[data-uia="modal-motion-container-DETAIL_MODAL"]',
        '[data-uia="previewModal--detailsMetadata"]',
        ".previewModal--container",
        ".watch-video",
      ],
      // Netflix opens a title as a modal *over* the browse grid, so every
      // selector here is scoped inside that modal. The page behind it has a
      // `billboard-title` that looks ideal and belongs to whatever Netflix is
      // promoting — reading it would confidently show the wrong film.
      titleText: [
        '[data-uia="modal-motion-container-DETAIL_MODAL"] img.playerModel--player__storyArt[alt]',
        '[data-uia="modal-motion-container-DETAIL_MODAL"] .previewModal--player-titleTreatment img[alt]',
        '[data-uia="modal-motion-container-DETAIL_MODAL"] img[alt]',
        ".previewModal--player-titleTreatment img[alt]",
        "img.playerModel--player__storyArt[alt]",
        ".watch-video .video-title h4",
      ],
      overlayAnchor: [
        '[data-uia="modal-motion-container-DETAIL_MODAL"]',
        ".previewModal--container",
        ".watch-video",
      ],
      seriesIndicator: ['[data-uia="episode-list"]', ".episodeSelector", ".season-list"],
    },
  },
  disneyPlus: {
    name: "Disney+",
    hostPatterns: ["disneyplus.com"],
    urlPatterns: {
      title: [
        "^(?:/[a-z]{2}(?:-[a-z]{2})?)?/(?:movies|series|video|play)/",
        // Newer entity routes carry a uuid instead of a content-type segment
        "^(?:/[a-z]{2}(?:-[a-z]{2})?)?/browse/entity-",
      ],
      movie: ["^(?:/[a-z]{2}(?:-[a-z]{2})?)?/movies/"],
      series: ["^(?:/[a-z]{2}(?:-[a-z]{2})?)?/series/"],
      titleParams: [],
    },
    selectors: {
      titlePage: [
        '[data-testid="details-page"]',
        '[data-testid="detail-page"]',
        '[data-testid="hero-collection"]',
      ],
      titleText: [
        '[data-testid="details-title"]',
        '[data-testid="hero-title"]',
        ".title-treatment img[alt]",
        "h1",
      ],
      overlayAnchor: ['[data-testid="details-page"]', '[data-testid="detail-page"]'],
      seriesIndicator: [
        '[data-testid="episodes-tab"]',
        '[data-testid="season-select"]',
        '[data-testid="episode-list"]',
      ],
    },
  },
  primeVideo: {
    name: "Prime Video",
    hostPatterns: ["primevideo.com", "amazon.com/gp/video"],
    urlPatterns: {
      // Both primevideo.com/detail/... and amazon.com/gp/video/detail/...
      title: ["/detail/", "/gp/video/detail/"],
      movie: [],
      series: [],
      titleParams: [],
    },
    selectors: {
      titlePage: [
        '[data-automation-id="title"]',
        "[data-testid='title-art']",
        ".dv-node-dp-title",
      ],
      titleText: [
        '[data-automation-id="title"]',
        ".dv-node-dp-title",
        "h1[data-automation-id]",
        "h1",
      ],
      overlayAnchor: [".dv-dp-node-meta", "#dv-action-box", "body"],
      seriesIndicator: [
        '[data-automation-id="ep-title"]',
        '[data-testid="episode-list"]',
        '[data-automation-id="season-selector"]',
      ],
    },
  },
  crave: {
    name: "Crave",
    hostPatterns: ["crave.ca"],
    urlPatterns: {
      title: ["^(?:/[a-z]{2})?/(?:movies|tv-shows)/"],
      movie: ["^(?:/[a-z]{2})?/movies/"],
      series: ["^(?:/[a-z]{2})?/tv-shows/"],
      titleParams: [],
    },
    selectors: {
      titlePage: [".program-details", "[data-testid='content-details']", "main"],
      titleText: [".program-title", "[data-testid='content-title']", "h1"],
      overlayAnchor: [".program-details", "[data-testid='content-details']"],
      seriesIndicator: [".season-selector", ".episode-list", "[data-testid='episodes']"],
    },
  },
} as const satisfies Record<string, SiteConfig>;

/**
 * Type for site keys
 */
export type SupportedSite = keyof typeof SUPPORTED_SITES;

/**
 * Rating source configuration
 */
export const RATING_SOURCES = {
  IMDb: {
    name: "IMDb",
    maxScore: 10,
    url: "https://www.imdb.com",
  },
  RottenTomatoes: {
    name: "Rotten Tomatoes",
    maxScore: 100,
    url: "https://www.rottentomatoes.com",
  },
  Metacritic: {
    name: "Metacritic",
    maxScore: 100,
    url: "https://www.metacritic.com",
  },
  Letterboxd: {
    name: "Letterboxd",
    maxScore: 5,
    url: "https://letterboxd.com",
  },
} as const;

/**
 * Feature flags for gradual rollout
 */
export const FEATURES = {
  // Phase 1: Basic ratings
  RATINGS_ENABLED: true,

  // Phase 2: Awards display
  AWARDS_ENABLED: true,

  // Phase 3: AI-generated scores
  AI_SCORES_ENABLED: false,

  // Phase 4: User accounts and social
  USER_ACCOUNTS_ENABLED: false,

  // Debug features
  DEBUG_LOGGING: process.env.NODE_ENV === "development",
} as const;

/**
 * Storage keys for chrome.storage
 */
export const STORAGE_KEYS = {
  ENABLED: "clapboard_enabled",
  SETTINGS: "clapboard_settings",
  CACHE: "clapboard_cache",
  AI_SCORES: "clapboard_ai_scores",
  CLIENT_ID: "clapboard_client_id",
  USER: "clapboard_user",
} as const;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  // How long to cache movie data (24 hours)
  MOVIE_TTL_MS: 24 * 60 * 60 * 1000,

  // How long to cache ratings (6 hours)
  RATINGS_TTL_MS: 6 * 60 * 60 * 1000,

  // How long to cache AI scores locally. Long, because they're expensive to
  // generate and the reviews behind them barely change after release — the
  // backend holds them for 30 days for the same reason.
  AI_SCORES_TTL_MS: 7 * 24 * 60 * 60 * 1000,

  // Maximum cache entries before cleanup
  MAX_ENTRIES: 500,
} as const;

/**
 * API endpoints (if using direct API calls instead of Convex)
 */
export const API_ENDPOINTS = {
  // Placeholder - actual endpoints depend on backend setup
  CONVEX: process.env.CONVEX_URL || "",
} as const;

/**
 * Extension metadata
 */
export const EXTENSION_INFO = {
  NAME: "Clapboard",
  VERSION: "0.1.0",
  DESCRIPTION:
    "Enrich your streaming experience with ratings, awards, and AI-powered review insights.",
} as const;
