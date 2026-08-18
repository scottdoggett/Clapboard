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
/**
 * Total awards a record stands for. Our source reports counts rather than
 * individual categories, so one record can be worth several awards.
 */
function awardCount(award: Award): number {
  return award.count ?? 1;
}

const AwardsBadge: React.FC<AwardsBadgeProps> = ({ awards }) => {
  const [showAll, setShowAll] = useState(false);

  // Separate wins from nominations, counting what each record represents
  const winCount = awards
    .filter((a) => a.isWin)
    .reduce((total, award) => total + awardCount(award), 0);
  const nominationCount = awards
    .filter((a) => !a.isWin)
    .reduce((total, award) => total + awardCount(award), 0);

  // Show wins first in the collapsed view — they're what people scan for
  const sorted = [...awards].sort(
    (a, b) => Number(b.isWin) - Number(a.isWin) || awardCount(b) - awardCount(a)
  );
  const displayedAwards = showAll ? sorted : sorted.slice(0, 3);

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
          {winCount > 0 && (
            <span className="cb-text-yellow-400">
              {winCount} Win{winCount !== 1 ? "s" : ""}
            </span>
          )}
          {nominationCount > 0 && (
            <span className="cb-text-gray-400">
              {nominationCount} Nom{nominationCount !== 1 ? "s" : ""}
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
          className="cb-mt-2 cb-text-xs cb-text-gray-400 hover:cb-text-white cb-transition-colors"
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
  const count = awardCount(award);

  return (
    <div className="cb-flex cb-items-center cb-gap-2 cb-text-sm">
      <span className="cb-text-base">{icon}</span>
      <div className="cb-flex-1 cb-min-w-0">
        <span
          className={`cb-truncate ${
            award.isWin ? "cb-text-yellow-400" : "cb-text-gray-400"
          }`}
        >
          {count > 1 ? `${count} × ${award.name}` : award.name}
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
