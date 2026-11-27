# Radial clock-face day planner (`/clock-calendar/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL): `5/5` live checks passed, backing store `924x1328` (`1.23 MP`, `9.8 MB`), `0` errors and `0` lost contexts. Chrome 159 on Android and `npm run check:jank` (Playwright absent here) remain **not verified**.

The question: can live HTML event cards and native `<input type="time">` controls drive a radial 24-hour and 12-hour clock planner rendered in WebGL 2, curving event labels along polar ring wedges while projecting the active event's time inputs onto a clickable dock via `updateElementGeometry()`?

## What was built

One `<canvas id="clock-canvas" content="drawable" layoutsubtree>` inside `.cc-wrap` (`max-width: 580 px`, fixed `552 px` height / `506 px` below `620 px`, zero `dvh`, under `1.4 MP` at `412 px` wide and `2.625` DPR) containing:

- **Live HTML event strips (`.ev-strip`, `drawable`)**: starts with 3 blocks (`Design review`, `Shader sync`, `Deep work`, up to 6 via `Add block`), each holding a clickable `<button class="ev-hit">`, colour dot, `<span class="ev-title">` and `<output class="ev-time">`.
- **Dial numeral overlay (`#clock-face-dom`, `drawable`, `inert`)** and **circular touch grip (`#clock-dial-grip`, `drawable`, `touch-action: none`)**: draws the perimeter hours (`00`–`21` or `12`–`11`) and centre digital clock readout while stopping finger drags on the dial from panning the page.
- **Interactive inspector dock (`#clock-inspector`, `drawable`)**: positioned at the bottom dock with `updateElementGeometry()` scaled by `geometryUnit()`, containing `Prev` / `Next` selector buttons, duration `<output>`, `<input type="text">` title, and `<input type="time" id="ev-start">` / `<input type="time" id="ev-end">`.

Rendering uses a single `ElementGL` WebGL 2 context (`CLOCK_FRAG`) with four logical passes per frame, uploading changed elements only after `hasPainted === true` inside `'paint'`, plus a 5-argument `drawElementImage()` 2D fallback and plain-HTML extraction on unsupported browsers or context loss.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Do the event strips, numeral overlay and inspector dock upload via `ElementGL` `texElementSubImage2D()` and render with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on the isolated `testStage()` fixture (`gl.getError() === 0`). |
| Does `pointToMinutes()` map polar angles to 24h and 12h clock times with 15-minute snap rounding? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed across 24h and 12h modes. |
| Does dragging an arc handle update `<input type="time">` values and expand rendered wedge pixels? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed via `readPixels()` after `applyHandleDrag()`. |
| Does `updateElementGeometry()` keep `<input type="time">`, `<button>` and rotated tangent wedge hotspots hit-testable? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`elementsFromPoint()` hit the time input, `Next` button and `.ev-strip` hotspot). |
| Does the main stage stay drawn after all checks finish? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`5/5` total, `1.23 MP`, `9.8 MB`). |

## Things that bit

- Caching `geometryUnit()` per canvas width: calling `geometryUnit()` with different element widths (`dockW` vs `STRIP_W`) in the same frame resets `surface.js`'s per-canvas cache and triggers extra `updateElementGeometry()` identity writes plus `getBoundingClientRect()` reads. Measuring `geometryUnit(canvas, inspectorEl, layout.dockW)` once per resize in `cachedUnit()` and reusing that `u` for the dial grip and every `.ev-strip` hotspot keeps hit-box sync free of repeated layout reads.
- `input[type="time"]` rejects `"24:00"`: 24-hour end drags near midnight snap to `23:45` and clamp at `23:59` (`1439` minutes) past `23:52` so the native `<input type="time">` value never goes invalid or clears.
- Upright text on the lower half of the clock dial: polar wedges spanning `09:00`–`15:15` sit on the bottom half of a 24-hour dial where clockwise angle increases right-to-left. Inverting `(u, v)` along both axes whenever `cos(midAngle) < 0` keeps curved strip labels reading left-to-right all round the circle.
- Overlapping 12-hour AM/PM blocks: morning and afternoon blocks sharing an hour sector on a 12-hour clock (`09:00` and `21:00`) would collide on one ring track, so `computeLanes()` moves colliding intervals into inner AM and outer PM sub-lanes while leaving clear blocks across the full track width.

## Not verified

- Headless Chromium 157 and Chrome Canary runtime: `npm run check:jank -- /clock-calendar/` and `node tools/draw-size/audit.mjs /clock-calendar/` (not yet run here if Playwright is absent).
- Chrome 159 on Android at `412 px` wide and `2.625` DPR: touch handle drag accuracy (`touch-action: none` on `#clock-dial-grip` and `.ev-strip` vs vertical page scrolling), native Android `<input type="time">` picker popup position inside a canvas dock, and on-screen keyboard layout stability when editing `#ev-title-input`.
- Screen reader announcements and keyboard focus rings across rotated `.ev-strip` hotspots and `#clock-inspector` under `prefers-reduced-motion: reduce`.

## For the index

- Custom form controls and pickers: `/clock-calendar/` rebuilds Isaiah Trotter's Clock Calendar in one `ElementGL` WebGL 2 canvas with polar-warped `drawable` event strips, 15-minute snapped ring handle dragging, native `<input type="time">` dock sync via `updateElementGeometry()`, and 24h / 12h lane splitting.
