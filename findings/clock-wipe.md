# Polar clock-wipe and bow-tie sweep (`/clock-wipe/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL, and `1024x900` at `1` DPR), plus `?route=2d` and `--disable-blink-features=CanvasDrawElement`. Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /clock-wipe/`), social metadata check (`node tools/social/validate.mjs /clock-wipe/`) and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed in this environment) and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas wipe between two live HTML scenes in polar coordinates with single-hand, bow-tie and quad-iris blades, prism glass refraction on the leading arm, and sector-aware `updateElementGeometry()` hit testing?

## What was built

One `<canvas id="cw-canvas" content="drawable" layoutsubtree>` inside `.cw-viewport` (`416 px` tall desktop, `376 px` tall at `<= 620 px` with `max-height: 62svh` and zero `dvh`, `994x987` / `0.98 MP` / `7.8 MB` at `412 px` and `2.625` DPR) compositing two full-stage `drawable` HTML cards:

- **Daylight Metro Timetable Card (`#cw-scene-a`)**: warm paper background (`#fbf7ef` to `#ede2cd`) with three clickable buttons (`#a-btn-nw`, `#a-btn-ne`, `#a-btn-se`) and one editable text field (`#a-input-sw`, `user-select: text`) arranged in the four quadrants around the stage centre.
- **Midnight Express Telemetry Card (`#cw-scene-b`)**: dark slate background (`#0c172a` to `#070d18`) with three clickable buttons (`#b-btn-nw`, `#b-btn-ne`, `#b-btn-sw`) and one editable text field (`#b-input-se`, `user-select: text`) aligned to the same four quadrants.

One `ElementGL` WebGL 2 context (`/lib/element-gl.js`) sets `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at creation and inside `onRestored`, gates `stage.upload()` on `hasPainted = true` inside `paint`, calls `stage.begin()` ahead of uploads, and composites both textures in `CLOCK_FRAG` using `atan(d.x, -d.y)` across `Single hand`, `Bow-tie dual blades` and `Quad Iris`. A circular dial drag on `#cw-canvas` scrubs `0°..360°` with a `selectstart` guard outside inputs, `IntersectionObserver` and `document.hidden` pause sweep playback, `draw2DFallback()` clips polar wedges with 5-argument `drawElementImage()` calls, and `#plain-host` recovers on missing API support or `webglcontextlost`.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#cw-scene-a` and `#cw-scene-b` via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `280x220` fixture (`glErr=0`, `sceneA=735x578 rgb(234,222,201)`, `sceneB=735x578 rgb(11,21,38)`). Live `412x915` stage stayed at `994x987` (`0.98 MP`, `7.8 MB` initial, `8.1 MB` peak across checks), `1` live WebGL context (`peak 2`), `0` lost contexts, `0` open snapshots. |
| Does the polar `atan()` cut split cleanly at `90°` and `270°` with a luminous glass arm peak? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed via `readPixels()`: at `90°`, NE measured luminance `20` (Scene B), NW measured `223` (Scene A), and the East `90°` arm peaked at `255`; at `270°`, SW measured `20`, NW stayed `223`, and the West `270°` arm peaked at `255` (`glErr=0`). |
| Do `Single hand`, `Bow-tie dual blades` and `Quad Iris` match polar symmetry, and does `tMs` sweep timing work deterministically? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `createSweepController()` reached `180°` at midpoint (`tMs=1600`), finished at `360°` (`tMs=2200`), and snapped to `0°` in 1 call under reduced motion. At `180°`, `Single hand` gave `NE=20, SW=223`, `Bow-tie` gave `NE=20, SW=20, SE=223`, and `Quad Iris` gave `20°=20, 70°=223`. |
| Does sector-aware `updateElementGeometry()` keep controls clickable at `0°`, `135°` mid-sweep and `360°`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`0°`: `NW=true, InA=true`; `135°`: `B_NE=true, A_NW=true`; `360°`: `NW=true, InB=true`; `clicks A=2, B=2`). Live CDP clicks at `135°` drove `#b-btn-ne` (`190 km/h`), `#a-btn-nw` (`08:21 Harbour`) and `#a-input-sw` (`Note: Metro Express 7`), and circular dial drag scrubbed to `270°` with empty text selection. |
| Do synthetic `webglcontextlost`/`webglcontextrestored` and 5-argument 2D wedge clipping pass without sizing warnings? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainLost=true`, `plainHits=true/true`, `restored=true`, `glErr=0`, `2dNE=20`, `2dNW=223`, `drawWrong=0`). Live `?route=2d` passed `6/6` checks with `draws.wrong=0` and `draws.noSize=0`, and `stillDrawn()` returned `100.0%`. |
| Do plain-HTML fallback (`--disable-blink-features=CanvasDrawElement`) and `prefers-reduced-motion` behave cleanly at `412 px`? | measured (Chrome 160 Canary, 2026-11-27) | Plain fallback rendered both scenes stacked in `#plain-host` (`scrollWidth=412`, `Delayed (+2m)`, `190 km/h`, `0` errors). Emulating `prefers-reduced-motion: reduce` mounted `.motion-warn`, checked `#ctl-reduced` and snapped `Sweep` to `360°`; restoring `no-preference` removed the notice. |
| Real Android phone touch feel, `npm run check:jank` and Chromium 157 behaviour | not verified | Needs Chrome 159 on Android at `412 px` and a Playwright run of `npm run check:jank -- /clock-wipe/`. |

## Things that bit

- **Overlapping full-stage hit boxes during mid-sweep**: two full-canvas `drawable` scenes at `(0, 0)` block each other in DOM order if their root `<section>` containers keep `pointer-events: auto`. Setting `pointer-events: none` on `.cw-scene` inside the canvas and letting `syncGeometry()` toggle `inert` and `pointer-events` per quadrant control from `isPolarAngleInSceneB()` (plus toggling `dataset.hitTick`) lets `elementsFromPoint()` and real taps hit Scene B in revealed sectors and Scene A in unrevealed sectors simultaneously.
- **Wrapping across `180°` on the origin boundary**: evaluating angular origin distance with a single `mod(theta + period / 2, period)` wrapped `180°` ahead of `270°` into negative values. Using piecewise signed angular distance to `[0, bladeSweep]` (`min(localA, bladeSweep - localA)` inside, `-min(localA - bladeSweep, period - localA)` outside) removed the midpoint seam across 1, 2 and 4 blades.

## Not verified

- Chrome 159 on Android (`412 px` wide, `2.625` DPR): touch circular dial drag feel, real GPU shader frame rates, and soft keyboard focus inside `#a-input-sw` and `#b-input-se`.
- `npm run check:jank -- /clock-wipe/` and `node tools/draw-size/audit.mjs /clock-wipe/` (Playwright isn't installed in this environment).
- Headless Chromium 157 behaviour, `npm run build` and `node tools/social/capture.mjs /clock-wipe/`.

## For the index

- Transitions, text and motion (`motion`): `/clock-wipe/` sweeps one `ElementGL` WebGL 2 canvas between two live HTML cards across `Single hand`, `Bow-tie dual blades` and `Quad Iris` patterns behind a refracting prism glass leading arm (`0.98 MP`, `7.8 MB` at `412 px`, `6/6` checks in Chrome 160 Canary), keeping buttons and editable inputs in both scenes clickable mid-sweep via sector-aware `updateElementGeometry()` (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`).
