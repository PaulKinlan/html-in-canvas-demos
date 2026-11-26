# Escher Droste spiral (`/droste/`)

Not verified in a live browser as of 2026-11-26. None of the live checks or visual modes have been run in headless Chromium 157 (C157) or on Chrome 159 for Android (A159) yet. Static checks (`node --check public/droste/droste.js`, `node tools/gfx/check.mjs` and `node tools/writing/check.mjs /droste/`) were run on 2026-11-26.

| Question | Result | Reason or detail |
|---|---|---|
| Does `gl.generateMipmap(gl.TEXTURE_2D)` succeed after `gl.texElementSubImage2D()` on non-power-of-two element dimensions? | Not verified | Implemented via `ElementGL.upload(card)` followed by `gl.generateMipmap(gl.TEXTURE_2D)` and `LINEAR_MIPMAP_LINEAR` on the single WebGL 2 context, plus an isolated live check using a `113x87` CSS px drawable child. |
| Does `EXT_texture_filter_anisotropic` apply cleanly to a `texElementSubImage2D()` texture and sharpen tilted spiral turns? | Not verified | Queries `EXT_texture_filter_anisotropic` (plus WebKit/Moz prefixes), sets `TEXTURE_MAX_ANISOTROPY_EXT` to `MAX_TEXTURE_MAX_ANISOTROPY_EXT`, and provides a 52 deg perspective tilt preset so anisotropic footprints diverge visibly from isotropic trilinear filtering. |
| Can an analytic complex-logarithm Escher Droste shader wrap a live editable HTML card across 10+ octaves without branch-cut or wrap seams? | Not verified | Measures `r1 = cutout.offsetWidth / card.offsetWidth`, computes `w' = (1 + i * strands * L / (2 * pi)) * (ln(z) - offset)`, wraps `w'.x` modulo `L` before `exp()` to avoid float overflow, wraps the Chebyshev norm into `[r1, 1]`, and passes the analytic Jacobian `0.5 * c * (zTile / z) * dFdx(z)` to `textureGrad()`. |
| Can a two-FBO ping-pong mirror tunnel share the same `ElementGL` context and echo live DOM edits down the transparent cutout? | Not verified | Allocates two `RGBA8` ping-pong framebuffers (capped at `768 px` per side) on `stage.gl`, composites the upright live card over shrunk, rotated and colour-shifted previous frames, and runs a bounded 28-frame settling burst on DOM edits. |
| Does `updateElementGeometry()` keep the live `<input>` and theme buttons clickable while canvas drags zoom and rotate the spiral? | Not verified | Sets `pointer-events: none` on `#droste-card` and `#droste-cutout` with `pointer-events: auto` on the four outer frame rails, updates `canvas.updateElementGeometry(card, { canvasTransform })` and increments `card.dataset.hitTick` after layout or view changes. |

## Things that bit

- Sampling the wrapped Droste UV with plain `texture(uTex, uv)` spikes hardware `dFdx(uv)` / `dFdy(uv)` along the `atan2` branch cut and every octave wrap edge, leaving a 1 px coarse-mipmap seam. Computing `dFdx(z)` and `dFdy(z)` on the smooth un-logged plane coordinates `z`, multiplying by the analytic complex derivative `0.5 * c * (zTile / z)` and calling `textureGrad()` keeps mipmap and anisotropic selection smooth across every boundary.
- A strictly conformal Droste map is locally a similarity transform (1:1 isotropic pixel footprint), so `EXT_texture_filter_anisotropic` looks nearly identical to `LINEAR_MIPMAP_LINEAR` on a flat plane. Adding a perspective tilt homography creates foreshortened ellipses in the receding turns so you can compare trilinear vs anisotropic filtering directly on the 2 px grid and typography.
- Calling `exp(w2.x)` directly before wrapping risks float32 overflow or underflow after many octaves of dragging or auto-zoom. Wrapping `w2.x` modulo `L = ln(1 / r1)` before `exp()` keeps `exp(wx)` bounded in `[1, 1 / r1]` for arbitrary zoom depth while preserving exact branch-cut periodicity for integer strand counts.

## Not verified

- Running the 5 live checks in headless Chromium 157 (C157) to measure `gl.generateMipmap(gl.TEXTURE_2D)` error codes on NPOT `texElementSubImage2D()` textures, `MAX_TEXTURE_MAX_ANISOTROPY_EXT`, ping-pong FBO readback inside the cutout, and `document.elementsFromPoint()` on the shifted `<input>` and `<button>`.
- Real GPU rendering, visual legibility comparison across `LINEAR`, `LINEAR_MIPMAP_LINEAR` and `EXT_texture_filter_anisotropic`, and frame rate on Chrome 159 for Android (A159) at 412 px wide and device scale 2.625.
- Running `npm run check:jank -- /droste/` to measure peak `canvasMB`, `canvasMP`, layout stability and zero blank frames on load.
- Touch interaction on a phone: dragging inside `#droste-cutout` vs tapping `#droste-input` and theme buttons on the outer frame, plus on-screen keyboard focus and `webglcontextlost` recovery under memory pressure.

## For the index

- WebGL mipmaps and anisotropy: `gl.generateMipmap(gl.TEXTURE_2D)` and `EXT_texture_filter_anisotropic` on a non-power-of-two `texElementSubImage2D()` texture, paired with analytic Jacobian `textureGrad()` sampling for an Escher Droste spiral and a shared-context ping-pong mirror tunnel (not verified yet).
