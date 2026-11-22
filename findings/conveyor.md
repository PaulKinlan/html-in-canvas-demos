# Conveyor belt list (`/conveyor/`)

Asked for by the project owner on 2026-11-22: a virtualised endless list as a conveyor belt, where rows appear from the underside round the bottom roller and disappear over the top roller. Measured in headless Chromium 157 (C157) on 2026-11-22 at 412 px wide. The page's four live checks pass there, and `node tools/conveyor/check.mjs` drives the belt by touch (22 steps, all pass). Nothing here has been run on a phone.

The question: can an endless list be drawn as a conveyor belt from a fixed number of real elements that still take taps while they move?

How it is built: ten `drawable` row elements. Row i is shown by element i mod 10, refilled when its old row is past the crest of a roller. An element is drawn with `drawElementImage()` only when its picture changed, copied to a slot of a plain 2D canvas (the atlas) with `drawImage()`, and wiped. Each frame is cut from the atlas: one piece per row on the flat face, pieces 3 px of belt long round a roller, each shorter by the sine of its angle, narrower by its depth and darker. `updateElementGeometry()` gives each row its hit box.

| Experiment | Result | Why |
|---|---|---|
| Children of the canvas at row 1,000,000 and at row -5 | 10 and 10 | The list is computed from the row number and has no end in either direction. |
| A touch tap on the checkbox of row 4, on Open of row 5, on the checkbox of row 1,000,002 | each reached its element | The hit box is set with `updateElementGeometry()`; no element is drawn at the place it appears. |
| Row 4's tick after its element showed other rows | kept | State is stored by row number and written into the element by `fill()`. |
| A touch drag of 190 px, held before release | the belt moved 170 to 200 px; 53 frames, 6 element pictures copied | Only rows that came onto the belt were drawn as elements. |
| A flick of 220 px in 80 ms | about 740 px of travel in all (733 and 744 in two runs), about 166 frames, 18 pictures copied; the belt stopped by itself | |
| A drag that starts on a checkbox | moves the belt, does not tick the box | The click after a drag of more than 6 px is dropped in a capturing listener. |
| A tap on a checkbox of a row moving at 160 px a second | ticked | |
| The element 26 px down the canvas, on the top roller | the canvas | A row with less than 45% of its height showing is parked. |
| ArrowDown with a button of a row focused | the belt moved to the next row boundary | |
| `updateElementGeometry()` for an element drawn at 0, 0 and wiped (fixture) | found at the new place (160, 110), canvas pixel there 0, 0, 0, 0; not found at the old place | Live check. |
| `drawImage()` of the drawable canvas into a plain canvas inside the paint handler, then a wipe | copy 0, 160, 0, 255; drawable canvas 0, 0, 0, 0 | Live check. |
| A paint event after a text change of an element the last paint left nothing of | 1 event naming 1 element | Live check. This is how the belt knows which slot to copy again. |
| A lost context | plain HTML | One `contextlost` event shows the ten rows as plain HTML. Tested by dispatching the event. |

## Things that bit

- Going to row 1,000,000 by easing the whole distance refilled all ten elements on every frame (about 1,200 element draws for one jump). The belt now starts twelve rows short of the target and runs the rest.
- A slow test drag still ended as a flick, because the last move was under 80 ms before the release. A real finger that stops before lifting does not flick.
- The lazy loader imports a module named after the section id. The section was first called `belt`, which loaded `belt.js` (no default export) and started nothing.
- Row numbers of seven digits were cut off in a 54 px column. The column is 72 px with a 12 px font.

## Not verified

- Chrome 159 on Android: drag, flick and taps with a real finger, and the frame rate. The canvas has `touch-action: none`, so a drag that starts on the belt does not scroll the page.
- The cost on a phone of about 60 `drawImage()` slices a frame while the belt moves.
- A screen reader: the canvas has `role="feed"` and rows have `aria-posinset`, but the rows are reused and their order in the document is not their order on the belt.
- Whether a focused control should stay focused when its row leaves the belt. It is blurred when its element is refilled.

## For the index

- Hit testing: `updateElementGeometry()` places the hit box of an element that the canvas shows only as a `drawImage()` copy. C157, `/conveyor/`.
- Paint: `changedElements` names an element whose content changed even if the last paint wiped it from the canvas.
- Pattern: draw an element once per change, copy it to a plain canvas, and draw frames from the copy. A drag of 190 px cost 6 element draws.

## Open ideas

- The same belt in WebGL through `ElementGL`, with a true cylinder and lighting, behind this 2D route.
- A horizontal belt, and a belt whose rows are of different heights.
- A sensor line on the belt that reads each row as it passes.
