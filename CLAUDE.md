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
npm run doctor          # Preflight: deployment, keys, feature flags, bundle freshness
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
3. **Document metadata** — JSON-LD, then Open Graph, then `document.title`. Structured and stable across redesigns, but baked in at load: on a single-page app it describes whatever page was *served*. `dom.ts` records `location.href` at module load and only consults these while the URL still matches.

Candidates are merged rather than raced: the first usable title wins, and fields it lacks (typically the year) are filled from later candidates.

Content type comes from the URL where the platform encodes it (`/movies/` vs `/series/`), otherwise from a `seriesIndicator` element, otherwise stays `undefined` — a missing episode list may just mean it hasn't rendered.

Adding a platform means one new `SUPPORTED_SITES` entry: host patterns, URL patterns, and selector candidate lists. Add its URL shapes to `scripts/verify-detection.ts` and a fixture page to `scripts/verify-dom.ts` at the same time.

**On the fixtures:** `verify-dom.ts` runs the real `detectCurrentTitle` against jsdom pages modelled on each platform's markup. It proves the machinery — gate, layering, alt-text titles, staleness — but *not* that the selectors match the live sites, since the fixtures are written here. When you add a "this page should detect nothing" fixture, give it a **real title** in title-page markup (a promoted billboard, a hero carousel). A fixture whose heading is "Home" passes on the plausibility check instead of the gate and proves nothing — mutation-testing caught exactly that, twice.

### Backend

**Convex** (`convex/`) provides the database with tables: `movies`, `ratings`, `reviews`, `awards`, `aiScores`, `scoringRuns`, `users`, `lookups`. Schema in `convex/schema.ts`. Ratings are stored per-source (IMDb, RT, Metacritic, Letterboxd) with their native scales.

### Data Flow

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
- The extension addresses backend functions by string (`makeFunctionReference("omdb:lookup")`) rather than the generated `api` object, so renaming a Convex function is a runtime break, not a compile error.

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
  3. A deployment-wide ceiling (`RUN_BUDGET` in `aiScoresParse.ts`: 20/hour, 100/day). The per-title caches can't bound this — every new title is a legitimate cache miss, and one scroll down a Netflix row is dozens of them.
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
- Content script uses MutationObserver + popstate listener for SPA navigation detection

## Current Phase

Phase 1 (Ratings Overlay) and Phase 2 (Awards) are implemented end to end: title detection → background worker → Convex → OMDb → overlay.

Phase 3 (AI review scoring) is implemented, and everything except the model call itself has now been exercised against a live deployment: the schema deploys, and `claimScoringRun` was driven through claim → pending-dedup → release → budget exhaustion via `npx convex run`. What remains unproven is the Claude call — that needs an `ANTHROPIC_API_KEY` and `FEATURES.AI_SCORES_ENABLED` flipped on. Phase 4 (user accounts/Clerk auth) is still stubbed.

Known gaps in the current phases:
- Letterboxd is in the `RatingSource` union and the UI but has no provider — OMDb doesn't carry it and there's no public API.
- Awards come from OMDb's free-text summary, so they're counts ("4 Oscars") rather than categories ("Best Picture").
- The AI scoring ceiling is **per deployment, not per user** — there are no user accounts yet (Phase 4), so it can't be anything else. One person can spend the whole budget and lock everyone else out until the window rolls.
- `convex/reviews.ts` still holds the original per-review scoring stubs. Nothing calls them now — the web-search path replaced them — but `aggregateScores` in `aiScoresParse.ts` is the averaging half of that design if per-review scoring ever comes back.
- The platform DOM selectors in `SUPPORTED_SITES` are still unverified against the live sites. `verify:dom` covers the detection machinery, but the selector *strings* are educated guesses until someone checks them with an account on each platform. The URL gate and the metadata fallbacks mean a stale selector degrades rather than breaks — the overlay falls back to JSON-LD or the page title instead of showing the wrong thing.
