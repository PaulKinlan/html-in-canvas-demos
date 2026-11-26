# Controls made of rows over a table of radios, a fieldset of radios, checkboxes and a file input (`/row-controls/`, `lib/ui-feed/rows.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-26, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds four more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [scene-controls.md](scene-controls.md) and the files it lists. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these. The shop name, the file names and the notes are my own.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<load-waterfall>` | homepage figure (waterfall) | a `<table>` with a `<caption>`, a radio in each row header, a timeline column whose cells hold the timings as transparent text, and an `<output>` for the chosen request |
| `<speed-list>` | playback speed (listbox) | a `<fieldset>` and `<legend>` with an `<input type="radio">` in a `<label>` for each speed |
| `<flavour-list>` | flavours (multiple select) | a `<fieldset>` and `<legend>` with an `<input type="checkbox">` covering each row |
| `<file-stack>` | stacked file list (file input) | a `<ul>` with a remove `<button>` in each `<li>`, a `<label>` round an `<input type="file" multiple>`, and an `<output role="status">` |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a table of radios carry a drawn waterfall? | measured: yes | The point over the second row was its radio. A click gave `request=script` and the output read 1.16 s. The bars replay the load on a clock, which was at 0.03 s after the first frames and stopped at 3.41 s two seconds later. |
| Does a squeezed picture keep its hit region? | measured: yes, once it is put back | Each number is drawn at 60% of its width with `scale(0.6, 1)`, over the fieldset drawn with the numbers cut out. The last draw is the fieldset with no alpha at its laid-out place. The point over the fourth number was its radio; a click gave `speed=2`, the dot was at 134.7, 184.0 at 60 ms and 256.7 at 960 ms. |
| Can a tick be drawn along its path as a checkbox changes? | measured: yes | A click on Strawberry gave `flavour=pistachio flavour=strawberry`; its tick was 29% drawn at 60 ms and whole at 760 ms. A second click cleared it. |
| Can rows drawn at different scales keep their buttons in the corner? | measured: yes, at rest | With three files the point over the second X was "Remove Plan.png". A click closed the row (53.7 of 90 tall at 80 ms), and at 1.3 s the two rows were 120 tall and the point over the second X was "Remove Keys.jpg". |
| Do files put into the input join the list? | measured: yes, with a DataTransfer | Two files gave five rows of 60, the form sent all five and the status said "2 files added.". The bottom row was still the file input. |
| Do touches work? | measured: yes (emulated Pixel 7, CDP touch events) | Taps chose Cart API and, on the bar area, Script bundle; chose 2×; added Mango; removed Floorplan.png ("Floorplan.png removed."). A vertical swipe on the file list scrolled the page by 165 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the radios of the speed list were plain HTML, and a click on the last gave `speed=2`. |
| Do the controls stop painting? | measured: yes | 0 paint events in 500 ms at rest for each of the four. |

## Things that bit

- The `<svg>` of a remove button took the hit, not the button, so `elementFromPoint` returned the svg. `pointer-events: none` on it fixed that.
- The squeezed draw of the first number was clipped with room above the row for its spring, and that room took in the legend, which was drawn again squeezed over itself. The clip now stops 2 units above the row.
- While file rows of different heights are moving, only the row drawn last has its button where it is drawn, because the `<ul>` has one hit region. They settle in about half a second, and at rest one scale holds every row.
- A row that has closed is taken out of the list in the next animation frame, not in the paint handler, so the layout doesn't change while the canvas is drawing.

## Not verified

- Everything on a phone.
- The file picker opening from a tap on the drawn bottom row, and a real drag and drop of files onto it.
- What a screen reader says for each: a table whose row headers are radios, a timeline cell with transparent text, a fieldset of checkboxes, the status after a removal.
- The fonts. The originals use a didone display face, a condensed grotesque, a text serif and a slab. Here they fall back to Liberation Serif, Inter, Liberation Serif and DejaVu Serif.

## For the index

- `/row-controls/`: four ui-feed.dev demos rebuilt as stacks of rows (homepage waterfall, playback speed, flavours, file list).
- A picture of an element can be squeezed with `ctx.scale(x, 1)` to fake a condensed face. Draw the element once more with no alpha at its own place to put its hit region back.
- One element drawn in two pieces at different places takes input where the last piece is drawn; draw the piece with the button last.
- An empty table column gives a drawing its room, and transparent text in its cells leaves the picture blank.
