# Slit-scan time ribbon (`/slit-scan/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport at DPR 2.625, and 960 px desktop at DPR 2, SwiftShader WebGL). All live checks wait for a tap (`<meta name="checks" content="tap">`). Chrome 159 on Android and `npm run check:jank` (Playwright not installed here) are **not verified** yet.

In `/time-scrubber/`, storing a multi-second rewind history of live HTML required keeping over 100 open `ElementImage` objects from `captureElementImage()`, which sit in GPU memory until `close()` is called. Here, one `ElementGL` canvas (`/lib/element-gl.js`) uploads a live interactive HTML panel with `gl.texElementSubImage2D()`, downscales on the GPU via `gl.blitFramebuffer()` only when needed inside a fixed cap (32 layers inside 32 MB on phones under 700 px; 64 layers inside 128 MB on desktop up to 1,280 px side), and copies each frame into slice `head = (head + 1) % slices` of a `gl.TEXTURE_2D_ARRAY` using `gl.copyTexSubImage3D()`.

| Question | Result | Notes |
|---|---|---|
| `gl.TEXTURE_2D_ARRAY` + `gl.copyTexSubImage3D()` from a `texElementSubImage2D()` framebuffer succeeds with `gl.getError() === 0` | measured (Chrome 160 Canary, 2026-11-27) | Live check 1 passed (`4/4` total on page; smoke check `992x1307`, `1.30 MP`, `10 MB`, `0` errors). |
| Ring buffer advances through multiple slices while keeping `window.__gfx.snapshots.open === 0` | measured (Chrome 160 Canary, 2026-11-27) | Live check 2 passed across 8 writes into a 6-slice array with `openSnapshots === 0`. |
| Distinct time slices hold distinct frame data after a DOM mutation | measured (Chrome 160 Canary, 2026-11-27) | Live check 3 passed comparing red slice 0 vs green slice 1 via `readPixels()`. |
| `updateElementGeometry()` keeps live `<input>` and `<button>` controls reachable | measured (Chrome 160 Canary, 2026-11-27) | Live check 4 passed (`elementFromPoint()` hit both and button click fired). |
| Ring slice text sharpness at 960 px `2x` DPR | measured (Chrome 160 Canary, 2026-11-27) | Fixing `ElementGL.#syncSize()` before `upload()` removed the initial `300x150` slice 0 bug, and raising the desktop cap to 1,280 px / 128 MB shifted the 64-slice ring from `498x262` (`3.7x` shrink, visibly blocky stems) to `996x524` (`1.85x` shrink, clean body prose). |
| Frame rate, VRAM stability and touch painting at 412 px wide on a real phone | not verified | Needs a live run on Chrome 159 for Android. |

## Things that bit

- A 512 px / 32 MB desktop ring cap forced a `3.7x` single-pass linear `blitFramebuffer()` downscale (`1852x976` -> `498x262`), dropping thin letter stems across delayed article rows. Raising the desktop cap to `1,280 px` / `128 MB` keeps the ring at `996x524` (`~1.85x`), while switching phones under `700 px` to `32` slices within `32 MB` raises mobile slice width above CSS pixels without exceeding phone memory budgets.
- `ElementGL` previously sized `<canvas>` inside `begin()` after `upload()`, causing frame 0's `getElementImageDefaultSize()` to return `300x150` and allocate the ring at `300x150` on initial capture. Sizing inside `ElementGL.#syncSize()` in constructor and `upload()` fixed slice 0 across `/slit-scan/` and every static `ElementGL` page.

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
