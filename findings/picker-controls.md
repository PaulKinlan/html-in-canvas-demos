# Pickers drawn over details, dialogs, radios and a scroller (`/picker-controls/`, `lib/ui-feed/pickers.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-24, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [dot-controls.md](dot-controls.md), [sim-controls.md](sim-controls.md), [mech-controls.md](mech-controls.md), [gauge-controls.md](gauge-controls.md), [readout-controls.md](readout-controls.md), [disclosure-controls.md](disclosure-controls.md) and [tree-controls.md](tree-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<size-select>` | shoe size (select) | a `<details>` whose `<summary>` shows the size, holding an `<input type="radio">` in a `<label>` for each `<option>`. A sold-out size is a disabled radio |
| `<part-popovers>` | bicycle parts (popover) | a `<button aria-expanded>` and a `<dialog>` for each part, opened with the `open` attribute. The card holds a `<form method="dialog">`, a `<data>` for the price and a `<button>`. An `<output>` for the total |
| `<glaze-radios>` | glaze (segmented control) | an `<input type="radio">` and a `<label>` for each glaze, an `<output>` for the description |
| `<crossword-entry>` | crossword (one-time code input) | one `<input type="text" maxlength>` across the row, a `<table>` for the grid, a `<header>` for the clue |
| `<tulip-carousel>` | tulips (carousel) | a `<div>` with `scroll-snap-type: x mandatory` holding an `<article>` for each slide, and an `<input type="radio">` for each marker |

A `<select>` and the `popover` attribute are the elements the originals' roles point to. Their pickers are painted in the top layer, and [elements.md](elements.md) records that a canvas has no picture of them, so neither is used here.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a `<details>` with radios behave as a drop-down? | measured: yes | Opened through its hit region: 223 units of radios (7 rows). A click on the sold-out row left `size=39`. A click on 44 gave `size=44` at once, and 110 ms later the element was still open and drawn 55% open. At rest it was closed and the summary read "EU 44 US 10.5". |
| Does an arrow key close the list? | measured: no (with a click sent to the radio, which is what an arrow key sends) | The control closes the list after a click that started on a row, not after one sent to the radio itself. `size=45`, list open. Escape closed it. Real arrow keys were not sent. |
| Is a `<dialog>` with the `open` attribute drawn, and is it out of the top layer? | measured: yes | 119 units high, `:modal` false. The point on its drawn button answered the button. |
| Can the form inside close it after the drawing? | measured: yes | The submit is cancelled. A click gave `parts=saddle` at once, and 50 ms later the dialog was still open and drawn 64% open. At rest it was closed with `returnValue` "add", the dot was named "Saddle, added" and the output read "1 part added, $95". |
| Does opening one card close the other? | measured: yes | And the button of an added part read "Remove". Escape closed the card. |
| Which element answers a tap on a segment? | measured: the one drawn last | With each `<label>` drawn after its radio, the point answered the label. The radios are now drawn last with no alpha, and the point answers the radio. |
| Can one glaze be wiped over another? | measured: yes | The mug is one shape drawn once for each glaze on a plain canvas, 300 by 250 units. 180 ms after a click the new glaze covered 28% of the mug from the right, 2 pictures were held and the output had the new text. |
| Does a text field drawn with no alpha take input? | measured: yes | Both ends of the row answered the input. "sa7t" became "SAT": `answer=SAT`, and the form was not valid (too short, set with `ElementInternals.setValidity()`). "satsumas and more" became "SATSUMA" and the form was valid. |
| Where does a tap put the caret? | measured: in the square, or after the last letter | A click on the sixth square with three letters typed put the caret at 3. A click on the second put it at 1. The control sets this from the point, because the field's own text is not laid out in squares. |
| Does a scroll-snap element drawn by the canvas scroll and snap? | measured: yes | A click on the third marker: 112 units after 160 ms, 720 at rest, 45 paint events on the way, `tulip=parade` and 1 `change` event. Scrolled by script to 980, it snapped to 1080 by itself, the fourth radio was checked and the form had `tulip=maureen`. |
| Do taps, typing and swipes work by touch? | measured: yes (emulated Pixel 7, CDP touch events) | Taps opened the list and chose 44, opened the bell's card and pressed Add (`parts=bell`), closed a card from the wall, and chose a glaze. A tap on the row gave the input focus and typing gave `answer=SAT`. A swipe of 220 units on the slides moved one slide (`tulip=recreado`), a vertical swipe of 140 units scrolled the page by 125 px, and a tap on the fifth marker gave `tulip=cafe-noir`. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the details with its 3 radios was in a plain box. A click on the summary opened it without the control and a click on the second radio gave `size=40`. |
| Do the controls stop painting? | measured: yes | 0 paint events in 300 ms at rest for each of the five. The crossword asks for a paint every 530 ms while its field has focus, for the caret. |

## Things that bit

- In the frame where a `<details>` closes, its box is already short and its picture is still the open one. Drawn at the new size, the list was squashed into the summary for a frame (seen in a screenshot). That frame is drawn at the height the element had.
- `dialog.show()` moves focus and can scroll the page to the dialog ([genie.md](genie.md)). The control sets `open` and calls `focus({ preventScroll: true })` on the card's button.
- The button's value changes from "add" to "remove" when the part is added, so the value to close with is read before the state changes.
- The spring that sizes the shoe was still moving 700 ms after a change, and the control kept painting. It is stiffer now.
- A focused field's caret blinks in its picture and raises paints, even when the picture is never drawn. The field has `caret-color: transparent`.

## Not verified

- Everything on a phone.
- The on-screen keyboard over the crossword: whether `autocapitalize="characters"` is honoured, what word suggestions and an IME do to the value while it is rewritten in capitals, and whether the page scrolls the row into view.
- A fling on the carousel, and whether `scroll-snap-stop: always` holds it to one slide.
- Real arrow keys on the radios of the drop-down.
- What a screen reader says: the drop-down is a group of radios in a details, not a list box. The cards are dialogs without a modal backdrop.
- Fonts. The originals use a wide grotesque, a slab and a Didone. The test browser had none of them.
- The shoe, the bicycle, the mug and the tulips are photographs in the originals. Mine are paths and gradients.

## For the index

- `/picker-controls/`: five ui-feed.dev demos rebuilt on a details with radios, non-modal dialogs, radios, a text input and a scroll-snap element (shoe size, bicycle parts, glaze, crossword, tulips).
- A `<dialog>` with the `open` attribute is not in the top layer and is drawn like any child. A `<form method="dialog">` in it can be cancelled and the dialog closed later with `close(value)`.
- A drawable scroll-snap element scrolls and snaps natively and raises a paint event at each step, so scroll-linked drawing reads `scrollLeft` in the paint handler.
- In the frame where an element gets smaller, its picture is still the old one. A draw at `offsetHeight` squashes it.

## Open ideas

- Try `<select>` with `appearance: base-select` again when a canvas can be placed inside its picker for every option (as `/select/` does), with this drawing.
- Typing a letter in the drop-down to jump to a size.
- The crossword's down clues: a second input that runs down a column, with the crossing square shared.
- `::scroll-marker` for the carousel's lines in place of radios.
- The remaining 33 demos on ui-feed.dev.
