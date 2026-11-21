# Five more select pickers (`/select-ideas/`, `lib/select-ideas.js`)

Measured in C157 (headless Chromium 157, software rendering) on 2026-11-21, with Playwright: mouse, keyboard and emulated touch at 412 px. The page builds on `lib/select-picker.js` and the results in [select.md](select.md).

| Experiment | Result | Reason or detail |
| --- | --- | --- |
| Draw the same `<option>` twice in one `paint` (small in a list, then enlarged inside a clipped circle) | works | Both pictures appear. The hit box is where the option was drawn last: `elementFromPoint()` in the lens returns the enlarged option (30 px tall, its small copy is 11 px). |
| 156 options visible at once in one picker, no scrolling | works | Three columns at 0.3 scale, about 30 options redrawn in the lens each frame. |
| A new affine transform (translate, skew, squash) for every option on every frame | works | `elementFromPoint()` returned a falling option at its drawn place while it moved 108 px in 3 frames. |
| An option that bends like cloth | not possible with one element | `drawElementImage()` and `updateElementGeometry()` take one matrix per element. A mesh needs the pointer mapped by hand, as on `/physical/`. |
| 70 options placed on arcs and rotated to face a point | works | Rotated options are hit where drawn. Arrow keys follow DOM order, which is row by row. |
| Disabled option chosen from script (`option.selected = true`) | the select accepts it | The select only refuses a real click. `SelectPicker.choose()` now returns early for a disabled option, which matters for layouts that choose on finger lift. |
| `drawImage()` from a 2D canvas after `drawElementImage()` of options into a second canvas, then `getImageData()` on the copy | works | The canvas is not tainted. Direct `getImageData()` on the drawable canvas also worked in headless C157, but the page no longer does it: on Paul's Android phone (Chrome 159, reported 2026-11-21) a drawable 2D canvas that is read with `getImageData()` after being created with `willReadFrequently: true` loses every 2D context on the page. The field canvas (not drawable) no longer asks for `willReadFrequently`. |
| `drawImage(pickerCanvas, …)` into another canvas | works | Used to copy the chosen option's rectangle. |
| Append an `<option drawable>` to the picker canvas while the picker is open | works | It is drawn and hit tested on the next frame, becomes the value, and appears in `<selectedcontent>`. |
| `drawElementImage(option)` in the frame after the picker closes | fails | "No cached paint record for element." |
| Keep the chosen option on screen after the close | works as a still | The option's rectangle is copied from the picker canvas into a `<canvas popover="manual">`, which is animated to the button with the Web Animations API. |
| `label` attribute on an option in a customisable select | replaces the option's content | The picker then draws the label text, not the option's child elements. The page keeps names in `data-name`. |

## Things that bit

- Moving the options of a select into a canvas one at a time changes the value. Each move makes the select pick an option again, and it ends on the last one. `ideaPicker()` puts `selectedIndex` back. `/select/` did not show this because its options are added after the canvas exists.
- An option wider than the lens showed only its right-hand part in the lens. The lens is now centred on a column across, and follows the pointer only down the list.
- One tap opens one picker, so the live checks put five canvases, one per layout, in a scrolling box inside one test select, and scroll that box between checks.
- A layout cannot ask `SelectPicker` for another frame. The spring layout calls `canvas.requestPaint()` itself from `requestAnimationFrame` while anything is still moving.

## Not verified

- Android Chrome on a phone: sliding a finger in each picker, and the frame rate of the spring layout. Open `/select-ideas/` on the phone and use each select.
- Whether the copied picture of the chosen option is sharp at the phone's device pixel ratio. The copy is made at the canvas's backing-store size.
- A screen reader on the seat plan. Each seat keeps its text ("Row C, seat 7" is in a hidden span), which was not listened to.

## For the index

- Select: an option drawn twice in one frame is hit where it was drawn last (`/select-ideas/`).
- Select: a disabled option can be chosen from script.
- Select: a `label` attribute on an option replaces its content in a customisable select.
- Reading back: `drawImage()` from a 2D canvas after `drawElementImage()` works, and the copy can be read with `getImageData()`. Read the copy, not the drawable canvas.
- Select: options stop painting when the picker closes. A copy of the picker canvas is the only picture left.

## API requests

- A way for the chosen option to keep painting for a moment after the select closes, or an `ElementImage` of it handed to the page at the moment of choice.
- `updateElementGeometry()` taking a mesh or a list of quads, so a bent element can be hit tested without mapping the pointer by hand.

## Open ideas

- A lens drawn by a shader, which bends the text continuously where this one draws each option flat.
- Throwing an option at a target to choose it, with the spring layout's physics.
- A seat plan over a photograph of the room.
