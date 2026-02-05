/**
 * Chrome Runtime Message Types
 *
 * Defines the message protocol for communication between:
 * - Content scripts ↔ Background service worker
 * - Popup ↔ Background service worker
 *
 * Uses discriminated unions for type-safe message handling.
 */

import type { Movie, Rating, AiScores } from "./movie";

/**
 * Message types enum for better IDE support
 */
export enum MessageType {
  GET_MOVIE_DATA = "GET_MOVIE_DATA",
  FETCH_RATINGS = "FETCH_RATINGS",
  AI_SCORE_REQUEST = "AI_SCORE_REQUEST",
  GET_STATUS = "GET_STATUS",
  SET_ENABLED = "SET_ENABLED",
}

/**
 * Request to get movie data by title
 */
export interface GetMovieDataMessage {
  type: "GET_MOVIE_DATA";
  payload: {
    title: string;
    year?: number;
  };
}

/**
 * Request to fetch ratings for a movie
 */
export interface FetchRatingsMessage {
  type: "FETCH_RATINGS";
  payload: {
    movieId: string;
  };
}

/**
 * Request AI-generated scores (Phase 3)
 */
export interface AiScoreRequestMessage {
  type: "AI_SCORE_REQUEST";
  payload: {
    movieId: string;
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
 * Union of all message types
 */
export type Message =
  | GetMovieDataMessage
  | FetchRatingsMessage
  | AiScoreRequestMessage
  | GetStatusMessage
  | SetEnabledMessage;

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
  GET_MOVIE_DATA: Movie | null;
  FETCH_RATINGS: Rating[];
  AI_SCORE_REQUEST: AiScores | null;
  GET_STATUS: {
    enabled: boolean;
    connected: boolean;
  };
  SET_ENABLED: {
    enabled: boolean;
  };
}

/**
 * Helper type to get response data type for a message type
 */
export type ResponseDataFor<T extends Message["type"]> = MessageResponseMap[T];
