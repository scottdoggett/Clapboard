/**
 * Title Detection Verification
 *
 * Exercises the pure functions in src/shared/utils/titleDetect.ts against the
 * URL shapes and title strings the supported streaming sites actually produce.
 *
 * The detection layer can't be checked against the live sites from here — they
 * need an account and render everything client-side — so this covers the half
 * that doesn't need a browser: the URL gate, the branding stripping, and the
 * JSON-LD parsing. The DOM half in dom.ts stays deliberately thin so this
 * catches most of what can go wrong.
 *
 * Run with: npm run verify:detection
 */

import { SUPPORTED_SITES } from "../src/shared/constants";
import {
  isTitleUrl,
  contentTypeFromUrl,
  cleanTitle,
  parseTitleYear,
  isPlausibleTitle,
  parseJsonLd,
  selectTitle,
  buildTitleInfo,
} from "../src/shared/utils/titleDetect";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

function titleUrl(site: keyof typeof SUPPORTED_SITES, url: string): boolean {
  return isTitleUrl(SUPPORTED_SITES[site], new URL(url));
}

function urlType(site: keyof typeof SUPPORTED_SITES, url: string) {
  return contentTypeFromUrl(SUPPORTED_SITES[site], new URL(url));
}

// --- URL gate: Netflix -----------------------------------------------------
check("netflix title page", titleUrl("netflix", "https://www.netflix.com/title/81234567"), true);
check("netflix watch page", titleUrl("netflix", "https://www.netflix.com/watch/81234567"), true);
check(
  "netflix locale prefix",
  titleUrl("netflix", "https://www.netflix.com/ca-en/title/81234567"),
  true
);
check("netflix browse page", titleUrl("netflix", "https://www.netflix.com/browse"), false);
check("netflix home", titleUrl("netflix", "https://www.netflix.com/"), false);
check(
  "netflix search results",
  titleUrl("netflix", "https://www.netflix.com/search?q=inception"),
  false
);
check(
  "netflix jbv modal over browse",
  titleUrl("netflix", "https://www.netflix.com/browse?jbv=81234567"),
  true
);
check(
  "netflix empty jbv ignored",
  titleUrl("netflix", "https://www.netflix.com/browse?jbv="),
  false
);
check("netflix account page", titleUrl("netflix", "https://www.netflix.com/YourAccount"), false);

// --- URL gate: Prime Video -------------------------------------------------
// The old config used a bare `h1` selector with no URL gate, so every Prime
// Video page — including the storefront — looked like a title page.
check(
  "prime detail page",
  titleUrl("primeVideo", "https://www.primevideo.com/detail/0GLPSNBTNU1FFRQ8B6TZL4E2SR/ref=atv_dp"),
  true
);
check(
  "prime regional detail page",
  titleUrl("primeVideo", "https://www.primevideo.com/region/na/detail/0GLPSNBTNU1FFRQ8"),
  true
);
check(
  "prime amazon.com detail page",
  titleUrl("primeVideo", "https://www.amazon.com/gp/video/detail/B08XYZ"),
  true
);
check("prime storefront", titleUrl("primeVideo", "https://www.primevideo.com/"), false);
check(
  "prime browse page",
  titleUrl("primeVideo", "https://www.primevideo.com/storefront/home"),
  false
);
check(
  "prime search results",
  titleUrl("primeVideo", "https://www.primevideo.com/search/ref=atv_nb_sr?phrase=dune"),
  false
);

// --- URL gate: Disney+ -----------------------------------------------------
check(
  "disney movie page",
  titleUrl("disneyPlus", "https://www.disneyplus.com/en-ca/movies/soul/6C4rIQGwbLuT"),
  true
);
check(
  "disney series page",
  titleUrl("disneyPlus", "https://www.disneyplus.com/en-ca/series/the-bear/1abc"),
  true
);
check(
  "disney entity route",
  titleUrl("disneyPlus", "https://www.disneyplus.com/browse/entity-9f3a2b1c-0000"),
  true
);
check("disney home", titleUrl("disneyPlus", "https://www.disneyplus.com/en-ca/home"), false);
check("disney browse grid", titleUrl("disneyPlus", "https://www.disneyplus.com/browse"), false);

// --- URL gate: Crave -------------------------------------------------------
check("crave movie page", titleUrl("crave", "https://www.crave.ca/en/movies/dune"), true);
check("crave series page", titleUrl("crave", "https://www.crave.ca/en/tv-shows/succession"), true);
check("crave home", titleUrl("crave", "https://www.crave.ca/en"), false);

// --- Content type from URL -------------------------------------------------
check(
  "disney movie type",
  urlType("disneyPlus", "https://www.disneyplus.com/en-ca/movies/soul/6C4r"),
  "movie"
);
check(
  "disney series type",
  urlType("disneyPlus", "https://www.disneyplus.com/en-ca/series/loki/1abc"),
  "series"
);
check("crave series type", urlType("crave", "https://www.crave.ca/en/tv-shows/succession"), "series");
check("netflix type unknown", urlType("netflix", "https://www.netflix.com/title/81234567"), undefined);

// --- Title cleaning --------------------------------------------------------
check("strips netflix branding", cleanTitle("Inception | Netflix"), "Inception");
check("strips watch prefix", cleanTitle("Watch Inception | Prime Video"), "Inception");
check("strips prime prefix", cleanTitle("Prime Video: Dune"), "Dune");
check("strips disney branding", cleanTitle("Soul – Disney+"), "Soul");
check("strips stacked branding", cleanTitle("Dune - Watch Now | Prime Video"), "Dune");
check("strips episode marker", cleanTitle("S2 E4 · The Bear"), "The Bear");
check("strips episode marker colon form", cleanTitle("S1:E3 Severance"), "Severance");
check("strips season suffix", cleanTitle("The Bear - Season 2"), "The Bear");
check("strips trailer label", cleanTitle("Dune (Trailer)"), "Dune");
check("strips official trailer label", cleanTitle("Dune - Official Trailer"), "Dune");
// Colons and hyphens inside real titles have to survive
check("keeps colon titles", cleanTitle("Spider-Man: No Way Home"), "Spider-Man: No Way Home");
check("keeps hyphenated titles", cleanTitle("Ant-Man"), "Ant-Man");
check(
  "keeps subtitle after dash",
  cleanTitle("Mission: Impossible - Dead Reckoning"),
  "Mission: Impossible - Dead Reckoning"
);
check("collapses whitespace", cleanTitle("  The   Godfather \n"), "The Godfather");

// --- Year extraction -------------------------------------------------------
check("year in parens", parseTitleYear("Inception (2010)"), { title: "Inception", year: 2010 });
check("year range", parseTitleYear("The Bear (2022-2024)"), { title: "The Bear", year: 2022 });
check("open ended range", parseTitleYear("Severance (2022–)"), { title: "Severance", year: 2022 });
check("no year", parseTitleYear("Inception"), { title: "Inception" });
// A parenthesised number that isn't a plausible release year stays in the title
check("implausible year kept", parseTitleYear("Room (1408)"), { title: "Room (1408)" });

// --- Plausibility ----------------------------------------------------------
check("real title is plausible", isPlausibleTitle("Inception"), true);
check("empty is not", isPlausibleTitle("   "), false);
check("nav label is not", isPlausibleTitle("My List"), false);
check("home is not", isPlausibleTitle("Home"), false);
check("platform name is not", isPlausibleTitle("Netflix"), false);
check("punctuation only is not", isPlausibleTitle("—"), false);
check("synopsis length is not", isPlausibleTitle("A".repeat(200)), false);

// --- JSON-LD ---------------------------------------------------------------
check(
  "jsonld movie",
  parseJsonLd(
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Movie",
      name: "Inception",
      datePublished: "2010-07-16",
    })
  ),
  { title: "Inception", year: 2010, type: "movie" }
);
check(
  "jsonld series",
  parseJsonLd(
    JSON.stringify({ "@type": "TVSeries", name: "The Bear", datePublished: "2022" })
  ),
  { title: "The Bear", year: 2022, type: "series" }
);
// An episode is unmatchable on its own — the series name is what OMDb knows
check(
  "jsonld episode resolves to series",
  parseJsonLd(
    JSON.stringify({
      "@type": "TVEpisode",
      name: "Fishes",
      partOfSeries: { "@type": "TVSeries", name: "The Bear" },
    })
  ),
  { title: "The Bear", type: "series" }
);
check(
  "jsonld graph wrapper",
  parseJsonLd(
    JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList", name: "Breadcrumbs" },
        { "@type": "Movie", name: "Dune", datePublished: "2021-10-22" },
      ],
    })
  ),
  { title: "Dune", year: 2021, type: "movie" }
);
check(
  "jsonld array",
  parseJsonLd(JSON.stringify([{ "@type": "Organization", name: "Netflix" }, { "@type": "Movie", name: "Soul" }])),
  { title: "Soul", type: "movie" }
);
check(
  "jsonld branding stripped",
  parseJsonLd(JSON.stringify({ "@type": "Movie", name: "Watch Dune | Prime Video" })),
  { title: "Dune", type: "movie" }
);
check("jsonld non-content ignored", parseJsonLd(JSON.stringify({ "@type": "WebPage", name: "Home" })), null);
check("jsonld malformed", parseJsonLd("{not json"), null);
check("jsonld empty", parseJsonLd(""), null);

// --- Candidate selection ---------------------------------------------------
check(
  "dom wins, year filled from jsonld",
  selectTitle([
    { raw: "The Bear", source: "dom" },
    { raw: "The Bear", source: "jsonld", year: 2022, type: "series" },
  ]),
  { title: "The Bear", year: 2022, type: "series" }
);
check(
  "unusable candidates skipped",
  selectTitle([
    { raw: "  ", source: "dom" },
    { raw: "Home", source: "dom" },
    { raw: "Inception | Netflix", source: "documentTitle" },
  ]),
  { title: "Inception", type: undefined }
);
check("no candidates", selectTitle([]), null);
check(
  "url type used as fallback",
  selectTitle([{ raw: "Soul", source: "dom" }], "movie"),
  { title: "Soul", type: "movie" }
);
check(
  "candidate type beats url fallback",
  selectTitle([{ raw: "The Bear", source: "jsonld", type: "series" }], "movie"),
  { title: "The Bear", type: "series" }
);

// --- End to end on raw strings ---------------------------------------------
check(
  "prime page title to lookup",
  buildTitleInfo("Watch Dune (2021) | Prime Video", "movie"),
  { title: "Dune", year: 2021, type: "movie" }
);
check("nav heading rejected", buildTitleInfo("Continue Watching"), null);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
