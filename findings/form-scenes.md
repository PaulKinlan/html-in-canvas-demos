# Form controls in a drawn setting (`/form-scenes/`)

Four ideas from the element catalogue (group 13 of the backlog in PLAN.md): the exploded form diagram, the wall calendar round a date input, the file input on a letter box and the disabled panel. Measured in headless Chromium 157 (C157) on 2026-11-21 with a mouse, a keyboard and emulated touch at 412 px wide. The page's ten live checks pass there. `node tools/form-scenes/check.mjs` drives the four demos with taps, typing, a file chooser and a file drop (29 steps, all pass). `npm run check:jank -- /form-scenes/` passes (0 WebGL contexts, 4.6 MB of canvas, 0 readbacks). Nothing here has been run on Chrome 159 on Android (A159).

| Experiment | Result | Why |
|---|---|---|
| Exploded form: every `<label for>` and every field is its own `drawable` element. Labels are drawn as call-outs away from their fields (167 px in the live check) | works | A tap on a drawn label focused its text field (`document.activeElement`), and a tap on the checkbox's label toggled it. `label.control` is unchanged. No page code moves focus. |
| A text field drawn under a shear (`ctx.transform(1, -0.22, 0, 1, 0, 0)`) | works | A tap near the raised end focused the field and typed text went into it. `getBoundingClientRect()` is the bounding box of the sheared shape: 150 by 81 px for a 150 by 36 px field at a shear of -0.3 (live check). |
| Hit testing in the empty corner of a sheared field's bounding box | returns the canvas | The hit region is the parallelogram, not its bounding box (live check). |
| Browser validation message for a sheared field | shown at the field | After Send with the name empty the message pointed at the field where it was drawn (screenshot, C157 headless). The browser then focuses that field. |
| Wall calendar: `<input type="date">` and `<input type="month">` drawn on a sheet. The grid, month name and pen ring are canvas drawing from their values | works | A tap on the grid writes `date.value` and dispatches `input`. The buttons call `month.stepUp()` and `stepDown()`. |
| A value written by script (`date.value`, `month.value`, `month.stepUp()`) | `paint`, no `input` event | One `paint` each (live check). The page calls its own handler after `stepUp()`. |
| Keeping the picture of an input's old value with `captureElementImage()` | works | The picture taken before the value changed matched the old pixels in 5,760 of 5,760 places after the change, across frames (live check). The sheet that is torn off is drawn with those pictures, so it shows the old date while the live inputs below show the new one. The page keeps 2 pictures open at rest and at most 4, and closes each when its sheet has fallen. |
| Drawing a picture of an element | moves the live element's hit region | After `drawElementImage(picture, 10, 90, …)` the input's `getBoundingClientRect()` reported y 90 in place of y 10 (live check). The calendar draws the falling sheet last, so it follows it with a draw of each input at `globalAlpha` 0 at its real place. During the fall the date input stayed 0 px from its place. |
| Letter box: `<input type="file" multiple>` drawn as the slot, styled with `::file-selector-button` | works | A tap on the drawn input opened the file chooser (Playwright `filechooser` event, `isMultiple()` true). Files set there arrived in `input.files` with a `change` event. |
| Dropping a file on the drawn file input | works | CDP `Input.dispatchDragEvent` (`dragEnter`, `dragOver`, `drop`) at the drawn place replaced `input.files` with the dropped file and raised `change`. |
| Writing `input.files` from a `DataTransfer` | picture changes, `paint`, no `change` | The input's own text (its count of files) is part of its picture: 572 pixels changed and one `paint` was raised (live check). |
| One `<button drawable>` per file, appended to the canvas later, drawn turned on the mat | works | A tap on a print took its file out of `input.files`. An element that is waiting to be drawn is parked with `updateElementGeometry()`. |
| Small copies of chosen pictures | works in C157 | `createImageBitmap(file, { resizeWidth: 176 })`, then `OffscreenCanvas.convertToBlob()`, on the `change` event. An SVG file fails `createImageBitmap()` and is used as it is if it is under 1 MB. |
| Disabled panel: `disabled` set on a `<fieldset drawable>` by a checkbox in its legend | works | 6 of 7 controls match `:disabled`. The checkbox in the legend does not and still takes a tap. `FormData` is empty and the required field is not validated (`willValidate` false). |
| `paint` after `fieldset.disabled = true` | raised when the picture changes | One `paint`, 678 pixels changed, for a fieldset with a text field and a checkbox (live check). A fieldset holding only a button with the site's button style raised none, because that style has no disabled look and no pixel changed. |
| A press on a disabled control in a canvas | `pointerdown` reaches the canvas, no `click` on the control | `elementFromPoint()` returns the disabled button. A tap on it raised `pointerdown` on the canvas with the button as target and 0 `click` events on controls. A tap on the disabled text field did not focus it. |
| Frost: the fieldset drawn a second time with `ctx.filter = 'blur(…)'`, clipped | works | `ctx.filter` applies to `drawElementImage()`: beside a black and white edge the plain draw read 0 and the blurred draw 93 (live check). Several draws of one element at one place leave its hit region there. |
| No API, and a lost context | plain HTML | With `--disable-blink-features=CanvasDrawElement` all four canvases are replaced by their controls and each form still reports its values. A dispatched `contextlost` on one canvas replaced that canvas after 1.5 s. |

## Things that bit

- The site's stylesheet gives `<button>` no disabled look. A check that disabled a fieldset holding only a button saw no `paint` and no changed pixel. The page adds `button:disabled { opacity: 0.45 }` for the panel, and the check uses a text field and a checkbox.
- After a failed submit the browser focuses the first invalid field, and the `focusin` handler replaced the line about the failure. The handler now leaves the line alone for 200 ms after an `invalid` event.
- The falling sheet has to be drawn after the sheet below it, and its pictures then take the inputs' hit regions with them. The fix is the draw at `globalAlpha` 0, not a change of draw order.
- A `<canvas>` rule with `display: block` beats the `hidden` attribute (found on `/instruments/`). This page writes `canvas.scene[hidden] { display: none }`.
- `lib/stage-2d.js` has a `fixtureCanvas()` helper that makes a drawable canvas with `willReadFrequently: true`. This page does not use it. Its checks read from a `drawImage()` copy.

## Not verified

- Chrome 159 on Android: the four demos by touch. `node tools/form-scenes/check.mjs` covers touch through Playwright's emulated touchscreen only.
- Whether the canvases are kept on the phone. The page has four 2D canvases (4.6 MB), no WebGL, no readback from a drawable canvas and no `willReadFrequently`. Open the page and scroll to the end. A lost canvas is replaced by plain controls with a note.
- The Android date and month dialogs: whether a tap on the drawn date input opens the dialog, and whether the sheet turns when a date in another month is chosen. Open `/form-scenes/#calendar` and tap the date field.
- The Android file chooser, the camera option and a 12 megapixel photo through `createImageBitmap()` with `resizeWidth`. Open `/form-scenes/#letterbox`, tap the slot and choose several photos.
- A file dragged from a file manager with a real pointer. The drop was sent through CDP.
- The on-screen keyboard over a sheared field, and whether the canvas stays in view. Tap a call-out.
- The speed of `ctx.filter` blur on a phone GPU while the frost grows (about 1 s of frames).
- Where Android shows the validation message for a sheared field. Press Send with the name empty.
- A screen reader on any of the four. The grid of days is `aria-hidden` and the date input is the control it should use.

## For the index

- Drawable descendants: a `<label for>` and its field can be drawn as separate elements at different places. Label activation is unchanged.
- Hit testing: an element drawn under a shear is hit inside its parallelogram. `getBoundingClientRect()` returns the bounding box.
- `captureElementImage()`: a picture keeps the element's old rendering after its value changes, across frames.
- `captureElementImage()`: drawing a picture moves the live element's hit region to the picture. A draw of the element at `globalAlpha` 0 moves it back.
- Form controls: a drawn `<input type="file">` opens the file chooser on a tap and takes a drop. Its file count is in its picture.
- Form controls: `disabled` on a drawn fieldset behaves as outside a canvas. A press on a disabled control still reaches the canvas as `pointerdown`.
- 2D context: `ctx.filter` applies to `drawElementImage()`.
- `paint`: raised by `date.value`, `month.value`, `stepUp()`, `input.files` and `fieldset.disabled` when the picture changes, with no `input` or `change` event.
- Element catalogue ideas built: "Exploded form diagram", "Wall calendar around a date input", "File input on a drawn letter box", "Disabled panel in one step" (backlog 13.1 to 13.4).

## API requests

- A way to draw an `ElementImage` picture without moving the live element's hit region. Today a page that draws an old picture after the live element has to draw the element again at alpha 0.
