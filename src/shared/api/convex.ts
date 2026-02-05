/**
 * Convex API Client
 *
 * Initializes and exports the Convex client for use in the extension.
 * Provides typed query and mutation helpers for interacting with the backend.
 *
 * Note: In a Chrome extension context, the Convex client runs in the
 * background service worker and communicates with content scripts via
 * Chrome runtime messaging.
 */

import { ConvexClient } from "convex/browser";
import type { Movie, Rating, Review, User } from "@shared/types/movie";

// Convex client instance (lazy initialization)
let client: ConvexClient | null = null;

/**
 * Get or create the Convex client
 *
 * @returns Convex client instance
 */
export function getConvexClient(): ConvexClient {
  if (!client) {
    const url = process.env.CONVEX_URL;

    if (!url) {
      throw new Error("CONVEX_URL environment variable is not set");
    }

    client = new ConvexClient(url);
  }

  return client;
}

/**
 * Query movies by title and optional year
 *
 * @param title - Movie title to search for
 * @param year - Optional release year for disambiguation
 * @returns Movie data or null if not found
 */
export async function queryMovie(
  title: string,
  year?: number
): Promise<Movie | null> {
  // TODO: Implement actual Convex query
  // const client = getConvexClient();
  // return await client.query(api.movies.getByTitle, { title, year });

  console.log("[Clapboard API] queryMovie:", title, year);
  return null; // Placeholder
}

/**
 * Query ratings for a movie
 *
 * @param movieId - Convex document ID for the movie
 * @returns Array of ratings from different sources
 */
export async function queryRatings(movieId: string): Promise<Rating[]> {
  // TODO: Implement actual Convex query
  // const client = getConvexClient();
  // return await client.query(api.ratings.getForMovie, { movieId });

  console.log("[Clapboard API] queryRatings:", movieId);
  return []; // Placeholder
}

/**
 * Query AI-generated scores for a movie's reviews
 *
 * @param movieId - Convex document ID for the movie
 * @returns Review with AI scores or null
 */
export async function queryAiScores(movieId: string): Promise<Review | null> {
  // TODO: Implement actual Convex query
  // const client = getConvexClient();
  // return await client.query(api.reviews.getAiScores, { movieId });

  console.log("[Clapboard API] queryAiScores:", movieId);
  return null; // Placeholder
}

/**
 * Get current user profile
 *
 * @param clerkId - Clerk authentication user ID
 * @returns User profile or null
 */
export async function queryUser(clerkId: string): Promise<User | null> {
  // TODO: Implement actual Convex query
  // const client = getConvexClient();
  // return await client.query(api.users.getByClerkId, { clerkId });

  console.log("[Clapboard API] queryUser:", clerkId);
  return null; // Placeholder
}

/**
 * Request a rating refresh for a movie
 * (Triggers background job to fetch fresh ratings)
 *
 * @param movieId - Convex document ID for the movie
 */
export async function requestRatingRefresh(movieId: string): Promise<void> {
  // TODO: Implement actual Convex mutation
  // const client = getConvexClient();
  // await client.mutation(api.ratings.requestRefresh, { movieId });

  console.log("[Clapboard API] requestRatingRefresh:", movieId);
}

/**
 * Request AI processing for a movie's reviews
 * (Triggers background job to analyze reviews)
 *
 * @param movieId - Convex document ID for the movie
 */
export async function requestAiProcessing(movieId: string): Promise<void> {
  // TODO: Implement actual Convex mutation
  // const client = getConvexClient();
  // await client.mutation(api.reviews.requestProcessing, { movieId });

  console.log("[Clapboard API] requestAiProcessing:", movieId);
}

/**
 * Close the Convex client connection
 * (Called when extension is disabled or uninstalled)
 */
export function closeClient(): void {
  if (client) {
    // Note: ConvexClient doesn't have an explicit close method,
    // but setting to null allows garbage collection
    client = null;
  }
}

// Export client getter for direct access if needed
export { client };
