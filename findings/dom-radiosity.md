# DOM radiosity (`/dom-radiosity/`)

Built on 2026-11-26. Source checks (`node --check`, `tools/gfx/check.mjs`, `tools/writing/check.mjs`) ran locally; runtime WebGPU compute, WebGL 2 fallback and hit-testing checks have not been run in a browser yet (marked "not verified" below).

This page puts a live HTML gallery (`<input type="text">`, three clickable lamp buttons and three draggable dark pillars with inner glow switches) inside one `drawable` container child of a canvas. On WebGPU it uploads the container with `GPUQueue.drawElementImageToTexture()`, classifies emitters and occluders on the GPU via `@compute` `textureLoad()`, computes an exact Euclidean distance field with Jump-Flood (JFA), marches 4 angular-spatial 2D Radiance Cascades (4, 16, 64 and 256 rays) with indirect bounce feedback, and composites the native-resolution HTML over the lit gallery floor. A WebGL 2 fallback inside a single `ElementGL` context runs the same JFA and 4-cascade algorithm through off-screen framebuffers, with a 2D canvas blur route and a plain HTML fallback behind it.

## Experiments and checks

| Experiment | Result | Notes |
| --- | --- | --- |
| `drawElementImageToTexture()` with `TEXTURE_BINDING \| COPY_DST` | not verified | Earlier C157 measurements on `/webgpu-features/` required `RENDER_ATTACHMENT` as well. Live check 1 probes `TEXTURE_BINDING \| COPY_DST` first and falls back to adding `RENDER_ATTACHMENT`, recording the exact validation message if rejected. |
| `drawElementImageToTexture()` with `STORAGE_BINDING` on the target texture | not verified | Live check 2 creates an `rgba8unorm` target with `TEXTURE_BINDING \| COPY_DST \| RENDER_ATTACHMENT \| STORAGE_BINDING` and tests whether Chromium accepts a direct upload without an intermediate copy. |
| WGSL `@compute` `textureLoad()` on live HTML pixels | not verified | Live check 3 uploads a solid `#ff6428` half beside a 50% alpha `rgba(255, 100, 40, 0.5)` half, reads both in a compute shader via `textureLoad()`, and checks non-zero RGB and premultiplied vs straight alpha. |
| JFA + 4-cascade 2D Radiance Cascades compute pipeline | not verified | Live check 4 runs Seed, JFA, 4 cascades and Resolve off screen on a 256 × 128 fixture with a cyan left emitter and a central dark pillar, and checks lit vs shadowed irradiance contrast and JFA distance at the lit probe. |
| `updateElementGeometry()` hit-test on emissive `<input>` and `<button>` | not verified | Live check 5 draws a 260 × 120 fixture on the check bench, calls `updateElementGeometry()`, toggles a data attribute to clear the hit-test cache, and checks `document.elementFromPoint()` at both centres. |
| Graphics source rules (`tools/gfx/check.mjs`) | measured: pass | 0 problems. Uses `webgpu()` / `checkDevice()` from `/shared/backend.js`, `ElementGL` from `/lib/element-gl.js`, 5-argument `drawElementImage()` on the 2D route, no `loseContext()`, and no timed readbacks. |

## Things that bit

- A downscaled compute grid (up to 384 cells on the long side) can miss thin 1 px glyph strokes from a 2.625× DPR DOM texture if the seed pass takes a single point sample. Sampling a 5-tap footprint (centre plus four corners of each cell's DOM footprint) via `textureLoad()` keeps thin typed letters intact.
- In WebGL 2, `RGBA16F` off-screen framebuffers depend on `EXT_color_buffer_float`. Packing normalised JFA seed coordinates into 16-bit pairs inside `RGBA8` (`RG` and `BA`) and falling back to scaled `RGBA8` radiance targets when float FBOs are incomplete keeps the WebGL 2 fallback working without float extensions.
- Radiance Cascades probe packing assumes both simulation dimensions divide evenly by the coarsest cascade side (16 for 4 cascades). Rounding `simW` and `simH` to multiples of 16 avoids partial probes at the right and bottom edges.

## Not verified

- Running the six live checks in Chromium 157 (headless software adapter) and on Chrome 159 on Android (real GPU): whether `drawElementImageToTexture()` accepts `STORAGE_BINDING` directly, exact premultiplied alpha values from `@compute` `textureLoad()`, and lit-to-shadowed irradiance ratio.
- On-screen WebGPU presentation, interactive touch dragging of the dark pillars, typing into `#neon-input` and frame time at 412 px width (2.625 DPR) on a phone.
- `npm run check:jank -- /dom-radiosity/` against the built site (canvas memory, megapixels and zero layout shift).

## For the index

- WebGPU compute: `drawElementImageToTexture()` target usage with `STORAGE_BINDING` and `@compute` `textureLoad()` driving JFA + 2D Radiance Cascades global illumination from live HTML (not verified, `/dom-radiosity/`).
