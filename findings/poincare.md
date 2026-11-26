# Hyperbolic Poincaré disk (`/poincare/`)

Status on 2026-11-26: static checks passed (`node --check public/poincare/poincare.js`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs /poincare/`). Live browser verification in headless Chromium 157 (C157) and Chrome 159 on Android (A159) is not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context drawing a `{7, 4}` hyperbolic geodesic tiling and eight live `drawable` HTML cards via `texElementSubImage2D()` | not verified | Saves and restores `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` on `stage.gl` around the tiling and wireframe passes so the whole page holds one WebGL 2 context. Covered by live check 1 on an isolated 200 by 200 `testStage()` fixture. |
| Exact inverse Möbius fragment shader `M_k^{-1}(w)` curving card edges into circular geodesic arcs without mesh faceting | not verified | `CARD_FRAGMENT` evaluates `z = M_k^{-1}(w)` per pixel, anti-aliases rounded borders using the analytic conformal derivative `|dz/dw|`, and switches to a 4-tap supersample when a card shrinks near the rim. Needs C157 and A159 runs to confirm visual crispness. |
| Complex Möbius isometries preserving the unit disk (`|T_a(z)| < 1`) and exact invertibility (`T_{-a}(T_a(z)) === z`) | not verified | Covered by live check 2 across 144 interior `(a, z)` pairs plus combined card inverse `M_k^{-1}(M_k(z))` and finite-difference check of `M_k'(0) = u_k (1 - |w_k|^2)`. |
| Local-Jacobian conformal `DOMMatrix` passed to `updateElementGeometry()` with `geometryUnit()` and `dataset.hitTick` cache clearing | not verified | Linearises `M_k` at each card's centre into uniform scale `1 - |w_k|^2`, rotation `arg(u_k)` and translation, scaled by `geometryUnit()`. Covered by live check 3 via `document.elementsFromPoint()` at the origin and after a Möbius shift. |
| Geodesic Möbius glide on `Tab` (`focusin`) or tap bringing an off-centre card upright to `z = 0` without losing DOM input state | not verified | Interpolates hyperbolic distance `atanh(|w_0|)` along a diameter while unwinding Thomas-Wigner rotation `arg(u_0)` (snapping directly when `prefers-reduced-motion: reduce` is set). Covered by live check 4 on an isolated `testStage()` fixture. |
| Optional hit-box tangent approximation wireframe overlay showing exact match at `z = 0` vs corner curvature error near the rim | not verified | Draws extruded screen-space triangle quads for each card's linear Jacobian rectangle, centre tangent crosshair, and yellow error ticks from linear corners to exact curved Möbius corners. Needs C157 and A159 runs to inspect visually. |
| Plain HTML fallback when HTML-in-canvas WebGL 2 is absent or `webglcontextlost` fires | not verified | Moves the eight live cards into `#fallback-grid` without dropping input values or event listeners, and returns them to `<canvas>` on `webglcontextrestored`. |

## Things that bit

- `canvas.updateElementGeometry()` accepts only a linear 4 by 4 `DOMMatrix`, so a curved hyperbolic card near the Poincaré boundary can't have a curved hit region. Linearising at the card centre `w_k = M_k(0)` gives an exact conformal tangent box (no shear) whose error is `0.0 px` at `z = 0` and grows toward the four corners near the rim. Gliding any focused or tapped card to `z = 0` avoids asking visitors to target curved rim controls directly.
- Composing pure hyperbolic drag translations (`T_{-p_1} o T_{p_0} o V_0`) produces real Thomas-Wigner rotation when dragging around a closed loop. Capturing `startView` on `pointerdown` stops floating-point drift during a drag, and unwinding `arg(u_k)` during a geodesic glide returns any card upright when centred.
- Toggling `dataset.hitTick` inside `paint` on every repaint can schedule another `paint` event. Gating the attribute flip behind a quantized per-card transform key clears Chromium's hit-test cache only when a card actually moves or resizes.
- `ElementGL` keeps its quad program and VAO private. Reading `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` right after `stage.begin()` lets the `{7, 4}` tiling pass and Jacobian wireframe pass share `stage.gl` without opening a second WebGL context.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /poincare/` and `?autochecks=1`): verifying all four live checks, zero layout shift, GPU memory under 96 MB and canvas under 4 MP (about 1.0 MP expected at 412 px wide, scale 2.625), and clean retirement of `testStage()` fixtures.
- Chrome 159 on Android (412 px wide, scale 2.625): touch dragging across the disk without page scroll, tapping rim cards to glide them to `z = 0`, using the range sliders and checkboxes inside curved cards, typing into the text inputs with the on-screen keyboard, and toggling the Jacobian wireframe overlay.
- Keyboard navigation (`Tab` and `Shift+Tab` through all eight cards inside `<canvas layoutsubtree>`) and screen reader announcements on C157 and A159.
- Context loss and restore (`webglcontextlost` and `webglcontextrestored`) preserving live card state across the plain HTML fallback grid and back into WebGL 2.

## For the index

- `updateElementGeometry()`: non-Euclidean Möbius transforms can map live HTML cards via exact inverse GLSL shaders while passing the local complex Jacobian `M'(0) = u (1 - |w|^2)` as a conformal `DOMMatrix`, gliding any focused card to `z = 0` where curvature error drops to zero (not verified, `/poincare/`).
