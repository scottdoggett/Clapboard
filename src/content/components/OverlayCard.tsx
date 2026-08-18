/**
 * OverlayCard Component
 *
 * The main container card for the Clapboard overlay.
 * Displays movie title, all rating badges, and awards information.
 */

import React, { useState } from "react";
import type { AiScoreResult, Movie, Rating } from "@shared/types/movie";
import RatingBadge from "./RatingBadge";
import AwardsBadge from "./AwardsBadge";
import ScoreBreakdown from "./ScoreBreakdown";
import {
  sortRatingsByPriority,
  getScoreColorClass,
  getScoreTier,
} from "@shared/utils/scoring";

/**
 * AI scoring state, threaded down from the hook that owns it.
 *
 * Null when the feature is switched off, which is what hides the section
 * entirely rather than showing a control that can't do anything.
 */
export interface AiScoresState {
  result: AiScoreResult | null;
  isLoading: boolean;
  /** A request came back with nothing — too few reviews to score the title */
  isUnavailable: boolean;
  /** Another run is already scoring this title */
  isPending: boolean;
  /** Scoring budget is spent; ms until it frees up, or null */
  retryAfterMs: number | null;
  error: Error | null;
  /** Kick off a scoring request. Called each time the section is opened. */
  onRequest: () => void;
}

interface OverlayCardProps {
  movie: Movie;
  ratings: Rating[];
  /** Ratings averaged onto a 0-100 scale, or null when there are none */
  averageScore?: number | null;
  /** AI score state, or null when the feature is disabled */
  aiScores?: AiScoresState | null;
}

/**
 * Main overlay card component
 */
const OverlayCard: React.FC<OverlayCardProps> = ({
  movie,
  ratings,
  averageScore = null,
  aiScores = null,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  /**
   * Opening the section is what pays for the scoring run, so the request is
   * fired here rather than on mount — most titles a user passes never get
   * expanded, and each run costs a web search and a model call.
   */
  const toggleAiSection = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    if (next) aiScores?.onRequest();
  };

  // Minimized view — just show a small icon
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="cb-bg-surface cb-rounded-full cb-p-3 cb-shadow-overlay hover:cb-bg-surface-light cb-transition-colors"
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
          <div className="cb-flex cb-items-center cb-gap-2 cb-text-sm">
            {movie.year && <span className="cb-text-gray-400">{movie.year}</span>}
            {averageScore !== null && (
              <span className={getScoreColorClass(averageScore)}>
                {averageScore} · {getScoreTier(averageScore)}
              </span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="cb-flex cb-items-center cb-gap-1 cb-ml-2">
          <button
            onClick={() => setIsMinimized(true)}
            className="cb-text-gray-400 hover:cb-text-white cb-p-1"
            aria-label="Minimize"
          >
            <MinimizeIcon />
          </button>
        </div>
      </div>

      {/* Ratings Section */}
      <div className="cb-p-4">
        <div className="cb-grid cb-grid-cols-2 cb-gap-2">
          {sortRatingsByPriority(ratings).map((rating) => (
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
      {aiScores && (
        <>
          <button
            onClick={toggleAiSection}
            className="cb-w-full cb-px-4 cb-py-2 cb-text-sm cb-text-gray-400 hover:cb-text-white cb-border-t cb-border-surface-lighter cb-flex cb-items-center cb-justify-center cb-gap-1"
          >
            {isExpanded ? "Hide" : "Show"} AI Analysis
            <ChevronIcon direction={isExpanded ? "up" : "down"} />
          </button>

          {isExpanded && (
            <div className="cb-px-4 cb-pb-4">
              <AiScoresSection state={aiScores} />
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
 * The AI section's four states: working, failed, nothing to show, and scored.
 *
 * A scoring run takes tens of seconds on a cold title, so the waiting state
 * has to say what it's waiting for — a spinner alone reads as broken at that
 * duration.
 */
const AiScoresSection: React.FC<{ state: AiScoresState }> = ({ state }) => {
  if (state.isLoading) {
    return (
      <Notice>Reading reviews… this takes a moment the first time.</Notice>
    );
  }

  if (state.error) {
    return <Notice>Couldn&apos;t generate scores: {state.error.message}</Notice>;
  }

  if (state.result) {
    return <ScoreBreakdown result={state.result} />;
  }

  // Both remaining states are "try later", so say which later — an unexplained
  // "come back" is indistinguishable from the feature being broken
  if (state.isPending) {
    return <Notice>Already scoring this one. Reopen in a moment.</Notice>;
  }

  if (state.retryAfterMs !== null) {
    return (
      <Notice>
        Scoring limit reached. Try again in {formatWait(state.retryAfterMs)}.
      </Notice>
    );
  }

  return <Notice>Not enough published reviews to score this one.</Notice>;
};

/**
 * A one-line status message in the AI section
 */
const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="cb-text-gray-400 cb-text-xs cb-m-0 cb-py-2">{children}</p>
);

/**
 * Render a wait as something a person can act on. Minutes below an hour,
 * rounded hours above — nobody needs "in 58 minutes and 12 seconds".
 */
function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

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
