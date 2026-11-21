# Inline text elements: sub, bdo, abbr, q, var and br (`/text-marks/`)

Backlog group 28 in PLAN.md, ideas 28.5 to 28.10. Measured in headless Chromium 157 (C157) on 2026-11-21 at 412 px wide. The page's five live checks pass there, and `node tools/text-marks/check.mjs` drives the six demos by touch (20 steps, all pass). Nothing here has been run on a phone.

The question: inline elements are not drawable by themselves. How much can a canvas do with sub, sup, bdo, abbr, q, var and br from their rectangles alone?

| Experiment | Result | Why |
|---|---|---|
| `offsetWidth` and client rectangles of inline elements in a drawable block | sub 7 px, 1 rectangle (7 by 15); sup the same; abbr 22 px, 1; var 7 px, 1 | They have boxes, so a clipped draw of the block can stand in for a picture of the element. |
| `q` | 3 rectangles for one line (7 by 17, 8 by 17, 7 by 17), 5 when it wraps once | The opening and closing marks the browser adds have rectangles of their own. |
| `br` | 0 px wide, 1 rectangle (0 by 17) | A place, not a box. |
| `wbr` | 0 px wide, 0 rectangles | |
| The block drawn at (60, 30) instead of (0, 0) | client rectangle of a `var` moved by 60 and 30 px; `offsetLeft` 35 and `offsetTop` 3 in both | Client rectangles follow the draw. Offset numbers are layout. |
| A block drawn as two pieces, the lower one 42 px down (`/text-marks/` gloss demo, tool script) | every client rectangle in the block is 42 px down, including those above the cut | The rectangles follow the last `drawElementImage()` call for the element. The demo does its own hit test from offset boxes. |
| Twelve `sub` and `sup` pieces drawn on their way to holes in the block | all 12 in place after 3.5 s, no frames afterwards, the link in the block still answers | Subscripts that settle (28.5). |
| One `Range` per character in `bdo dir="rtl"`, a Hebrew `bdi` and a plain span | bdo: last of six letters 35.5 px left of the first; span: 37.3 px right. Demo: 13 left to right, 9 and 20 right to left | Bidirectional text explained (28.6). |
| A block with and without `title` on its `abbr` | 220 by 24 px both times | The tooltip is not in the picture. Abbreviations expanded in place (28.7) draws the title from a real element in a gap. |
| Marks, bands and a wave drawn from the rectangles of `q` and `cite`, under the text | 8 rectangles for the demo's two `q` elements | Quotation marks as ornaments (28.8). |
| A `click` on a `var` in a block drawn flat | every `var` of that name outlined: 5 for `sum`, 4 for `n` | Variables that light up together (28.9). Ordinary events, because a flat draw has a hit region that fits. |
| A `Range` over each text node between two `br` elements | line tops 24 px apart for a 24 px line height; 6 strips from 5 `br` in the demo | Line breaks as cut lines (28.10). The strips are squashed, sheared and shaded with `source-atop`. |
| A lost context | plain HTML | One `contextlost` event stops the six canvases and shows the text as plain HTML (6 boxes). Tested by dispatching the event. |

## Things that bit

- The first version of the fold demo printed "A br has 1 client rectangles". The page's text had said a `br` has none. It has one, 0 px wide.
- The large quotation marks were first placed with `textAlign` right and left of the `q` rectangles and covered the words before and after. They are now centred on the first and last rectangle, which are the browser's own marks.
- The tool script taps an element at its client rectangle. For an abbreviation above the cut that rectangle is 42 px too low while the gloss is open, so the script subtracts the gap for that one tap.
- Client rectangles are only right after a paint, so the demos that use them draw their first frames twice.

## Not verified

- Chrome 159 on Android: the six demos by touch.
- Whether Android shows the `title` tooltip on a long press over a drawn `abbr`.
- Text selection by touch across the ornaments and the outlines.
- Arabic, and a run that mixes directions inside one `Range`. The page has one Hebrew run and one forced run.
- A subscript whose box overlaps another glyph. The clip would take a part of that glyph with it.

## For the index

- Geometry: client rectangles of content inside a drawable element follow the last `drawElementImage()` call for it, and `offsetLeft` and `offsetTop` do not. A block drawn in several pieces reports rectangles for the last piece. C157, `/text-marks/`.
- Elements: `br` has one client rectangle 0 px wide, `wbr` has none, and `q` has a rectangle for each of its two generated marks as well as one per line.
- Elements: the `title` tooltip of an `abbr` is not in the picture.
- Backlog: ideas 28.5 to 28.10 are built on `/text-marks/`.
