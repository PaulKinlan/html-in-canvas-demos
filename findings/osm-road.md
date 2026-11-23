# Street-level HTML overlays painted onto a tilted OpenStreetMap grid (`/osm-road/`)

Status on 2026-11-22: static checks passed (`check:gfx`, `check:writing --strict`, JSON and module parse) and all 6 live checks passed in headless `Chrome/160.0.8177.0` with 0 console errors (including Billboard mode `131.4/131.4 px` and a DPR=2 click on the billboarded `Next step` button advancing to `Step 2 of 4`). Chrome on Android 159 is not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context rendering a zoom-16 OpenStreetMap tile plane, animated glowing route polyline and four road `drawable` HTML overlays | measured (Chrome/160.0.8177.0, 2026-11-22) | All 16 zoom-16 OSM tiles loaded with CORS (`OSM 16/16`) and composited cleanly with the glowing route ribbon, street pins and live `texElementSubImage2D()` cards on one `ElementGL` context. |
| Projective `updateElementGeometry()` hit testing with `geometryUnit()` and `dataset.hitTick` on foreshortened flat and billboarded road cards | measured (Chrome/160.0.8177.0, 2026-11-22) | Live check 2 hit `<button> "Next step"` on a foreshortened flat card (`hitTick=1`); DPR=2 click in Billboard mode hit `#next-step-btn` and stepped the route card to `Step 2 of 4`. |
| Switching between Painted on road, Upright sign and Billboard (faces camera) | measured (Chrome/160.0.8177.0, 2026-11-22) | Live check 3 verified Flat `133.9/158.7 px`, Upright `145.6/130.6 px` and Billboard `131.4/131.4 px` (zero pitch skew, square to the camera above each street pin). |
| Live button clicks, `<select>` bus line filter, `<input type="checkbox">` toll toggle and `<input type="text">` checkpoint note typing on a tilted road card | not verified | Pointer drag ignores events targeting `button`, `input`, `select`, `option`, `label` and `a`. Needs Chromium 157 and Android Chrome 159 runs to test native pickers and the on-screen keyboard over a foreshortened card. |
| Driving animation along the Central London route polyline with off-screen pause and `prefers-reduced-motion` support | not verified | Uses `IntersectionObserver` to pause `requestAnimationFrame` when the stage leaves the viewport, and steps cleanly between waypoints when `prefers-reduced-motion: reduce` is active. |
| 2D affine fallback with five-argument `drawElementImage()` and plain HTML fallback on context loss | not verified | Falls back to a rotated and tilt-scaled 2D road map with five-argument `drawElementImage()`, and moves the four cards into a plain HTML grid if HTML-in-canvas is disabled or the WebGL 2 context is lost. |
| Zoom-16 Central London Web Mercator projection and flat-vs-upright matrix foreshortening | measured (Node, 2026-11-22) | Verified in Node: Trafalgar Square maps to UV `(0.420, 0.304)`, Embankment to `(0.620, 0.589)` and Whitehall to `(0.484, 0.568)` inside the 4 by 4 zoom-16 atlas (`x = 32743..32746`, `y = 21791..21794`). At 56 degrees pitch (`400x300` viewport), a flat card foreshortens from `158.7 px` at its near edge to `133.9 px` at its far edge (`42.5 px` tall), while an upright sign projects `145.6 px` at its elevated top edge vs `130.6 px` at its base (`65.4 px` tall). Pitch `0°` top-down yields finite corners with no singularity. |

## Credits and prior work

- Street map tiles and geographic attribution come from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors).
- Road-painted street navigation overlays take inspiration from in-car AR navigation and painted road markings in Apple Maps, Google Maps Live View and Mapbox Navigation.
- Projective `updateElementGeometry()` hit testing and single-context `ElementGL` scene sharing build on `/three-form/` and `/relief-map/` on this site.

## Things that bit

- A standard `lookAt(eye, target, [0, 1, 0])` camera hits a gimbal singularity when the `Camera pitch` slider reaches 0 degrees (straight top-down), because the view direction becomes parallel to `[0, 1, 0]`. Computing `forward`, `right` and `up` analytically from road heading and pitch angle keeps the camera and projective hit matrices well-defined from 0 degrees top-down to 68 degrees driver's-eye view.
- Centring the 4 by 4 zoom-16 tile grid at `y = 21790` pushed Westminster Bridge and Parliament Square south of the atlas edge (`fy = 21794.32`). Shifting the origin to `x = 32743, y = 21791` kept the entire Trafalgar Square, Northumberland Avenue, Victoria Embankment and Whitehall loop inside the atlas with margin for high-pitch horizon views.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /osm-road/` and `?autochecks=1`): verifying WebGL 2 tile plane plus `texElementSubImage2D()` compositing, all six live checks, zero layout shift, and canvas memory limits.
- Chrome 159 on Android (412 px wide, scale 2.625): verifying touch panning, pinch zoom, tapping Next step on a foreshortened flat card, opening the native `<select>` transit filter at 68 degrees pitch, toggling Avoid tolls, and typing into the checkpoint `<input>` with the on-screen keyboard.
- Live CORS tile fetching from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` on a real network and verifying WebGL 2 mipmap upload and context loss recovery (`webglcontextlost` and `webglcontextrestored`).

## For the index

- WebGL and textures: a single `ElementGL` WebGL 2 context can composite a pitched zoom-16 OpenStreetMap tile atlas, an animated route ribbon and four asphalt-blended flat `texElementSubImage2D()` overlays with projective `updateElementGeometry()` hit boxes (not verified, `/osm-road/`).
