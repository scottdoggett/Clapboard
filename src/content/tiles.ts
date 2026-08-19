/**
 * Browse-Grid Tile Controls
 *
 * Puts the ratings we hold and the library controls directly under a tile's
 * artwork, so a title can be judged and marked without opening it.
 *
 * Three things shape how this is written. The grid is virtualised and
 * re-rendered constantly as you scroll, so controls have to be re-applied
 * rather than attached once; a periodic sweep over the handful of tiles
 * actually on screen is cheaper and far simpler than observing a subtree that
 * churns every frame. This injects plain DOM rather than React into someone
 * else's tree, so everything is inline-styled — no stylesheet to leak into the
 * host page, and nothing for the site's CSS to reach. And ratings cost a
 * lookup, which is why they are fetched on a dwell rather than on sight (see
 * `RATING_DWELL_MS`).
 *
 * Only the title is known when a tile is decorated, so entries are keyed by
 * normalized title. Once the lookup resolves an IMDb id the controls start
 * passing it, and the entry migrates to the id key keeping its marks (see
 * `library.ts`).
 */

import { SUPPORTED_SITES, type SupportedSite } from "@shared/constants";
import type { MessageResponse, MessageResponseMap } from "@shared/types/messages";
import type { MovieData } from "@shared/types/movie";
import {
  getTitleIndex,
  titleKey,
  updateEntry,
  type LibrarySubject,
  type Sentiment,
} from "@shared/utils/library";
import { buildTileSummary, type TileSummary } from "@shared/utils/tileSummary";
import { describeChange } from "@shared/utils/toastMessage";
import { showToast } from "./toast";

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

/**
 * How long a tile must stay on screen before its ratings are fetched.
 *
 * Every fetch is potentially a title resolution against a provider with a
 * daily quota, and sweeping a mouse across a row decorates a dozen tiles in
 * under a second. Waiting for the strip to survive this long is the difference
 * between "the pointer passed over it" and "someone stopped to look" — the
 * strip is removed the moment Netflix loses the hover, so a tile still in the
 * document here is a tile still being looked at.
 */
const RATING_DWELL_MS = 400;

const LABEL_COLOR = "#8c8c8c";
const VALUE_COLOR = "#fff";
/** Desaturated gold, the same one wins use in the detail overlay */
const WIN_COLOR = "#d4b36a";

type TileState = { watchedAt?: number; watchlistedAt?: number; sentiment?: Sentiment };

/**
 * Lookups already made this page session, keyed by normalized title.
 *
 * A row is scrolled past and back constantly, and each pass re-decorates the
 * same tiles. Caching the promise rather than the result also collapses the
 * duplicate requests that a re-hover during an in-flight lookup would make.
 * The background worker caches across sessions; this only stops us asking it
 * the same thing twice in a row.
 */
const summaries = new Map<string, Promise<MovieData | null>>();

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
      host.appendChild(
        buildTilePanel(title, () => index[titleKey(title)] ?? {}, refreshIndex)
      );
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
 * Build the whole block for one tile: ratings above, controls below.
 */
function buildTilePanel(
  title: string,
  readState: () => TileState,
  refreshIndex: () => Promise<void>
): HTMLElement {
  const panel = document.createElement("div");
  panel.style.cssText = "padding:0 14px 12px;";

  // Filled in once the lookup resolves; left empty when it doesn't, since a
  // tile is not the place to explain that a backend is unreachable
  const summarySlot = document.createElement("div");
  panel.appendChild(summarySlot);

  // What the controls know about the title. It starts as just the name and
  // gains an IMDb id when the lookup lands, so a mark made afterwards is keyed
  // by id rather than by a name that differs between services.
  const subject: LibrarySubject = { title };

  panel.appendChild(buildControls(subject, readState, refreshIndex));

  scheduleSummary(title, panel, summarySlot, subject);

  return panel;
}

/**
 * Fetch the title's ratings once it has been on screen long enough to mean
 * something, then render them.
 */
function scheduleSummary(
  title: string,
  panel: HTMLElement,
  slot: HTMLElement,
  subject: LibrarySubject
): void {
  setTimeout(() => {
    // The strip is torn out when the hover ends, so a detached panel is a tile
    // the pointer merely crossed
    if (!panel.isConnected) return;

    void fetchSummary(title).then((data) => {
      if (!panel.isConnected || !data) return;

      if (data.movie.imdbId) subject.imdbId = data.movie.imdbId;
      subject.year = data.movie.year;
      subject.posterUrl = data.movie.posterUrl;

      renderSummary(slot, buildTileSummary(data));
    });
  }, RATING_DWELL_MS);
}

/**
 * Ask the background worker for a title's data, once per title per session.
 */
function fetchSummary(title: string): Promise<MovieData | null> {
  const key = titleKey(title);
  const existing = summaries.get(key);
  if (existing) return existing;

  const request = chrome.runtime
    .sendMessage({ type: "GET_MOVIE_DATA", payload: { title } })
    .then((response: MessageResponse) =>
      response.success
        ? (response.data as MessageResponseMap["GET_MOVIE_DATA"])
        : null
    )
    .catch(() => null);

  summaries.set(key, request);
  return request;
}

/**
 * Draw the rating chips and award tally.
 */
function renderSummary(slot: HTMLElement, summary: TileSummary): void {
  if (summary.chips.length === 0 && !summary.awards) return;

  slot.textContent = "";

  if (summary.chips.length > 0) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:8px;";

    for (const chip of summary.chips) {
      row.appendChild(buildChip(chip.label, chip.value, chip.href));
    }

    slot.appendChild(row);
  }

  if (summary.awards) {
    const line = document.createElement("div");
    line.textContent = summary.awards.label;
    line.style.cssText =
      `font-size:11px;line-height:14px;margin-bottom:8px;` +
      `color:${summary.awards.wins > 0 ? WIN_COLOR : LABEL_COLOR};`;
    slot.appendChild(line);
  }
}

/**
 * One rating chip, a link where the source can be reached.
 *
 * Netflix's tiles open the title on click, so the anchor has to stop the event
 * reaching them — otherwise clicking IMDb both opens IMDb and starts playing
 * something.
 */
function buildChip(label: string, value: string, href: string | null): HTMLElement {
  const chip = document.createElement(href ? "a" : "span");
  chip.style.cssText =
    "display:inline-flex;align-items:baseline;gap:4px;padding:1px 6px;border-radius:3px;" +
    "border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.045);" +
    "font-size:11px;line-height:16px;text-decoration:none;white-space:nowrap;";

  const name = document.createElement("span");
  name.textContent = label;
  name.style.color = LABEL_COLOR;

  const score = document.createElement("span");
  score.textContent = value;
  score.style.color = VALUE_COLOR;

  chip.append(name, score);

  if (href && chip instanceof HTMLAnchorElement) {
    chip.href = href;
    chip.target = "_blank";
    chip.rel = "noopener noreferrer";
    chip.title = `${label} ${value}`;
    chip.style.cursor = "pointer";

    chip.addEventListener("click", (event) => event.stopPropagation());
    chip.addEventListener("mouseenter", () => {
      chip.style.borderColor = "rgba(255,255,255,0.4)";
    });
    chip.addEventListener("mouseleave", () => {
      chip.style.borderColor = "rgba(255,255,255,0.14)";
    });
  }

  return chip;
}

/**
 * Build the control row for one tile.
 */
function buildControls(
  subject: LibrarySubject,
  readState: () => TileState,
  refreshIndex: () => Promise<void>
): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;";

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

      // `subject` is read at click time, not captured: by now the lookup may
      // have supplied an IMDb id, which is a better key than the tile's name
      const change = toggle();

      const said = describeChange(change);
      if (said) showToast(said);

      void updateEntry({ ...subject }, change).then(async (entry) => {
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

  add("Not for me", THUMB_DOWN, () => state.sentiment === "disliked", () => ({
    sentiment: state.sentiment === "disliked" ? undefined : ("disliked" as const),
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

/**
 * The same path turned about the icon's own centre. Rotating the `<svg>` root
 * would spin it about the origin and take it off the canvas, so the rotation
 * goes on a group with an explicit centre.
 */
const THUMB_DOWN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><g transform="rotate(180 12 12)"><path d="M7 10.5v9H4.5a1 1 0 01-1-1v-7a1 1 0 011-1H7z"/><path d="M7 10.5l4.2-7.1a1 1 0 011.7 0c.4.6.5 1.4.3 2.1L12.4 9h5.3a2 2 0 011.9 2.6l-1.9 6A2 2 0 0115.8 19H7"/></g></svg>';
