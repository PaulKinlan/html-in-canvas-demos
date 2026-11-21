# Sortable table (`/sort-table/`, `lib/stage-2d.js`)

Measured in C157 (headless shell, 412 px wide, touch emulation) on 2026-11-21. Not yet run on A159.

| Question | Result | Notes |
|---|---|---|
| `<tr drawable>` inside a `<table>` that is a canvas child | works | The row keeps `display: table-row` and the column widths of its table. The table has no `drawable` and no picture. `offsetTop` of a row is relative to the table. |
| Draw a row away from its layout position, rotated and scaled | works | Inputs in the row are hit at the drawn position (`elementFromPoint()` and real taps). |
| Move rows with `moveBefore()`, `insertBefore()` or `append()` and draw them in the same task | works | No `paint` event is needed between the move and the draw. `offsetTop` is already the new place. The picture is the one from before the move. |
| `:nth-child()` striping on moved rows | one frame late | The first draw after the move uses the old picture. The next `paint` has the new background. |
| `captureElementImage(row)` before the move, drawn after it | works | Used to fade from the old look of the row to the new one during the travel. |
| `shadowBlur` and `shadowOffsetY` on `drawElementImage(row)` | works | In an 8-bit 2D canvas. (`/hdr-glow/` records that this clamps in a float16 canvas.) |
| Draw one row four times in a frame (three trail copies with low alpha, then the row) | works | The hit region is that of the last draw. |
| A sort that starts while the rows are still travelling | works | The page remembers the y at which each row was last drawn and starts from there. |

## Things that bit

- `table.offsetTop` is measured from the page, not from the canvas, because the canvas is not an offset parent. The first version drew every row 577 px too low and the canvas was blank. The table is at the canvas origin, so the page uses 0 and the rows' own `offsetTop`.

## Not verified

- Frame rate of the travel on a phone. Opening `/sort-table/` on the phone and sorting would show it.
- Whether the on-screen keyboard stays open when a focused number field's row is moved with `moveBefore()`.
- Focus kept by `moveBefore()` and lost by `insertBefore()` was not measured here. `/patch/` measured it. The "Move with" menu on the page switches between the two.

## For the index

- Drawing elements: A `<tr drawable>` in a table that is a canvas child keeps table layout and can be drawn at any position on its own. measured, C157, `/sort-table/`.
- Drawing elements: An element moved in the DOM can be drawn in the same task, with its old picture. `captureElementImage()` taken before a change still draws after it. measured, C157, `/sort-table/`.

## Ideas built

- "Sortable table with rows that travel" from `public/elements/ideas.js` (data).

## Open ideas

- Column reorder by dragging a heading, with each cell drawn on its own (`td drawable`) so a column can travel sideways.
- Rows that leave and enter on filter, using the snapshot for the leaving row after it has been removed from the DOM.
