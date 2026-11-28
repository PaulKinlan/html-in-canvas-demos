# Holographic foil and brushed-metal sheen (`/optical-sheen/`)

Measured on 2026-11-27 in `HeadlessChrome/160.0.0.0` (Chrome Canary `160.0.8188.0` with `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement`, plus `?route=2d`, `?route=plain` and emulated `prefers-reduced-motion: reduce`) at `412x915` (DPR `2.625`, touch emulation). Real Chrome 159 on Android (`412 px`, DPR `2.625`) and `npm run check:jank` (`playwright` is not installed here) are **not verified**.

| Question or check | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context uploads `#os-card` via `texElementSubImage2D()` with `gl.getError() === 0` | measured (Chrome 160, 2026-11-27) | `1` WebGL context at rest (`peak: 2` across checks), `924x830` canvas at `412 px` (`0.77 MP`, `6.14 MB` initial, `6.38 MB` settled), `0` console/page errors. Live check 1 passed (`tex=525x326, glErr=0, center rgb(14,23,29), alpha=255`). |
| Sobel relief gradients selectively brighten embossed borders and glyph edges under specular glare | measured (Chrome 160, 2026-11-27) | Live check 2 passed: `glErr=0, embossedEdgeGain=+101.5, flatInteriorGain=+2.1 luma`. |
| Pointer tilt shifts `Hologram prism` hue phase across halves and differs from `Gold leaf` and `Brushed titanium` | measured (Chrome 160, 2026-11-27) | Live check 3 passed (`tMs midLightX=-0.52, halfDiff=27, tiltShift=61, goldR-B=40`). |
| Tilted card hit testing hits buttons and `<input>` via `updateElementGeometry()` + `geometryUnit()` | measured (Chrome 160, 2026-11-27) | Live check 4 passed (`btnHit=true`, `inpHit=true`, `unit=1.00`). Live tilted taps switched tiers, toggled `Activate pass`, copied token and edited `#os-member-input`. |
| Synthetic `webglcontextlost`/`webglcontextrestored`, `?route=2d` 5-arg 2D fallback and `?route=plain` rescue | measured (Chrome 160, 2026-11-27) | Live check 5 passed (`glRestore=true, 2dFoilLuma 21.0 -> 102.0`). `?route=2d` drew with `wrongDraws=0` and `?route=plain` restored `#os-card` into `#plain-host` (`scrollWidth=412`). |
| Stage retains its rendered picture after all fixtures retire | measured (Chrome 160, 2026-11-27) | Live check 6 (`stillDrawn()`) passed (`100.0%`), `openSnaps=0`, `unaskedReads=0`, `lost=0`. |
| Real Android GPU frame rates, touch tilt feel and soft keyboard on tilted `#os-member-input` | not verified | Needs testing on Chrome 159 for Android (`412 px`, `2.625` DPR). |

## Things that bit

- **Status line throttling on frame zero:** `updateStatus()` skipped updates whenever `now - state.lastStatusMs < 110`. On quick page loads in headless `?route=2d`, first paint ran inside `110 ms` of navigation start, leaving the initial `"Starting ElementGL WebGL 2 stage..."` string visible until a control clicked. Starting `lastStatusMs` at `-1000` made every backend paint its live route banner right on frame zero.
- **Premultiplied alpha across tilted thin foil borders:** keeping `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` on `ElementGL` creation, `onRestored` and fixtures stopped translucent border seals on the dark card from blowing out under additive foil glare.

## Not verified

- `npm run check:jank -- /optical-sheen/` and `node tools/draw-size/audit.mjs /optical-sheen/` (Playwright isn't installed in this environment).
- Real Chrome 159 on Android (`412 px`, `2.625` DPR): mobile GPU throughput, pointer drag tilt feel and virtual keyboard geometry inside tilted `<input>`.
- `public/optical-sheen/social.jpg` capture via `node tools/social/capture.mjs /optical-sheen/`.

## For the index

- Motion and optics: `/optical-sheen/` drives `Hologram prism`, `Brushed titanium` and `Gold leaf` directional specular sheen over Sobel relief normals from a live `texElementSubImage2D()` membership card under 3D tilt while keeping tier pills, buttons and `<input>` clickable (`6/6` checks pass in Chrome 160; Android phone and `check:jank` not verified).
