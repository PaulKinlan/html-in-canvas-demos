# Foldable paper OpenStreetMap pocket map (`/osm-fold/`)

Not verified in a live browser as of 2026-11-22. Built and checked statically (`npm run check:gfx` and `tools/writing/check.mjs --strict`), waiting for a run in C157 and on A159.

Credits and inspirations: map tiles from OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, copyright OpenStreetMap contributors), physical accordion and midline folding from Ordnance Survey and pocket tourist paper maps, and the sheared-strip 2D canvas folding pattern from `/origami-ticket/` and `/accordion/` on this site.

| Question | Result | Notes |
|---|---|---|
| Four vertical accordion panels folding a composited OpenStreetMap tile atlas and live HTML place pins together in lockstep | not verified | `drawFoldedMap()` applies one affine matrix (`cosX`, alternating `shearY`) per column to both `drawImage(atlasCanvas, ...)` and nine-argument `drawElementImage(el, ...)` slices. Check 1 tests ink compression on a plain `drawImage()` copy. |
| Horizontal midline crease folding the top half down over the bottom half with an Ordnance-Survey-style back cover | not verified | Below 50% vertical fold the top row foreshortens upward toward the midline hinge (`cosY`); past 50% it flips down over the bottom row and renders `drawPocketBackCover()`. Check 2 tests top-half foreshortening vs the anchored bottom half. |
| Unfolded five-argument `drawElementImage()` keeping exact hit boxes on pin buttons and the legend filter input | not verified | When `foldX <= 0.01` and `foldY <= 0.01`, `#pin-0` through `#pin-3` and `#map-legend` each draw once with unclipped five-argument `drawElementImage()`. Check 3 verifies `elementFromPoint()` on a fixture pin button and legend input. |
| Restoring a full hit box after nine-argument panel slicing with an empty-clip five-argument draw | not verified | `restoreHit()` runs when lightly folded (`foldX <= 0.55` and `foldY <= 0.5`), while `park()` moves controls out of hit testing when hidden behind the folded cover. Check 4 tests hit restoration on a sliced fixture. |
| `captureElementImage()` pin snapshot lifecycle (draw before `close()`, throw after `close()`) | not verified | Check 5 captures a pin fixture snapshot, confirms ink on a plain `drawImage()` copy, closes it in `try/finally`, and checks that a second draw throws. |
| Context loss and blank canvas resilience on `#map-canvas` | not verified | `mount()` from `/lib/stage-2d.js` falls back to plain HTML via `toPlain()` on `contextlost`, `onLost` retires the offscreen `atlasCanvas`, and Check 6 (`stillDrawn()`) verifies `#map-canvas` keeps drawn pixels after all fixture checks retire. |

## Things that bit

- **Keeping vertical creases joined across a horizontal midline hinge.** For the top half to lean forward or fold down without splitting apart between adjacent accordion columns, every column's `f` translation term has to anchor on the sheared midline (`hingeY + ridgeY - cosY * halfH` before 50%, `hingeY + ridgeY` after 50%) while keeping `c = 0` and sharing the same `cosX` and `shearY`. That keeps adjacent columns joined to the sub-pixel along all three vertical creases at every combination of `foldX` and `foldY`.
- **Panning vs folding on one canvas.** Starting a drag on a live `<button>`, `<input>`, or `<label>` exits `pointerdown` immediately so taps and typing reach the DOM controls. On an unfolded map, dragging inside the interior pans the OpenStreetMap tiles while dragging within the outer margin (34 px on narrow screens, 44 px on desktop) folds the paper; once any fold is active, dragging anywhere on the canvas adjusts both fold axes.
- **No `getImageData()` on drawable canvases.** Every pixel check copies the fixture canvas into a plain non-drawable 2D canvas with `willReadFrequently: true`, reads from the copy, calls `window.__gfx?.retire(copy)`, and zeroes `copy.width` and `copy.height`.

## Not verified

- Running the six live checks in C157 (headless Chromium) and confirming zero layout shift (`npm run check:jank -- /osm-fold/`) and zero draw-size mismatches (`node tools/draw-size/audit.mjs /osm-fold/`).
- Live network loading of `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with `crossOrigin = 'anonymous'` across London, Edinburgh, and Kyoto, plus tile server rate-limit behaviour and offline procedural fallback switchover.
- Real-device frame rate and touch ergonomics on A159 (Chrome 159 on Android, 412 px wide, device pixel ratio 2.625) while dragging the margins to fold, panning the unfolded map, and tapping compact pin buttons.
- Screen-reader navigation and keyboard focus order across `#pin-0` through `#pin-3` and `#map-legend` while flat vs parked under the pocket back cover. Open the page on an Android phone with TalkBack enabled and step through controls in both states to verify.

## For the index

- Maps: Two-axis paper pocket-map folding of real OpenStreetMap tiles (with procedural fallback) and five sibling `drawable` HTML place pins and legend card on one 2D canvas. not verified, `/osm-fold/`.
