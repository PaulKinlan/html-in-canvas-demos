# Select multiple, suggestions, and selection extras (`/select-selection/`, `lib/select-selection.js`)

Measured on 2026-11-21 in headless Chromium 157 (C157), driven by Playwright with a mouse, a keyboard and emulated touch at 412 px wide. Nothing here has been run on a phone. Backlog group 24 of `PLAN.md`: items 24.1 to 24.6.

Every canvas on the page has a 2D context. The page makes no WebGL or WebGPU context and reads no pixels back. `npm run check:jank -- /select-selection/` reports `gl 0/0`, `reads 0`, 2.6 MB of canvases.

## A select multiple drawn by a canvas (24.1)

| Experiment | Result | Reason or detail |
|---|---|---|
| A `<canvas layoutsubtree>` inside `<select multiple>`, with the options in it (the arrangement `/select/` uses for a customisable select) | fails (live check, expected failure) | The parser keeps the canvas. Its box is 0 by 0 px, a `paint` event fires, and `drawElementImage(option)` throws "No cached paint record for element". Same with `appearance: base-select` on the select. |
| The select as a `drawable` child of the canvas, each option also `drawable` | works | `drawElementImage(option, …)` draws one option anywhere. The option is left out of the select's own picture. |
| Hit testing of an option drawn that way | works when the select's box covers the place | With the select's box as large as the canvas: click, Ctrl click, Shift click, a mouse drag across options, the arrow keys with Shift, Ctrl and A, and an emulated touch tap all choose the option drawn under the pointer. A tap toggles one option. |
| An option drawn outside the select's own layout box | a real click or tap chooses nothing | Measured with Playwright clicks and taps (select 160 px wide, options drawn 130 and 250 px in). `elementFromPoint()` returned the option in some runs and the canvas in others for the same arrangement, so it is not used as evidence and there is no live check for this row. |
| What a list box option draws | its text and its `::before` | Child elements of the option (`<i>`, `<b>`) are not drawn. Border, radius, padding and width on the option apply. The background of a chosen option is the browser's, and in touch emulation with a dark scheme it was not visible, so the canvas marks chosen chips itself. |
| A lasso: pointer capture on the canvas after 8 px of movement, then `option.selected` set from script | works | The list box stops its own drag selection once the canvas has the pointer. The library fires `input` and `change`. |
| A touch drag on the canvas with the lasso off | scrolls the page | `touch-action: pan-y`. With the lasso on it is `none`. |

## Rich suggestions from a select with no button (24.2)

| Experiment | Result | Reason or detail |
|---|---|---|
| `select.showPicker()` on a customisable select whose `<button>` is `display: none` | opens the picker | From an `input` event handler. From a timer 6 s after the last key it throws `NotAllowedError`: it needs a user activation. |
| Focus after `showPicker()` | moves to an option | The next key press goes to the select. `input.focus()` straight after leaves the picker open and typing carries on in the input. |
| The select laid over the input (`position: absolute; inset: 0; pointer-events: none`) | the picker is placed beside the input's box, above or below | With a select of no height under the input the picker opened over the input when there was no room below. `::picker(select)` needs `pointer-events: auto` again. |
| Options with markup (`<b>`, `<small>`, a `::before` swatch) drawn by the picker's canvas | drawn and hit on their rows | A `<datalist>` option draws only its label (`findings/datalist.md`). |
| A select with `selectedIndex = -1` | submits no entry | So the form has no station code until a row is taken. |
| Focus when a row is tapped | goes to the select as the picker closes | A `focus()` on the input in a microtask is too early. A 0 ms timer works. |

## Selection in 3D (24.3)

| Experiment | Result | Reason or detail |
|---|---|---|
| A perspective picture on a 2D canvas | works, in strips | 2 px strips with the nine-argument `drawElementImage()`, each at the width and place its row has on the plane: 118 calls for the article, plus the selected lines again. Exact for a turn about a horizontal axis, because rows stay horizontal. |
| `updateElementGeometry()` with a 4 by 4 matrix that has a perspective row, on a canvas with a 2D context | works | `caretPositionFromPoint()` at the drawn place of three words lands inside each word at 48 degrees (live check). A mouse drag selects the text under the pointer. |
| The hit box after a nine-argument draw | cut to that draw's source rectangle (live check, expected failure) | `updateElementGeometry()` then moves the cut box and does not make it whole. With only strips drawn, the article was hit in its last 2 px and nowhere else. A five-argument draw at `globalAlpha` 0 before `updateElementGeometry()` restores it. |
| `Range.getClientRects()` under the perspective matrix | bounding boxes of slanted quads | A sentence measured 254 by 12 px on the plane and 265 by 20 px in a copy with no transform. The page measures on a second copy of the article that is laid out in the canvas and never drawn. |
| `updateElementGeometry()` on a canvas child with no `drawable` attribute | throws | "Descendants passed to updateElementGeometry must have the 'drawable' attribute". The copy keeps the attribute so that its hit box can be moved away. |

## Translate the selection in place (24.4)

| Experiment | Result | Reason or detail |
|---|---|---|
| Text written with `fillText()` over the line rectangles of a sentence | works | The rectangles come from a Range on the sentence. A longer translation is narrowed by the same factor on every line (French 85%, German 65 to 77% for these sentences). |
| The DOM, the selection and a copy after that | unchanged | The article still holds the English. A selection across a covered sentence copies the English. |
| The browser's selection highlight | taller than the range rectangles | It is as tall as the line box, so the cover uses the computed `line-height`. |
| `Translator.availability()` | did not settle | The promise neither resolved nor rejected in headless C157. The page waits 1.5 s and uses a table of the five sentences written in advance. |

## Haptics on selection change (24.5)

| Experiment | Result | Reason or detail |
|---|---|---|
| A pulse per word and per sentence, from counts taken on `selectionchange` | works | Five steps gave word, word, word, sentence, word (live check). |
| `navigator.vibrate()` during a mouse drag | returned true 13 times of 13 | In headless C157, which has no motor. This says the call was accepted, not that anything moved. |

## Selection effects for form controls (24.6)

| Experiment | Result | Reason or detail |
|---|---|---|
| Rectangles of a selection inside `<input>` | from `measureText()` | With the input's computed font, padding, border and `scrollLeft`. "Narrowboat" measured 94.8 px both ways (live check). |
| Rectangles of a selection inside `<textarea>` | from a hidden block | Same font, padding, border and wrapping width, laid out as a canvas child that is never drawn. A Range there gives one rectangle per letter, on the right lines. |
| Letters drawn again from the control's picture, one source rectangle each, with `globalCompositeOperation` `multiply` (or `screen` on a dark control) | works | The slice carries the control's background, and the blend leaves the letter on the band. `::selection { background: transparent }` keeps the browser's highlight out of the slices. |
| The control's hit box after the slices | restored by a draw at no opacity | Checked at both ends of the input. |

## Things that bit

- `elementFromPoint()` on an option drawn outside its list box's box is not stable between runs and environments. Real clicks were the evidence.
- A check that calls `showPicker()` must run first, while the tap that started the checks still counts.
- `checkBench()` shows its panel when it is called. Call it from the first check that needs it, not when the module loads.
- Selecting on the leaning plane selected the whole article until the hit box was made whole again (the source rectangle row above), and the never-drawn copy was moved out of the way.

## Not verified

- Android: a `<select multiple>` there is a button that opens a dialog. Whether its options have a picture in a canvas is not known. If they have none, the page draws the labels as text and handles taps itself (forced and tested in a live check); the page's note says which route ran.
- Touch selection handles and the copy menu on the leaning text, and long-press selection in the two controls.
- Vibration on a device with a motor. The page prints what `vibrate()` returned.
- The on-screen keyboard together with the suggestion picker, and whether the picker stays open while typing on Android.
- The Translator API route: `availability()` never answered in the test browser.
- Frame time of about 140 strip draws per paint on a phone. They run only when the angle or the selection changes.
- A screen reader on the suggestion input (`role="combobox"` is set, `aria-activedescendant` needs option ids).

## Open ideas

- A turn about both axes, which needs a different strip direction or a GPU route.
- The lasso on a customisable select with `multiple`, when Chromium supports `appearance: base-select` for it with a canvas child.
- Per-letter effects in a textarea with more than 240 selected letters.

## For the index

- Select: a canvas inside `<select multiple>` is not laid out; put the select in the canvas and draw each `drawable` option (C157, `/select-selection/`).
- Select: `showPicker()` works on a customisable select with a hidden button, needs a user activation and takes the focus (C157, `/select-selection/`).
- Hit testing: the source rectangle of the last nine-argument `drawElementImage()` stays as a cut on the hit box, and `updateElementGeometry()` does not undo it (C157, `/select-selection/`).
- Hit testing: `updateElementGeometry()` accepts a perspective matrix on a 2D canvas and text selection follows it (C157, `/select-selection/`).
- Geometry: `updateElementGeometry()` throws for a canvas child without `drawable` (C157, `/select-selection/`).
- Text selection: a selection inside `<input>` or `<textarea>` can be measured with `measureText()` or a hidden block (C157, `/select-selection/`).

## API requests

- A way to set the hit region of an element without drawing it, including resetting the source rectangle.
- Rectangles for a selection inside a text control.
