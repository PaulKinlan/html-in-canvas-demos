# Magnified ruler picker and rolling digits (`/ruler-picker/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL). Rebuilds Nitish Khagwal's Ruler Picker (`/elsewhere/#ruler-picker`). Chrome 159 on Android and `npm run check:jank` (Playwright not installed in this environment) are **not verified** yet.

The question: can a real `<input type="range">` paired with a `<datalist>` tick scale inside one `ElementGL` WebGL 2 canvas produce a smooth cylindrical glass magnifier lens and mechanical rolling `<output>` odometer drums while keeping pointer dragging, keyboard arrows and native form controls interactive?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 canvas (`texElementSubImage2D()`) with cylindrical refraction + drum vignette | measured (Chrome 160 Canary, 2026-11-27) | Smoke check passed (`924x929`, `0.86 MP`, `6.9 MB`, `0` errors, `0` lost contexts, `0` unasked readbacks, `0` open snapshots, `0` wrong-argument draws, `.motion-warn` verified). Live checks passed (`6/6`). |
| Cylindrical lens tick spacing inflation & RGB edge dispersion | measured (Chrome 160 Canary, 2026-11-27) | Live check passed via `readPixels()` comparing `flat` (`1.0x`) vs active lens (`2.4x`) tick spacing and R-B fringe separation near the lens rim. |
| `updateElementGeometry()` + `geometryUnit()` hit testing on range slider and preset button | measured (Chrome 160 Canary, 2026-11-27) | Live check passed (`elementsFromPoint()` landed on both `<button>` and `<input type="range">`). |
| Lens + 14-digit rolling odometer spring settling and `prefers-reduced-motion: reduce` instant snap | measured (Chrome 160 Canary, 2026-11-27) | Live check passed after passing explicit synthetic clock `now` into `setTargetValue()` so `boostUntil` expires in deterministic spring steps. |
| `webglcontextlost` recovery into plain HTML | measured (Chrome 160 Canary, 2026-11-27) | Live check passed with synthetic `webglcontextlost`, moving controls cleanly into `plainHost`. |
| 5-argument `drawElementImage()` 2D lens strip fallback & real Android touch feel | not verified | Needs testing on Chrome 159 for Android at 412 px and a browser without WebGL `texElementSubImage2D()`. |

## Things that bit

- Using `performance.now()` inside `setTargetValue()` for `boostUntil = now + 280` while driving the spring unit check with a separate synthetic timestamp `t = 1000` kept `now < s.boostUntil` true on every step, causing the loop to hit its 240-frame cap without marking settled. Passing an optional `now` timestamp into `setTargetValue()` keeps runtime and deterministic spring checks aligned.
- Placing `aria-hidden="true"` on the 14-row digit strip reels while writing formatted text into a visually hidden `#ruler-out-sr` span inside `<output>` keeps screen-reader output clean without breaking visual cylinder shading in GLSL.

## Not verified

- Chrome 159 on an Android phone at 412 px wide (`2.625` DPR): finger dragging across `<input type="range">`, unit switching (`cm`, `kg`, `°C`, `dB`), and WebGL frame timing on device hardware.
- `npm run check:jank -- /ruler-picker/` (Playwright is unavailable in this environment) and the 2D `drawElementImage()` fallback route.

## For the index

- Custom form controls and pickers: `/ruler-picker/` rebuilds Nitish Khagwal's Ruler Picker in one `ElementGL` WebGL 2 canvas (`6/6` checks in Chrome 160 Canary, `0.86 MP`, `6.9 MB`) pairing a `<datalist>` tick scale and rolling `<output>` odometer drums with cylindrical glass refraction (`texElementSubImage2D()`, `updateElementGeometry()`).
