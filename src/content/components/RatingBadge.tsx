/**
 * RatingBadge Component
 *
 * Displays a single rating source's score with appropriate styling.
 * Supports IMDb, Rotten Tomatoes, Metacritic, and Letterboxd.
 */

import React from "react";
import type { Rating, RatingSource } from "@shared/types/movie";
import { normalizeScore } from "@shared/utils/scoring";

interface RatingBadgeProps {
  rating: Rating;
}

/**
 * Configuration for each rating source's display
 */
const SOURCE_CONFIG: Record<
  RatingSource,
  {
    name: string;
    shortName: string;
    icon: string; // Emoji placeholder — replace with actual icons
    bgColor: string;
    textColor: string;
  }
> = {
  IMDb: {
    name: "IMDb",
    shortName: "IMDb",
    icon: "⭐",
    bgColor: "cb-bg-yellow-500",
    textColor: "cb-text-black",
  },
  RottenTomatoes: {
    name: "Rotten Tomatoes",
    shortName: "RT",
    icon: "🍅",
    bgColor: "cb-bg-red-600",
    textColor: "cb-text-white",
  },
  Metacritic: {
    name: "Metacritic",
    shortName: "MC",
    icon: "🎯",
    bgColor: "cb-bg-yellow-400",
    textColor: "cb-text-black",
  },
  Letterboxd: {
    name: "Letterboxd",
    shortName: "LB",
    icon: "📽️",
    bgColor: "cb-bg-green-600",
    textColor: "cb-text-white",
  },
};

/**
 * Rating badge component
 */
const RatingBadge: React.FC<RatingBadgeProps> = ({ rating }) => {
  const config = SOURCE_CONFIG[rating.source];
  const normalizedScore = normalizeScore(rating.score, rating.maxScore);

  // Determine color based on normalized score (0-100)
  const scoreColorClass = getScoreColorClass(normalizedScore);

  return (
    <div className="cb-bg-surface-light cb-rounded-lg cb-p-2 cb-flex cb-items-center cb-gap-2">
      {/* Source icon */}
      <span className="cb-text-lg" title={config.name}>
        {config.icon}
      </span>

      {/* Score display */}
      <div className="cb-flex cb-flex-col cb-flex-1 cb-min-w-0">
        <span className="cb-text-gray-400 cb-text-xs">{config.shortName}</span>
        <div className="cb-flex cb-items-baseline cb-gap-1">
          <span className={`cb-font-bold cb-text-lg ${scoreColorClass}`}>
            {formatScore(rating.score, rating.maxScore)}
          </span>
          <span className="cb-text-gray-500 cb-text-xs">
            /{rating.maxScore}
          </span>
        </div>
      </div>

      {/* Visual score bar */}
      <div className="cb-w-12 cb-h-1.5 cb-bg-surface-lighter cb-rounded-full cb-overflow-hidden">
        <div
          className={`cb-h-full cb-rounded-full ${scoreColorClass.replace("cb-text-", "cb-bg-")}`}
          style={{ width: `${normalizedScore}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Get Tailwind color class based on normalized score
 */
function getScoreColorClass(normalizedScore: number): string {
  if (normalizedScore >= 75) {
    return "cb-text-green-400";
  } else if (normalizedScore >= 50) {
    return "cb-text-yellow-400";
  } else {
    return "cb-text-red-400";
  }
}

/**
 * Format score for display
 */
function formatScore(score: number, maxScore: number): string {
  // IMDb-style: show one decimal place for 10-point scale
  if (maxScore === 10) {
    return score.toFixed(1);
  }
  // Percentage-based: show whole number
  return Math.round(score).toString();
}

export default RatingBadge;
