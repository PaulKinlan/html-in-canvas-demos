# Two-sided 3D hardcover book with live HTML pages (`/page-book/`)

Results here are `not verified` on 2026-11-22. The page has passed static graphics (`npm run check:gfx`) and writing (`node tools/writing/check.mjs --strict`) checks, and has not yet been run in C157 (headless Chromium 157) or A159 (Chrome 159 on Android, 412 px wide).

## What was built

One `<canvas content="drawable" layoutsubtree>` holding six live `drawable` HTML pages bound as three two-sided leaves (pages 1/2, 3/4 and 5/6):

- Page 1 (front cover): hardcover title cartouche, live bookmark colour `<select>` and editable Ex Libris `<input>`.
- Pages 2 and 3 (spread 1, field notes): selectable serif prose, a clickable footnote `<button>` toggling an inline `<aside>`, and a five-item `<input type="checkbox">` list with a live `<output>` tally.
- Pages 4 and 5 (spread 2, sketches and notes): an inline SVG compass rose driven by an `<input type="range">` scale slider, and a ruled `<textarea>` margin notebook with live word and character counts.
- Page 6 (colophon): plain credits, owner line from page 1, a reading-progress `<output>`, and a "Jump to cover" `<button>`.

Rendering uses one WebGL 2 context created via `new ElementGL(canvas, …)` from `/lib/element-gl.js` with two shader programs compiled on `stage.gl`: a flat book shader (hardcover boards, page-block edges, marbled endpapers, silk ribbon, spine-gutter ambient occlusion and cast leaf shadow) and a 28 by 18 cylindrical page-curl mesh shader that selects the front HTML texture on `gl_FrontFacing` and the horizontally mirrored back HTML texture (`1.0 - vUv.x`) on the curled underside. When WebGL 2 or `texElementSubImage2D()` isn't available, the page falls back to a 2D folded-slice spread drawn with 5-argument and 9-argument `drawElementImage()`. When HTML-in-canvas isn't available or `webglcontextlost` fires, the six pages move into plain HTML until `webglcontextrestored` recovers the context.

Credits: this experiment builds on `/view-source/` on this site for the single-corner HTML page-peel shader, classic page-curl UIs such as Apple Books and Turn.js, and the cylindrical page-curl geometry described by W. David MacDonald and Calin-Andrei Burloiu.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Do two live HTML textures upload to one `ElementGL` WebGL 2 context? | not verified | Check 1 uploads front and back `drawable` children through `stage.upload()` on an isolated fixture. |
| Does the 28 by 18 cylindrical mesh show front HTML at `t = 0` and back HTML at `t = 1`? | not verified | Check 2 renders `t = 0` and `t = 1` and probes one pixel on each side of the spine with `readPixels()`. |
| Does a mid-curl leaf draw both live front and back HTML in one pass (`t = 0.62`)? | not verified | Check 3 probes near the spine (front) and on the turned flap past the crest (back) in one draw call. |
| Does the back HTML page read left to right when turned onto the left spread? | not verified | Check 4 uses a green-left, amber-right back texture and verifies orientation at `t = 1`. |
| Do `updateElementGeometry()`, `inert` and `dataset.hitTick` route pointer hits to the open spread only? | not verified | Check 5 switches two overlapping drawable pages and checks `document.elementFromPoint()`. |
| Does the 2D folded-slice fallback draw both 5-argument and 9-argument `drawElementImage()`? | not verified | Check 6 draws a flat page and a slice, then copies to a plain `willReadFrequently: true` 2D canvas to inspect pixels. |
| Does `webglcontextlost` fall back to plain HTML and `webglcontextrestored` recover? | not verified | Check 7 dispatches synthetic cancelable `webglcontextlost` and `webglcontextrestored` events without calling `loseContext()`. |

## Things that bit

- Keeping hidden pages painted for the next curl: moving hidden pages' hit boxes far outside the canvas can let Chromium skip rasterising their pictures until they return. The script leaves hidden pages' `canvasTransform` inside the canvas while setting `inert = true` and `pointer-events: none` so clicks and Tab focus stay on the open spread.
- Spine pinning under diagonal corner drags: a naive tilted cylinder starts wrapping the bound spine edge once the roll line crosses `x = 0`. Pinning `s_c >= (pageH / 2) * |sin(alpha)|` and easing `alpha` back to zero as `t` approaches 1 keeps `u = 0` fixed along the spine for every turn angle.
- Backing store budget on HiDPI screens: `syncCanvasSize()` caps the backing store at 3.8 megapixels so wide screens and 2.625 scale Android phones stay under the 4 MP limit.

## Not verified

- C157: all seven live checks, `npm run check:jank -- /page-book/`, `node tools/draw-size/audit.mjs /page-book/`, and Playwright corner-drag and ribbon-drag interaction tests.
- A159 (Chrome 159 on Android, 412 px wide, scale 2.625): single-page portrait curl, touch corner drag, touch text selection, on-screen keyboard inside the Ex Libris `<input>` and margin `<textarea>`, frame rate during drag, and canvas memory stability.

## Open ideas

- Add a subtle translucent page-bleed option showing faint reverse-side ink through thin paper stock.
- Project pointer coordinates through the inverse cylinder mapping while a leaf is held mid-curl so controls on a partially curled page could respond before settling.

## For the index

- WebGL, 3D meshes: one `ElementGL` WebGL 2 context can drive a custom 28 by 18 cylindrical page-curl mesh sampling two live HTML textures via `gl_FrontFacing` (`/page-book/`, not verified).
- Hit testing: keeping hidden pages' `updateElementGeometry()` inside the canvas with `inert` and `pointer-events: none` avoids culling while restricting input to the open spread (`/page-book/`, not verified).
