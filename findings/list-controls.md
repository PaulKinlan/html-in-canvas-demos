# Lists drawn over text fields, checkboxes and radios (`/list-controls/`, `lib/ui-feed/lists.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-25, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [date-controls.md](date-controls.md), [picker-controls.md](picker-controls.md) and the files they list. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<language-select>` | language (select) | a `<details>` whose `<summary>` shows the language, holding a radio in a `<label lang>` for each `<option>`. A copy of the rows in white, `inert` and `aria-hidden` |
| `<bin-finder>` | which bin? (autocomplete) | an `<input type="text" role="combobox">` that is also the heading, a group of radios for the matches, an `<output>` for the bin. The bins are drawn by the canvas |
| `<set-list>` | setlist (token input) | an `<ol>` with a `<button>` for each song and an `<input type="text">` in the last row, and an `<output>` for the length of the set |
| `<retro-combo>` | 1990s desktop (combobox) | an `<input type="text" role="combobox">`, a `<button>` that shows every city, a group of radios, an `<output role="status">` |
| `<city-chips>` | two-color print (combobox) | a checkbox for each city, a `<button>` for each checked one, an `<input type="text" role="combobox">` with `aria-activedescendant`, an `<output>` for the count, and an `inert` copy of the buttons for the yellow ink |

The picker of a `<select>`, the list of a `<datalist>` and a popover are drawn in the top layer, and [elements.md](elements.md) records that a canvas has no picture of them, so none is used here.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a copy of a list be drawn only inside a moving bar? | measured: yes | The white copy is inert and hidden, with 4 rows and no radios. 70 ms after pointing at the fourth row the bar covered rows 1.64 to 3.27 (edges, in rows), stretched between its two springs; at rest both ends were on row 3, after 36 paint events. A click gave `lang=fr`, the summary read "Français" with `lang="fr"`, and the list closed. |
| Can a text field filter radios as a combobox does? | measured: yes | "bat" left the rows Batteries and Bath toy, with "Bat" in bold and `aria-expanded="true"`. Enter gave `item=batteries` and closed the list. "zzz" gave "Nothing called that" and an invalid form, through `ElementInternals.setValidity()`. |
| Can shapes the canvas draws move with what is typed? | measured: yes | 700 ms after "bat" the two bins that hold the matches were drawn at full strength and the paper and glass bins at 0. After the choice the ring of the recycling centre grew to 150 units. |
| Can a list of buttons and a text field be a token input? | measured: yes | Delete on a song gave the new form data and set length at once and moved focus to the next song. "Encore 4:10" and Enter added a song, and Backspace in the empty field went to the last song. The form value is a `FormData` with one entry for each song. |
| Can a removed row be drawn leaving while the rest close up? | measured: yes | The row is taken out of the flow (`position: absolute`, `inert`) and stays in the DOM while it is drawn peeling. The next row's box went up 34 units at once; 120 ms later it was drawn at 46 on its way to 34, and at rest the leaving row was gone. |
| Can the list unroll in steps? | measured: yes | While it opened, the drawn part of the list took the steps 0, 2, 3 and 4 of 4 in samples 16 ms apart. |
| Does `hidden` hide a row? | measured: not by itself | `.list label { display: block }` in the control's style overrides the `hidden` attribute, so every row stayed after filtering, in the first screenshots. The rule `label[hidden] { display: none }` fixed it. |
| Can checkboxes and buttons make a multi-select combobox? | measured: yes | "pa" left Paris, and Enter checked it: `city=Lima city=Oslo city=Paris` (03/05). The Lima button unchecked Lima, and Backspace in the empty field the last one chosen. |
| Can an inert copy carry a second ink that slips? | measured: yes | 40 ms after a change the yellow copy was 2.5 units from where it rests, and at rest it was at (−3, 0). Both are drawn with `multiply`. |
| Do taps and typing work by touch? | measured: yes (emulated Pixel 7, CDP touch events) | Taps opened the language list and chose Français. A tap in the bin field, typing "jar" and a tap on the row gave `item=jam-jar`. A tap on the empty strip and typing "Encore 4:10" and Enter added the song, and a tap on a song and Delete took it off. Taps on the button and a row gave `city=Portland`. Taps on the cities field and a row checked Cairo, and a tap on the Lima button unchecked it. Vertical swipes of 180 units on two controls scrolled the page by 165 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the details with its 4 radios was in a plain box, with the white copy hidden (the controls listen for `feed-plain`). |
| Do the controls stop painting? | measured: yes | 0 paint events in 500 ms at rest for each of the five. |

## Things that bit

- A `<button>` with `display: flex` and a top margin inside an `<li>` of fixed height: the margin collapsed through the `<li>`, so the rows were 37 units apart instead of 34. `display: flow-root` on the `<li>` stopped it.
- A copy of the content made for the drawing shows in the plain fallback as a second list. The copies are hidden on `feed-plain`.
- A click from a script on a `<label>` has `detail` 0, as a click that an arrow key sends does, so the controls that close only on a real click can't be closed that way from a check. The checks use Enter instead.

## Not verified

- Everything on a phone.
- The on-screen keyboard: where the caret goes in the heading field of "Which bin?", Enter as `enterkeyhint="done"` in the setlist, and whether Backspace in an empty field is sent at all by every keyboard.
- What a screen reader says for each: the combobox roles are on text fields that control a group of radios or checkboxes, not a `listbox`, and the activedescendant of the cities points at a `<label>`.
- The fonts. The originals use a marker hand, a pixel font and a grotesque. The test browser had none of them, so the setlist and the 1990s window are in fallbacks.

## For the index

- `/list-controls/`: five ui-feed.dev demos rebuilt on a details of radios, a text field that filters radios, a token input of buttons, a combobox of a text field, a button and radios, and a multi-select of checkboxes and buttons (language, which bin, setlist, 1990s desktop, two-colour cities).
- A row leaving a list can be drawn leaving: take it out of the flow with `position: absolute` and `inert`, draw it until its animation ends, then remove it.
- The `hidden` attribute loses to any `display` the component's style gives the element. Add `[hidden] { display: none }` for the rows a filter hides.
