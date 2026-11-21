# Latency and long frames (`/perf/`)

Measured in headless Chromium 157 (software rendering, phone-size viewport) on 2026-11-21. The page measures the browser it runs in from two buttons.

| Experiment | Result | Why |
|---|---|---|
| DOM change to presentation, plain DOM | 4 ms median | `presentationTime` of the new element's Element Timing entry. |
| The same change on a child of a 2D canvas | 5 ms median, same frame | The `paint` event ran 2 ms after the change and before the frame was presented, in 8 of 8 samples. |
| Element Timing for a canvas child the canvas never draws | an entry arrives | `presentationTime` is when the element's picture was painted, not when a canvas showed it. This answers the open question in the plan. |
| Worker canvas: change to the worker's `drawElementImage()` | 3 ms median | Snapshot in the paint event of the same frame, drawn on the worker's next frame. Presentation of the worker's frame is not observable. |
| Long frame, 16,000 cells rewritten per frame, plain DOM | 115 ms on the main thread, 4 ms to presentation | From `long-animation-frame` entries. |
| The same grid in a 2D canvas | 108 ms on the main thread, 61 ms to presentation | The canvas's cost is after the main thread. `drawElementImage()` took 3.8 ms. |

- The `paint` handler does not appear in a long frame's `scripts` list. Only the `requestAnimationFrame` callback does.
- Chromium 157 entries have `renderStart`, `styleAndLayoutStart`, `paintTime` and `presentationTime`, and no separate style and layout durations.
- Element Timing entries arrive for a fixture that is scrolled out of the viewport.
- `navigator.cpuPerformance` is 2 in the test browser (4 cores, 16 GB). `lib/device-tier.js` maps it to three tiers; the mapping is a guess until it is compared with the wall on real devices.
