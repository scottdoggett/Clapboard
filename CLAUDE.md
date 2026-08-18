# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build           # Build extension to dist/ (esbuild + PostCSS/Tailwind)
npm run build:watch     # Rebuild on file changes
npm run lint            # TypeScript type-check (tsc --noEmit) + ESLint
npm run verify:parsers  # Check OMDb response parsers against known payloads
npx convex dev          # Start Convex backend (separate terminal)
```

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

Each streaming site has unique CSS selectors configured in `src/shared/constants.ts` (`SUPPORTED_SITES`). The `src/shared/utils/dom.ts` module uses these to detect title pages, extract movie names, and find overlay anchor points. Adding a new streaming platform means adding a new entry to `SUPPORTED_SITES` and tuning selectors.

### Backend

**Convex** (`convex/`) provides the database with tables: `movies`, `ratings`, `reviews`, `awards`, `users`, `lookups`. Schema in `convex/schema.ts`. Ratings are stored per-source (IMDb, RT, Metacritic, Letterboxd) with their native scales.

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

Phase 1 (Ratings Overlay) and Phase 2 (Awards) are implemented end to end: title detection → background worker → Convex → OMDb → overlay. Phase 3 (AI review scoring) and Phase 4 (user accounts/Clerk auth) are stubbed but not implemented.

Known gaps in the current phases:
- Letterboxd is in the `RatingSource` union and the UI but has no provider — OMDb doesn't carry it and there's no public API.
- Awards come from OMDb's free-text summary, so they're counts ("4 Oscars") rather than categories ("Best Picture").
- The platform DOM selectors in `SUPPORTED_SITES` are unverified against the live sites; Prime Video's `h1` selector in particular is broad enough to match non-title pages.
