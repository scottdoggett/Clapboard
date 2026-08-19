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

import React, { useEffect, useMemo, useState } from "react";
import { listEntries, groupEntries, type LibraryEntry } from "@shared/utils/library";
import {
  buildListView,
  SORT_MODES,
  type SortMode,
} from "@shared/utils/libraryView";
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [pages, setPages] = useState(1);

  useEffect(() => {
    let active = true;
    void listEntries().then((found) => {
      if (active) setEntries(found);
    });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  // Paging is per view: switching tab or narrowing the search should start
  // again at the top rather than keep however far the last one was scrolled
  useEffect(() => setPages(1), [tab, query, sort]);

  const grouped = useMemo(() => groupEntries(entries ?? []), [entries]);
  const view = useMemo(
    () => buildListView(grouped[tab], query, sort, pages),
    [grouped, tab, query, sort, pages]
  );

  if (entries === null) return <p style={muted}>Loading…</p>;

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

      {/* Search and ordering only appear once the list is big enough to need
          them — on a handful of titles they are two controls in the way */}
      {grouped[tab].length > SEARCH_THRESHOLD && (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${grouped[tab].length.toLocaleString()} titles`}
            style={search}
          />

          <div style={{ display: "flex", gap: "4px", margin: "8px 0 10px" }}>
            {SORT_MODES.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setSort(id)}
                style={{
                  flex: 1,
                  background: sort === id ? "rgba(255,255,255,0.08)" : "transparent",
                  border: `1px solid ${sort === id ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: "4px",
                  color: sort === id ? "#d2d2d2" : "#6b6b6b",
                  padding: "4px 2px",
                  fontSize: "11px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {view.total === 0 ? (
        <p style={muted}>
          {query.trim() !== "" ? `Nothing matching “${query.trim()}”.` : emptyMessage(tab)}
        </p>
      ) : (
        <>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {view.visible.map((entry) => (
              <EntryRow key={entry.key} entry={entry} showReview={tab === "reviewed"} />
            ))}
          </ul>

          {/* Whatever is held back is counted. A list that silently stops is
              indistinguishable from a list that ends. */}
          {view.remaining > 0 && (
            <button style={moreButton} onClick={() => setPages((count) => count + 1)}>
              Show {Math.min(view.remaining, 60).toLocaleString()} more ·{" "}
              {view.remaining.toLocaleString()} left
            </button>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Below this many entries, a search box is clutter rather than help.
 */
const SEARCH_THRESHOLD = 12;

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

const search: React.CSSProperties = {
  width: "100%",
  background: "rgba(0, 0, 0, 0.4)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "4px",
  color: "#fff",
  padding: "7px 10px",
  fontSize: "12px",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const moreButton: React.CSSProperties = {
  width: "100%",
  marginTop: "10px",
  background: "transparent",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  borderRadius: "4px",
  color: "#8c8c8c",
  padding: "7px 10px",
  fontSize: "12px",
  fontFamily: "inherit",
  cursor: "pointer",
};

export default LibraryList;
