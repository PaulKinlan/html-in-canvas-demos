# Four games made of live elements (`/play/`)

The four ideas of the "play" group of the element catalogue (group 20 of the backlog in PLAN.md). Measured in headless Chromium 157 (C157) on 2026-11-21 with a mouse, a keyboard and emulated touch at 412 px wide. The page's nine live checks pass there, and `node tools/play/check.mjs` drives the four demos with real input (26 steps, all pass). Nothing here has been run on a phone.

The question: when a canvas draws one element in several places, or leaves it out, where does input go?

| Experiment | Result | Why |
|---|---|---|
| Native drag from a `draggable` element that a canvas draws (mouse) | works | `dragstart` was raised on the drawn card. `dragover` and `drop` reached a plain element outside the canvas, and `dragend` on the card reported `dropEffect` "move". Three types arrived: `text/plain`, `text/html` and a custom type. |
| The canvas and the drawn cards as drop targets | works | `dragover` and `drop` are raised on the card under the pointer or on the canvas. A card dropped in the hand is moved to that index. Text dropped from elsewhere becomes a new card. |
| The canvas pixels of one card as the drag image | built, the image itself not verified | Inside `dragstart` the canvas is reset, the one card is drawn, the region is copied to a plain canvas with `drawImage()` and the scene is drawn again. The copy holds the card alone (live check: alpha 0 where the other box is). The copy is passed to `setDragImage()`. The test browser shows no drag image, so what a person sees is not verified. A checkbox on the page switches to the browser's own image for comparison. |
| Native drag from a long press (CDP touch, held 0.9 s, then moved) | no `dragstart` | A long press does nothing in the headless browser outside a canvas either. Not a result about Android. |
| Second route for touch and pen | pointer events | A finger that moves 8 px on a card starts it. The same copied pixels follow the finger in a fixed plain canvas, and the same payload goes to the tray. Driven with CDP touch: 1 drag, card removed, note added. |
| `touch-action` on a drawn element | applied at the drawn place | Cards, the form and the grip have `none`, the canvas has `pan-y`. A touch on a card moved it with 0 px of scroll. A touch on the canvas beside the cards scrolled the page 97 px, and beside the form 105 px. |
| Tap on a checkbox in a drawn form | toggles it | One tap, one box. A second tap cleared it. |
| A box checked by script | raises `paint` | 1 paint event. `changedElements` held the `<form>` (the drawable element), not the `<input>`. `form.reset()` raised 1 paint event. |
| The picture as a form value | `FormData` read in the paint handler | The handler compares the set of checked boxes with the last one and starts a ring on each box that changed. No listener is used for the picture. The drag-to-draw listener only writes `checked`. |
| The form drawn again at 1/4 size as a pattern | hard edges | `drawElementImage(form, x, y, 64, 64)` with `imageSmoothingEnabled` off. Live check: four 20 px columns drawn 5 px wide read 0, 255, 0, 255. |
| Which element gets input where two hit regions overlap | the one drawn last | Two overlapping boxes, drawn in both orders in two canvases. `elementFromPoint()` returned the one drawn last each time. Real mouse clicks agreed in a scratch page. Document order did not decide. |
| One same-origin iframe drawn as nine tiles | works | Each tile is the whole frame drawn through a clip of one square at an offset. |
| Input to a tile | the frame's region is placed under the active tile | A hidden draw of the frame at the offset of the active tile. Eight transparent drawable elements ("shields") are placed after it over the other cells. With a mouse, `pointermove` on a shield makes that tile active before a button is pressed, so the click goes into the frame itself. |
| Click, wheel and touch scroll on a tile | work | A click reached the button at the matching point of the frame. The wheel scrolled the frame 90 px. A scroll inside the frame raised `paint` (1 event, `changedElements` held the iframe) and every tile showed the new position. |
| First touch on a tile that is not active | the same touch reaches the frame | The shield's `pointerdown` listener makes the tile active and redraws at once. That same touch then scrolled the frame 35 px, and its tap arrived in the frame as a trusted `click`. In an earlier scratch page that did not toggle an attribute after moving the regions, the click went to the iframe element in the outer document instead. |
| The page's own tap route | used when no trusted click arrives in 120 ms | The page maps the point into the frame, asks the frame document's `elementFromPoint()` and calls `click()` on a control or slides the tile. In C157 it was not needed (0 uses in the driven run). It is kept for the phone, and the line under the demo counts both routes. |
| `drawElementImage()` through a reflection (`scale(-1, 1)`, or the matrix of a reflection about a line) | works | Pixels are mirrored. `getBoundingClientRect()` of a child reports the mirrored place and `elementFromPoint()` finds the child there. |
| A `contenteditable` element drawn in two pieces (flat part and mirrored back) | types and takes the caret | The last draw of the page each frame is a hidden draw at the flat place. A tap focused the page, 47 typed characters were added, and the canvas changed with each key. |
| Text added to a `contenteditable` element by script, no focus | raises `paint` | 1 event, `changedElements` held the element. A `Range` over the new word reported its box at the drawn place. |
| Pages that are not on top | kept, not drawn | They are parked with `updateElementGeometry()` and a transform that shrinks the region to a point. Text typed on page 1 was still there after turning to page 2 and back. |
| A lost context | plain elements | One `contextlost` event on one canvas stops all four demos and shows the cards, the form, the iframe and the pages as plain HTML. Tested by dispatching the event. |

## Things that bit

- `.card` is a class in `shared/style.css`. The notes are `.pcard`.
- A tap on a shield was handled twice: once by the page's own route in `pointerup`, and once by the frame, which got a trusted `click` from the same tap. A tile slid to the gap and back. The page's route now waits 120 ms and is cancelled by the frame's click.
- `elementFromPoint()` kept returning the iframe at a point after a shield was placed there (the remembered hit test of C157). Real input went to the shield. The demo toggles an attribute on the frame and the shields after each move.
- The drag image cannot be made by copying the card's rectangle out of the scene, because the neighbours overlap it. The card is drawn alone first.
- `setDragImage()` needs an element that is laid out. The copy is a canvas with `position: fixed` at -400 px, and the touch route moves that same element under the finger.

## Not verified

- Chrome on Android: whether a long press on a drawn card starts a native drag, and what the drag image shows with `setDragImage()` and without it. Open `/play/#drag`, long press a card, and read the line under the tray.
- A drop into a second window. Open `/play/` in two windows on a desktop and drag a card to the other window's tray. The card should leave the first window when `dragend` reports "move".
- The drag image on a desktop with a real display.
- On the phone: whether the first touch on a tile scrolls the frame, and which tap route the line under the puzzle counts.
- The on-screen keyboard over the notebook and over the text field in the puzzle frame, and touch selection handles on a page whose corner is curled.
- Frame rate of the pixel editor on the phone: 42 small draws of the form per frame while a ring is moving.

## For the index

- Accessibility, focus and selection: where two hit regions overlap, the element drawn last gets the input, whatever the document order. measured, C157, `/play/`.
- Accessibility, focus and selection: `touch-action` of a drawn element applies at its drawn place, so a canvas with `pan-y` can hold elements with `none`. measured with emulated touch, C157, `/play/`.
- Drawing: a `draggable` element drawn by a canvas starts a native drag with a mouse, and the canvas and drawn elements take `dragover` and `drop`. measured, C157, `/play/`.
- Drawing: `drawElementImage()` accepts a reflection, and child rectangles and hit tests are mirrored. measured, C157, `/play/`.
- Drawing: a draw made outside the paint event can be copied with `drawImage()` in the same task. measured, C157, `/play/`.
- Across workers, tabs, origins and devices: one same-origin iframe drawn as nine clipped tiles takes clicks, the wheel and touch scroll on each tile when its hit region is moved under the pointer. measured, C157, `/play/`.
- Element catalogue ideas built: "Drag a card out of the scene", "Pixel editor from checkboxes", "Sliding puzzle of a live page", "Contenteditable on a curling page" (backlog 20.1 to 20.4).

## API requests

- A way to give one element more than one hit region, or to clip its hit region to the clip of the draw. The puzzle needs eight extra elements to cover the parts of the frame's region that are not the active tile.
