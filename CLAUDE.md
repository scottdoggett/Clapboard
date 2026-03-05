# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build          # Build extension to dist/ (esbuild + PostCSS/Tailwind)
npm run build:watch    # Rebuild on file changes
npm run lint           # TypeScript type-check (tsc --noEmit) + ESLint
npx convex dev         # Start Convex backend (separate terminal)
```

After building, load `dist/` as an unpacked extension at `chrome://extensions/` (Developer mode). Reload the extension card after each rebuild.

## Architecture

Clapboard is a **Chrome Manifest V3 extension** that overlays movie/show ratings and awards on streaming sites (Netflix, Disney+, Prime Video, Crave). It uses **esbuild** for bundling (not Next.js/Webpack — Next.js is only listed as a dependency, the actual build is `scripts/build.ts`).

### Three Extension Contexts

1. **Background service worker** (`src/background/index.ts`) — MV3 service worker handling message routing and API calls. Ephemeral; must use `chrome.storage` for persistence, not in-memory state.

2. **Content script** (`src/content/index.ts`) — Injected into streaming sites. Detects the current title via platform-specific DOM selectors, then mounts a React overlay inside a **Shadow DOM** for style isolation. Bundled as IIFE format (not ESM).

3. **Popup** (`src/popup/`) — Toolbar popup for settings/status. Bundled as ESM.

### Message Protocol

Content scripts and popup communicate with the background worker via `chrome.runtime.onMessage`. Messages use **discriminated unions** defined in `src/shared/types/messages.ts` with exhaustive switch handling in the background worker.

### Platform-Specific DOM Detection

Each streaming site has unique CSS selectors configured in `src/shared/constants.ts` (`SUPPORTED_SITES`). The `src/shared/utils/dom.ts` module uses these to detect title pages, extract movie names, and find overlay anchor points. Adding a new streaming platform means adding a new entry to `SUPPORTED_SITES` and tuning selectors.

### Backend

**Convex** (`convex/`) provides the database with tables: `movies`, `ratings`, `reviews`, `awards`, `users`. Schema in `convex/schema.ts`. Ratings are stored per-source (IMDb, RT, Metacritic, Letterboxd) with their native scales.

### Build Pipeline (`scripts/build.ts`)

Custom esbuild script that:
- Bundles background (ESM), content (IIFE), and popup (ESM) separately
- Processes CSS through PostCSS/Tailwind
- Resolves path aliases (`@shared/*`, `@content/*`, etc.) matching `tsconfig.json`
- Copies manifest, icons, popup HTML, and assets to `dist/`

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

Phase 1 (Ratings Overlay) and Phase 2 (Awards) are active. Phase 3 (AI review scoring) and Phase 4 (user accounts/Clerk auth) are stubbed but not implemented.
