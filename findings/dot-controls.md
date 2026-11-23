# Controls rebuilt from ui-feed.dev (`/dot-controls/`, `/switch-models/`, `/glass-controls/`, `/flap-controls/`, `lib/ui-feed/`)

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

## Glass, fog and light (`/glass-controls/`, `lib/ui-feed/glass.js`)

| Question | Result | Reason or detail |
|---|---|---|
| Can a fragment shader run over an element's picture when the shader's canvas cannot hold the element? | measured: yes, through a copy | The control draws the elements into its own drawable 2D canvas, copies that rectangle into a plain canvas with `drawImage()`, and the shared WebGL 2 context in `lib/glass-gl.js` uploads the plain canvas with `texImage2D()`. The glass over the `<select>` refracts a drawn `<div>` of CSS gradients: inside the rim 173,205,228 where just outside is 44,43,42. |
| Does it need a readback? | measured: no | `check:jank` reports `reads 0` on the page. `drawImage()` from a drawable canvas is allowed and is not a read. |
| Does `ctx.filter` apply to a `drawImage()` of the canvas's own pixels? | measured: yes | The fog is the pane drawn back over itself through `blur(9px) brightness(1.06)`. Over a letter the fogged pane is 247,251,252 against 215,227,232 on blank glass (76 of 765), and 0,0,0 after a wipe. |
| Can a password input's own picture show the characters? | measured: no | The wiped part draws a second `<input type="text" readonly aria-hidden tabindex="-1">` with the same value, clipped to the fresh wipe discs. |
| Does an `<input type="range">` that is never painted still drag? | measured: yes | Three controls place a range with `hit()` and draw their own track and thumb. The point over the spectrum bar answers `input[type=range]`, and the arrow keys move it. |
| Does a native `<select>` drawn under the glass take the click? | measured: yes (the picker itself is not shown in headless) | The middle of the drawn pill answers `<select>`, and `change` reaches the form. |
| Can `shade()` draw a panel with no background at all? | measured: yes | The foil is computed from hue, saturation, brightness and tilt uniforms, with no source canvas. 24 frames a second through `static fps`. |

## Flaps, blinds and decks (`/flap-controls/`, `lib/ui-feed/flaps.js`)

| Question | Result | Reason or detail |
|---|---|---|
| Can half an element's picture, squashed, stand in for a split flap? | measured: yes | The drum is a `<span>` drawn three times a frame: the bottom half in a clip, the top half in a clip, and the turning half inside `ctx.scale(1, k)` with the hinge as the origin. The element's `textContent` is swapped at the halfway point of the turn. A pixel a quarter of the way down the drum differs by 24 of 765 between rest and mid-turn. |
| Can one tall element be drawn through a window as a roller blind? | measured: yes | A 360 px `<div>` of destinations drawn into a 150 px window with `multiply` over a yellow fill. Rolling from stop 1 to stop 2 changed the window by 1,694 over 288 samples. |
| Is a `<select>` with `opacity: 0`, placed with `hit()` over the window, still the control? | measured: yes | The middle of the window answers `<select>`, `change` fires, and the value reaches the form. |
| Can `drawElementImage()` be passed an element that has no `drawable` attribute? | measured: no | C157 throws `Descendants passed to DrawElementImage must have the 'drawable' attribute`. The lift's two call buttons are drawn as the one `<nav>` that holds them. The base class puts the attribute on the canvas's children only. |
| Does `drawable` on a slotted element give it a picture? | measured: no (it gives it a hit region) | With the attribute on a slotted `<section>`, points over the drawn card answered the section instead of the canvas, but the draw itself stayed empty, with the attribute set in `connectedCallback`, a frame later, and removed and set again. |
| How are slotted pages drawn then? | measured: as a slice of their slot's host | The `<div>` the slot sits in is a child of the canvas, so it can be drawn: the whole stack of pages at once, offset by the height above the page that is wanted and clipped to the card. |
| Are the elements inside a drawn picture hit where that picture put them? | measured: yes | The checkbox on the third card of the deck, which is drawn inside a rotate, a translate and a scale, answers and ticks at the point the transform put it (84, 113 in the control's units). |
| What does `getBoundingClientRect()` report for an element the canvas has drawn? | measured: the draw, in device pixels | Measuring the slice that way fed each frame's drawn size back into the next draw: the card grew by about 2.6 a frame and saturated at about nine times its size. `offsetTop`, `offsetLeft` and `offsetWidth` report the layout and are not affected. |
| Does rebuilding the pagination `<nav>` on every page change lose focus? | measured: yes | The focused button is removed with the old markup. The control remembers `activeElement.dataset.p` and focuses the same button, or the current page's, after writing the new `<nav>`. |

## Things that bit

- The inner `<form>` that vanished (above). The controls worked alone and broke when the page wrapped them in a form to show `FormData`.
- The fixture stage of `runTests()` is a fixed box at the bottom left with `opacity: .02` and the highest `z-index`. While checks ran on load it took real clicks meant for the demo above it. Both pages have `<meta name="checks" content="tap">`.
- `dotBoard()` first used the requested cell size for the reduced draw and the rounded device size for the board, so the right edge of each element was cut off at device scale 2.625. Both now use the rounded size.
- An element screenshot from Playwright with a `viewport` set is taken at scale 1 even with `--force-device-scale-factor`. Use `viewport: null`.
- `shade()` in `lib/glass-gl.js` gives a shader `sdBox(p)`, not `sdRound(p, r)`. The foil shader did not compile until it used that name, and the failure is quiet: `shade()` returns null and the control draws its 2D version.
- A `const` arrow function used by a class method above it throws "cannot access before initialization" only when the method runs, so the foil picker drew nothing until `hsbToHex` became a function declaration.
- `put()` swallows the exception from a draw of an element without `drawable`, so a missing picture looks like a picture that has not been painted yet. The error text is the thing that says which it is: print it once while building a control that draws anything but a direct child of the canvas.
- Measuring a drawn element with `getBoundingClientRect()` and using the result as the next draw's size (above). The picture looked right for one frame and then grew.
- The two pagers' pages are the author's markup, so their height has to come from the component: without a height on `::slotted(section)` the next page's heading showed under the card.

## Not verified

- Everything on Chrome on Android: touch on the drawn switches and rows, the native date and time pickers, the on-screen keyboard over the teletext input and the counter.
- Frame rate. The VCR picture redraws 20 times a second while on screen, and each frame is a `drawElementImage()`, two `drawImage()` copies and 66 band draws. In the test browser the page had 2.9 s of long tasks in 6 s before the limit was added.
- What a screen reader says for the switches and the rating.
- Whether the text caret is missing from the picture on a real GPU build, or only in headless.

The glass page:

- Whether a tap on the drawn pill opens Chrome's own select picker on Android, and whether wiping the fog by touch scrolls the page.
- The look of the glass on a real GPU. The test browser renders WebGL in software (`--enable-unsafe-swiftshader`).
- The frame rate of the foil on the phone.

The flap page:

- Whether a tap on the blind opens Chrome's own select picker on Android.
- Whether the flap turn holds 60 frames a second on the phone. It is three `drawElementImage()` calls a drum a frame while a drum is turning.
- Whether dragging across a card scrolls the page by touch rather than being taken by the canvas (`touch-action: manipulation`).

## For the index

- Custom elements and slots: a `<form>` in a shadow root's `innerHTML` is dropped when the host is inside a form (C157).
- Custom elements and slots: bare slotted text drawn in a shadow canvas is a working `<label>`; the click path starts at the slot.
- Drawing: a reduced `drawElementImage()` plus a `drawImage()` copy gives a per-cell picture with no readback (dot boards, pixelation).
- Hit testing: an unpainted control (`opacity: 0`, drawn at `globalAlpha = 0`) is hit at the draw rectangle, at any size.
- Text: the caret is not in a textarea's picture in C157 headless.
- WebGL: a fragment shader can run over an element's picture through a `drawImage()` copy into a plain canvas, with one shared context for the page.
- Drawing: `ctx.filter` applies to a `drawImage()` of the canvas's own pixels, which is how the fog is made.
- Drawing: `drawElementImage()` refuses an element without the `drawable` attribute (`Descendants passed to DrawElementImage must have the 'drawable' attribute`), so a descendant is drawn by drawing the ancestor that has it.
- Custom elements and slots: `drawable` on a slotted element gives it a hit region but no picture in C157; draw the element the slot sits in and offset it.
- Hit testing: the elements inside a drawn picture are hit where the picture put them, through a rotate, a translate and a scale.
- Drawing: `getBoundingClientRect()` of a drawn element reports the draw in device pixels; measure layout with `offsetTop` and `offsetWidth`.

## Open ideas

69 of the 89 ui-feed demos are not rebuilt yet. Next groups by technique: light (pendant lamp hover card, candles rating), print (two-colour wall calendar, kinetic poster tabs, crossword OTP, paint chart), and departures boards (station departures pagination, best-before code on a can).
