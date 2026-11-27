# Radial pie menu with wedge warp (`/pie-menu/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /pie-menu/`), social metadata check (`node tools/social/validate.mjs /pie-menu/`) and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed in this environment) and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas draw a Blender-style radial pie menu of live HTML `<button>` items over a workspace card, complete with a frosted glass ring, directional selection beam, spring detent wedge stretch and calibrated `updateElementGeometry()` click hit boxes?

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#pm-workspace` and `#pm-ring` via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `280x280` fixture (`glErr=0`, `ws=735x735`, `ring=830x830`, `wedge0=[164,164,171,255]`). On the live `412x915` page at `2.625` DPR, canvas stays `994x914` (`0.91 MP`, `7.3 MB`), `1` WebGL context alive (`peak 2` during checks), `0` lost contexts, `0` open snapshots. |
| Does polar pointer angle (`0°`, `120°`, `240°`) shift the selection beam and wedge glow to distinct quadrants? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed via `readPixels()` sampling `r = 38 px`: `0°` -> `[561/110/108]`, `120°` -> `[105/561/108]`, `240°` -> `[105/110/561]` (`glErr=0`). |
| Does the wedge spring detent settle deterministically with explicit timestamps and snap under reduced motion? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `0°` settled in `38` frames (`pull=13.0 px`), `120°` settled in `38` frames (`pull=13.0 px`), and `240°` under reduced motion snapped in `1` step. |
| Does `updateElementGeometry()` + `geometryUnit()` keep repositioned and spring-pulled wedge buttons clickable? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on a repositioned ring (`185, 148`) with `120°` wedge detent applied (`elementsFromPoint(142.5, 802.5)` hit `<button data-cmd="invert">`, `geometryUnit=1.000`, `rect=93x47`, `clicked=true`). Live CDP clicks also drove `Rotate` (`45°`), `Grid` (`On`) and a tap-drag flick to `Tint Cyan (#3)`. |
| Does synthetic `webglcontextlost`/`webglcontextrestored` recover cleanly, and does the 5-arg 2D fallback draw without sizing warnings? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainDuringLoss=true`, `plainHit=true`, `restored=true`, `texAfter=830x830`, `glErr=0`, `2dInk=100%`). Live `?route=2d` passed `6/6` checks with `draws.wrong=0` and `draws.noSize=0`. |
| Does plain-HTML fallback (`--disable-blink-features=CanvasDrawElement`) stay usable at `412 px`? | measured (Chrome 160 Canary, 2026-11-27) | `.pm-stage.is-plain` arranged `#pm-ring` as a 3x2 grid below `#pm-workspace` (`0.00 MP`, `scrollWidth=412 === innerWidth=412`, clicking `Rotate` updated `#stat-rot` to `45°`, `0` errors). |
| Does `prefers-reduced-motion: reduce` toggle `.motion-warn` cleanly and restore when turned off? | measured (Chrome 160 Canary, 2026-11-27) | Emulating `prefers-reduced-motion: reduce` mounted `.motion-warn` and checked `#ctl-reduced`; reverting to `no-preference` removed `.motion-warn` and unchecked `#ctl-reduced`. |

## Things that bit

- **`position: absolute; inset: 0;` shrink-wrapping inside `layoutsubtree`**: sizing `#pm-workspace` with `position: absolute; inset: 0;` inside `<canvas content="drawable" layoutsubtree>` caused Chromium to shrink-wrap the element to its intrinsic content height (`~210 px` on the `379x376` canvas, and `144x184` inside the `280x280` fixture), stretching the uploaded workspace text vertically when mapped across the full quad. Switching `#pm-workspace` to `position: relative; width: 100%; height: 100%;` (and setting explicit `width`/`height` in test fixtures) matched the canvas aspect ratio 1:1 (`735x735` for `280x280` at `2.625` DPR).
- **Captures in deterministic spring checks**: logging `fx.s.wedges[0].pull` at the end of Check 3 printed `0.0` after the pointer had already moved to `120°` and `240°`. Capturing `pull0` immediately after the `0°` settle loop keeps the reported readout aligned with what was asserted.

## Not verified

- `npm run check:jank -- /pie-menu/` (`playwright` is not installed in this environment).
- Real Chrome 159 on Android (`412 px`, `2.625` DPR): touch drag-flick feel, real GPU shader frame rates, and tab context pressure alongside other pages.
- Headless Chromium 157 behaviour.

## For the index

- Custom input and navigation (`input`): `/pie-menu/` renders a six-button radial HTML pie menu over a workspace target card in one `ElementGL` WebGL 2 canvas (`0.91 MP`, `7.3 MB` at `412 px`, `6/6` checks in Chrome 160 Canary), pairing a frosted glass ring, directional selection beam and spring barrel-bulge warp with `updateElementGeometry()` click alignment (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`).
