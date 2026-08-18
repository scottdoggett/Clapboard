/**
 * SPA Navigation Watching
 *
 * Every supported platform is a single-page app: the URL changes without a
 * page load, and the content script has to notice.
 *
 * The obvious approach — a `subtree` MutationObserver on `<body>` that checks
 * the URL whenever anything changes — is both expensive and incomplete. It
 * asks the browser to collect mutation records for every DOM change on a page
 * that churns constantly during scrolling and playback, and it still only
 * notices a navigation *if* something mutated. A `pushState` that renders on
 * the next frame is invisible until unrelated churn happens to wake it up.
 *
 * Polling `location.href` is the opposite trade: a string comparison a few
 * times a second catches every navigation regardless of what the DOM does, and
 * costs nothing measurable. `popstate` and `hashchange` are still worth
 * listening to — they make back/forward navigation feel immediate rather than
 * waiting up to one poll interval.
 *
 * A content script can't intercept the page's own `history.pushState`: content
 * scripts run in an isolated world, so patching it there only sees calls made
 * from the extension's own code, never the site's. That's why this polls
 * rather than hooking the History API.
 */

/**
 * How often to compare the URL. Fast enough that a navigation feels
 * instantaneous next to the render wait that follows it, slow enough to be
 * free.
 */
const DEFAULT_POLL_INTERVAL_MS = 400;

export interface NavigationWatcher {
  /** Stop watching and release every listener and timer */
  stop(): void;
  /** Compare the URL right now, outside the poll schedule */
  checkNow(): void;
}

export interface WatchNavigationOptions {
  pollIntervalMs?: number;
}

/**
 * Call `onNavigate` whenever the URL changes.
 *
 * Fires only on an actual change — the same URL seen twice is silent, which
 * matters because the caller does real work in response.
 *
 * @param onNavigate - Called with the new URL
 * @param options - Poll interval override, mainly for tests
 * @returns A handle for stopping the watcher
 */
export function watchNavigation(
  onNavigate: (url: string) => void,
  options: WatchNavigationOptions = {}
): NavigationWatcher {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let lastUrl = window.location.href;
  let stopped = false;

  const checkNow = (): void => {
    if (stopped) return;

    const current = window.location.href;
    if (current === lastUrl) return;

    lastUrl = current;
    onNavigate(current);
  };

  // A hidden tab can't be navigated by the user, and its URL can't change
  // without one of the events below firing when it comes back
  const poll = (): void => {
    if (document.visibilityState === "hidden") return;
    checkNow();
  };

  const timer = setInterval(poll, pollIntervalMs);

  // These make back/forward and in-page anchors feel immediate instead of
  // waiting out a poll interval
  window.addEventListener("popstate", checkNow);
  window.addEventListener("hashchange", checkNow);
  document.addEventListener("visibilitychange", checkNow);

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("popstate", checkNow);
      window.removeEventListener("hashchange", checkNow);
      document.removeEventListener("visibilitychange", checkNow);
    },
    checkNow,
  };
}
