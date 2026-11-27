# Peek, pop and scrubbable lightbox (`/peek-pop/`)

Built and verified on 2026-11-27 in headless Chrome Canary `160.0.8187.0` (`412 px`, `2.625` DPR, SwiftShader WebGL). All 5 live checks pass (`0` console/runtime errors, `1.15 MP` backing store, `9.2 MB` estimated memory, `0` unasked readbacks, `0` lost contexts). Chrome 159 on Android physical touch and `npm run check:jank -- /peek-pop/` remain **not verified**.

| Question | Status | Detail or what the check tests |
|---|---|---|
| Can one `ElementGL` WebGL 2 context draw 6 live `drawable` tiles plus an offscreen 28-tap optical bokeh backdrop blur? | works (Chrome 160.0.8187.0) | Live check 1 uploads 6 fixture tiles via `gl.texElementSubImage2D()`, renders the 5 background tiles into a half-resolution RGBA8 framebuffer, applies the golden-angle Vogel disk shader at `18 px` radius, draws foreground card 0 and verifies `gl.getError() === 0` with opaque pixels sampled on both layers (`5/5` passed after fixing FBO Y UV orientation). |
| Does scrubbing progress `t` across `0 -> 0.5 -> 1 -> 0` return cleanly to the originating slot with spring velocity? | works (Chrome 160.0.8187.0) | Live check 2 tests `computeCardPose()` at Grid (`0`), Peek (`0.5` at `1.08x` scale and `9 px` bokeh) and Popped (`1.0` at `18 px` bokeh), then steps `stepThrowSpring()` from a downward fling (`dy = 115`, `vy = 620`) back to `< 0.01 px` of the slot and from a gentle release back to `t = 1`. |
| Do background cards stay `inert` while popped (`t = 1`) with the expanded card's `<input>` and `<button>` hit-testable? | works (Chrome 160.0.8187.0) | Live check 3 pops card 0 (earlier in DOM order than card 1), marks card 1 `inert` and moves its hit box offstage, asserts `document.elementsFromPoint()` lands on card 0's `<input>` and `<button>`, then returns to `t = 0` and checks card 1's grid button hits cleanly. |
| Does context loss preserve edited card state in plain HTML without calling `loseContext()`? | works (Chrome 160.0.8187.0) | Live check 4 dispatches synthetic cancelable `webglcontextlost` and `webglcontextrestored` events on an isolated 6-card wrapper to verify `inert` clears, cards move to plain HTML with caption text and pin counts intact, and restore back to `<canvas>`. |

## Things that bit

- **Offscreen FBO Y-orientation in `BOKEH_VS`:** `toClip()` renders CSS top (`y = 0`) to clip `+1.0` (texture `v = 1.0` inside `bgFBO`). Passing raw `vUv = aPos` alongside `gl_Position.y = 1.0 - 2.0 * aPos.y` inverted the blurred backdrop vertically; switching to `vUv = vec2(aPos.x, 1.0 - aPos.y)` aligned background cards 1:1 with the foreground card.

- **Keeping popped cards crisp at `t = 1` without a snapshot cut:** laying each `.feed-card` out at full inspector resolution (`cardW` by `cardH`, matched to the grid cell aspect ratio) and downscaling in the shader at `t = 0` avoids reallocating textures or snapping DOM layout across Grid, Peek and Popped states.
- **Deferred pointer capture for inner buttons vs long-press Peek:** calling `setPointerCapture()` inside `pointerdown` steals native `click` events from inner heart, pin and `Peek` buttons. Waiting until the `240 ms` Peek hold timer fires or an `8 px` scrub drag begins lets taps reach buttons natively.
- **Preventing later DOM cards from occluding popped earlier cards:** when card 0 is popped over cards 1 to 5, marking background cards `inert` alone leaves their geometries stacked behind card 0 in DOM order. Sending background cards' `updateElementGeometry()` transforms `OFFSTAGE` once `t > 0.45` keeps card 0 topmost in `elementsFromPoint()`.
- **Continuous 1:1 scrub tracking from any grid row:** interpolating drag displacement relative to stage centre during scrubbing and transferring the residual delta into `releaseOffX` / `releaseOffY` on `pointerup` avoids a jump when releasing a finger-scrubbed card into the throw-back spring.

## Not verified

- Running all live checks in headless Chromium 157 (`C157`) and recording exact WebGL readback values, spring settle frame counts and `elementsFromPoint()` results.
- Running `npm run check:jank -- /peek-pop/` at 412 px wide and device scale `2.625` to verify zero layout shift, `< 4 MP` backing store, `< 96 MB` canvas memory, zero unasked readbacks and `glContexts <= 3`.
- Real touch long-press (`240 ms`), 1:1 diagonal scrubbing, velocity Z-tilt and damped throw-back into each grid slot on Chrome 159 for Android (`A159`), plus on-screen keyboard typing in the popped caption `<input>`.
- The 5-argument 2D `drawElementImage()` fallback path and real browser `webglcontextlost` / `webglcontextrestored` recovery on a phone.

## For the index

- Motion and shaders: `/peek-pop/` draws six live `drawable` HTML cards on one `ElementGL` WebGL 2 context across Grid, long-press Peek (`1.08x` scale plus 28-tap circular optical bokeh `0` to `18 px`) and a 1:1 finger-scrubbed full inspector with velocity-seeded damped spring throw-back (`texElementSubImage2D()`, `updateElementGeometry()` scaled by `geometryUnit()`, not verified yet).
