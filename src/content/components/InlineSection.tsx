/**
 * InlineSection Component
 *
 * The overlay as a section of the host page rather than a card on top of it.
 *
 * Every value here was measured off Netflix's own DOM so this matches rather
 * than approximates: section headings are 24px/400 with `48px 0 20px` margins,
 * fact rows are 14px on a 20px line with a `#777` label, and the panels reuse
 * the exact grey their "More Like This" cards paint behind a synopsis —
 * `rgb(47,47,47)` on a 4px radius with `#d2d2d2` text.
 *
 * No emoji and no colour beyond that greyscale: the point is to look like a
 * part of the site, and the site is monochrome here. The floating variant
 * (`OverlayCard`) keeps the poster palette and card chrome, which is right for
 * something that genuinely floats.
 */

import React, { useState } from "react";
import type { AiScoreResult, Award, Movie, Rating } from "@shared/types/movie";
import type { AiScoresState } from "./OverlayCard";
import { sortRatingsByPriority, getScoreTier } from "@shared/utils/scoring";
import { RATING_SOURCES } from "@shared/constants";
import { ratingUrl, awardUrl, personUrl } from "@shared/utils/links";
import { useLibraryEntry } from "../hooks/useLibraryEntry";
import LibraryControls from "./LibraryControls";

interface InlineSectionProps {
  movie: Movie;
  ratings: Rating[];
  averageScore?: number | null;
  aiScores?: AiScoresState | null;
}

/** Netflix's own values, measured from the live page. */
const PANEL_BG = "rgb(47, 47, 47)";
const PANEL_RADIUS = "4px";
const LABEL_COLOR = "#777";
const BODY_COLOR = "#d2d2d2";

/** Named awards shown before the list collapses. */
const AWARD_PREVIEW = 5;

/**
 * Award marks, in Netflix's own small-badge treatment.
 *
 * Their HD and maturity chips are 11px on a 3px radius with a thin outline and
 * no fill, so these are too. A win and a nomination differ only in tone and in
 * whether the wreath is filled — the same restraint the rest of the section
 * uses, and enough to tell apart at a glance without the row turning into a
 * row of stickers.
 *
 * The gold is deliberately desaturated. A true award gold reads as a warning
 * badge against Netflix's greys.
 */
const WIN_COLOR = "#d4b36a";
const WIN_BORDER = "rgba(212, 179, 106, 0.45)";
const NOM_COLOR = "rgba(255, 255, 255, 0.55)";
const NOM_BORDER = "rgba(255, 255, 255, 0.22)";

const InlineSection: React.FC<InlineSectionProps> = ({
  movie,
  ratings,
  averageScore = null,
  aiScores = null,
}) => {
  const [showAllAwards, setShowAllAwards] = useState(false);
  const [showScores, setShowScores] = useState(false);

  // The IMDb id is what makes this entry the same film across platforms; the
  // rest is what the library needs to show it back without another lookup.
  const library = useLibraryEntry({
    title: movie.title,
    year: movie.year,
    imdbId: movie.imdbId,
    posterUrl: movie.posterUrl,
  });

  const named = (movie.awards ?? []).filter(isNamed);
  const totals = awardTotals(movie.awards ?? []);
  const visible = showAllAwards ? named : named.slice(0, AWARD_PREVIEW);

  return (
    <section className="cb-w-full">
      <h3
        style={{
          fontSize: "24px",
          fontWeight: 400,
          color: "#fff",
          margin: "48px 0 20px",
          lineHeight: "normal",
        }}
      >
        Ratings &amp; Awards
      </h3>

      <LibraryControls controls={library} />

      {/* Ratings, one panel each */}
      {ratings.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(ratings.length + (averageScore !== null ? 1 : 0), 4)}, minmax(0, 1fr))`,
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          {sortRatingsByPriority(ratings).map((rating) => (
            <Panel key={rating.source} href={ratingUrl(rating.source, movie.title, movie.imdbId)}>
              <div style={{ color: LABEL_COLOR, fontSize: "13px", marginBottom: "4px" }}>
                {RATING_SOURCES[rating.source]?.name ?? rating.source}
              </div>
              <div style={{ color: "#fff", fontSize: "20px", lineHeight: "24px" }}>
                {formatScore(rating)}
              </div>
            </Panel>
          ))}

          {averageScore !== null && (
            <Panel>
              <div style={{ color: LABEL_COLOR, fontSize: "13px", marginBottom: "4px" }}>
                Overall
              </div>
              <div style={{ color: "#fff", fontSize: "20px", lineHeight: "24px" }}>
                {averageScore}{" "}
                <span style={{ color: BODY_COLOR, fontSize: "14px" }}>
                  {getScoreTier(averageScore)}
                </span>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Awards, with who actually received each one */}
      {(named.length > 0 || totals.wins > 0 || totals.nominations > 0) && (
        <Panel>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: named.length > 0 ? "12px" : 0,
            }}
          >
            <span style={{ color: "#fff", fontSize: "16px" }}>Awards</span>
            <span style={{ color: LABEL_COLOR, fontSize: "13px" }}>
              {[
                totals.wins > 0 ? `${totals.wins} ${plural(totals.wins, "win")}` : null,
                totals.nominations > 0
                  ? `${totals.nominations} ${plural(totals.nominations, "nomination")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {visible.map((award) => (
            <AwardRow key={`${award.name}-${award.category ?? ""}-${award.year}`} award={award} />
          ))}

          {named.length > AWARD_PREVIEW && (
            <TextButton onClick={() => setShowAllAwards(!showAllAwards)}>
              {showAllAwards ? "Show less" : `Show all ${named.length} awards`}
            </TextButton>
          )}
        </Panel>
      )}

      {/* AI analysis, opened on demand because generating it costs a real call */}
      {aiScores && (
        <div style={{ marginTop: "8px" }}>
          <Panel>
            <button
              onClick={() => {
                const next = !showScores;
                setShowScores(next);
                if (next) aiScores.onRequest();
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "16px",
                color: "#fff",
              }}
            >
              <span>AI review analysis</span>
              <span style={{ color: LABEL_COLOR, fontSize: "13px" }}>
                {showScores ? "Hide" : "Show"}
              </span>
            </button>

            {showScores && (
              <div style={{ marginTop: "12px" }}>
                <AiDetail state={aiScores} />
              </div>
            )}
          </Panel>
        </div>
      )}
    </section>
  );
};

/**
 * A panel in the grey Netflix paints behind its own card synopses.
 *
 * With an `href` it becomes a link to the source, lifting slightly on hover —
 * the same affordance Netflix gives its own cards, rather than an underline,
 * which would fight the typography.
 */
const Panel: React.FC<{ children: React.ReactNode; href?: string | null }> = ({
  children,
  href,
}) => {
  const [hover, setHover] = useState(false);

  const style: React.CSSProperties = {
    display: "block",
    background: hover && href ? "rgb(60, 60, 60)" : PANEL_BG,
    borderRadius: PANEL_RADIUS,
    padding: "14px",
    fontSize: "14px",
    lineHeight: "20px",
    color: BODY_COLOR,
    textDecoration: "none",
    transition: "background 120ms ease",
    cursor: href ? "pointer" : "default",
  };

  if (!href) return <div style={style}>{children}</div>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
    </a>
  );
};

/**
 * One award: what it was, and who actually received it.
 *
 * The recipients are the point of this row. "Won 4 Oscars" is a fact about a
 * film; "Adam McKay and Charles Randolph won Best Adapted Screenplay" is a
 * fact about people, and it is the one worth reading.
 */
const AwardRow: React.FC<{ award: Award }> = ({ award }) => {
  const [hover, setHover] = useState(false);
  const href = awardUrl(award.name, award.category, award.url);

  // The award title links to the award; the recipients beneath link to
  // themselves. So the row is not an anchor — nesting anchors is invalid and
  // browsers resolve it by dropping the inner ones, which would silently kill
  // the recipient links.
  const title = (
    <>
      {award.name}
      {award.category ? <span style={{ color: BODY_COLOR }}> {award.category}</span> : null}
    </>
  );

  return (
    <div
      style={{ display: "flex", gap: "10px", padding: "5px 0", alignItems: "baseline" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <AwardMark isWin={award.isWin} />

      <span style={{ flex: 1, minWidth: 0 }}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#fff", textDecoration: hover ? "underline" : "none" }}
          >
            {title}
          </a>
        ) : (
          <span style={{ color: "#fff" }}>{title}</span>
        )}

        {award.count && award.count > 1 ? (
          <span style={{ color: LABEL_COLOR }}> ×{award.count}</span>
        ) : null}

        {award.people && award.people.length > 0 ? (
          <div style={{ color: LABEL_COLOR, fontSize: "13px" }}>
            {award.people.map((name, index) => (
              <React.Fragment key={name}>
                {index > 0 && ", "}
                <PersonLink name={name} />
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </span>

      <span style={{ color: LABEL_COLOR, fontSize: "13px", flexShrink: 0 }}>{award.year}</span>
    </div>
  );
};

/**
 * A recipient's name, linking to who they are.
 */
const PersonLink: React.FC<{ name: string }> = ({ name }) => {
  const href = personUrl(name);
  const [hover, setHover] = useState(false);

  if (!href) return <>{name}</>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: hover ? "#fff" : LABEL_COLOR,
        textDecoration: hover ? "underline" : "none",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {name}
    </a>
  );
};

/**
 * The win/nomination mark: a laurel and a short label, in Netflix's chip
 * treatment. Filled wreath and warm tone for a win, hollow and grey for a
 * nomination.
 */
const AwardMark: React.FC<{ isWin: boolean }> = ({ isWin }) => (
  <span
    title={isWin ? "Won" : "Nominated"}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "3px",
      flexShrink: 0,
      width: "58px",
      justifyContent: "center",
      fontSize: "11px",
      lineHeight: "16px",
      letterSpacing: "0.06em",
      padding: "1px 5px",
      borderRadius: "3px",
      color: isWin ? WIN_COLOR : NOM_COLOR,
      border: `1px solid ${isWin ? WIN_BORDER : NOM_BORDER}`,
    }}
  >
    <Laurel filled={isWin} />
    {isWin ? "WON" : "NOM"}
  </span>
);

/**
 * A laurel wreath at 12px.
 *
 * Detail is lost at this size, so the silhouette does the work: two mirrored
 * arcs read as a wreath, and the centre is filled only for a win.
 */
const Laurel: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.4 3.8C4.9 6.3 3.6 10 4.2 13.7c.6 3.6 2.9 6.3 6.2 7.6" />
      <path d="M15.6 3.8C19.1 6.3 20.4 10 19.8 13.7c-.6 3.6-2.9 6.3-6.2 7.6" />
    </g>
    {filled ? (
      <circle cx="12" cy="12.4" r="2.4" fill="currentColor" />
    ) : (
      <circle
        cx="12"
        cy="12.4"
        r="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    )}
  </svg>
);

const TextButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    style={{
      marginTop: "8px",
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
    {children}
  </button>
);

const AiDetail: React.FC<{ state: AiScoresState }> = ({ state }) => {
  if (state.isLoading) return <Note>Reading reviews… this takes a moment the first time.</Note>;
  if (state.error) return <Note>Couldn&apos;t generate scores: {state.error.message}</Note>;
  if (state.isPending) return <Note>Already being scored. Reopen in a moment.</Note>;
  if (state.retryAfterMs !== null) return <Note>Scoring limit reached. Try again later.</Note>;
  if (!state.result) return <Note>Not enough published reviews to score this one.</Note>;

  return <AiScores result={state.result} />;
};

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ color: LABEL_COLOR, fontSize: "14px" }}>{children}</div>
);

const AiScores: React.FC<{ result: AiScoreResult }> = ({ result }) => {
  const entries = Object.entries(result.scores).filter(
    ([, value]) => typeof value === "number"
  ) as Array<[string, number]>;

  return (
    <>
      {result.summary && (
        <p style={{ color: BODY_COLOR, margin: "0 0 12px" }}>{result.summary}</p>
      )}

      {entries.map(([category, value]) => (
        <div
          key={category}
          style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}
        >
          <span style={{ color: BODY_COLOR }}>{capitalize(category)}</span>
          <span style={{ color: "#fff" }}>{value.toFixed(1)}</span>
        </div>
      ))}

      {result.sources.length > 0 && (
        <div style={{ color: LABEL_COLOR, fontSize: "13px", marginTop: "12px" }}>
          Based on {result.sources.length}{" "}
          {plural(result.sources.length, "review")}:{" "}
          {result.sources.map((source, index) => (
            <React.Fragment key={source.url}>
              {index > 0 && ", "}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: BODY_COLOR, textDecoration: "underline" }}
              >
                {source.publication ?? hostnameOf(source.url)}
              </a>
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
};

/**
 * The aggregate rows the backend synthesises are counts rather than named
 * awards, and belong in the header's totals instead of the list.
 */
function isNamed(award: Award): boolean {
  return award.name !== "Other awards" && award.name !== "Nominations";
}

function awardTotals(awards: Award[]): { wins: number; nominations: number } {
  let wins = 0;
  let nominations = 0;

  for (const award of awards) {
    const count = award.count ?? 1;
    if (award.isWin) wins += count;
    else nominations += count;
  }

  return { wins, nominations };
}

function formatScore(rating: Rating): string {
  return rating.maxScore === 100
    ? `${rating.score}%`
    : `${rating.score}/${rating.maxScore}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default InlineSection;
