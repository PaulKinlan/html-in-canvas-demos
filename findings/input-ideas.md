# Five more input pickers (`/input-ideas/`, `lib/input-ideas.js`)

Measured in Chromium 157 (headless shell, C157), 2026-11-21, with Playwright: mouse and keyboard at 900 px, emulated touch through CDP at 412 px, and the page's live checks. Not run on a phone.

The page builds five of the ideas listed at the end of `/inputs/`. Each control is a real `<input>` that keeps its value, form entry, `input` and `change` events and keyboard handling. The three popover pickers are built on `lib/placed-popover.js`.

| Experiment | Result | Reason or detail |
|---|---|---|
| `drawElementImage(el, sx, sy, sw, sh, dx, dy, dw, dh)`, the nine-argument form | works | The source rectangle is in CSS pixels of the element, at device pixel ratio 1 and 2. Live check: only the blue half of a red and blue button was drawn. |
| Hit testing after a draw with a source rectangle | only the drawn part is hit | `elementFromPoint()` returned the element inside the destination rectangle and the canvas where the rest of the element would be. `getBoundingClientRect()` still reports the whole element, placed so that the source maps to the destination. |
| One `<input type="range">` drawn about 134 times a frame in slices 3 px wide, each under its own rotation | works | The built-in track, thumb and fill follow a 240 degree arc. Half a pixel of overlap hides the joins. A clip with the five-argument form gave the same pixel counts as the source rectangle form. |
| Tick marks of the range input's `<datalist>` | bend with the input | They are part of the input's picture. Live check: tick pixels inside the arc with the `list` attribute, none without. |
| Hit box of the sliced input | does not follow the arc | An element has one box and every draw moves it. After the slices it is the whole input turned to the angle of the last slice. Live check (expected to fail): the input was hit at the end of the arc and not at 10% or 50%. |
| Pointer input on the dial | mapped by hand | The input has `pointer-events: none`. The canvas turns the pointer's angle into a value, sets `valueAsNumber` (the input rounds to its step) and dispatches `input`, then `change` on release. Arrow keys, Home, End and Page Up work with no code because the input has the focus. |
| A last draw with `globalAlpha = 0` under a scale | sets the hit box and paints nothing | Used to leave the input's box over the whole dial, so `getBoundingClientRect()` is the dial's square (live check: 120 by 120 px for a radius of 60). |
| Focus ring of an input drawn by a canvas | partly missing | An outline outside the border box is not in the picture. The default ring showed as lines along the two long edges of each slice. The dial sets `outline: none` and strokes its own arc when the input matches `:focus-visible`. The text input uses an outline with `outline-offset: -2px`. |
| Two `<input type="date">` on one `PlacedPopover` calendar | works | First press writes the start and empties the end, second press writes both in order. A press, slide and lift sets both in one touch. The band is 2D drawing in `under()`: two day numbers that move towards their targets each frame. |
| Finding the day under a finger during a touch drag | `elementFromPoint()` | Pointer events of a touch keep the element they started on as target. `elementFromPoint()` returns the day button at its drawn place. |
| A focused day button that slides out with its month | scrolled the page | Its hit box is moved far away, and `focus()` on a button of the incoming month then scrolled the page to the top. `focus({ preventScroll: true })` fixed it. |
| `getImageData()` on a canvas that has had `drawElementImage()` called on it | works | No exception, and `toDataURL()` works too, for same-origin content (buttons, a range input, a span). The colour wheel therefore needs no second canvas. |
| Reading the wheel's colour under the pointer | within 5 of 255 per channel | The wheel is a conic gradient for hue, a radial white gradient for saturation and a black fill for brightness. The pixel is read in `under()`, after the wheel is drawn and before the swatch buttons and the marker, so they are never read. If the read throws, the picker works the colour out from the position and records the error. |
| Datalist colours as buttons at the place of their own colour on the wheel | works | 24 px buttons, hit tested where drawn. A drag that starts on a swatch becomes a wheel drag after 8 px. |
| A real `<input type="range">` (brightness) drawn in a popover canvas with `touch-action: none` | works by mouse and emulated touch | A touch drag from the thumb and a tap on the track both changed the value. |
| 53 week buttons drawn at 0.57 scale with a fisheye | works | Buttons within 84 px of the focus are pushed out by `g(t) = (p + 1)t / (pt + 1)` and scaled by the mean of the radial and tangential stretch. Scaling every button up with no squeeze at the rim made the buttons overlap. |
| Number of ISO weeks | 53 for 2026, 52 for 2027 | 53 when 1 January is a Thursday, or a Wednesday in a leap year. The 53rd button is not placed in a 52 week year and its hit box is moved away. |
| Slide and lift on the week grid | works by emulated touch | The nearest week is found from the small grid, because a radial fisheye keeps the order of distances from its centre. |
| `<datalist style="display:block">` and `<option drawable>` as children of the same canvas as the input | works | The canvas draws the input, then the part of one option after the typed letters, with the nine-argument form at `globalAlpha` 0.45. |
| Caret position from `measureText()` with the input's computed `font` | matches layout | Live check: 40.20 px for "Leeds" from `measureText()` and from the option's box. The position also takes the input's border, padding and `scrollLeft`. |
| Tap on the ghost text | reaches the option | Because only the drawn part of the option is hit tested, a tap on the typed letters still reaches the input. `preventDefault()` on `mousedown` keeps the focus in the input. |
| Options written as `<option value="Leeds">` with no text | draw nothing | An option renders its label. The page writes the name as the option's text. |
| Without HTML-in-canvas | ordinary inputs | The children of a canvas are not shown, so the dial and ghost text canvases are replaced by their inputs (`unwrap()`), and the ghost input gets its `list` attribute back. Checked by deleting `drawElementImage` before load: five notes, six visible inputs, no errors. |
| `npm run check:jank -- /input-ideas/` | passes | Checks wait for a tap. With `--checks` (checks forced to run on load) it reports layout shift 0.19 and 3 blank frames, the same kind of result as `/inputs/` (0.104 and 1). |

Live checks: 15, of which 14 pass and 1 fails as expected (the hit box of the sliced input), at 900 px and at 412 px with touch emulation.

## Things that bit

- The first fisheye scaled buttons up near the pointer and left the rest at full base size. Buttons at the rim of the lens were pushed together and overlapped. Scaling by the local stretch of the mapping fixed it.
- The default focus outline of the range input drew as two black lines along the arc. See the table.
- Clicking "next month" by mouse after choosing a day scrolled the page to the top. See the table.
- A date range fixture with a start and no end opens in the "choose the last day" state, so the first press in a check ended the range. The fixture now has both values.
- The first emulated touch drags on the wheel began on a swatch button and did nothing, which is how the drag-from-a-swatch rule came about.
- Playwright's `click()` on the checks button scrolls it into view. Measure page scroll after that click, not before.

## Not verified

- Real touch on a phone for all five demos. Open the page on Android Chrome and use each demo by finger.
- Whether making the date and week inputs `readonly` while the replacement picker is open stops the Android date and week dialogs. Tap the fields on a phone.
- The on-screen keyboard with the ghost text: whether the keyboard's own suggestions and composition (IME) leave the ghost text in the right place, and whether a tap on the ghost text keeps the keyboard open. Type in the Station field on a phone.
- Screen readers. The ghost text is not announced by anything the page does, and the dial is announced as an ordinary slider. Listen with TalkBack.
- `getImageData()` after drawing an element that holds cross-origin content (for example a cross-origin `<img>`). A probe was written but its image from a second local port did not load in the test browser. A page with a cross-origin image inside a drawn element, read with `getImageData()`, would verify it.
- The cost of about 134 `drawElementImage()` calls a frame and of one `getImageData()` a frame on a phone GPU. A frame time readout on the device would verify it.
- The swatch buttons on the wheel are 24 px, below the usual 44 px touch target. Not tried by finger.
- Right-to-left text and non-Latin scripts in the ghost text.

## For the index

- Drawing: `drawElementImage()` has a nine-argument form with a source rectangle in CSS pixels of the element (measured, C157, `/input-ideas/`).
- Drawing: one element can be drawn more than 100 times in one frame in slices under different transforms (measured, C157, `/input-ideas/`).
- Hit testing and geometry: after a draw with a source rectangle only the drawn part of the element is hit tested (measured, C157, `/input-ideas/`).
- Hit testing and geometry: a draw with `globalAlpha = 0` moves the hit box and paints nothing (measured, C157, `/input-ideas/`).
- Hit testing and geometry: an element drawn in slices along a curve has the hit box of its last slice (measured, C157, `/input-ideas/`).
- Reading back: `getImageData()` and `toDataURL()` work on a 2D canvas after `drawElementImage()` of same-origin content (measured, C157, `/input-ideas/`).
- Form controls: an outline outside an element's border box is not part of its picture (measured, C157, `/input-ideas/`).
- Form controls: a datalist option can be drawn inside the picture of its input, in the same canvas (measured, C157, `/input-ideas/`).

## API requests

- A way to give an element a hit region that is not one transformed rectangle, for an element drawn in pieces.
- The focus ring of a drawn element included in its picture, or a documented way to ask for it.

## Open ideas, not built

- The dial as a full turn with a wrap from maximum to minimum, for an angle or a time of day.
- Two thumbs on one arc from two range inputs drawn into the same canvas, for a range of values.
- The date range calendar showing two months side by side on a wide screen, with the band crossing from one to the other.
- A lightness axis on the colour wheel drawn as a ring round it, read back the same way, in place of the slider.
- An eyedropper mode that reads a pixel of any element drawn in the canvas, not only of the wheel.
- The week picker with the days of the week under the pointer shown as seven small real buttons, to pick a day from the same view.
- Ghost text that shows the second and third matches as fainter lines under the input, each a real option.
- A file input that draws thumbnails of the chosen files, and the controls of `<video>` and `<audio>`, both still open from the list on `/inputs/`.
