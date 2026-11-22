# 3D relief map with live DOM pins and weather cards (`/relief-map/`)

Status on 2026-11-22: static checks passed (`check:gfx`, `check:writing --strict`, JSON and module parse, deterministic heightfield check in Node). Live browser verification in Chromium 157 and on Android Chrome 159 is not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context drawing a 3D procedural relief terrain mesh and live `drawable` HTML weather cards | not verified | Implemented by saving `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` after `stage.begin()`, drawing the 64 by 64 relief mesh, terrain-conformed ground shadows and pin stems on `stage.gl`, and restoring both bindings before `stage.quad()`. Needs a Chromium 157 run to verify on screen. |
| Back-to-front depth sorting and `zIndex` ordering for overlapping 3D weather cards | not verified | Cards sort by view-space depth each frame, and `style.zIndex` updates only when the depth order flips. Covered by an isolated live check on `testStage()`. |
| Projective `updateElementGeometry()` hit boxes with `dataset.hitTick` cache clearing in billboard and flat-on-map modes | not verified | Uses the element-to-canvas projective matrix pattern from `/three-form/`, scaled by `geometryUnit()`. Keeping camera pitch above 18 degrees keeps flat-on-map cards front-facing from all 360 degrees of yaw. |
| Live clicks, `<select>` unit changes and `<input>` typing inside projected 3D weather cards | not verified | Pointer orbit ignores events targeting interactive controls (`button`, `input`, `select`, `label`). Needs a live Chromium 157 and Android Chrome 159 run to confirm native pickers and keyboard entry. |
| 2D isometric relief fallback with five-argument `drawElementImage()` and plain HTML fallback | not verified | Falls back to a painter's-algorithm 2D relief canvas with five-argument `drawElementImage()` when WebGL 2 `texElementSubImage2D()` is absent, and moves the cards into a plain HTML grid if HTML-in-canvas is disabled or the WebGL context is lost. |
| Deterministic procedural heightfield and sun azimuth hillshading with no external tiles | measured (Node, 2026-11-22) | Evaluated the heightfield and gradient functions in Node: summit `0.8813`, ridge `0.4750`, cove `0.1479`, harbour `0.0198`. Opposing sun azimuths (`60°` vs `240°`) shift slope dot product from `0.6118` to `0.3768`. |

## Credits and prior work

- Terrain hillshading, hypsometric elevation bands and anti-aliased contour lines follow shader-driven relief map techniques used in Mapbox GL, Tangram terrain hillshading and Three.js procedural topography experiments.
- The projective `updateElementGeometry()` hit-test matrix builds on `/three-form/` on this site.

## Things that bit

- `ElementGL` keeps its quad shader `#program` and `#vao` as private fields, so drawing a custom terrain mesh on `stage.gl` replaces the active program and VAO before `stage.quad()` runs. Reading `gl.getParameter(gl.CURRENT_PROGRAM)` and `gl.getParameter(gl.VERTEX_ARRAY_BINDING)` once after `stage.begin()` (and clearing the cached handles on `webglcontextlost` and `webglcontextrestored`) lets one context draw both the 3D scene and the DOM textures with no edits to `public/lib/element-gl.js`.
- Initial coordinates for West Harbour (`-1.36, 0.62`) fell inside the carved coastal bay (`-0.2249`), placing the harbour pin offshore in water. Moving the pin to `-1.26, 0.36` placed it on the shoreline at `0.0198` above sea level.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /relief-map/` and `?autochecks=1`): verifying WebGL 2 terrain plus `texElementSubImage2D()` compositing, all six live checks, zero layout shift, and open snapshot and memory limits.
- Chrome 159 on Android (412 px wide, scale 2.625): verifying touch orbit, two-finger pinch zoom, tapping buttons, opening a `<select>` picker on a projected 3D card, and typing into a field note `<input>` with the on-screen keyboard.
- Context loss and recovery (`webglcontextlost` and `webglcontextrestored`) on a phone, confirming the plain HTML fallback appears and the terrain shaders rebuild cleanly when the context returns.

## For the index

- WebGL and textures: one `ElementGL` context can draw a custom 3D WebGL 2 scene alongside `texElementSubImage2D()` quads by saving and restoring `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` around the custom pass (not verified, `/relief-map/`).
