# Controls drawn as simulations (`/sim-controls/`, `lib/ui-feed/physics.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-23, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. The first twenty are in [dot-controls.md](dot-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<pump-number>` | hand pump (number input) | `<input type="number">` drawn in the dial, two `<button>`s, `<input type="range">` under the handle, a `<button>` under the release cap |
| `<string-radios>` | plucked strings (radio group) | one `<input type="radio">` and one `<label for>` for each `<option>` child, all direct children of the canvas |
| `<candle-rating>` | candles (rating) | five `<input type="radio">`, a slotted question, an `<output>` |
| `<orbit-listbox>` | orbital capture (listbox) | `<select size="6">`, drawn as painted |
| `<ball-calendar>` | bouncing ball (calendar) | `<table>` with a `<button aria-pressed>` for each day, an `<output>` for the header |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a control step a simulation in its paint handler? | measured: yes | Each `draw()` steps its model by the time since the last paint (at most 1/30 s) and returns whether anything still moves. The base class asks for one more paint only then. |
| Does a control at rest stop drawing? | measured: yes for four | The orbit control had 0 paint events in 300 ms, 9.7 s after a change. The pump, the strings and the calendar return false when their model is still. The candles draw at 30 frames a second while any flame is lit. |
| Can a range be the handle of a pump that moves on the other axis? | measured: yes | The range is horizontal and placed with an alpha-0 draw over a handle that moves vertically. On `pointerdown` the pointer is captured and the stroke comes from `clientY`. The range's `input` events are ignored while it is held. The arrow keys, Home and End still move it. |
| Does a touch drag on that handle pump, or scroll the page? | measured: it pumps (emulated Pixel 7, CDP touch events) | With `touch-action: none` on the range a 92 unit drag moved the handle to 0.94 of its stroke with no `pointercancel` and no scroll, and took the tyre from 2.00 to 2.12 bar. |
| Is `:active` enough for a button that must be held? | measured: no by touch | A touch held for 600 ms on the release cap let no air out when the control tested `button.matches(':active')`. With a flag set from `pointerdown`, `pointerup`, `pointercancel`, `keydown` and `keyup` the same touch took 2.2 bar to 0.7. |
| Does the pump follow Boyle's law? | measured: yes | From 1.0 bar one stroke added 0.17 bar, and from 4.0 bar 0.13. Half a stroke at 4.0 bar added 0.00, because the cylinder had not reached the tyre's pressure. |
| Do heavier strings ring lower? | measured: yes | With one tension, the middle of the 100 weight string crossed its rest line 120.8 ms after a pluck and the 900 weight string after 329.2 ms. The ratio is 2.72 and the square root of the ratio of their masses is 2.55. |
| Can radios and labels made in script be drawn? | measured: yes | They are appended to the canvas with the `drawable` attribute. A label is drawn as a picture, and its radio is placed over its ring and its string with an alpha-0 draw 232 by 44 units. |
| Does a `<select size>` keep its option styles in its picture? | measured: yes | `option:checked` with `background: #ff6a3d linear-gradient(#ff6a3d, #ff6a3d)` draws orange whether or not the list has focus. `elementFromPoint()` over the first row answered the `<option>`. |
| Are the buttons of a drawn table hit in their cells? | measured: yes | One draw of the `<table>`. The point at the dimple of the 14th answered that day's button. |
| Does a `<button>` place its text at the top when it is `display: block`? | measured: no | A button centres its content vertically even with `all: unset; display: block`. `display: flex; align-items: flex-start` put the day number at the top of the cell. |
| Can the display lag the value? | measured: yes | 200 ms after a click on the 14th the form had `date=2026-12-14`, the header still read 5 and the ball was in the air. After a click on the fifth candle the form had `evening=5` while three candles were lit. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the pump's five elements were in a plain box, and typing 4.2 gave `tyre=4.2`. |

## Things that bit

- The probe never settled. It was steered toward the velocity of a circular orbit with a first-order lag, and a lag on a direction that rotates leaves a constant error outward, so it circled about 6 units outside the orbit and the control drew for ever. Inside 7 units of the orbit it now switches to an exact circular orbit and eases the radius, does one lap and parks.
- The live checks have a 4 s limit each. The orbit and pump checks set `timeout`.
- The day numbers sat in the middle of their dimples until the buttons were made flex containers (above).

## Not verified

- Everything on a phone: touch on each control, the drag on the pump handle, holding the release cap (a long press may open a context menu, which the control cancels), and the frame rate of the candles with five smoke trails drawn through `ctx.filter = blur()`.
- What a screen reader says for each control. The radios of the strings and the candles sit in a canvas with `role="radiogroup"`. The calendar is a table of buttons with `aria-pressed`, not a grid.
- Whether typing in the number field on a phone keyboard works while the field is drawn inside the dial.

## For the index

- `/sim-controls/`: five ui-feed.dev demos rebuilt as native controls whose drawing is a simulation (pump with Boyle's law, wave equation strings, candles lit by their neighbours, orbital capture, bouncing ball). A model stepped in the paint handler stops when it is still.
- A button that must be held needs its own pressed flag: `:active` did not hold under an emulated touch.
- A `<button>` centres its content vertically even as `display: block`.

## Open ideas

- A month picker for the ball calendar: previous and next buttons, and the ball rolling off one sheet and onto the next.
- Sound: the strings have a frequency already, so each could play through Web Audio at the pitch the simulation gives.
- The remaining 63 demos on ui-feed.dev. The next candidates with a mechanism worth modelling: morse key (autocomplete), pendant lamp (hover card), record player speed (segmented control), tappets (toggle group), darkroom enlarger timer (number input).
