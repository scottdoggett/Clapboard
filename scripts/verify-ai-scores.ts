/**
 * AI Score Parser Verification
 *
 * Exercises the pure functions in convex/aiScoresParse.ts. These sit between a
 * model's tool call and the database, which means they're the only thing
 * standing between a hallucinated or malformed score and the overlay — so they
 * get checked here, where no API key or deployment is needed.
 *
 * Run with: npm run verify:ai-scores
 */

import {
  parseScoreSubmission,
  aggregateScores,
  buildScoringPrompt,
  evaluateBudget,
  isPendingLive,
  runLogCutoff,
  SCORE_CATEGORIES,
  SCORE_TOOL_SCHEMA,
  RUN_BUDGET,
  CLIENT_RUN_BUDGET,
  PENDING_TIMEOUT_MS,
  type AiScoreResult,
} from "../convex/aiScoresParse";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

/** A well-formed tool call, as the schema constrains it. */
const complete = {
  cinematography: 9,
  plot: 7.5,
  writing: 8,
  characters: 8.5,
  soundtrack: 9.5,
  overall: 8.5,
  summary: "Widely praised for its visuals and score, with some reservations about the plot.",
  sources: [
    { url: "https://www.theguardian.com/film/review", publication: "The Guardian" },
    { url: "https://www.rogerebert.com/reviews/example", publication: null },
  ],
};

check("complete submission", parseScoreSubmission(complete), {
  scores: {
    cinematography: 9,
    plot: 7.5,
    writing: 8,
    characters: 8.5,
    soundtrack: 9.5,
    overall: 8.5,
  },
  sources: [
    { url: "https://www.theguardian.com/film/review", publication: "The Guardian" },
    { url: "https://www.rogerebert.com/reviews/example" },
  ],
  summary: "Widely praised for its visuals and score, with some reservations about the plot.",
});

// Nulls are how the model says "the reviews didn't discuss this" — they must
// come through as absent rather than as zero, which would read as "terrible"
check(
  "nulls drop out rather than becoming zero",
  parseScoreSubmission({
    ...complete,
    soundtrack: null,
    cinematography: null,
  })?.scores,
  { plot: 7.5, writing: 8, characters: 8.5, overall: 8.5 }
);

// --- Rejections ------------------------------------------------------------
check("null input", parseScoreSubmission(null), null);
check("non-object input", parseScoreSubmission("scores!"), null);
check(
  "no overall score",
  parseScoreSubmission({ ...complete, overall: null }),
  null
);
// An overall score alone duplicates the ratings we already show
check(
  "overall with too little detail",
  parseScoreSubmission({
    cinematography: null,
    plot: 7,
    writing: null,
    characters: null,
    soundtrack: null,
    overall: 7,
    summary: null,
    sources: [],
  }),
  null
);
check(
  "empty submission",
  parseScoreSubmission({
    cinematography: null,
    plot: null,
    writing: null,
    characters: null,
    soundtrack: null,
    overall: null,
    summary: null,
    sources: [],
  }),
  null
);

// --- Value hardening -------------------------------------------------------
check(
  "out of range scores clamp",
  parseScoreSubmission({ ...complete, plot: 47, writing: -3 })?.scores,
  {
    cinematography: 9,
    plot: 10,
    writing: 0,
    characters: 8.5,
    soundtrack: 9.5,
    overall: 8.5,
  }
);
check(
  "excess precision rounds to one decimal",
  parseScoreSubmission({ ...complete, plot: 7.4444 })?.scores.plot,
  7.4
);
check(
  "non-numeric scores are dropped",
  parseScoreSubmission({ ...complete, plot: "8/10", soundtrack: NaN })?.scores,
  { cinematography: 9, writing: 8, characters: 8.5, overall: 8.5 }
);

// --- Sources ---------------------------------------------------------------
check(
  "non-http sources rejected",
  parseScoreSubmission({
    ...complete,
    sources: [
      { url: "javascript:alert(1)", publication: "Nope" },
      { url: "example.com/review", publication: "Nope" },
      { url: "https://variety.com/review", publication: "Variety" },
    ],
  })?.sources,
  [{ url: "https://variety.com/review", publication: "Variety" }]
);
check(
  "duplicate sources collapse",
  parseScoreSubmission({
    ...complete,
    sources: [
      { url: "https://variety.com/review", publication: "Variety" },
      { url: "https://variety.com/review", publication: "Variety" },
    ],
  })?.sources.length,
  1
);
check(
  "malformed source entries skipped",
  parseScoreSubmission({ ...complete, sources: [null, "https://x.com", 42] })?.sources,
  []
);
check(
  "non-array sources tolerated",
  parseScoreSubmission({ ...complete, sources: "The Guardian" })?.sources,
  []
);

// --- Summary ---------------------------------------------------------------
check("blank summary dropped", parseScoreSubmission({ ...complete, summary: "   " })?.summary, undefined);
check(
  "long summary truncated",
  parseScoreSubmission({ ...complete, summary: "word ".repeat(200) })?.summary?.length,
  400
);
check(
  "summary whitespace collapsed",
  parseScoreSubmission({ ...complete, summary: "Good\n\n  film." })?.summary,
  "Good film."
);

// --- Aggregation -----------------------------------------------------------
const perReview: AiScoreResult[] = [
  { scores: { plot: 8, writing: 7, overall: 8 }, sources: [{ url: "https://a.com/r" }] },
  { scores: { plot: 6, characters: 9, overall: 7 }, sources: [{ url: "https://b.com/r" }] },
];

check("aggregate averages per category", aggregateScores(perReview)?.scores, {
  plot: 7,
  writing: 7,
  characters: 9,
  overall: 7.5,
});
check("aggregate merges sources", aggregateScores(perReview)?.sources, [
  { url: "https://a.com/r" },
  { url: "https://b.com/r" },
]);
check("aggregate of nothing", aggregateScores([]), null);
check(
  "aggregate without any overall",
  aggregateScores([{ scores: { plot: 8 }, sources: [] }]),
  null
);

// --- Prompt and schema -----------------------------------------------------
check(
  "prompt names the film and year",
  buildScoringPrompt("Inception", 2010, "movie"),
  'Find and read published reviews of the film "Inception" (2010), then score it with submit_scores.'
);
check(
  "prompt handles a series without a year",
  buildScoringPrompt("The Bear", undefined, "series"),
  'Find and read published reviews of the TV series "The Bear", then score it with submit_scores.'
);

// Strict tool use requires every property to be listed in `required` and
// additionalProperties disabled, or the API rejects the tool definition
check(
  "schema requires every category",
  SCORE_CATEGORIES.every((category) => SCORE_TOOL_SCHEMA.required.includes(category)),
  true
);
check(
  "schema lists every property as required",
  Object.keys(SCORE_TOOL_SCHEMA.properties).sort(),
  [...SCORE_TOOL_SCHEMA.required].sort()
);
check("schema closed for strict mode", SCORE_TOOL_SCHEMA.additionalProperties, false);

// --- Spend guard -----------------------------------------------------------
// The window arithmetic is what stands between a browse session and an
// unbounded bill, and its boundaries can't be checked by waiting an hour.

const NOW = 1_700_000_000_000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** n runs, spaced `spacing` apart, the oldest `oldestAge` ms ago */
function runs(n: number, oldestAge: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => NOW - oldestAge + i * spacing);
}

check("no runs is allowed", evaluateBudget([], NOW), { allowed: true });
check(
  "one under the hourly ceiling",
  evaluateBudget(runs(RUN_BUDGET.perHour - 1, 30 * MINUTE, MINUTE), NOW),
  { allowed: true }
);

const atHourlyCeiling = evaluateBudget(
  runs(RUN_BUDGET.perHour, 30 * MINUTE, MINUTE),
  NOW
);
check("at the hourly ceiling is refused", atHourlyCeiling.allowed, false);
// The wait runs until the oldest run leaves the window, not a fixed hour
check(
  "retry is when the oldest run ages out",
  atHourlyCeiling.allowed === false ? atHourlyCeiling.retryAfterMs : null,
  30 * MINUTE
);

// Runs that have already left the hour window must stop counting against it
check(
  "runs older than an hour free up the hourly budget",
  evaluateBudget(runs(RUN_BUDGET.perHour, 3 * HOUR, MINUTE), NOW),
  { allowed: true }
);

// The daily ceiling binds even when the hourly one is clear
const spreadOverDay = runs(RUN_BUDGET.perDay, 20 * HOUR, 5 * MINUTE);
const atDailyCeiling = evaluateBudget(spreadOverDay, NOW);
check("at the daily ceiling is refused", atDailyCeiling.allowed, false);
check(
  "daily refusal waits out the oldest run of the day",
  atDailyCeiling.allowed === false
    ? Math.round(atDailyCeiling.retryAfterMs / HOUR)
    : null,
  4
);
check(
  "runs older than a day are ignored entirely",
  evaluateBudget(runs(RUN_BUDGET.perDay, 30 * HOUR, MINUTE), NOW),
  { allowed: true }
);

// A clock skew between the deployment and a stored row must not grant free runs
check(
  "future timestamps are ignored",
  evaluateBudget(
    Array.from({ length: RUN_BUDGET.perHour }, () => NOW + HOUR),
    NOW
  ),
  { allowed: true }
);
check("unordered input is handled", evaluateBudget(
  runs(RUN_BUDGET.perHour, 30 * MINUTE, MINUTE).reverse(),
  NOW
).allowed, false);

// --- Pending claims --------------------------------------------------------
check("a fresh claim is live", isPendingLive(NOW - MINUTE, NOW), true);
check(
  "a claim past its timeout is abandoned",
  isPendingLive(NOW - PENDING_TIMEOUT_MS - 1, NOW),
  false
);
check("run log cutoff is one day back", runLogCutoff(NOW), NOW - DAY);

// --- Per-installation ceiling ---------------------------------------------
// The deployment budget protects the bill; this protects everyone else from
// whoever browses hardest.

check(
  "a client's own ceiling is lower than the deployment's",
  CLIENT_RUN_BUDGET.perHour < RUN_BUDGET.perHour &&
    CLIENT_RUN_BUDGET.perDay < RUN_BUDGET.perDay,
  true
);

// A client at its own ceiling is refused while the deployment still has room —
// which is the whole point: their share is spent, everyone else's isn't
const clientSpent = runs(CLIENT_RUN_BUDGET.perHour, 30 * MINUTE, MINUTE);
check(
  "a client at its ceiling is refused",
  evaluateBudget(clientSpent, NOW, CLIENT_RUN_BUDGET).allowed,
  false
);
check(
  "...while the deployment still has room",
  evaluateBudget(clientSpent, NOW, RUN_BUDGET),
  { allowed: true }
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
