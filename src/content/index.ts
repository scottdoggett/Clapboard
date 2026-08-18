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
  isOnTitlePage,
  waitForTitlePage,
  type TitleInfo,
} from "@shared/utils/dom";
import { STORAGE_KEYS } from "@shared/constants";
import { getSettings } from "@shared/utils/storage";
import { watchNavigation } from "./navigation";

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

// Debounce timer for URL change detection
let urlCheckTimer: ReturnType<typeof setTimeout> | null = null;

// Incremented on every title check so a slow one can tell it's been superseded
let checkGeneration = 0;

// How long to wait for a detail view to render after the URL says it should
const TITLE_RENDER_TIMEOUT_MS = 5000;

// Collapses the several URL rewrites a router can emit for one navigation
const NAVIGATION_DEBOUNCE_MS = 150;

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

  // The URL says there's a title here but the detail view hasn't rendered yet,
  // which is the normal case right after a client-side navigation
  if (!titleInfo) {
    console.log("[Clapboard] Title page detected, waiting for it to render...");
    await waitForTitlePage(TITLE_RENDER_TIMEOUT_MS);
    if (generation !== checkGeneration) return;
    titleInfo = detectCurrentTitle();
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
    reactRoot?.render(createElement(App, { titleInfo }));
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
    /* Base reset for shadow DOM */
    :host {
      all: initial;
      font-family: system-ui, -apple-system, sans-serif;
    }

    ${__CLAPBOARD_CSS__}
  `;
  shadowRoot.appendChild(styleElement);

  // Create React mount point inside shadow DOM
  const mountPoint = document.createElement("div");
  mountPoint.id = "clapboard-react-root";
  shadowRoot.appendChild(mountPoint);

  // Find the best anchor point in the host page
  const anchor = getOverlayAnchor();
  if (anchor) {
    anchor.appendChild(overlayContainer);
  } else {
    // Fallback: append to body
    document.body.appendChild(overlayContainer);
  }

  // Mount React app
  currentTitleKey = key;
  reactRoot = createRoot(mountPoint);
  reactRoot.render(createElement(App, { titleInfo }));

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
