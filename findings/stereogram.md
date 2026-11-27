# Live DOM autostereogram (`/stereogram/`)

Updated and verified on 2026-11-27 in headless Chrome Canary `160.0.8187.0` (SwiftShader WebGL) at `900 px` desktop (`1x` DPR) and `412 px` mobile (`2.625` DPR). All 5 live checks pass on both viewports with `0` console/runtime errors, `0` unasked readbacks and `0` lost contexts. Real human stereopsis and physical Android touch hardware remain **not verified**.

The question: can a live editable HTML form's contrast and element geometry drive a real-time GPU single-image random-dot autostereogram so typed letters and clickable buttons emerge in hidden 3D depth while staying directly interactive?

| Experiment | Status | Notes |
|---|---|---|
| Live HTML form uploaded via `ElementGL` (`texElementSubImage2D()`) into a single-pass front-to-back heightfield autostereogram shader | works (Chrome 160.0.8187.0) | Live check 1 measured non-flat SIRDS luminance spans of `12..240` desktop (`300x150` upload) and `18..249` mobile at `2.625` DPR with `gl.getError() === 0`. |
| Horizontal repeat-period shift over bright (raised) vs dark (recessed) live DOM regions | works (Chrome 160.0.8187.0) | Live check 2 (`stripW = 60` px, `depth = 0.30`) measured `60.0 px` vs `42.0 px` on desktop (`18.0 px` shift) and `59.8 px` vs `41.9 px` on mobile (`17.9 px` shift). |
| Narrow-stroke preservation at high stereo depth (`10 px` bar at `45%` disparity) | works (Chrome 160.0.8187.0) | Live check 5 replaced the earlier 2-step lookup with a 14-step front-to-back right-eye raymarch and measured `55 px` repeat error `0.0` vs background `111.3` on desktop (`8.4` vs `109.4` at fractional `2.625` DPR mobile). |
| Cross-eye stereo pair, red/cyan anaglyph, wiggle 3D parallax and depth overlay modes on the same WebGL 2 shader | works (Chrome 160.0.8187.0) | Live check 3 drew modes 1 through 4 with `gl.getError() === 0` and measured red/cyan channel separation `max |R - B| = 249` in Anaglyph mode. |
| Interactive hit-box alignment with `updateElementGeometry()` scaled by `geometryUnit()` | works (Chrome 160.0.8187.0) | Live check 4 placed an isolated fixture form at `(28, 22)` and confirmed `document.elementsFromPoint()` hits both `<input inputmode="none">` and `<button>`. |
| `Cross-eye fuse` polarity invert toggle, card `Pop +` click inside canvas and `hasPainted` gate | works (Chrome 160.0.8187.0) | Toggling `Cross-eye fuse` updates HUD and depth inversion; clicking `Pop +` incremented `POP 1`; waiting for the first `paint` event eliminated the initial `No cached paint record for element` error on mobile. |
| 2D `drawElementImage()` 5-argument fallback and plain-HTML rescue on context loss or missing API | not verified in headless run | Code path present using `ctx.drawElementImage(cardEl, x, y, w, h)` and `#plain-host` DOM fallback. |

## Things that bit

- A naive two-step backward lookup (`d0` at `0.5 * stripW`, then `d` at `0.5 * sep0`) made the relief look flat even at `100%` depth, because any letter stroke narrower than `0.5 * maxShift` gets jumped right over when depth passes ~50%. Stepping `t = 1 -> 0` along the right-eye epipolar ray `(px - 0.5 * (stripW - t * maxShift))` keeps narrow glyphs intact at full disparity.
- On steep right-facing cliffs (such as white button borders or the card rim), backward steps compress `xL = px - sep(px)` and smear one random dot into solid horizontal stripes. Breaking backward links where left-eye occlusion (`evalStereoHeight(xL) >= u`) or steep negative slope (`leftShoulder - hitD`) occurs removes the horizontal echo bands cleanly.
- Calling `ElementGL.upload()` from `requestAnimationFrame()` before Chromium fires the canvas's first `paint` event throws `InvalidStateError: No cached paint record for element`. Gating rendering behind `state.hasPainted` (set inside the `paint` listener) prevents startup exceptions cleanly.
- Smooth bilinear value noise made stereo lock sluggish compared to crisp nearest-neighbour `2 CSS px` SIRDS dots, and a low `0.12` plinth with un-dilated thin strokes kept the card subtle; raising the smoothed plinth to `0.26` with a 5-tap mean/max dilation sculpts bold, rounded 3D keycaps and headline relief.
- In Cross-eye stereo pair mode the same live HTML form is rendered twice side by side while `updateElementGeometry()` holds only one `DOMMatrix` per drawable element; tracking pointer position across the stage swaps `updateElementGeometry()` onto whichever half you point at and toggles `data-hit-tick` to clear Chromium's cached hit-test entry.
- `tools/writing/check.mjs` flags the word `magic` as a `vocabulary` error and JSON files can't hold a `writing-allow` comment, so `page.json` uses the technical title `Live DOM autostereogram` while the on-page mode switch keeps the familiar 1990s name behind an HTML allow comment.

## Not verified

- Real human stereopsis on desktop and on Chrome 159 on Android at 412 px wide by touch: test free-fusing both parallel (`Classic SIRDS Dots` through `Live DOM Texture`) and cross-eyed (`Cross-eye fuse`) polarity, crossing eyes on the stereo pair, viewing Anaglyph 3D through red/cyan glasses, typing into `#stereo-text` and interacting with controls while fused.
- `npm run check:jank -- /stereogram/` (Playwright not installed in workspace) and real-device 2D fallback / caret blink rate on Chrome 159 for Android.

## For the index

- WebGL and 3D: `/stereogram/` drives a single-pass GPU backward-chain autostereogram (plus cross-eye stereo pair, red/cyan anaglyph, wiggle 3D and depth overlay) straight from an editable HTML form uploaded with `texElementSubImage2D()` on one `ElementGL` context, keeping the form clickable through `updateElementGeometry()` scaled by `geometryUnit()`.
