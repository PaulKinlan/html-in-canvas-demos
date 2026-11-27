# Mirror-cylinder anamorphosis (`/catoptric/`)

Not verified in a live browser yet (2026-11-27). The Alhazen optical inversion and curved-cylinder ray differentials were verified mathematically in Node against forward rays and numerical finite differences; browser rendering in Chromium 157 or Chrome 159 for Android (A159) is not verified yet.

| Question | Result | Reason or detail |
|---|---|---|
| Can a live interactive HTML form be smeared into a 201-degree polar catoptric print on a tabletop and optically un-warped inside a movable 3D chrome cylinder on one WebGL 2 canvas? | Not verified in a live browser yet | One `ElementGL` WebGL 2 context uploads the 320 by 200 px drawable card via `texElementSubImage2D()`, generates mipmaps and enables max `EXT_texture_filter_anisotropic`. The fragment shader solves Alhazen's circular-mirror equation in six safeguarded Newton steps on `y = 0` (round-trip UV error `6.66e-16` in Node) and reflects cylinder rays through the same tabletop map. |
| Can curved-cylinder reflection sampling avoid 2 by 2 quad mipmap seams along the cylinder silhouette? | Not verified in a live browser yet | Analytic curved-cylinder ray differentials multiplied by the closed-form 2 by 2 Jacobian `d(uv)/dQ` (verified to `1.8e-10` in Node against finite differences) supply exact footprints to `textureGrad()` with one Alhazen solve per pixel. |
| Do clicking, hovering and typing work inside the curved chrome reflection and directly on the smeared tabletop polar print via `updateElementGeometry()`? | Not verified in a live browser yet | On `pointermove` and `pointerdown` (capture phase), the CPU mirrors the 3D raytrace and analytic Jacobian, inverts `dq/dp` into a local tangent `DOMMatrix` scaled by `geometryUnit()`, and calls `canvas.updateElementGeometry()` plus `card.dataset.hitTick`. Cold touch taps activate controls on `pointerup` within 8 px while drags slide the cylinder or orbit the camera. |
| Does lifting or sliding the chrome cylinder off the focal circle distort and clear the reflection as expected? | Not verified in a live browser yet | Sliding `(cylX, cylZ)` off `(0, 0)` shifts reflected rays away from the focal circle used by `solveTableUV()`, visibly breaking alignment until centred again; lifting `cylLift` to `2.9` clears the mirror and shadow to show the bare brass focal circle and tabletop print. |

## Things that bit

- A naive polar `(r, phi)` tabletop print does not invert a perspective cylindrical reflection cleanly: constant height on a vertical cylinder reflects onto a Pascal limacon on `y = 0`, bowing straight lines in the mirror. Solving Alhazen's circular-mirror equation (`atan(Z0 sin(theta), Z0 cos(theta) - R) = atan(r sin(phi - theta), r cos(phi - theta) - R)`) in six Newton steps and computing `y = Y0 * d2 / (d1 + d2)` cancels the distortion to floating-point precision while keeping both tabletop and mirror driven by one shared optical function.
- With a wide-angle close camera (`elev = 36 deg`, `dist = 5.4`), the top edge of the reflected card maps past the bottom edge of the viewport on `y = 0`, clipping the outer rim of the horseshoe print. Stepping back to a gallery focal length (`fovY = 27.5 deg`, `elev = 41 deg`, `dist = 8.4`) keeps both the full 201-degree polar horseshoe and the 1.60:1 reflected card inside the frame at once, and widening `tanHalf` slightly on narrow viewports (`aspect < 1.16`) keeps the horseshoe unclipped at 412 px phone width without shifting the reference camera `C0`.
- Because `#catoptric-card` is rectangular (`320 x 200`, 1.60:1) rather than square, the inverse matrix `uHitInv` used to draw the cyan hit-box wireframe overlay has to divide row 0 by `cardW` and row 1 by `cardH` separately so the wireframe tracks the actual control bounds.
- Directly on the flat tabletop print, increasing screen `y` moves outward in radius (toward `v = 0`, the top of the card), so the local Jacobian `dq/dp` has a negative determinant (top-to-bottom mirrored), whereas on the chrome cylinder reflection the determinant is positive (upright). Guarding on `Math.abs(det) < 1e-6` and `Math.sqrt(Math.abs(...))` allows local-Jacobian `updateElementGeometry()` reprojection to work on both surfaces.

## Not verified

- Live checks 1 through 5 in Chromium 157 or Chrome Canary 160 (`ElementGL` + `texElementSubImage2D()` + `generateMipmap()`, central ray Jacobian, `elementsFromPoint()` on a reprojected button inside the cylinder reflection, offset/lift shift, and synthetic `webglcontextlost` recovery).
- Visual legibility, frame rate and touch interaction (cold touch tap on buttons and `<input>`, sliding the cylinder cap, orbiting the tabletop) on Chrome 159 for Android (A159) at 412 px wide and device scale 2.625.
- Running `npm run check:jank -- /catoptric/` to verify layout stability, canvas memory budget and zero blank frames on load.

## For the index

- 3D raytraced mirror reflection and hit reprojection: Alhazen circular-mirror catoptric anamorphosis on one `ElementGL` WebGL 2 context with curved-surface ray differentials for `textureGrad()` and local-Jacobian `updateElementGeometry()` reprojection across both the chrome cylinder reflection and the flat polar tabletop print (not verified in a live browser yet).
