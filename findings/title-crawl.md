# 3D opening title crawl (`/title-crawl/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x780` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /title-crawl/`), social tag match, and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed here), and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas render a true 3D perspective receding opening title crawl from a live editable multi-paragraph HTML article and interactive action buttons, fading smoothly into a deep starfield horizon while keeping the scrolled and tilted DOM clickable via projective `updateElementGeometry()`?

## What was built

One `<canvas id="crawl-canvas" content="drawable" layoutsubtree>` inside `.crawl-viewport` (`16 / 10` up to `460 px` on desktop, `470 px` capped at `68svh` below `620 px`, with zero `dvh`) containing a live `drawable` `<article id="crawl-article">` (`400 x 729` CSS px, `1050 x 1915` backing texture at `2.625` DPR):

- **Cinema-yellow editable DOM (`#crawl-article`)**: tracked eyebrow label, live `<input id="crawl-episode">` heading, display `<h2>`, justified opening narrative, inline chapter buttons (`Act I`, `Jump to Act II`, `Pause crawl`, `Restart from Act I`), state badge, editable `<textarea id="crawl-textarea">`, and semantic Act III HTML copy.
- **One `ElementGL` WebGL 2 context (`/lib/element-gl.js`)**: `UNPACK_PREMULTIPLY_ALPHA_WEBGL` set to `true` at context creation, in `onRestored`, and in every fixture; uploads gated on `hasPainted = true` inside `paint`, calling `stage.begin()` before `stage.upload(articleEl)`; `LINEAR_MIPMAP_LINEAR` + up to 8x `EXT_texture_filter_anisotropic` + `gl.generateMipmap(gl.TEXTURE_2D)` applied after upload, plus a 4-tap rotated supersample when `fwidth` exceeds `1.25` texels per pixel.
- **External playback and geometry controls**: `Play` / `Pause`, `Flat 0° (Edit)`, `55° Crawl`, `Tilt angle` (`0°` to `68°`), `Crawl speed` (`0.2x` to `3.0x`), `Progress` (`0%` to `100%`), and `Reduced motion`.
- **Fallbacks**: 26 clipped horizontal strips via 5-argument `drawElementImage()` when `texElementSubImage2D()` is absent, and plain-HTML extraction into `#plain-host` when HTML-in-canvas is missing or `webglcontextlost` fires.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#crawl-article` via `texElementSubImage2D()`, build mipmaps and draw with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `240x180` fixture (`tex=840x1630`, `glErr=0`, centre `[230,188,20,255]`, deep space `[3,4,8,255]`). |
| Does `uMvp` narrow the crawl into a receding 3D trapezoid and fade into the top horizon? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed at `58°` tilt: lower foreground span `162 px` (`maxR=230`), upper receding span `124 px` (`maxR=179`), top horizon `maxR=8`. |
| Does advancing `progress` shift DOM pixels upward into distance without re-uploading? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed at `55°` tilt using the cached texture: stripe centroid rose from `y=144.0 px` (`prog=16%`) to `y=89.0 px` (`prog=36%`). |
| Does projective `updateElementGeometry()` scaled by `geometryUnit()` keep buttons clickable at `0°` and tilted angles? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on fixture (`0°` at `(140.0, 107.6)` and `50°` at `(140.0, 67.7)` both hit `BUTTON`), and `elementsFromPoint()` on the live page hit `#btn-jump-act2` at both `0°` and `55°` (`95.6 x 18.1 px` foreshortened button box). |
| Does `webglcontextlost` rescue to plain HTML and `webglcontextrestored` recover `ElementGL`? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed on synthetic cancelable `webglcontextlost` and `webglcontextrestored` (`texAfter=841x1628`, `glErr=0`). |
| Does the stage stay drawn, within canvas memory rules, and stable under 4x CPU throttle at `412x780` @ `2.625` DPR? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%`). Idle 3.5 s throttled run measured `cls=0`, `scrollX=0`, `scrollY=0`, `focusMoves=0`, `scrollW=412 === innerW=412`, `1` WebGL context alive (`9.8 MB`, `1.22 MP` `992x1234` buffer, `0` unasked readbacks, `0` lost). |
| Does the 5-argument `drawElementImage()` 2D strip fallback work without WebGL 2? | measured (Chrome 160 Canary, 2026-11-27) | With `texElementSubImage2D` deleted via init script, the 2D fallback drew `4.9 MB` (`1.22 MP`), Check 4 (`updateElementGeometry`) and Check 6 passed, `0` console/page errors. Horizontal affine strips left visible slice seams across large display letters and borders. |
| Does the plain-HTML fallback stay legible without horizontal overflow? | measured (Chrome 160 Canary, 2026-11-27) | With `drawElementImage` deleted via init script, `.crawl-stage.is-plain` moved `#crawl-article` into `#plain-host` (`0.0 MB` canvases, `scrollW=412 === innerW=412`). |

## Things that bit

- **Keeping `w > 0` across the whole tall article at `68°` tilt and `0%` progress**: a tall crawl extending too close to the camera puts bottom vertices behind `camZ` (`w_clip <= 0`), which breaks `DOMMatrix` hit testing. Placing the camera at `camZ = 4.9` (`33°` desktop FOV, widening dynamically on narrow portrait viewports so bottom width spans ~85%) and interpolating `sStart` cleanly between `0°` flat edit view and `55°` tilted crawl keeps `w > 1.4` everywhere from `0°` to `68°`.
- **Placing controls below the stage on a phone**: placing the button bar and three range sliders above `.crawl-stage` pushed the top of the canvas to `y = 671 px` on a `412x780` screen. Moving `.toolbar` and `.sliders` below `.crawl-stage` and moving `#stage-hud` out from over the canvas into a slim footer bar brings the entire receding crawl onto the first phone screen without covering bottom lines.
- **Check 3 stripe vanishing into the horizon**: an early stripe fixture at `top: 170 px` hit the `screenY > 0.54` horizon fade before `progress = 48%` and faded to `0` samples. Placing the stripe at `top: 260 px` and sampling `16%` vs `36%` kept it bright and distinct while rising `55 CSS px`.
- **Avoiding per-frame DOM re-uploads**: keeping progress percentages out of `#crawl-chapter-badge` inside the `drawable` DOM (`#stage-hud` outside the canvas shows `progress %`) keeps `texElementSubImage2D()` uploads at `3` during normal playback rather than 60 per second.

## Not verified

- Headless Chromium 157 and `npm run check:jank -- /title-crawl/` (`playwright` isn't installed in this environment).
- Chrome 159 on Android at 412 px and 2.625 DPR: real GPU mipmap/anisotropic frame rate, touch-tapping tilted buttons while moving, and on-screen keyboard opening on `#crawl-episode` and `#crawl-textarea`.

## For the index

- 3D, spatial and WebXR: `/title-crawl/` maps a live editable multi-paragraph HTML `<article>` and buttons onto a receding Star Wars-style 3D crawl plane using one `ElementGL` WebGL 2 context (`texElementSubImage2D()`, mipmaps + anisotropic filtering, horizon fade over a procedural starfield) and projective `updateElementGeometry()`.
