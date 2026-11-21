# Tables and blocks: caption, tfoot, time, data, address and marquee (`/table-data/`)

Backlog group 28 in PLAN.md, ideas 28.12, 28.13, 28.14, 28.16 and 28.20. Measured in headless Chromium 157 (C157) on 2026-11-21 at 412 px wide. The page's five live checks pass there, and `node tools/table-data/check.mjs` drives the five demos by touch (29 steps, all pass). Nothing here has been run on a phone.

The question: a caption, a tfoot, a time and a data element are not drawable by themselves, and a marquee moves on its own. Can a canvas restyle each from the picture of its parent, and keep a moving marquee's links working?

| Experiment | Result | Why |
|---|---|---|
| Boxes of `caption` and `tfoot` in a drawable table with `position: relative` | caption 0, 0, 200 by 24 px; tfoot 0, 76, 200 by 26 px | Offset boxes measured from the table's corner. A draw of the table clipped to one of them moves that part alone. |
| The same table with `caption-side: bottom` | caption at 0, 78, tfoot at 52 | The caption's box is under the footer. |
| Width of a caption against its words | caption 200 px, a `span` of its words 33 px | A caption is as wide as the table. The stamp uses the span's box (119 by 19 px in the demo). |
| `ctx.filter = 'brightness(0) invert(0.45) sepia(1) saturate(30) hue-rotate(-40deg)'` on a clipped draw of the caption | red letters (seen in a screenshot, not read back) | Caption as a rubber stamp (28.12): turned 15 degrees, 1.9 times its size, down in 0.25 s. The link in the last row is still found by `elementFromPoint()` under the stamp. |
| A `tfoot` cell's text changed 5 times, 100 ms apart | 5 paint events that name the table | Footer totals that count up (28.13): the cell's text is written on each frame for 0.6 s. The total read £34.44 0.25 s into a count from £24.25 to £37.00. |
| Buttons and inputs in table cells, table drawn in two clipped pieces | a tap on a drawn + button and typing into a drawn input both changed the total | The table is placed once more with a clipped-away draw, which sets the hit region. |
| A block with and without `datetime` on its `time` and `value` on its `data` | 220 by 24 px both times, `time` 57 px wide both times | Machine values next to shown values (28.14) reads `dateTime` and `value` and draws them as canvas text above the first client rectangle of each element. |
| Paint events naming a drawable `marquee` (`scrollamount="3" scrolldelay="16" truespeed`) | 60 in one second, 0 in half a second after `stop()` | Stock ticker with real links (28.20) draws only on those events. |
| `elementFromPoint()` at a link inside the scrolling marquee, 10 samples 80 ms apart | 10 of 10 found the link, left edge from 113 to -22 px | Hit testing follows the scroll. In the demo a touch tap on a moving link reported that link. |
| An `address` and a `form`, both drawable, in one canvas | a tap on the drawn Town field focused it; typing changed the address on the envelope | Address on an envelope (28.16). On submit the flap closes in 0.5 s and the envelope leaves; no frames afterwards. |
| A lost context | plain HTML | One `contextlost` event stops the five canvases and shows the elements as plain HTML (5 boxes). The ticker uses the paint handler of `/paint-clocks/` and the others that of `/form-state/`, so the page passes each kit's stop event to the other. Tested by dispatching the event. |

## Things that bit

- The stamp was first sized from the caption's own box and came out as wide as the table times 1.9. The caption's box spans the table.
- The M key did nothing after a tap on the "Keep them shown" box, because the key handler ignored every `input` and the checkbox had focus. It now ignores text fields only.
- The tool script looked for a link inside the marquee at one moment and found the gap at the end of the loop. It now waits up to 8 s.
- `put()` from one kit and `mount()` from the other do not share the flag that asks for a retry when an element has no picture yet. The ticker imports both from `/paint-clocks/kit.js`.

## Not verified

- Chrome 159 on Android: the five demos by touch.
- The cost of the ticker on a phone: three filtered draws of the marquee on each of 60 paint events a second.
- The on-screen keyboard over the envelope form and the quantity fields.
- Holding a finger on the "Hold to show machine values" button without a long-press menu or text selection.
- Whether a real marquee on Android scrolls at the same rate (`truespeed` with a 16 ms delay).
- The colour of the stamp was judged from a screenshot, not from pixel values.

## For the index

- Elements: `caption` and `tfoot` have offset boxes inside a drawable table with `position: relative`; a caption's box is as wide as the table. C157, `/table-data/`.
- Paint: a drawable `marquee` raises one paint event per step (60 a second with `scrolldelay="16" truespeed`) and none after `stop()`.
- Input: links inside a scrolling drawable marquee are hit-tested at their current place.
- Effects: `ctx.filter` with `brightness(0)` first recolours a clipped piece of an element to one colour.
- Elements: the `datetime` and `value` attributes are not in the picture.
- Backlog: ideas 28.12, 28.13, 28.14, 28.16 and 28.20 are built on `/table-data/`.
