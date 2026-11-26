# Anamorphic projection (`/anamorphic/`)

Built on 2026-11-26. Syntax checked with `node --check public/anamorphic/anamorphic.js`, graphics rules checked with `node tools/gfx/check.mjs`, and prose checked with `node tools/writing/check.mjs --strict /anamorphic/`. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /anamorphic/`, and Chrome 159 on Android at 412 px) are **not verified** yet.

The question: can one live interactive HTML element be projected from a virtual cinema projector across a multi-plane 3D staircase and gallery corner so it snaps flat at the projector's sweet spot, and what happens to `updateElementGeometry()` when one DOM element spans twelve non-coplanar faces?

| Experiment | Status | Notes |
|---|---|---|
| Projective texturing of one live `drawable` HTML poster across a five-step concrete staircase, left wall, back wall, stepped side cheek and floor on one `ElementGL` WebGL 2 context | not verified | Fragment shader projects world coordinates through the fixed projector matrix `uProjVP` and samples the mipmapped anisotropic texture uploaded by `gl.texElementSubImage2D()`. Needs Chromium 157+ live run to verify texture upload and visual alignment. |
| Sweet-spot depth cancellation across all twelve non-coplanar gallery faces | not verified | Live check 2 verifies numerically across 20 sample rays spanning 2.8 m to 5.6 m in depth that matching the viewer camera to the projector collapses every face onto a single flat rectangle (`< 0.001 px` error). Needs browser run to record measured values. |
| Single-homography `updateElementGeometry()` alignment at the sweet spot (`geometryUnit()` + `dataset.hitTick`) | not verified | Live check 3 applies the plane homography matrix to an isolated fixture canvas and probes `document.elementsFromPoint()` on the projected `<button>`. Needs Chromium 157+ run at DPR 1 and DPR 2.625. |
| Multi-plane hit-box divergence at 35° orbit vs per-face raycast tracking | not verified | Live check 4 measures screen-space drift between the single fixed diagonal stair plane and the actual five steps and walls at 35° orbit, and verifies that swapping `updateElementGeometry()` to the raycast face's exact plane homography reduces error at that face back to `< 0.001 px`. |
| 2D `drawElementImage()` fallback and plain-HTML rescue on context loss | not verified | Uses a 5-argument `ctx.drawElementImage(posterEl, x, y, dw, dh)` fallback when WebGL 2 `texElementSubImage2D()` is absent, and moves `#poster-card` into `#plain-host` when HTML-in-canvas is unavailable or WebGL context is lost. |

## Things that bit

- Keeping the staircase completely free of projector self-occlusion requires the projector eye (`[1.55, 2.05, 2.75]`) to sit above the top landing (`y = 1.20`), in front of step 1 (`z = 0.30`) and to the right of the stepped side cheek (`x = 1.15`). Any point on the left wall above the stair profile then has a clear line of sight from the projector without needing a shadow map.
- `canvas.updateElementGeometry()` accepts one 4x4 `DOMMatrix` per drawable element, which represents a single projective plane. Intersecting projector rays `P_eye + t * D(ex, ey)` with any plane `N . X = d` is linear in homogeneous coordinates (`X_hom = (N . D) * P_eye + (d - N . P_eye) * D`, `w = N . D`), so every stair riser, tread or wall has an exact 4x4 matrix, but only one face's matrix can be active in Chromium's hit-test tree at a time.
- On a portrait phone viewport (4:5 aspect), using a fixed desktop vertical FOV crops the left and right sides of the 360x256 poster at the sweet spot. Computing `fView = min(0.84 * fProj, 0.84 * fProj * (viewAspect / projAspect))` keeps the entire projected webpage inside both 16:10 desktop and 4:5 mobile viewports while preserving exact depth cancellation at the sweet spot.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /anamorphic/` and live checks 1 to 5): confirm zero layout shift, zero timed readbacks, backing store under 4 MP at 412 px and DPR 2.625, and record exact measured divergence and hit-test coordinates.
- Chrome 159 on Android at 412 px wide by touch: drag to orbit around the stairs, tap the poster's colour swatches, `Invert` and `Grid` buttons, drag the `Type` range slider and type into the headline `<input>` both at the sweet spot and while orbited in `Track pointer face` mode.
- Keyboard focus rings and text selection rectangles when orbited in `Track pointer face` mode (where `updateElementGeometry()` tracks the pointer's face, not necessarily the focused control's face).

## For the index

- WebGL and 3D: `/anamorphic/` projects one live interactive HTML poster from a fixed virtual projector onto a five-step 3D staircase and gallery corner on one `ElementGL` context, snapping flat at the sweet spot and measuring the single-homography limit of `updateElementGeometry()` across twelve non-coplanar faces.
