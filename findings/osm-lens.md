# Multi-layer X-ray lens over OpenStreetMap (`/osm-lens/`)

Status on 2026-11-22: static checks passed (`check:gfx`, `check:writing --strict`, JSON and module parse, `#region` listing pairs). Live browser verification in Chromium 157 and on Android Chrome 159 is not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context compositing live OpenStreetMap daytime tiles with CARTO DarkMatter night tiles inside a draggable circular bevel lens | not verified | Daytime OSM tiles (`tile.openstreetmap.org`) and dark CARTO tiles (`a.basemaps.cartocdn.com/dark_all`) paint into two plain offscreen 2D canvases and upload to `uDayTex` and `uNightTex` only when tiles arrive or the map pans or zooms. A deterministic procedural street grid fills slots while loading or offline. Needs a Chromium 157 run to verify live CORS tile uploads and GPU compositing. |
| Curved glass bevel refraction, thermal density ramp and Sobel blueprint edge shader inside the lens | not verified | `MAP_FS` applies radial bevel refraction and slight rim dispersion inside `uLensRadius`, with three modes (Night + Transit, Thermal, Blueprint). Covered by three isolated pixel-readback live checks on `testStage()`. |
| Live `drawable` HTML neighbourhood cards revealed only inside the circular lens aperture | not verified | `CARD_FRAGMENT` discards fragments outside `uLensRadius - 1.5` in canvas CSS coordinates so cards appear cleanly behind the brass bezel. Covered by an isolated live check comparing alpha inside vs outside the circle. |
| `updateElementGeometry()` + `canvasClip` + `inert` gating clicks to revealed cards inside the lens | not verified | Cards outside the lens set `inert = true` and a zero-size `canvasClip`. Cards inside compute the chord-clamped visible overlap rectangle in element coordinates, scale `canvasTransform` with `geometryUnit()` and toggle `dataset.hitTick`. Covered by an isolated `elementFromPoint()` live check. |
| Touch ergonomics (`Pin lens` toggle, live checkbox, Save button and editable tag input on 412 px screen) | not verified | Pointer down ignores interactive targets (`button`, `input`, `label`, `select`, `a`), and `Pin lens` locks the ring so thumb taps inside the circle never drag the lens away. Needs a phone run on Chrome 159 for Android. |
| 2D clipped-circle fallback with five-argument `drawElementImage()` and plain HTML fallback on context loss | not verified | Falls back to 2D `ctx.arc()` + `ctx.clip()` with five-argument `drawElementImage()`, and moves the four cards into `#fallback-grid` with `inert = false` when HTML-in-canvas is absent or `webglcontextlost` fires. Covered by a 2D fallback live check. |

## Credits and prior work

- Map data and daytime tiles are &copy; OpenStreetMap contributors (`https://www.openstreetmap.org/copyright`).
- Dark basemap tiles are &copy; CARTO (`https://carto.com/attributions`).
<!-- writing-allow: vocabulary -->
- The multi-layer movable filter lens builds on Eric A. Bier, Maureen C. Stone, Ken Pier, William Buxton and Tony D. DeRose, *Toolglass and Magic Lenses: The See-Through Interface* (Xerox PARC, SIGGRAPH 1993).
- Live DOM lens distortion and hit-test geometry build on `/lens/` and `/translate-lens/` on this site, and the `canvasClip` rectangle findings come from `/toolkit-occlusion/`.

## Things that bit

- Chromium's `canvasClip` option in `updateElementGeometry()` accepts a single axis-aligned `DOMRect` in element-local coordinates rather than a circular path (documented in `findings/toolkit-occlusion.md`). For a card straddling the circular brass bezel, clamping the visible bounding box against the circle's horizontal and vertical chords keeps the hit rectangle tight to the visible card area, though small corner slivers outside the arc can still fall inside the enclosing rectangle until `canvasClip` supports a path.
- Omitting `canvasClip` leaves the earlier clip active in Chromium, so every `updateElementGeometry()` call on `/osm-lens/` passes an explicit `DOMRect` (zero-size for off-lens cards, computed visible overlap for on-lens cards).
- Calling `stage.begin()` inside `ElementGL` binds its own quad shader and VAO, which are private fields. Caching `CURRENT_PROGRAM` and `VERTEX_ARRAY_BINDING` once after `stage.begin()` (and clearing both on `webglcontextlost` and `webglcontextrestored`) lets the custom dual-layer map pass share `stage.gl` without opening a second WebGL context.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /osm-lens/` and `?autochecks=1`): verifying WebGL 2 dual-texture compositing, all six live checks on `testStage()`, zero layout shift, memory ceiling and retired fixture canvases.
- Live network tile loading from `tile.openstreetmap.org` and `a.basemaps.cartocdn.com` with `crossOrigin = 'anonymous'`, checking CORS headers and crispness across zoom levels `z12` to `z16` in London, Paris and New York.
- Chrome 159 on Android (412 px wide, scale 2.625): touch dragging the lens vs panning outside the ring, pinning the lens, toggling the Transit checkbox, tapping Save district and typing into the District tag input with the on-screen keyboard.
- Context loss and restore (`webglcontextlost` and `webglcontextrestored`), confirming cards move to plain HTML with `inert = false` and return to WebGL 2 cleanly.

## For the index

- `updateElementGeometry()`: circular shader apertures can pair fragment-level circle clipping with chord-clamped `canvasClip` rectangles and `inert = true` on off-lens elements so hidden `drawable` cards never capture taps or focus (not verified, `/osm-lens/`).
