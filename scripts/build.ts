/**
 * Custom Build Script for Clapboard Chrome Extension
 *
 * This script bundles the extension using esbuild and processes CSS with PostCSS/Tailwind.
 * Run with: npx tsx scripts/build.ts
 */

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const BUILD_DIR = "dist";
const SRC_DIR = "src";

// The compiled overlay stylesheet, populated by processCSS() before the
// content script is bundled so it can be inlined into the shadow root
let compiledCss = "";

/**
 * Load .env into process.env without pulling in a dependency.
 *
 * Only fills in variables that aren't already set, so a value passed on the
 * command line still wins.
 */
function loadEnv(): void {
  if (!fs.existsSync(".env")) return;

  const contents = fs.readFileSync(".env", "utf-8");

  for (const line of contents.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;

    const key = match[1];
    // Strip surrounding quotes if present
    const value = match[2].replace(/^["']|["']$/g, "");

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Resolve path with extension (.ts, .tsx, or /index.ts)
function resolveWithExtension(basePath: string): string {
  const extensions = [".ts", ".tsx", "/index.ts", "/index.tsx"];
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  // Return as-is if no extension found (let esbuild handle the error)
  return basePath;
}

// Path aliases matching tsconfig.json
const aliasPlugin: esbuild.Plugin = {
  name: "alias",
  setup(build) {
    // Resolve @shared/* imports
    build.onResolve({ filter: /^@shared\// }, (args) => ({
      path: resolveWithExtension(path.resolve(SRC_DIR, "shared", args.path.replace("@shared/", ""))),
    }));
    // Resolve @content/* imports
    build.onResolve({ filter: /^@content\// }, (args) => ({
      path: resolveWithExtension(path.resolve(SRC_DIR, "content", args.path.replace("@content/", ""))),
    }));
    // Resolve @background/* imports
    build.onResolve({ filter: /^@background\// }, (args) => ({
      path: resolveWithExtension(path.resolve(SRC_DIR, "background", args.path.replace("@background/", ""))),
    }));
    // Resolve @popup/* imports
    build.onResolve({ filter: /^@popup\// }, (args) => ({
      path: resolveWithExtension(path.resolve(SRC_DIR, "popup", args.path.replace("@popup/", ""))),
    }));
    // Resolve @assets/* imports
    build.onResolve({ filter: /^@assets\// }, (args) => ({
      path: resolveWithExtension(path.resolve(SRC_DIR, "assets", args.path.replace("@assets/", ""))),
    }));
  },
};

// Plugin to handle CSS imports (ignore them in JS bundles, we process CSS separately)
const ignoreCssPlugin: esbuild.Plugin = {
  name: "ignore-css",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, () => ({
      path: "css-stub",
      namespace: "css-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
      contents: "",
      loader: "js",
    }));
  },
};

async function clean(): Promise<void> {
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

async function bundleBackground(): Promise<void> {
  console.log("  Bundling background service worker...");
  await esbuild.build({
    entryPoints: ["src/background/index.ts"],
    bundle: true,
    outfile: path.join(BUILD_DIR, "background", "index.js"),
    format: "esm",
    target: "chrome120",
    platform: "browser",
    plugins: [aliasPlugin],
    define: {
      "process.env.CONVEX_URL": JSON.stringify(process.env.CONVEX_URL || ""),
    },
  });
}

async function bundleContent(): Promise<void> {
  console.log("  Bundling content script...");
  await esbuild.build({
    entryPoints: ["src/content/index.ts"],
    bundle: true,
    outfile: path.join(BUILD_DIR, "content", "index.js"),
    format: "iife", // Content scripts need IIFE format
    target: "chrome120",
    platform: "browser",
    plugins: [aliasPlugin, ignoreCssPlugin],
    define: {
      "process.env.CONVEX_URL": JSON.stringify(process.env.CONVEX_URL || ""),
      "process.env.NODE_ENV": JSON.stringify("production"),
      // The overlay renders inside a shadow root, which page-level styles
      // can't reach — the content script injects this copy instead.
      __CLAPBOARD_CSS__: JSON.stringify(compiledCss),
    },
    jsx: "automatic",
  });
}

async function bundlePopup(): Promise<void> {
  console.log("  Bundling popup...");
  await esbuild.build({
    entryPoints: ["src/popup/index.tsx"],
    bundle: true,
    outfile: path.join(BUILD_DIR, "popup", "index.js"),
    format: "esm",
    target: "chrome120",
    platform: "browser",
    plugins: [aliasPlugin, ignoreCssPlugin],
    define: {
      "process.env.CONVEX_URL": JSON.stringify(process.env.CONVEX_URL || ""),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    jsx: "automatic",
  });
}

async function processCSS(): Promise<void> {
  console.log("  Processing CSS with Tailwind...");

  const cssInput = fs.readFileSync("src/content/styles/overlay.css", "utf-8");

  const result = await postcss([tailwindcss, autoprefixer]).process(cssInput, {
    from: "src/content/styles/overlay.css",
    to: path.join(BUILD_DIR, "content", "styles", "overlay.css"),
  });

  // Hold onto the output so bundleContent() can inline it into the shadow root
  compiledCss = result.css;

  // Write content script CSS
  fs.mkdirSync(path.join(BUILD_DIR, "content", "styles"), { recursive: true });
  fs.writeFileSync(
    path.join(BUILD_DIR, "content", "styles", "overlay.css"),
    result.css
  );

  // Also write to popup directory for popup styles
  fs.mkdirSync(path.join(BUILD_DIR, "popup"), { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "popup", "styles.css"), result.css);
}

async function copyStaticAssets(): Promise<void> {
  console.log("  Copying static assets...");

  // Copy manifest.json
  fs.copyFileSync("public/manifest.json", path.join(BUILD_DIR, "manifest.json"));

  // Copy icons
  fs.mkdirSync(path.join(BUILD_DIR, "icons"), { recursive: true });
  const iconFiles = ["icon-16.png", "icon-48.png", "icon-128.png"];
  for (const icon of iconFiles) {
    const src = path.join("src", "assets", "icons", icon);
    const dest = path.join(BUILD_DIR, "icons", icon);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // Copy popup HTML
  fs.copyFileSync("src/popup/index.html", path.join(BUILD_DIR, "popup", "index.html"));

  // Copy logo if needed
  fs.mkdirSync(path.join(BUILD_DIR, "assets"), { recursive: true });
  if (fs.existsSync("src/assets/logo.svg")) {
    fs.copyFileSync("src/assets/logo.svg", path.join(BUILD_DIR, "assets", "logo.svg"));
  }
}

async function build(): Promise<void> {
  console.log("🎬 Building Clapboard extension...\n");

  const startTime = Date.now();

  try {
    loadEnv();

    if (!process.env.CONVEX_URL) {
      console.warn(
        "⚠️  CONVEX_URL is not set — the extension will build, but lookups will fail until a deployment URL is entered in the popup.\n"
      );
    }

    await clean();

    // CSS is processed first: the content script bundle inlines the compiled
    // stylesheet, so it has to exist before bundling.
    await processCSS();

    console.log("📦 Bundling scripts...");
    await bundleBackground();
    await bundleContent();
    await bundlePopup();
    await copyStaticAssets();

    const elapsed = Date.now() - startTime;
    console.log(`\n✅ Build complete in ${elapsed}ms`);
    console.log(`📁 Output: ${path.resolve(BUILD_DIR)}/`);
    console.log("\nNext steps:");
    console.log("  1. Open chrome://extensions");
    console.log("  2. Enable Developer mode");
    console.log('  3. Click "Load unpacked"');
    console.log(`  4. Select: ${path.resolve(BUILD_DIR)}`);
  } catch (error) {
    console.error("\n❌ Build failed:", error);
    process.exit(1);
  }
}

build();
