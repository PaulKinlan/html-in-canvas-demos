# 3D Tilt View DOM layer inspector (`/tilt-layers/`)

Not verified in a live browser yet (built on 2026-11-22). All live checks wait for a tap on the page and need Chromium with `#canvas-draw-element` enabled (C157 or newer, and A159 on Android for touch verification).

## Inspirations and credits

- Mozilla Firefox 3D Tilt View (Victor Porof, Firefox 11 to 46), which rendered DOM nesting depth as a 3D exploded stack in WebGL.
- Microsoft Edge DevTools 3D View panel, which brought back layered z-index and DOM depth inspection.
- `/structure-depth/` and `/layout-debug/` on this site, which showed perspective transforms with `updateElementGeometry()`, hit-test cache invalidation, and devtools overlays over live drawn elements.

## What was built and what needs measuring

| Question | Status | What the live check tests |
|---|---|---|
| Can one `ElementGL` WebGL 2 context render five `drawable` layers at separate Z depths alongside extruded side slabs, wireframes and depth connectors? | not verified | Check 1 uploads two stacked `drawable` layers under perspective into one `ElementGL` context and samples both layers via a plain 2D copy canvas. |
| Does `updateElementGeometry()` route `elementFromPoint()` to the tilted front layer over a back layer? | not verified | Check 2 draws overlapping buttons at `z = 0` and `z = 45` under perspective and tests both the overlapped front centre and an exposed corner of the back button. |
| Does parking upper layers (`scale(0.001)` plus `inert = true`) allow Solo mode clicks to reach lower layers? | not verified | Check 3 stacks two identical buttons, parks the top layer and checks that `elementFromPoint()` shifts from `#btnHi` to `#btnLo`. |
| Does updating `dataset.hitTick` clear Chromium's hit-test cache when a tilted layer moves? | not verified | Check 4 shifts a tilted button from left to right and records `elementFromPoint()` before and after bumping `dataset.hitTick`. |
| Do `<input type="text">` and `<select>` inside a tilted `drawable` layer hit test and repaint on update? | not verified | Check 5 checks `elementFromPoint()` at the projected centres of an input and a select, then updates the input value and records the paint count. |
| Does the 2D isometric fallback draw and hit test using five-argument `drawElementImage()`? | not verified | Check 6 draws a sheared layer on a 2D drawable canvas with `drawElementImage(el, 0, 0, el.offsetWidth, el.offsetHeight)`, samples its pixels via a copy canvas and hit tests the button. |

## Design notes and things that bit during build

- `ElementGL.quad()` relies on `ElementGL.begin()` having bound its own program and VAO, so drawing a second colour shader (`geom.prog`) on `stage.gl` requires capturing and restoring `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` before each `stage.quad()` call.
- `ElementGL` uses premultiplied alpha blending (`gl.ONE`, `gl.ONE_MINUS_SRC_ALPHA`). Premultiplying `vColor.rgb * vColor.a` in the companion slab fragment shader keeps blending consistent without switching blend state.
- `DOMMatrix` keeps Z in CSS pixels while WebGL clips outside `[-w, w]`. Zeroing row 3 (`m13`, `m23`, `m33`, `m43`) of the clip matrix after applying perspective keeps `x/w` and `y/w` identical to `updateElementGeometry()` with no near or far plane clipping.
- Gating `el.dataset.hitTick` behind a per-layer transform key avoids triggering a DOM mutation on unchanged repaints.

## Not verified

- Running the six live checks in headless Chromium 157 (C157) and recording exact pass/fail numbers.
- Running `npm run check:jank -- /tilt-layers/` at 412 px and DPR 2.625.
- Real touch orbiting, button tapping, text selection drag handles and native `<select>` picker placement on Chrome 159 for Android (A159) inside a perspective-transformed layer.
- Frame rate when dragging the orbit camera with all five `drawable` layers uploading on live edits.
- Screen reader output and keyboard focus ring placement across the tilted stack, especially when toggling `Solo selected layer` (`inert` on non-selected layers).

## For the index

- DevTools in a canvas: `/tilt-layers/` lifts five `drawable` layers of a mini web app into an exploded WebGL 2 stack on one `ElementGL` context with extruded side slabs, solo mode and per-layer `updateElementGeometry()` hit boxes (not verified, `/tilt-layers/`).
