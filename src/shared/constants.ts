/**
 * Clapboard Constants
 *
 * Central location for configuration constants, supported sites,
 * feature flags, and API endpoints.
 */

/**
 * Supported streaming site configurations
 */
export const SUPPORTED_SITES = {
  netflix: {
    name: "Netflix",
    hostPatterns: ["netflix.com"],
    // CSS selectors for detecting title pages and positioning overlay
    selectors: {
      // Selector for the element that indicates we're on a title detail page
      titlePage: '[data-uia="title-info"]',
      // Selector for extracting the movie/show title
      titleText: '[data-uia="title-info"] h1, .title-title',
      // Selector for the overlay anchor point
      overlayAnchor: ".detail-modal, .watch-video",
    },
  },
  disneyPlus: {
    name: "Disney+",
    hostPatterns: ["disneyplus.com"],
    selectors: {
      titlePage: '[data-testid="details-page"]',
      titleText: '[data-testid="details-title"]',
      overlayAnchor: '[data-testid="details-page"]',
    },
  },
  primeVideo: {
    name: "Prime Video",
    hostPatterns: ["primevideo.com", "amazon.com/gp/video"],
    selectors: {
      titlePage: '[data-automation-id="title-detail-page"]',
      titleText: '[data-automation-id="title"]',
      overlayAnchor: ".dv-dp-node-meta-info",
    },
  },
  crave: {
    name: "Crave",
    hostPatterns: ["crave.ca"],
    selectors: {
      titlePage: ".program-details",
      titleText: ".program-title",
      overlayAnchor: ".program-details",
    },
  },
} as const;

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
