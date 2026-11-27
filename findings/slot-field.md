# Splitting text lines and inline shader reveal (`/slot-field/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL) pairing Yousuf Soomro's [Slot Field](https://x.com/YousufSoomroDev/status/2119735673834070171) (`/elsewhere/#slot-field`) with Manoela Ilic's [Inline Hover Reveals](https://tympanus.net/Demos/InlineHoverReveals/) (`/elsewhere/#inline-hover-reveals`): `5/5` live checks pass, backing store `924x1961` (`1.81 MP`, `14 MB`), `0` errors and `0` lost contexts. Chrome 159 on Android and `npm run check:jank` (Playwright absent here) are **not verified** yet.

The question: can hovering, tapping or selecting an anchor keyword inside a live editable HTML essay cause surrounding lines to slide apart vertically, holding the word steady inside an illuminated slot while GPU pixel blocks or an optical GLSL ribbon fill the gap, with zero DOM text reflow and working links and selection?

## What was built

One `<canvas id="slot-canvas" content="drawable" layoutsubtree>` with a 32 px top and bottom dark cavity margin holding a single live `<article id="slot-article" drawable>` essay:

- **Inline interactive markup**: `<button class="anchor-word">` (`compositor`, `hit-testing`), `<a href="#anchor-*" class="anchor-word">` (`refraction`, `glyphs`), an inline `<span contenteditable="true" id="editable-line">` editable phrase, and a `Pin slot` footnote toggle (`#pin-slot`).
- **Cached line slicing**: `measureArticleAnchors()` reads `Range.getClientRects()` across each containing paragraph on mount, resize and `input`, merging inline boxes sharing the anchor's visual line band into `[lineTop, lineBottom]` with zero per-frame layout reads.
- **Two WebGL 2 modes on one `ElementGL` context**: Mode 1 (`blocks`) fills the opened cavity with quantised 8 px animated pixel blocks and edge scan ticks; Mode 2 (`ribbon`) renders an iridescent GLSL fluid and optical lens ribbon beneath the live anchor. Uploads happen only inside the canvas `paint` listener after `hasPainted === true`.
- **Spring physics and geometry**: `stepSpringState()` animates `slotGap` from `0` to `58 px` (snapping in one step under `prefers-reduced-motion: reduce`), pauses `requestAnimationFrame()` off-screen and on `visibilitychange`, keeps `updateElementGeometry()` aligned on the unshifted anchor line (`dy = 0 px`), and maps clicks on shifted outer strips via `mapCanvasYToArticleY()`.
- **Fallbacks**: switching the Route selector to `2D (9-arg slice)` swaps canvases, retires the old canvas via `window.__gfx.retire()`, and draws the three bands with 9-argument `drawElementImage()` plus an empty-clip 5-argument draw to restore the full hit box; unsupported browsers or lost contexts move `#slot-article` into plain HTML.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does `ElementGL` upload `#slot-article` via `texElementSubImage2D()` and run the 3-strip slot shader with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`gl.getError() === 0`). |
| Does pixel readback show a dark patterned gap opening above and below the unshifted anchor word? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed comparing `readPixels()` at `gap = 0` vs `gap = 48`. |
| Does the anchor `<button>` remain hit-testable via `document.elementsFromPoint()` while the slot is open? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed with `elementsFromPoint()` + `mapCanvasYToArticleY()`. |
| Does the damped spring settle cleanly and snap immediately under `prefers-reduced-motion: reduce`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed. |
| Does the visible stage still draw pixels after all fixture checks finish? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`5/5` total, `1.81 MP`, `14 MB`). |

## Things that bit

- Keeping `Range.getClientRects()` out of `requestAnimationFrame()`: reading client rects on every animation frame would force layout while text is static, so `measureArticleAnchors()` caches `lineTop`, `lineBot` and `anchorBox` only on resize, font or `input` changes.
- Reserving 32 px top and bottom canvas padding inside `#stage-frame`: sliding `aboveAnchor` up by `-29 px` and `belowAnchor` down by `+29 px` stays inside the fixed canvas height (`artH + 64 px`), so opening a slot never triggers a document layout shift or clips the first or last line.
- Restoring the hit region in the 2D 9-argument slice fallback: slicing `aboveAnchor`, `anchorLine` and `belowAnchor` with 9-argument `drawElementImage()` leaves Chromium's hit box shrunk to the last drawn band, so `render2D()` finishes with an empty-clip 5-argument `drawElementImage()` draw over the whole article.

## Not verified

- Headless Chromium 157: `npm run check:jank -- /slot-field/` and `node tools/draw-size/audit.mjs /slot-field/` (layout shift, backing-store budget, zero timed readbacks, `draw-size` audit).
- Chrome 159 on Android at 412 px wide and 2.625 DPR: touch tap and text selection inside `#slot-article`, on-screen keyboard inside `#editable-line`, scrolling past the canvas and real GPU frame rates.
- Screen reader navigation and keyboard traversal through `anchor-word` controls when slots are open vs closed.

## For the index

- Transitions, text and motion: `/slot-field/` pairs Yousuf Soomro's Slot Field with Manoela Ilic's Inline Hover Reveals on one `ElementGL` canvas, slicing cached `Range.getClientRects()` line bands across three strips so surrounding lines slide apart around an unshifted interactive anchor (`texElementSubImage2D()`, `updateElementGeometry()`, 9-arg `drawElementImage()` fallback).
