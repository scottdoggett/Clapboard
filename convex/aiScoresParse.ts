/**
 * AI Score Parsing
 *
 * The pure half of Phase 3: the prompt, the tool schema Claude fills in, and
 * the validation that turns its answer into something safe to store. Kept free
 * of Convex and SDK imports so `npm run verify:ai-scores` can exercise it
 * without a deployment or an API key — the same split `omdbParse.ts` uses.
 */

/**
 * The categories the overlay displays, in the order it displays them.
 */
export const SCORE_CATEGORIES = [
  "cinematography",
  "plot",
  "writing",
  "characters",
  "soundtrack",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

/**
 * A scored title. Every field is optional because a set of reviews may say
 * nothing about, say, the soundtrack, and a made-up number is worse than a
 * missing one.
 */
export type CategoryScores = Partial<Record<ScoreCategory, number>> & {
  overall?: number;
};

/**
 * A review Claude actually read, kept so the overlay can link out and so a
 * score can be audited rather than taken on faith.
 */
export interface ScoreSource {
  url: string;
  publication?: string;
}

export interface AiScoreResult {
  scores: CategoryScores;
  sources: ScoreSource[];
  summary?: string;
}

/** Scores are on a 0-10 scale, matching the aiScores schema. */
const MIN_SCORE = 0;
const MAX_SCORE = 10;

/**
 * A result needs an overall score and at least this many categories to be
 * worth storing. Below that the reviews didn't say enough to be useful, and a
 * near-empty card is worse than no card.
 */
const MIN_CATEGORIES = 2;

/** Cap on how much of Claude's prose we keep, in characters. */
const MAX_SUMMARY_LENGTH = 400;

/** Sources beyond this are noise in a card that shows a handful of scores. */
const MAX_SOURCES = 8;

/**
 * System prompt for the scoring call.
 *
 * Two things it has to get right: the scores must come from what reviewers
 * actually wrote rather than from the model's own opinion of the film, and a
 * category nobody discussed must come back missing rather than guessed. The
 * whole feature is "here is what critics said", so a plausible invention
 * defeats the point.
 */
export const SCORING_SYSTEM_PROMPT = `You are a film analyst. Your job is to read published reviews of a title and summarize what reviewers said about specific aspects of it, as numeric scores.

Rules:
- Search the web for written reviews from critics and audiences. Read several from different publications before scoring.
- Score only what the reviews actually discuss. If reviewers barely mention a category, omit it — do not infer a score from the film's reputation, its ratings, or your own knowledge of it.
- Scores are 0-10, where 5 is mixed, 7 is well received, and 9+ is near-universal praise. Use the spread of opinion, not your own judgement of the work.
- "overall" reflects the general critical reception, not the average of the other categories.
- Cite the reviews you drew on. Every source URL must be one you actually read in this conversation.
- When you cannot find enough reviews to score the title, call the tool with no scores rather than guessing.

Call submit_scores exactly once when you are done.`;

/**
 * JSON schema for the tool Claude calls to hand back its answer.
 *
 * Structured output via a strict tool rather than free text: the response
 * shares a turn with server-side web search results, and a schema-validated
 * tool call is the part of that turn we can rely on parsing.
 */
export const SCORE_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    cinematography: {
      type: ["number", "null"],
      description: "0-10, or null if reviews don't discuss the visuals",
    },
    plot: {
      type: ["number", "null"],
      description: "0-10, or null if reviews don't discuss the story",
    },
    writing: {
      type: ["number", "null"],
      description: "0-10, or null if reviews don't discuss the script or dialogue",
    },
    characters: {
      type: ["number", "null"],
      description: "0-10, or null if reviews don't discuss the characters or performances",
    },
    soundtrack: {
      type: ["number", "null"],
      description: "0-10, or null if reviews don't discuss the score or soundtrack",
    },
    overall: {
      type: ["number", "null"],
      description: "0-10 summary of critical reception, or null if too few reviews were found",
    },
    summary: {
      type: ["string", "null"],
      description: "One or two sentences on the consensus, in the reviewers' terms",
    },
    sources: {
      type: "array",
      description: "The reviews these scores came from",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          publication: { type: ["string", "null"] },
        },
        required: ["url", "publication"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "cinematography",
    "plot",
    "writing",
    "characters",
    "soundtrack",
    "overall",
    "summary",
    "sources",
  ],
  additionalProperties: false,
};

/**
 * Build the user turn for a scoring request.
 *
 * @param title - Title as resolved by OMDb, not as the streaming site spelled it
 * @param year - Release year, when known
 * @param type - Movie or series
 * @returns The prompt text
 */
export function buildScoringPrompt(
  title: string,
  year?: number,
  type?: "movie" | "series"
): string {
  const kind = type === "series" ? "TV series" : type === "movie" ? "film" : "title";
  const released = year !== undefined ? ` (${year})` : "";

  return `Find and read published reviews of the ${kind} "${title}"${released}, then score it with submit_scores.`;
}

/**
 * Validate and normalize whatever came back in the tool call.
 *
 * The schema constrains the shape but not the values, and this data goes
 * straight into the database and then onto the screen — so scores are clamped,
 * non-numbers dropped, and anything that isn't an http(s) URL discarded.
 *
 * @param input - The `input` field of Claude's tool_use block
 * @returns A stored-shape result, or null when there wasn't enough to store
 */
export function parseScoreSubmission(input: unknown): AiScoreResult | null {
  if (input === null || typeof input !== "object") return null;

  const raw = input as Record<string, unknown>;
  const scores: CategoryScores = {};

  for (const category of SCORE_CATEGORIES) {
    const score = normalizeScore(raw[category]);
    if (score !== undefined) scores[category] = score;
  }

  const overall = normalizeScore(raw["overall"]);
  if (overall !== undefined) scores.overall = overall;

  // An overall score with nothing behind it is just a duplicate of the ratings
  // we already show, so require some category detail too
  const categoryCount = SCORE_CATEGORIES.filter((c) => scores[c] !== undefined).length;
  if (scores.overall === undefined || categoryCount < MIN_CATEGORIES) {
    return null;
  }

  return {
    scores,
    sources: normalizeSources(raw["sources"]),
    summary: normalizeSummary(raw["summary"]),
  };
}

/**
 * Coerce a score to a number in range, or undefined.
 */
function normalizeScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;

  const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, value));

  // One decimal place — the underlying signal doesn't justify more precision
  return Math.round(clamped * 10) / 10;
}

/**
 * Keep only http(s) sources, deduplicated, capped.
 */
function normalizeSources(value: unknown): ScoreSource[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const sources: ScoreSource[] = [];

  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;

    const record = entry as Record<string, unknown>;
    const url = typeof record["url"] === "string" ? record["url"].trim() : "";

    if (!/^https?:\/\/\S+$/i.test(url) || seen.has(url)) continue;
    seen.add(url);

    const publication =
      typeof record["publication"] === "string" && record["publication"].trim().length > 0
        ? record["publication"].trim()
        : undefined;

    sources.push({ url, publication });

    if (sources.length >= MAX_SOURCES) break;
  }

  return sources;
}

function normalizeSummary(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return undefined;

  return trimmed.length > MAX_SUMMARY_LENGTH
    ? `${trimmed.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`
    : trimmed;
}

/**
 * Average several scored results into one.
 *
 * Not used by the web-search path, which produces a single result per title,
 * but kept for the review-ingestion path the `reviews` table was built for:
 * scoring reviews individually and averaging is the alternative design, and
 * the aggregation is the same either way.
 *
 * @param results - Per-review results
 * @returns The averaged scores, or null if there was nothing to average
 */
export function aggregateScores(results: AiScoreResult[]): AiScoreResult | null {
  if (results.length === 0) return null;

  const scores: CategoryScores = {};
  const categories: (ScoreCategory | "overall")[] = [...SCORE_CATEGORIES, "overall"];

  for (const category of categories) {
    const values = results
      .map((result) => result.scores[category])
      .filter((value): value is number => value !== undefined);

    if (values.length === 0) continue;

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    scores[category] = Math.round(mean * 10) / 10;
  }

  if (scores.overall === undefined) return null;

  const sources: ScoreSource[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const source of result.sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
      if (sources.length >= MAX_SOURCES) break;
    }
  }

  return { scores, sources };
}
