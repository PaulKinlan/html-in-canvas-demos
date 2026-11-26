# A sundial drawn over a time input (`/sundial-time/`, `lib/ui-feed/sundial.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-26, at 412 px wide and on an emulated Pixel 7 for the touch row. Nothing here has been run on a phone.

The page rebuilds the sundial time input (P-35) from <https://ui-feed.dev/>, which was added to the feed after the first 88 demos were rebuilt (see [small-controls.md](small-controls.md) and the files it lists). I looked at what the published demo does and built it again. No source, picture or font was taken from the original, which is far higher fidelity than this.

## Which native element it is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<sundial-time>` | sundial (time input), P-35 | an `<input type="time" min max step="60">`, and an empty `<div aria-hidden="true">` over the dial that takes drags |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does a drag on the dial set the time input? | measured: yes | A press on the 15:00 hour line set `15:00`, a drag to the 9:00 line gave `t=09:00`, and one `change` event reached the form at the end of the drag. |
| Does the shadow fall on the hour line for the time in the field? | measured: yes | After 16:30 was typed the drawn time was 12.13 h at 80 ms and 16.50 h at rest. The edge of the shadow, worked out from the sun's position, was 0.000° from the engraved 16:30 hour line. |
| Does the field's range reach the form? | measured: yes | 04:10 made the form invalid (`rangeUnderflow`); a press past the 19:00 line set `19:00`, the field's max. |
| Do touches work? | measured: yes (emulated Pixel 7, CDP touch events) | A drag across the dial gave `06:12`; a swipe beside the field scrolled the page by 55 px. A swipe on the dial doesn't scroll the page. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the field was a plain time input and typing in it gave `t=11:15`. |
| Does it stop painting? | measured: yes | 0 paint events in 500 ms at rest. |

## Things that bit

- `change` isn't composed, so a `change` from the field never reached the form around the host. The host now sends one of its own.
- The time input shows the browser's own format: "03:20 PM" in the test browser, 15:20 in the original. The value is always 24-hour.
- A gnomon drawn at its true height for 51.5° is taller and thinner than the original's.

## Not verified

- Everything on a phone, including the time picker Android opens from the field and whether it opens from a field drawn in a canvas.
- What a screen reader says for the field inside the canvas.
- The fonts. The original uses a mono face that the test browser doesn't have.

## For the index

- `/sundial-time/`: the ui-feed.dev sundial time input rebuilt on `<input type="time">`, with the shadow worked out from the sun's position at that time.
- A drawn picture and a native value can be checked against each other when both come from the same formula: the shadow and the engraved hour lines agreed to 0.000°.
- An event a control re-sends for its form has to come from the host when the native event isn't composed (`change`).
