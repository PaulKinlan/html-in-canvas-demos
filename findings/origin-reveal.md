# Tap-origin circular optical theme reveal (`/origin-reveal/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` and `412x836` viewports, device scale factor `2.625`, touch emulation, SwiftShader WebGL, and `1024x900` at `1` DPR), plus `?route=2d` and `--disable-blink-features=CanvasDrawElement`. Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /origin-reveal/`), strict docs writing check (`node tools/writing/check.mjs --docs --strict`), social metadata check (`node tools/social/validate.mjs /origin-reveal/`) and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed in this environment) and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas switch live HTML theme surfaces from any tapped corner button, centre pill or stage coordinate using a circular optical mask with radial magnification, chromatic dispersion and `updateElementGeometry()` hit testing?

## What was built

One `<canvas id="or-canvas" content="drawable" layoutsubtree>` inside `.or-viewport` (`416 px` tall desktop, `396 px` tall at `<= 620 px` with `max-height: 70svh` and zero `dvh`, `992x1040` / `1.032 MP` / `7.87 MB` initial at `412 px` and `2.625` DPR) compositing two full-stage `drawable` HTML workspaces (`#or-surface-a` and `#or-surface-b`) that cycle across `Daylight Paper`, `Midnight Studio` and `Forest Ink`:

- Each panel renders four corner pills and one centre pill (`Switch theme from here`), a shared sample counter (`+1` and `Reset`), filter buttons (`All`, `Optics`, `Input`) and an editable `<input>` (`user-select: text` inside a `user-select: none` + `selectstart`-guarded stage).
- One `ElementGL` WebGL 2 context (`/lib/element-gl.js`) sets `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at creation and inside `onRestored`, gates `stage.upload()` on `hasPainted = true` inside `paint` after calling `stage.begin()`, and runs `ORIGIN_FRAG` with `r = progress * maxCornerDist(ox, oy)`.
- Along `r ± ringW`, the shader applies radial bevel magnification, splits R/G/B texture lookups along the radial normal, adds a faint outer meniscus darkening against bright paper plus a specular rim glint, and pauses under `IntersectionObserver`, `document.hidden` and `prefers-reduced-motion: reduce`.
- Without WebGL 2, `draw2DFallback()` clips Surface B into a circle over Surface A via 5-argument `drawElementImage()`, and `#plain-host` renders both workspaces if the API is off or `webglcontextlost` persists.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#or-surface-a` and `#or-surface-b` via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`glErr=0`, `surfA=735x578 rgb(245,237,224)`, `surfB=735x578 rgb(9,17,32)`). Live `412x915` stage stayed at `992x1040` (`1.032 MP`, `7.87 MB` initial, `8.11 MB` peak across checks), `1` live WebGL context (`peak 2`), `0` lost contexts, `0` open snapshots. |
| Does `createOriginController()` step deterministically on `tMs` and flip top-left vs bottom-right corners first? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`tMs mid=0.50`, `rev=0.50`, instant snap under reduced motion). At `42%`, origin `(0.12, 0.14)` gave `TL=16, BR=238`, while origin `(0.88, 0.86)` flipped them to `TL=238, BR=16` (`glErr=0`). |
| Does the `50%` lens circumference show specular glint, RGB dispersion and radial UV refraction? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed via `readPixels()`: inside measured `16`, outside `238`, rim peak hit `255`, inner cyan dispersion measured `B - R = 80`, outer warm dispersion measured `R - B = 61`, and comparing `ringW = 20` against `ringW = 0` gave radial delta `159` (`glErr=0`). |
| Does `updateElementGeometry()` isolate live hit testing at `0%`, `50%` mid-reveal and `100%`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`0%`: `TL=true, InA=true`; `50%`: `B_TL=true, A_BR=true`; `100%`: `BR=true, InB=true`; `clicks A=2 B=2`). Live taps on `#a-pill-tl`, `#b-pill-br` and empty stage updated `(ox, oy)` cleanly and cycled `Daylight Paper` -> `Midnight Studio` -> `Forest Ink`. |
| Do synthetic `webglcontextlost`/`webglcontextrestored` and 5-argument 2D radial clipping pass without sizing warnings? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainLost=true`, `plainHits=true/true`, `restored=true`, `glErr=0`, `2dIn=16`, `2dOut=238`, `drawWrong=0`). Live `?route=2d` passed `6/6` checks with `draws.wrong=0` and `draws.noSize=0`, and `stillDrawn()` returned `100.0%`. |
| Do plain-HTML fallback (`--disable-blink-features=CanvasDrawElement`) and `prefers-reduced-motion` work cleanly at `412 px`? | measured (Chrome 160 Canary, 2026-11-27) | Plain fallback rendered both surfaces in `#plain-host` (`scrollWidth=412`, `Samples: 1`, `0` errors). Emulating `prefers-reduced-motion: reduce` checked `#ctl-reduced` and snapped reveals straight to `100%`. CLS stayed `0` across `412x780` to `412x836` resize. |
| Real Android phone touch feel, `npm run check:jank` and Chromium 157 behaviour | not verified | Needs Chrome 159 on Android at `412 px` and a Playwright run of `npm run check:jank -- /origin-reveal/`. |

## Things that bit

- **Test stage height clipping plain-mode bottom pills**: `testStage()` in `shared/support.js` is fixed at `340 px` tall with `overflow: hidden`. Stacking the canvas plus two `150 px` fallback panels vertically pushed Surface B's bottom-right pill past `340 px` (`plainHits=true/false`). Hiding the canvas during the plain loss check (matching `.is-plain #or-canvas { display: none; }`) and laying both plain panels side by side in a 2-column grid kept both surfaces inside `testStage()` and restored `plainHits=true/true`.
- **Zero-flash three-theme cycling across two DOM surfaces**: Promoting `destTheme` onto `#or-surface-a` and assigning the next theme onto `#or-surface-b` mutates both DOM trees before `texElementSubImage2D()` has fresh pixels. Holding `progress = 1.0` until the next `paint` event fires (`pendingReveal`) lets `stage.upload()` refresh both textures first and start the new `0 -> 1` wave in the same frame with zero flicker.

## Not verified

- Chrome 159 on Android (`412 px` wide, `2.625` DPR): touch tap-origin responsiveness, GPU frame rates and soft keyboard input in `#a-input` and `#b-input`.
- `npm run check:jank -- /origin-reveal/` and `node tools/draw-size/audit.mjs /origin-reveal/` (Playwright isn't installed in this environment).
- Headless Chromium 157 behaviour, `npm run build` and `node tools/social/capture.mjs /origin-reveal/`.

## For the index

- Transitions, text and motion (`motion`): `/origin-reveal/` composites two live HTML workspaces across `Daylight Paper`, `Midnight Studio` and `Forest Ink` on one `ElementGL` WebGL 2 canvas (`1.03 MP`, `7.87 MB` initial at `412 px`, `6/6` checks in Chrome 160 Canary), expanding a circular optical lens from the exact tapped pill or stage coordinate with radial magnification, RGB dispersion and `updateElementGeometry()` hit sync (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`).
