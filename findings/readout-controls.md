# Meters, progress and ranges drawn as readings (`/readout-controls/`, `lib/ui-feed/readouts.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-23, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [dot-controls.md](dot-controls.md), [sim-controls.md](sim-controls.md), [mech-controls.md](mech-controls.md) and [gauge-controls.md](gauge-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<moon-calendar>` | lunar month (calendar) | `<table role="grid">` with a `<button aria-pressed>` for each of 42 days, two `<button>`s for the month, an `<output>` |
| `<fill-progress>` | measured fill (progress) | `<progress>`, a `<button>` under the knob, an `<output role="status">`, slotted text |
| `<storage-meter>` | storage freed (meter) | a `<meter>` for the total, a `<meter>` and an `<output>` for each `<option>`, a `<button aria-pressed>` for each option with `data-clear` |
| `<forecast-slider>` | forecast (slider) | `<input type="range">` under the thumb, an `<output>` for the temperature, slotted place name |
| `<walk-circle>` | walk to stop (slider) | `<input type="range">` under the handle on the circle, an `<output>` for the count, slotted place name |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does one draw of a table place every button in it? | measured: yes | 9 of 9 cells tried, from the first to the 38th of 42, answered their own button through `elementFromPoint()`. A click on the fourth row, fourth column gave `night=2026-11-25`. |
| Do the quarters fall on the right days? | measured: three of four | November 2026 came out as last quarter on the 2nd, new on the 9th, first on the 17th, full on the 24th. An almanac has the last quarter on the 1st. The control uses the mean length of a cycle from one known new moon. |
| Do the moons run on when the month changes? | measured: yes | Pressing next showed December with the phases starting 28 days back, and they ran forward to rest. 0 paint events in 300 ms at rest. |
| Does the fill slow into the measure? | measured: yes | 1.5 s after the press: 2.3 oz at 1.70 oz a second. Past 7.9 oz the flow was 0.88. It stopped at `poured=8.0` with the progress element at 8 of 8, the status "Done" and the button named "Empty". |
| Does clearing run the total down? | measured: yes | The form had `used=50.4` at once. The total meter read 63.2 after 250 ms and 50.4 at rest, and the row's own meter read 0. |
| Does a restyled `<meter>` keep its style in its picture? | measured: yes | `appearance: none` with `::-webkit-meter-bar` and `::-webkit-meter-optimum-value` draws a white bar 3 px high on a grey track. |
| Does the temperature follow the thumb? | measured: yes | Dragged from 12:00 (16 degrees) to 13:30, half way to a forecast of 20: `time=13:30`, the figure settled on 18.0, and the range's `aria-valuetext` was "13:30, 18.0 degrees". The figure trailed the thumb while it moved. |
| Can a range hold a day that ends at 00:00? | measured: yes | The last option is 00:00, which the range holds as 1440 minutes and the form gets as `00:00`. |
| Can a range's handle ride a circle? | measured: yes | The range was under the handle at 8 minutes. Dragged to 128 units from the centre it gave `walk=16`, 13 stops in place of 2, and its hit region was at the new radius. |
| Do touch drags move the thumb and the handle, or scroll? | measured: they move (emulated Pixel 7, CDP touch events) | Forecast 16:20 to 11:20 and walk 12 to 17, with no `pointercancel` and no scroll. Taps chose a day, started and stopped the fill, and cleared a category. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the table and its 42 buttons were in a plain box, and a click on the 3rd gave `night=2026-11-03`. |

## Things that bit

- A `<progress>` with no `value` is indeterminate. Its animation raised 12 paint events in 1.5 s on a control at rest, with the element drawn at alpha 0, and `check:jank` counted 6,876 ms of long tasks in 6 s at four times CPU slowdown. The control never set the value because `progress.value` already reads 0. With `value = 0` set at the start: 0 paint events and 643 ms.
- The first calendar had five rows. A month of 31 days that starts on a Saturday needs six, so the table always has 42 cells.
- The flow lags the valve, so the first reading "past 7.8 oz" was still 1.05 oz a second. The check reads it past 7.9.
- Text along a small circle crowds. With the radius at 32 units the lettering ran into itself, so the page sets the least walk to 5 minutes.

## Not verified

- Everything on a phone: tapping a day in a cell 48 units wide, dragging the thumb and the handle on the map, and pressing the knob.
- What a screen reader says. The progress element, the meters and the outputs hold the values the canvas draws, but I have not listened to them.
- Fonts. The month name is a Didone face where the device has one. The test browser used a plain serif.
- The true phase of the moon for dates far from 2026. The mean cycle drifts by up to about half a day.

## For the index

- `/readout-controls/`: five ui-feed.dev demos rebuilt as native controls that show a reading (lunar month, measured fill, storage freed, forecast, walk to a stop).
- One `drawElementImage()` of a `<table>` places the hit regions of all 42 buttons in it, and drawing over the picture afterwards does not take their clicks.
- An indeterminate `<progress>` inside a drawable canvas raises paint events for as long as it exists, even drawn with no alpha. Give it a value.
- A `<meter>` restyled with `::-webkit-meter-bar` and `::-webkit-meter-optimum-value` is drawn with that style.

## Open ideas

- A better phase: a few terms of the moon's true longitude would put every quarter on its day.
- Hold the knob to pour, in place of press to start, with the valve closing when the finger lifts.
- A real map from the page author: an `<img>` or an SVG slotted into the walk circle, drawn twice with two filters.
- The remaining 48 demos on ui-feed.dev.
