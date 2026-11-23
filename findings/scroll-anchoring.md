# Scroll anchoring and drawable canvases (`/shared/context-guard.js` point 15, `tools/scroll-anchor/audit.mjs`)

Measured in C157 (headless Chromium 157.0.8103.78, software rendering) on 2026-11-23, at 412 px wide with emulated touch and device scale factor 2.625. Nothing here has been run on a phone.

The question: a reader reported that `/conveyor/` scrolled the page by itself while its belt moved, and `overflow-anchor: none` on that canvas fixed it. Which other pages do the same, and can one shared rule cover them?

The cause: `getBoundingClientRect()` reports a drawable child of a canvas where it was last drawn or where `updateElementGeometry()` last put it. Scroll anchoring picks an element near the top of the screen as its anchor and changes the page's scroll position to keep that element still. When the top of a drawable canvas is at or above the top of the screen, the anchor can be one of its children. If the canvas moves that child on each frame, the page scrolls on each frame.

`node tools/scroll-anchor/audit.mjs` loads each page, and for each drawable canvas (the first 8, shadow roots included) puts the top of the canvas 60 px above the top of the screen, then half the canvas above it, touches nothing, and counts the page's scroll events for 2 s.

| Experiment | Result | Why |
|---|---|---|
| All 172 pages with no shared rule | 7 pages scrolled by themselves, 165 did not | Only movement that starts by itself is found. See "Not verified". |
| `/motion-capture/`, the canvas of `<dom-rewind>` | 100 scroll events, the page moved over 43 px | |
| `/media-tiles/`, `#svgCanvas` | 61 events, 25 px | |
| `/element-ideas/`, `#calloutCanvas` | 55 events, 21 px | |
| `/animated-images/`, `#tilesCanvas` | 17 events, 13 px | |
| `/blocked/`, `#popoverCanvas` | 15 events, 2 px | |
| `/offscreen/`, the canvas of `<canvas-slot>` | 12 events, 5 px | |
| `/translate-lens/`, `#board` | 9 events, 5 px | |
| `/conveyor/` with its motor on (driven by `tools/conveyor/check.mjs`, before its own fix) | 87 events in 2.5 s, 258 px | The audit does not press the motor button, so it did not find this page. |
| The five light-DOM hits with `canvas { overflow-anchor: none }` added to the document | 0 events on each | `overflow-anchor: none` leaves the canvas and everything in it out of anchor selection. |
| `/motion-capture/` and `/offscreen/` with the same rule in the document only | still 98 and 12 events | Their canvases are in shadow roots, which a document style does not reach. |
| The same two with the rule adopted by every shadow root | 0 events | |
| All 172 pages with the rule added by the guard | 172 of 172 held still | |

The fix is in `/shared/context-guard.js`, because `nav.js` loads it on every page before any canvas is made. It makes one style sheet with `canvas[layoutsubtree], canvas[content="drawable"] { overflow-anchor: none }` and adopts it in the document, in every shadow root at `attachShadow()`, and again in the root of a drawable canvas when its context is made (for a declarative shadow root, or a root whose `adoptedStyleSheets` were replaced). `data-gfx-raw` on a canvas keeps it out. `node tools/gfx/test-guard.mjs` has a case for it (16 of 16 pass).

## Things that bit

- A check with the whole canvas on screen finds nothing: the anchor is then an element above the canvas. `check:jank` loads a page and does not scroll it, so it did not find any of these.
- `/three-form/` found the same thing on 2026-11-20 for one focused text field, and 12 files of pages and libraries had their own `overflow-anchor: none`. It was recorded as a fact about one page and not as a rule.
- A style added to the document does not reach a canvas in a shadow root. Ten files in `public/lib/` make a drawable canvas in one.

## Not verified

- Chrome 159 on Android. To verify on `/conveyor/`: start the motor, scroll until the top roller is off the top of the screen, and lift the finger. The page should stay where it is.
- Pages that move hit boxes only while something is dragged, played or pressed. The audit touches nothing. The rule covers them, but it was not measured that they scrolled before it.
- A drawable canvas inside an iframe that does not load `nav.js` does not get the rule.
- Whether leaving the canvas out of anchoring makes a page jump when content above the canvas changes height while the canvas fills the screen. The browser then has no anchor inside the canvas and picks an element after it, or none.

## For the index

- Layout: a drawable child that is moved on each frame can become the page's scroll anchor, and the page then scrolls by itself. `overflow-anchor: none` on the canvas stops it. The guard sets it for every drawable canvas. C157, 7 of 172 pages measured.
- Friction log: this belongs in `/friction/` as an entry of kind "as built", area "Layout", beside `client-rects-follow-draw`. Not added here because the page's counts are written in three files.

## API requests

- The explainer could say that the client rectangles of a drawn element take part in scroll anchoring, or leave the children of a drawable canvas out of anchor selection.
