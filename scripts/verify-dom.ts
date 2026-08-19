/**
 * DOM Detection Verification
 *
 * Runs the real `detectCurrentTitle` against fixture pages in jsdom.
 *
 * `verify-detection.ts` covers the pure decisions; this covers the half that
 * reads the page — the layering between live DOM and document metadata, the
 * URL gate, alt-text title treatments, and the staleness guard that stops a
 * single-page app from serving the previous title's metadata.
 *
 * What it does NOT prove is that the selectors match the live sites. The
 * fixtures are modelled on each platform's markup but written here, so a
 * selector that has drifted still passes. Checking that needs an account and a
 * browser. What this does prove is that when a selector *does* match, the
 * right thing happens — and that when none match, the fallbacks behave.
 *
 * Each fixture imports a fresh copy of dom.ts (the `?v=` suffix defeats the
 * module cache) because it captures `location.href` at module load to decide
 * whether document metadata is still trustworthy.
 *
 * The second half covers the SPA navigation watcher, which is the other piece
 * that only exists because these sites never reload.
 *
 * Run with: npm run verify:dom
 */

import { JSDOM } from "jsdom";

let failures = 0;
let fixtureCount = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

/**
 * Install a fixture page as the global document and load a fresh dom.ts
 * against it.
 */
async function loadPage(url: string, html: string) {
  const dom = new JSDOM(html, { url });
  const g = globalThis as Record<string, unknown>;

  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLImageElement = dom.window.HTMLImageElement;
  g.MutationObserver = dom.window.MutationObserver;

  const mod = await import(`@shared/utils/dom?v=${++fixtureCount}`);
  return { dom, mod };
}

/** Detect the title on a fixture page. */
async function detect(url: string, html: string) {
  const { mod } = await loadPage(url, html);
  return mod.detectCurrentTitle();
}

const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

// --- Netflix ---------------------------------------------------------------

check(
  "netflix title page reads the modal's story art",
  await detect(
    "https://www.netflix.com/title/81234567",
    `<head><title>Inception - Netflix</title>
     ${jsonLd({ "@type": "Movie", name: "Inception", datePublished: "2010-07-16" })}</head>
     <body><div data-uia="modal-motion-container-DETAIL_MODAL">
       <img class="playerModel--player__storyArt" alt="Inception">
     </div></body>`
  ),
  { title: "Inception", year: 2010, type: "movie" }
);

// The regression that started all this: a broad heading selector with no URL
// gate turned every page on the site into a title page.
// The billboard on the browse page names whatever Netflix is promoting, in
// the same markup a title page uses. Only the URL says this isn't one — so the
// fixture carries a real title, or the test would pass on the plausibility
// check and prove nothing about the gate.
check(
  "netflix browse page ignores the promoted billboard title",
  await detect(
    "https://www.netflix.com/browse",
    `<head><title>Home | Netflix</title>
     ${jsonLd({ "@type": "Movie", name: "Wednesday", datePublished: "2022" })}</head>
     <body><div data-uia="title-info"><h1 data-uia="title-info-title">Wednesday</h1></div></body>`
  ),
  null
);

check(
  "netflix search results detect nothing",
  await detect(
    "https://www.netflix.com/search?q=dune",
    `<body><div data-uia="title-info"><h1 data-uia="title-info-title">Dune</h1></div></body>`
  ),
  null
);

// Netflix opens a title in a modal over the grid, with the id in ?jbv=
check(
  "netflix jbv modal is a title page",
  await detect(
    "https://www.netflix.com/browse?jbv=81234567",
    `<body><div data-uia="modal-motion-container-DETAIL_MODAL">
       <div class="previewModal--player-titleTreatment"><img alt="The Bear"></div>
       <div data-uia="episode-list"></div>
     </div></body>`
  ),
  { title: "The Bear", year: undefined, type: "series" }
);

// --- Prime Video -----------------------------------------------------------

// The old config used a bare `h1` selector with no gate, so the storefront's
// hero carousel — which names a real title — produced a lookup on the home page
check(
  "prime video storefront ignores the hero carousel title",
  await detect(
    "https://www.primevideo.com/",
    `<head><title>Prime Video</title></head>
     <body><h1 data-automation-id="title">The Boys</h1></body>`
  ),
  null
);

check(
  "prime video detail page strips branding",
  await detect(
    "https://www.primevideo.com/detail/0GLPSNBTNU1FFRQ8B6TZL4E2SR/ref=atv_dp",
    `<head><title>Watch Dune | Prime Video</title></head>
     <body><h1 data-automation-id="title">Watch Dune | Prime Video</h1></body>`
  ),
  { title: "Dune", year: undefined, type: undefined }
);

check(
  "prime video on amazon.com is recognised",
  await detect(
    "https://www.amazon.com/gp/video/detail/B08XYZ",
    `<body><h1 data-automation-id="title">Dune</h1></body>`
  ),
  { title: "Dune", year: undefined, type: undefined }
);

// --- Disney+ ---------------------------------------------------------------

// Disney+ and Netflix render titles as logo images, not text
check(
  "disney+ reads an image title treatment's alt text",
  await detect(
    "https://www.disneyplus.com/en-ca/movies/soul/6C4rIQGwbLuT",
    `<body><div data-testid="details-page">
       <div class="title-treatment"><img alt="Soul" src="/logo.png"></div>
     </div></body>`
  ),
  { title: "Soul", year: undefined, type: "movie" }
);

check(
  "disney+ takes the series type from the path",
  await detect(
    "https://www.disneyplus.com/en-ca/series/loki/1abc",
    `<body><div data-testid="details-page">
       <h1 data-testid="details-title">Loki</h1>
     </div></body>`
  ),
  { title: "Loki", year: undefined, type: "series" }
);

check(
  "disney+ home ignores the featured title",
  await detect(
    "https://www.disneyplus.com/en-ca/home",
    `<body><div data-testid="details-page">
       <h1 data-testid="details-title">Moana 2</h1>
     </div></body>`
  ),
  null
);

// --- Crave -----------------------------------------------------------------

check(
  "crave series page",
  await detect(
    "https://www.crave.ca/en/tv-shows/succession",
    `<body><div class="program-details"><h1 class="program-title">Succession</h1></div></body>`
  ),
  { title: "Succession", year: undefined, type: "series" }
);

// --- Layering --------------------------------------------------------------

// The detail view renders asynchronously; on a freshly served document the
// metadata is a valid stand-in until it does
check(
  "falls back to JSON-LD before the view renders",
  await detect(
    "https://www.disneyplus.com/en-ca/movies/soul/6C4rIQGwbLuT",
    `<head>${jsonLd({ "@type": "Movie", name: "Soul", datePublished: "2020-12-25" })}</head>
     <body><div id="app"></div></body>`
  ),
  { title: "Soul", year: 2020, type: "movie" }
);

// A live heading rarely carries the year; JSON-LD does. The winner supplies
// the title, the rest fill in what it lacks.
check(
  "DOM title wins but takes the year from JSON-LD",
  await detect(
    "https://www.netflix.com/title/81234567",
    `<head>${jsonLd({ "@type": "TVSeries", name: "The Bear", datePublished: "2022" })}</head>
     <body><div data-uia="title-info"><h1 data-uia="title-info-title">The Bear</h1></div></body>`
  ),
  { title: "The Bear", year: 2022, type: "series" }
);

check(
  "an episode resolves to its series",
  await detect(
    "https://www.disneyplus.com/en-ca/series/the-bear/1abc",
    `<head>${jsonLd({
      "@type": "TVEpisode",
      name: "Fishes",
      partOfSeries: { "@type": "TVSeries", name: "The Bear" },
    })}</head><body><div id="app"></div></body>`
  ),
  { title: "The Bear", year: undefined, type: "series" }
);

// Only the document title is left, and it is mostly branding
check(
  "falls back to the tab title",
  await detect(
    "https://www.primevideo.com/detail/0GLPS",
    `<head><title>Watch Nomadland | Prime Video</title></head><body></body>`
  ),
  { title: "Nomadland", year: undefined, type: undefined }
);

// --- SPA staleness ---------------------------------------------------------

// The guard that matters most: these are all single-page apps, and JSON-LD is
// baked in at load. After a client-side navigation it describes the previous
// title, so it must stop being trusted.
{
  const { dom, mod } = await loadPage(
    "https://www.disneyplus.com/en-ca/movies/soul/6C4rIQGwbLuT",
    `<head>${jsonLd({ "@type": "Movie", name: "Soul", datePublished: "2020-12-25" })}</head>
     <body><div data-testid="details-page"><h1 data-testid="details-title">Soul</h1></div></body>`
  );

  check("before navigating, metadata is trusted", mod.detectCurrentTitle(), {
    title: "Soul",
    year: 2020,
    type: "movie",
  });

  // Navigate the way a streaming SPA does: URL rewritten, DOM swapped, no reload
  dom.window.history.pushState(
    {},
    "",
    "https://www.disneyplus.com/en-ca/movies/encanto/2xyz"
  );
  dom.window.document.querySelector('[data-testid="details-title"]')!.textContent =
    "Encanto";

  check(
    "after navigating, the stale year is dropped",
    mod.detectCurrentTitle(),
    { title: "Encanto", year: undefined, type: "movie" }
  );

  // With no live DOM to read, the stale metadata must not fill the gap either
  dom.window.document.querySelector('[data-testid="details-page"]')!.remove();

  check(
    "after navigating, stale metadata is not a fallback",
    mod.detectCurrentTitle(),
    null
  );
}

// --- Rejections ------------------------------------------------------------

check(
  "an unsupported site detects nothing",
  await detect("https://www.example.com/title/123", `<body><h1>Inception</h1></body>`),
  null
);

check(
  "a title page with only navigation chrome detects nothing",
  await detect(
    "https://www.netflix.com/title/81234567",
    `<body><div data-uia="title-info"><h1 data-uia="title-info-title">My List</h1></div></body>`
  ),
  null
);

// --- Supporting helpers ----------------------------------------------------

{
  const { mod } = await loadPage(
    "https://www.netflix.com/title/81234567",
    `<body>
       <div class="previewModal--container">behind</div>
       <div data-uia="modal-motion-container-DETAIL_MODAL" class="detail-modal"></div>
     </body>`
  );
  check("isOnTitlePage agrees with the gate", mod.isOnTitlePage(), true);
  // Anchors are tried in list order, not document order — the modal container
  // is listed first because it is the element the overlay should sit inside
  check(
    "overlay anchor takes the first match",
    mod.getOverlayAnchor()?.className,
    "detail-modal"
  );
}

{
  const { mod } = await loadPage(
    "https://www.netflix.com/browse",
    `<body><h1>Home</h1></body>`
  );
  check("isOnTitlePage rejects browse", mod.isOnTitlePage(), false);
  check("no anchor when nothing matches", mod.getOverlayAnchor(), null);
}

// --- Netflix, as it really is ----------------------------------------------
// Reproduced from a live page: opening a title redirects to the browse grid
// with ?jbv= and renders the film in a modal *over* it. Everything here — the
// URL, the absent og/JSON-LD, the tab title, the billboard's text, the story
// art alt — was captured from the real DOM.
{
  const realNetflix = `<head><title>The Wolf of Wall Street - Netflix</title></head>
    <body>
      <h1 class="default-ltr-iqcdef-cache-5ur8x">Home</h1>
      <!-- The billboard belongs to whatever Netflix is promoting, not to the
           modal. Its text is metadata, and reading it would show a wrong film. -->
      <div data-uia="billboard-title">Show•Documentary•2026•3 Episodes•TV-MA</div>
      <div data-uia="titleCard--container">2h 10m2015RHDA group of wily opportunists</div>
      <div data-uia="modal-motion-container-DETAIL_MODAL">
        <div class="previewModal--player-titleTreatmentWrapper">
          <img class="playerModel--player__storyArt has-smaller" alt="The Wolf of Wall Street">
        </div>
        <div data-uia="previewModal--detailsMetadata"></div>
      </div>
    </body>`;

  check(
    "netflix jbv modal reads the title from the modal, not the billboard",
    await detect("https://www.netflix.com/browse?jbv=70266676", realNetflix),
    { title: "The Wolf of Wall Street", year: undefined, type: undefined }
  );

  // The tab title is the only correct title on this page once the SPA has
  // navigated, so it must survive the staleness guard that JSON-LD is subject to
  const { dom, mod } = await loadPage(
    "https://www.netflix.com/title/70266676",
    `<head><title>The Wolf of Wall Street - Netflix</title></head><body></body>`
  );
  dom.window.history.pushState({}, "", "/browse?jbv=70266676");

  check(
    "the tab title survives an SPA navigation",
    mod.detectCurrentTitle(),
    { title: "The Wolf of Wall Street", year: undefined, type: undefined }
  );

  // ...but baked-in metadata still must not
  const stale = await loadPage(
    "https://www.netflix.com/title/1",
    `<head><title>Netflix</title>
     ${jsonLd({ "@type": "Movie", name: "Some Other Film", datePublished: "1999" })}</head>
     <body></body>`
  );
  stale.dom.window.history.pushState({}, "", "/title/2");

  check(
    "stale JSON-LD is still rejected after navigating",
    stale.mod.detectCurrentTitle(),
    null
  );
}

// --- Year and type from the modal's metadata -------------------------------
// The gap the first live run left: {title: "The Big Short", year: undefined,
// type: undefined}. Without a type, "Fargo" resolves to the 1996 film or the
// 2014 series at random; without a year, so does every remake.
{
  const withMetadata = (metaText: string) => `<head><title>Fargo - Netflix</title></head>
    <body><div data-uia="modal-motion-container-DETAIL_MODAL">
      <img class="playerModel--player__storyArt" alt="Fargo">
      <div data-uia="previewModal--detailsMetadata">${metaText}</div>
    </div></body>`;

  check(
    "reads year and film type from the modal metadata",
    await detect(
      "https://www.netflix.com/browse?jbv=1",
      withMetadata("1h 38m1996RHDA pregnant police chief investigates")
    ),
    { title: "Fargo", year: 1996, type: "movie" }
  );

  check(
    "reads year and series type from the modal metadata",
    await detect(
      "https://www.netflix.com/browse?jbv=2",
      withMetadata("5 Seasons2014TV-MAHDAn insurance salesman is drawn into")
    ),
    { title: "Fargo", year: 2014, type: "series" }
  );

  // Metadata fills a gap; it must not overrule a precise date from JSON-LD
  check(
    "JSON-LD's year takes precedence over the metadata line",
    await detect(
      "https://www.netflix.com/title/1",
      `<head><title>Fargo - Netflix</title>
       ${jsonLd({ "@type": "Movie", name: "Fargo", datePublished: "1996-03-08" })}</head>
       <body><div data-uia="modal-motion-container-DETAIL_MODAL">
         <img class="playerModel--player__storyArt" alt="Fargo">
         <div data-uia="previewModal--detailsMetadata">2015 R HD</div>
       </div></body>`
    ),
    { title: "Fargo", year: 1996, type: "movie" }
  );

  check(
    "a page with no metadata region still detects",
    await detect(
      "https://www.netflix.com/browse?jbv=3",
      `<head><title>Fargo - Netflix</title></head>
       <body><div data-uia="modal-motion-container-DETAIL_MODAL">
         <img class="playerModel--player__storyArt" alt="Fargo">
       </div></body>`
    ),
    { title: "Fargo", year: undefined, type: undefined }
  );
}

// --- Metadata fallback when the selector misses ----------------------------
// A live run still returned year: undefined, because the dedicated metadata
// selector did not match — the same way every invented Netflix selector did
// not match. The fallback reads the detail view's own opening text.
{
  check(
    "falls back to the container's opening text for the year",
    await detect(
      "https://www.netflix.com/browse?jbv=1",
      `<head><title>The Wolf of Wall Street - Netflix</title></head>
       <body><div data-uia="modal-motion-container-DETAIL_MODAL">
         <img class="playerModel--player__storyArt" alt="The Wolf of Wall Street">
         <div class="some-markup-i-did-not-anticipate">3h2013RHD</div>
       </div></body>`
    ),
    { title: "The Wolf of Wall Street", year: 2013, type: "movie" }
  );

  // The synopsis must not be able to override the facts line, which is why the
  // fallback only reads the opening stretch
  check(
    "a year deep in the synopsis is not read",
    await detect(
      "https://www.netflix.com/browse?jbv=2",
      `<head><title>Some Film - Netflix</title></head>
       <body><div data-uia="modal-motion-container-DETAIL_MODAL">
         <img class="playerModel--player__storyArt" alt="Some Film">
         <div>${"A sprawling drama. ".repeat(20)} Set in 1929 during the crash.</div>
       </div></body>`
    ),
    { title: "Some Film", year: undefined, type: undefined }
  );

  // The dedicated selector still wins when it does match
  check(
    "a matching metadata selector takes precedence over the fallback",
    await detect(
      "https://www.netflix.com/browse?jbv=3",
      `<head><title>Some Film - Netflix</title></head>
       <body><div data-uia="modal-motion-container-DETAIL_MODAL">
         <img class="playerModel--player__storyArt" alt="Some Film">
         <div data-uia="previewModal--detailsMetadata">1h 30m1999PG</div>
         <div>2020 something else entirely</div>
       </div></body>`
    ),
    { title: "Some Film", year: 1999, type: "movie" }
  );
}

// --- Waiting for a late-rendering title ------------------------------------
// The bug this replaced: Netflix inserts its modal container immediately and
// fills in the story art afterwards, so waiting for the container then trying
// once gave up while the title was still milliseconds away.
{
  const { dom, mod } = await loadPage(
    "https://www.netflix.com/browse?jbv=70266676",
    `<head><title>Netflix</title></head>
     <body><div data-uia="modal-motion-container-DETAIL_MODAL"></div></body>`
  );

  // Container is present, title is not — the old check would stop here
  check("nothing readable yet", mod.detectCurrentTitle(), null);

  const pending = mod.waitForTitle(2000, 20);

  // The image lands a few polls later, as it does on the real site
  setTimeout(() => {
    const img = dom.window.document.createElement("img");
    img.className = "playerModel--player__storyArt";
    img.setAttribute("alt", "The Big Short");
    dom.window.document
      .querySelector('[data-uia="modal-motion-container-DETAIL_MODAL"]')!
      .appendChild(img);
  }, 60);

  check("waits for the title to arrive", await pending, {
    title: "The Big Short",
    year: undefined,
    type: undefined,
  });
}

{
  // Give up rather than poll a page the user has navigated away from
  const { dom, mod } = await loadPage(
    "https://www.netflix.com/browse?jbv=70266676",
    `<head><title>Netflix</title></head><body></body>`
  );

  const pending = mod.waitForTitle(3000, 20);
  setTimeout(() => dom.window.history.pushState({}, "", "/browse"), 40);

  const started = Date.now();
  check("stops polling once it is no longer a title page", await pending, null);
  check("...and returns promptly rather than waiting out the timeout", Date.now() - started < 1500, true);
}

{
  const { mod } = await loadPage(
    "https://www.netflix.com/browse?jbv=1",
    `<head><title>Netflix</title></head><body></body>`
  );
  check("times out when nothing ever renders", await mod.waitForTitle(120, 20), null);
}

// --- SPA navigation watching -----------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Set up a jsdom page and start a watcher over it with a fast poll. */
async function watchPage(url: string) {
  const dom = new JSDOM("<body></body>", { url });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;

  const seen: string[] = [];
  const { watchNavigation } = await import(`../src/content/navigation?v=${++fixtureCount}`);
  const watcher = watchNavigation((next: string) => seen.push(next), {
    pollIntervalMs: 10,
  });

  return { dom, seen, watcher };
}

{
  // The case the old MutationObserver missed outright: a pushState that
  // doesn't mutate the DOM was invisible until unrelated churn woke it up
  const { dom, seen, watcher } = await watchPage("https://www.netflix.com/browse");

  dom.window.history.pushState({}, "", "/title/81234567");
  await sleep(40);

  check("a pushState with no DOM change is caught", seen, [
    "https://www.netflix.com/title/81234567",
  ]);

  // Real navigation, real work in response — the same URL must not re-fire
  await sleep(40);
  check("a settled URL does not re-fire", seen.length, 1);

  dom.window.history.pushState({}, "", "/title/99999999");
  await sleep(40);
  check("a second navigation fires again", seen.length, 2);

  watcher.stop();
  dom.window.history.pushState({}, "", "/title/11111111");
  await sleep(40);
  check("a stopped watcher goes quiet", seen.length, 2);
}

{
  // Back/forward shouldn't wait out a poll interval
  const { dom, seen, watcher } = await watchPage("https://www.netflix.com/title/1");

  dom.window.history.pushState({}, "", "/title/2");
  dom.window.dispatchEvent(new dom.window.Event("popstate"));

  check("popstate is handled without waiting for the poll", seen, [
    "https://www.netflix.com/title/2",
  ]);
  watcher.stop();
}

{
  // A hidden tab can't be navigated by the user; polling it is wasted work,
  // but the change must not be lost when it comes back
  const { dom, seen, watcher } = await watchPage("https://www.netflix.com/browse");

  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });

  dom.window.history.pushState({}, "", "/title/81234567");
  await sleep(40);
  check("a hidden tab is not polled", seen.length, 0);

  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));

  check("becoming visible catches up immediately", seen, [
    "https://www.netflix.com/title/81234567",
  ]);
  watcher.stop();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
