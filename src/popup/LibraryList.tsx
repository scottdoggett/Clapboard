/**
 * LibraryList Component
 *
 * The user's own lists: what they mean to watch, what they have watched, what
 * they wrote about.
 *
 * Reads from local storage, not the server, and does so deliberately — that is
 * the copy the extension writes to as you browse, it is present whether or not
 * you have an account, and it is right even when the network is not.
 */

import React, { useEffect, useState } from "react";
import { listEntries, groupEntries, type LibraryEntry } from "@shared/utils/library";
import { ratingUrl } from "@shared/utils/links";

type Tab = "watchlist" | "watched" | "reviewed";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "watchlist", label: "Watchlist" },
  { id: "watched", label: "Watched" },
  { id: "reviewed", label: "Reviews" },
];

const LibraryList: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>("watchlist");

  useEffect(() => {
    let active = true;
    void listEntries().then((found) => {
      if (active) setEntries(found);
    });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  if (entries === null) return <p style={muted}>Loading…</p>;

  const grouped = groupEntries(entries);
  const shown = grouped[tab];

  return (
    <div>
      <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1,
              background: tab === id ? "rgba(255, 255, 255, 0.1)" : "transparent",
              border: `1px solid ${tab === id ? "rgba(255,255,255,0.22)" : "transparent"}`,
              borderRadius: "4px",
              color: tab === id ? "#fff" : "#8c8c8c",
              padding: "6px 4px",
              fontSize: "12px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {label}
            <span style={{ color: "#6b6b6b", marginLeft: "4px" }}>
              {grouped[id].length}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p style={muted}>{emptyMessage(tab)}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.slice(0, 40).map((entry) => (
            <EntryRow key={entry.key} entry={entry} showReview={tab === "reviewed"} />
          ))}
        </ul>
      )}
    </div>
  );
};

const EntryRow: React.FC<{ entry: LibraryEntry; showReview: boolean }> = ({
  entry,
  showReview,
}) => {
  const href = ratingUrl("IMDb", entry.title, entry.imdbId);

  return (
    <li
      style={{
        display: "flex",
        gap: "10px",
        padding: "8px 0",
        borderTop: "1px solid rgba(255, 255, 255, 0.07)",
      }}
    >
      {entry.posterUrl ? (
        <img
          src={entry.posterUrl}
          alt=""
          style={{
            width: "32px",
            height: "48px",
            objectFit: "cover",
            borderRadius: "3px",
            flexShrink: 0,
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
      ) : (
        <div
          style={{
            width: "32px",
            height: "48px",
            borderRadius: "3px",
            flexShrink: 0,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <a
          href={href ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#fff",
            fontSize: "13px",
            textDecoration: "none",
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.title}
        </a>

        <div style={{ color: "#8c8c8c", fontSize: "11px", marginTop: "2px" }}>
          {[
            entry.year ? String(entry.year) : null,
            entry.review?.rating !== undefined ? `${entry.review.rating}/10` : null,
            entry.sentiment === "liked" ? "Liked" : entry.sentiment === "disliked" ? "Not for me" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>

        {showReview && entry.review?.text ? (
          <p
            style={{
              color: "#d2d2d2",
              fontSize: "12px",
              lineHeight: "17px",
              margin: "4px 0 0",
            }}
          >
            {entry.review.text}
          </p>
        ) : null}
      </div>
    </li>
  );
};

function emptyMessage(tab: Tab): string {
  switch (tab) {
    case "watchlist":
      return "Nothing saved yet. Add titles from the browse grid or a title page.";
    case "watched":
      return "Nothing marked watched yet.";
    case "reviewed":
      return "No reviews yet. Write one from a title page.";
  }
}

const muted: React.CSSProperties = {
  color: "#8c8c8c",
  fontSize: "12px",
  lineHeight: "17px",
  margin: "12px 0",
};

export default LibraryList;
