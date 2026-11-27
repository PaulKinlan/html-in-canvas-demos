# Venetian shutter-blinds 3D slat flip (`/shutter-blinds/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /shutter-blinds/` and `--docs --strict`), social metadata validation (`node tools/social/validate.mjs /shutter-blinds/`) and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed in this environment) and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas slice two live `drawable` HTML views into 4 to 24 pivoting 3D Venetian slats across horizontal, vertical and diagonal axes, swapping front and back faces unmirrored at 90° with cosine shading and dark louver gaps while keeping controls interactive at 0% and 100%?

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#sb-scene-a` and `#sb-scene-b` via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `240x240` fixture (`glErr=0`, `texA=630x630`, `texB=630x630`, `center=[245,158,11,255]`). On the `412x915` page at `2.625` DPR, canvas stays `948x1078 px` (`1.02 MP`, `8.18 MB`), `1` WebGL context alive (`peak 2` during checks), `0` lost contexts, `0` open snapshots. |
| Does the staggered phase wave at `50%` show Sheet B on leading slats, a dark louver gap in the middle and Sheet A on trailing slats? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed with `createBlindsWave()` `tMs` stepping (`mid=0.50` at `1475 ms`, `end=1` at `1950 ms`, reduced-motion snap at `2000 ms`) and `readPixels()` at `50%` (`stagger=0.55`): slat 0 read `[14,165,233]` (Sheet B), middle gap read `gapLum=11`, slat 5 read `[239,68,68]` (Sheet A). |
| Does cosine diffuse shading darken turning slats while keeping Sheet B unmirrored across `90°`? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed via `readPixels()`: turning slats dropped luminance from `137` (`180°`) to `69` (`119°`), while asymmetric lime/rose patterns stayed unmirrored across horizontal (`topG=100`, `botR=115`) and vertical (`leftG=176`, `rightR=201`) louvers. |
| Does `updateElementGeometry()` + `geometryUnit()` route live clicks and input focus at `0%` and `100%`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`0%`: `btnA=true`, `inputA=true`, `clicks=1`; `100%`: `btnB=true`, `inputB=true`, `clicks=1`). Live CDP clicks and typing also updated `#sb-out-a` (`1 saved`), `#sb-input-a`, `#sb-out-b` (`1 pulse`) and `#sb-input-b`, and swipe drags scrubbed from `100%` back to `0%`. |
| Does synthetic `webglcontextlost`/`webglcontextrestored` recover cleanly, and does the 5-arg 2D strip fallback draw without sizing warnings? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainDuringLoss=true`, `plainHit=true`, `restored=true`, `texAfter=578x525`, `glErr=0`, `2dInk=100%`, `wrongDraws=0`). Live `?route=2d` rendered 10 diagonal strips at `50%` (`1.02 MP`, `draws.wrong=0`, `draws.noSize=0`). |
| Does plain-HTML fallback (`--disable-blink-features=CanvasDrawElement`) stay usable at `412 px`? | measured (Chrome 160 Canary, 2026-11-27) | `.sb-stage.is-plain` toggled cleanly between `#sb-scene-a` and `#sb-scene-b` on `Flip blinds`, answered clicks (`1 pulse`), held `scrollWidth=412 === innerWidth=412`, `0` errors. |
| Does `prefers-reduced-motion: reduce` sync `#chk-reduced` and snap flips cleanly? | measured (Chrome 160 Canary, 2026-11-27) | Emulating `prefers-reduced-motion: reduce` checked `#chk-reduced` and snapped `Flip blinds` to `100%` immediately; reverting to `no-preference` unchecked `#chk-reduced`. |

## Things that bit

- **Plain-HTML fallback ignoring `Flip blinds` clicks**: in `triggerFlip()`, calling `wave.startFlip(toTarget)` while `isReduced()` was `false` queued an animation loop before returning early for `state.backend === 'plain'`, leaving `wave.s.progress` at `0` because plain mode runs no `requestAnimationFrame` loop. Snapping straight via `wave.snapTo(toTarget)` when `state.backend === 'plain'` fixed plain-HTML view switching immediately.
- **Unmirrored back-face projection across `90°`**: rotating a slat 180° around its local tangent flips the sign of its cross-hinge axis (`cos(180°) = -1`), which would mirror Sheet B unless the shader negates the cross-hinge coordinate (`sCenter - uHit`) on back-face hits.
- **Nested viewport border**: putting a `1px` border on `.sb-scene-a` and `.sb-scene-b` inside `.sb-viewport`'s `1px` border drew a faint double frame around the canvas. Moving the scene border rule under `.sb-stage.is-plain` keeps the canvas edge flush while framing plain-HTML mode.

## Not verified

- `npm run check:jank -- /shutter-blinds/` (`playwright` isn't installed in this environment).
- Real Chrome 159 on Android (`412 px`, `2.625` DPR): touch swipe feel across horizontal, vertical and diagonal axes, on-screen keyboard inside `#sb-input-a` and `#sb-input-b`, and hardware GPU frame timing.
- Headless Chromium 157 behaviour.

## For the index

- Transitions, text and motion (`motion`): `/shutter-blinds/` slices two live HTML views into 4 to 24 3D pivoting slats across horizontal, vertical and diagonal axes in one `ElementGL` WebGL 2 canvas (`1.02 MP`, `8.18 MB` at `412 px`, `6/6` checks in Chrome 160 Canary), with staggered phase delay, cosine shading, rim bevels, unmirrored 90° back-face swaps, `updateElementGeometry()` hit-box sync and a 5-argument 2D strip fallback (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`).
