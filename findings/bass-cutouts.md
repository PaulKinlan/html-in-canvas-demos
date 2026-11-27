# Saul Bass geometric paper-cutout credits (`/bass-cutouts/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 (412 px mobile viewport at device scale factor 2.625 with SwiftShader WebGL, plus `--disable-blink-features=CanvasDrawElement` and deleted `texElementSubImage2D` fallback probes). Static checks (`node --check`, `check:gfx`, `tools/writing/check.mjs --strict /bass-cutouts/`, `tools/social/validate.mjs /bass-cutouts/`) all pass. Headless Chromium 157 (`npm run check:jank -- /bass-cutouts/`) and Chrome 159 on Android at 412 px are **not verified** yet.

The question: can one `ElementGL` WebGL 2 canvas take live HTML title credits (condensed display title, editable inputs and clickable act pills) and chop, slide and mask them across Saul Bass geometric construction-paper cutouts, diagonal knife-edge shutters and tactile deckled paper grain while keeping the underlying credits editable and clickable?

## What was built

One `<canvas id="bass-canvas" content="drawable" layoutsubtree>` inside `.bass-viewport` (`max-width: 720 px`, `460 px` tall with zero `dvh`, `user-select: none` on the stage with `user-select: text` kept on `<input>` fields, `touch-action: pan-y` on the canvas) holding a live `<section id="credits-slate" drawable>` styled in off-white (`#f4ebd9`), terracotta (`#d54125`) and charcoal (`#191716`) construction-paper contrast with clickable `Act I`, `Act II`, `Act III` and `Finale` pills, a live condensed display title, and editable `Title` and `Director` `<input>` elements.

One WebGL 2 context created through `ElementGL` (`/lib/element-gl.js`) sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` at creation, in `onRestored` and in every test fixture, gates uploads on `hasPainted = true` inside the `'paint'` listener, calls `stage.begin()` before `stage.upload()`, and switches between three cutout motifs (`Shutters`, `Segmented blocks`, `Spiral iris`) plus a 5-argument `drawElementImage()` Canvas 2D `clip()` fallback and a `#plain-host` plain-HTML fallback on context loss or missing API.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| `ElementGL` + `texElementSubImage2D()` compiles `BASS_FRAG` across all 3 cutout motifs with `gl.getError() === 0` | measured (Chrome 160.0.8188.0 canary, 2026-11-27) | Live check 1 passed on `testStage()` (`uploaded=473x315`, `gl.getError()=[0,0,0]`, motif centre samples `[230,221,204,255]`, `[242,233,215,255]`, `[242,233,215,255]`). Live stage measured `924x1202` (`1.11 MP`, `10.5 MB` live, `scrollWidth=412` px). |
| Diagonal shutter mask cuts vs reveals DOM regions (`readPixels()`) | measured (Chrome 160.0.8188.0 canary, 2026-11-27) | Live check 2 passed on `Shutters`: at `wipe=0` band-0 centre read `[244,235,217,255]`; at `wipe=0.55` band-0 centre dropped to `[25,23,22,255]` (charcoal blade) while adjacent band-1 open aperture read `[244,235,217,255]` (`212` luminance delta). |
| Tilted `updateElementGeometry()` (`-0.024 rad`) + `geometryUnit()` + `dataset.hitTick` keeps pills and inputs clickable | measured (Chrome 160.0.8188.0 canary, 2026-11-27) | Live check 3 passed (`unit=1.00`, `elementsFromPoint()` hit both fixture `<button>` and `<input>`). Real CDP mouse click on the live `Act II` pill switched to `REEL 02` and editing `#credit-title` updated `#slate-headline` to `VERTIGO IN CHROME`. |
| `prefers-reduced-motion: reduce` and toggle snap wipes in one step and stop spiral rotation | measured (Chrome 160.0.8188.0 canary, 2026-11-27) | Live check 4 passed: `computeWipeStep()` peaked at `1.00` over `560 ms` normally and returned `active=false, wipe=0, swapReady=true, spiralOmega=0 rad/s` when reduced. |
| Synthetic `webglcontextlost` and `webglcontextrestored` (without `loseContext()`) recover plain HTML and `ElementGL` | measured (Chrome 160.0.8188.0 canary, 2026-11-27) | Live check 5 passed (`defaultPrevented=true`, `plainWhileLost=true`, `restored=true`, `err=0`) and `stillDrawn()` check 6 passed (`100.0%` drawn). |
| 2D `clip()` fallback (`delete texElementSubImage2D`) and plain-HTML fallback (`--disable-blink-features=CanvasDrawElement`) | measured (Chrome 160.0.8188.0 canary, 2026-11-27) | 2D fallback switched cleanly to 5-argument `drawElementImage()` clip paths (`stillDrawn()` passed); disabled API moved `#credits-slate` into `#plain-host` (`is-plain`, zero exceptions). |
| `Segmented blocks` hover/focus snap, touch scroll (`pan-y`), and `npm run check:jank` | not verified | Playwright and Chromium 157 are not installed here, and real Android touch hardware was not tested. |

## Things that bit

- **Spiral branch-cut seam at `atan(ep.y, ep.x)`**: computing `fwidth(phase)` and `deckle(theta)` directly from `atan(ep.y, ep.x)` produced a 1-px horizontal discontinuity along `-x` where `theta` wrapped from `+pi` to `-pi`. Replacing angular noise with `valueNoise(angDir * 4.2)` on the unit direction vector `ep / r` and computing the anti-aliasing width analytically from `(6.2831853 / pitch) * 1.2 + 2.4 / max(r, 10.0)` removed the seam across all 360 degrees.
- **Inverted iris inner shadow**: `1.0 - smoothstep(apR - 9.0, apR, r)` darkened the whole centre of the spiral aperture instead of only the cut ring edge. Flipping it to `smoothstep(apR - 11.0, apR, r)` restored bright off-white paper (`[242, 233, 215, 255]`) inside the aperture while keeping a crisp rim shadow along the paper edge.
- **Resting shutter shadow bands at `0%` wipe**: when `uWipe == 0`, the small `bandLocal * 0.05` wedge skew term alone made `activeHalf > 0.05` on one side of each band and painted faint diagonal shadow stripes across the resting slate. Guarding the shutter loop with `if (uWipe > 0.005)` keeps the resting `0%` card crisp until a wipe starts.
- **Fixture sample coordinates overlapping inputs**: sampling the open shutter band in the `+u` direction (`+44.3, -30.8` from centre) landed inside the top button/input row of the fixture. Sampling the `-u` band (`-44.3, +30.8`) lands squarely on clean un-texted paper below the controls.

## Not verified

- Headless Chromium 157: `npm run check:jank -- /bass-cutouts/`, `node tools/draw-size/audit.mjs /bass-cutouts/`, and generating `public/bass-cutouts/social.jpg` (`node tools/social/capture.mjs /bass-cutouts/`).
- Chrome 159 on Android at 412 px wide and 2.625 DPR: real finger tap-to-wipe, editing `#credit-title` and `#credit-director` with the soft keyboard, hover-vs-tap alignment snap on `Segmented blocks`, `touch-action: pan-y` vertical scrolling across the stage, and real frame rate during `Spiral iris` rotation.

## For the index

- Transitions, text and motion: `/bass-cutouts/` uses one `ElementGL` WebGL 2 canvas to chop, slide and mask live HTML title credits (`#credits-slate` with editable inputs and clickable `Act I` to `Finale` pills) across Saul Bass diagonal shutters, staggered segmented blocks and a rotating spiral iris over fibrous construction paper while keeping tilted `updateElementGeometry()` hit testing aligned.
