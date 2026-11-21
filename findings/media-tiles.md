# Video, image and chart tiles (`/media-tiles/`)

Five ideas from the element catalogue (group 15 of the backlog in PLAN.md). Measured in headless Chromium 157 (C157) on 2026-11-21 with a mouse and emulated touch at 412 px wide, at device pixel ratio 1 and at 2.625 (`--force-device-scale-factor`). The page's ten live checks pass at both ratios, and `node tools/media-tiles/check.mjs` drives the five demos with real input (33 steps, all pass). Nothing here has been run on a phone.

The question: do a video, an image, a picture with `srcset`, an inline SVG and a nested canvas keep their own behaviour (controls, file choice, `:hover`, links, checkboxes) when a canvas draws them in pieces, at another size or under a transform?

| Experiment | Result | Why |
|---|---|---|
| Video wall: one `<video controls drawable>` drawn 12 to 40 times per paint with the nine-argument `drawElementImage()`, each tile under its own translate, rotate and scale | works | Every tile is a source rectangle of the same picture. |
| Do all tiles hold the same video frame | yes | Two copies of one source rectangle, drawn in one handler while the clip played, differed by 0.00 per channel on average at ratio 1 and at most 0.10 at ratio 2.625 (largest single channel difference 11). Samples 110 ms apart differed by about 11 on average. |
| Paint events from a playing 30 fps clip, no `requestPaint()` | about 30 a second | 20 in 0.66 s in the live check. The wall asks for frames itself only while tiles move. Closed and paused: 0 paint events in 0.7 s. |
| Controls after tile draws | a whole draw inside an empty clip | Each source-rectangle draw moves the hit region to that tile. After the clipped whole draw the video was found at all 4 corners of the closed wall's box, where that draw put no pixel, and not at the last tile. |
| Touch tap on the closed wall | shows the native controls | Emulated touch. The clip kept playing. The wall closes on any pointer event on the canvas and stays closed for 4 s, so the controls are drawn in one piece while they are used. |
| Figure with a live caption: `<figure>` not drawable, `<img drawable>` and `<figcaption drawable>` inside it | each has its own picture | The image drawn through `grayscale(1)` was 48,48,48 and the caption beside it 255,255,255. |
| Caption's link and text | work at the drawn place | `elementFromPoint()` on the drawn link returned the `<a>`. Typing into the `contenteditable` span changed the text in the canvas. |
| Four effects on the image only: rows moved by a sine (source rectangles), duotone (`ctx.filter` grey, then `multiply` and `lighten` fills), dots (`destination-in` with a pattern), slats (source rectangles squeezed in x) | work | Each is drawn first on the empty canvas, so a blend or a mask reaches only the image. The background goes behind with `destination-over`. |
| Panel behind the caption | a third draw of the image, clipped and blurred | `ctx.filter = 'blur(7px) brightness(0.55)'` inside a rounded clip of the caption's box. |
| An element laid out 20 px wide, drawn 320 px wide | sharp | 0 grey pixels across a black and white edge. A bitmap copy of the 20 px draw scaled by `drawImage()` had 13. The picture is rastered at the drawn size. |
| Resolution by drawn size: write the drawn width into `sizes` on the `<source>` and the `<img>`, layout unchanged | the browser picks a larger file and raises `paint` | `sizes="20px"` picked 160w. `sizes="700px"` picked 1280w, with 1 paint event at ratio 1 and 2 at ratio 2.625. No load listener is needed. |
| Device pixel ratio | multiplies | `sizes="91px"` picked 160w at ratio 1 and 320w at ratio 2.625 (239 px needed). |
| Going back to a smaller `sizes` | `currentSrc` stays at the largest file loaded | Still 1280w after `sizes="20px"`, and for a fresh clone of the `<picture>`. |
| Second route to a smaller file | new URLs | `srcset` rewritten with `?v=n` on every candidate started again from the small file. |
| Writing `sizes` on every frame of a 2.6 s walk from 91 to 1400 px | 4 files fetched: 160w, 320w, 640w, 1280w | Each threshold crossed starts a fetch. Written once at the end of the walk: 2 files, the first one and 1280w. |
| SVG chart drawn turned and squashed (one affine matrix: a turn in the plane, then `cos(tilt)` on y) | hit region follows | The middle of a bar landed at 200.6, 90.8 under the matrix. `elementFromPoint()` returned the `<rect>` inside its `<a>` there, and not at the flat place. |
| `getBoundingClientRect()` of a shape inside the drawn SVG | the box at the drawn place | 200.6, 90.8 for the same bar. The canvas places its label from it. |
| `:hover` on a bar under the transform, mouse | works, and can be read in the paint handler | The Thu bar's pixel became 210,73,31, its hover fill. `querySelector('a.bar:hover')` in the handler returned the bar: no pointer listener is used for the label. |
| Tap on a bar, which is `<a href="#bar=tue">` | the browser follows the link | `location.hash` became `#bar=tue`, the page did not scroll, and a `hashchange` listener marks the bar. |
| CSS animation and transition inside the SVG | raise `paint` | 30 events in 0.5 s for an animated `stroke-dashoffset`, 19 for a 0.3 s transition of a bar's transform, 0 for a still SVG. |
| A 90 px mouse drag that starts on a bar | turns the sheet by more than 15 degrees and does not follow the link | A capture `click` listener on the canvas calls `preventDefault()` after a drag of more than 6 px. `location.hash` was unchanged after the drag. |
| Plain `<canvas>` (2D, not drawable) inside a `<figure drawable>` | in the figure's picture | Inner pixel 0,0,208 read from the outer canvas. |
| Redrawing the inner canvas, no `requestPaint()` on the outer | raises `paint` on the outer canvas | 1 event, pixel then 0,176,0. |
| Checkbox in the figure changed from script | raises `paint` | The export demo has no `change` listener. The paint handler reads `checked` and redraws the ring. |
| Position of the inner canvas's content when the canvas is not at the figure's origin | wrong unless the canvas has `contain: paint` | Figure padding 20 px, canvas with a red stripe 10 px wide at its left edge. Expected red at 20 to 29 and blue at 30 to 79. Got no red and blue at 20 to 59: the content is shifted left by the padding and cut by the canvas's box. The same upwards. |
| Routes tried for that | `contain: paint`: right. `transform: translateZ(0)`: right. A `drawable` attribute on the inner canvas and its own draw: right. `will-change: transform`, `position: relative`, `willReadFrequently`, an `overflow: hidden` wrapper, a `bitmaprenderer` context: still shifted. A CSS background on the canvas with no context: not shifted. | Tried in a scratch page at ratio 1 and 2. The live check keeps the plain and the `contain: paint` cases. |
| `toBlob()` on the outer canvas | one PNG with the inner canvas and the HTML | 240 by 120 fixture: inner canvas 0,0,208 and HTML swatch 224,0,0 found in the decoded file, alpha 0 outside the figure. Not tainted. |
| The demo's export | 378 by 288 px, 31 kB, 18 ms at ratio 1 | The PNG has the size of the outer canvas's buffer (994 by 757 at ratio 2.625). A download with the name `chart-and-legend.png` was received by the test browser. |
| A lost context | plain HTML | One dispatched `contextlost` event on one canvas stops all five and shows the video, the figure, the picture, the chart and the legend as plain elements (5 boxes). |
| Memory | 2.3 MB in 7 canvases at ratio 1; 3.1 MB and 0.78 megapixels at load at ratio 2.625 (`check:jank`) | Five 2D canvases, no WebGL, no readback outside a tap or a live check. |

## Things that bit

- `<source>` needs its own `sizes`. With `sizes` only on the `<img>`, the `<source>` used the default of `100vw` and the page loaded the 1280w file at once.
- The inner canvas offset. The ring chart was cut on its left and top edges, and the export was too. A fixture in which the inner canvas sat at the figure's origin did not show it. The check that found it draws a stripe at the canvas's edge and has padding round the canvas.
- At ratio 2.625 two draws of the same video source rectangle at different places are not bit-identical (up to 11 in one channel, 0.10 on average). The check compares the average with the difference between two frames.
- Resource Timing reported the first file twice at ratio 2.625. The list of fetched files is made of distinct URLs.
- The Python test server has no Range support, so the wall loads its clip as a blob. Seeking from the native timeline then works on any server.
- The loupe on the resolution demo is a source-rectangle draw of the same image, so it moved the image's hit region to the loupe. The picture's place is given back with a clipped draw.

## Not verified

- Chrome 159 on Android: all five by touch. Open `/media-tiles/` and try each.
- The speed of 12, 24 and 40 video draws per frame on a phone GPU, and of the ripple (about 30 source-rectangle draws per frame).
- The native video controls by touch: the centre play button, the timeline, the overflow menu and fullscreen from the closed wall.
- The on-screen keyboard over the caption, and text selection in the caption by long press.
- The file picked at the phone's device pixel ratio. The line under the picture reports `sizes`, the ratio and `currentSrc`.
- Whether Chrome on Android also keeps the largest file when `sizes` shrinks.
- A sideways touch drag on the chart (the canvas has `touch-action: pan-y`). The drag was driven with a mouse only.
- `:hover` after a tap on a touch screen. The tap route through the link was measured, the hover route was measured with a mouse.
- Copy (`ClipboardItem` with a promise) and Share (`navigator.share()` with a file). Neither can be confirmed in the headless browser.
- A screen reader on any of the five.

## For the index

- Drawing: several source-rectangle draws of a playing `<video>` in one paint handler show one frame (measured, C157, `/media-tiles/`).
- Drawing: an element's picture is rastered at the drawn size. A 20 px box drawn at 320 px has a sharp edge (measured, C157, `/media-tiles/`).
- Drawing: a `<figure>` that is not drawable can hold a `drawable` `<img>` and a `drawable` `<figcaption>`, each with its own picture and hit region (measured, C157).
- Paint event: a new file chosen from `srcset` after `sizes` changed, a CSS animation or transition inside an inline SVG, a redraw of a canvas nested in a drawable element and a checkbox changed from script each raise `paint` (measured, C157).
- Images: `sizes` written from script moves `currentSrc` up through the `srcset` candidates and never down; new URLs start the choice again (measured, C157).
- Hit testing and geometry: under an affine transform with a turn and a non-uniform scale, `elementFromPoint()`, `:hover`, links and `getBoundingClientRect()` of SVG shapes follow the drawn place (measured, C157).
- Capture: `toBlob()` on a drawable canvas that holds a figure with a nested plain canvas gives one untainted PNG (measured, C157).
- Backlog: ideas 15.1 to 15.5 (video wall, figure with a live caption, resolution chosen by drawn size, SVG chart as a live texture, chart and legend exported as one picture) are built on `/media-tiles/`.

## Chromium bugs

- Candidate: the content of a `<canvas>` (2D or `bitmaprenderer`) nested in a `drawable` element is drawn shifted by minus the canvas's offset inside that element, and cut by the canvas's box, when the element is drawn with `drawElementImage()`. `contain: paint` or a transform on the inner canvas avoids it. C157, ratio 1 and 2. The live check "Where the content of an inner canvas is drawn when it has padding round it" on `/media-tiles/` is the reduction.

## API requests

- A way to draw an element under a perspective transform in a 2D context with a hit region that follows. A triangle mesh draws the picture, and the hit region then follows only the last triangle, so the tilted chart uses an orthographic view.
