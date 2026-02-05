/**
 * Clapboard Content Script Root Component
 *
 * The main React component for the injected overlay UI.
 * Orchestrates the display of ratings, awards, and AI scores.
 */

import React from "react";
import { useMovieData } from "./hooks/useMovieData";
import OverlayCard from "./components/OverlayCard";

interface AppProps {
  titleInfo: {
    title: string;
    year?: number;
  };
}

/**
 * Root component for the Clapboard overlay
 */
const App: React.FC<AppProps> = ({ titleInfo }) => {
  const { movie, ratings, isLoading, error } = useMovieData(titleInfo);

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

  // Handle errors gracefully
  if (error) {
    console.error("[Clapboard] Error loading movie data:", error);
    // TODO: Decide whether to show error state or silently fail
    return null;
  }

  // Don't render if we couldn't find the movie
  if (!movie) {
    return null;
  }

  return (
    <div className="cb-fixed cb-bottom-4 cb-right-4 cb-z-[999999]">
      <OverlayCard movie={movie} ratings={ratings} />
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
