# Accordions and tabs drawn while they open (`/disclosure-controls/`, `lib/ui-feed/folds.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-24, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [dot-controls.md](dot-controls.md), [sim-controls.md](sim-controls.md), [mech-controls.md](mech-controls.md), [gauge-controls.md](gauge-controls.md) and [readout-controls.md](readout-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<note-accordion>` | fragrance notes (accordion) | a `<details>` with a `<summary>` for each `<option>` |
| `<trail-accordion>` | coast path map (accordion) | a `<details>` for each leg, holding a `<figure role="img">` named after the leg. The summary of the open leg has `aria-disabled` |
| `<order-summary>` | order summary (collapsible) | one `<details>` holding a `<ul>`, a `<dl>` and `<data>` elements for the prices |
| `<bus-tabs>` | bus stop timetable (tabs) | an `<input type="radio">` and a `<label>` for each day, a `<dl>` of departures for each, `inert` unless checked |
| `<poster-tabs>` | kinetic poster (tabs) | an `<input type="radio">` and a `<label>` for each period, two `<output>`s (the figure now and the one before, which is `inert`), a `<data>` for the change |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a canvas draw a `<details>` closing? | measured: yes, if the element stays open | A closed `<details>` has no content in its picture. The click on the `<summary>` is cancelled, the canvas clips the picture to less each frame, and `open` is removed when the drawn height is 0. 140 ms after the click the section was drawn 53% open with the attribute still set. At rest it was closed. |
| Does the form value wait for the drawing? | measured: no | The value changed at the click (`notes=Heart`, `summary=closed`). For the length of the animation (0.36 s or 0.5 s) the element is open while the control reports it closed. |
| Does the hidden part of a clipped `<details>` take clicks? | measured: not where the next section is | The element is drawn whole inside a clip, so its hit region is its full size. The point 30 units under the drawn edge of a half-closed section answered the summary below, which is drawn after it. |
| Is a `<details>` opened by a script followed? | measured: yes, after one fix | `details.open = true` on a closed section: the canvas painted before the `toggle` event arrived, and the first version closed the element again because it was drawing it shut. The control now keeps the state it last set and only closes an element it opened. |
| Can one leg always be open? | measured: yes | A click on the open leg left `leg=1`. A click on another opened it while the first folded, and the two eased amounts added up to 1.000 part way, so the control keeps its height. |
| How many map pictures are held? | measured: 2 during a change, 1 at rest | Each map is 360 by 208 units on a plain canvas at the control's scale. A closed leg's map is dropped and drawn again when it opens. |
| Does the order summary keep its content until the pictures are back? | measured: yes | Opened: `summary=open`, 278 units of content, the foot reads "Total €148.00 Including €23.63 VAT". 200 ms into the close it was drawn 55% open with `open` still set. |
| Do radios move the timetables? | measured: yes | A click on the third tab: the lists were 1.15 of the way across at 120 ms and at 2 at rest. `day=c`. |
| Are `inert` elements drawn, and can they be hit? | measured: drawn, not hit | The two lists that are not checked are `inert` and are drawn as they slide past. The point in the panel answered the checked day's `<dl>` before and after. |
| Is an element wider than the canvas drawn whole? | measured: yes | The output with "58,204" at 240 px is 902 by 240 CSS pixels in a control 360 wide. It was drawn at 0.36 of its width and 1.10 of its height and the figures looked sharp at device scale 2. "2.9M" was drawn at 0.52 of its width. |
| Does `ctx.filter` recolour a drawn element? | measured: yes | `brightness(0) invert(1)` drew the green heading of a leg in white inside the red band, and `invert(1)` drew a white day name in black on the paper tab. |
| Do taps work by touch, and does a swipe on a timetable scroll the page? | measured: yes (emulated Pixel 7, CDP touch events) | Taps opened a section, a leg and the order, and chose a day and a period. A vertical drag of 120 units on the timetable scrolled the page by 105 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the three `<details>` were in a plain box. The control gives them one `name`, so the browser keeps one open: a click on the second summary gave `notes=Heart`. |
| Do the controls stop painting? | measured: yes | 0 paint events in 300 ms at rest for each of the five. |

## Things that bit

- The paint that follows `details.open = true` runs before the `toggle` event. A control that closes any open element it is drawing at height 0 undoes the script's change.
- The route number on the bus stop is 104 px high. With a face that isn't condensed it ran under the stop name, so it's its own element and is drawn at no more than 98 units wide.
- `elementFromPoint()` answers nothing below about 340 units down a check fixture, so the walk check uses three legs and clicks the second.

## Not verified

- Everything on a phone.
- What a screen reader says while a section is open in the element and closed in the drawing, and whether the `aria-disabled` summary of the open leg reads well.
- Find in page opening a closed section. The `toggle` path was tested with a script only.
- Fonts. The originals use condensed sans and Didone faces. The test browser had neither, so the labels are an ordinary face drawn narrower.
- How sharp the stretched output is at device scale 2.625.

## For the index

- `/disclosure-controls/`: five ui-feed.dev demos rebuilt on `<details>` and radios (fragrance notes, coast path map, order summary, bus stop timetable, kinetic poster).
- A closed `<details>` has no content in its picture. To draw it closing, cancel the click on the summary, clip the picture to less each frame and remove `open` at the end.
- A paint event can arrive before the `toggle` event of the change that caused it.
- A direct child of a drawable canvas that is wider than the canvas (902 px in 360) is drawn whole, and can be drawn at any width and height.
- `inert` elements are drawn and take no hits.

## Open ideas

- Use `captureElementImage()` to keep the picture of the open content, so that the element can close at the click and the snapshot is what folds away.
- A real map from the page author: an `<img>` in each leg's `<figure>`, cut into the four panels.
- Swipe across the timetable to change day.
- The remaining 43 demos on ui-feed.dev.
