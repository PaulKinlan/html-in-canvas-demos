# Slit-scan time ribbon (`/slit-scan/`)

Not verified in a live browser yet (written 2026-11-26). All live checks wait for a tap (`<meta name="checks" content="tap">`) and run on isolated fixtures in the visitor's browser.

In `/time-scrubber/`, storing a multi-second rewind history of live HTML required keeping over 100 open `ElementImage` objects from `captureElementImage()`, which sit in GPU memory until `close()` is called. Here, one `ElementGL` canvas (`/lib/element-gl.js`) uploads a live interactive HTML panel with `gl.texElementSubImage2D()`, downscales it on the GPU via `gl.blitFramebuffer()` when needed to stay inside a fixed VRAM cap (24 MB on narrow screens, 32 MB on desktop, max side 512 px), and copies each frame into slice `head = (head + 1) % 64` of a 64-layer `gl.TEXTURE_2D_ARRAY` using `gl.copyTexSubImage3D()`. The fragment shader warps the panel in four modes (vertical slit-scan, radial time ripple, diagonal ribbon and a painted 128 by 128 `R8` time-freeze mask) while keeping `openSnapshots` at zero and doing zero CPU readback during rendering.

| Question | Result | Notes |
|---|---|---|
| `gl.TEXTURE_2D_ARRAY` + `gl.copyTexSubImage3D()` from a `texElementSubImage2D()` framebuffer succeeds with `gl.getError() === 0` | not verified | Checked by live check 1 on a 160 by 96 `ElementGL` fixture. |
| Ring buffer advances through multiple slices while keeping `window.__gfx.snapshots.open === 0` | not verified | Checked by live check 2 across 8 writes into a 6-slice ring buffer without calling `captureElementImage()`. |
| Distinct time slices hold distinct frame data after a DOM mutation | not verified | Checked by live check 3 (red slice 0 vs green slice 1 read back via `uForcedSlice` and `gl.readPixels()` inside the check). |
| `updateElementGeometry()` keeps live `<input>` and `<button>` controls reachable | not verified | Checked by live check 4 via `elementFromPoint()` and a synthetic click on the button. |
| Frame rate, VRAM stability and touch painting at 412 px wide on a phone | not verified | Needs a live run on Chrome 159 on Android and headless Chromium 157. |

## Things that bit

- `gl.copyTexSubImage3D()` copies pixels 1:1 from `READ_FRAMEBUFFER` and doesn't scale. On high-DPI screens, `texElementSubImage2D()` uploads the element at device pixels (often over 1,000 px wide), which would crop into a 512 px ring slice. Adding a single-frame `RGBA8` scratch framebuffer and calling `gl.blitFramebuffer(..., gl.LINEAR)` before `gl.copyTexSubImage3D()` keeps the entire copy on the GPU at a predictable VRAM budget.
- In GLSL ES 3.00, `sampler2DArray` has no default precision. Omitting `precision highp sampler2DArray;` causes shader compilation to fail in WebGL 2 even when `precision highp float;` is declared.
- Binding a `sampler2D` (`uTex`) and a `sampler2DArray` (`uRing`) to the same default texture unit 0 raises `GL_INVALID_OPERATION` on `drawArrays()`, even when the fragment shader branches away from `uRing`. Every draw path (including live checks) assigns `uRing` to unit 1 and `uMask` to unit 2, and resets `gl.activeTexture(gl.TEXTURE0)` after modifying extra units so `ElementGL.upload()` always binds `TEXTURE_2D` on unit 0.
- `window.__gfx.snapshots` in `/shared/context-guard.js` is an object `{ made, open, peak }`, not a plain number, so checks and telemetry read `window.__gfx.snapshots.open`.
- Painting a time-freeze mask directly over interactive live DOM conflicts with text selection and scrolling. Mode 3 separates `Freeze brush` and `Live eraser` (setting `pointer-events: none` on `#ss-panel` and `touch-action: none` on the stage) from `Interact DOM`, which leaves the painted mask active while passing taps, typing and scrolling back to the live controls.

## Not verified

- Chromium 157 (headless): running all 4 live checks, confirming `npm run check:jank -- /slit-scan/` passes (canvas under 4 megapixels, 1 WebGL context, `openSnapshots === 0`, 0 unasked readbacks), and capturing `social.jpg`.
- Chrome 159 on Android (412 px wide, device pixel ratio 2.625): confirming the 24 MB 64-layer `TEXTURE_2D_ARRAY` does not trigger context loss, checking real frame rate during typing and scrolling, and testing touch painting in time-freeze brush mode.
- Chromium 153: fallback behaviour when `texElementSubImage2D()` is absent or behaves differently.

## Open ideas

- Add a WebGPU `texture_2d_array` route through `webgpu()` from `/shared/backend.js` using `GPUQueue.drawElementImageToTexture()` plus `copyTextureToTexture()` to compare memory and frame timing against WebGL 2.
- Let visitors scrub a "replay head" offset across the 64 slices while capture is paused, combining `/time-scrubber/` rewind with spatial slit-scan displacement at zero open snapshots.

## For the index

- Transitions, text and motion: a 64-layer WebGL 2 `TEXTURE_2D_ARRAY` ring buffer populated via `texElementSubImage2D()`, `blitFramebuffer()` and `copyTexSubImage3D()` stores live HTML frame history on the GPU with zero open `ElementImage` snapshots and no CPU readback (not verified, `/slit-scan/`).
