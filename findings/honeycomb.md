# Honeycomb fisheye launcher (`/honeycomb/`)

Status on 2026-11-27: static checks passed (`node --check public/honeycomb/honeycomb.js`, `node tools/gfx/check.mjs` with 0 problems, and `node tools/writing/check.mjs --strict /honeycomb/` with 0 errors and 0 warnings). Live browser verification in headless Chromium 157 (C157) and Chrome 159 on Android (A159) is not verified yet.

| Question | Result | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context uploading 25 `drawable` mini-control tiles via `texElementSubImage2D()` | not verified | One `ElementGL` instance holds the 25 textures alongside two helper passes on `stage.gl` (the OLED watch dial + bezel and the optional hit-box wireframe). Covered by live check 1 (`gl.getError() === 0` across three uploaded tiles on `testStage()`). |
| Uploading only changed tiles via `paintEvent.changedElements` | not verified | Dragging across the watch face and running the release spring keep `texElementSubImage2D()` uploads at 0 per frame once all 25 tiles have uploaded; only tiles named in `changedElements` or marked dirty re-upload. |
| Spherical dome fisheye projection across a 25-tile concentric hex rosette (`1 + 6 + 12 + 6`) | not verified | Axial coordinates `(q, r)` map through `theta = (d / 2.90) * (pi / 2)`, giving centre scale `1.00`, Ring 1 scale `0.86`, Ring 2 scale `0.47` to `0.59`, and Ring 3 rim scale `0.14`. Covered by live check 2 (`projectHexTile()` symmetry and pan check). |
| `updateElementGeometry()` scaled by `geometryUnit()` keeping scaled buttons, switches and text inputs clickable | not verified | Applies a conformal translation and scale `DOMMatrix` per tile and flips `tile.dataset.hitTick` only when the quantized screen rect changes. Covered by live check 3 (`document.elementsFromPoint()` at two panned positions). |
| Gating `tile.inert` at `scale < 0.35` so tiny rim icons stay excluded from hit-testing and `Tab` focus | not verified | Ring 3 tiles start `inert = true` at scale `0.14` and become active when panned inward above `0.35`, while their `updateElementGeometry()` rect stays inside the canvas bounds. Covered by live check 4 (`elementsFromPoint()` + click counts before and after swapping tiles). |
| Touch drag, double-tap centring, spring snap, `prefers-reduced-motion: reduce`, 2D 5-arg `drawElementImage()` fallback and plain HTML fallback | not verified | Pointer drags start after 7 px outside direct text/range inputs so taps hit controls cleanly, while double-tapping or pressing Centre glides any tile into the lens (snapping directly without spring frames when reduced motion is enabled). |

## Things that bit

- `ElementGL.upload(element)` stores the WebGL texture entry before calling `gl.texElementSubImage2D()`, so an early `paint` event before the element has a cached paint record leaves an empty texture entry in `stage.#textures` if `stage.has(element)` is trusted alone. Tracking a separate `tile.uploaded` boolean set only after `upload()` returns cleanly makes sure any failed tile retries on the next frame.
- Starting pointer capture on `pointerdown` would swallow `click` events on buttons and switches inside the 25 tiles, while ignoring drags that start over buttons would leave large central tiles blocking pan gestures on a 412 px screen. Delaying `setPointerCapture()` until pointer movement exceeds 7 px (outside `<input type="text">` and `<input type="range">`) and cancelling the trailing synthetic `click` on drag release lets both short taps and full-face drags work anywhere on the dial.
- Toggling `tile.inert` removes tiny peripheral tiles from `Tab` focus and `elementsFromPoint()` hit-testing without moving their geometry far off-canvas, avoiding any risk of Chromium skipping rasterisation of off-rim tiles before they pan back toward the centre.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /honeycomb/` and `?autochecks=1`): all four live checks passing, zero layout shift, GPU memory within 96 MB and canvas under 4 MP (expected ~1.0 MP and ~8 MB canvas + ~7.5 MB tile textures at 412 px wide, scale 2.625).
- Chrome 159 on Android (412 px wide, scale 2.625): touch panning across the watch dial, double-tapping Ring 3 `inert` tiles into the centre, typing into both `<input type="text">` tiles with the soft keyboard, sliding the dome and gap range controls, and toggling cluster accent chips.
- `webglcontextlost` and `webglcontextrestored` round-trip moving all 25 tiles into `#fallback-grid` with `inert = false` and back into `<canvas>`, plus the 2D five-argument `drawElementImage()` fallback path.
- Keyboard `Tab` navigation across active tiles and `focusin` centring when `prefers-reduced-motion: reduce` is on and off.

## For the index

- `texElementSubImage2D()`: 25 `104 x 104` `drawable` mini-control tiles in one `ElementGL` context can be uploaded lazily via `paintEvent.changedElements` (0 texture uploads per drag frame) while a squircle SDF and spherical dome shader composites them on one WebGL 2 canvas (not verified, `/honeycomb/`).
- `updateElementGeometry()`: setting `tile.inert = scale < 0.35` while keeping transformed `DOMMatrix` geometry inside the canvas keeps shrunken rim tiles out of `elementsFromPoint()` and `Tab` focus while scaled central controls stay clickable (not verified, `/honeycomb/`).
