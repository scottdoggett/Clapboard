/**
 * Clapboard Content Script Root Component
 *
 * The main React component for the injected overlay UI.
 * Orchestrates the display of ratings, awards, and AI scores.
 */

import React, { useMemo } from "react";
import { useMovieData } from "./hooks/useMovieData";
import { useAiScores } from "./hooks/useAiScores";
import OverlayCard from "./components/OverlayCard";
import { FEATURES } from "@shared/constants";

interface AppProps {
  titleInfo: {
    title: string;
    year?: number;
    type?: "movie" | "series";
  };
}

/**
 * Root component for the Clapboard overlay
 */
const App: React.FC<AppProps> = ({ titleInfo }) => {
  const { movie, ratings, averageScore, isLoading, error } = useMovieData(titleInfo);

  // Scoring searches for reviews by name, so it uses the title the ratings
  // lookup resolved rather than the one the streaming site rendered
  const scoringTarget = useMemo(
    () =>
      movie
        ? {
            movieId: movie.id,
            title: movie.title,
            year: movie.year,
            type: titleInfo.type,
          }
        : null,
    [movie, titleInfo.type]
  );

  const aiScores = useAiScores(scoringTarget);

  // Don't render anything while loading initial data
  if (isLoading && !movie) {
    return (
      <div className="cb-fixed cb-bottom-4 cb-right-4 cb-z-[999999]">
        <div className="cb-bg-surface cb-rounded-overlay cb-p-4 cb-shadow-overlay cb-animate-fade-in">
          <div className="cb-flex cb-items-center cb-gap-2 cb-text-white">
            <LoadingSpinner />
            <span className="cb-text-sm">Loading ratings...</span>
          </div>
        </div>
      </div>
    );
  }

  // Surface errors in the card rather than vanishing — a silent disappearance
  // is indistinguishable from "this title has no ratings", and the most common
  // cause here is a misconfigured backend the user can actually fix.
  if (error) {
    console.error("[Clapboard] Error loading movie data:", error);

    return (
      <div className="cb-fixed cb-bottom-4 cb-right-4 cb-z-[999999]">
        <div className="cb-bg-surface cb-rounded-overlay cb-p-4 cb-shadow-overlay cb-w-80">
          <div className="cb-flex cb-items-start cb-gap-2">
            <span className="cb-text-base">⚠️</span>
            <div>
              <p className="cb-text-white cb-text-sm cb-font-medium cb-m-0">
                Clapboard couldn&apos;t load ratings
              </p>
              <p className="cb-text-gray-400 cb-text-xs cb-mt-1 cb-m-0">
                {error.message}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Don't render if we couldn't find the movie
  if (!movie) {
    return null;
  }

  return (
    <div className="cb-fixed cb-bottom-4 cb-right-4 cb-z-[999999]">
      <OverlayCard
        movie={movie}
        ratings={ratings}
        averageScore={averageScore}
        aiScores={
          FEATURES.AI_SCORES_ENABLED
            ? {
                result: aiScores.scores,
                isLoading: aiScores.isLoading,
                isUnavailable: aiScores.isUnavailable,
                error: aiScores.error,
                onRequest: aiScores.request,
              }
            : null
        }
      />
    </div>
  );
};

/**
 * Simple loading spinner component
 */
const LoadingSpinner: React.FC = () => (
  <svg
    className="cb-animate-spin cb-h-4 cb-w-4 cb-text-primary-500"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="cb-opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="cb-opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

export default App;
