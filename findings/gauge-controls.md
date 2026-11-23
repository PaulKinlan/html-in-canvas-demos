# Sliders and number fields with a scale to read (`/gauge-controls/`, `lib/ui-feed/gauges.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-23, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [dot-controls.md](dot-controls.md), [sim-controls.md](sim-controls.md) and [mech-controls.md](mech-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<fader-bank>` | console fader | for each `<option>`: an `<input type="range">` under the cap, a `<label for>` on the tape, an `<output for>` as the readout |
| `<tuner-slider>` | hi-fi tuner (slider) | `<input type="range">` under the slide, two `<output>`s for the frequency and the station |
| `<barbell-number>` | weight on the bar (number input) | `<input type="number">` over the figures, two `<button>`s, an `<output>` for the plates, slotted title |
| `<curtain-drop>` | curtain drop (number input) | `<input type="number">`, two `<button>`s, three `<output>`s (note, detail, price), slotted cloth name |
| `<objective-turret>` | microscope objective (segmented control) | four `<input type="radio">` with a `<label for>` each, an `<output>` for the field of view, slotted specimen name |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a horizontal range sit under a cap that moves vertically? | measured: yes | The range is 60 by 44 units, drawn with alpha 0 over the cap. `elementFromPoint()` at the middle of each of three caps answered that channel's range. |
| Does a drag move the cap along the printed scale? | measured: yes | Pointer events to the first range, ending at the height of the -20 mark, gave `mix-kick=-20.0` and the readout showed -20.0. 0.007 of the travel above 0 dB the detent gave 0.0. The keyboard ends are 10.0 and -inf. |
| Does the range under a held cap interfere? | measured: it sends `input`, which is ignored | An `input` event from the range while the pointer was down changed nothing. |
| Can one element submit several values? | measured: yes | `ElementInternals.setFormValue(FormData)` gave `mix-kick=-2.5 mix-vocal=-15.4 mix-keys=-8.0`. |
| Does a touch drag on a cap move it, or scroll the page? | measured: it moves (emulated Pixel 7, CDP touch events) | A 93 unit drag took the second channel from -15.4 to -51.3 dB with no `pointercancel` and no scroll. The range has `touch-action: none`. |
| Does the tuning slide coast? | measured: yes | Let go at 101.9 MHz moving at 14.0 MHz a second (the cap on its speed), it stopped at 105.4. By emulated touch a 2.5 MHz drag from 93.1 ended at 96.6. |
| Does a station pull the slide in? | measured: yes | Set to 97.2 with a station at 97.4, the form had `fm=97.4` 1.5 s later and the station's name was shown. 0 paint events in 300 ms at rest. |
| Does the number field drive the plates? | measured: yes | 315 lb is 45+45+45 on each end. Plus gave 320 as 45+45+45+2.5. Typing 135 gave 45, and three plates slid off. The bar dipped 4.2 units under three plates and rested at 2.2. |
| Do the curtains overshoot? | measured: yes | From 96 to 104 inches the hem reached 105.0 and the folds swung 0.8 units. The note went from "1 in above the floor" to "7 in on the floor" and the price from $600.44 to $646.00. |
| Does the turret pass the objectives between? | measured: yes | From 10 to 100 times the form had `objective=100` at once and the picture went 10, 40, 100. The light fell to 0% between objectives. The last picture arrived at 6% focus and reached 100%. |
| Does `ctx.filter = blur()` apply to `drawImage()` of a plain canvas onto the drawable one? | measured: yes | The out-of-focus view is one blurred copy. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s three ranges with their labels and readouts were in a plain box, and moving the second to 790 gave `mix-vocal=0.0`. |

## Things that bit

- The tuner drew for ever at a station. The step that pulls it in ended by calling the function that announces a change, which asks for a paint, on every frame. It now returns at once when the slide is on the station and still.
- A focused number field with `opacity: 0` still blinks its caret, and each blink is a paint event. The rest check for the barbell counted 1 until it blurred the field.
- `elementFromPoint()` answered nothing 348 units down a check fixture, because that part of the fixture is below the bottom of the screen. The turret check asks at 327, which is still inside the radio's hit region.
- `setPointerCapture()` throws for a pointer made in script. The handle code catches that, so the checks can drive a drag with `PointerEvent`s.
- The folds swung for 6 s after a change with the first damping. It is higher now and they rest in about 3.5 s.

## Not verified

- Everything on a phone: dragging a fader, flicking the tuning slide, typing a weight or a drop with the phone keyboard into a field that is not shown, and the frame rate of the blurred view.
- What a screen reader says. Each fader's range has `aria-valuetext` in decibels and the tuner's has the frequency and the station.
- Fonts. The handwriting and the Didone face are whatever the device has. The test browser fell back to a plain serif for both.

## For the index

- `/gauge-controls/`: five ui-feed.dev demos rebuilt as native controls with a scale to read (console faders, hi-fi tuner, weight on a bar, curtain drop, microscope objective).
- One form-associated element can submit several named values with `setFormValue(FormData)`.
- A focused field with `opacity: 0` raises a paint event at each caret blink.

## Open ideas

- Sound for the tuner: noise between stations and a tone on one, mixed by the signal strength the control already computes.
- A level meter beside each fader, fed by a page's own audio.
- Kilograms for the barbell, with the plate set as `<option>` children.
- The remaining 53 demos on ui-feed.dev.
