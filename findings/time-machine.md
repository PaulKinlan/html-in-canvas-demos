# Time Machine and Cover Flow for live HTML (`/time-machine/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport at DPR 2.625 and 960 px desktop at DPR 2, SwiftShader WebGL). All live checks wait for a tap (`<meta name="checks" content="tap">`). Chrome 159 on Android and `npm run check:jank` (Playwright not installed here) are **not verified** yet.

This page builds three 2007 spatial history stacks (macOS Leopard Time Machine, iTunes Cover Flow and Windows Vista Flip 3D) around one live editable HTML document card inside one `ElementGL` WebGL 2 canvas (`/lib/element-gl.js`). Rather than holding open `ElementImage` objects from `captureElementImage()`, saved revisions are copied on the GPU from the live `texElementSubImage2D()` texture into a 16-layer `gl.TEXTURE_2D_ARRAY` via `gl.blitFramebuffer()` (within a 24 MB / 640 px phone cap or 36 MB / 760 px desktop cap) and `gl.copyTexSubImage3D()`. The front card stays interactive via projective `canvas.updateElementGeometry()` scaled by `geometryUnit()`.

| Question | Result | Notes |
|---|---|---|
| `gl.TEXTURE_2D_ARRAY` + `gl.copyTexSubImage3D()` stores distinct DOM revisions with `gl.getError() === 0` and `window.__gfx.snapshots.open === 0` | measured (Chrome 160 Canary, 2026-11-27) | Live check 1 passed (`4/4` total on page; smoke check `992x1202`, `1.19 MP`, `9.5 MB`, `0` errors). |
| Switching across Time Machine, Cover Flow and Flip 3D renders cleanly with `gl.getError() === 0` | measured (Chrome 160 Canary, 2026-11-27) | Live check 2 passed across all three layouts. |
| `updateElementGeometry()` scaled by `geometryUnit()` hits the front card `<input>` and `<button>` via `elementsFromPoint()` | measured (Chrome 160 Canary, 2026-11-27) | Live check 3 passed on an angled Flip 3D front card. |
| Restoring an earlier revision restores the saved `<input>` text, notes, theme and checkboxes | measured (Chrome 160 Canary, 2026-11-27) | Live check 4 passed, and desktop 2x Retina layers now store full `720x584` instead of `117x87` after pre-sizing `ElementGL`. |
| Real frame rate, VRAM headroom and touch scrubbing at 412 px wide on a phone | not verified | Needs a live run on A159 (Chrome 159 on Android, DPR 2.625). |

## Things that bit

- Binding a `sampler2D` (`uTex`) and a `sampler2DArray` (`uHistory`) without assigning `uHistory` to texture unit 1 on every draw call (including the full-screen backdrop pass) raises `GL_INVALID_OPERATION` in WebGL 2 even when the fragment shader branches away from `uHistory`. Every pass sets `uHistory` on `TEXTURE1` and restores `TEXTURE0` afterwards.
- High-DPI `texElementSubImage2D()` uploads a 360 by 292 CSS pixel card at roughly 945 by 767 device pixels on a 2.625 DPR phone, which would push a 16-layer `RGBA8` `TEXTURE_2D_ARRAY` above 44 MB. Downscaling into a single-frame scratch framebuffer via `gl.blitFramebuffer(..., gl.LINEAR)` before `gl.copyTexSubImage3D()` holds the entire array under 16 MB on phones and 22 MB on desktop while keeping the live front card at full native DPI.
- Pre-seeding seven distinct historical revisions on load needs one Chromium paint cycle per revision so `texElementSubImage2D()` captures each mutated DOM state instead of duplicating the same frame. Driving a short capture queue inside the canvas `paint` listener and scheduling each next `requestPaint()` on `requestAnimationFrame()` populates all seven layers cleanly without blocking load.
- Leaving the live drawable `<form>` interactive while scrubbing back to an archived `TEXTURE_2D_ARRAY` layer lets taps pass through the archived preview onto the hidden live inputs. Parking `#tm-card` with `inert = true` and an off-stage `DOMMatrix` during preview or drag stops stray edits until you press Restore this revision or jump back to live.
- Calling `geometryUnit()` resets the element transform to identity while measuring, so `cachedGeometryUnit()` clears the cached transform signature whenever canvas or card dimensions change and reapplies the projective front-card matrix straight after.

## Not verified

- C157 (headless Chromium 157): running all 4 live checks, confirming `npm run check:jank -- /time-machine/` passes (canvas under 4 megapixels, 1 WebGL context, `openSnapshots === 0`, 0 unasked readbacks, 0 layout shift), and capturing `social.jpg`.
- A159 (Chrome 159 on Android, 412 px wide, DPR 2.625): confirming the 16 MB 16-layer `TEXTURE_2D_ARRAY` does not trigger context loss, testing real frame rate across Time Machine, Cover Flow and Flip 3D, checking touch scrubbing and verifying `onRestored` layer recapture after a real context loss.
- C153: checking the 2D 5-argument `drawElementImage()` fallback and plain HTML revision list when WebGL `texElementSubImage2D()` is absent.

## Open ideas

- Add a WebGPU `texture_2d_array` route through `webgpu()` from `/shared/backend.js` using `GPUQueue.drawElementImageToTexture()` and `copyTextureToTexture()` to compare memory and frame times against WebGL 2.
- Allow side-by-side visual diff highlighting between the currently previewed `TEXTURE_2D_ARRAY` layer and the live `uTex` texture in the fragment shader before restoring.

## For the index

- 3D, spatial and WebXR: a 16-layer WebGL 2 `TEXTURE_2D_ARRAY` populated with `texElementSubImage2D()`, `blitFramebuffer()` and `copyTexSubImage3D()` renders Time Machine, Cover Flow and Flip 3D revision stacks with glossy floor reflections, zero open `ElementImage` snapshots and projective front-card `updateElementGeometry()` hit testing (not verified, `/time-machine/`).
