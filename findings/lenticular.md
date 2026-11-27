# Lenticular and scanimation (`/lenticular/`)

Built on 2026-11-27. Syntax checked with `node --check public/lenticular/lenticular.js`, graphics rules checked with `node tools/gfx/check.mjs`, and prose checked with `node tools/writing/check.mjs --strict /lenticular/`. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /lenticular/`, and Chrome 159 on Android at 412 px) are **not verified** yet.

The question: can a single WebGL canvas interlace two to four distinct live interactive HTML cards behind a simulated micro-prism lenticular lens (or sliding Scanimation barrier grid), flip smoothly between them as you tilt your phone or drag across the sheet, and switch `updateElementGeometry()` and `inert` authority so whichever live HTML layer faces you stays clickable and typeable?

| Experiment | Status | Notes |
|---|---|---|
| Three `drawable` HTML cards uploaded into three textures on one `ElementGL` WebGL 2 context and composited through one fragment shader | not verified | Live check 1 creates an isolated fixture canvas with red, green and blue `drawable` children, uploads all three via `stage.upload()` (`gl.texElementSubImage2D()`), composites lenticular (`-25°`, `0°`, `+25°`) and Scanimation (`0°`) passes, reads pixels and asserts `gl.getError() === 0`. Needs Chromium 157+ live run. |
| Angle sweep `-25° -> 0° -> +25°` optical weight flip and `inert` handoff (plus 50/50 deadband) | not verified | Live check 2 steps an isolated 3-card fixture across `-25°`, `-12.5°`, `0°`, `+12.5°` and `+25°` in both lenticular and Scanimation modes, verifying dominant layer A -> B -> C and all-`inert` behaviour on the 50/50 transition seams. Needs browser run to record measured output. |
| `updateElementGeometry()` scaled by `geometryUnit()` switching `elementsFromPoint()` between three stacked buttons | not verified | Live check 3 stacks three `drawable` cards with identically positioned buttons, applies `applyAuthority()` (with `geometryUnit()` and `dataset.hitTick` cache clearing) at `-25°`, `0°` and `+25°`, and verifies `elementsFromPoint()` hits only Button A, Button B and Button C in turn. Needs Chromium 157+ run at DPR 1 and DPR 2.625. |
| Opt-in `DeviceOrientationEvent` availability and zero permission prompts on load | not verified | Live check 4 reports `DeviceOrientationEvent` and `requestPermission()` availability while asserting nothing prompted before a tap. Real phone tilt calibration (`gamma` zeroing) needs a physical mobile device. |
| 2D 5-argument `drawElementImage()` fallback and plain-HTML rescue on context loss | not verified | Falls back to 2D clipped vertical strips and ridge overlays via 5-argument `ctx.drawElementImage(card, 0, 0, w, h)` when `texElementSubImage2D()` is absent, and moves all three cards into `#plain-host` with `inert = false` if HTML-in-canvas is disabled or WebGL 2 loses its context. |

## Things that bit

- `ElementGL.upload()` in `/lib/element-gl.js` binds the element's texture to whichever texture unit is active. After binding Layers B and C to `TEXTURE1` and `TEXTURE2` during rendering, leaving `TEXTURE2` active would cause the next `stage.upload()` on `paint` to overwrite unit 2. Resetting `gl.activeTexture(gl.TEXTURE0)` before uploads and after binding extra units avoids cross-unit clobbering without editing `element-gl.js`.
- Using `fwidth()` inside the fragment shader to anti-alias Scanimation strip edges produces a one-pixel derivative spike along the circular edge of the 4.5x magnify loupe because the UV jumps discontinuously at the loupe radius. Computing analytical anti-alias widths from `pitch * uDpr * zoomScale` keeps both the sheet and the loupe edge clean.
- On the 2D fallback route, calling `syncAuthorityUI()` before `ctx2d.drawElementImage()` lets Chromium's 2D draw update the hit-test transform of non-dominant layers back onto the canvas. Calling `syncAuthorityUI()` after `drawElementImage()` keeps hidden cards off-stage and `inert`.
- Hidden `drawable` layers cannot use `display: none` because they need to stay painted and warm as textures for smooth lenticular cross-talk and Scanimation interlacing. Pairing `inert = true` with an off-canvas `DOMMatrix` (`translate(-100000, -100000)`) removes them from pointer hit testing and Tab order while keeping their paint records live.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /lenticular/` and tap-gated live checks 1 to 5): confirm zero layout shift, zero timed readbacks, backing store under 4 MP at 412 px and DPR 2.625, and record measured RGB and `elementsFromPoint()` values.
- Chrome 159 on Android at 412 px wide by touch: drag horizontally to tilt and slide the Scanimation acetate, tap Use phone tilt to test real `DeviceOrientationEvent` `gamma` calibration, type into Layer A's note field and Layer C's tag field, drag Layer B's range slider, toggle the Japanese poster translation, and drag the 4.5x magnify loupe ring.
- Screen reader and keyboard Tab navigation across angle flips when `inert` moves between the three cards.

## For the index

- Motion and optical effects: `/lenticular/` interlaces three live interactive HTML cards inside one `ElementGL` WebGL 2 canvas behind cylindrical lenticular ridges or a sliding 1/3-slit Scanimation barrier grid, switching `updateElementGeometry()` and `inert` authority to whichever layer crosses 50% optical weight.
