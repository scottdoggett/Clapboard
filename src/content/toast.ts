/**
 * Confirmation Toast
 *
 * A small card that slides up when a title is marked, so a click on a circular
 * outline button produces something more than a slightly different circular
 * outline button.
 *
 * It lives in **its own shadow root on `document.body`**, not inside the
 * overlay's. Three reasons, and all three rule out the alternative:
 *
 * - Both callers need it. The overlay is React inside one shadow root; the
 *   browse tiles are plain DOM spliced into Netflix's own tree. A toast owned
 *   by either one is unreachable from the other.
 * - The overlay's root is spliced into Netflix's layout and gets torn out on a
 *   re-render (`reattachIfDetached` puts it back). A toast inside it would
 *   vanish mid-animation.
 * - It has to sit above everything, including Netflix's own modal, which a
 *   node nested inside that modal's subtree cannot do at any z-index.
 *
 * It is plain DOM and inline-styled for the same reason the tile controls are:
 * nothing to leak into the host page, and nothing of the page's for it to
 * inherit.
 */

/** How long a message stays up before fading. */
const HOLD_MS = 2000;

/** Slide and fade duration. */
const FADE_MS = 180;

/** Above Netflix's own modal, which is the highest thing on the page. */
const Z_INDEX = "2147483647";

interface ToastElements {
  host: HTMLElement;
  card: HTMLElement;
  text: HTMLElement;
}

let elements: ToastElements | null = null;
let hideTimer: number | undefined;
let removeTimer: number | undefined;

/**
 * Show a confirmation.
 *
 * Repeated calls reuse the one card and reset its timer rather than stacking:
 * toggling three tiles quickly should read as three confirmations in sequence,
 * not build a column of cards over the page.
 *
 * @param message - What to say, already worded by `describeChange`
 */
export function showToast(message: string): void {
  if (!document.body) return;

  const { card, text } = ensureElements();

  text.textContent = message;

  window.clearTimeout(hideTimer);
  window.clearTimeout(removeTimer);

  // Force a reflow before the transition, or setting both the starting and
  // ending styles in one frame animates nothing
  card.style.transition = "none";
  card.style.opacity = "0";
  card.style.transform = reducedMotion() ? "none" : "translateY(8px)";
  void card.offsetHeight;

  card.style.transition = `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`;
  card.style.opacity = "1";
  card.style.transform = "none";

  hideTimer = window.setTimeout(() => {
    card.style.opacity = "0";
    card.style.transform = reducedMotion() ? "none" : "translateY(8px)";

    // Taken off the page rather than left invisible, so nothing of ours sits
    // over the site between confirmations
    removeTimer = window.setTimeout(dismissToast, FADE_MS);
  }, HOLD_MS);
}

/**
 * Take the toast down.
 *
 * Deliberately not wired into `unmountOverlay`: that runs on every SPA
 * navigation, and marking a title and immediately clicking away is a normal
 * thing to do. The confirmation should finish either way — it removes itself
 * two seconds later regardless of what the page did in the meantime.
 */
function dismissToast(): void {
  window.clearTimeout(hideTimer);
  window.clearTimeout(removeTimer);

  elements?.host.remove();
  elements = null;
}

/**
 * Someone who has asked the system for less movement gets the fade without the
 * slide. The confirmation is the message, not the animation.
 */
function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Build the card, or re-attach the one already built.
 */
function ensureElements(): ToastElements {
  if (elements && elements.host.isConnected) return elements;

  const host = document.createElement("div");
  host.setAttribute("data-clapboard-toast", "");
  host.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:" +
    Z_INDEX +
    ";display:flex;justify-content:center;pointer-events:none;";

  // `all: initial` for the same reason the overlay uses it — the page's CSS
  // must not reach a card that sits over the page's own content
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = ":host { all: initial; }";
  shadow.appendChild(style);

  const card = document.createElement("div");
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.style.cssText =
    "display:flex;align-items:center;gap:10px;margin:0 0 40px;padding:11px 16px;" +
    "border-radius:4px;background:rgba(24,24,24,0.96);" +
    "border:1px solid rgba(255,255,255,0.14);" +
    "box-shadow:0 6px 20px rgba(0,0,0,0.55);" +
    "color:#fff;font-size:14px;line-height:18px;opacity:0;" +
    'font-family:"Netflix Sans","Helvetica Neue",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

  const mark = document.createElement("span");
  mark.style.cssText = "display:flex;flex-shrink:0;color:#d2d2d2;";
  mark.innerHTML = CLAPPERBOARD;

  const text = document.createElement("span");

  card.append(mark, text);
  shadow.appendChild(card);
  document.body.appendChild(host);

  elements = { host, card, text };
  return elements;
}

/**
 * The Clapboard mark, drawn inline.
 *
 * Inline rather than loaded from the extension's icons, which would need the
 * file adding to `web_accessible_resources` and a `chrome.runtime.getURL` — a
 * lot of plumbing for sixteen pixels.
 */
const CLAPPERBOARD =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 9.5h18V19a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 19V9.5z"/>' +
  '<path d="M3.5 9.5l-.9-3.1a1 1 0 01.7-1.24l14.5-3.9a1 1 0 011.22.7l.88 3.1L3.5 9.5z"/>' +
  '<path d="M8.2 8.2L6.6 3.6M13.2 6.9L11.6 2.3M18.2 5.5l-1.6-4.6"/>' +
  "</svg>";
