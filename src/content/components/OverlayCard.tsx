/**
 * OverlayCard Component
 *
 * The main container card for the Clapboard overlay.
 * Displays movie title, all rating badges, and awards information.
 */

import React, { useState } from "react";
import type { AiScoreResult, Movie, Rating } from "@shared/types/movie";
import { usePosterPalette } from "../hooks/usePosterPalette";
import { toCss, toCssAlpha, type Palette } from "@shared/utils/color";
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

  // Colours come from the film's own poster, so the card reads as part of what
  // you're looking at rather than as something bolted on. Null until the image
  // decodes, and null forever if it can't be read — the card is styled to work
  // either way rather than waiting.
  const palette = usePosterPalette(movie.posterUrl);

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
        className="cb-rounded-full cb-p-3 cb-shadow-overlay cb-transition-transform hover:cb-scale-110"
        style={surfaceStyle(palette)}
        aria-label="Expand Clapboard overlay"
      >
        <span className="cb-text-xl">🎬</span>
      </button>
    );
  }

  return (
    <div
      className="cb-rounded-overlay cb-shadow-overlay cb-animate-slide-up cb-w-[400px] cb-overflow-hidden cb-backdrop-blur-xl"
      style={surfaceStyle(palette)}
    >
      {/* Header — the poster sets the card's colour, so it leads */}
      <div
        className="cb-flex cb-items-start cb-gap-3 cb-p-4"
        style={headerStyle(palette)}
      >
        {movie.posterUrl && (
          <img
            src={movie.posterUrl}
            alt=""
            className="cb-w-16 cb-h-24 cb-rounded-md cb-object-cover cb-flex-shrink-0 cb-shadow-lg"
            style={{ boxShadow: palette ? `0 4px 20px ${toCssAlpha(palette.accent, 0.35)}` : undefined }}
          />
        )}

        <div className="cb-flex-1 cb-min-w-0">
          <h2
            className="cb-font-semibold cb-text-lg cb-leading-tight cb-m-0"
            style={{ color: palette ? toCss(palette.onSurface) : undefined }}
          >
            {movie.title}
          </h2>

          <div className="cb-flex cb-items-center cb-gap-2 cb-mt-1.5 cb-flex-wrap">
            {movie.year && (
              <span className="cb-text-xs cb-opacity-70" style={mutedStyle(palette)}>
                {movie.year}
              </span>
            )}
            {movie.runtime && (
              <span className="cb-text-xs cb-opacity-70" style={mutedStyle(palette)}>
                {formatRuntime(movie.runtime)}
              </span>
            )}
            {averageScore !== null && (
              <span
                className={`cb-text-xs cb-font-semibold cb-px-2 cb-py-0.5 cb-rounded-full ${
                  palette ? "" : getScoreColorClass(averageScore)
                }`}
                style={
                  palette
                    ? { background: toCss(palette.accentSurface), color: "#fff" }
                    : undefined
                }
              >
                {averageScore} · {getScoreTier(averageScore)}
              </span>
            )}
          </div>

          {movie.genre && movie.genre.length > 0 && (
            <p className="cb-text-xs cb-mt-1.5 cb-m-0 cb-opacity-60 cb-truncate" style={mutedStyle(palette)}>
              {movie.genre.slice(0, 3).join(" · ")}
            </p>
          )}
        </div>

        <button
          onClick={() => setIsMinimized(true)}
          className="cb-p-1 cb-opacity-60 hover:cb-opacity-100 cb-transition-opacity cb-flex-shrink-0"
          style={mutedStyle(palette)}
          aria-label="Minimize"
        >
          <MinimizeIcon />
        </button>
      </div>

      {/* A hairline in the poster's colour, tying the sections together */}
      <div
        className="cb-h-px cb-w-full"
        style={{ background: palette ? toCssAlpha(palette.accent, 0.35) : "rgba(255,255,255,0.08)" }}
      />

      {/* Ratings Section */}
      <div className="cb-p-4">
        <div className="cb-grid cb-grid-cols-2 cb-gap-2">
          {sortRatingsByPriority(ratings).map((rating) => (
            <RatingBadge key={rating.source} rating={rating} />
          ))}
        </div>

        {/* Show placeholder if no ratings yet */}
        {ratings.length === 0 && (
          <p
            className="cb-text-sm cb-text-center cb-py-2 cb-opacity-60 cb-m-0"
            style={mutedStyle(palette)}
          >
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
            className="cb-w-full cb-px-4 cb-py-2.5 cb-text-sm cb-opacity-70 hover:cb-opacity-100 cb-transition-opacity cb-flex cb-items-center cb-justify-center cb-gap-1"
            style={{
              ...mutedStyle(palette),
              borderTop: palette
                ? `1px solid ${toCssAlpha(palette.accent, 0.2)}`
                : "1px solid rgba(255,255,255,0.06)",
            }}
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
      <div
        className="cb-px-4 cb-py-2"
        style={{ borderTop: palette ? `1px solid ${toCssAlpha(palette.accent, 0.2)}` : "1px solid rgba(255,255,255,0.06)" }}
      >
        <span className="cb-text-xs cb-opacity-50" style={mutedStyle(palette)}>
          Clapboard
        </span>
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
 * The card's ground: a gradient from the poster's colour into near-black, so
 * the artwork's mood carries without the text losing its footing.
 *
 * Falls back to the neutral surface when no palette could be read — a
 * black-and-white poster, or a CDN that stops sending CORS headers.
 */
function surfaceStyle(palette: Palette | null): React.CSSProperties {
  if (!palette) return { background: "rgb(24, 24, 27)", color: "#fff" };

  return {
    background: `linear-gradient(160deg, ${toCss(palette.surface)} 0%, rgb(12, 12, 14) 100%)`,
    color: toCss(palette.onSurface),
    border: `1px solid ${toCssAlpha(palette.accent, 0.25)}`,
  };
}

/**
 * A wash of the accent behind the header, strongest at the poster.
 */
function headerStyle(palette: Palette | null): React.CSSProperties {
  if (!palette) return {};

  return {
    background: `linear-gradient(135deg, ${toCssAlpha(palette.accent, 0.22)} 0%, transparent 70%)`,
  };
}

/**
 * Secondary text — the palette's readable colour, dimmed by the caller's
 * opacity class rather than by a second colour, so contrast stays predictable.
 */
function mutedStyle(palette: Palette | null): React.CSSProperties {
  return { color: palette ? toCss(palette.onSurface) : "rgb(161, 161, 170)" };
}

/**
 * "148" -> "2h 28m"
 */
function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
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
