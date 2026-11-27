# Luminous sweep spreadsheet reveal (`/sheet-reveal/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL): `5/5` live checks passed, backing store `924x977` (`0.90 MP`, `7.4 MB` across 1 WebGL + 1 2D context), `0` errors and `0` lost contexts. Chrome 159 on Android and `npm run check:jank` (Playwright absent here) stay **not verified**.

The question: when a live HTML `<table>` spreadsheet populates from an empty skeleton or reorders on a sort, can one `ElementGL` WebGL 2 canvas sweep an upward band of blurred refracted light across the cells while keeping inputs, sort buttons and totals live right behind the wavefront?

## What was built

One `<canvas id="sheet-canvas" content="drawable" layoutsubtree>` inside `.sheet-viewport` (`width: min(640px, 100%)`, fixed `420 px` height, no `dvh`, under `2.4 MP` at `2.625` DPR on a `412 px` phone) holding one `<div id="sheet-card" drawable>` spreadsheet:

- **Semantic `<table>` inside `#sheet-card`**: clickable column sort headers (`Item`, `Units`, `Rate`, `Total`), six rows with decimal `<input type="number" inputmode="decimal">` unit cells, formatted GBP row totals and a live `<tfoot>` `<output>` grand total.
- **Luminous sweep shader (`SHEET_FRAG`)**: renders either a grid-aligned shimmering skeleton (`uBeforeMode = 0`) or a captured offscreen FBO snapshot (`uBeforeMode = 1`) above the upward-moving wavefront, applies a 7-tap directional Gaussian blur with vertical lens refraction and RGB chromatic dispersion inside the wave band, illuminates grid hairlines along a warm gold and cyan crest, and reveals crisp 1:1 live DOM below.
- **Pre-mutation FBO capture**: before sorting rows with `moveBefore()`, populating a preset or clearing to an empty skeleton, `captureSnapshot()` draws the current `texElementSubImage2D()` texture into an offscreen RGBA8 framebuffer on the same `ElementGL` context with `gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0)` so Y orientation matches without vertical flipping or CPU readback.
- **Scrubbing and reduced motion**: external controls let visitors replay the sweep, switch presets, clear to a skeleton, freeze the wavefront at `0%` to `100%` while editing revealed cells below the line, adjust wave width (`40 px` to `160 px`) or toggle reduced motion.
- **Fallbacks**: 5-argument `drawElementImage()` with a clip region and bright gradient in 2D, and plain-HTML extraction of `#sheet-card` when the API is absent or the context is lost.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does `ElementGL` upload the live `<table>` via `texElementSubImage2D()` and render skeleton top, luminous crest and revealed bottom with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`gl.getError() === 0`). |
| Does pre-sort FBO snapshot capture keep Y orientation unflipped? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed via `readPixels()`. |
| Do `moveBefore()` sorting and editing a cell `<input>` update row order and `<tfoot>` total cleanly? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed. |
| Does `updateElementGeometry()` keep sort buttons and `<input>` fields clickable mid-sweep? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`elementsFromPoint()` hit both sort button and `<input>`). |
| Does the visible stage remain drawn after all fixture checks finish? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`5/5` total, `0.90 MP`, `7.4 MB`). |

## Things that bit

- **Matching FBO Y-orientation with `texElementSubImage2D()`**: Chromium uploads row 0 (top of the element) to texture coordinate `v = 0`, whereas `ElementGL.rect()` flips Y when drawing to the default framebuffer. Writing into `prevFbo` with `gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0)` and `vUv = aPos` puts row 0 of the DOM texture into row 0 of `prevFbo.tex`, matching `uTex` directly in `SHEET_FRAG`.
- **Avoiding a one-frame reveal flash before upload on sort**: re-ordering `<tbody>` rows with `moveBefore()` raises a `paint` event asynchronously. Setting `state.pendingUpload = true` before mutation holds `progress` at `0` (displaying `prevFbo`) until the `'paint'` listener finishes `stage.upload(sheetCard)`.
- **Fitting 4 numeric spreadsheet columns in `352 px` on a `412 px` phone**: hiding WebKit number spinners (`-webkit-appearance: none`) and using `table-layout: fixed` with compact `68 px` / `62 px` / `80 px` numeric tracks under `620 px` keeps all 6 rows, sort icons and `£` totals on single lines with zero horizontal scroll.

## Not verified

- Headless Chromium 157 and `npm run check:jank -- /sheet-reveal/` / `node tools/draw-size/audit.mjs /sheet-reveal/`.
- Chrome 159 on Android at `412 px` wide and `2.625` DPR: real GPU frame rate during sweeps, touch scrubbing on the wavefront slider, tapping `<input type="number" inputmode="decimal">` cells while frozen mid-sweep and on-screen keyboard behaviour.

## For the index

- Transitions, text and motion: `/sheet-reveal/` rebuilds Noman Ijaz's glimm Spreadsheet Transition (`ElementGL` WebGL 2 canvas, grid-aligned skeleton shimmer, offscreen FBO pre-sort capture, chromatic blur wavefront, `updateElementGeometry()` hit-box sync on a live `<table>`).
