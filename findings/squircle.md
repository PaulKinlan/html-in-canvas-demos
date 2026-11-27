# Continuous-curvature G² squircle mask and glass bevel vs CSS border-radius (`/squircle/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /squircle/` and `--docs --strict`), social metadata validation, and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed here), and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas clip a live interactive HTML widget dock to a continuous-curvature `G²` superellipse squircle with a pointer-lit inner glass bevel, while keeping buttons, colour swatches and text inputs clickable and showing the flat-to-arc kink against CSS `border-radius`?

## What was built

One `<canvas id="sq-canvas" content="drawable" layoutsubtree>` inside `.sq-viewport` (`356 px` tall up to `64svh` below `620 px`, `392 px` up to `68svh` on desktop, zero `dvh`) containing six live `drawable` HTML widgets:

- **Two interactive widget cards (`#tile-focus`, `#tile-widget`)**: a studio Focus toggle (`#btn-focus`), four glass accent colour swatches (`.sq-swatch`), an editable widget label `<input id="sq-label-input">` with `user-select: text`, and a shared tap counter (`#btn-count`, `#btn-reset-count`, `#sq-count-out`).
- **Four `1:1` dock icon widgets (`#tile-app-0` .. `#tile-app-3`)**: Focus toggle, label preset cycler, live counter button and accent swatch cycler sitting inside a frosted superellipse dock tray.
- **One `ElementGL` WebGL 2 context (`/lib/element-gl.js`)**: `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` set on creation, on `onRestored`, and inside every fixture; uploads gated on `hasPainted = true` inside `paint`, calling `stage.begin()` before `stage.upload()`.
- **Controls and fallbacks**: exponent presets (`n = 2` Ellipse, `n = 4.8` Squircle, `n = 9`), continuous exponent slider (`2.0` to `12.0`), `Compare CSS border-radius` toggle and split-curtain slider (`0%` to `100%`), `Highlight curvature` edge overlay, bevel light angle slider synced with pointer moves, `Reduced motion` synced with `prefers-reduced-motion` (`.motion-warn`), 5-argument `drawElementImage()` superellipse `Path2D` fallback, and plain-HTML grid fallback.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload and draw live widgets through `SQUIRCLE_FRAG` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `200x140` fixture (`tex=525x368`, `glErr=0`, centre `[40,75,138,255]`, `t=46ms`). |
| Does changing exponent `n = 2 -> 4.8 -> 10` change corner-shoulder fill and diverge from CSS `border-radius`? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed on a `140x140` fixture (`33,856` corner-quadrant pixels): `n=2` filled `78.5%`, `n=4.8` filled `94.7%`, `n=10` filled `98.6%`, and `n=4.8` squircle differed from diagonal-matched CSS `border-radius` (`95.5%`) at `270` shoulder pixels (`t=14ms`). |
| Does squircle masking leave outer bbox corners strictly transparent while keeping interiors opaque? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed on a `140x140` fixture at `n=4.8` with bevel and shadow active: `corner(2,2)=[0,0,0,0]`, `inside(70,70)=[40,75,138,255]` (`t=13ms`). |
| Does `updateElementGeometry()` keep buttons, swatches and `<input>` clickable inside squircle tiles? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on fixture (`buttonHit=true`, `inputHit=true`, `clicks=1`, `label="Squircle"`, `t=42ms`), and `elementsFromPoint()` hit all 6 live controls (`#btn-focus`, `.sq-swatch`, `#sq-label-input`, `#btn-count`, `#btn-app-focus`, `#btn-app-count`) at `412x915` @ `2.625` DPR. |
| Do synthetic `webglcontextlost`/`webglcontextrestored` rescue and 2D 5-arg `drawElementImage()` fallback work? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`glRestore=true`, `texW=525`, `2dInk=95.2%`, `wrongDraws=0`, `snapsOpen=0`, `t=1046ms`). Separate 2D-route run (`texElementSubImage2D` removed) drew `0.93 MP` (`3.72 MB`), `0` wrong draws, `0` errors; plain-HTML run (`drawElementImage` removed) laid out cleanly in `#plain-host` (`0` errors, `scrollW=412`). |
| Does the stage hold still at `412x915` @ `2.625` DPR with clean `.motion-warn` toggle and low GPU memory? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%`). Measured `0` CLS, `0` scroll shift, `0` focus moves, `0` console/page errors, `994x935` (`0.93 MP`, `7.44 MB` initial / `7.55 MB` post-checks), `1` active GL context (`peak=2`), `removed=0`, `openSnapshots=0`, `unaskedReads=0`, and `.motion-warn` toggled `1 -> 0` with `prefers-reduced-motion`. |

## Things that bit

- **Gradient normalisation on non-square cards**: dividing `(|x/a|^n + |y/b|^n)^(1/n) - 1` by the unnormalised scalar gives an uneven bevel width between wider cards and `1:1` dock icons. Dividing by the analytical gradient norm `|∇g|` puts `sd` into true CSS pixels so bevels and edge halos stay uniform on every aspect ratio.
- **Correcting `h.x * h.y` vs `h.x^2 * h.y^2` in implicit superellipse curvature**: the implicit curvature formula `|fx^2 fyy + fy^2 fxx| / |∇f|^3` carries `1 / (a^2 * b^2)` in the numerator (`κ` has dimension `1 / length`). Using `a^2 * b^2` aligns the analytical curvature heatmap with `1 / R` at `n = 2`.
- **Expanding WebGL quads by `8 px` bleed**: drawing each tile quad at `[0, w] x [0, h]` clips curvature difference halos and outer bevel strokes right at edge midpoints where `sd = 0`. Expanding each quad by `QUAD_PAD = 8` px while sampling `uTex` only within the tile box keeps midpoint halos intact.
- **Re-uploading on non-`paint` redraws**: checking `!changedSet` in `uploadDirtyTiles(event)` caused `ResizeObserver` and `rAF` redraws (`event === null`) to re-upload all six tiles (`24` uploads on boot). Checking `changedSet && changedSet.has(t.el)` limits uploads strictly to dirty or changed tiles.
- **Retiring 2D check fixtures before measuring `removed`**: `context-guard.js` frees retired 2D canvases on its `500 ms` tick once `t - goneAt > 200 ms`, so removing `cv2d` without waiting left `441,840` bytes in `memory().removed` right after Check 5. Waiting for `retireFixture()` on `cv2d` too leaves `removed = 0`.

## Not verified

- Headless Chromium 157 and `npm run check:jank -- /squircle/` (`playwright` isn't installed in this environment).
- Chrome 159 on Android (`412 px`, `2.625` DPR): real touch dragging for bevel light angle, typing on an on-screen keyboard inside `#sq-label-input`, and real GPU frame rates during split-curtain and exponent sweeps.

## For the index

- Shaders, lenses and visual UI: `/squircle/` clips six live interactive HTML widgets inside one `ElementGL` WebGL 2 canvas using a gradient-normalised `G²` superellipse SDF and pointer-lit glass bevel, paired with a split-curtain comparison and curvature-kink overlay against CSS `border-radius`.
