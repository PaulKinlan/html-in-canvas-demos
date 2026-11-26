# Caching and snapshot churn (`/perf-caching/`)

Built on 2026-11-26. Not yet measured in headless Chromium 157 or on real hardware (A159 / desktop GPU). All benchmark timings below are `not verified` until the sweep is run in a browser that exposes `drawElementImage()` and `captureElementImage()`.

## Part 1: partial-update strategies on a 24-card dashboard

| Experiment | Result | Why |
|---|---|---|
| Full `drawElementImage(el, x, y, w, h)` replay of all 24 cards at 0%, 5%, 25%, 100% dirty | not verified | Baseline row in `/perf-caching/` (`full`). Run "Run full sweep" to record rAF p50/p95, paint JS ms, LoAF post-main-thread time and canvas MB. |
| Main-thread `captureElementImage()` cache (re-capturing dirty / `e.changedElements` cards only) | not verified | Row `snapshot`. Re-captures only changed cards and closes the replaced `ElementImage` before calling `captureElementImage()` for the replacement so live handles stay at 24. |
| Plain offscreen 2D `<canvas>` cache per card (`drawImage()` copy on dirty, blit on clean) | not verified | Row `offscreen`. Skips `drawElementImage()` completely for untouched cards at the cost of 24 plain non-drawable card-sized buffers (retired via `window.__gfx.retire()` on teardown). |
| Clipped dirty-rect + nine-argument `drawElementImage(el, sx, sy, sw, sh, dx, dy, dw, dh)` on each dirty card's lower metric strip | not verified | Row `dirty-rect`. Keeps the framebuffer intact between frames (no `ctx.reset()`) and only repaints the changing strip of dirty cards. |

## Part 2: `ElementImage` snapshot churn at 60 fps

| Experiment | Result | Why |
|---|---|---|
| Direct `drawElementImage(el)` at 60 draws/s (0 snapshots) | not verified | Baseline for isolating `captureElementImage()` + `.close()` overhead. |
| 60 `captureElementImage()`/s with immediate `.close()` in the same `paint` handler | not verified | Keeps `openSnapshots` peak at 1 and end at 0. |
| 60 `captureElementImage()`/s with batched `.close()` (pool of 8, drained every 8 frames) | not verified | Caps `openSnapshots` peak at 8 (matching the `check:jank` limit) and drains to 0 in `finally`. |
| 240 `captureElementImage()`/s (4 cards/frame) with immediate `.close()` | not verified | Tests whether per-frame allocation and `.close()` cost scales linearly or triggers LoAF stalls. |

## Things that bit

- **Snapshot warning threshold at 25 open handles.** `public/shared/context-guard.js` warns and sends a `snapshots-open` report the instant `window.__gfx.snapshots.open === 25`. With 24 cached cards, replacing a dirty card by capturing the new `ElementImage` before closing the old one momentarily hits 25. Closing the old snapshot first keeps the live count at 24 during the run, and teardown closes every snapshot so `openSnapshots` returns to 0.
- **Plain offscreen cache canvases cannot call `drawElementImage(el)`.** An element can only be drawn into the drawable canvas that owns it, so Strategy 3 draws a dirty card onto the main drawable canvas once and copies that card's backing rect into a plain non-drawable `<canvas>` with `drawImage()`. Clean cards then blit from that plain canvas without calling `drawElementImage()`.
- **Hit geometry after nine-argument strip redraws.** Prior experiments (`/input-ideas/`, `/select-selection/`) measured that nine-argument `drawElementImage()` cuts an element's hit box to the last source rectangle unless `preserveElementGeometry: true` is honoured. `/perf-caching/` passes `{ preserveElementGeometry: true }` (with a nine-argument fallback) and includes a live check that reports whether the untouched top half of a card still receives `elementFromPoint()`.

## Not verified

- Partial-update timings (0%, 5%, 25%, 100% dirty) across all four strategies on headless Chromium 157 (`C157`), desktop GPU Chrome, and Chrome for Android (`A159`). Run "Run full sweep" on `/perf-caching/` and paste the Markdown output here.
- Whether 60/s and 240/s `captureElementImage()` + `.close()` churn causes GPU memory growth, LoAF post-main-thread spikes or context loss on a phone (`A159`). Run "Run churn test" on `/perf-caching/` on the test phone.
- Live check pass/fail rows (`Run these 7 checks` on `/perf-caching/`) and `npm run check:jank -- /perf-caching/` in headless Chromium 157.

## For the index

- Performance and caching: `/perf-caching/` benchmarks full `drawElementImage()` replay against main-thread `captureElementImage()` caching, plain offscreen 2D canvas caching, and clipped nine-argument dirty-rect redraws across 0% to 100% dirty ratios, plus 60 fps and 240 fps `ElementImage` churn (`not verified`, `/perf-caching/`).
