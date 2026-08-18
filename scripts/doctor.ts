/**
 * Setup Preflight
 *
 * Answers "why isn't the overlay showing anything?" without guesswork.
 *
 * The extension fails in layers — no deployment, no key, a stale bundle, a
 * feature flag off — and every one of them looks identical from the streaming
 * site: an empty card, or no card. This walks the chain in order and reports
 * the first thing that is actually wrong.
 *
 * Run with: npm run doctor
 */

import { readFileSync, existsSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { FEATURES } from "../src/shared/constants";

type Level = "ok" | "warn" | "fail";

interface Result {
  level: Level;
  label: string;
  detail: string;
  /** What to run or click to fix it */
  fix?: string;
}

const results: Result[] = [];

function report(level: Level, label: string, detail: string, fix?: string): void {
  results.push({ level, label, detail, fix });
}

/**
 * Read a KEY=value file without pulling in a dotenv dependency, matching what
 * scripts/build.ts does.
 */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/** Run a command, returning its output or null if it failed. */
function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

// --- 1. Convex deployment --------------------------------------------------

const localEnv = readEnvFile(".env.local");
const buildEnv = readEnvFile(".env");
const deploymentUrl = buildEnv.CONVEX_URL || localEnv.NEXT_PUBLIC_CONVEX_URL || "";

if (!existsSync("convex/_generated")) {
  report(
    "fail",
    "Convex deployment",
    "convex/_generated is missing — no deployment has been provisioned",
    "npx convex dev"
  );
} else if (!deploymentUrl) {
  report(
    "fail",
    "Convex deployment",
    "A deployment exists but no URL is configured for the extension",
    "Copy NEXT_PUBLIC_CONVEX_URL from .env.local into CONVEX_URL in .env, then npm run build"
  );
} else {
  report("ok", "Convex deployment", deploymentUrl);
}

// --- 2. Is the deployment actually reachable and current? ------------------

if (deploymentUrl) {
  // A public query with no arguments — reaching it proves the URL resolves,
  // the deployment is up, and our functions are pushed
  const budget = run("npx", [
    "convex",
    "run",
    "aiScoresDb:getBudgetStatus",
    "{}",
  ]);

  if (budget === null) {
    report(
      "fail",
      "Backend functions",
      "Couldn't reach aiScoresDb:getBudgetStatus — functions may not be pushed",
      "npx convex dev --once"
    );
  } else {
    const runsLastHour = /"runsLastHour":\s*(\d+)/.exec(budget)?.[1] ?? "?";
    const runsLastDay = /"runsLastDay":\s*(\d+)/.exec(budget)?.[1] ?? "?";
    report(
      "ok",
      "Backend functions",
      `reachable · scoring runs used: ${runsLastHour} this hour, ${runsLastDay} today`
    );
  }
}

// --- 3. Backend secrets ----------------------------------------------------

const envList = run("npx", ["convex", "env", "list"]) ?? "";

if (!envList.includes("OMDB_API_KEY")) {
  report(
    "fail",
    "OMDb key",
    "Not set on the deployment — every ratings lookup will throw",
    "npx convex env set OMDB_API_KEY <key>   (free at omdbapi.com/apikey.aspx)"
  );
} else {
  report("ok", "OMDb key", "set on the deployment");
}

const hasAnthropicKey = envList.includes("ANTHROPIC_API_KEY");

// --- 4. Phase 3 feature flag ----------------------------------------------

if (!FEATURES.AI_SCORES_ENABLED) {
  report(
    "warn",
    "AI scoring (Phase 3)",
    "Off — the overlay hides the AI section entirely",
    hasAnthropicKey
      ? "Set AI_SCORES_ENABLED to true in src/shared/constants.ts, then npm run build"
      : "npx convex env set ANTHROPIC_API_KEY <key>, flip AI_SCORES_ENABLED, then npm run build"
  );
} else if (!hasAnthropicKey) {
  // The worse of the two orderings: the UI offers scoring and then errors
  report(
    "fail",
    "AI scoring (Phase 3)",
    "Enabled, but ANTHROPIC_API_KEY is not set — the panel will error on open",
    "npx convex env set ANTHROPIC_API_KEY <key>"
  );
} else {
  report("ok", "AI scoring (Phase 3)", "enabled, key set");
}

// --- 5. The built bundle ---------------------------------------------------

if (!existsSync("dist/manifest.json")) {
  report("fail", "Built extension", "dist/ is missing or incomplete", "npm run build");
} else {
  const background = "dist/background/index.js";
  const bundled = existsSync(background) ? readFileSync(background, "utf8") : "";

  if (deploymentUrl && !bundled.includes(deploymentUrl)) {
    // The URL is baked in at build time, so an older bundle silently points at
    // nothing — or worse, at a previous deployment
    report(
      "fail",
      "Built extension",
      "dist/ was built without the current deployment URL",
      "npm run build"
    );
  } else {
    const builtAt = statSync("dist/manifest.json").mtime;
    report("ok", "Built extension", `dist/ built ${builtAt.toLocaleString()}`);
  }
}

// --- Output ----------------------------------------------------------------

const ICONS: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };

console.log("\nClapboard setup check\n");

for (const result of results) {
  console.log(`  ${ICONS[result.level]} ${result.label}: ${result.detail}`);
  if (result.fix) console.log(`      → ${result.fix}`);
}

const failed = results.filter((r) => r.level === "fail");

console.log(
  failed.length === 0
    ? "\nBackend is ready. Load dist/ at chrome://extensions (Developer mode → Load unpacked).\n"
    : `\n${failed.length} thing${failed.length === 1 ? "" : "s"} to fix above.\n`
);

process.exit(failed.length === 0 ? 0 : 1);
