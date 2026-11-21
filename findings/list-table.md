# Lists and tables, second batch (`/list-table/`)

Measured in C157 (headless shell, 412 px wide, mouse, keyboard and emulated touch) on 2026-11-21. Not yet run on A159. The page's 16 live checks and `node tools/list-table/check.mjs` (27 steps with real taps, touch drags and a wheel) produced the results below.

Backlog group 16 of PLAN.md: column highlight from `col`, glossary cards from a `dl`, staggered list entrance, sticky header that casts a shadow, timeline from an ordered list. One page with five canvases.

| Question | Result | Notes |
|---|---|---|
| Does a `<col>` have a box inside a canvas? | works | `offsetLeft` (measured from the table), `offsetWidth` and `getBoundingClientRect()` give the column. The page places the light from them. |
| `drawElementImage(col)`, with `drawable` on the `<col>` | fails | Throws `InvalidStateError: No cached paint record for element`. A `<col>` paints nothing of its own. |
| A background on a `<col>` | works | It is in the picture of the table, and changing it raises a `paint` event. |
| `<dt drawable>` and `<dd drawable>` in one grid cell of a `<div>` in a `<dl>` | works | Each has a full picture of the cell's size. The one drawn last takes the taps. A link in the `<dd>` is followed at the drawn place. |
| A card turned in depth in a 2D canvas | works, in strips | 24 clipped draws of the element for each frame, each with its own horizontal squeeze and vertical scale. The hit box is that of the last strip, so the page ends a turn with one flat draw. |
| Is an `outside` list marker in the picture of its `<li drawable>`? | no | The picture ends at the border box. 0% ink left of the box. |
| `margin-left: -40px; padding-left: 40px` on the `<li>` to cover the marker | fails | The marker is placed outside the border box, wherever that is. |
| `list-style-position: inside` | works | The marker is in the picture, with `::marker` colour and weight. |
| A source-rectangle draw of one row of a drawable `<ol>` | works | `drawElementImage(ol, 0, li.offsetTop, ol.offsetWidth, li.offsetHeight, x, y, w, h)` gives the row with its outside marker. |
| Hit box after a source-rectangle draw | moves | The hit box of the whole element moves as if the whole element were drawn at the destination. A full draw with `globalAlpha = 0` afterwards puts it back. Confirms the note from `/captions/`. |
| Move `drawable` from the items to the `<ol>` at run time | works | The `<ol>` has a picture on the next `paint` event. |
| `ol.reversed = true` | works | The markers in the pictures of the items change, and a `paint` event is raised. |
| `position: absolute` on an `<li>` | works | It keeps its marker and its number. |
| An `<li>` drawn rotated, with a checkbox | works | `getBoundingClientRect()` of the checkbox returns the bounding box of the rotated drawing (25 px for a 20 px box at 0.3 rad), and `elementFromPoint()` there returns the checkbox. |
| A `drawable` scroll container (`overflow-y: auto`) inside a canvas | scrolls natively | A touch swipe of 220 px scrolled it by 205 px and the page by 0. A wheel event scrolled it. 12 `paint` events arrived during the swipe. `position: sticky` header cells stay at the top of its picture. |
| A scroll container that is not `drawable`, with drawable `thead` and `tbody` | does not scroll | Probe script, not on the page: the same swipe and wheel scrolled the page and left `scrollTop` at 0. Agrees with `/minimap/`. |
| `shadowBlur` and `shadowOffsetY` on a source-rectangle draw | works | The shadow has the shape of the destination rectangle. Used for the header band. |
| `<thead drawable>` nested in the drawable scroller | works on screen | Has a picture after scrolling while the canvas is fully inside the window. `/minimap/` found that a nested drawable element is cut to the window when it repaints, so the page defaults to the source rectangle. The menu "Header picture" switches between the two. |
| A tap on a checkbox in a scrolled row | works | The row is hit at its scrolled place (tested with the source-rectangle header). |
| Sideways touch drag on a canvas with `touch-action: pan-y` (column light, timeline) | works | The drag reaches `pointermove`. A vertical swipe on the same canvas scrolled the page by 135 px. |

## Things that bit

- `overflow: hidden` on an `<li>` removes its outside marker from the picture of the `<ol>` too. The first version of the "slices" route drew rows with no numbers for this reason.
- `'drawable'` on a direct child of the canvas makes it shrink-to-fit at the canvas origin (an older finding). Each table here sits in a plain `<div>` with `position: relative`, so `width: 100%` and `offsetLeft` work as on a page.
- An item with an `IntersectionObserver` entrance must not be drawn before the entrance starts, or it is seen at rest and then enters.

## Not verified

- Everything on a phone (A159). Opening `/list-table/` and using each canvas would show it.
- Momentum of the native scroll inside the canvas, and whether the page scroll takes over at the ends of the table.
- Frame rate of the card turn with "Turn all": 6 cards times 24 draws for each frame.
- A horizontal touch drag on the timeline when the finger also moves vertically.
- Screen reader output for the `<dl>` cards and for the list whose items are drawn away from their layout place.
- Dark colour scheme was not screenshotted. The colours come from the shared custom properties.

## For the index

- Drawing elements: A `<col>` has a box (`offsetLeft`, `offsetWidth`, `getBoundingClientRect()`) and no picture; `drawElementImage(col)` throws. measured, C157, `/list-table/`.
- Drawing elements: An `outside` list marker is not in the picture of its `<li>`; an `inside` marker is; the picture of the `<ol>` has both, and a source-rectangle draw gives one row with its marker. measured, C157, `/list-table/`.
- Input and hit testing: A `drawable` scroll container scrolls natively inside a canvas by touch and wheel and raises `paint` on every scroll step. measured, C157, `/list-table/`.
- Input and hit testing: A source-rectangle `drawElementImage()` moves the hit box of the whole element; a full draw at zero alpha restores it. measured, C157, `/list-table/` (also `/captions/`).
- Drawing elements: A canvas shadow applies to a source-rectangle draw. measured, C157, `/list-table/`.

## Ideas built

From `public/elements/ideas.js` (data): "Column highlight from col", "Glossary cards from a dl", "Staggered list entrance", "Sticky header that casts a shadow", "Timeline from an ordered list". PLAN.md backlog items 16.1 to 16.5.

## Open ideas

- A row light as well as a column light, from the box of the `<tr>`, crossing at the pointer.
- The glossary in WebGL through `ElementGL`, where a turn is one textured quad and not 24 draws.
- A sticky first column with a shadow to the right, using a vertical source rectangle of a scroller that scrolls both ways.
- Markers as the only drawn part: a source rectangle of the `<ol>` that covers the marker column, drawn as a separate layer that moves at a different speed from the items.
