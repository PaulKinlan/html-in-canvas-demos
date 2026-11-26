# Input latency and hit-testing (`/perf-inp/`)

Status on 2026-11-26: page built and syntax/graphics checked locally; browser measurements are **not verified** yet (needs Chromium 157 / Canary 160 desktop and A159 Android phone runs).

## Question

How much Interaction to Next Paint (INP) latency does HTML-in-canvas add to real taps, drags, and typing inside moving or transformed controls, and what is the frame-time and INP cost of calling `updateElementGeometry()` plus the attribute-toggle workaround required to clear Chromium's hit-test cache across 1 to 200 moving controls?

## Experiments and checks on the page

| Experiment or check | Result | Reason |
|---|---|---|
| Live moving-controls arena (`Plain DOM`, `2D drawElementImage()`, `WebGL + updateElementGeometry()`, `WebGL + updateElementGeometry() + toggleAttribute('data-hit')`) across 1, 12, 50, 100, 200 controls | Not verified | Built on 2026-11-26; open `/perf-inp/` in Chrome with `#canvas-draw-element` enabled and tap, drag and type across all four modes to record Event Timing entries and hit accuracy. |
| Event Timing INP phase breakdown (`inputDelay`, `processingDuration`, `presentationDelay`, p75 / p98 / worst) | Not verified | Recorded by `PerformanceObserver({ type: 'event', durationThreshold: 0 })` for every real click, tap, drag and keypress targeting the arena. |
| Automated 1 to 200 control sweep (per-frame JS median/p95, geometry loop cost, frame interval, LoAFs > 50 ms) | Not verified | Tap "Run overhead sweep (1 to 200 controls)" on `/perf-inp/`; the page reports a summary via `window.__gfx.report('perf-inp', ...)` and builds a Markdown table via "Copy Markdown". |
| Stale hit-test cache reproduction on WebGL `updateElementGeometry()` without attribute toggle (live check 4 & sweep probe) | Not verified | Earlier experiments on C157 and Canary 160 reproduced stale hit-testing when an element moved after `elementsFromPoint()` warmed the cache; live check 4 and the sweep isolate and count misses and ghost hits at old positions. |
| WebGL `updateElementGeometry()` + `el.toggleAttribute('data-hit')` cache bust (live check 5 & sweep probe) | Not verified | Verifies whether toggling an attribute restores 100% hit accuracy and measures the per-frame style invalidation and LoAF penalty up to 200 moving controls. |

## Things that bit

- **Recursive paint events when toggling an attribute in WebGL mode.** Calling `el.toggleAttribute('data-hit')` inside a `paint` listener triggers another invalidation cycle. The arena only toggles `data-hit` inside the `requestAnimationFrame` motion tick (`allowBust = true`) and passes `allowBust = false` when redrawing from the `paint` event listener.
- **Staying within one WebGL context across arena and sweep.** Switching between `gl-stale` and `gl-bust` reuses the same `ElementGL` instance and canvas. Starting the automated sweep suspends and retires the live arena canvas first, reuses one `ElementGL` canvas across all counts 1 to 200 during the sweep, and retires it before resuming the arena.
- **Event Timing 8 ms coarsening.** Chromium rounds `PerformanceEventTiming.duration` to 8 ms multiples, which can make `startTime + duration - processingEnd` slightly negative on fast interactions. `bench.js` clamps `presentationDelay` at 0 ms so the phase split stays readable.
- **HiDPI coordinate units for `updateElementGeometry()`.** `bench.js` multiplies the translation matrix by `geometryUnit()` from `/lib/surface.js` so hit boxes stay aligned on 2.625 DPR Android screens as well as 1x desktop screens.

## Not verified

- Real-device INP (p75, p98, worst) and phase split across all four modes on desktop Chrome and Android (A159). Verify by opening `/perf-inp/`, interacting with all four modes (taps, drags, typing), and copying the Markdown report.
- Automated 1 to 200 control sweep numbers (JS median/p95, geometry loop cost, frame interval, LoAF count, `elementsFromPoint()` hit accuracy and ghost hits) on C157 / Canary 160 and A159. Verify by pressing "Run overhead sweep" and collecting `npm run reports -- --type perf-inp --list` or the Markdown copy.
- Software keyboard and IME typing latency inside the moving `<input>` drawn in 2D and WebGL canvases on Android. Verify by hand on A159.
- `npm run check:jank -- /perf-inp/` in headless Chromium. Verify in the main integration pass after `npm run build`.

## For the index

- Hit-testing / Performance: `/perf-inp/` measures real-interaction INP phase breakdowns and the 1 to 200 control frame-time and LoAF cost of `updateElementGeometry()` with and without the `toggleAttribute('data-hit')` hit-test cache workaround (measurements pending real-device run).

## Chromium bugs

- Stale hit-test cache after `updateElementGeometry()` moves an element without a DOM attribute toggle (already tracked in `/crashes/` and `/friction/`; `/perf-inp/` live checks 4 and 5 and the automated sweep quantify both the miss rate and the performance cost of the attribute-toggle workaround).

## API requests

- Have `updateElementGeometry()` invalidate Chromium's hit-test cache internally without forcing authors to mutate a DOM attribute (which risks per-frame style recalculation and extra paint invalidations across dozens or hundreds of moving controls).
