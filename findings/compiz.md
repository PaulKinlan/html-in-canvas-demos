# Compiz wobbly windows and cube (`/compiz/`)

Status on 2026-11-27: static checks passed (`node --check public/compiz/compiz.js`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs --strict /compiz/`). Live browser runs on headless Chromium 157 (C157) and Chrome 159 on Android (A159) are not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context uploading live `drawable` HTML windows via `texElementSubImage2D()` and rendering a 20 by 20 bicubic Bezier spring mesh | not verified | Saves and restores `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` on `stage.gl` around the wallpaper, Bezier mesh, wireframe cage and 3D cube passes so the page holds one WebGL 2 context. Covered by live check 1 on an isolated 240 by 200 `testStage()` fixture. |
| 4 by 4 vectorial spring-mass grid producing elastic corner lag on grab or fling and damping back to an upright rectangle | not verified | Uses Compiz's vectorial rest-offset springs (`(stepX, 0)` and `(0, stepY)`) with 240 Hz symplectic substeps so large drags shear and ripple without inverting the mesh. Covered by live check 2. |
| Translucent 4-face 3D desktop cube with procedural caps and real-time glossy floor reflection on one `ElementGL` context | not verified | Sorts the six convex faces (four live HTML workspaces plus top and bottom caps) ascending by camera-space Z for both the mirrored floor pass and the main cube pass so premultiplied alpha composites cleanly. Covered by live check 3 on an isolated 240 by 220 fixture. |
| `updateElementGeometry()` scaled by `geometryUnit()` keeping live HTML buttons and inputs clickable on both the sheared wobbly window and the tilted front cube face | not verified | Uses a 4-corner least-squares affine `DOMMatrix` in wobbly mode and the exact perspective `DOMMatrix` (with outward normal in column 2 to keep the matrix invertible) on the frontmost cube face, gating `dataset.hitTick` behind a quantized transform key. Covered by live check 4 via `document.elementsFromPoint()`. |
| 2D 5-argument `drawElementImage()` fallback and plain HTML context-loss fallback | not verified | When `texElementSubImage2D()` is absent and 2D `drawElementImage()` is present, draws the sheared wobbly window and projected cube faces with 5-argument calls (`el, 0, 0, elW, elH`). On `webglcontextlost`, `contextlost`, or without HTML-in-canvas, moves all five live elements into `#fallback-deck` and restores them to `<canvas>` on context restoration. |

## Things that bit

- Scalar distance springs on a 4 by 4 grid allow fast drags to buckle or fold a window inside out. Switching to Compiz's vectorial rest-offset springs (`(stepX, 0)` horizontally and `(0, stepY)` vertically) with 240 Hz symplectic substeps keeps the window upright at every stiffness and friction setting.
- `canvas.updateElementGeometry()` requires an invertible 4 by 4 `DOMMatrix` so the browser can map pointer points back through its inverse. For the flat 3D cube faces, placing the outward face normal in column 2 of the element-to-cube transform keeps the composed projective matrix non-singular.
- Inactive `drawable` children inside `<canvas layoutsubtree>` remain keyboard Tab stops and hit-test targets if left alone. Marking the inactive mode's windows and the three non-front cube faces `inert` (and parking their geometry offstage) keeps clicks and focus locked onto the active front window.
- Toggling `dataset.hitTick` unconditionally inside `paint` can schedule another repaint. Gating the flip on a quantized transform string per element clears Chromium's hit-test cache only when the window or cube actually moves.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /compiz/` and `?autochecks=1`): verifying all four live checks, zero layout shift, GPU memory under 96 MB and canvas under 4 MP (about 1.35 MP expected at 412 px wide, scale 2.625), and clean retirement of `testStage()` fixtures.
- Chrome 159 on Android (412 px wide, scale 2.625): touch dragging the wobbly titlebar without page scroll, pressing `+1 Ping` and typing into `#win-cmd` while wobbling, toggling the 20 by 20 wireframe overlay, dragging the 3D cube across all four workspaces, and adjusting sliders on Workspace 2 directly on the tilted front face.
- Context loss and restoration (`webglcontextlost` and `webglcontextrestored`) moving the five live windows into `#fallback-deck` and back without losing input state.

## For the index

- `texElementSubImage2D()`: one `ElementGL` context can drive both a 20 by 20 bicubic Bezier spring mesh (4 by 4 control points) and a 4-face translucent 3D cube with real-time floor reflection on live HTML windows (not verified, `/compiz/`).
- `updateElementGeometry()`: 4-corner least-squares affine matrices track sheared Bezier windows while column-2-normal projective matrices keep tilted 3D cube workspaces clickable, with back faces marked `inert` (not verified, `/compiz/`).
