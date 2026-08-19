/**
 * InlineSection Component
 *
 * The overlay as a section of the host page rather than a card on top of it.
 *
 * Every value here was measured off Netflix's own DOM so this matches rather
 * than approximates: their section headings are 24px/400 with `48px 0 20px`
 * margins, and their fact rows are 14px on a 20px line with a `#777` label and
 * a `#ddd` value. Reusing those exact numbers is the whole point — a panel
 * with its own background, borders and icons reads as something pasted into
 * the page no matter how carefully it's styled.
 *
 * So: no background, no border, no rounded corners, no emoji. The floating
 * variant (`OverlayCard`) keeps all of that, because a card that genuinely
 * floats over the page should look like one.
 */

import React, { useState } from "react";
import type { AiScoreResult, Award, Movie, Rating } from "@shared/types/movie";
import type { AiScoresState } from "./OverlayCard";
import { sortRatingsByPriority, getScoreTier } from "@shared/utils/scoring";
import { RATING_SOURCES } from "@shared/constants";

interface InlineSectionProps {
  movie: Movie;
  ratings: Rating[];
  averageScore?: number | null;
  aiScores?: AiScoresState | null;
}

/** Netflix's own colours for a label/value pair. */
const LABEL_COLOR = "#777";
const VALUE_COLOR = "#ddd";

/** How many named awards to list before collapsing the rest into a count. */
const AWARD_PREVIEW = 4;

const InlineSection: React.FC<InlineSectionProps> = ({
  movie,
  ratings,
  averageScore = null,
  aiScores = null,
}) => {
  const [showAllAwards, setShowAllAwards] = useState(false);
  const [showScores, setShowScores] = useState(false);

  const named = movie.awards?.filter(isNamed) ?? [];
  const wins = named.filter((award) => award.isWin);
  const nominations = named.filter((award) => !award.isWin);
  const totals = awardTotals(movie.awards ?? []);

  const visibleWins = showAllAwards ? wins : wins.slice(0, AWARD_PREVIEW);
  const visibleNominations = showAllAwards ? nominations : [];

  return (
    <section className="cb-w-full" style={{ fontFamily: "inherit" }}>
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

      {ratings.length > 0 && (
        <Row label="Ratings:">
          {joinWithDot(
            sortRatingsByPriority(ratings).map((rating) => (
              <span key={rating.source}>
                {RATING_SOURCES[rating.source]?.name ?? rating.source}{" "}
                <span style={{ color: "#fff" }}>{formatScore(rating)}</span>
              </span>
            ))
          )}
        </Row>
      )}

      {averageScore !== null && (
        <Row label="Overall:">
          <span style={{ color: "#fff" }}>{averageScore}</span> · {getScoreTier(averageScore)}
        </Row>
      )}

      {visibleWins.length > 0 && (
        <Row label="Won:">{joinWithDot(visibleWins.map(awardText))}</Row>
      )}

      {visibleNominations.length > 0 && (
        <Row label="Nominated:">{joinWithDot(visibleNominations.map(awardText))}</Row>
      )}

      {(totals.wins > 0 || totals.nominations > 0) && (
        <Row label="Total:">
          {[
            totals.wins > 0 ? `${totals.wins} ${plural(totals.wins, "win")}` : null,
            totals.nominations > 0
              ? `${totals.nominations} ${plural(totals.nominations, "nomination")}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Row>
      )}

      {named.length > AWARD_PREVIEW && (
        <TextButton onClick={() => setShowAllAwards(!showAllAwards)}>
          {showAllAwards ? "Show less" : `Show all ${named.length} awards`}
        </TextButton>
      )}

      {aiScores && (
        <>
          <TextButton
            onClick={() => {
              const next = !showScores;
              setShowScores(next);
              if (next) aiScores.onRequest();
            }}
          >
            {showScores ? "Hide AI analysis" : "Show AI analysis"}
          </TextButton>

          {showScores && <AiRows state={aiScores} />}
        </>
      )}
    </section>
  );
};

/**
 * One fact row, matching `.previewModal--tags` exactly.
 */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div style={{ fontSize: "14px", lineHeight: "20px", margin: "7px 7px 7px 0" }}>
    <span style={{ color: LABEL_COLOR }}>{label}</span>{" "}
    <span style={{ color: VALUE_COLOR }}>{children}</span>
  </div>
);

/**
 * A text-only control. Netflix has no button chrome in this part of the modal,
 * so neither does this.
 */
const TextButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    style={{
      fontSize: "14px",
      lineHeight: "20px",
      margin: "7px 14px 7px 0",
      color: LABEL_COLOR,
      background: "none",
      border: "none",
      padding: 0,
      cursor: "pointer",
      fontFamily: "inherit",
    }}
    onMouseEnter={(event) => (event.currentTarget.style.color = "#fff")}
    onMouseLeave={(event) => (event.currentTarget.style.color = LABEL_COLOR)}
  >
    {children}
  </button>
);

/**
 * AI category scores, as further fact rows rather than as bars.
 */
const AiRows: React.FC<{ state: AiScoresState }> = ({ state }) => {
  if (state.isLoading) return <Row label="AI analysis:">Reading reviews…</Row>;
  if (state.error) return <Row label="AI analysis:">Unavailable</Row>;
  if (state.isPending) return <Row label="AI analysis:">Already in progress</Row>;
  if (state.retryAfterMs !== null) return <Row label="AI analysis:">Limit reached</Row>;
  if (!state.result) return <Row label="AI analysis:">Not enough published reviews</Row>;

  return <AiScoreRows result={state.result} />;
};

const AiScoreRows: React.FC<{ result: AiScoreResult }> = ({ result }) => {
  const entries = Object.entries(result.scores).filter(
    ([, value]) => typeof value === "number"
  ) as Array<[string, number]>;

  return (
    <>
      {result.summary && <Row label="Consensus:">{result.summary}</Row>}
      {entries.length > 0 && (
        <Row label="Scores:">
          {joinWithDot(
            entries.map(([category, value]) => (
              <span key={category}>
                {capitalize(category)} <span style={{ color: "#fff" }}>{value.toFixed(1)}</span>
              </span>
            ))
          )}
        </Row>
      )}
      {result.sources.length > 0 && (
        <Row label="Sources:">
          {joinWithDot(
            result.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: VALUE_COLOR, textDecoration: "underline" }}
              >
                {source.publication ?? hostnameOf(source.url)}
              </a>
            ))
          )}
        </Row>
      )}
    </>
  );
};

/**
 * The aggregate rows the backend synthesises, which are counts rather than
 * named awards and belong in the totals line.
 */
function isNamed(award: Award): boolean {
  return award.name !== "Other awards" && award.name !== "Nominations";
}

/**
 * Total wins and nominations, counting the aggregate rows and the named ones
 * together so the figure matches what the awards bodies actually recorded.
 */
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

function awardText(award: Award): React.ReactNode {
  return (
    <span key={`${award.name}-${award.category ?? ""}-${award.year}`}>
      <span style={{ color: "#fff" }}>{award.name}</span>
      {award.category ? ` ${award.category}` : ""}
    </span>
  );
}

/**
 * Join with Netflix's own separator, which is a middot rather than a comma.
 */
function joinWithDot(items: React.ReactNode[]): React.ReactNode {
  return items.map((item, index) => (
    <React.Fragment key={index}>
      {index > 0 && <span style={{ color: LABEL_COLOR }}> · </span>}
      {item}
    </React.Fragment>
  ));
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
