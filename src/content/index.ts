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
import { detectCurrentTitle, getOverlayAnchor } from "@shared/utils/dom";
import { SUPPORTED_SITES } from "@shared/constants";

// Global state for the React root
let reactRoot: Root | null = null;
let overlayContainer: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

// Debounce timer for URL change detection
let urlCheckTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize the content script
 */
function init(): void {
  console.log("[Clapboard] Content script loaded on:", window.location.hostname);

  // Verify we're on a supported site
  const site = detectSite();
  if (!site) {
    console.log("[Clapboard] Not a supported streaming site");
    return;
  }

  console.log("[Clapboard] Detected streaming site:", site);

  // Set up URL change detection (for SPAs)
  observeUrlChanges();

  // Initial check for title display
  checkForTitle();
}

/**
 * Detect which streaming site we're on
 */
function detectSite(): string | null {
  const hostname = window.location.hostname;

  for (const [siteKey, siteConfig] of Object.entries(SUPPORTED_SITES)) {
    if (siteConfig.hostPatterns.some((pattern) => hostname.includes(pattern))) {
      return siteKey;
    }
  }

  return null;
}

/**
 * Observe URL changes for SPA navigation
 */
function observeUrlChanges(): void {
  let lastUrl = window.location.href;

  // Use MutationObserver to detect DOM changes that might indicate navigation
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onUrlChange();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also listen for popstate (back/forward navigation)
  window.addEventListener("popstate", onUrlChange);
}

/**
 * Handle URL changes
 */
function onUrlChange(): void {
  // Debounce to avoid rapid fire during navigation
  if (urlCheckTimer) {
    clearTimeout(urlCheckTimer);
  }

  urlCheckTimer = setTimeout(() => {
    checkForTitle();
  }, 500);
}

/**
 * Check if we're on a title detail page and should show the overlay
 */
function checkForTitle(): void {
  const titleInfo = detectCurrentTitle();

  if (titleInfo) {
    console.log("[Clapboard] Detected title:", titleInfo.title);
    mountOverlay(titleInfo);
  } else {
    unmountOverlay();
  }
}

/**
 * Mount the React overlay UI
 */
function mountOverlay(titleInfo: { title: string; year?: number }): void {
  // Don't remount if already mounted
  if (overlayContainer && document.body.contains(overlayContainer)) {
    // TODO: Update existing overlay with new title info
    return;
  }

  // Create container element
  overlayContainer = document.createElement("div");
  overlayContainer.id = "clapboard-overlay-root";

  // Create shadow DOM for style isolation
  shadowRoot = overlayContainer.attachShadow({ mode: "open" });

  // Inject styles into shadow DOM
  const styleElement = document.createElement("style");
  styleElement.textContent = `
    /* TODO: Inject compiled Tailwind CSS here during build */
    /* Base reset for shadow DOM */
    :host {
      all: initial;
      font-family: system-ui, -apple-system, sans-serif;
    }
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
  reactRoot = createRoot(mountPoint);
  reactRoot.render(createElement(App, { titleInfo }));

  console.log("[Clapboard] Overlay mounted");
}

/**
 * Unmount the React overlay UI
 */
function unmountOverlay(): void {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }

  if (overlayContainer && overlayContainer.parentNode) {
    overlayContainer.parentNode.removeChild(overlayContainer);
    overlayContainer = null;
    shadowRoot = null;
  }

  console.log("[Clapboard] Overlay unmounted");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Export for testing
export { init, mountOverlay, unmountOverlay, detectSite };
