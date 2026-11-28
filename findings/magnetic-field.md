# Magnetic pointer attraction on dock buttons (`/magnetic-field/`)

Measured on 2026-11-27 in `HeadlessChrome/160.0.0.0` (Google Chrome `160.0.8188.0` canary at `412x915`, device scale factor `2.625`, touch emulation, SwiftShader WebGL) across default WebGL 2, `?route=2d`, `--disable-blink-features=CanvasDrawElement` and emulated `prefers-reduced-motion: reduce`. Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing checks (`node tools/writing/check.mjs --strict /magnetic-field/`), social metadata validation (`node tools/social/validate.mjs /magnetic-field/`) and `npm run check:pages` all passed. Headless Chromium 157 (`npm run check:jank`, Playwright isn't installed here) and Chrome 159 on Android (A159) are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas pull five live `drawable` HTML dock buttons toward a pointer with directional liquid stretch, glowing magnetic flux lines, damped spring recoil past an escape threshold and `updateElementGeometry()` hit testing?

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#mf-backdrop` and five `drawable` buttons (`#mf-item-0` .. `#mf-item-4`) via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `340x240` fixture (`glErr=0`, `bg=893x630`, `tile0=142x174`, `centersAlpha=[255,255,255,255,255]`). On the live `412x915` page at `2.625` DPR, canvas backing store is `994x798` (`0.79 MP`, `6.35 MB` initial, `6.48 MB` peak), `1` WebGL context alive (`peak 2` during checks), `0` lost contexts, `0` open snapshots. |
| Does pointer proximity displace pulled button pixels and illuminate Pass 0 magnetic flux vs rest? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed via `readPixels()`: `glErr=0`, `dy=-37.8 px`, tile probe luminance rose `16->46`, Pass 0 flux midpoint rose `16->142`. |
| Does crossing the `120 px` escape threshold trigger damped elastic recoil back to origin under explicit `tMs` steps? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `pulled dy=-30.4 px` (`39` frames), crossing to `138 px` recoiled with `+7.8 px` overshoot before settling in `60` frames, and `reduced = true` snapped `-30.4 px` in `1` step. |
| Does `updateElementGeometry()` + `geometryUnit()` keep magnetically displaced buttons clickable at their pulled coordinates? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`dx=4.5, dy=-35.1, geometryUnit=1.000, movedHit=true, vacatedMiss=true, clicks=1`). Live CDP clicks under **Hover preset** landed on displaced `Slice` (`#mf-count-2 = 1`) and `Brush` (`#mf-count-1 = 1`, `Brush · 2 clicks`). Touch drag reached `Peak pull: 32.0 px` (`2/5` engaged) and released cleanly on `touchEnd`. |
| Do synthetic `webglcontextlost`/`webglcontextrestored`, 5-arg 2D fallback (`?route=2d`) and plain HTML fallback (`CanvasDrawElement` disabled) work at `412 px`? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainDuringLoss=true, plainHit=true, restored=true, texAfter=116x142, glErr=0, 2dInk=100%`), Check 6 (`stillDrawn()`) passed (`100.0%`), `?route=2d` passed `6/6` checks (`draws.wrong=0, draws.noSize=0`), and plain HTML kept `scrollWidth=412 === innerWidth` with `Slice` clicking cleanly (`#mf-count-2 = 1`, `0` errors). |
| Does `prefers-reduced-motion: reduce` sync `#ctl-reduced` cleanly and restore when cleared? | measured (Chrome 160 Canary, 2026-11-27) | Emulating `prefers-reduced-motion: reduce` checked `#ctl-reduced` (`true`); reverting to `no-preference` unchecked it (`false`). Notice `learn.js` doesn't mount `.motion-warn` until `npm run build` adds `/magnetic-field/` to `public/shared/pages.js`. |

## Things that bit

- **Adjacent dock buttons converging on one point**: pulling three neighbouring buttons (`Brush`, `Slice`, `Magnet`) directly toward a single overhead probe initially stacked `Magnet` over `Slice` and `Slice` over `Brush`. Adding a three-pass pairwise separation step in `evaluateTargets()` plus sorting Pass 1 and `syncGeometry()` by displacement ascending keeps all five buttons readable and clickable at once while putting the closest button on top.
- **Separation pass running on resting tiles**: when the fixture spacing (`66 px` pitch on `64 px` tiles) was narrower than `tileW + 3`, running pairwise separation between unengaged tiles nudged tile 2's resting `targetDx` to `-0.20 px`. Skipping pairs where neither tile is engaged and clamping `minSep` to `Math.min(tw + 2, b.restX - a.restX)` keeps resting offsets at exact `(0, 0)`.
- **Header wrapping at `412 px`**: placing a `Dock field` label beside the editable mode pill and click summary pushed the header onto two rows on a `412 px` screen (`~68 px` tall). Keeping `#mf-mode-pill` and `#mf-summary-pill` alone on `.mf-head` fits one compact row with open arena space below.

## Not verified

- `npm run check:jank -- /magnetic-field/` and `node tools/draw-size/audit.mjs /magnetic-field/` (Playwright isn't installed in this environment).
- Real Chrome 159 on Android (`412 px` wide, `2.625` DPR, touch): touch drag feel across the `120 px` escape boundary, real GPU shader frame rates, soft-keyboard behaviour when editing `#mf-mode-pill` and WebGL context pressure alongside other pages.
- `.motion-warn` mounting from `<meta name="reduced-motion-note">` once `npm run build` adds `/magnetic-field/` to `public/shared/pages.js`, and `public/magnetic-field/social.jpg` capture via `node tools/social/capture.mjs /magnetic-field/`.

## For the index

- Custom input and navigation (`input`): `/magnetic-field/` renders five `drawable` HTML dock buttons (`#mf-item-0` .. `#mf-item-4`) plus `#mf-backdrop` in one `ElementGL` WebGL 2 canvas (`0.79 MP`, `6.35 MB` at `412 px`, `6/6` checks in Chrome 160 Canary), pulling tiles with directional liquid edge stretch, curving Pass 0 magnetic flux lines, damped elastic recoil past `120 px` and `updateElementGeometry()` click alignment (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`).
