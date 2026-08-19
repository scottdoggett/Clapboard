/**
 * StarRating Component
 *
 * Ten stars, each selectable to a half.
 *
 * Half-stars are done with two invisible hit areas per star rather than by
 * measuring the pointer against the star's box: a click near an edge lands
 * predictably, and it keeps working under keyboard and touch, which a
 * geometry calculation does not.
 *
 * The scale is 0.5–10 in halves, matching the 0–10 the rest of the overlay
 * uses, so a personal score sits alongside IMDb's without conversion.
 */

import React, { useState } from "react";
import { fillFor, nextScore, STAR_COUNT, type StarFill } from "@shared/utils/stars";

interface StarRatingProps {
  /** Current score out of 10, or undefined for unrated */
  value?: number;
  onChange: (value: number | undefined) => void;
}

const StarRating: React.FC<StarRatingProps> = ({ value, onChange }) => {
  const [hover, setHover] = useState<number | undefined>(undefined);

  // What the stars should show right now: the hovered value while pointing,
  // the committed one otherwise
  const shown = hover ?? value ?? 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{ display: "flex", alignItems: "center" }}
        onMouseLeave={() => setHover(undefined)}
        role="radiogroup"
        aria-label="Your rating out of 10"
      >
        {Array.from({ length: STAR_COUNT }, (_, index) => {
          const full = index + 1;
          const half = index + 0.5;

          return (
            <span key={full} style={{ position: "relative", lineHeight: 0 }}>
              <Star fill={fillFor(shown, index)} />

              {/* Two hit areas: the left half sets a half star, the right a
                  whole one. Clicking the value you already have clears it,
                  which is the only way back to unrated. */}
              <HitArea
                side="left"
                label={`${half} out of 10`}
                checked={value === half}
                onHover={() => setHover(half)}
                onSelect={() => onChange(nextScore(value, half))}
              />
              <HitArea
                side="right"
                label={`${full} out of 10`}
                checked={value === full}
                onHover={() => setHover(full)}
                onSelect={() => onChange(nextScore(value, full))}
              />
            </span>
          );
        })}
      </div>

      <span style={{ color: "#777", fontSize: "14px", minWidth: "44px" }}>
        {value === undefined ? "Unrated" : `${value}/10`}
      </span>
    </div>
  );
};

/**
 * An invisible half-star click target.
 */
const HitArea: React.FC<{
  side: "left" | "right";
  label: string;
  checked: boolean;
  onHover: () => void;
  onSelect: () => void;
}> = ({ side, label, checked, onHover, onSelect }) => (
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    aria-label={label}
    title={label}
    onMouseEnter={onHover}
    onFocus={onHover}
    onClick={onSelect}
    style={{
      position: "absolute",
      top: 0,
      [side]: 0,
      width: "50%",
      height: "100%",
      background: "none",
      border: "none",
      padding: 0,
      margin: 0,
      cursor: "pointer",
    }}
  />
);

/**
 * A star, drawn once and clipped for the half state so both halves line up
 * exactly — two separately drawn half-stars never quite meet.
 */
const Star: React.FC<{ fill: StarFill }> = ({ fill }) => {
  const path =
    "M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5 7.3 14.03 2.6 9.45l6.5-.95L12 2.6z";

  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id="cb-star-half">
          <stop offset="50%" stopColor="#fff" />
          <stop offset="50%" stopColor="transparent" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path
        d={path}
        fill={fill === "full" ? "#fff" : fill === "half" ? "url(#cb-star-half)" : "none"}
        stroke={fill === "empty" ? "rgba(255,255,255,0.45)" : "#fff"}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default StarRating;
