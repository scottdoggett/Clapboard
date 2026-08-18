/**
 * Chrome Runtime Message Types
 *
 * Defines the message protocol for communication between:
 * - Content scripts ↔ Background service worker
 * - Popup ↔ Background service worker
 *
 * Uses discriminated unions for type-safe message handling.
 */

import type { AiScoreResult, MovieData } from "./movie";
import type { ClapboardSettings } from "@shared/utils/storage";

/**
 * Message types enum for better IDE support
 */
export enum MessageType {
  GET_MOVIE_DATA = "GET_MOVIE_DATA",
  AI_SCORE_REQUEST = "AI_SCORE_REQUEST",
  GET_STATUS = "GET_STATUS",
  SET_ENABLED = "SET_ENABLED",
  UPDATE_SETTINGS = "UPDATE_SETTINGS",
  CLEAR_CACHE = "CLEAR_CACHE",
}

/**
 * Request movie metadata, ratings, and awards for a title.
 *
 * This returns everything the overlay needs in one round trip — the backend
 * resolves the title and its ratings together, so splitting it into a second
 * ratings request would only add latency.
 */
export interface GetMovieDataMessage {
  type: "GET_MOVIE_DATA";
  payload: {
    title: string;
    year?: number;
    type?: "movie" | "series";
  };
}

/**
 * Request AI-generated category scores for a title (Phase 3).
 *
 * Separate from GET_MOVIE_DATA because generating scores means a web search
 * and a model call — seconds, and real money. The overlay asks for these only
 * when the user opens the AI section, so browsing past a title costs nothing.
 *
 * The title travels with the request even though the movie is already
 * resolved: scoring searches for reviews by name, and OMDb's canonical title
 * finds them where the streaming site's rendering of it might not.
 */
export interface AiScoreRequestMessage {
  type: "AI_SCORE_REQUEST";
  payload: {
    movieId: string;
    title: string;
    year?: number;
    type?: "movie" | "series";
  };
}

/**
 * Request extension status
 */
export interface GetStatusMessage {
  type: "GET_STATUS";
  payload?: undefined;
}

/**
 * Set extension enabled state
 */
export interface SetEnabledMessage {
  type: "SET_ENABLED";
  payload: {
    enabled: boolean;
  };
}

/**
 * Update one or more settings
 */
export interface UpdateSettingsMessage {
  type: "UPDATE_SETTINGS";
  payload: Partial<ClapboardSettings>;
}

/**
 * Drop every cached lookup
 */
export interface ClearCacheMessage {
  type: "CLEAR_CACHE";
  payload?: undefined;
}

/**
 * Union of all message types
 */
export type Message =
  | GetMovieDataMessage
  | AiScoreRequestMessage
  | GetStatusMessage
  | SetEnabledMessage
  | UpdateSettingsMessage
  | ClearCacheMessage;

/**
 * Extension status reported to the popup
 */
export interface ExtensionStatus {
  /** Whether the overlay is switched on */
  enabled: boolean;
  /** Whether a Convex deployment URL is configured */
  configured: boolean;
  /** The deployment URL in use (empty when unconfigured) */
  convexUrl: string;
  /** Number of lookups currently cached locally */
  cacheSize: number;
  /** Extension version */
  version: string;
}

/**
 * Base response structure
 */
export interface MessageResponseBase {
  success: boolean;
  error?: string;
}

/**
 * Successful response with data
 */
export interface MessageResponseSuccess<T = unknown> extends MessageResponseBase {
  success: true;
  data: T;
}

/**
 * Error response
 */
export interface MessageResponseError extends MessageResponseBase {
  success: false;
  error: string;
  data?: undefined;
}

/**
 * Union of response types
 */
export type MessageResponse<T = unknown> =
  | MessageResponseSuccess<T>
  | MessageResponseError;

/**
 * Response type mapping for each message type
 */
export interface MessageResponseMap {
  GET_MOVIE_DATA: MovieData | null;
  AI_SCORE_REQUEST: AiScoreResult | null;
  GET_STATUS: ExtensionStatus;
  SET_ENABLED: ClapboardSettings;
  UPDATE_SETTINGS: ClapboardSettings;
  CLEAR_CACHE: { cleared: true };
}

/**
 * Helper type to get response data type for a message type
 */
export type ResponseDataFor<T extends Message["type"]> = MessageResponseMap[T];
