/**
 * OverlayCard Component
 *
 * The main container card for the Clapboard overlay.
 * Displays movie title, all rating badges, and awards information.
 */

import React, { useState } from "react";
import type { Movie, Rating } from "@shared/types/movie";
import RatingBadge from "./RatingBadge";
import AwardsBadge from "./AwardsBadge";
import ScoreBreakdown from "./ScoreBreakdown";

interface OverlayCardProps {
  movie: Movie;
  ratings: Rating[];
}

/**
 * Main overlay card component
 */
const OverlayCard: React.FC<OverlayCardProps> = ({ movie, ratings }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Minimized view — just show a small icon
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="cb-bg-surface cb-rounded-full cb-p-3 cb-shadow-overlay cb-hover:bg-surface-light cb-transition-colors"
        aria-label="Expand Clapboard overlay"
      >
        {/* TODO: Replace with actual Clapboard icon */}
        <span className="cb-text-xl">🎬</span>
      </button>
    );
  }

  return (
    <div className="cb-bg-surface cb-rounded-overlay cb-shadow-overlay cb-animate-slide-up cb-w-80">
      {/* Header */}
      <div className="cb-flex cb-items-start cb-justify-between cb-p-4 cb-border-b cb-border-surface-lighter">
        <div className="cb-flex-1 cb-min-w-0">
          <h2 className="cb-text-white cb-font-semibold cb-text-base cb-truncate">
            {movie.title}
          </h2>
          {movie.year && (
            <span className="cb-text-gray-400 cb-text-sm">{movie.year}</span>
          )}
        </div>

        {/* Controls */}
        <div className="cb-flex cb-items-center cb-gap-1 cb-ml-2">
          <button
            onClick={() => setIsMinimized(true)}
            className="cb-text-gray-400 cb-hover:text-white cb-p-1"
            aria-label="Minimize"
          >
            <MinimizeIcon />
          </button>
        </div>
      </div>

      {/* Ratings Section */}
      <div className="cb-p-4">
        <div className="cb-grid cb-grid-cols-2 cb-gap-2">
          {ratings.map((rating) => (
            <RatingBadge key={rating.source} rating={rating} />
          ))}
        </div>

        {/* Show placeholder if no ratings yet */}
        {ratings.length === 0 && (
          <p className="cb-text-gray-400 cb-text-sm cb-text-center cb-py-2">
            No ratings available yet
          </p>
        )}
      </div>

      {/* Awards Section (if any) */}
      {movie.awards && movie.awards.length > 0 && (
        <div className="cb-px-4 cb-pb-4">
          <AwardsBadge awards={movie.awards} />
        </div>
      )}

      {/* Expandable AI Scores Section (Phase 3) */}
      {movie.aiScores && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="cb-w-full cb-px-4 cb-py-2 cb-text-sm cb-text-gray-400 cb-hover:text-white cb-border-t cb-border-surface-lighter cb-flex cb-items-center cb-justify-center cb-gap-1"
          >
            {isExpanded ? "Hide" : "Show"} AI Analysis
            <ChevronIcon direction={isExpanded ? "up" : "down"} />
          </button>

          {isExpanded && (
            <div className="cb-px-4 cb-pb-4">
              <ScoreBreakdown scores={movie.aiScores} />
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="cb-px-4 cb-py-2 cb-border-t cb-border-surface-lighter">
        <span className="cb-text-gray-500 cb-text-xs">Clapboard</span>
      </div>
    </div>
  );
};

/**
 * Minimize icon component
 */
const MinimizeIcon: React.FC = () => (
  <svg
    className="cb-w-4 cb-h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M20 12H4"
    />
  </svg>
);

/**
 * Chevron icon for expand/collapse
 */
const ChevronIcon: React.FC<{ direction: "up" | "down" }> = ({ direction }) => (
  <svg
    className={`cb-w-4 cb-h-4 cb-transition-transform ${
      direction === "up" ? "cb-rotate-180" : ""
    }`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

export default OverlayCard;
