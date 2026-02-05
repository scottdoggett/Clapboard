/**
 * useMovieData Hook
 *
 * Custom React hook for fetching and subscribing to movie data.
 * Communicates with the background service worker to retrieve:
 * - Movie metadata (title, year, IDs)
 * - Aggregated ratings from multiple sources
 * - Award information
 * - AI-generated scores (when available)
 */

import { useState, useEffect, useCallback } from "react";
import type { Movie, Rating } from "@shared/types/movie";
import type { Message, MessageResponse } from "@shared/types/messages";

interface UseMovieDataResult {
  movie: Movie | null;
  ratings: Rating[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface TitleInfo {
  title: string;
  year?: number;
}

/**
 * Hook to fetch and manage movie data
 */
export function useMovieData(titleInfo: TitleInfo): UseMovieDataResult {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Send message to background script
   */
  const sendMessage = useCallback(
    async <T>(message: Message): Promise<T | null> => {
      try {
        const response: MessageResponse = await chrome.runtime.sendMessage(message);

        if (!response.success) {
          throw new Error(response.error || "Unknown error");
        }

        return response.data as T;
      } catch (err) {
        console.error("[Clapboard] Message error:", err);
        throw err;
      }
    },
    []
  );

  /**
   * Fetch movie data from background script
   */
  const fetchMovieData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Get movie metadata
      const movieData = await sendMessage<Movie>({
        type: "GET_MOVIE_DATA",
        payload: {
          title: titleInfo.title,
          year: titleInfo.year,
        },
      });

      if (!movieData) {
        console.log("[Clapboard] No movie data found for:", titleInfo.title);
        setMovie(null);
        setRatings([]);
        setIsLoading(false);
        return;
      }

      setMovie(movieData);

      // Step 2: Fetch ratings for this movie
      // TODO: This should ideally be part of the movie data response
      // or use a separate query with the movie ID
      const ratingsData = await sendMessage<Rating[]>({
        type: "FETCH_RATINGS",
        payload: {
          movieId: movieData.id,
        },
      });

      setRatings(ratingsData || []);
    } catch (err) {
      console.error("[Clapboard] Error fetching movie data:", err);
      setError(err instanceof Error ? err : new Error("Failed to fetch movie data"));
    } finally {
      setIsLoading(false);
    }
  }, [titleInfo.title, titleInfo.year, sendMessage]);

  /**
   * Effect to fetch data when title changes
   */
  useEffect(() => {
    if (titleInfo.title) {
      fetchMovieData();
    } else {
      setMovie(null);
      setRatings([]);
      setIsLoading(false);
    }
  }, [titleInfo.title, titleInfo.year, fetchMovieData]);

  /**
   * Manual refetch function
   */
  const refetch = useCallback(() => {
    fetchMovieData();
  }, [fetchMovieData]);

  return {
    movie,
    ratings,
    isLoading,
    error,
    refetch,
  };
}

export default useMovieData;
