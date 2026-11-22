# Blocked ideas, tested (`/blocked/`)

Backlog group 29 in PLAN.md, ideas 29.1 to 29.6. Measured in headless Chromium 157 (C157) on 2026-11-22 at 412 px wide. The page's five live checks pass there, and `node tools/blocked/check.mjs` drives the six demos by touch (35 steps, all pass). Nothing here has been run on a phone.

The question: six ideas were marked as blocked by the browser. Are they still blocked in the browser that opens the page, and which other route works? Each section of the page runs the blocked route and its replacements and writes the result under the demo. Routes that read pixels wait for a tap.

| Experiment | Result | Why |
|---|---|---|
| 29.1: the picker of a base-select `<select>`, open over the canvas after `showPicker()` | blocked: 0 of 15 points on its rows have its colour in the canvas | The picker is in the top layer. |
| 29.1: `<select size="5">` drawn with a shear of -0.16 | works: pixel 0, 200, 0 inside it, `elementFromPoint()` on a sheared row gives the `option`, a touch tap chose Blue | A list box has no picker. Its rows are in its own picture. |
| 29.2: a PDF in `<embed>` and in `<iframe>`, each in a drawable block | not measured: `navigator.pdfViewerEnabled` is false in the test browser. 0 of 192 points per page have the PDF's colour | The embed draws its "Couldn't load plugin." text, which is in the picture. A tap in the middle of each page lands on the embed and on the iframe. |
| 29.3: `<img>` from a second origin, no `crossorigin` attribute | blocked: loaded (`naturalWidth` 40 in the probe), alpha 0 in the canvas, 0 of 3 in the demo | Left out of the picture. The canvas is not tainted and is told nothing. |
| 29.3: the same file with `crossorigin="anonymous"` and `Access-Control-Allow-Origin: *` | works: alpha 255, 3 of 3 | Both live hosts send the header for static files (checked with a request on 2026-11-22). |
| 29.3: knowing which pictures are left out with no readback | works | A different origin and `img.crossOrigin === null`. The wall draws the alt text on a hatched card there. |
| 29.4: `drawElementImage()` of an open popover that is a child of the canvas | blocked: throws `InvalidStateError`, 0 of 9 points drawn | |
| 29.4: the same element with the `popover` attribute removed | works: drawn rotated on a string, its button took a tap | The demo moves one card between the two homes. A light dismiss returns it to the scene through the `toggle` event. |
| 29.4: where the open popover is shown | at the place the canvas last gave it: 71, 62 from the canvas corner after `updateElementGeometry()` | Before that call was added, the popover was shown turned, as the canvas had last drawn it. `position: fixed; inset: 0; margin: auto` did not centre it. |
| 29.5: `<geolocation>` drawn by the canvas, flat, full size | blocked: `isValid` false. `invalidReason` was `intersection_out_of_viewport_or_clipped` in the demo and `intersection_occluded_or_distorted` in the live check and the first probe | |
| 29.5: `<geolocation>` outside the canvas, positioned over it | works: `isValid` true | The canvas draws a ring round its rectangle from `isValid`. |
| 29.5: the overlay moved by 72 px | false (`intersection_changed`) 0.1 s later, true again within 1.6 s | |
| 29.5: the overlay with `transform: rotate(4deg)`; `scale(1.3)`; `opacity: .8`; `filter: hue-rotate()` | `isValid` true for each | Probe, one element at a time. `font-size: 8px` and a light grey text colour gave `style_invalid`. |
| 29.5: the overlay under a `pointer-events: none` block | false (`intersection_occluded_or_distorted`), true again when the block is removed | So the canvas cannot draw over the button. It draws round it. |
| 29.5: a touch tap on the overlay with the permission granted to the test browser | a `location` event with a position (accuracy 25 m, the test value) | The prompt itself is not shown in headless Chromium. |
| 29.6: `CSS.supports('overscroll-area', '--drawer')` | false | `overscroll-behavior: contain` is supported. |
| 29.6: the pull measured by the page | works by touch: a drag of 120 px past the end read as 103 px, the drawer opened on release, the page did not scroll | `touchmove` events keep arriving while a drawable scroller scrolls natively and after it stops at its end. |
| A lost context | plain HTML | One `contextlost` event stops the six canvases (6 boxes). Tested by dispatching the event. |

## Things that bit

- Nine `<geolocation>` elements on one probe page: six stayed at `unsuccessful_registration`. One at a time, each registered. The demo has two.
- The first PDF measurement counted the shade the canvas draws on the fold as PDF ink (8 of 48 points). The measurement now draws one frame without the shade and looks for the colour of a band that is in the file.
- An `<embed type="application/pdf">` with no `src` already shows "Couldn't load plugin." The type is now set with the `src`, on the tap.
- The first drag test opened the drawer early: a drag that reaches the end of the list keeps counting as a pull.

## Not verified

- Chrome 159 on Android: all six demos by touch.
- 29.2 on any browser with a PDF viewer. Desktop Chrome has one. Tap "Load the PDF and measure" there and read the two lines under the book.
- Whether Chrome on Android offers to download the PDF when the button is tapped.
- The picker of a customisable select on a phone: it may be a native sheet, which changes what "open over the canvas" means.
- The real permission prompt after a tap on the overlaid button, and whether a canvas repaint under the button makes it invalid on a real GPU.
- The wall between the two live hosts (`html-in-canvas.page` and the workers.dev host). The test used `localhost` and `127.0.0.1`.
- The pull with a real finger, where the browser's own overscroll glow or stretch may also show.

## For the index

- Top layer: `drawElementImage()` of an open popover child throws `InvalidStateError`. The open popover is shown at the canvas's last transform for it. C157, `/blocked/`.
- Permission elements: `isValid` is false for one drawn by a canvas, true for one positioned over a canvas, false for about a second after it moves, true under a small rotation.
- Cross-origin pictures: drawn when loaded with `crossorigin` and a CORS header. Which ones are left out can be told from the URL and the attribute.
- Select: a list box (`size`) is drawn with its rows and hit-tests under a shear.
- Scrolling: no `overscroll-area` in C157. Touch events on a drawable scroller continue past its end.

## Open ideas

- 29.2 with a JavaScript PDF renderer drawing into a canvas inside the drawable page, to compare with the embed.
- A permission button with a scene drawn round it that reacts to `permissionStatus`.
