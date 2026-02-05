# Convex Backend

This directory contains the Convex backend for Clapboard.

## Overview

[Convex](https://www.convex.dev/) is a full-stack TypeScript development platform that provides:

- **Real-time database** — Automatic reactivity for live updates
- **Serverless functions** — Queries and mutations with automatic TypeScript types
- **File storage** — For any media assets
- **Scheduling** — Cron jobs and scheduled functions

## Structure

```
convex/
├── _generated/       # Auto-generated files (gitignored)
├── schema.ts         # Database schema definition
├── auth.ts           # Authentication helpers (Clerk integration)
├── movies.ts         # Movie queries & mutations
├── ratings.ts        # Ratings aggregation functions
├── reviews.ts        # AI review processing (Phase 3)
└── README.md         # This file
```

## Schema

The database has four main tables:

### `movies`
Core movie/show metadata including title, year, external IDs (TMDB, IMDb), and basic info.

### `ratings`
Aggregated ratings from multiple sources (IMDb, Rotten Tomatoes, Metacritic, Letterboxd). Each movie can have one rating per source.

### `users`
User accounts synced from Clerk authentication. Phase 4 feature.

### `reviews`
Review text and AI-generated category scores. Phase 3 feature.

### `awards`
Award wins and nominations (Oscars, Golden Globes, etc.).

## Development

### Setup

1. Create a Convex account at [convex.dev](https://www.convex.dev/)
2. Install the Convex CLI: `npm install -g convex`
3. Initialize: `npx convex dev`

### Running

```bash
# Start Convex dev server (watches for changes)
npx convex dev

# Deploy to production
npx convex deploy
```

### Environment Variables

Set these in your Convex dashboard:

- `CLERK_JWT_ISSUER` — Clerk JWT issuer URL (for auth)

## Usage from Extension

The extension communicates with Convex through the background service worker:

```typescript
import { ConvexClient } from "convex/browser";
import { api } from "@convex/_generated/api";

const client = new ConvexClient(process.env.CONVEX_URL);

// Query movies
const movie = await client.query(api.movies.getByTitle, { title: "Inception" });

// Get ratings
const ratings = await client.query(api.ratings.getForMovie, { movieId: movie._id });
```

## Notes

- The `_generated/` directory is created by Convex and should not be edited manually
- Always run `npx convex dev` when making schema changes to regenerate types
- See the [Convex docs](https://docs.convex.dev/) for more information
