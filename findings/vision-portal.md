# Head-tracked 3D portal (`/vision-portal/`)

Static source checks run on 2026-11-26 (`node --check public/vision-portal/portal.js`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs /vision-portal/`). Live browser measurements in C157 (headless Chromium) and A159 (Chrome on Android) are not verified yet.

## Results

| Question | Status | Result / notes |
|---|---|---|
| Off-axis asymmetric frustum pins `z = 0` glass border while shifting `z = +0.15`, `-0.35` and `-0.85` HTML cards | Not verified (live browser) | Built in `buildOffAxisVP()` with `left = (-halfW - ex) * (near / ez)` and companion `ElementGL` room shader. Analytical check shows `z = 0` stays at NDC `+/-1.0`, while `eyeX = -0.3` to `+0.3` shifts `z = -0.85` by `+0.092` NDC and `z = +0.15` by `-0.023` NDC. |
| `updateElementGeometry()` aligns hit-testing under 60 fps off-axis perspective matrices | Not verified (live browser) | Uses `M_ndcToCss * VP * M_elemToWorld` scaled by `geometryUnit()` from `/lib/surface.js`, plus a `dataset.hitTick` toggle on every matrix change. Live check #4 verifies `document.elementsFromPoint()` on an isolated fixture before and after shifting `eyeX` from `-0.65` to `+0.65`. |
| `FaceDetector` drives off-axis eye position from a live front camera | Not verified (needs real webcam + Shape Detection flag) | Starts only on a tap of **Camera face**, mirrors the face bounding-box centre into `(ex, ey, ez)`, draws a corner selfie preview on `stage.gl` with no extra canvas, and stops all tracks on mode switch or `pagehide`. |
| `BarcodeDetector` pins live interactive HTML onto a tilted QR/barcode quad | Not verified (needs real camera + physical QR code) | Starts only on a tap of **AR barcode**, fits a closed-form 4-corner projective homography (`quadHomographyUnitToCss()`) from `cornerPoints` to both `ElementGL.quad()` and `updateElementGeometry()`. Includes a procedural 3D-tilted synthetic QR target so 4-corner homography pinning can be tested without a camera or physical QR code. |
| Single WebGL 2 context and mobile GPU budget | Measured (source check, 2026-11-26) | `node tools/gfx/check.mjs` passes with 0 problems. Uses one `ElementGL` context (`antialias: false`), zero `getImageData()` calls in any frame loop, and `<meta name="checks" content="tap">`. |

## Things that bit

- **No pixel-readback fallback for camera tracking.** Calling `getImageData()` inside `requestAnimationFrame()` breaks `npm run check:gfx` (`timed-readback`) and loses accelerated canvases on Android Chrome. Rather than reading camera frames back to JS when `FaceDetector` is unavailable, the page reports Shape Detection availability plainly and keeps pointer drag, auto sweep and device tilt working alongside the live camera preview.
- **Restoring `ElementGL` program and VAO bindings.** `ElementGL.begin()` binds its internal quad program and VAO, while `ElementGL.quad()` assumes they are still bound. Saving `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` right after `stage.begin()` lets companion shaders draw the 3D perspective grid room, camera video feed and corner overlays on the same single WebGL 2 context before restoring `ElementGL` for the HTML cards.
- **Throttling live telemetry DOM writes.** Writing the eye coordinates into `#card-deep` on every 60 fps frame would trigger a `paint` event and `texElementSubImage2D()` upload 60 times a second. Throttling telemetry text updates to about 7 Hz (and skipping unchanged text) keeps the deep card live without constant texture re-uploads.
- **Portrait phone layout at 412 px.** Side-by-side 3D cards overlap on a narrow portrait screen. `screenHalfExtents()` normalises the shorter half-axis to `1.0` and switches to three stacked depth bands when `aspect < 1.05`, keeping all three cards readable and tappable at 412 px wide.

## Not verified

- Headless Chromium 157 execution of the 5 live checks and `npm run check:jank -- /vision-portal/`.
- Real-time `FaceDetector` tracking on desktop Chrome (with `chrome://flags/#enable-experimental-web-platform-features`) and Android Chrome.
- Real-time `BarcodeDetector` `cornerPoints` alignment and touch hit-testing on a physical tilted QR code on Android Chrome.
- `DeviceOrientationEvent` tilt tracking and permission prompt on mobile Safari / Android Chrome.
- HiDPI hit-box alignment (`geometryUnit()`) at 2.625 device scale factor under rapid off-axis parallax and 3D card tilt.

## For the index

- **Hit testing (`updateElementGeometry`)**: `/vision-portal/` drives both off-axis 3D frustum layers (`z = +0.15`, `-0.35`, `-0.85`) and 4-corner barcode homographies through one 4×4 `DOMMatrix` + `geometryUnit()` + `dataset.hitTick` path (not verified yet in a live browser).
- **Shape Detection (`FaceDetector`, `BarcodeDetector`)**: `/vision-portal/` pairs `FaceDetector` head tracking and `BarcodeDetector` 4-corner QR pinning with `ElementGL` `texElementSubImage2D()` on one WebGL 2 context without `getImageData()` readbacks (not verified yet on real camera hardware).
