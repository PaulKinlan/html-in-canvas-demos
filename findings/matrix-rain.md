# Digital rain over a live HTML terminal (`/matrix-rain/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 (macOS, SwiftShader WebGL, tested at `412 x 860` mobile emulation with `2.625` DPR and touch emulation, plus `500 x 980` with `--force-device-scale-factor=2.625`, and `--disable-blink-features=CanvasDrawElement` for the plain-HTML fallback). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`: `0` problems), writing rules (`node tools/writing/check.mjs --strict /matrix-rain/`: `0` errors, `0` warnings), social tags check for `/matrix-rain/` (`exact match: true`) and `6/6` live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright is not installed here), `node tools/draw-size/audit.mjs`, the 2D fallback branch and Chrome 159 on Android hardware are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas cascade columns of glowing green phosphor digital code rain directly over a live interactive HTML terminal card, so HTML glyphs, borders and active buttons catch falling droplets and flare brighter green while the text underneath stays editable and clickable?

## What was built

One `<canvas id="matrix-canvas" content="drawable" layoutsubtree>` inside `.matrix-viewport` (`max-width: 600px`, `390 px` tall on desktop and `415 px` below `520 px` with no `dvh`, `927 x 1085 px` or `1.01 MP` at 412 px wide and 2.625 DPR) holding one `drawable` live terminal card (`#term-panel`):

- **Command line (`#term-cmd`)**: editable monospace `<input type="text">` (`user-select: text` inside a `user-select: none` stage) supporting live typing and `Enter` command execution (`decode`, `trace`, `lock`, `clear`, or arbitrary text).
- **Quick-command buttons**: **Decode signal** (`#btn-decode`), **Trace route** (`#btn-trace`) and **Lock rain** (`#btn-lock`, `aria-pressed`), each emitting a phosphor pulse ring from the button's CSS centre (`measureElementCenter()`) while updating live DOM telemetry.
- **Signal decode status and structured rows**: live `<output id="term-output">` plus four structured status lines (`CHANNEL`, `PARITY`, `ROUTE`, `STREAM`).
- **Single-pass `RAIN_FRAG` shader on one `ElementGL` context**: enables `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at creation and in `onRestored`, extracts local DOM edge magnitude with a CSS-pixel-clamped 3x3 Sobel stencil + local contrast check (`textureSize(uTex, 0)`), renders two depth layers of procedural 5x7 dot-matrix glyphs packed into signed-safe `ivec3` bitmasks (`<= 32008`), and flares caught edges and sparks across **Phosphor rain**, **Ink reveal** and **Decode trace** modes.
- **External controls & power guards**: mode segmented buttons, **Rain speed** (`0.25x` to `2.5x`), **Column density** (`30%` to `100%`) and **Reduced motion** toggle, alongside `IntersectionObserver`, `document.hidden`, `prefers-reduced-motion: reduce`, 5-argument `drawElementImage()` 2D fallback and plain-HTML context-loss recovery.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does `ElementGL` upload `#term-panel` cleanly with `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` and flare DOM edges under `RAIN_FRAG`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`tex=630x420` at 2.625 DPR, `rainPx=[99,255,183,255]`, `edgePx=[137,255,208,255]`, `errors=[0,0,0]` across modes 0, 1 and 2). |
| Do live `<input>` edits trigger `paint` and re-upload via `texElementSubImage2D()`? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`re-uploaded 630x420`, `inputDelta=149`, fixture `<input>` preserved `"ZZZZZZZZZZZZZZ"`). |
| Does `updateElementGeometry()` scaled by `geometryUnit()` keep buttons and inputs hit-testable? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `document.elementsFromPoint()` landed on both the fixture button (`true`) and `<input>` (`true`) at `unit=1.000`. |
| Does `Reduced motion` freeze rain fall and keep `Ink reveal` legible? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`keep=false`, `rainTime=6.4`, `pulseAge=-1`, `inkRevealEdgeGreen=255`). |
| Does `webglcontextlost` fall back to plain HTML and `webglcontextrestored` recover `ElementGL`? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed on synthetic cancelable `webglcontextlost` and `webglcontextrestored` (`defaultPrevented=true`, `plainWhileLost=true`, `restored=true`, `err=0`). |
| Does the visible terminal still render after all fixtures retire, within phone limits? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%`). At `412 x 860` @ `2.625` DPR: `scrollWidth=412`, canvas `927 x 1085` (`1.01 MP`), `peakGL=2`, `removedBytes=0`, `0` unasked readbacks, `0` console errors. |
| Does disabling `CanvasDrawElement` leave the terminal usable as plain HTML? | measured (Chrome 160 Canary, 2026-11-27) | With `--disable-blink-features=CanvasDrawElement`, `#matrix-stage.is-plain` moved `#term-panel` into `#plain-host` and clicking **Decode signal** updated `#term-output`. |

## Things that bit

- **Sequential WebGL fixture accumulation (`glContexts` and `removedMB`)**: running five consecutive `ElementGL` check fixtures faster than `context-guard.js`'s 250 ms `watch()` + 500 ms `onTick()` loop briefly raised peak active WebGL contexts to `5` and left `9.58 MB` in removed canvases at `window.__checkState === 'done'`. Waiting in `retireFixture()` until `window.__gfx.active() <= 1` dropped peak WebGL contexts to `2` and removed memory to `0 MB` even under `?autochecks=1`.
- **Single-pass edge detection on dark controls vs active pressed buttons**: `Lock rain` flips to bright mint (`#5cff9d`) with dark text (`#03150a`) when pressed, while unpressed controls have bright text on `#050c08`. Combining 3x3 Sobel luminance gradient with `(localMax - localMin)` contrast in `RAIN_FRAG` lets both polarity modes catch droplets cleanly.
- **CSS-pixel clamped edge step across DPR scales**: using `max(1.0 / textureSize(uTex, 0), 0.85 / uSize)` for the Sobel stencil keeps border and glyph catch thickness consistent between `1x` desktop and `2.625x` mobile backing stores.

## Not verified

- `npm run check:jank -- /matrix-rain/` and `node tools/draw-size/audit.mjs /matrix-rain/`: Playwright is not installed in this environment (`tools/site/build.mjs --check` also stopped on an unrelated pre-existing file `public/anamorphic-flare/page.json`).
- Headless Chromium 157: full `check:jank` measurement of CLS, scroll, focus, and resize stability.
- Chrome 159 on Android at 412 px wide and 2.625 DPR: real software/on-screen keyboard interaction inside `#term-cmd`, touch selection inside `<input>` vs `user-select: none` on the stage, and real GPU frame rate across **Phosphor rain**, **Ink reveal** and **Decode trace**.
- 2D canvas fallback branch (`render2DFallback()`): only reachable when HTML-in-canvas is present without `WebGL2RenderingContext.prototype.texElementSubImage2D`.

## For the index

- Transitions, text and motion: `/matrix-rain/` cascades two depth layers of procedural 5x7 phosphor code rain over a live interactive HTML terminal on one `ElementGL` WebGL 2 canvas (`texElementSubImage2D()` + `UNPACK_PREMULTIPLY_ALPHA_WEBGL`), catching falling droplets on DOM Sobel edges while keeping `<input>` and command buttons active via `updateElementGeometry()`.
