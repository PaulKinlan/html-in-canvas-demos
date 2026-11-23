# Tilted OpenStreetMap with zero-drift HTML markers and PNG export (`/osm-markers/`)

Status on 2026-11-22: static checks (`check:gfx`, `check:writing --strict`, `page.json` parse, inline module syntax and `#region` pairs) are run below. Live browser verification in headless Chromium 157 and on Chrome 159 for Android is not verified yet.

| Question | Result | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context drawing a tilted OpenStreetMap tile atlas, 3D landmark buildings and four `drawable` HTML place cards with zero pan/zoom drift | not verified | Ground plane, extruded buildings, pin stems and `ElementGL` card quads share one Web Mercator view-projection matrix on `stage.gl`, saving and restoring `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` around the custom passes. Needs a Chromium 157 run to confirm on screen. |
| Pixel-accurate 3D building depth occlusion vs always-on-top HTML place cards | not verified | Buildings write to the WebGL 2 depth buffer; keeping `DEPTH_TEST` enabled (`LEQUAL`, `depthMask(false)`) during the back-to-front `stage.quad()` pass clips card fragments behind closer towers, while unchecking the toggle disables depth testing for cards and stems. Covered by an isolated `testStage()` live check. |
| Projective `updateElementGeometry()` + `geometryUnit()` hit boxes with `data-hit-tick` cache clearing | not verified | Uses the element-to-canvas projective matrix scaled by `geometryUnit()`, gated on matrix change, plus `data-hit-tick` toggling. Needs Chromium 157 and Android Chrome 159 runs at scale 2.625 to confirm tap accuracy on tilted cards. |
| Keyboard `Tab` navigation across live buttons, `<select>` tags and visit-note `<input>` fields inside `<canvas layoutsubtree>` | not verified | A `focusin` handler on the stage highlights the focused card and stem and pans the map centre to that landmark without scrolling the window. Covered by a fixture focus-order check; real `Tab` traversal needs a live browser run. |
| Tap-triggered PNG export combining CORS OpenStreetMap tiles, 3D buildings and live HTML place cards | not verified | Loads `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with `crossOrigin = 'anonymous'` onto a plain 1,280 by 1,280 offscreen 2D tile atlas (with a procedural street-and-river fallback while loading or offline). On click, draws a fresh frame, copies the canvas to a plain 2D canvas with `drawImage()`, stamps attribution, calls `toDataURL('image/png')` and retires the copy canvas. |
| 2D five-argument `drawElementImage()` fallback and plain HTML fallback on context loss | not verified | Falls back to a projected 2D tile canvas with five-argument `drawElementImage()` when WebGL 2 `texElementSubImage2D()` is absent, and moves the four place cards into a plain HTML grid below the map if HTML-in-canvas is disabled or the WebGL context is lost. |

## Credits and prior work

- Map tiles and required visible attribution (`© OpenStreetMap contributors`, `https://www.openstreetmap.org/copyright`) come from OpenStreetMap.
- The marker trade-off is framed against Leaflet (`L.divIcon`) and MapLibre GL (`maplibregl.Marker`), where DOM overlays keep HTML controls and keyboard Tab order at the cost of pan/zoom drift, missing 3D occlusion and blank `toDataURL()` exports, while WebGL symbol layers give up live inputs and focus traversal.
- The single-context `ElementGL` save/restore pattern and projective `updateElementGeometry()` hit-test matrix build on `/relief-map/` and `/three-form/` on this site.

## Things that bit

- At `pitch = 0°` (flat top-down map), building a camera with `lookAt(eye, target, [0, 1, 0])` hits gimbal lock because the view vector is parallel to world up. Computing `right` and `northDir` directly from `bearing` on the horizontal plane and tilting `eyeDir` by `pitch` avoids gimbal lock across the full `0°` to `62°` range.
- Loading 25 OpenStreetMap tiles asynchronously on first view can trigger 25 separate repaints if each `onload` calls `requestPaint()` straight away. Batching tile `onload` callbacks with a 65 ms coalescing timer keeps atlas rebuilds and canvas paints quiet while tiles stream in.
- Every WebGL 2 vertex and fragment shader declares both `precision highp float;` and `precision highp int;` so uniform and integer precision match across GPU drivers.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /osm-markers/` and `?autochecks=1`): verifying WebGL 2 compositing of the tile atlas, extruded buildings and `texElementSubImage2D()` cards, all six live checks, zero layout shift, and memory and snapshot limits.
- Live CORS tile fetch from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` and untainted PNG export (`toDataURL('image/png')`) containing real OSM tiles, 3D buildings and live HTML place cards in one image.
- Chrome 159 on Android (412 px wide, scale 2.625): verifying single-finger ground-locked pan, two-finger pinch zoom and bearing twist, tapping card buttons, opening a `<select>` tag picker, typing visit notes with the on-screen keyboard, and context loss recovery (`webglcontextlost` and `webglcontextrestored`).
- Real keyboard `Tab` and `Shift+Tab` traversal through all four `drawable` place cards with a screen reader and visible focus rings.

## For the index

- WebGL and depth occlusion: keeping `DEPTH_TEST` enabled (`LEQUAL`, `depthMask(false)`) during `ElementGL.quad()` clips `texElementSubImage2D()` HTML cards pixel-by-pixel behind 3D WebGL 2 building prisms while preserving premultiplied alpha blending between cards (not verified, `/osm-markers/`).
- Export and readback: compositing `crossOrigin = 'anonymous'` raster map tiles and `drawable` HTML cards onto one WebGL 2 canvas and copying on tap to a plain 2D canvas exports both map imagery and DOM overlays in one PNG without tainting (not verified, `/osm-markers/`).
