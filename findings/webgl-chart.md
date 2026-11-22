# 100k-point WebGL chart with live DOM tooltips (`/webgl-chart/`)

Not verified in a browser yet (authored 2026-11-22). Static checks (`npm run check:gfx` and `tools/writing/check.mjs --strict`) pass; every live check below is marked `not verified` until run in Chromium 157 and Chrome 159 on Android.

This page builds on the data-visualisation motivation in the WICG HTML-in-canvas explainer (keeping accessible chart labels and tooltips inside the same composited canvas surface) and on high-density WebGL scatter and financial charts such as deck.gl and Lightweight Charts. It plots 100,000 deterministic points across four series on one `ElementGL` WebGL 2 context (`/lib/element-gl.js`) alongside three `drawable` HTML overlays: a filter legend (`#chart-legend`), a selectable tooltip with an inline annotation form (`#chart-tip`), and a data-space pinned callout (`#chart-pin`).

| Question | Result | Notes |
|---|---|---|
| Can one `ElementGL` WebGL 2 context draw 100,000 points and three `drawable` HTML overlays in the same `paint` pass? | not verified | Implemented by reading `gl.CURRENT_PROGRAM` and `gl.VERTEX_ARRAY_BINDING` once after `stage.begin()`, drawing the chart's own VAOs, then restoring `ElementGL`'s bindings before `stage.quad()`. Live check 2 tests this on an isolated fixture. |
| Can series filter checkboxes toggle 25,000 points per series without re-uploading vertex buffers? | not verified | Each checkbox flips one bit in `uMask` (a 4-bit integer uniform) in the scatter vertex shader, and selects which of the four 25,000-vertex `GL_LINE_STRIP` traces draw in time-series mode. Live check 3 tests `uMask = 1` against `uMask = 0` on one VBO. |
| Does a flat 64x64 spatial grid find the nearest of 100,000 scatter points in under 1 ms? | not verified | Uses CSR typed arrays (`cellStart`, `cellPoints`) with zero per-lookup allocations and a 5x5 cell cap around the pointer. Live check 1 times 20 queries and compares a masked query against brute force. |
| Does a pinned DOM callout stay aligned with its data-space `(x, y)` coordinate for clicks and text edits during pan and zoom? | not verified | Recomputed every paint via `dataToCss()`, drawn with `stage.quad()`, and synced with `canvas.updateElementGeometry(el, { canvasTransform })` plus `el.dataset.hitTick` when the rectangle changes. Live check 4 probes `elementsFromPoint()` at the translated button. |
| Do stationary HTML overlays avoid `texElementSubImage2D()` re-uploads while panning and zooming? | not verified | `drawWebGL()` uploads only overlays named in `e.changedElements` (or missing a texture). Live check 6 checks `changedElements` across three `requestPaint()` frames. |
| Does the 2D fallback draw a downsampled chart and the same `drawable` overlays with five-argument `drawElementImage()`? | not verified | Falls back to a 2D context drawing every 12th scatter point (~8,300 points) plus 5-arg `drawElementImage()`, and falls back further to plain HTML overlays if `drawElementImage()` is absent. Live check 5 verifies the 2D route via a plain `willReadFrequently: true` copy canvas. |

## Things that bit

- `ElementGL` keeps `#program` and `#vao` private, and `stage.quad()` expects them to stay bound after `stage.begin()`. Drawing the chart's own `GL_POINTS` and `GL_LINES` programs in between would break `stage.quad()` unless `gl.CURRENT_PROGRAM` and `gl.VERTEX_ARRAY_BINDING` are captured right after `stage.begin()` and restored before the quad pass. Both cached handles must also be cleared in `onLost` so a restored context captures the rebuilt program and VAO.
- Toggling `el.dataset.hitTick` to clear Chromium's hit-test cache raises a `paint` event. Gating `updateElementGeometry()` and the attribute toggle behind a per-element `"x,y,w,h"` key stops the paint handler from looping while idle.
- A hidden `drawable` overlay still catches clicks and Tab focus if left in place. Dismissed tooltips, unpinned callouts, collapsed legends and pins panned outside the plot set `el.inert = true` and move their hit box to `(-4000, -4000)`.
- Pointer drag and wheel listeners on `<canvas>` must check `e.target !== canvas` before calling `setPointerCapture()` or `preventDefault()`, otherwise dragging the range slider, selecting text inside `#chart-tip` or opening the `<select>` in `#chart-legend` gets hijacked by chart panning.

## Not verified

- Chromium 157 (headless or desktop): run all 6 live checks on `/webgl-chart/` and verify `npm run check:jank -- /webgl-chart/` and `node tools/draw-size/audit.mjs /webgl-chart/`.
- Chrome 159 on Android (412 px wide, touch, DPR 2.625): verify single-finger drag pan, two-finger pinch zoom, tapping points without hover, typing into `#tip-note` and `#pin-text` with the on-screen keyboard, selecting text inside `#chart-tip`, and real frame rate with 100,000 points.
- Native `<select>` popup placement inside `#chart-legend` when the canvas is scrolled or zoomed on desktop and Android.
- Screen reader announcements and keyboard Tab navigation through `#chart-legend`, `#chart-pin` and `#chart-tip` while the chart is zoomed.
- Context loss and restoration under GPU memory pressure on Android (`onLost` / `onRestored` rebuilding the 3 VBOs and two chart programs).

## Open ideas

- Add WebGL 2 instanced OHLC candlesticks when zoomed below a 5% time window so individual open/high/low/close bars appear on top of the 100,000-sample trace.
- Let visitors pin multiple notes at once by cloning a lightweight `<template>` into `drawable` children inside the canvas and capping the active count so GPU texture memory stays bounded.
- Add a WebGPU compute or render route through `webgpu()` from `/shared/backend.js` to compare 100,000-point frame times against WebGL 2 on the same device.

## For the index

- WebGL and data visualisation: one `ElementGL` WebGL 2 context can mix 100,000-point vertex buffers, a 4-bit series bitmask uniform and `drawable` HTML overlays (`#chart-legend`, `#chart-tip`, `#chart-pin`) in a single `paint` pass (not verified, `/webgl-chart/`).
