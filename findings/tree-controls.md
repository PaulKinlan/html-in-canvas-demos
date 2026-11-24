# Trees and timelines drawn from nested details and lists (`/tree-controls/`, `lib/ui-feed/trees.js`, `lib/ui-feed/timelines.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-24, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [dot-controls.md](dot-controls.md), [sim-controls.md](sim-controls.md), [mech-controls.md](mech-controls.md), [gauge-controls.md](gauge-controls.md), [readout-controls.md](readout-controls.md) and [disclosure-controls.md](disclosure-controls.md). I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<plant-tree>` | plant family on a cyanotype (tree) | nested `<details>` built from the author's nested `<ul>`, one drawable element for the whole tree. The value is the names of the open branches |
| `<file-tree>` | project files in an editor (tree) | nested `<details>` for folders, an `<input type="radio">` in a `<label>` for each file. The value is the path of the checked file |
| `<floor-guide>` | department store floor guide (tree) | a `<details>` for each floor with nested `<details>` for departments. One floor is open at a time |
| `<bloom-timeline>` | amaryllis from bulb to bloom (timeline) | one `<input type="range">` with a step for each stage, an `<output>` for the day |
| `<kiln-timeline>` | kiln firing programme (timeline) | an `<ol>` of `<button>`s, one for each segment, a `<time>` for each start and an `<output>` for the temperature |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a branch in the middle of one element's picture be drawn part open? | measured: yes | The canvas draws the whole tree once for each row, clipped to the row and moved up by what the closing branch has given back. 4 rows before and 7 after a click. At 130 ms the branch was 38% open: "Malus" was laid out 139 units down and drawn at 87.9. At rest every row was drawn where it is laid out and the tree went back to one draw. `open=Rosaceae,Prunus,Malus`. |
| Where is the hit region while a branch moves? | as built: at the layout position | The tree is one element, so a clipped draw moves its whole region. The last draw of the frame puts it back. What a tap answers on a row that is drawn above its box was not measured. |
| Does a radio inside the tree's picture answer its own point? | measured: yes | Started with `file=app/page.tsx`. The point on the second row answered the radio for globals.css, and a click gave `file=app/globals.css`. After the folder closed, the same point answered the summary "lib" and the form still had `file=app/globals.css`. |
| Can the rows share out a fixed height? | measured: yes, with the layout changed at rest | Three headings of 54.6 units, 163.8 in all. At 130 ms a heading was drawn 46.3 high and laid out 55 high. At rest it was drawn 34.6 and laid out 35.0, the guide was still 163.8 high, and the point on the next heading answered "2 Second floor: Womenswear". A click on it gave `floor=2` and closed the first. |
| Can the range be held between two steps? | measured: yes | The dates read Mon Nov 2, Wed Nov 11, Sun Nov 22, Sun Nov 29, Sun Dec 6. Held 0.4 of the way from the second stage to the third, the plant was at 1.39 and the figure read day 14, while the form had `day=10`. Let go at 0.7: step 2, day 21, "Tall bud", and the range's text is "Day 21, Sun Nov 22: Tall bud". |
| Does the kiln work out the same figures as the original shows? | measured: yes for the ones compared | The steps start at 06:30 12:14 15:34 17:42 17:57 23:21. At 7:22:09 the temperature works out as 1541.6. Run 600 times faster from 5:30:00, the form went from `segment=1` to `segment=2` with 1 `change` event and the output read "1116 °F". |
| How often does the kiln paint? | measured: 4 times a second | At its own speed. The output changes once a degree, and the display is asked to draw 4 times a second. |
| Do taps and drags work by touch? | measured: yes (emulated Pixel 7, CDP touch events) | Taps opened a genus, picked a file, closed a folder, opened floor 3, chose a date (`day=28`) and pressed step 5 of the kiln. A drag along the range gave `day=10` with 0 `pointercancel` events and 0 px of page scroll. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the nested details with their 3 radios were in a plain box. A click on the second radio gave `file=app/page.tsx`, and a click on the second summary opened it without the control. |
| Do the controls stop painting? | measured: yes for four | 0 paint events at rest for the three trees and the amaryllis. The kiln is a clock and paints 4 times a second. |

## Things that bit

- A layout change that the next picture needs can't be made in the paint handler. The floor guide sets a row height on the element to share out its height. Set inside the handler, the picture and the offsets were a frame apart and the rows jumped. It is set in an animation frame, at rest only, and removed when a floor is picked.
- `offsetHeight` is a whole number. A heading 34.6 units high reads 35, so a test for "drawn where it is laid out" never passed and the guide painted for ever. The tolerance is half a unit. The plant tree gives its rows whole-number heights.
- A slow spring never reaches its target. The amaryllis snaps to it when it is within a thousandth and nearly still.
- The kit's seven-segment text slants about the top of the canvas, so digits and colons were out of line on the kiln. The kiln has its own row of digits.
- A range that was dragged keeps focus, and the focus ring was drawn after every touch. The ring is drawn only after a key was pressed on the range.

## Not verified

- Everything on a phone.
- What a tap answers on a row during the 0.3 s that it is drawn above its box.
- What a screen reader says about a branch that is open in the element and drawn shut. The trees are nested `<details>`, so they have no `tree` role and no arrow keys. The originals expose tree items.
- Find in page opening a closed branch.
- Fonts. The originals use a typewriter face on the print, a serif on the floor guide and a segment face on the kiln. Mine are system faces and drawn segments.
- The amaryllis and the cyanotype print look like photographs in the originals. Mine are paths and gradients.

## For the index

- `/tree-controls/`: five ui-feed.dev demos rebuilt on nested `<details>`, radios, a range and a list of buttons (plant family, project files, floor guide, amaryllis timeline, kiln programme).
- A part of one element's picture can be drawn moving: draw the whole element once for each row, clipped to the row and shifted. Go back to one draw at rest.
- A layout change meant to match the next picture has to be made before the paint, in an animation frame or an event, not in the paint handler.
- `offsetHeight` rounds, so compare a drawn position with a layout position to half a unit.

## Open ideas

- Arrow keys and `role="tree"` on the trees, with the `<details>` kept for the opening.
- A hit region for each row during a move, by making each row a drawable child of its own. That gives up the single picture.
- A photograph for each stage of the plant from the page author, as `<img>` elements in a slot.
- The remaining 38 demos on ui-feed.dev.
