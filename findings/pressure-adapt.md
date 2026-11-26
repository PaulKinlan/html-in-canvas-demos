# Compute pressure fallback (`/pressure-adapt/`)

Implementation checked statically on 2026-11-26 (syntax check, `check:gfx`, `check:writing`). Headless Chromium and Android Chrome runs are not verified in this pass (live checks wait for a tap and report on whichever device opens the page).

| Question | Result | Notes |
|---|---|---|
| Starting on the lightest drawing route | built, not verified in browser | The card starts as plain HTML in `#card-host` and upgrades to the `fair` 2D 30 fps canvas on load, avoiding an initial WebGL context until `nominal` is chosen or reported by `PressureObserver`. |
| `PressureObserver` CPU subscription | built, not verified in browser | Calls `new PressureObserver(cb).observe('cpu', { sampleInterval: 1000 })`, records every sample in a timeline strip, and falls back gracefully with manual tier overrides if the browser does not expose `PressureObserver` or rejects `observe('cpu')`. |
| Stepping `nominal` -> `fair` -> `serious` -> `critical` -> `nominal` | built, not verified in browser | `nominal` uses one `ElementGL` WebGL 2 shader (chromatic glass refraction + animated ripple), `fair` uses throttled 30 fps 5-arg `drawElementImage()`, `serious` disables `requestAnimationFrame` for on-demand 2D `paint` only, and `critical` moves the card back into `#card-host` via `moveBefore()` and retires the canvas via `window.__gfx?.retire()`. |
| Preserving `<input>` state and DOM identity across tiers | built, not verified in browser | Live checks 2 and 3 assert input text, selection range and strict `===` identity across canvas <-> DOM handoffs and check that fixture canvas memory drops to 0.0 MB on `critical`. |
| WebGL hit-test alignment after `updateElementGeometry()` | built, not verified in browser | Uses `geometryUnit()` from `/lib/surface.js`, calls `canvas.updateElementGeometry()` with `new DOMMatrix().scale(unit).translate(x, y)` and toggles `data-hit-tick` to clear Chromium's hit-test cache. Verified by live check 4 via `document.elementFromPoint()`. |
| `node tools/gfx/check.mjs` | measured (2026-11-26) | Passed with 0 problems; uses `ElementGL` only, 5-arg `drawElementImage()`, no `loseContext()`, no `willReadFrequently` on drawable canvases, no timed readbacks. |
| `node tools/writing/check.mjs /pressure-adapt/` | measured (2026-11-26) | Checked against `docs/writing.md` rules with 0 errors and 0 warnings. |

## Things that bit

- Keeping idle paints at zero on the `serious` tier requires keeping the telemetry bar outside `#control-card` and avoiding timer-driven DOM updates inside the card itself; otherwise Chromium fires `paint` events on every tick.
- `window.__gfx.retire(canvas)` frees retired WebGL contexts and 2D buffers on the guard's 500 ms tick after the canvas has been disconnected for more than 200 ms, so the live check waits 900 ms after stepping to `critical` before checking that `window.__gfx.memory()` has returned to baseline.

## Not verified

- Headless Chromium 157 execution of the four live checks (`npm run check:jank -- /pressure-adapt/` and `node tools/draw-size/audit.mjs /pressure-adapt/`).
- Real `PressureObserver` state transitions (`nominal` -> `fair` -> `serious` -> `critical`) under sustained CPU or thermal load on desktop Chrome and Chrome on Android (A159).
- Whether the 1.5 s Web Worker burst is enough to push `PressureObserver` from `nominal` to `fair` or `serious` on a phone or laptop.
- Real GPU memory reclamation timing on Android Chrome when stepping from `nominal` (WebGL `ElementGL`) down to `fair` (2D) and `critical` (plain DOM).

## For the index

- Adaptive rendering tiers driven by `PressureObserver` can step one interactive HTML card across `ElementGL` WebGL, throttled 30 fps 2D, on-demand 2D and plain HTML via `moveBefore()`, retiring replaced canvases with `window.__gfx.retire()` (built 2026-11-26, browser verification pending).
