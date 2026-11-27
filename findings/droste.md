# Escher Droste spiral (`/droste/`)

Measured in headless Chrome Canary 160 (`160.0.8186.0`, ANGLE SwiftShader, device scale 2 and 2.625) on 2026-11-27. Real GPU rendering and Android phone touch testing (A159) are not verified yet.

| Question | Result | Reason or detail |
|---|---|---|
| Does `gl.generateMipmap(gl.TEXTURE_2D)` succeed after `gl.texElementSubImage2D()` on non-power-of-two element dimensions? | Works (measured, C160) | `gl.generateMipmap(gl.TEXTURE_2D)` returned `gl.getError() === 0` after `texElementSubImage2D()` on NPOT textures (both `901x901` on the main stage and `300x150` on the isolated fixture), producing 9-10 mip levels with non-empty minified readback `rgba(70, 122, 255, 255)`. |
| Does `EXT_texture_filter_anisotropic` apply cleanly to a `texElementSubImage2D()` texture and sharpen tilted spiral turns? | Works (measured, C160) | Extension present with `MAX_TEXTURE_MAX_ANISOTROPY_EXT = 16`, `applied = 16`, `gl.getError() = 0`. Visual legibility on a hardware GPU and phone screen is not verified yet. |
| Can an analytic complex-logarithm Escher Droste shader wrap a live editable HTML card across 10+ octaves without branch-cut or wrap seams? | Works (measured, C160) | Measures `r1 = cutout.offsetWidth / card.offsetWidth`, computes `w' = (1 + i * strands * L / (2 * pi)) * (ln(z) - offset)`, wraps `w'.x` modulo `L` before `exp()`, wraps the Chebyshev norm into `[r1, 1]`, and passes the analytic Jacobian `0.5 * c * (zTile / z) * dFdx(z)` to `textureGrad()`. |
| Can a two-FBO ping-pong mirror tunnel share the same `ElementGL` context and echo live DOM edits down the transparent cutout? | Works (measured, C160) | Two `RGBA8` ping-pong framebuffers on `stage.gl` pass `FRAMEBUFFER_COMPLETE`, `gl.getError() === 0`, and echo the vermilion frame inside the transparent cutout. |
| Can elements on rotated, shrunken inner turns of the Droste spiral (and inner echoes of the mirror tunnel) be hovered, clicked and typed into? | Works (measured, C160) | Dynamic local-Jacobian reprojection mirrors `DROSTE_FRAG` (and `MIRROR_FRAG`) on the CPU under the pointer, inverts the 2x2 Jacobian `dq/dp` into a tangent card-to-canvas `DOMMatrix`, scales it by `geometryUnit()`, and updates `canvas.updateElementGeometry()` + `card.dataset.hitTick`. Real CDP mouse clicks on `Turn -1` (`0.27x` scale) switched theme to `vermilion`, `Turn -1` (`0.41x`) incremented `+1 Pulse`, and `Turn -2` (`0.20x`) focused `#droste-input` and typed `'!'` (`"ESCHER 1956!"`). |

## Things that bit

- Calling `canvas.updateElementGeometry(card, { canvasTransform })` without scaling by `geometryUnit(canvas, card, layout.cardSize)` shrinks the hit box by `1 / devicePixelRatio` on high-DPI WebGL canvases (leaving controls unreachable at DPR 2 or 2.625). Multiplying by `geometryUnit()` aligns native hit-testing across all DPRs.
- Because `updateElementGeometry()` takes a single 4x4 matrix, a static placement can only cover one copy of the card. Reprojecting the local tangent matrix dynamically on `pointermove` (capture phase) and cold `pointerdown` (for touch taps without prior hover) makes every spiral turn and mirror echo interactable while keeping drags on non-interactive frame regions working for zoom and rotation.
- Sampling the wrapped Droste UV with plain `texture(uTex, uv)` spikes hardware `dFdx(uv)` / `dFdy(uv)` along the `atan2` branch cut and every octave wrap edge, leaving a 1 px coarse-mipmap seam. Computing `dFdx(z)` and `dFdy(z)` on the smooth un-logged plane coordinates `z`, multiplying by the analytic complex derivative `0.5 * c * (zTile / z)` and calling `textureGrad()` keeps mipmap and anisotropic selection smooth across every boundary.
- A strictly conformal Droste map is locally a similarity transform (1:1 isotropic pixel footprint), so `EXT_texture_filter_anisotropic` looks nearly identical to `LINEAR_MIPMAP_LINEAR` on a flat plane. Adding a perspective tilt homography creates foreshortened ellipses in the receding turns so you can compare trilinear vs anisotropic filtering directly on the 2 px grid and typography.
- Calling `exp(w2.x)` directly before wrapping risks float32 overflow or underflow after many octaves of dragging or auto-zoom. Wrapping `w2.x` modulo `L = ln(1 / r1)` before `exp()` keeps `exp(wx)` bounded in `[1, 1 / r1]` for arbitrary zoom depth while preserving exact branch-cut periodicity for integer strand counts.

## Not verified

- Real GPU rendering, visual legibility comparison across `LINEAR`, `LINEAR_MIPMAP_LINEAR` and `EXT_texture_filter_anisotropic`, and frame rate on Chrome 159 for Android (A159) at 412 px wide and device scale 2.625.
- Running `npm run check:jank -- /droste/` to measure layout stability and zero blank frames on load.
- Touch interaction on a phone: cold touch taps on inner spiral turns (`pendingTap` activation), dragging frame borders to zoom and rotate, on-screen keyboard focus and `webglcontextlost` recovery under memory pressure.

## For the index

- WebGL mipmaps and anisotropy: `gl.generateMipmap(gl.TEXTURE_2D)` and `EXT_texture_filter_anisotropic` on a non-power-of-two `texElementSubImage2D()` texture, paired with analytic Jacobian `textureGrad()` sampling and pointer-following local-Jacobian `updateElementGeometry()` hit reprojection across every spiral turn and mirror echo (measured, C160).
