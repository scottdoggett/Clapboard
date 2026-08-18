"use node";

/**
 * AI Review Scoring
 *
 * Phase 3. Turns published reviews of a title into per-category scores.
 *
 * The roadmap called for scraping reviews and then analyzing them. This does
 * both in one call instead: Claude's server-side web search finds and reads
 * the reviews, and a strict tool call hands back the scores plus the URLs it
 * drew on. That avoids maintaining a scraper per publication, and it keeps the
 * sources attached to the scores — the whole claim of the feature is "this is
 * what reviewers said", which is only worth anything if it can be checked.
 *
 * The call is slow (seconds to a minute) and costs real money, so:
 *   - results are cached in the `aiScores` table for 30 days, failures for 7
 *   - the extension requests scores separately from ratings, after the overlay
 *     is already up, rather than blocking the fast path on them
 *   - the whole feature sits behind FEATURES.AI_SCORES_ENABLED
 *
 * This file runs in Convex's Node runtime (`"use node"`), so it can only hold
 * actions — the database functions live in `aiScoresDb.ts`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  SCORING_SYSTEM_PROMPT,
  SCORE_TOOL_SCHEMA,
  buildScoringPrompt,
  parseScoreSubmission,
} from "./aiScoresParse";

/**
 * Model used for scoring.
 *
 * Stored on every row so a change here can be told apart from a change in the
 * reviews, and so old rows can be found and regenerated.
 */
const MODEL = "claude-opus-5";

const MAX_TOKENS = 8000;

/**
 * Cap on web searches per scoring run. Enough for several publications on a
 * well-covered title; a hard stop on an obscure one where the model would
 * otherwise keep looking.
 */
const MAX_SEARCHES = 6;

/**
 * How many times to resume after a `pause_turn`. Server-side search pauses the
 * turn to hand back control; this bounds the resulting loop.
 */
const MAX_TURNS = 5;

const SUBMIT_TOOL_NAME = "submit_scores";

const contentType = v.union(v.literal("movie"), v.literal("series"));

/**
 * A completed set of scores.
 */
export interface AiScoresResponse {
  scores: {
    cinematography?: number;
    plot?: number;
    writing?: number;
    characters?: number;
    soundtrack?: number;
    overall?: number;
  };
  summary?: string;
  sources: { url: string; publication?: string }[];
  model: string;
  generatedAt: number;
}

/**
 * What a scoring request can come back as.
 *
 * Four outcomes rather than "scores or null", because the caller has to say
 * something different for each: a title with no reviews is permanent, a
 * pending run and a budget refusal are both "come back later", and only one of
 * those is the user's fault to wait out.
 */
export type AiScoreOutcome =
  | { status: "scored"; result: AiScoresResponse }
  | { status: "unavailable" }
  | { status: "pending" }
  | { status: "rateLimited"; retryAfterMs: number };

/**
 * Ask Claude to research and score a title.
 *
 * @returns The tool call's raw input, or null if it never called the tool
 */
async function requestScores(
  client: Anthropic,
  title: string,
  year?: number,
  type?: "movie" | "series"
): Promise<unknown> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: buildScoringPrompt(title, year, type) },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Streamed because a turn that runs several web searches can outlast the
    // SDK's non-streaming request timeout
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // A refusal here would just fail the lookup, so let the API retry on a
      // fallback model rather than returning nothing
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      system: SCORING_SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: MAX_SEARCHES,
        },
        {
          name: SUBMIT_TOOL_NAME,
          description:
            "Report the category scores for this title, drawn from the reviews you read.",
          input_schema: SCORE_TOOL_SCHEMA,
          // Guarantees the input validates against the schema, so the parser
          // only has to defend against out-of-range values, not wrong shapes
          strict: true,
        },
      ],
      messages,
    });

    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      console.warn(
        "[Clapboard] Scoring refused:",
        response.stop_details?.category ?? "unknown"
      );
      return null;
    }

    const submission = response.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use" && block.name === SUBMIT_TOOL_NAME
    );

    if (submission) {
      return submission.input;
    }

    // Server-side search hands control back mid-turn; resume where it left off
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    // Finished without calling the tool — it had nothing to report
    return null;
  }

  console.warn("[Clapboard] Scoring hit the turn limit without a submission");
  return null;
}

/**
 * Generate (or serve cached) AI category scores for a movie.
 *
 * The movie must already exist — the extension resolves a title through
 * `omdb:lookup` first, so scoring works from OMDb's canonical title rather
 * than whatever the streaming site displayed.
 *
 * @returns One of four outcomes — see AiScoreOutcome
 */
export const generate = action({
  args: {
    movieId: v.id("movies"),
    title: v.string(),
    year: v.optional(v.number()),
    type: v.optional(contentType),
    /** Anonymous per-installation id, so one user can't spend everyone's share */
    clientId: v.string(),
  },
  handler: async (
    ctx,
    { movieId, title, year, type, clientId }
  ): Promise<AiScoreOutcome> => {
    const cached = await ctx.runQuery(internal.aiScoresDb.getCachedScores, {
      movieId,
    });

    if (cached.status === "hit") {
      return { status: "scored", result: cached.result };
    }

    if (cached.status === "empty") {
      return { status: "unavailable" };
    }

    if (cached.status === "pending") {
      return { status: "pending" };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it with: npx convex env set ANTHROPIC_API_KEY <key>"
      );
    }

    // Nothing above this line spends money. The claim is the gate: it reserves
    // the title and checks the deployment's budget in one transaction, so
    // concurrent requests can't both get through.
    const claim = await ctx.runMutation(internal.aiScoresDb.claimScoringRun, {
      movieId,
      clientId,
    });

    if (!claim.claimed) {
      if (claim.reason === "budget") {
        console.warn(
          `[Clapboard] Scoring budget exhausted (${claim.scope}) for:`,
          title
        );
        return { status: "rateLimited", retryAfterMs: claim.retryAfterMs ?? 0 };
      }
      return { status: "pending" };
    }

    let submission: unknown;
    try {
      const client = new Anthropic({ apiKey });
      submission = await requestScores(client, title, year, type);
    } catch (error) {
      // The failure says nothing about the title, so drop the claim rather
      // than recording a verdict the reviews don't support. The run still
      // counted against the budget — the call was made.
      await ctx.runMutation(internal.aiScoresDb.releaseScoringRun, { movieId });
      throw error;
    }

    const parsed = submission === null ? null : parseScoreSubmission(submission);

    if (!parsed) {
      // Record the failure too — this run cost an API call and a web search,
      // and without a row every page view would pay for it again
      await ctx.runMutation(internal.aiScoresDb.persistScores, {
        movieId,
        status: "insufficient",
        sources: [],
        model: MODEL,
      });
      return { status: "unavailable" };
    }

    const generatedAt = await ctx.runMutation(internal.aiScoresDb.persistScores, {
      movieId,
      status: "scored",
      scores: parsed.scores,
      summary: parsed.summary,
      sources: parsed.sources,
      model: MODEL,
    });

    return {
      status: "scored",
      result: {
        scores: parsed.scores,
        summary: parsed.summary,
        sources: parsed.sources,
        model: MODEL,
        generatedAt,
      },
    };
  },
});
