# Controls drawn into pictures over buttons, a file input, a treegrid, switches and ranges (`/scene-controls/`, `lib/ui-feed/scenes.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-26, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [scroll-controls.md](scroll-controls.md) and the files it lists. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these. The photos and the still life are painted by the canvas.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<coast-path>` | coast path waypoints (tooltip) | a `<button>` for each waypoint, and one `<div role="tooltip">` that each button names in `aria-describedby` |
| `<travel-journal>` | travel journal page (file input) | an `<h2>` cut into letters, a `<ul>` of photos (`<img>` for added files), a `<label>` round an `<input type="file" multiple>`, an `<output>` count and an `<output role="status">` |
| `<backup-log>` | overnight photo backup (waterfall) | a `<table role="treegrid">` with `aria-level`, `aria-expanded` and `aria-selected` on its rows, and an `<output>` for the chosen job |
| `<hob-lock>` | hob child lock (switch) | two `<input type="checkbox" role="switch">`, a `<fieldset>` of the hob's buttons and zone radios that the lock disables, and a lock `<button>` held for three seconds |
| `<cutting-mat>` | cutting mat (image cropper) | four `<input type="range">` for left, top, width and height, an empty `<div>` that takes drags, an `<output>` for the size |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a tooltip card spring out of a drawn waypoint? | measured: yes | Focused, the card read the waypoint's name; 40 ms later its spring was at 0.38 and 700 ms later 1.00. Escape hid it, and a click pinned it so it stayed when the pointer left. |
| Can a file input be a drawn drop zone that sends its files? | measured: yes, with a DataTransfer | A picture and a text file put into the input gave 2 photos, "1 file accepted. notes.txt is not a JPG, PNG or WebP.", and the form sent `photos=harbour-at-noon.png`. The new photo was 213 units above its place 60 ms later and had landed at 1.5 s. |
| Can the rows of a treegrid be drawn sliding when a job closes? | measured: yes | Down and Right went into the first child, Left back out. A second Left hid 2 rows; 30 ms later the next row was drawn at 125.9 on its way from 144 to 96. |
| Does a disabled fieldset turn the hob's keys off? | measured: yes | Locked, + changed nothing. Holding the lock key: still locked at 1.5 s, unlocked at 3.2 s, and two clicks on + gave `hob=relock zone1=2`. |
| Can four ranges hold a crop box that a drag moves? | measured: yes | A drag of 40 from the right edge made it 160 wide. A drag of 300 from the middle stopped on the picture's edge (left 132, the Left range's max 132). The Height range at 200 gave "4.0 × 5.0 in". |
| Do touches work? | measured: yes (emulated Pixel 7, CDP touch events) | A tap showed the card. Two taps on Upload chose it and closed it (4 rows hidden). On the hob a tap on minus did nothing while locked, a 3.3 s hold on the lock key unlocked it, then + gave `zone1=1`. Drags moved and resized the crop box. Vertical swipes on the map and the journal scrolled the page by 165 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the switches and the hob's keys were plain HTML, and a click on the first switch locked it and disabled the fieldset. |
| Do the controls stop painting? | measured: yes | 0 paint events in 500 ms at rest for each of the five. |

## Things that bit

- A `<ul>` whose items are all `position: absolute` has no height, so its picture was empty until it was given one.
- The footer of the backup is a grid of spans, so its `textContent` runs together; the check joins the children.
- The town names and the card fell back to a serif in the test browser when the hand fonts were missing and the last family was `cursive`. The list now ends in `sans-serif`.

## Not verified

- Everything on a phone.
- A real drag and drop of a file onto the drawn input, and the file picker opening from a tap on it.
- What a screen reader says for each: a table given `role="treegrid"`, a tooltip that is also pinned by a click, a fieldset that is disabled.
- The fonts. The originals use a hand, a cut-out display face, a terminal font and a grotesque.

## For the index

- `/scene-controls/`: five ui-feed.dev demos rebuilt as controls inside a picture (coast path, travel journal, photo backup, hob child lock, cutting mat).
- A file input stretched over a drawn drop zone takes clicks and files, and the control sends them as a `FormData`.
- A `disabled` fieldset is a quick way to turn off every native key of a drawn appliance at once.
- One element can be drawn as many moving slices (a list as tossed photos, a table as rows on springs); put its hit region back when they stop.
