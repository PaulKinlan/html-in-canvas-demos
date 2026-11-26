# One canvas vs many (`/perf-architecture/`)

Created 2026-11-26. Static source checks (`node --check` and `node tools/gfx/check.mjs`) run on 2026-11-26. Live browser measurements on C157 and A159 are **not verified** yet.

## Results

| Question | Result | Reason |
|---|---|---|
| Mount duration across 4 architectures for N = 8, 24, 64 and 128 controls | not verified | Needs a live sweep in C157 and on an Android phone (A159) via "Run full comparison". |
| Bulk theme-switch wall time, missed 60 Hz frames, worst `rAF` gap and LoAFs across N = 8 to 128 | not verified | Needs a live sweep in C157 and A159. Architecture 4 spreads dirty visible controls across multiple frames using a ~6 ms paint budget while leaving offscreen `0x0` canvases unallocated until scrolled into view. |
| Programmatic internal-container scroll FPS (p50 and p95-tail) and reallocation jank | not verified | Needs a live sweep in C157 and A159. Architecture 4 reallocates backing stores as canvases cross the 120 px `IntersectionObserver` margin; real hardware measurements will show whether reallocation causes tail stalls compared with Architecture 1, 2 and 3. |
| Estimated GPU memory (`window.__gfx.memory()`) and single-canvas pixel cap at phone scale (412 px wide, DPR 2.625) | inferred (not verified on device) | Calculated from `computeLayout()`: at 380 CSS px viewport width and DPR 2.625, 128 controls in 2 columns stand 6,156 CSS px tall (6.14 MP as a single canvas). Architecture 1 splits vertically into bands capped at 3.6 MP each (under the 4 MP guard limit) and trims DPR if total backing stores would cross 80 MB. |
| Shared WebGL canvas (`ElementGL`) hit testing during internal scroll (`updateElementGeometry()`) | not verified | Verified by live check 3 on an isolated fixture once tapped in C157; live scroll interaction across 128 controls needs manual and automated verification. |

## Things that bit

- **A single tall shared 2D canvas breaks the 4 MP phone limit.** At 412 CSS px width and device scale 2.625, 128 interactive controls in two columns are over 6,000 CSS px tall (more than 6 megapixels). Leaving Architecture 1 as one monolithic canvas would trip the 4 megapixel limit in `context-guard.js`. Splitting Architecture 1 vertically into bands under 3.6 megapixels keeps the shared-canvas model intact for N = 8 and N = 24 (1 band) while preventing runaway backing stores at N = 64 and N = 128.
- **`requestPaint()` hides its cost until the rendering phase.** Calling `canvas.requestPaint()` in JavaScript takes microseconds, so a frame-budgeted loop that only times `performance.now()` around `requestPaint()` will schedule all dirty canvases in one animation frame and still trigger a long frame during painting. Architecture 4's `FrameBudgetScheduler` tracks an exponential moving average of each canvas's `paint` callback duration and caps dispatches per frame against the 6 ms budget.
- **WebGL texture memory sits outside `window.__gfx.memory()`.** A sticky viewport-sized `ElementGL` canvas keeps its swapchain small (about 1.0 megapixel at phone size), yet uploading 128 individual controls via `texElementSubImage2D()` allocates 128 RGBA8 textures on the GPU. The table reports `window.__gfx.memory()` for canvas backing stores alongside a separate WebGL texture memory estimate so Architecture 2 doesn't look artificially free.
- **Retiring canvases between sweep steps.** Switching architectures across 16 sweep combinations without freeing discarded canvases would accumulate removed backing stores and WebGL contexts. Every teardown zeroes 2D canvases, calls `stage.dispose()` for WebGL, removes the DOM nodes and passes each canvas to `window.__gfx.retire()`.

## Not verified

- Full 16-row comparison sweep (4 architectures by 4 counts) in desktop Chromium 157. Verify by opening `/perf-architecture/`, pressing "Run full comparison", and pasting the copied Markdown table here.
- Full 16-row comparison sweep on an Android phone (Chrome 159, 412 px wide, scale 2.625), especially whether Architecture 3 (128 live per-element 2D canvases) or Architecture 2 (128 WebGL textures) loses contexts or drops scroll frames on real mobile GPU memory, and whether Architecture 4's `0x0` eviction prevents context loss. Verify by running the sweep on the phone and reading `/api/reports` with `npm run reports -- --page /perf-architecture/`.
- All five live checks under "Live checks" in Chromium 157 and Chrome 159 on Android. Verify by tapping "Run these 5 checks" on `/perf-architecture/`.
- Page stability and graphics metrics on load (`npm run check:jank -- /perf-architecture/`).
- Touch interaction with the drawn checkboxes, `+1` buttons and range sliders inside the scrollable container on Android.

## For the index

- **Performance and memory (`/perf-architecture/`)**: Compares one shared 2D canvas (band-split <= 3.6 MP), one shared `ElementGL` WebGL 2 canvas, N live per-element 2D canvases and N per-element 2D canvases with `IntersectionObserver` `0x0` eviction and 6 ms frame-budgeted painting across 8, 24, 64 and 128 controls. Not verified yet in a live browser.
