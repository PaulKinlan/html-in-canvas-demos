# Form controls drawn as machines (`/mech-controls/`, `lib/ui-feed/mechanics.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-23, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. The first twenty are in [dot-controls.md](dot-controls.md) and the next five in [sim-controls.md](sim-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<tappet-timer>` | tappets of a 24 hour timer (toggle group) | 96 `<input type="checkbox">`, one for each quarter of an hour, and an `<output>` |
| `<record-speed>` | record player speed (segmented control) | three `<input type="radio">` with a `<label for>` each, and slotted text on the record label |
| `<darkroom-timer>` | darkroom enlarger timer (number input) | `<input type="number">` over the window, two `<button>`s, `<input type="range">` under the knob |
| `<pendant-card>` | pendant lamp (hover card) | a `<button aria-describedby>` for each `<option>` child, and one `<div role="tooltip">` |
| `<morse-complete>` | morse key (autocomplete) | `<input role="combobox">`, a clear `<button>`, an `<ol role="listbox">`, a `<button>` under the key, an `<output>` for the tape |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Is a checkbox drawn under `ctx.rotate()` hit where it is drawn? | measured: yes | Each tappet's checkbox is 30 by 9 units, drawn with alpha 0 after `ctx.rotate()`. With the time set to 09:40, `elementFromPoint()` at the middle of 12 tappets spread round the ring answered each tappet's own checkbox. |
| Can 96 checkboxes be one form value? | measured: yes | The value joins neighbours into spans. `heating=06:00-07:15` became `heating=06:00-07:30,18:00-18:30` after three clicks through the hit regions. |
| Does the dial stop drawing? | measured: yes | 0 paint events in 300 ms, 900 ms after the clicks. The tappet springs take about 600 ms to come to rest, so a check 500 ms after a click still counted 6. |
| Does the record run up to speed? | measured: yes | The form had `rpm=78` at once. The platter was at 33.3 rpm, 42.8 rpm 150 ms after the click and 77.7 rpm after 3.5 s (motor time constant 0.7 s). |
| Can a number field be typed in with no visible field? | measured: yes | The field has `opacity: 0` over the window. Typing 30 gave `exposure=30`, and the tape was at 24.0 after 150 ms and stopped at 30. Plus gave 9 and the range under the knob 12. |
| Does a touch that circles the knob turn it, or scroll the page? | measured: it turns (emulated Pixel 7, CDP touch events) | A 3 radian circle of radius 30 units took the value from 8 to 13 with no `pointercancel` and no scroll. |
| Does the card wait for the lamp? | measured: yes | 120 ms after focus moved to the fourth button the card still held the second person's text, at 0% alpha. The lamp swung 24.4 degrees off vertical on the way. At rest the card read the fourth person, `aria-expanded` was true on that button, and there were 0 paint events in 300 ms. |
| Does `globalAlpha` apply to `drawElementImage()`? | measured: yes | The card fades in over 180 ms with no CSS transition. |
| Can a press be timed on a drawn button? | measured: yes | Presses of 340, 70, 70 and 70 ms typed "B" and left 4 of 6 rows. Dot dash dot after it made "Br" and left 1. By emulated touch, presses of 400, 70, 70 and 70 ms typed "B" with no `pointercancel` and no scroll. |
| Does the list narrow as the field is typed in? | measured: yes | After "b": Bananas, Basil, Bread, Butter, each with the Morse for its next letter. ArrowDown and Enter gave `item=Basil`. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the three radios and their labels were in a plain box, and a click on the third gave `rpm=78`. |

## Things that bit

- A `change` listener on the canvas stops hearing the radios when the fallback moves them out of the canvas. The first run of the fallback check clicked a radio and the form still had `rpm=45`. The listeners are on the shadow root now.
- The lamp never came to rest. With a stiff trolley it swung 45 degrees and its damping left it moving by a hundredth of a radian five seconds later, so the canvas drew for ever. The trolley is softer now, the pendulum is damped more, and below 0.003 rad the model stops and snaps to rest.
- The card ran off the bottom of the canvas with two rows of detail. The row of faces moved up by 22 units.

## Not verified

- Everything on a phone. Whether a finger can pick one tappet 9 units wide, turning the knob by touch, how long a press a thumb makes on the key (a dot is under 220 ms), and whether a long press on the key opens a context menu.
- Whether the key's tone plays. The headless browser has no sound.
- What a screen reader says for 96 checkboxes, and for a combobox whose list is drawn by a canvas.
- Typing in the hidden number field with a phone keyboard.

## For the index

- `/mech-controls/`: five ui-feed.dev demos rebuilt as native controls drawn as machines (24 hour tappet timer, record player speed, darkroom timer, pendant lamp hover card, Morse key autocomplete).
- An alpha-0 draw under `ctx.rotate()` places a rotated hit region: 12 of 12 points on a ring of 96 checkboxes answered the right one.
- A listener on the canvas is lost to elements that a fallback moves out of it. Listen on the shadow root.

## Open ideas

- Drag across the ring to push a run of tappets in one stroke.
- A hand on the record: slow the platter by touch and let the motor pull it back.
- The remaining 58 demos on ui-feed.dev.
