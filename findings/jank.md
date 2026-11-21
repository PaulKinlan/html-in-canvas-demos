# Pages that hold still (`npm run check:jank`, `tools/jank/`)

On a phone every demo jumped, flashed or scrolled itself while loading. Measured on 2026-11-20 with Chromium 157 driven over the DevTools Protocol as a phone (412 px wide, real device scale factor 2.625, touch, CPU slowed 4x), touching nothing from navigation until the page's live checks finished plus three seconds: layout-shift entries with their sources, every scroll and focus the page did by itself with the line of code that did it, canvas backing-store writes, long tasks, a trace for layout counts, and every compositor frame from a screencast compared with the ones before it.

Before, on `main`: 2 of 28 pages held still. The median page shifted its layout by 0.27 (0.1 is the usual "good" limit, the worst was 1.79), 13 pages scrolled themselves (up to 11,029 px on `/capture/`), 12 moved focus, and the 28 pages spent 279 seconds in long tasks between them.

The causes, in the order they hit:

- **The menu bar arrived after first paint.** `nav.js` waited for `demos.js` before inserting itself, so every page moved down 53 px (0.07 of shift on every page, 0.42 on `/remote/`). The bar now goes in at its final height the moment the script runs and the menu is filled in later.
- **Demos were built after first paint.** Module scripts run after parsing, and most pages fill the status banner, size the stage and build tiles from them. Whether the browser painted in between was a race, which is why the same page measured 0 on one run and 0.37 on the next, and why a phone on a real network loses it more often. `nav.js` now keeps the body below the menu unpainted until `DOMContentLoaded` and until the page height has been the same for three frames (capped at 0.8 s, and 3 s in all). This is `blocking="render"` done by hand, because that attribute only works in `<head>`. It uses `opacity: 0`, not `visibility: hidden`: hidden canvases get no paint events and `elementFromPoint()` skips them, which made live checks that start early fail. Shift at load is now 0 on every page but two.
- **Live checks drove the visible demo.** They called `scrollIntoView()`, `scrollTo()` and `focus()`, flew the board's camera about and rebuilt canvases in front of the reader: `/board/` called `scrollIntoView()` 34 times in 15 seconds. A check that scrolls down and back inside one task is invisible; the same check with an `await` in the middle is a jump, twice.
- **Moving the checks to in-flow fixtures traded scrolling for layout shift.** After the first round of fixes `/lens/` stopped scrolling but shifted by 1.28 and `/slot-effects/` by 1.40, because each fixture was inserted above the results and removed again. Fixtures have to be out of flow (fixed or absolute) or in a hidden copy of the page, as the 3D pages do.
- **A tab crash: opacity around a canvas, inside an iframe that is drawn into a canvas.** In Chromium 157, `/board/` crashed the tab within 300 ms of opening once the slot page (a tile on the board) put its test fixtures in a fixed box with `opacity: .02`. Any opacity effect around a drawable canvas inside a canvas-drawn iframe does it: holding the framed page's first paint with `opacity: 0` crashed the same way, `visibility: hidden` did not. So a demo page shown as a tile does not run its own checks (the board loads it with `?autochecks=0`, which also saves seconds of main thread) and `nav.js` does not hold the first paint of a framed page.
- **`dvh` on a canvas stage.** `/board/` sized its stage with `100dvh`, so every time the phone's URL bar hid or showed, the stage changed height, everything below it moved and the canvas backing store was reallocated. It uses `svh` now. Assigning `canvas.width` clears the canvas even when the value is unchanged, so the libraries only assign on a real change.

What is left is on the pages themselves. Seven pages still have checks that scroll or focus the visible page, shift the layout with in-flow fixtures, pin a panel over it or blank a canvas: `/cross-origin/`, `/remote/`, `/portal/`, `/lens/`, `/shader-css/`, `/slot-effects/` and `/physical/`. They are listed in `CHECKS_WAIT_FOR_TAP` in `shared/support.js`: there the checks wait for a "Run these checks" button, so opening the page never moves it. A page comes off the list when `npm run check:jank -- --checks /page/` passes. `/transitions/`, `/time-scrubber/` and `/particles/` have their own rule (checks start when the reader scrolls to them). `runTests()` also waits while someone is scrolling or typing, and puts scroll position and focus back if a check moved them and nobody touched the page.

After: all 28 pages hold still on load (this includes the per-page fixes that landed the same day in PRs #23 to #28). Across the 28 pages: median layout shift 0.27 to 0, worst 1.79 to 0.07; pages that scroll themselves 13 to 0; scroll and focus calls on the visible page 115 and 30 to 0 and 1; frames that flash 26 to 0; frames with a blanked canvas 446 to 1; layouts 4,284 to 2,155; time in long tasks 279 s to 116 s. Four small things are recorded as known in `tools/jank/allow.json` rather than fixed: `/transports/` grows its source list a row at a time (0.07), `/slot-view/` moves a paragraph when its first picture arrives (0.04), one `/shader-css/` tile is blank for a single frame, and one `/slot/` check focuses an input in its fixture.

| Page | Before: shift / scrolled px / focus moves / flashes / blank frames | After | Live checks on load |
|---|---|---|---|
| `/` | 0.00 / 0 / 0 / 0 / 0 (0.37 on other runs) | 0.00 / 0 / 0 / 0 / 0 | none |
| `/slot/` | 0.07 / 2387 / 1 / 3 / 0 | 0.00 / 0 / 1 / 0 / 0 | run |
| `/slot-bare/` | 0.11 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/slot-bare/plain.html` | 0.07 / 0 / 0 / 0 / 2 | 0.00 / 0 / 0 / 0 / 0 | none |
| `/offscreen/` | 0.14 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/cross-tab/` | 0.11 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/cross-origin/` | 0.20 / 994 / 0 / 2 / 0 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/transports/` | 0.32 / 0 / 0 / 0 / 0 | 0.07 / 0 / 0 / 0 / 0 | run |
| `/tear-off/` | 0.56 / 0 / 2 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/remote/` | 0.58 / 0 / 4 / 0 / 2 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/embed/` | 0.25 / 1519 / 3 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/support/` | 0.40 / 0 / 1 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/slot-view/` | 0.37 / 0 / 0 / 0 / 0 | 0.04 / 0 / 0 / 0 / 0 | wait at the consent prompt |
| `/pip/` | 0.00 / 0 / 0 / 0 / 0 (0.39 on other runs) | 0.00 / 0 / 0 / 0 / 0 | run |
| `/portal/` | 1.34 / 3758 / 0 / 0 / 1 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/lens/` | 0.70 / 2814 / 0 / 0 / 1 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/shader-css/` | 1.28 / 3160 / 0 / 0 / 44 | 0.00 / 0 / 0 / 0 / 1 | wait for a tap |
| `/slot-effects/` | 0.27 / 5279 / 1 / 0 / 4 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/physical/` | 1.52 / 3467 / 0 / 0 / 5 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/transitions/` | 0.23 / 0 / 2 / 8 / 0 | 0.00 / 0 / 0 / 0 / 0 | start when scrolled to |
| `/time-scrubber/` | 0.29 / 0 / 0 / 0 / 365 | 0.00 / 0 / 0 / 0 / 0 | start when scrolled to |
| `/particles/` | 0.74 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | start when scrolled to |
| `/three-form/` | 0.12 / 338 / 7 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run, on a hidden copy |
| `/board/` | 0.11 / 470 / 2 / 6 / 0 | 0.00 / 0 / 0 / 0 / 0 | run, on a hidden copy |
| `/xr/` | 0.06 / 493 / 3 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run, on a hidden copy |
| `/a11y/` | 0.63 / 4159 / 3 / 4 / 0 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap on touch devices |
| `/capture/` | 1.79 / 11029 / 1 / 3 / 22 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap on touch devices |
| `/perf/` | 0.11 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | none |

With their checks forced to run on load (`--checks`), the seven gated pages still fail: `/cross-origin/` scrolls 990 px, `/remote/` moves focus four times, `/portal/`, `/lens/`, `/shader-css/` and `/physical/` shift by 0.25 to 1.03 as the fixture panel `#check-bench` grows and shrinks, and `/slot-effects/` shifts by 1.40 and covers more than 40% of the screen with that panel.

Not measured here, because it needs a real phone: the URL bar is simulated by changing the window height, which also changes `vh` (a phone does not), there is no real GPU so a lost-context white box cannot happen, and touch scrolling while checks run is not exercised.
