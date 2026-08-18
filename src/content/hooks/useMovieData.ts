/**
 * useMovieData Hook
 *
 * Custom React hook for fetching movie data through the background service
 * worker. One request returns metadata, ratings, awards, and the aggregate
 * score — the backend resolves them together, so the overlay doesn't need to
 * chain requests.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Movie, Rating } from "@shared/types/movie";
import type { Message, MessageResponse, MessageResponseMap } from "@shared/types/messages";

interface UseMovieDataResult {
  movie: Movie | null;
  ratings: Rating[];
  averageScore: number | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface TitleInfo {
  title: string;
  year?: number;
  type?: "movie" | "series";
}

/**
 * Send a message to the background worker and unwrap its response
 *
 * @param message - The message to send
 * @returns The response payload
 * @throws If the background worker reports a failure
 */
async function sendMessage<T extends Message>(
  message: T
): Promise<MessageResponseMap[T["type"]]> {
  const response: MessageResponse = await chrome.runtime.sendMessage(message);

  if (!response.success) {
    throw new Error(response.error || "Unknown error");
  }

  return response.data as MessageResponseMap[T["type"]];
}

/**
 * Hook to fetch and manage movie data
 *
 * @param titleInfo - The title detected on the page
 * @returns Movie data, ratings, and request state
 */
export function useMovieData(titleInfo: TitleInfo): UseMovieDataResult {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [averageScore, setAverageScore] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Identifies the in-flight request so a slow response for a previous title
  // can't overwrite state that belongs to the title now on screen.
  const requestId = useRef(0);

  const fetchMovieData = useCallback(async () => {
    const currentRequest = ++requestId.current;

    setIsLoading(true);
    setError(null);

    try {
      const data = await sendMessage({
        type: "GET_MOVIE_DATA",
        payload: {
          title: titleInfo.title,
          year: titleInfo.year,
          type: titleInfo.type,
        },
      });

      if (currentRequest !== requestId.current) return;

      if (!data) {
        console.log("[Clapboard] No match for:", titleInfo.title);
        setMovie(null);
        setRatings([]);
        setAverageScore(null);
        return;
      }

      setMovie(data.movie);
      setRatings(data.ratings);
      setAverageScore(data.averageScore ?? null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;

      console.error("[Clapboard] Error fetching movie data:", err);
      setError(err instanceof Error ? err : new Error("Failed to fetch movie data"));
    } finally {
      if (currentRequest === requestId.current) {
        setIsLoading(false);
      }
    }
  }, [titleInfo.title, titleInfo.year, titleInfo.type]);

  useEffect(() => {
    if (titleInfo.title) {
      void fetchMovieData();
    } else {
      setMovie(null);
      setRatings([]);
      setAverageScore(null);
      setIsLoading(false);
    }
  }, [titleInfo.title, fetchMovieData]);

  const refetch = useCallback(() => {
    void fetchMovieData();
  }, [fetchMovieData]);

  return {
    movie,
    ratings,
    averageScore,
    isLoading,
    error,
    refetch,
  };
}

export default useMovieData;
