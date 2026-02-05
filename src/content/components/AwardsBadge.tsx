/**
 * AwardsBadge Component
 *
 * Displays award wins and nominations for a movie.
 * Shows major awards (Oscars, Golden Globes, BAFTAs) prominently.
 */

import React, { useState } from "react";
import type { Award } from "@shared/types/movie";

interface AwardsBadgeProps {
  awards: Award[];
}

/**
 * Award category icons (emoji placeholders)
 */
const AWARD_ICONS: Record<string, string> = {
  Oscar: "🏆",
  "Golden Globe": "🌟",
  BAFTA: "🎭",
  "Screen Actors Guild": "🎬",
  Cannes: "🌴",
  Sundance: "🎥",
  default: "🏅",
};

/**
 * Awards badge component
 */
const AwardsBadge: React.FC<AwardsBadgeProps> = ({ awards }) => {
  const [showAll, setShowAll] = useState(false);

  // Separate wins from nominations
  const wins = awards.filter((a) => a.isWin);
  const nominations = awards.filter((a) => !a.isWin);

  // Show only major awards in collapsed view
  const majorAwards = wins.slice(0, 3);
  const displayedAwards = showAll ? awards : majorAwards;

  if (awards.length === 0) {
    return null;
  }

  return (
    <div className="cb-bg-surface-light cb-rounded-lg cb-p-3">
      {/* Summary header */}
      <div className="cb-flex cb-items-center cb-justify-between cb-mb-2">
        <div className="cb-flex cb-items-center cb-gap-2">
          <span className="cb-text-lg">🏆</span>
          <span className="cb-text-white cb-font-medium cb-text-sm">Awards</span>
        </div>
        <div className="cb-flex cb-items-center cb-gap-3 cb-text-xs">
          {wins.length > 0 && (
            <span className="cb-text-yellow-400">
              {wins.length} Win{wins.length !== 1 ? "s" : ""}
            </span>
          )}
          {nominations.length > 0 && (
            <span className="cb-text-gray-400">
              {nominations.length} Nom{nominations.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Award list */}
      <div className="cb-space-y-1">
        {displayedAwards.map((award, index) => (
          <AwardItem key={`${award.name}-${award.category}-${index}`} award={award} />
        ))}
      </div>

      {/* Show more/less toggle */}
      {awards.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="cb-mt-2 cb-text-xs cb-text-gray-400 cb-hover:text-white cb-transition-colors"
        >
          {showAll ? "Show less" : `Show all ${awards.length} awards`}
        </button>
      )}
    </div>
  );
};

/**
 * Individual award item
 */
const AwardItem: React.FC<{ award: Award }> = ({ award }) => {
  const icon = AWARD_ICONS[award.name] || AWARD_ICONS.default;

  return (
    <div className="cb-flex cb-items-center cb-gap-2 cb-text-sm">
      <span className="cb-text-base">{icon}</span>
      <div className="cb-flex-1 cb-min-w-0">
        <span
          className={`cb-truncate ${
            award.isWin ? "cb-text-yellow-400" : "cb-text-gray-400"
          }`}
        >
          {award.name}
        </span>
        {award.category && (
          <span className="cb-text-gray-500 cb-text-xs cb-ml-1">
            — {award.category}
          </span>
        )}
      </div>
      {award.isWin && (
        <span className="cb-text-yellow-400 cb-text-xs cb-font-medium">WIN</span>
      )}
    </div>
  );
};

export default AwardsBadge;
