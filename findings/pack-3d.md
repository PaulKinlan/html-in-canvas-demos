# Curved 3D packaging customiser with live DOM labels (`/pack-3d/`)

Built on 2026-11-22. Source checked locally with `npm run check:gfx` and `node tools/writing/check.mjs --strict`. Live browser execution in headless Chromium (C157) and on Chrome for Android (A159) is **not verified** in this run; all six live checks run on isolated fixtures in the visitor's browser once tapped (`<meta name="checks" content="tap">`).

The question: can a live editable HTML product label wrap around a curved 3D coffee tin or vinyl sleeve in WebGL so you can spin the object, type and click directly onto the curved surface, and flatten it to a print-ready PNG?

Prior art credited on the page: curved-surface tangent-plane `updateElementGeometry()` hit testing builds on `/three-form/` in this repository, and the workflow responds to browser 3D product configurators (such as three.js packaging and sneaker customisers) that normally bake label text into a 2D canvas texture instead of hosting live accessible DOM on the product.

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context driving a custom 3D mesh shader (`gl.texElementSubImage2D()` + mipmaps) | Not verified in Chromium yet | Compiles one 3D lighting shader on `stage.gl` for the curved coffee tin cylinder, brushed metal lid/rims, 3D vinyl sleeve with grooved disc, studio contact shadow and unrolled flat print net. Live check 1 verifies `ElementGL.upload()` and pixel output on an isolated fixture. |
| Curved-surface tangent-plane `updateElementGeometry()` + `dataset.hitTick` cache flush | Not verified in Chromium yet | Raycasts the live mesh triangles in JS on `pointermove` and `pointerdown` (capture phase), builds a local UV Jacobian `DOMMatrix` and calls `canvas.updateElementGeometry(label, { canvasTransform })` plus `label.dataset.hitTick`. Live check 2 tests two affine placements with `document.elementFromPoint()`. |
| Live DOM and CSS custom property edits repainting the wrapped WebGL texture | Not verified in Chromium yet | Editing `<input>` fields, `<select>`, colour swatches (`data-theme` custom properties) or tasting-note checkboxes triggers `paint` and re-uploads `#pack-label`. Live check 3 verifies a CSS custom property change flips pixel colour from ochre to cobalt. |
| `captureElementImage()` snapshot lifecycle and cross-canvas boundary | Not verified in Chromium yet | Live check 4 captures a snapshot, redraws it on the owning 2D canvas, checks whether a separate plain canvas refuses it, and calls `snap.close()` in a `finally` block so zero snapshots stay open. |
| Flat print-ready PNG export on tap via FBO `gl.readPixels()` (WebGL) or `captureElementImage()` copy (2D) | Not verified in Chromium yet | Attaches the flat uploaded `RGBA8` label texture to a temporary framebuffer on `stage.gl` for one `gl.readPixels()` call on user tap only, unpremultiplies alpha into a plain non-drawable 2D canvas and calls `toDataURL('image/png')`. Live check 5 checks left/right panel colours through the same FBO path. |
| Context loss, 2D cylinder-slice fallback and plain-HTML rescue | Not verified in Chromium yet | Falls back to 5-argument `drawElementImage()` cylinder slices when WebGL 2 `texElementSubImage2D()` is absent, and moves `#pack-label` into `.plain-host` when HTML-in-canvas is missing or the context is lost. Live check 6 runs `stillDrawn()` on a plain copy of the visible canvas. |

## Things that bit

- `captureElementImage()` snapshots cannot be drawn onto a different canvas in Chromium ("The source was captured from a different canvas", recorded in `findings/flutter-dom.md`). In WebGL 2 mode, reading the already-uploaded flat label texture through a one-shot framebuffer `gl.readPixels()` on user tap avoids both cross-canvas rejection and extra drawable canvases, while keeping frame loops free of readbacks.
- A 720×360 drawable label can overflow a 412 px viewport if left in plain HTML flow or if its stage isn't clipped. The stage keeps `overflow: hidden` in canvas mode, caps the canvas backing store below 3.6 megapixels, and switches `#pack-label` to `width: 100%; height: auto` with a single-column stack below 620 px in `.plain-host` fallback mode.
- On a phone with no pointer hover, dragging over the tin to spin it competes with tapping inputs on the label. Adding a `Spin object` mode toggle beside `Interact with label`, pausing auto-orbit while a label field has focus, and setting `overflow-anchor: none` on the canvas keeps touch orbit and curved editing out of each other's way.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /pack-3d/` and `node tools/draw-size/audit.mjs /pack-3d/`): run both to check layout stability, zero timed readbacks, `openSnapshots === 0`, backing-store sizing at 412 px and DPR 2.625, and live check pass counts.
- Chrome 159 on Android at 412 px wide by touch: spinning the coffee tin and vinyl sleeve, tapping the `<input>` fields, `<select>`, colour swatches and tasting-note checkboxes directly on the curved surface, unrolling to the flat print net, and downloading the exported PNG.
- Exact FBO readback orientation (`UNPACK_FLIP_Y_WEBGL = false` with `gl.texElementSubImage2D()` vs `gl.readPixels()` row 0) in Chromium 157 and Chrome 159 on Android: confirm the exported PNG is right-side up rather than vertically inverted.

## For the index

- WebGL and 3D: `/pack-3d/` wraps a 720×360 two-panel live HTML form around a coffee tin cylinder, a 3D vinyl sleeve and an animated flat print net on one `ElementGL` context, using tangent-plane `updateElementGeometry()` hit testing (building on `/three-form/`) and one-shot FBO `gl.readPixels()` PNG export on tap.
