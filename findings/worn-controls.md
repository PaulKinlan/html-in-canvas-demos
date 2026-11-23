# Controls that wear with use (`/worn-controls/`, `lib/wear-layer.js`)

Measured in C157 (headless shell, 412 px and 1100 px wide, device scale 2 and 2.625, mouse, touch emulation and keyboard) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The ideas are Florian Kiem's Aging Button and Adam Kowalski's Realistic Button, and the page links to both. The slider is my addition. The code and the copy are mine: I didn't read their source.

| Question | Result | Notes |
|---|---|---|
| Cut holes in a button's picture | works | `drawElementImage()`, then `drawImage()` of a plain canvas with `destination-out`. Live check: 0% ink in the cut square, 100% beside it. |
| Draw only behind what is left | works | `destination-over` after the cut. Live check: the hole is the fill colour, rgb(128,128,128), and the paint is still rgb(210,73,31). |
| The thickness of the paint at the edge of a hole | works | A `drawImage()` copy of the visible canvas, drawn back with `destination-over`, `filter: brightness(0)`, half alpha and an offset of 1.2 by 1.8 px. The copy is never read. |
| Hit testing in a hole | the button is hit | `elementFromPoint()` at the centre of a cut square returns the button although the pixel there has alpha 0. |
| Marks kept on the element's surface | works | `source-atop` with `drawImage()` of the wear canvas. 0% ink outside the button. |
| A key drawn lower for every press | works | The picture and the hit box move together. The base under it is drawn by the canvas and stays, so the key gets shorter. |
| Save the wear without reading a canvas | works | A mark is drawn from a seeded generator. The wear is a list of presses (point and seed) in `localStorage`, replayed on load. Live check: 40 presses drawn twice from one list differ in 0 pixels. After a reload the page showed the same counts and the same picture. |
| A native range input in a canvas, drawn over while it is dragged | works | Dragging with the mouse and arrow keys raises `input`. The band is drawn with `source-atop` on the slider's picture. |
| Press by touch | works in emulation | A tap 40 px right of centre recorded a press at x 150 of 220. |
| Press from the keyboard | works | Enter and Space press Save and the key. A press with no pointer is put near the middle. |
| No API | plain HTML | The three controls are ordinary elements and still count presses. No wear is shown. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 10.2 MB in canvases. |

## Things that bit

- The first wear rate took half the paint off in 56 presses and all of it in 200, and the label was gone long before that. The rate now reaches full strength at 220 presses and stops at 400.
- A pale band on the slider's pale track couldn't be seen. The band is dark, and the page calls it a groove.
- The cut removes the focus ring where a chip crosses it. I left it and say so on the page.

## Not verified

- By touch on a real phone. A finger has no exact point, and the page uses where the pointer went down.
- Whether `destination-out` and `destination-over` on a drawable canvas cost anything on Android. They are ordinary 2D compositing, there is no animation loop, and the page paints only when something is pressed.
- What a screen reader says. The elements are native. `aria-pressed` on the key is set by the page.
- A private window, where `localStorage` may throw. The page catches it and keeps the wear for the visit. I didn't run it.

## Open ideas

- Wear that is shared: every visitor's presses on one button, kept on the server. The list of points and seeds is small enough to send.
- Wear on a text field: the placeholder rubs away where it has been typed over.
- Draw the focus ring last, from `:focus-visible`, so no chip can remove it.
- Re-make the wear canvases when the control changes size.

## For the index

- 2D drawing: `destination-out` with a plain canvas cuts holes in a picture drawn by `drawElementImage()`, and `destination-over` then draws only behind it. measured, C157, `/worn-controls/`.
- Input: the hit box of an element ignores holes cut in its picture. `elementFromPoint()` on a pixel with alpha 0 inside the box returns the element. measured, C157, `/worn-controls/`.
- 2D drawing: marks drawn from a seeded generator can be saved as a list and replayed, so persistent decoration needs no pixel read. measured, C157, `/worn-controls/`.
