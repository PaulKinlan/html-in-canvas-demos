# Controls rebuilt from ui-feed.dev (`/dot-controls/`, `/switch-models/`, `lib/ui-feed/`)

Measured in C157 (the headless test browser, software rendering, device scale 2.625, 412 px wide) on 2026-11-23. Nothing here has been run on a phone.

The pages rebuild demos from <https://ui-feed.dev/> (89 React components on 2026-11-23) as custom elements with native elements inside a drawable canvas. Each demo links to its original. The code, copy and drawings are new. No source, picture or font was taken from the originals.

## The base class (`lib/ui-feed/kit.js`)

| Question | Result | Reason or detail |
|---|---|---|
| Can a custom element hold a drawable canvas in its shadow root, with native controls as the canvas's children? | measured: yes | 12 elements. `content="drawable"` and `layoutsubtree` on the canvas, `drawable` on each child. |
| Can the children be laid out at a fixed design size while the canvas is narrower? | measured: yes | Children are `position: absolute` at 0,0 and 360 wide. The context is scaled by `canvas.width / 360` and every draw passes the element's `offsetWidth` and `offsetHeight`. At 334 CSS px wide the hit regions matched the drawing. |
| Can the component's CSS be kept off the plain fallback? | measured: yes | The rules are nested under `canvas { … }`. After a `contextlost` event the children are moved out of the canvas and show as unstyled controls. |
| Does a `<form>` in the shadow root's HTML survive when the host is inside a form? | measured: no | `shadowRoot.innerHTML = '<canvas><form>…'` dropped the `<form>` element when the host had a form ancestor. The parser does not nest forms and the fragment parser counts the host's form. The controls use a `<div>`. |
| Does the form get the value? | measured: yes | `ElementInternals.setFormValue()`, with a `FormData` for the controls that hold several values. `FormData` of the outer form had the entries. |

## Dot and tube displays (`/dot-controls/`, `lib/ui-feed/dots.js`)

| Question | Result | Reason or detail |
|---|---|---|
| Can an element be turned into a board of dots with no `getImageData()`? | measured: yes | Draw the element with a transform that makes one cell one device pixel, copy that corner to a plain canvas with `drawImage()`, enlarge with smoothing off, mask with a pattern of discs using `destination-in`, draw back. `reads 0` in `check:jank`. |
| Is text readable at one pixel a dot? | measured: from about 7 dots of cap height | 16 px text at a 2.3 px cell ran together. 22 px and up read as a dot display. |
| Do CSS states show on the board? | measured: yes | `:has(:checked)`, `:has(:disabled)`, `:focus-visible` and `::selection` colours all came through, because the board is a picture of the styled element. |
| Where is the hit region after the reduced draw? | measured: where the last draw put it | A second draw with `globalAlpha = 0` at the board's place. `elementFromPoint()` at the middle of each row answered that row's radio. |
| Can a slotted table be paged without changing it? | measured: yes | Each line is a clip and a draw of the slot's wrapper, moved by the row's `offsetTop`. 12 rows, none hidden. |
| Can a shadow tree style the cells of a slotted table? | measured: no | `::slotted(table)` reaches the table. Column widths and `th` alignment came from the page's stylesheet. |
| Are radios in a shadow root with one name and no form a group? | measured: yes | Checking one cleared the others, and ArrowLeft moved the rating from 4 to 3. |
| Are date and time fields edited where they are drawn? | measured: yes with a mouse | A click on the drawn minutes field focused it, and typed digits went in. |
| Is the text caret in a textarea's picture? | measured: no | Not with `caret-shape: block` either. The counter draws a block cursor at a place measured with a hidden copy of the text. |

## Switches (`/switch-models/`, `lib/ui-feed/switches.js`)

| Question | Result | Reason or detail |
|---|---|---|
| Is an unpainted checkbox hit where the canvas places it? | measured: yes | `opacity: 0`, placed by a draw with `globalAlpha = 0`. Five switches, each answered `input[checkbox]` at the middle of its drawn part. |
| Does bare slotted text work as a label inside the canvas? | measured: yes | A mouse click on the drawn word had the path slot, label, canvas, shadow root, host, and the label clicked the checkbox. `elementFromPoint()` there answers the host. |
| Does `change` leave the shadow root? | measured: no | It is not composed. Each element dispatches its own from the host. |
| Does a switch at rest draw? | measured: no | 0 paint events in 300 ms after the spring settled. |

## Things that bit

- The inner `<form>` that vanished (above). The controls worked alone and broke when the page wrapped them in a form to show `FormData`.
- The fixture stage of `runTests()` is a fixed box at the bottom left with `opacity: .02` and the highest `z-index`. While checks ran on load it took real clicks meant for the demo above it. Both pages have `<meta name="checks" content="tap">`.
- `dotBoard()` first used the requested cell size for the reduced draw and the rounded device size for the board, so the right edge of each element was cut off at device scale 2.625. Both now use the rounded size.
- An element screenshot from Playwright with a `viewport` set is taken at scale 1 even with `--force-device-scale-factor`. Use `viewport: null`.

## Not verified

- Everything on Chrome on Android: touch on the drawn switches and rows, the native date and time pickers, the on-screen keyboard over the teletext input and the counter.
- Frame rate. The VCR picture redraws 20 times a second while on screen, and each frame is a `drawElementImage()`, two `drawImage()` copies and 66 band draws. In the test browser the page had 2.9 s of long tasks in 6 s before the limit was added.
- What a screen reader says for the switches and the rating.
- Whether the text caret is missing from the picture on a real GPU build, or only in headless.

## For the index

- Custom elements and slots: a `<form>` in a shadow root's `innerHTML` is dropped when the host is inside a form (C157).
- Custom elements and slots: bare slotted text drawn in a shadow canvas is a working `<label>`; the click path starts at the slot.
- Drawing: a reduced `drawElementImage()` plus a `drawImage()` copy gives a per-cell picture with no readback (dot boards, pixelation).
- Hit testing: an unpainted control (`opacity: 0`, drawn at `globalAlpha = 0`) is hit at the draw rectangle, at any size.
- Text: the caret is not in a textarea's picture in C157 headless.

## Open ideas

77 of the 89 ui-feed demos are not rebuilt yet. Next groups by technique: glass and fog (fogged glass password, spatial glass select, hologram and prism colour pickers), flaps and blinds (tumble calendar, riffle pagination, destination blind, lift indicator), light (pendant lamp hover card, candles rating), print (two-colour calendar, kinetic poster tabs, crossword OTP, paint chart).
