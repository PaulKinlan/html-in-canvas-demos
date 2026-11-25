# Dates drawn over date inputs, text fields and radios (`/date-controls/`, `lib/ui-feed/dates.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-25, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [picker-controls.md](picker-controls.md) and the files it lists. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<night-picker>` | night at the lake (date picker) | an `<input type="date" min max>` with a `<label>` and an `<output>` for the price, a `<button aria-haspopup="dialog">`, and a `<dialog>` opened with the `open` attribute holding a `<table>` with an `<input type="radio">` for each night. A night that is taken is a disabled radio |
| `<best-before>` | can's best-before code (date input) | three `<input type="text" inputmode="numeric" maxlength>` with their `<label>`s, an `<h3>` that describes them, a `<p>` for the lot |
| `<return-slip>` | library loan renewal (date picker) | a receipt in a `<div>`: a `<ul>` of loans from the `<option>` children, and a `<details>` whose `<summary>` is the "Return by" line, holding a `<table>` with a radio for each day |
| `<wall-calendar>` | two-colour wall calendar (calendar) | a `<table>` of radios, a second `<table>` with `inert` and `aria-hidden` for the coral ink, two `<button>`s |
| `<day-plan>` | day trip (timeline) | an `<ol>` with a radio for each stop, from the `<option>` children, and a second `<ol>` with `inert` and `aria-hidden` in a heavier weight |

The picker of an `<input type="date">` is drawn by the system outside the page, like the picker of a `<select>` ([elements.md](elements.md)), so every calendar here is a group of radios. The field of the date input is drawn and typed in.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Is a date input drawn, and can it be typed in? | measured: yes | The field draws its own segments (05/13/2027 in the test browser's en-US locale). Typing 05142027 with Playwright's keyboard gave `night=2027-05-14`. The calendar button of the field is hidden with `::-webkit-calendar-picker-indicator`, since its picker can't be drawn. |
| Is a `<dialog>` with the `open` attribute drawn? | measured: yes | `:modal` false, 18 paint events while the rows came down. The point over the 13th answered its radio. |
| Does a taken night refuse a pick? | measured: yes | A click on a taken night left `night=`. The 13th gave `night=2027-05-13` and "€134". |
| What does a taken night typed into the field do? | measured: the form is invalid | 2027-05-14 in the date input: `checkValidity()` false with "That night is taken" (`ElementInternals.setValidity()` with `customError`), no radio checked and "Taken" struck through in the field. 2027-05-20 checked its radio. |
| Do three text fields work as one date? | measured: yes | A 2 in the month became 02 and the caret went on to the day. 02/30/2027 gave `bb=` and "That is not a date". 28 gave `bb=2027-02-28`, the down arrow `bb=2027-02-27`. Backspace in the empty year went back and took the last digit of the day. |
| Does the dot spray draw and stop? | measured: yes | 10 paint events in 150 ms after a figure was typed, 0 in 500 ms at rest. |
| Can a `<details>` grow a receipt? | measured: yes | Opened, the receipt grew by 175 units over 30 paint events and was lifted as it grew. Before today, a Monday, the closed day were disabled and the day after the last renewal day was not in the table. Picking 8 December gave `renew=2026-12-08` and both loans read "Due TUE, DEC 8". |
| Do the arrow keys cross into the next month? | measured: yes (keydown events sent to the radio) | ArrowRight on 31 October turned the page over 28 paint events to November, with `day=1986-11-01` and focus on the 1st. ArrowUp went back a week into October: `day=1986-10-25`. A group of radios stops at its last radio by itself, so the control handles the keys. |
| Can an inert copy carry a second ink? | measured: yes | The coral table is inert and hidden with no radios, and its label for the chosen day is filled. Both tables are drawn with `multiply`, the coral one 0.8 and 0.6 units off and a tenth of the turn behind. |
| Can one weight be faded into another? | measured: yes | 90 ms after a click the third stop was 57% faded in, and at rest the weights were 0, 0, 1. Each row is cut from both copies, the light one drawn with alpha 1 − e and the heavy one with e. The point over the stop answered the light copy's radio. |
| Do taps and typing work by touch? | measured: yes (emulated Pixel 7, CDP touch events) | A tap on the button opened the dialog and a tap on the 13th gave `night=2027-05-13` and closed it. A tap on the month box and typing 02282027 gave `best-before=2027-02-28`. A tap on the "Return by" line opened the calendar, and a tap on 9 December gave `renew=2026-12-09` and closed it. A tap on the next button turned the calendar to November and a tap on the 3rd gave `day=1986-11-03`. A tap on the last stop gave `stop=train-home`. Vertical swipes of 180 units on the list and on the calendar scrolled the page by 165 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the date input, the button and the dialog of 31 radios were in a plain box. The button opened the dialog and a click on the 13th radio gave `night=2027-05-13`. |
| Do the controls stop painting? | measured: yes | 0 paint events in 500 ms at rest for each of the five. The best-before code asks for a paint every 530 ms while a field has focus, for its caret. |

## Things that bit

- `this.title` on a custom element is the `title` attribute. The best-before control kept its heading element there, so the heading became the string "[object HTMLHeadingElement]" and was never drawn. `this.dir` is the `dir` attribute too, and the calendar kept the direction of a page turn there. Both are renamed. (The effect on `dir` was not measured.)
- A disabled radio can still be checked from script. Setting the date input to a taken night checked its radio until the loop skipped disabled ones.
- The wall calendar's six-week months were taller than the canvas at the first row height. Rows are 38 units now.
- The condensed "BEST BEFORE" is a `<span>` with `transform: scaleX(0.64)`. As an inline block in a centred heading it was laid out from the left before it was scaled and ran off the right. Centred in a flex box it overflows both sides equally and fits once scaled.
- Filling a band behind the heavy copy to hide the light one left a visible box on the gradient. Drawing each row from both copies with opposite alpha has no box.

## Not verified

- Everything on a phone.
- Typing into the date input with an on-screen keyboard, and what the field looks like in other locales (the original shows 20/05/2027).
- Real arrow keys, Page Up and Page Down on the calendar radios.
- What a screen reader says: each calendar is a radio group in a table. The copies are inert and `aria-hidden`.
- The fonts of the originals. The test browser had none of them.

## For the index

- `/date-controls/`: five ui-feed.dev demos rebuilt on a date input with a non-modal dialog of radios, three text fields, a details on a receipt, a calendar of radios and a list of radios (campsite night, best-before code, library renewal, wall calendar, day out).
- An `<input type="date">` field is drawn and takes typing in a canvas. Its picker is not drawn, so a calendar is a group of radios.
- A second copy of an element, `inert` and `aria-hidden`, styled differently, is how one look is faded or moved over another, since a canvas draws an element only as it is.
- On a custom element, `this.title` and `this.dir` are attributes. Keep children in other property names.
