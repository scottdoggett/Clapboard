/**
 * Browse-Grid Tile Controls
 *
 * Lets a title be marked watched, liked or watchlisted straight from the
 * browse grid, without opening it.
 *
 * Two things shape how this is written. The grid is virtualised and
 * re-rendered constantly as you scroll, so controls have to be re-applied
 * rather than attached once; a periodic sweep over the handful of tiles
 * actually on screen is cheaper and far simpler than observing a subtree that
 * churns every frame. And this injects plain DOM rather than React into
 * someone else's tree, so everything is inline-styled — no stylesheet to leak
 * into the host page, and nothing for the site's CSS to reach.
 *
 * Only the title is known here, so entries are keyed by normalized title. Once
 * the same film is opened and its lookup resolves, the entry migrates to its
 * IMDb id and keeps the marks (see `library.ts`).
 */

import { SUPPORTED_SITES, type SupportedSite } from "@shared/constants";
import {
  getTitleIndex,
  titleKey,
  updateEntry,
  type Sentiment,
} from "@shared/utils/library";

/** Marks a tile as already decorated. */
const MARKER = "data-clapboard-tile";

/**
 * How often to sweep for undecorated tiles.
 *
 * Netflix only renders a tile's metadata strip while it is hovered, so a tile
 * usually becomes decoratable at the moment someone reaches for it — this has
 * to be quick enough to beat the hand, and cheap enough to run forever.
 */
const SWEEP_MS = 500;

type TileState = { watchedAt?: number; watchlistedAt?: number; sentiment?: Sentiment };

/**
 * Start decorating browse tiles.
 *
 * @param site - The detected platform
 * @returns A function that stops the sweep
 */
export function startTileControls(site: SupportedSite): () => void {
  const config = SUPPORTED_SITES[site].selectors.tiles;
  if (!config) return () => undefined;

  let index: Record<string, TileState> = {};
  let stopped = false;

  const refreshIndex = async (): Promise<void> => {
    index = await getTitleIndex();
  };

  void refreshIndex();

  const sweep = (): void => {
    if (stopped || document.visibilityState === "hidden") return;

    for (const tile of document.querySelectorAll(config.container)) {
      const host = tile.querySelector(config.controls);
      if (!host || host.hasAttribute(MARKER)) continue;

      const title = readTitle(tile, config.title);
      if (!title) continue;

      host.setAttribute(MARKER, "1");
      host.appendChild(buildControls(title, () => index[titleKey(title)] ?? {}, refreshIndex));
    }
  };

  const timer = setInterval(sweep, SWEEP_MS);
  sweep();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Read a tile's title, preferring an image's alt text — the grid renders
 * titles as artwork, so there is usually no text to read.
 */
function readTitle(tile: Element, selector: string): string | null {
  const element = tile.querySelector(selector);
  if (!element) return null;

  const value =
    element instanceof HTMLImageElement
      ? element.alt
      : (element.textContent ?? "");

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length < 150 ? trimmed : null;
}

/**
 * Build the control row for one tile.
 */
function buildControls(
  title: string,
  readState: () => TileState,
  refreshIndex: () => Promise<void>
): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText =
    "display:flex;gap:6px;align-items:center;padding:0 14px 12px;";

  let state = readState();

  const buttons: Array<{ element: HTMLButtonElement; isActive: () => boolean }> = [];

  const paint = (): void => {
    for (const { element, isActive } of buttons) {
      const active = isActive();
      element.style.background = active ? "rgba(255,255,255,0.95)" : "rgba(42,42,42,0.6)";
      element.style.borderColor = active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)";
      element.style.color = active ? "#141414" : "#fff";
      element.setAttribute("aria-pressed", String(active));
    }
  };

  const add = (
    label: string,
    icon: string,
    isActive: () => boolean,
    toggle: () => Parameters<typeof updateEntry>[1]
  ): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    button.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;" +
      "border-radius:50%;border:2px solid rgba(255,255,255,0.5);background:rgba(42,42,42,0.6);" +
      "color:#fff;cursor:pointer;padding:0;flex-shrink:0;";

    button.addEventListener("click", (event) => {
      // The tile itself opens the title on click; marking it must not
      event.preventDefault();
      event.stopPropagation();

      void updateEntry({ title }, toggle()).then(async (entry) => {
        state = {
          watchedAt: entry?.watchedAt,
          watchlistedAt: entry?.watchlistedAt,
          sentiment: entry?.sentiment,
        };
        paint();
        await refreshIndex();
      });
    });

    buttons.push({ element: button, isActive });
    row.appendChild(button);
  };

  add("Mark as watched", CHECK, () => state.watchedAt !== undefined, () => ({
    watchedAt: state.watchedAt === undefined ? Date.now() : undefined,
  }));

  add("Add to watchlist", PLUS, () => state.watchlistedAt !== undefined, () => ({
    watchlistedAt: state.watchlistedAt === undefined ? Date.now() : undefined,
  }));

  add("I liked this", THUMB, () => state.sentiment === "liked", () => ({
    sentiment: state.sentiment === "liked" ? undefined : ("liked" as const),
  }));

  paint();
  return row;
}

const CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>';

const PLUS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

const THUMB =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 10.5v9H4.5a1 1 0 01-1-1v-7a1 1 0 011-1H7z"/><path d="M7 10.5l4.2-7.1a1 1 0 011.7 0c.4.6.5 1.4.3 2.1L12.4 9h5.3a2 2 0 011.9 2.6l-1.9 6A2 2 0 0115.8 19H7"/></svg>';
