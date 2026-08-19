/**
 * LibraryControls Component
 *
 * Watched, watchlist, like/dislike and review, in Netflix's own control
 * language: circular outlined buttons, which is what they use for "add to My
 * List" and the thumbs beside Resume.
 *
 * Everything here writes to local storage only — see `library.ts` for why.
 */

import React, { useState } from "react";
import type { LibraryControls as Controls } from "../hooks/useLibraryEntry";
import StarRating from "./StarRating";

const IDLE_BORDER = "rgba(255, 255, 255, 0.5)";
const ACTIVE_BG = "rgba(255, 255, 255, 0.95)";
const LABEL_COLOR = "#777";
const BODY_COLOR = "#d2d2d2";
const PANEL_BG = "rgb(47, 47, 47)";

interface LibraryControlsProps {
  controls: Controls;
}

const LibraryControls: React.FC<LibraryControlsProps> = ({ controls }) => {
  const [reviewOpen, setReviewOpen] = useState(false);

  const existing = controls.entry?.review;

  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <CircleButton
          active={controls.isWatched}
          onClick={controls.toggleWatched}
          label={controls.isWatched ? "Watched" : "Mark as watched"}
        >
          <CheckIcon />
        </CircleButton>

        <CircleButton
          active={controls.isWatchlisted}
          onClick={controls.toggleWatchlist}
          label={controls.isWatchlisted ? "On your watchlist" : "Add to watchlist"}
        >
          {controls.isWatchlisted ? <CheckIcon /> : <PlusIcon />}
        </CircleButton>

        <CircleButton
          active={controls.sentiment === "liked"}
          onClick={() => controls.setSentiment("liked")}
          label="I liked this"
        >
          <ThumbIcon />
        </CircleButton>

        <CircleButton
          active={controls.sentiment === "disliked"}
          onClick={() => controls.setSentiment("disliked")}
          label="Not for me"
        >
          <ThumbIcon down />
        </CircleButton>

        <button
          onClick={() => setReviewOpen(!reviewOpen)}
          style={{
            marginLeft: "4px",
            color: LABEL_COLOR,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "14px",
          }}
          onMouseEnter={(event) => (event.currentTarget.style.color = "#fff")}
          onMouseLeave={(event) => (event.currentTarget.style.color = LABEL_COLOR)}
        >
          {existing ? "Edit your review" : "Write a review"}
        </button>

        {existing?.rating !== undefined && (
          <span style={{ color: BODY_COLOR, fontSize: "14px" }}>
            <span style={{ color: "#fff" }}>{existing.rating}</span>/10
          </span>
        )}
      </div>

      {existing && existing.text !== "" && !reviewOpen && (
        <p style={{ color: BODY_COLOR, fontSize: "14px", margin: "10px 0 0" }}>
          &ldquo;{existing.text}&rdquo;
        </p>
      )}

      {reviewOpen && (
        <ReviewForm
          initial={existing}
          onCancel={() => setReviewOpen(false)}
          onSave={(text, rating) => {
            controls.saveReview(text, rating);
            setReviewOpen(false);
          }}
        />
      )}
    </div>
  );
};

/**
 * A review, written in the page rather than in a popup — the film is on
 * screen, which is when someone actually wants to write about it.
 */
const ReviewForm: React.FC<{
  initial?: { text: string; rating?: number };
  onSave: (text: string, rating?: number) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [text, setText] = useState(initial?.text ?? "");
  const [rating, setRating] = useState<number | undefined>(initial?.rating);

  return (
    <div
      style={{
        background: PANEL_BG,
        borderRadius: "4px",
        padding: "14px",
        marginTop: "10px",
      }}
    >
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What did you make of it?"
        rows={3}
        style={{
          width: "100%",
          background: "rgba(0, 0, 0, 0.35)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "4px",
          color: "#fff",
          padding: "10px",
          fontFamily: "inherit",
          fontSize: "14px",
          lineHeight: "20px",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginTop: "12px",
          flexWrap: "wrap",
        }}
      >
        <StarRating value={rating} onChange={setRating} />

        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <TextAction onClick={onCancel}>Cancel</TextAction>
          <TextAction
            emphasis
            onClick={() => onSave(text, rating)}
          >
            Save
          </TextAction>
        </div>
      </div>
    </div>
  );
};

const TextAction: React.FC<{
  onClick: () => void;
  emphasis?: boolean;
  children: React.ReactNode;
}> = ({ onClick, emphasis, children }) => (
  <button
    onClick={onClick}
    style={{
      background: emphasis ? "#fff" : "transparent",
      color: emphasis ? "#141414" : BODY_COLOR,
      border: emphasis ? "none" : `1px solid ${IDLE_BORDER}`,
      borderRadius: "4px",
      padding: "6px 16px",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "14px",
    }}
  >
    {children}
  </button>
);

/**
 * Netflix's circular control: outlined when off, filled when on.
 */
const CircleButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}> = ({ active, onClick, label, children }) => {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        background: active ? ACTIVE_BG : "rgba(42, 42, 42, 0.6)",
        color: active ? "#141414" : "#fff",
        border: `2px solid ${active ? ACTIVE_BG : hover ? "#fff" : IDLE_BORDER}`,
        cursor: "pointer",
        padding: 0,
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      {children}
    </button>
  );
};

const CheckIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const ThumbIcon: React.FC<{ down?: boolean }> = ({ down }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinejoin="round"
    aria-hidden="true"
    style={down ? { transform: "rotate(180deg)" } : undefined}
  >
    <path d="M7 10.5v9H4.5a1 1 0 01-1-1v-7a1 1 0 011-1H7z" />
    <path d="M7 10.5l4.2-7.1a1 1 0 011.7 0c.4.6.5 1.4.3 2.1L12.4 9h5.3a2 2 0 011.9 2.6l-1.9 6A2 2 0 0115.8 19H7" />
  </svg>
);

export default LibraryControls;
