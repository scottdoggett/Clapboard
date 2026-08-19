/**
 * Clapboard Content Script Entry Point
 *
 * This script is injected into supported streaming sites (Netflix, Disney+, etc.)
 * and is responsible for:
 * - Detecting when a user is viewing a movie/show detail page
 * - Mounting the React overlay UI into the host page
 * - Managing the overlay lifecycle (show/hide/update)
 * - Communicating with the background service worker
 *
 * The React app is mounted into a shadow DOM to isolate styles from the host page.
 */

import { createRoot, Root } from "react-dom/client";
import { createElement } from "react";
import App from "./App";
import {
  detectCurrentTitle,
  detectSite,
  getOverlayAnchor,
  getInlineTarget,
  isOnTitlePage,
  waitForTitle,
  type TitleInfo,
} from "@shared/utils/dom";
import { STORAGE_KEYS } from "@shared/constants";
import { getSettings } from "@shared/utils/storage";
import { watchNavigation } from "./navigation";
import { startTileControls } from "./tiles";

/**
 * The compiled overlay stylesheet, inlined at build time.
 *
 * The manifest also loads this stylesheet into the page, but styles from the
 * page don't cross the shadow boundary — the overlay would render unstyled
 * without this copy inside the shadow root.
 */
declare const __CLAPBOARD_CSS__: string;

// Global state for the React root
let reactRoot: Root | null = null;
let overlayContainer: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

// The title the overlay is currently showing, so we can tell a real change
// from the many DOM mutations that don't change what's on screen
let currentTitleKey: string | null = null;

// Whether the overlay is spliced into the page's layout or floating over it.
// The card styles itself differently for each, so this travels with the mount.
let currentVariant: "inline" | "floating" = "floating";

// The title currently displayed, so the watchdog can re-mount it if the host
// page's own framework tears our node out
let currentTitleInfo: TitleInfo | null = null;

// Debounce timer for URL change detection
let urlCheckTimer: ReturnType<typeof setTimeout> | null = null;

// Incremented on every title check so a slow one can tell it's been superseded
let checkGeneration = 0;

// How long to wait for a detail view to render after the URL says it should
const TITLE_RENDER_TIMEOUT_MS = 5000;

// Collapses the several URL rewrites a router can emit for one navigation
const NAVIGATION_DEBOUNCE_MS = 150;

// How often to confirm the overlay is still in the document
const REATTACH_CHECK_MS = 1000;

/**
 * Initialize the content script
 */
async function init(): Promise<void> {
  // Very visible log to confirm script is running
  console.log(
    "%c[Clapboard] Content script loaded!",
    "background: #f04d42; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;"
  );
  console.log("[Clapboard] Current URL:", window.location.href);
  console.log("[Clapboard] Hostname:", window.location.hostname);

  // Verify we're on a supported site
  const site = detectSite();
  if (!site) {
    console.log("[Clapboard] Not a supported streaming site");
    return;
  }

  console.log("[Clapboard] Detected streaming site:", site);

  // React to the overlay being switched on or off from the popup without
  // requiring a page reload
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.SETTINGS]) {
      void checkForTitle();
    }
  });

  // Set up URL change detection (for SPAs)
  watchNavigation(onUrlChange);

  // Browse-grid controls are independent of the overlay: they belong on the
  // grid, which is exactly where the overlay deliberately does not appear.
  startTileControls(site);

  // Splicing into the host page means its own framework can re-render the
  // subtree we live in and take our node with it, without the URL changing.
  // A detached container is cheap to notice and the only way to survive that.
  setInterval(reattachIfDetached, REATTACH_CHECK_MS);

  // Initial check for title display
  await checkForTitle();
}

/**
 * Handle URL changes
 */
function onUrlChange(): void {
  // Coalesce the burst of URL rewrites a router can emit for one navigation.
  // Short, because it isn't the thing that waits for the page to render —
  // checkForTitle does that itself via waitForTitlePage.
  if (urlCheckTimer) {
    clearTimeout(urlCheckTimer);
  }

  urlCheckTimer = setTimeout(() => {
    void checkForTitle();
  }, NAVIGATION_DEBOUNCE_MS);
}

/**
 * Identity for a detected title, used to decide whether to re-render
 */
function titleKey(titleInfo: TitleInfo): string {
  return `${titleInfo.title}|${titleInfo.year ?? ""}|${titleInfo.type ?? ""}`;
}

/**
 * Check if we're on a title detail page and should show the overlay
 *
 * Runs on every navigation and whenever the settings change, so it has to be
 * cheap when the answer is "no title here" — which is why the URL check comes
 * before anything that touches the DOM.
 */
async function checkForTitle(): Promise<void> {
  // A newer check superseding this one leaves this generation stale; used to
  // discard the result of an await that finished after the user moved on
  const generation = ++checkGeneration;
  const settings = await getSettings();

  if (!settings.enabled) {
    unmountOverlay();
    return;
  }

  if (!isOnTitlePage()) {
    console.log("[Clapboard] Not a title page:", window.location.pathname);
    unmountOverlay();
    return;
  }

  let titleInfo = detectCurrentTitle();

  // The URL says there's a title here but it isn't readable yet, which is the
  // normal case right after a client-side navigation
  if (!titleInfo) {
    console.log("[Clapboard] Title page detected, waiting for it to render...");
    titleInfo = await waitForTitle(TITLE_RENDER_TIMEOUT_MS);
    if (generation !== checkGeneration) return;
  }

  if (titleInfo) {
    console.log("[Clapboard] Detected title:", titleInfo.title, titleInfo);
    mountOverlay(titleInfo);
  } else {
    console.log("[Clapboard] Title page, but no title could be read");
    unmountOverlay();
  }
}

/**
 * Put the overlay back if the host page's rendering removed it.
 *
 * Only relevant when spliced inline: the site's own framework owns that
 * subtree and will happily replace it on a re-render, which detaches our
 * container without any navigation happening.
 */
function reattachIfDetached(): void {
  if (!overlayContainer || !currentTitleInfo) return;
  if (document.body.contains(overlayContainer)) return;

  console.log("[Clapboard] Overlay was detached by the page — remounting");
  const titleInfo = currentTitleInfo;
  unmountOverlay();
  mountOverlay(titleInfo);
}

/**
 * Mount the React overlay UI, or re-render it when the title has changed
 */
function mountOverlay(titleInfo: TitleInfo): void {
  const key = titleKey(titleInfo);
  const isMounted =
    overlayContainer !== null && document.body.contains(overlayContainer);

  if (isMounted) {
    // Same title, nothing to do — this fires constantly on SPA sites
    if (key === currentTitleKey) return;

    // Different title in an overlay that's already up: re-render in place so
    // the card doesn't flicker out and back in during navigation
    currentTitleKey = key;
    currentTitleInfo = titleInfo;
    reactRoot?.render(createElement(App, { titleInfo, variant: currentVariant }));
    console.log("[Clapboard] Overlay updated for:", titleInfo.title);
    return;
  }

  // A stale container can survive if the host page replaced its subtree
  unmountOverlay();

  // Create container element
  overlayContainer = document.createElement("div");
  overlayContainer.id = "clapboard-overlay-root";

  // Create shadow DOM for style isolation
  shadowRoot = overlayContainer.attachShadow({ mode: "open" });

  // Inject the compiled stylesheet into the shadow root
  const styleElement = document.createElement("style");
  styleElement.textContent = `
    /*
     * Reset the shadow root, then deliberately re-inherit typography and
     * colour from the host page.
     *
     * \`all: initial\` is what stops the site's CSS reaching in, but it also
     * resets the font to the browser default — which is why the inline section
     * looked foreign no matter how it was styled. Inheriting puts it in the
     * site's own typeface, which for a section spliced into that site's layout
     * is the whole game.
     */
    :host {
      all: initial;
      font-family: inherit;
      color: inherit;
    }

    ${__CLAPBOARD_CSS__}
  `;
  shadowRoot.appendChild(styleElement);

  // Create React mount point inside shadow DOM
  const mountPoint = document.createElement("div");
  mountPoint.id = "clapboard-react-root";
  shadowRoot.appendChild(mountPoint);

  // Splice into the page's own layout where we know where that is, so the
  // ratings are read alongside the site's information rather than floating in
  // a corner over the top of it.
  const inlineTarget = getInlineTarget();

  if (inlineTarget) {
    currentVariant = "inline";
    overlayContainer.style.display = "block";
    overlayContainer.style.width = "100%";

    const { reference, placement } = inlineTarget;
    reference.parentElement?.insertBefore(
      overlayContainer,
      placement === "after" ? reference.nextSibling : reference
    );
  } else {
    currentVariant = "floating";
    (getOverlayAnchor() ?? document.body).appendChild(overlayContainer);
  }

  // Mount React app
  currentTitleKey = key;
  currentTitleInfo = titleInfo;
  reactRoot = createRoot(mountPoint);
  reactRoot.render(createElement(App, { titleInfo, variant: currentVariant }));

  console.log("[Clapboard] Overlay mounted");
}

/**
 * Unmount the React overlay UI
 */
function unmountOverlay(): void {
  if (!reactRoot && !overlayContainer) return;

  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }

  if (overlayContainer && overlayContainer.parentNode) {
    overlayContainer.parentNode.removeChild(overlayContainer);
  }

  overlayContainer = null;
  shadowRoot = null;
  currentTitleKey = null;
  currentTitleInfo = null;

  console.log("[Clapboard] Overlay unmounted");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}

// Export for testing
export { init, mountOverlay, unmountOverlay, detectSite };
