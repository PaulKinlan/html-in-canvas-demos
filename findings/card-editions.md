# Foil cards and world-locked dithering (`/card-editions/`)

Built on 2026-11-27. Static checks (`node --check public/card-editions/editions.js`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs --strict /card-editions/` and `node tools/site/build.mjs --check`) ran on 2026-11-27. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /card-editions/` and Chrome 159 on Android at 412 px) are **not verified** yet.

Inspired by Balatro's Foil, Holographic, Polychrome and Negative playing-card editions, and Lucas Pope's 3D sphere-locked 1-bit dithering in *Return of the Obra Dinn*.

| Question | Status | Detail or what the check tests |
|---|---|---|
| Can one `ElementGL` WebGL 2 context switch instantly across all five card editions without recompiling? | not verified | Live check 1 uploads a fixture card via `gl.texElementSubImage2D()`, cycles `uEdition` from `0` to `4` (Foil, Holographic, Polychrome, Negative, Obra Dinn 1-bit) on one compiled shader and checks `gl.getError() === 0` with opaque pixels sampled on each pass. |
| Does Obra Dinn 1-bit mode output strictly two binary palette colours across tonal gradients? | not verified | Live check 2 draws a smooth gradient fixture in both `Sphere-locked` and `Screen-space` modes (`#333319` and `#e5ffff`) and reads back every buffer pixel to confirm zero intermediate grey values. |
| Does 3D view-sphere angular indexing stop dither swimming compared with screen-space `gl_FragCoord.xy`? | not verified | Implemented in `ditherCell()`: `Screen-space` floors `gl_FragCoord.xy / uDpr`, whereas `Sphere-locked` builds `rayDir = normalize(vec3(localPx, -uSphereRadius))`, extracts equirectangular `(theta, phi)` angles and indexes the 8x8 Bayer plus 32x32 toroidal blue-noise threshold on that angular grid. |
| Do tilted `<input>` and `<button>` controls inside the card remain clickable and typeable under perspective? | not verified | Live check 3 applies a 24 deg yaw / -14 deg pitch `DOMMatrix` scaled by `geometryUnit(cv, card, w)` to `updateElementGeometry()`, flips `dataset.hitTick` and asserts `document.elementsFromPoint()` lands on the off-centre tilted button. |
| Does context loss preserve typed card state without calling `loseContext()`? | not verified | Live check 4 dispatches synthetic cancelable `webglcontextlost` and `webglcontextrestored` events on an isolated wrapper to check that edited input text and counter labels stay intact when moved to plain HTML and restored. |

## Things that bit

- **No anti-aliased edge blending in 1-bit mode:** `ElementGL` enables premultiplied alpha blending (`gl.ONE`, `gl.ONE_MINUS_SRC_ALPHA`). Blending rounded card edges with `fwidth(vUv)` after dithering leaks intermediate grey values along the border. Clipping `tex.a < 0.5` with `discard` and returning `vec4(obraDinnBit(...), 1.0)` keeps every drawn pixel strictly one of the two palette colours.
- **Negative modulo in GLSL ES 3.00:** indexing the 8x8 Bayer matrix and 32x32 blue-noise texture from signed angular cell coordinates produces negative `%` remainders on the left and bottom halves of the sphere (`theta < 0` or `phi < 0`). Wrapping with `modPos(a, n)` prevents out-of-bounds `texelFetch()` reads.
- **Re-upload gating during tilt and reflection sweeps:** only calling `stage.upload(cardEl)` when `state.cardDirty` is set or `e.changedElements` contains `#collector-card` keeps 3D dragging, spring settle and pointer reflection sweeps from re-running `texElementSubImage2D()` when the DOM didn't change.
- **Symmetric SVG suit paths and `geometryUnit()` order:** measuring `cardEl.offsetWidth` before applying `updateElementGeometry()` avoids reading post-transform client rects during `geometryUnit()` calibration, and keeping fixed CSS dimensions (`280px` by `400px`) inside the canvas avoids layout reflow during tilt.

## Not verified

- Running all four live checks in headless Chromium 157 (`C157`) and recording exact pixel readbacks and `elementsFromPoint()` coordinates.
- Running `npm run check:jank -- /card-editions/` at 412 px wide and device scale `2.625` to confirm backing store memory (`< 4 MP` and `< 96 MB`), zero layout shifts, zero timed readbacks and `glContexts <= 3`.
- Real touch dragging, spring release, `Auto-orbit`, `Screen-space` vs `Sphere-locked` visual stability, and tapping `+10 Chips`, `+1 Mult`, `Suit`, `Seal` and the card title `<input>` on Chrome 159 for Android (`A159`).
- The 2D `drawElementImage()` fallback path (`--disable-blink-features` or software WebGL disabled) and genuine browser-driven `webglcontextlost` / `webglcontextrestored` recovery on a phone.
- `prefers-reduced-motion: reduce` verification in a live browser (confirming instant tilt settle and blocked `Auto-orbit` alongside `/shared/learn.js`'s reduced-motion banner).

## For the index

- Shaders and dithering: `/card-editions/` renders one live interactive HTML playing card on one `ElementGL` context with Balatro-style Foil, Holographic, Polychrome and Negative shaders plus Return of the Obra Dinn 3D view-sphere Bayer and blue-noise 1-bit dithering, toggled against `gl_FragCoord.xy` screen-space dithering (`updateElementGeometry()` scaled by `geometryUnit()`, not verified yet).
