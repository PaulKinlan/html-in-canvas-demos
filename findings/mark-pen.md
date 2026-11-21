# Marker-pen highlight on mark (`/mark-pen/`, `lib/text-canvas.js`)

Measured in Chromium 157 (headless shell), 2026-11-21, at 412 px wide with a device scale factor of 2 and at 1100 px wide. Not yet run on the test phone (Chrome 159 for Android).

Idea built: "Marker-pen highlight" from `public/elements/ideas.js` (rank 1, text).

| Question | Result | Notes |
|---|---|---|
| Does `mark.getClientRects()` give line boxes for a mark inside a drawn element? | measured: yes, one rect per line | A mark over three lines of a 150 px paragraph returned 3 rects on 3 lines. |
| Where are those rects reported? | measured: at the place and scale of the element's last `drawElementImage()` call | Drawn at twice its size, a rect 80.9 px wide became 161.8 px. `lineBoxes()` in `lib/text-canvas.js` measures against the element's own `getBoundingClientRect()` and divides by `rect.width / offsetWidth`, which gives layout positions again (40.7, 80.9 before and after). |
| Does a mark with `background: none` paint anything of its own? | measured: no | 0 yellow pixels in the mark's box when the element is drawn alone. Ink drawn first and the element second gives ink under the glyphs. |
| Do edits fire `paint` without `requestPaint()`? | measured: yes | 1 paint event after changing a text node before the mark, 1 after wrapping a range in a new `<mark>`. The mark's box moved from x 40.7 to 81.6. |
| Does a `Range` give the same boxes as a `<mark>` around the same text? | measured: yes | 3 boxes each, same places. Strokes could be drawn for ranges with no change to the document. |
| Does a point on a drawn mark hit test to the mark? | measured: yes | `elementFromPoint()` in the middle of the first box, with the paragraph drawn at 30, 20. |
| Cost of a paint with 7 marks and 22 strokes | measured: 0.3 ms | Software rendering. The page requests frames only while a stroke is being drawn in. |

## Things that bit

- An inline rect is as tall as the font's content area, not the line height, so the highlighter band is placed inside the rect and not scaled to the line.
- `Range.surroundContents()` throws when the selection cuts through an element (for example half of an existing mark). The page then moves the contents with `extractContents()` and `insertNode()`, and unwraps marks that ended up inside the new one.
- On a phone a tap on a button can clear the selection before `click` runs. The page keeps the last non-empty range from `selectionchange`.
- Strokes come from a random generator seeded per mark, so a stroke keeps its shape across frames and edits.

## Not verified

- Chrome 159 for Android: long-press selection inside the drawn article, the selection handles, and Highlight selection after a tap on the button. To verify: select two words, press the button.
- Editing with the on-screen keyboard (the "Edit the text" switch). To verify: switch it on, type before a mark and watch the stroke move.
- Whether the selection menu of Android covers the canvas controls. Not measurable in the test browser.

## Open ideas

- Draw strokes for `::highlight()` ranges and for find-in-page matches, with no `<mark>` in the document.
- Pressure and tilt from a stylus (`pointerrawupdate`) to draw the mark by hand and then snap it to the line boxes.
- An eraser: drag over a mark to remove the element as the stroke is rubbed out.

## For the index

- What is in an element's picture: a `<mark>` with `background: none` paints nothing of its own, so a canvas can draw its own ink under the glyphs (measured, C157, `/mark-pen/`).
- Hit testing and updateElementGeometry(): `getClientRects()` of a descendant is reported at the position and scale of the element's last draw. Measure against the element's own rect and divide by the scale to get layout positions (measured, C157, `/mark-pen/`).
- The canvas, the attributes and the paint event: wrapping a range in a new element and typing in a `contenteditable` drawn element fire `paint` (measured, C157, `/mark-pen/`).
- Ideas built from `public/elements/ideas.js`: "Marker-pen highlight" is `/mark-pen/`.
