/**
 * Wikidata Awards Verification
 *
 * Exercises the pure half of the awards provider against a recorded Wikidata
 * response and the label shapes it really returns.
 *
 * The fixture below is a genuine (trimmed) SPARQL result for Inception, kept
 * verbatim so the parser is tested against the wire format rather than against
 * an idealised version of it — note the missing `date` on the National Board
 * of Review row, which is exactly the kind of gap crowd-maintained data has.
 *
 * Run with: npm run verify:awards
 */

import {
  buildAwardsQuery,
  splitAwardLabel,
  parseAwardsResponse,
  mergeAwards,
} from "../convex/wikidataParse";
import { parseAwardTotals } from "../convex/omdbParse";
import { readRetryAfterMs } from "../convex/wikidata";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

const literal = (value: string) => ({ type: "literal", value });
const dated = (value: string) => ({
  datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
  type: "literal",
  value,
});

/** Real response shape, captured from the live query service. */
const inceptionResponse = {
  head: { vars: ["awardLabel", "kind", "date"] },
  results: {
    bindings: [
      // No ceremony date — the film's year has to stand in
      { kind: literal("won"), awardLabel: literal("National Board of Review: Top Ten Films") },
      {
        kind: literal("won"),
        awardLabel: literal("Academy Award for Best Cinematography"),
        date: dated("2011-02-27T00:00:00Z"),
      },
      {
        kind: literal("nominated"),
        awardLabel: literal("Academy Award for Best Picture"),
        date: dated("2011-02-27T00:00:00Z"),
      },
    ],
  },
};

check("parses a real response", parseAwardsResponse(inceptionResponse, 2010), [
  { name: "National Board of Review", category: "Top Ten Films", year: 2010, isWin: true, count: 1 },
  { name: "Oscar", category: "Best Cinematography", year: 2011, isWin: true, count: 1 },
  { name: "Oscar", category: "Best Picture", year: 2011, isWin: false, count: 1 },
]);

// --- Label splitting -------------------------------------------------------
check("splits an 'award for category' label", splitAwardLabel("Academy Award for Best Cinematography"), {
  name: "Oscar",
  category: "Best Cinematography",
});
check("splits a colon label", splitAwardLabel("National Board of Review: Top Ten Films"), {
  name: "National Board of Review",
  category: "Top Ten Films",
});
check("normalizes BAFTA", splitAwardLabel("British Academy Film Award for Best Film"), {
  name: "BAFTA",
  category: "Best Film",
});
// "Primetime Emmy" must beat the bare "Emmy" pattern
check("prefers the more specific body", splitAwardLabel("Primetime Emmy Award for Outstanding Comedy Series"), {
  name: "Primetime Emmy",
  category: "Outstanding Comedy Series",
});
check("keeps a label with no category whole", splitAwardLabel("Palme d'Or"), { name: "Cannes" });
check("leaves an unknown body as written", splitAwardLabel("Saturn Award for Best Director"), {
  name: "Saturn",
  category: "Best Director",
});
check("handles an empty label", splitAwardLabel("   "), { name: "" });

// --- Defensive parsing -----------------------------------------------------
// Wikidata is crowd-maintained, so the parser sees gaps and oddities
const messy = {
  results: {
    bindings: [
      { kind: literal("won"), awardLabel: literal("Q4115712") }, // unlabelled entity
      { kind: literal("won") }, // no label at all
      { kind: literal("won"), awardLabel: literal("Academy Award for Best Sound"), date: dated("2011-02-27T00:00:00Z") },
      // the same statement reached by two paths
      { kind: literal("won"), awardLabel: literal("Academy Award for Best Sound"), date: dated("2011-02-27T00:00:00Z") },
    ],
  },
};
check(
  "drops unlabelled entities, empty rows, and duplicates",
  parseAwardsResponse(messy, 2010),
  [{ name: "Oscar", category: "Best Sound", year: 2011, isWin: true, count: 1 }]
);
check("tolerates a malformed response", parseAwardsResponse({ nope: true }, 2010), []);
check("tolerates null", parseAwardsResponse(null, 2010), []);

// Wins lead — a film's wins are the part worth seeing first
check(
  "wins sort before nominations",
  parseAwardsResponse(
    {
      results: {
        bindings: [
          { kind: literal("nominated"), awardLabel: literal("Academy Award for Best Picture") },
          { kind: literal("won"), awardLabel: literal("Academy Award for Best Sound") },
        ],
      },
    },
    2010
  ).map((a) => `${a.isWin ? "won" : "nom"}:${a.category}`),
  ["won:Best Sound", "nom:Best Picture"]
);

// --- Query construction ----------------------------------------------------
check("query embeds the id", buildAwardsQuery("tt1375666").includes('"tt1375666"'), true);
// The id goes into a quoted SPARQL literal, so nothing may close that literal
check(
  "a malformed id cannot break out of the literal",
  buildAwardsQuery('tt1" } INJECTED {').includes('"tt1INJECTED"'),
  true
);
// Assert the property that matters directly: whatever lands inside the id
// literal is alphanumeric, so it cannot terminate the literal or add clauses
check(
  "the id literal holds only sanitized characters",
  buildAwardsQuery('tt1"; DROP ?x').match(/wdt:P345 "([^"]*)"/)?.[1],
  "tt1DROPx"
);

// --- Totals and merging ----------------------------------------------------
check("reads totals from OMDb's sentence", parseAwardTotals("Won 4 Oscars. 159 wins & 220 nominations total."), {
  wins: 159,
  nominations: 220,
});
check("falls back to the headline when there are no totals", parseAwardTotals("Won 4 Oscars."), {
  wins: 4,
  nominations: 0,
});
check("handles a missing summary", parseAwardTotals(undefined), { wins: 0, nominations: 0 });

// The point of merging: named awards shown, totals reduced by what's shown, so
// the same Oscar isn't counted twice
const named = parseAwardsResponse(inceptionResponse, 2010);
check("merge subtracts what is already named", mergeAwards(named, { wins: 159, nominations: 220 }, 2010), [
  ...named,
  { name: "Other awards", category: "wins", year: 2010, isWin: true, count: 157 },
  { name: "Nominations", year: 2010, isWin: false, count: 219 },
]);
check(
  "merge omits a remainder that would be negative",
  mergeAwards(named, { wins: 1, nominations: 0 }, 2010),
  named
);
check("merge with no totals is just the named awards", mergeAwards(named, { wins: 0, nominations: 0 }, 2010), named);

// --- Retry-After -----------------------------------------------------------
check("reads seconds", readRetryAfterMs("2"), 2000);
check("reads zero", readRetryAfterMs("0"), 0);
check("ignores nonsense", readRetryAfterMs("soon"), null);
check("ignores a missing header", readRetryAfterMs(null), null);

// --- A win supersedes its own nomination -----------------------------------
// Wikidata stores both P166 (received) and P1411 (nominated for) for an award
// the film won. Inception really does come back with Best Cinematography under
// both, and showing it twice reads as a bug rather than as detail.
const wonAndNominated = {
  results: {
    bindings: [
      { kind: literal("nominated"), awardLabel: literal("Academy Award for Best Cinematography"), date: dated("2011-02-27T00:00:00Z") },
      { kind: literal("won"), awardLabel: literal("Academy Award for Best Cinematography"), date: dated("2011-02-27T00:00:00Z") },
      { kind: literal("nominated"), awardLabel: literal("Academy Award for Best Picture"), date: dated("2011-02-27T00:00:00Z") },
    ],
  },
};
check("a win hides its own nomination", parseAwardsResponse(wonAndNominated, 2010), [
  { name: "Oscar", category: "Best Cinematography", year: 2011, isWin: true, count: 1 },
  { name: "Oscar", category: "Best Picture", year: 2011, isWin: false, count: 1 },
]);

// A nomination in a different year is a different event, not a duplicate
check(
  "a nomination in another year survives",
  parseAwardsResponse(
    {
      results: {
        bindings: [
          { kind: literal("won"), awardLabel: literal("Academy Award for Best Sound"), date: dated("2011-02-27T00:00:00Z") },
          { kind: literal("nominated"), awardLabel: literal("Academy Award for Best Sound"), date: dated("2012-02-26T00:00:00Z") },
        ],
      },
    },
    2010
  ).length,
  2
);

// The remainder arithmetic has to see the deduplicated count, or the "and N
// more" line double-counts every award that was won
check(
  "merge counts each award once",
  mergeAwards(parseAwardsResponse(wonAndNominated, 2010), { wins: 160, nominations: 220 }, 2010).filter(
    (a) => a.name === "Other awards" || a.name === "Nominations"
  ),
  [
    { name: "Other awards", category: "wins", year: 2010, isWin: true, count: 159 },
    { name: "Nominations", year: 2010, isWin: false, count: 219 },
  ]
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
