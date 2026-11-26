# Backend scaling (`/perf-backends/`)

Built 2026-11-26. All runtime performance numbers across desktop GPUs and Android hardware are **not verified** yet; only static source checks (`node --check`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs`) have run on this branch so far.

## Question

Across element count (`1, 8, 32, 64, 128`), tile pixel size (`64, 128, 256` CSS px at native DPR) and DOM mutation rate (`0%` static-texture reuse, `10%` dirty re-upload, `100%` dirty re-upload), where are the throughput and latency crossover points between:

1. 2D `drawElementImage(el, x, y, w, h)`
2. WebGL2 `gl.texElementSubImage2D()` via `ElementGL` (`/lib/element-gl.js`)
3. WebGPU `queue.drawElementImageToTexture()` via `webgpu()` (`/shared/backend.js`)
4. 2D-to-shared-WebGL-to-2D copy bridge (`drawElementImage()` -> `gl.texSubImage2D()` in one shared `ElementGL` -> `ctx2d.drawImage()`)

## Measurements

| Experiment | Status | Result | Notes |
|---|---|---|---|
| 2D vs WebGL2 vs WebGPU vs Shared-GL bridge at 0% mutation (1 to 128 tiles, 64 to 256 px) | not verified | Pending real device run | WebGL2, WebGPU and Bridge skip `requestPaint()` and texture uploads after frame 0; 2D redraws all elements every frame. |
| Partial dirty re-upload (10% mutated per frame) | not verified | Pending real device run | Only mutated tiles re-upload in WebGL2, WebGPU and Bridge; 2D redraws all tiles. |
| Full dirty re-upload (100% mutated per frame) | not verified | Pending real device run | Exposes direct per-frame upload throughput (`drawElementImage` vs `texElementSubImage2D` vs `drawElementImageToTexture` vs 2D->GL->2D copy). |
| Long Animation Frames breakdown (`script`, `styleAndLayout`, post-main-thread presentation delay) | not verified | Pending real device run | Observed during every matrix cell via `PerformanceObserver({ type: 'long-animation-frame' })`. |
| GPU pass timing (`EXT_disjoint_timer_query_webgl2` and WebGPU `timestamp-query` / `queue.onSubmittedWorkDone()`) | not verified | Pending real device run | Shared `webgpu()` device requests default features, so WebGPU reports `onSubmittedWorkDone()` unless `timestamp-query` is active on the device. |
| Static graphics safety (`tools/gfx/check.mjs`) | measured (2026-11-26) | 0 problems, 0 exceptions | Uses `ElementGL`, `webgpu()` / `checkDevice()`, 5-arg `drawElementImage()`, no `loseContext()`, no `willReadFrequently` on drawable canvases, no readbacks inside `rAF`/`setInterval`. |

## Things that bit

- **`ElementGL.begin()` needs a laid-out CSS box:** for the shared-GL copy bridge, a detached WebGL `<canvas>` has `clientWidth === 0`, which makes `ElementGL.begin()` size its backing buffer to 1x1. Keeping the bridge's non-drawable WebGL `<canvas>` inside the stage with `visibility: hidden; position: absolute; inset: 0; width: 100%; height: 100%` gives `ElementGL`'s ResizeObserver the exact stage size without showing a second canvas or triggering visible lost-canvas overlays.
- **WebGPU dynamic uniform buffer slice size:** binding a shared 32 KB dynamic uniform buffer (128 tiles at 256-byte stride) requires specifying `size: 80` on the bind group entry when `hasDynamicOffset: true`, otherwise WebGPU validation rejects the binding.
- **Staying at 1 active WebGL context across a 180-cell sweep:** grouping the sweep by backend, reusing the same `ElementGL` canvas across `(count, size, mut)` cells within a backend, and waiting 260 ms after `dispose()` + `window.__gfx.retire(canvas)` when switching backends keeps peak active WebGL contexts at 1.

## Not verified

- Real throughput and p50/p95/p99 frame time curves on a desktop GPU (Chrome 157+ with hardware WebGPU and WebGL2). Run "Run backend sweep" or "Run full matrix" on `/perf-backends/` and check `npm run reports -- --page /perf-backends/ --list` or Copy Markdown.
- Real throughput, thermal throttling, context stability and memory headroom on Chrome for Android (412 px wide, DPR 2.625). Run "Run backend sweep" on the phone and inspect the queued `perf-backends` report.
- `npm run check:jank -- /perf-backends/` and `node tools/draw-size/audit.mjs /perf-backends/` in headless Chromium (not run from this subagent per file/build boundary; run after building `pages.js`).
- Whether `EXT_disjoint_timer_query_webgl2` returns non-disjoint timings on Android GPUs and whether `updateElementGeometry()` across 128 moving tiles introduces measurable main-thread overhead compared with the upload calls themselves.

## For the index

- **Performance / backends** (`/perf-backends/`): benchmark matrix comparing 2D `drawElementImage()`, WebGL2 `texElementSubImage2D()`, WebGPU `drawElementImageToTexture()` and a 2D-to-shared-WebGL copy bridge across 1 to 128 tiles, 64 to 256 CSS px and 0% / 10% / 100% DOM mutation rates (not verified on hardware yet).
