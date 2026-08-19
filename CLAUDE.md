# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build           # Build extension to dist/ (esbuild + PostCSS/Tailwind)
npm run build:watch     # Rebuild on file changes
npm run lint            # TypeScript type-check (tsc --noEmit) + ESLint
npm run verify:parsers  # Check OMDb response parsers against known payloads
npm run verify:detection # Check the title-detection logic against known URLs and title strings
npm run verify:ai-scores # Check the AI score parser and spend guard
npm run verify:dom      # Run title detection against fixture pages in jsdom
npm run verify:awards   # Check the Wikidata award parser against a recorded response
npm run verify:providers # Check the MDBList and TMDB parsers
npm run doctor          # Preflight: deployment, live key check, feature flags, bundle freshness
npx convex dev          # Start Convex backend (separate terminal)
```

When the overlay shows nothing, run `npm run doctor` before digging — the setup fails in layers (no deployment, no key, stale bundle, flag off) and every one of them looks the same from the streaming site.

`npx convex dev` must have run at least once for `npm run lint` to pass — the
Convex functions import from `convex/_generated/`, which codegen produces only
after a deployment exists. `npm run build` does not depend on it: the extension
references backend functions by name, not through the generated `api` object.

After building, load `dist/` as an unpacked extension at `chrome://extensions/` (Developer mode). Reload the extension card after each rebuild.

## Architecture

Clapboard is a **Chrome Manifest V3 extension** that overlays movie/show ratings and awards on streaming sites (Netflix, Disney+, Prime Video, Crave). It uses **esbuild** for bundling (not Next.js/Webpack — Next.js is only listed as a dependency, the actual build is `scripts/build.ts`).

### Three Extension Contexts

1. **Background service worker** (`src/background/index.ts`) — MV3 service worker handling message routing and API calls. Ephemeral; must use `chrome.storage` for persistence, not in-memory state.

2. **Content script** (`src/content/index.ts`) — Injected into streaming sites. Detects the current title via platform-specific DOM selectors, then mounts a React overlay inside a **Shadow DOM** for style isolation. Bundled as IIFE format (not ESM).

3. **Popup** (`src/popup/`) — Toolbar popup for settings/status. Bundled as ESM.

### Message Protocol

Content scripts and popup communicate with the background worker via `chrome.runtime.onMessage`. Messages use **discriminated unions** defined in `src/shared/types/messages.ts` with exhaustive switch handling in the background worker. `MessageResponseMap` maps each message type to its response payload, so `sendMessage` returns the right type per message without a cast at the call site.

`GET_MOVIE_DATA` returns metadata, ratings, and awards together — the backend resolves them in one pass, so there's no separate ratings request.

### Platform-Specific DOM Detection

Working out what the user is looking at is the most failure-prone part of the extension, so it runs in layers rather than off a single selector. `src/shared/constants.ts` (`SUPPORTED_SITES`) holds per-platform URL patterns and *lists* of selector candidates; `src/shared/utils/dom.ts` reads the page; `src/shared/utils/titleDetect.ts` holds the pure decisions and is exercised by `npm run verify:detection`.

Order of operations in `detectCurrentTitle()`:

1. **URL gate.** `urlPatterns.title` must match, or detection stops. This is what keeps the overlay off browse, search, and account pages — the heading selectors are broad on purpose, and Prime Video's fallback really is a bare `h1`, which is only safe because the gate runs first.
2. **Live DOM.** Each `selectors.titleText` candidate in turn, most specific first. These follow client-side navigation, so they're trusted above everything else. An `<img>` match reads its `alt` (Disney+ and Netflix render title treatments as images).
3. **Baked-in metadata** — JSON-LD, then Open Graph. Structured and stable across redesigns, but written into the served HTML: on a single-page app it describes whatever page was *served*. `dom.ts` records `location.href` at module load and only consults these while the URL still matches.
4. **The tab title**, which is deliberately *exempt* from that freshness rule. A router actively maintains `document.title` because users navigate by it, unlike JSON-LD script tags which it never rewrites. On Netflix this matters: opening a title redirects to `/browse?jbv=…` and the tab title is then the only correct title on the page.

Candidates are merged rather than raced: the first usable title wins, and fields it lacks (typically the year) are filled from later candidates.

When the URL says there's a title but nothing is readable yet, `waitForTitle` **polls the detector** rather than waiting for a container element to appear. Netflix inserts its modal container immediately and fills in the story art and tab title afterwards, so a container-triggered check ran while the title was still milliseconds away and gave up. The only reliable signal that a title is readable is reading it. Polling stops early if the user navigates away.

Content type comes from the URL where the platform encodes it (`/movies/` vs `/series/`), then from the platform's **metadata line** (`selectors.metadata`), then from a `seriesIndicator` element, otherwise stays `undefined`.

That metadata line is also where the **release year** comes from on most pages, and both fields matter more than they look: without a type, "Fargo" resolves to the 1996 film or the 2014 series depending on which OMDb returns first, and without a year the same is true of every remake.

When no `metadata` selector matches — which a live run showed is the normal case, the same way every invented Netflix selector failed to match — it falls back to the **opening ~220 characters of the detail view itself**. These pages put the facts line above the synopsis, so the opening stretch is metadata and the rest is prose; reading the whole thing would let "set in 1929" or "a series of events" override the real answer.

`parseMetadataText` has two non-obvious constraints, both taken from a live Netflix page. Netflix concatenates its metadata tokens with no separators — `Limited Series2022TV-MAHD`, `2h2005PG-13HD` — so nothing may depend on word boundaries. And the synopsis usually runs onto the end of the same text, so a film whose plot mentions a "series of events" would misclassify if the markers were checked naively. Hence the order: a runtime in hours is checked first, because a series listing shows seasons or episode counts rather than one duration.

Adding a platform means one new `SUPPORTED_SITES` entry: host patterns, URL patterns, and selector candidate lists. Add its URL shapes to `scripts/verify-detection.ts` and a fixture page to `scripts/verify-dom.ts` at the same time.

**Netflix is the awkward one.** Opening a title redirects to the browse grid with `?jbv=` and renders the film in a modal *over* it. Every Netflix `titleText` selector is therefore scoped inside `[data-uia="modal-motion-container-DETAIL_MODAL"]`: the page behind the modal has a `billboard-title` that looks like exactly what you want and belongs to whatever Netflix is promoting. The real title is in an image alt (`img.playerModel--player__storyArt`), and the page carries no `og:title` or JSON-LD at all.

**On the fixtures:** `verify-dom.ts` runs the real `detectCurrentTitle` against jsdom pages modelled on each platform's markup. It proves the machinery — gate, layering, alt-text titles, staleness — but *not* that the selectors match the live sites, since the fixtures are written here. When you add a "this page should detect nothing" fixture, give it a **real title** in title-page markup (a promoted billboard, a hero carousel). A fixture whose heading is "Home" passes on the plausibility check instead of the gate and proves nothing — mutation-testing caught exactly that, twice.

### Backend

The extension sends an anonymous per-installation id (`getClientId` in `src/shared/utils/storage.ts`) with scoring requests. It's a random UUID, stored only in the extension's own storage, sent only to the configured deployment, and exists solely so the scoring budget can tell installations apart.

**Convex** (`convex/`) provides the database with tables: `movies`, `ratings`, `reviews`, `awards`, `aiScores`, `scoringRuns`, `users`, `lookups`. Schema in `convex/schema.ts`. Ratings are stored per-source (IMDb, RT, Metacritic, Letterboxd) with their native scales.

### Data Flow

Two providers, both server-side only:

| Data | Source | Key | Required? |
|---|---|---|---|
| Title resolution, ratings (IMDb, RT, Metacritic), award totals | OMDb | free, 1,000/day | **yes** |
| Named awards with categories and win/nomination | Wikidata Query Service | none | no |
| Letterboxd ratings | MDBList | free, 1,000/day | no |
| Artwork and metadata | TMDB | free, ~40/sec | no |

**OMDb resolves; the rest enrich.** OMDb is the only one of the four that searches well by title, which is all the extension has to go on — everything else is keyed by the IMDb ID OMDb returns. The three enrichers are each independently key-gated, run concurrently (none depends on another, and sequencing them would stack three timeouts onto a request a user is waiting on), and **none may fail a lookup**: each returns empty on any error. A card with ratings and no Letterboxd score is fine; a card with nothing because a third-party endpoint was slow is not.

Measured cost on a cold title: ~300ms for all three together in the normal case. Because they're concurrent, a single hung provider costs its own timeout (5-6s) rather than the sum. Warm lookups skip all of it — this only runs on a cache miss.

Ratings originate from **OMDb**, and only the backend talks to it:

```
content script → background worker → Convex action (omdb:lookup) → OMDb
                 chrome.storage       lookups/movies/ratings/awards tables
                 cache (6-24h)        cache (6h, 1h for misses)
```

- `convex/omdb.ts` holds the `lookup` action plus the internal query/mutation that read and write the cache. `convex/omdbParse.ts` holds the pure response parsers, kept free of Convex imports so `npm run verify:parsers` can exercise them without a deployment.
- The OMDb key lives in the Convex deployment (`npx convex env set OMDB_API_KEY <key>`), never in the extension bundle.
- Both cache layers key on a normalized title (`buildLookupKey` in `src/shared/utils/text.ts`, mirrored by `lookupKey` in `convex/omdbParse.ts` — **keep these two in sync**, or the caches will disagree about what counts as the same title).
- Negative results are cached too. Streaming sites show plenty of titles OMDb can't match, and without this each SPA navigation would re-query.
- The resolve ladder tries the exact title (with year, then without), then **drops a trailing parenthetical qualifier**, then falls back to search. That third step exists because streaming services disambiguate regional versions in a way the databases don't — Netflix lists "The Office (U.S.)", and OMDb has no record under that name, so a whole class of well-known shows failed outright. It only ever builds a retry: some real titles end in parentheses.
- **Only a genuine miss is cached as one.** `classifyOmdbFailure` reads both the status and the body, because neither is sufficient alone: OMDb returns 401 for a wrong key *and* an exhausted quota, and a body whose `Error` we don't recognise must not be read as "no such title" — that verdict gets cached and outlives its cause. Anything unfamiliar is treated as transient and retried (3 attempts, backing off), then surfaced with OMDb's own wording rather than a bare status.
- The extension addresses backend functions by string (`makeFunctionReference("omdb:lookup")`) rather than the generated `api` object, so renaming a Convex function is a runtime break, not a compile error.

### Awards (Wikidata)

OMDb reports awards as one sentence — "Won 4 Oscars. 159 wins & 220 nominations total." — which gives counts and no categories. Wikidata models each award as a statement, so the same film yields "Academy Award for Best Cinematography, won, 2011" per award. Films carry their IMDb ID as property `P345`, so the id OMDb already returns is enough to find the entity: no key, no account.

- `convex/wikidata.ts` fetches; `convex/wikidataParse.ts` holds the query builder, the label splitter, and the merge, free of Convex imports for `npm run verify:awards`.
- Wins are `P166` (award received), nominations `P1411` (nominated for) — two properties, so the query is a UNION over both.
- **Enrichment must never fail a lookup.** Every error path returns an empty list and the card falls back to OMDb's counts. A title with ratings and no award detail is fine; a title with no ratings because a shared public SPARQL endpoint was busy is not.
- **WDQS throttles hard** — a 429 is routine. One retry honours `Retry-After` when it's short enough to be worth a waiting user; otherwise it gives up quietly.
- Wikimedia blocks anonymous clients, so the descriptive `User-Agent` in `wikidata.ts` is required, not politeness.
- The two sources answer different questions and neither replaces the other: Wikidata names the major awards but its coverage of minor festivals is patchy, OMDb knows the totals but not what for. `mergeAwards` lists the named ones and reduces OMDb's totals by what's shown, so the same Oscar isn't counted twice.

### Optional Providers (MDBList, TMDB)

Both are off unless a key is set on the deployment, and both only ever add to an OMDb result.

- **MDBList** (`convex/mdblist.ts`) — `npx convex env set MDBLIST_API_KEY <key>`. Its reason to exist is **Letterboxd**, which has been in `RatingSource` and the overlay since the start with no provider behind it: OMDb doesn't carry it and Letterboxd's own API is approval-only. It re-reports IMDb/RT/Metacritic too, but `mergeRatings` keeps OMDb's numbers and takes only sources OMDb lacked.
- **TMDB** (`convex/tmdb.ts`) — `npx convex env set TMDB_API_KEY <key>`. Better artwork, and a rate limit measured per second rather than per day. Two requests per cold title (`/find` by IMDb ID, then details), which is affordable at 40/sec. `mergeMetadata` prefers TMDB's poster but otherwise only fills gaps — overwriting a title or year OMDb resolved could contradict the id the lookup was keyed on.

**A caveat on the MDBList parser.** Its route, top-level fields, and rating source names come from MDBList's own OpenAPI spec at `api.mdblist.com/schema/`. The shape of each entry *inside* `ratings` does not — the spec declares it as a bare `type: object`, and the endpoint needs a key, so it was never observed. The parser therefore accepts several plausible spellings of the value field and rejects any number that fits no scale. **Check the first real response against `npm run verify:providers`.**

### AI Review Scoring (Phase 3)

A second, slower path that lives entirely apart from the ratings flow:

```
overlay "Show AI Analysis" → background worker → Convex action (aiScores:generate) → Claude + web search
                             chrome.storage       aiScores table
                             cache (7d)           cache (30d, 7d for failures)
```

The roadmap called for scraping reviews and then analyzing them. It does both in one call instead: Claude's server-side `web_search` tool finds and reads the reviews, and a `strict: true` tool call (`submit_scores`) returns the category scores plus the URLs it drew on. That avoids a scraper per publication and keeps the sources attached to the scores.

- `convex/aiScores.ts` is a `"use node"` action — Convex Node files can only export actions, so the database functions live in `convex/aiScoresDb.ts`. `convex/aiScoresParse.ts` holds the prompt, the tool schema, and the validation, free of Convex and SDK imports so `npm run verify:ai-scores` can exercise them.
- The key lives in the deployment (`npx convex env set ANTHROPIC_API_KEY <key>`), like the OMDb one.
- **Cost is the design constraint**, and there are three separate guards:
  1. The overlay requests scores only when the user opens the AI section, never on page load.
  2. *Failures are cached too* — a title with too few reviews must not re-run on every view.
  3. Two ceilings (`aiScoresParse.ts`): `RUN_BUDGET` per deployment (20/hour, 100/day) protects the bill, and `CLIENT_RUN_BUDGET` per installation (8/hour, 30/day) stops one heavy user spending everyone's share. The per-title caches can't bound either — every new title is a legitimate cache miss, and one scroll down a Netflix row is dozens of them.
  The client's own ceiling is checked first, so a heavy user is told they've hit *their* share rather than that the deployment is busy because of themselves.
- **`aiScoresDb:claimScoringRun` is the only gate on spending.** It checks the budget *and* reserves the title in one Convex mutation, which is transactional — doing the check in the action would leave a race, and the thing being raced for costs money. A claim writes a `pending` row so two tabs on the same title don't both pay; a claim whose action dies expires after `PENDING_TIMEOUT_MS` rather than stranding the title.
- `generate` returns a **four-way outcome** (`scored` / `unavailable` / `pending` / `rateLimited`), not scores-or-null. The overlay says something different for each, and the background worker caches only the two settled ones — caching "pending" would pin the card to a state that has already passed.
- `aiScoresDb:getBudgetStatus` is public so the remaining budget can be checked from the CLI or the popup.
- A category the reviews didn't discuss comes back missing, not guessed. The parser drops non-numbers, clamps to 0-10, and rejects a submission that has an overall score but fewer than two categories behind it. Sources must be `http(s)` URLs.
- The whole feature is gated on `FEATURES.AI_SCORES_ENABLED`, which is **off**. With it off the background worker short-circuits the message and the overlay hides the section.

### Build Pipeline (`scripts/build.ts`)

Custom esbuild script that:
- Loads `.env` (no dotenv dependency) and bakes `CONVEX_URL` into the bundles
- Processes CSS through PostCSS/Tailwind **first**, then inlines the compiled stylesheet into the content bundle as `__CLAPBOARD_CSS__`
- Bundles background (ESM), content (IIFE), and popup (ESM) separately
- Resolves path aliases (`@shared/*`, `@content/*`, etc.) matching `tsconfig.json`
- Copies manifest, icons, popup HTML, and assets to `dist/`

### Styling

Tailwind **v3**, with the `cb-` prefix configured in `tailwind.config.ts`. Two things to keep in mind:

- Variants go outside the prefix: `hover:cb-text-white`, not `cb-hover:text-white`. The latter silently produces no CSS.
- The overlay renders inside a shadow root, which page styles can't cross, so the content script injects the compiled stylesheet into the shadow root itself. The manifest deliberately does **not** list the stylesheet under `content_scripts.css` — injecting it into the page would apply Tailwind's preflight resets to the streaming site.

### Path Aliases

Defined in both `tsconfig.json` and the esbuild alias plugin:
- `@shared/*` -> `src/shared/*`
- `@content/*` -> `src/content/*`
- `@background/*` -> `src/background/*`
- `@popup/*` -> `src/popup/*`
- `@assets/*` -> `src/assets/*`

## Key Conventions

- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters`
- Feature flags in `src/shared/constants.ts` (`FEATURES`) control phased rollout
- Console logs prefixed with `[Clapboard]` for filtering in DevTools
- Content script watches for SPA navigation by polling `location.href` (`src/content/navigation.ts`), not with a MutationObserver. A content script runs in an isolated world, so patching the page's `history.pushState` is not an option — and a body-subtree observer both costs more and misses any `pushState` that doesn't happen to mutate the DOM

## Current Phase

Phase 1 (Ratings Overlay) and Phase 2 (Awards) are implemented end to end: title detection → background worker → Convex → OMDb → overlay.

Phase 3 (AI review scoring) is implemented, and everything except the model call itself has now been exercised against a live deployment: the schema deploys, and `claimScoringRun` was driven through claim → pending-dedup → release → budget exhaustion via `npx convex run`. What remains unproven is the Claude call — that needs an `ANTHROPIC_API_KEY` and `FEATURES.AI_SCORES_ENABLED` flipped on. Phase 4 (user accounts/Clerk auth) is still stubbed.

Known gaps in the current phases:
- The MDBList and TMDB providers have **never run against their live APIs** — both need keys. Their parsers are unit-verified and every failure path is a no-op, so an unconfigured or broken provider costs nothing, but the first real response is unproven. MDBList's per-rating field names are the specific unknown.
- Wikidata's award coverage is good for the Oscars, Globes, BAFTAs and Emmys and thin for minor festivals, so the "and N more" remainder does most of the work on lesser-known titles. It's also crowd-maintained: a wrong award on a film is a wrong award in the overlay.
- The per-installation scoring ceiling keys on an anonymous id in `chrome.storage`, so it bounds *installations*, not people. Clearing extension storage resets it. That's the most that can be done before Phase 4 brings real accounts, and it's enough for the thing it's for — stopping ordinary heavy browsing from locking others out, not defeating someone deliberately trying to.
- `convex/reviews.ts` still holds the original per-review scoring stubs. Nothing calls them now — the web-search path replaced them — but `aggregateScores` in `aiScoresParse.ts` is the averaging half of that design if per-review scoring ever comes back.
- The platform DOM selectors in `SUPPORTED_SITES` are still unverified against the live sites. `verify:dom` covers the detection machinery, but the selector *strings* are educated guesses until someone checks them with an account on each platform. The URL gate and the metadata fallbacks mean a stale selector degrades rather than breaks — the overlay falls back to JSON-LD or the page title instead of showing the wrong thing.
