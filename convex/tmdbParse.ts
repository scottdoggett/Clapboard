/**
 * TMDB Response Parsing
 *
 * TMDB carries far better artwork and metadata than OMDb, and its rate limit is
 * roughly 40 requests a *second* against OMDb's 1,000 a *day* — so where both
 * can answer, this is the one to lean on.
 *
 * It doesn't replace OMDb: TMDB has only its own community rating, not IMDb,
 * Rotten Tomatoes or Metacritic. So it enriches metadata and nothing else.
 *
 * Pure — no Convex or network imports — so `npm run verify:tmdb` can exercise
 * it against recorded responses.
 */

/**
 * TMDB serves images from a CDN whose base path comes from its configuration
 * endpoint. The base is stable in practice and hard-coding it avoids a second
 * request on every lookup; `w500` is the width the overlay's poster needs.
 */
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export interface TmdbMetadata {
  tmdbId?: string;
  posterUrl?: string;
  runtime?: number;
  genre?: string[];
  director?: string;
  year?: number;
  title?: string;
}

/**
 * Read the TMDB id out of a `/find/{imdb_id}` response.
 *
 * The find endpoint answers with per-type result arrays; a title is in exactly
 * one of them, and which one tells us whether TMDB considers it a film or a
 * series.
 *
 * @param data - Parsed body of /3/find/{external_id}
 * @returns The matched id and media type, or null when nothing matched
 */
export function parseFindResponse(
  data: unknown
): { id: number; mediaType: "movie" | "tv" } | null {
  if (data === null || typeof data !== "object") return null;

  const body = data as Record<string, unknown>;

  const movie = firstId(body["movie_results"]);
  if (movie !== null) return { id: movie, mediaType: "movie" };

  const tv = firstId(body["tv_results"]);
  if (tv !== null) return { id: tv, mediaType: "tv" };

  return null;
}

function firstId(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const first = value[0];
  if (first === null || typeof first !== "object") return null;

  const id = (first as Record<string, unknown>)["id"];
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/**
 * Read the metadata worth keeping out of a TMDB details response.
 *
 * Films and series use different field names for the same ideas — `title` vs
 * `name`, `release_date` vs `first_air_date`, a single `runtime` vs an array of
 * `episode_run_time` — so both spellings are accepted.
 *
 * @param data - Parsed body of /3/movie/{id} or /3/tv/{id}
 * @returns Metadata, with absent fields left undefined
 */
export function parseTmdbDetails(data: unknown): TmdbMetadata {
  if (data === null || typeof data !== "object") return {};

  const body = data as Record<string, unknown>;

  const id = body["id"];
  const posterPath = readString(body["poster_path"]);

  return {
    tmdbId: typeof id === "number" ? String(id) : undefined,
    posterUrl: posterPath ? `${IMAGE_BASE}${posterPath}` : undefined,
    runtime: readRuntime(body),
    genre: readGenres(body["genres"]),
    director: readDirector(body["credits"]),
    year: readYear(body),
    title: readString(body["title"]) ?? readString(body["name"]) ?? undefined,
  };
}

function readRuntime(body: Record<string, unknown>): number | undefined {
  const direct = body["runtime"];
  if (typeof direct === "number" && direct > 0) return Math.round(direct);

  // Series report a list of typical episode lengths instead
  const episodeRuntimes = body["episode_run_time"];
  if (Array.isArray(episodeRuntimes)) {
    const first = episodeRuntimes.find(
      (value): value is number => typeof value === "number" && value > 0
    );
    if (first !== undefined) return Math.round(first);
  }

  return undefined;
}

function readGenres(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const names = value
    .map((entry) =>
      entry !== null && typeof entry === "object"
        ? readString((entry as Record<string, unknown>)["name"])
        : null
    )
    .filter((name): name is string => name !== null);

  return names.length > 0 ? names : undefined;
}

/**
 * Find the director in an appended credits block.
 *
 * Only present when the request asked for `append_to_response=credits`; a
 * series has no single director, so this is usually undefined for those.
 */
function readDirector(credits: unknown): string | undefined {
  if (credits === null || typeof credits !== "object") return undefined;

  const crew = (credits as Record<string, unknown>)["crew"];
  if (!Array.isArray(crew)) return undefined;

  for (const member of crew) {
    if (member === null || typeof member !== "object") continue;

    const row = member as Record<string, unknown>;
    if (row["job"] === "Director") {
      const name = readString(row["name"]);
      if (name) return name;
    }
  }

  return undefined;
}

function readYear(body: Record<string, unknown>): number | undefined {
  const date =
    readString(body["release_date"]) ?? readString(body["first_air_date"]);
  if (!date) return undefined;

  const year = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) && year >= 1888 ? year : undefined;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Fold TMDB's metadata into what the ratings provider already gave.
 *
 * TMDB wins on artwork — its posters are higher resolution and it has one far
 * more often — but everything else only fills a gap. Overwriting a title or
 * year that OMDb resolved would risk contradicting the id the whole lookup was
 * keyed on.
 *
 * @param base - Metadata from the ratings provider
 * @param tmdb - Metadata from TMDB
 * @returns The merged metadata
 */
export function mergeMetadata<
  T extends {
    posterUrl?: string;
    runtime?: number;
    genre?: string[];
    director?: string;
    tmdbId?: string;
  },
>(base: T, tmdb: TmdbMetadata): T {
  return {
    ...base,
    tmdbId: base.tmdbId ?? tmdb.tmdbId,
    posterUrl: tmdb.posterUrl ?? base.posterUrl,
    runtime: base.runtime ?? tmdb.runtime,
    genre: base.genre && base.genre.length > 0 ? base.genre : tmdb.genre,
    director: base.director ?? tmdb.director,
  };
}
