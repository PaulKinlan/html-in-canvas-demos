# Heat map over table cells (`/heat-map/`)

Measured in C157 (headless shell, 412 px wide) on 2026-11-21. Not yet run on A159.

| Question | Result | Notes |
|---|---|---|
| `<td drawable>` cells laid out by their table | works | `display: table-cell`. With `table-layout: fixed` the cells are a regular grid. `offsetLeft` and `offsetTop` are relative to the table. |
| A cell with no background | text on transparent pixels | A red fill under the cell reads back as 255, 0, 0 at the cell's corner after `drawElementImage()`. The canvas can paint any background under real cells. |
| Editing a cell (`contenteditable="plaintext-only"`), or setting `textContent` | raises a `paint` event | No `requestPaint()`. The caret and the focus outline are in the cell's picture. |
| A cell drawn at 1.3 times its size about its centre | hit at the larger box | 62 px from the centre hits a cell whose unscaled half width is 50 px. |
| Smooth gradient between neighbouring cells | `drawImage()` of a 48 by 42 bitmap | Six samples per cell each way, Catmull-Rom interpolation of the cell numbers, stretched over the cell area with smoothing. The curve passes through each cell's number at its centre (error 0 in the check). |
| Contour lines | marching squares on the same samples | One `Path2D` per frame, stroked under the cells. |
| 63 `drawElementImage()` calls per frame (56 cells, 7 row heads) plus 9 column heads | holds still in `check:jank` | Longest task 388 ms at 4x CPU slowdown during load and checks. |

## Things that bit

- Text needs contrast on a field that goes from near black to near white. The page switches a class on each cell from the brightness of its colour when the numbers change. Doing it inside the `paint` handler would change the cell's picture during the paint.

## Not verified

- The numeric on-screen keyboard for `inputmode="numeric"` on a cell drawn in a canvas, and whether the page stays put when it opens.
- Frame rate with "Live data" on a phone.

## For the index

- Drawing elements: A `<td drawable>` with no background is drawn as text on transparent pixels, so a canvas can paint a computed background under the cells of a real, editable table. measured, C157, `/heat-map/`.

## Ideas built

- "Heat map over table cells" from `public/elements/ideas.js` (data).

## Open ideas

- The same field on WebGL through `lib/element-gl.js`, with the cells as textures and the colour computed in the fragment shader, for tables of thousands of cells.
- A legend made of a real `<meter>` or `<input type="range">` whose thumbs set the contour levels.
