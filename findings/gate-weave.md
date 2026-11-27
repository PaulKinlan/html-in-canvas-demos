# 35mm projector gate weave, splice and changeover cue (`/gate-weave/`)

Measured in headless Chrome 160 Canary (`160.0.8188.0`, `HeadlessChrome/160.0.0.0`) on 2026-11-27 at `412×915` with device scale factor `2.625`, touch emulation enabled and SwiftShader WebGL (`--enable-blink-features=CanvasDrawElement`). Syntax check (`node --check`), graphics rules (`check:gfx`), social metadata (`validate.mjs`), writing check (`--strict`), live-stage inspection (`927×1288`, `1.19 MP`, `9.55 MB`, `0` console/page errors, `0` horizontal overflow), 2D fallback check (`0` wrong-size draws) and `6/6` live checks all passed. Headless Chromium 157, `npm run check:jank -- /gate-weave/`, `node tools/draw-size/audit.mjs /gate-weave/` and Chrome 159 on Android are **not verified** yet.

The question: can one `ElementGL` WebGL 2 canvas emulate a real 35mm cinema projector gate over a live editable screenplay card with 24 fps stepped weave, red-orange emulsion halation, dust scratches, a film splice jump and a top-right changeover cue?

## What was built

One `<canvas id="gate-canvas" content="drawable" layoutsubtree>` inside `.gate-viewport` (`max-width: 640px`, `452 px` tall, `492 px` below `520 px` with no `dvh`, `927×1288 px` / `1.19 MP` at `412 px` wide and `2.625` DPR) framing one live `drawable` card (`#reel-card`):

- **Clapperboard header & live timecode:** angled black/white slate stripes, `Reel 01` / `Reel 02`, `Take` counter, film stock pill (`5219 500T` / `2383 PRINT`), and `24 fps` SMPTE frame counter `<output id="frame-counter">`.
- **Editable screenplay fields:** `<input id="scene-heading">` and `<textarea id="scene-dialogue">` with `user-select: text` inside a `user-select: none` stage, plus a `16 s` reel changeover progress meter and three clickable card buttons (`Mark slate`, `Trigger splice`, `Switch reel`).
- **External projector controls:** `24 fps telecine` / `60 fps` cadence toggle, `Gate weave` slider (`0% to 200%`), `Halation` slider (`0% to 150%`), `Trigger splice`, `Changeover cue` and `Reduced motion` toggle (synced with `(prefers-reduced-motion: reduce)`).
- **Single-context `ElementGL` shader (`GATE_FRAG`) and fallbacks:** sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` at creation and on restore, gates uploads on `hasPainted = true` inside `'paint'`, calls `stage.begin()` before `stage.upload()`, pauses when off-screen or hidden, falls back to five-argument `drawElementImage()` in 2D and moves `#reel-card` to `#plain-host` on `webglcontextlost`.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does `ElementGL` upload `#reel-card` via `texElementSubImage2D()` and hold 24 fps stepped gate weave within each `1/24 s` slot? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`gl.getError() === 0/0`, `tex=630×420`): edge pixels at `t = 1.005 s` and `t = 1.035 s` inside frame 24 were identical (`[12,16,12,213,255,255,255]`), while frame 30 (`t = 1.255 s`) shifted to `[17,15,14,18,255,255,255]`. |
| Does red-orange emulsion halation scatter a warm halo outside bright DOM boxes? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`gl.readPixels()` 5 px outside a `#ffffff` box on `#100e0d`): `off rgb(12,9,8)` rose to `rgb(58,20,10)` at `uHalation = 1.2`. |
| Does the top-right reel changeover cue mark render when triggered? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `offRim rgb(18,14,12)` switched to `onCore rgb(12,6,4)` and glowing `onRim rgb(255,195,90)`. |
| Does `updateElementGeometry()` + `dataset.hitTick` keep live card buttons clickable under weave offsets? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`shiftedHit=true`, `oldCornerHit=false`, `clicks=1`). Live stage hit check on `#btn-slate` at `412 px` also succeeded. |
| Does `webglcontextlost` fall back to plain HTML and `webglcontextrestored` recover `ElementGL`? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed on synthetic cancelable `webglcontextlost` and `webglcontextrestored` (`err=0`, zero `loseContext()` calls). |
| Does the visible stage stay drawn with low context count and zero wrong-size 2D draws? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%` drawn, `active=1`, `peak=2`, `released=5`, `reads.unasked=0`). Separate 2D fallback run (`texElementSubImage2D` deleted) reported `927×1286 px` and `draws.wrong=0`. |

## Things that bit

- **Halation washing out dark ink inside cream screenplay paper:** weighting the `2.4 px` inner halation ring heavily (`1.45`) with `0.45 + 0.95 * shadowMask` turned dark ink letters inside `#scene-heading` and `#scene-dialogue` bright red-orange because every neighbour inside the cream box was bright. Shifting weight towards the `6 px` and `12 px` rings and tuning the scatter scale to `0.28 + 0.65 * shadowMask` kept ink crisp while preserving warm outer halation (`+46` red at `5 px` outside a white box).
- **Keeping normal weave clear of the texture border while splicing across the frame line:** setting the stationary gate mask inset (`uGatePad` `11×13 px` narrow, `18×16 px` wide) larger than maximum normal weave displacement (`~7 px`) keeps steady 24 fps weave from wrapping the card edge, while a `46 px` splice impulse intentionally pulls the `wrapY` black 35mm inter-frame bar and translucent Mylar tape seam into view.
- **Mobile 412 px textarea fit:** initial dialogue copy wrapped to four lines at `353 px` card width and triggered an internal textarea scrollbar (`scrollHeight = 84` vs `82`). Trimming three words and increasing the narrow-screen `<textarea>` min-height to `84 px` removed visual clipping across all buttons and fields inside `.slate-frame` (`456/456 px`).

## Not verified

- Headless Chromium 157, `npm run check:jank -- /gate-weave/`, and `node tools/draw-size/audit.mjs /gate-weave/` (Playwright is not installed in this container and running `build.mjs` was withheld).
- Chrome 159 on Android at `412 px` touch: real hardware GPU frame pacing at `24 fps` vs `60 fps`, touch scrolling over `#gate-canvas` vs soft-keyboard editing inside `#scene-heading` and `#scene-dialogue`, and visual appearance of halation on hardware display panels.
- Browser-level `prefers-reduced-motion: reduce` media query startup state (tested via the `#reduced-toggle` UI control, which held uploads steady at `101 -> 101`).

## For the index

- Video and sound (`media`): `/gate-weave/` projects a live editable 35mm screenplay and clapperboard card through one `ElementGL` WebGL 2 canvas with `24 fps` stepped sprocket gate weave, red-orange emulsion halation, grain, dust scratches, a splice frame jump and a top-right reel changeover cue while syncing hit boxes with `updateElementGeometry()`.
