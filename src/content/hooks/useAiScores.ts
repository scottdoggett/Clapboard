/**
 * useAiScores Hook
 *
 * Fetches AI-generated category scores for a title, on demand.
 *
 * Unlike `useMovieData`, this never fires on its own. Generating scores means
 * a web search and a model call on the backend — seconds of latency and real
 * cost — so it runs only when the user opens the AI section. Once a title has
 * been scored the result is cached at both ends, and reopening the panel is
 * cheap.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { AiScoreResult } from "@shared/types/movie";
import type { Message, MessageResponse, MessageResponseMap } from "@shared/types/messages";

interface UseAiScoresResult {
  scores: AiScoreResult | null;
  isLoading: boolean;
  /** True once a request has come back with no scores for this title */
  isUnavailable: boolean;
  error: Error | null;
  /** Start a request; a no-op while one is in flight or already answered */
  request: () => void;
}

interface TitleInfo {
  movieId: string;
  title: string;
  year?: number;
  type?: "movie" | "series";
}

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
 * Hook to fetch AI scores for a movie on demand
 *
 * @param titleInfo - The resolved movie, or null when nothing is resolved yet
 * @returns Scores, request state, and the trigger
 */
export function useAiScores(titleInfo: TitleInfo | null): UseAiScoresResult {
  const [scores, setScores] = useState<AiScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Discards a response that arrives after the user has navigated to another
  // title — likely here, because these requests can run for tens of seconds
  const requestId = useRef(0);
  const movieId = titleInfo?.movieId ?? null;

  // Reset when the overlay switches to a different title
  useEffect(() => {
    requestId.current++;
    setScores(null);
    setIsLoading(false);
    setIsUnavailable(false);
    setError(null);
  }, [movieId]);

  const request = useCallback(() => {
    if (!titleInfo || isLoading || scores || isUnavailable) return;

    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await sendMessage({
          type: "AI_SCORE_REQUEST",
          payload: {
            movieId: titleInfo.movieId,
            title: titleInfo.title,
            year: titleInfo.year,
            type: titleInfo.type,
          },
        });

        if (currentRequest !== requestId.current) return;

        if (data) {
          setScores(data);
        } else {
          setIsUnavailable(true);
        }
      } catch (err) {
        if (currentRequest !== requestId.current) return;

        console.error("[Clapboard] Error fetching AI scores:", err);
        setError(err instanceof Error ? err : new Error("Failed to fetch AI scores"));
      } finally {
        if (currentRequest === requestId.current) {
          setIsLoading(false);
        }
      }
    })();
  }, [titleInfo, isLoading, scores, isUnavailable]);

  return { scores, isLoading, isUnavailable, error, request };
}

export default useAiScores;
