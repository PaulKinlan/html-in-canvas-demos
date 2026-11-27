# Scratch-off foil and thermal paper (`/scratch-foil/`)

Measured in HeadlessChrome 160.0.0.0 (`--force-device-scale-factor=2.625`, `--enable-blink-features=CanvasDrawElement`, 2026-11-27) using isolated fixtures on `testStage()` and real touch events via CDP. Chromium 157 (`npm run check:jank`), Chrome 159 on real Android hardware and the 2D fallback on a non-WebGL browser are not verified yet.

This experiment tests whether one `ElementGL` context (`/lib/element-gl.js`) can upload a live interactive HTML card via `gl.texElementSubImage2D()`, mask it behind brushed metallic foil using a 256 by 192 `R8` `Uint8Array` streamed selectively via `gl.texSubImage2D()` with zero GPU readback, gate pointer hits against that CPU shadow mask until more than 35% of a control's box is scratched clear, and toggle the same `R8` mask into a heat-reactive thermal receipt paper surface.

| Question | Result | Notes |
|---|---|---|
| `ElementGL` + `texElementSubImage2D()` + dirty-rect `R8` `texSubImage2D()` renders coated vs scratched regions with `gl.getError() === 0` | measured (C160, 2026-11-27) | Live check 1 passed: `gl.getError()=0`, coated gold `rgb(204,165,77)`, scratched green `rgb(22,163,74)`. |
| Scratching across a control box updates cleared fraction (`> 0.35`) and opens clicking without GPU readback | measured (C160, 2026-11-27) | Live check 2 passed: `before cov=0.00 (blocked=true)`, `after cov=0.36 (open=true, clicks=1, readbacks=0)`. Confirmed on the visible demo via CDP touch drag (`14% scratched · 2 of 6 controls open`; tapping `Claim +1` incremented count to `1` while `Lucky spin` stayed gated). |
| Switching to Thermal Paper mode develops hidden DOM luminance cleanly where `heat > 0.5` | measured (C160, 2026-11-27) | Live check 3 passed: `gl.getError()=0`, cold luma `239` `rgb(243,239,229)` vs hot (`220`) luma `22` `rgb(24,21,19)`. |
| `updateElementGeometry()` keeps uncovered `<input>` and buttons clickable (`elementsFromPoint()`) | measured (C160, 2026-11-27) | Live check 4 passed: `Input hit=true, button hit=true, clicks=1, +14 px shifted hit=true`. |
| Touch scratching, thermal cooling rate and context stability at 412 px wide on a phone | not verified | Needs a live run on Chrome 159 on Android and `npm run check:jank -- /scratch-foil/` in headless Chromium 157. |

## Things that bit

- Setting `pointer-events: auto` on covered DOM controls inside `<canvas content="drawable" layoutsubtree>` caused drags starting directly over an `<input>` or `<button>` to focus the field or select text instead of scratching the foil. Putting `pointer-events: none` on `#sf-surface` and toggling `[data-gated="open"]` only past 35% clearance in the 256 by 192 CPU shadow mask gates hit-testing cleanly with zero GPU readback.
- Calling `gl.texSubImage2D()` for only the stroked bounding box of a `256 x 192` `Uint8Array` requires setting `UNPACK_ALIGNMENT = 1`, `UNPACK_ROW_LENGTH = 256`, `UNPACK_SKIP_PIXELS` and `UNPACK_SKIP_ROWS`, then resetting all four back to defaults (`0`, `0`, `0`, `4`) before `ElementGL.upload()` runs so element texture uploads stay aligned.
- Adding coarse `2 px` flake cells with additive `spec + glint` up to `2.34` clamped large patches of the foil surface to pure white `rgb(255,255,255)`. Replacing the coarse flake grid with smooth directional fBm streaks and a bounded diagonal satin sheen kept metallic chroma intact across gold, silver and copper highlights.
- In GLSL ES 3.00, `pow(x, 2.0)` on negative `x` (such as `(vUv.y - 0.11) * 11.0` near the top curl band of the thermal paper) is undefined and can produce `NaN` bands on mobile GPUs; squaring the term directly (`curlBand * curlBand`) avoids the domain error.
- Clearing the WebGL canvas with opaque `[0.11, 0.10, 0.09, 1]` filled the serrated thermal tear-off teeth (`paperAlpha = 0`) with black triangles; clearing with `[0, 0, 0, 0]` lets the CSS stage background show behind the paper teeth.
- After uncovering a gated control (`data-gated="open"`), calling `canvas.updateElementGeometry()` and toggling `data-hit-tick` flushes Chromium's hit-test cache so `elementsFromPoint()` and taps land inside the scratched window right away.

## Not verified

- Chromium 157 (headless): running `npm run check:jank -- /scratch-foil/` (blocked in this branch pass because `check:jank` runs `npm run build` over shared files) and capturing `social.jpg`.
- Chrome 159 on Android (412 px wide, device pixel ratio 2.625): confirming real GPU context survival, touch drag scratching over `<input>` without triggering the virtual keyboard before 35% clearance, and thermal stylus heating/cooling frame pacing on phone hardware.
- 2D fallback (`destination-out` + 5-argument `drawElementImage()`) in a browser where `texElementSubImage2D()` is disabled or unavailable.

## Open ideas

- Add WebGPU parity via `webgpu()` from `/shared/backend.js` and `GPUQueue.drawElementImageToTexture()` with `writeTexture()` sub-rect updates on an `r8unorm` mask texture.
- Add subtle scratch-flake particle scatter or audio synthesis via Web Audio gated behind user interaction while dragging across metallic foil.

## For the index

- Transitions, text and motion: one `ElementGL` canvas layers brushed metallic foil or heat-reactive thermal receipt paper over live HTML via a `256 x 192` `R8` `Uint8Array` streamed with dirty-rect `gl.texSubImage2D()`, gating pointer hits per control against the CPU shadow mask until cleared past 35% with zero GPU readback (measured in HeadlessChrome 160 on 2026-11-27; Android A159 and `check:jank` not verified, `/scratch-foil/`).
