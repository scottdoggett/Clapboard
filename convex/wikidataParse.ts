/**
 * Wikidata Award Parsing
 *
 * The pure half of the awards provider: the SPARQL query, and the translation
 * from Wikidata's answer into the `awards` table's shape. No Convex or network
 * imports, so `npm run verify:awards` can exercise it against recorded
 * responses without a deployment.
 *
 * Why Wikidata at all: OMDb reports awards as one free-text sentence — "Won 4
 * Oscars. 159 wins & 220 nominations total." — which gives counts and nothing
 * else. Wikidata models each award as a statement, so the same film yields
 * "Academy Award for Best Cinematography, won, 2011" per award. That's the
 * difference between "4 Oscars" and naming them, which is what the roadmap
 * asked for.
 *
 * It needs no key and no account: films carry the IMDb ID as property P345, so
 * the id OMDb already returns is enough to find the entity.
 */

import type { ParsedAward } from "./omdbParse";

/**
 * Wikidata properties used here.
 *
 * P345  IMDb ID            — how we find the film
 * P166  award received     — a win
 * P1411 nominated for      — a nomination
 * P585  point in time      — qualifier giving the ceremony year
 */
export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Cap on rows. A heavily decorated film can carry well over a hundred award
 * statements, and the overlay shows a handful — fetching the rest is work
 * nobody sees.
 */
const QUERY_LIMIT = 60;

/**
 * Build the SPARQL query for one film's awards.
 *
 * Wins and nominations are separate properties in Wikidata, so the query is a
 * UNION over both with a literal marking which branch each row came from.
 *
 * @param imdbId - IMDb ID, e.g. "tt1375666"
 * @returns SPARQL query text
 */
export function buildAwardsQuery(imdbId: string): string {
  // The id is interpolated into a quoted literal, so anything that could close
  // that literal has to go. IMDb ids are `tt` plus digits in practice; this is
  // belt and braces against a malformed one reaching the query.
  const safeId = imdbId.replace(/[^A-Za-z0-9]/g, "");

  return `SELECT ?awardLabel ?kind ?date WHERE {
  ?film wdt:P345 "${safeId}" .
  {
    ?film p:P166 ?statement . ?statement ps:P166 ?award .
    OPTIONAL { ?statement pq:P585 ?date }
    BIND("won" AS ?kind)
  } UNION {
    ?film p:P1411 ?statement . ?statement ps:P1411 ?award .
    OPTIONAL { ?statement pq:P585 ?date }
    BIND("nominated" AS ?kind)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${QUERY_LIMIT}`;
}

/**
 * Award bodies worth naming consistently, longest pattern first so
 * "Primetime Emmy" wins over "Emmy".
 */
const AWARD_BODIES: Array<[RegExp, string]> = [
  [/^academy award/i, "Oscar"],
  [/^golden globe/i, "Golden Globe"],
  [/^british academy (film )?award|^bafta/i, "BAFTA"],
  [/^primetime emmy/i, "Primetime Emmy"],
  [/^emmy/i, "Emmy"],
  [/^screen actors guild/i, "Screen Actors Guild"],
  [/^critics'? choice/i, "Critics' Choice"],
  [/^hugo award/i, "Hugo"],
  [/^saturn award/i, "Saturn"],
  [/^grammy/i, "Grammy"],
  [/^palme d'or|^cannes/i, "Cannes"],
];

/**
 * Split a Wikidata award label into the body and the category.
 *
 * Labels read as "Academy Award for Best Cinematography" or, for awards with
 * no categories, "National Board of Review: Top Ten Films". The body is what
 * the badge groups by; the category is the part worth reading.
 *
 * @param label - The English label of the award entity
 * @returns Award body name, and category when the label has one
 */
export function splitAwardLabel(label: string): {
  name: string;
  category?: string;
} {
  const cleaned = label.trim().replace(/\s+/g, " ");
  if (!cleaned) return { name: "" };

  // "Academy Award for Best Cinematography"
  const forMatch = cleaned.match(/^(.+?)\s+for\s+(.+)$/i);
  if (forMatch) {
    return {
      name: normalizeBody(forMatch[1]),
      category: forMatch[2].trim(),
    };
  }

  // "National Board of Review: Top Ten Films"
  const colonMatch = cleaned.match(/^([^:]+):\s*(.+)$/);
  if (colonMatch) {
    return {
      name: normalizeBody(colonMatch[1]),
      category: colonMatch[2].trim(),
    };
  }

  return { name: normalizeBody(cleaned) };
}

/**
 * Map a body to the short name the UI uses, or leave it as written.
 */
function normalizeBody(body: string): string {
  const cleaned = body.trim().replace(/\s+/g, " ");

  for (const [pattern, name] of AWARD_BODIES) {
    if (pattern.test(cleaned)) return name;
  }

  return cleaned;
}

/**
 * Shape of the SPARQL JSON results we care about.
 */
interface SparqlBinding {
  awardLabel?: { value?: string };
  kind?: { value?: string };
  date?: { value?: string };
}

/**
 * Turn a SPARQL response into award records.
 *
 * Wikidata is crowd-maintained, so this is defensive: rows without a usable
 * label are dropped, a missing date falls back to the film's year, and
 * duplicates (the same award appearing under several statements) collapse.
 *
 * @param json - Parsed SPARQL JSON response
 * @param fallbackYear - Release year, for rows with no ceremony date
 * @returns Award records, wins first
 */
export function parseAwardsResponse(
  json: unknown,
  fallbackYear: number
): ParsedAward[] {
  const bindings = readBindings(json);
  const seen = new Set<string>();
  const awards: ParsedAward[] = [];

  for (const row of bindings) {
    const label = row.awardLabel?.value?.trim();
    if (!label) continue;

    // Wikidata returns the bare Q-id as the label when an entity has no
    // English label. That's an internal identifier, not something to show.
    if (/^Q\d+$/.test(label)) continue;

    const { name, category } = splitAwardLabel(label);
    if (!name) continue;

    const isWin = row.kind?.value === "won";
    const year = parseCeremonyYear(row.date?.value) ?? fallbackYear;

    const key = `${name}|${category ?? ""}|${isWin}|${year}`;
    if (seen.has(key)) continue;
    seen.add(key);

    awards.push({ name, category, year, isWin, count: 1 });
  }

  // Winning an award means being nominated for it, and Wikidata records both
  // statements. Showing "Oscar — Best Cinematography" as won *and* nominated
  // is not extra detail, it's the same fact twice and reads as a mistake.
  const wins = new Set(
    awards.filter((a) => a.isWin).map((a) => `${a.name}|${a.category ?? ""}|${a.year}`)
  );

  const deduped = awards.filter(
    (a) => a.isWin || !wins.has(`${a.name}|${a.category ?? ""}|${a.year}`)
  );

  // Wins before nominations, then alphabetical — a film's wins are the part
  // worth seeing first
  return deduped.sort((a, b) => {
    if (a.isWin !== b.isWin) return a.isWin ? -1 : 1;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return (a.category ?? "").localeCompare(b.category ?? "");
  });
}

function readBindings(json: unknown): SparqlBinding[] {
  if (json === null || typeof json !== "object") return [];

  const results = (json as Record<string, unknown>)["results"];
  if (results === null || typeof results !== "object") return [];

  const bindings = (results as Record<string, unknown>)["bindings"];
  return Array.isArray(bindings) ? (bindings as SparqlBinding[]) : [];
}

/**
 * Read the year out of a Wikidata date literal ("2011-01-01T00:00:00Z").
 */
function parseCeremonyYear(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const match = value.match(/^(-?\d{1,4})-/);
  if (!match) return undefined;

  const year = parseInt(match[1], 10);
  return Number.isFinite(year) && year >= 1888 ? year : undefined;
}

/**
 * Combine named awards from Wikidata with OMDb's totals.
 *
 * The two sources answer different questions and neither replaces the other.
 * Wikidata names the major awards but its coverage of minor festivals is
 * patchy; OMDb knows the totals but not what any of them were for. So the
 * named awards are listed, and OMDb's totals are reduced by what's already
 * shown to give an honest "and N more" rather than double counting.
 *
 * @param named - Awards from Wikidata
 * @param totals - Total wins and nominations reported by OMDb
 * @returns The list for the overlay
 */
export function mergeAwards(
  named: ParsedAward[],
  totals: { wins: number; nominations: number },
  fallbackYear: number
): ParsedAward[] {
  const namedWins = named.filter((award) => award.isWin).length;
  const namedNominations = named.length - namedWins;

  const merged = [...named];

  const remainingWins = totals.wins - namedWins;
  if (remainingWins > 0) {
    merged.push({
      name: "Other awards",
      category: "wins",
      year: fallbackYear,
      isWin: true,
      count: remainingWins,
    });
  }

  const remainingNominations = totals.nominations - namedNominations;
  if (remainingNominations > 0) {
    merged.push({
      name: "Nominations",
      year: fallbackYear,
      isWin: false,
      count: remainingNominations,
    });
  }

  return merged;
}
