# Follow-ups to the Chrome APIs plan (`/plan-followups/`, backlog group 26)

Measured in C157 (headless shell, software rendering), 2026-11-21, at 412 pixels wide and a scale of 2, once with no flags and once with `--enable-experimental-web-platform-features`. Not yet run on the test phone.

One page builds the five items of backlog group 26 on one stage. Two canvases are stacked: a 2D canvas for semantic zoom and text rectangles, and a WebGL canvas (one `ElementGL`, made the first time it is needed) for column pages, the float buffer and the effect from CSS. `public/plan-followups/stage.js` holds the fragment shader, the bloom chain and the float drawing buffer call.

| Item | Question | Result | Notes |
|---|---|---|---|
| 26.1 | A tile drawn at 0.3 of its size: where is it clicked | at the small rectangle (measured) | A 200 by 100 element drawn at 100, 40, 60, 30. `elementFromPoint()` gives the button inside that rectangle and not at 40, 20. |
| 26.1 | Swapping a tile for a stand-in as the zoom falls | works (measured by screenshot) | Body text is 14 px. Between a zoom of 0.72 and 0.5 the tile fades out and a second element with one sentence in 23 px bold fades in at the same rectangle. Both have the same click handler. |
| 26.1 | `Summarizer` | present, `availability()` is "downloadable" (measured) | The button calls `Summarizer.create({ type: 'headline', format: 'plain-text', length: 'short' })`. What it returns is not verified. Until then the stand-in is the first sentence of the tile. |
| 26.1, all | An element that a paint does not draw | keeps the click target of its last draw (measured) | After changing from semantic zoom to text rectangles, a point in the lower line of text still answered with a stand-in tile. Fixed by drawing each unused element at -4000, -4000 with `globalAlpha` 0, and on the WebGL canvas by `updateElementGeometry()` with a translation out of the canvas. |
| 26.2 | An element with `columns: 5`, a fixed height and `column-fill: auto` | one picture with all five columns (measured) | Five coloured blocks with `break-after: column` read red, green, blue, yellow, magenta at the five column centres. The demo's article is 1,250 by 330 CSS pixels, a texture of 2,500 by 660 at a scale of 2. |
| 26.2 | Page turn | works (measured by screenshot) | Two quads from the one texture. The top one maps the page onto a cylinder of radius 0.07 page widths that moves from right to left, with the back of the paper drawn mirrored and lightened. The texture is uploaded when the element paints, not on each frame of the turn. |
| 26.2 | Text and link of the shown page | clickable at the picture (measured) | `updateElementGeometry()` with a translation of the page's place minus `page * 250`. The transform is in CSS pixels. The link on page 2 answers `elementFromPoint()` at its drawn place. |
| 26.2 | `scrollLeft` on a drawn multi-column scroller | changes the picture (measured) | Red before, green after a scroll of 200. |
| 26.2 | `::column::scroll-marker` of a drawn scroller with `scroll-marker-group: after` | not in the picture (measured) | The picture is 200 by 60, the size of the element. No marker pixel is found anywhere in a 200 by 100 canvas. `CSS.supports('selector(::column)')` is true. So the `::column` route gives a canvas nothing that the plain multi-column element does not: the fragments are not separate pictures. |
| 26.3 | `TextMetrics.getSelectionRects()` with no flag | absent (measured) | The page shows the range rectangles and says so. The live check is expected to fail there. |
| 26.3 | With the experimental features flag, characters 6 to 12 of "Hello canvas text" at 20 px serif | Range 49.42 + 54.44, TextMetrics 49.43 + 54.41, both 22.0 tall (measured) | |
| 26.3 | A selection across Latin and Hebrew text, characters 3 to 22 of the demo line at 24 px serif | three rectangles from each, same widths (measured) | Range 37.1 + 82.2, 119.4 + 57.9, 177.3 + 49.4. TextMetrics 37.6 + 82.2, 119.8 + 57.9, 177.6 + 49.4. Largest difference at an edge 0.43 px. The offset of about 0.4 px is constant, so it is the placing of the element's text against `fillText()` at a whole pixel, not the widths. |
| 26.4 | A shader raising an uploaded element in an `RGBA16F` texture | 4.00 inside the raised box, 1.00 beside it (measured) | `texElementSubImage2D()` gives 8 bits, so the gain is applied in the shader, as on the WebGPU route of `/hdr-glow/`. |
| 26.4 | `drawingBufferStorage(gl.RGBA16F, w, h)` on a drawable WebGL canvas | accepted, and the drawing buffer reads 4.00 after the bloom composite (measured) | Colour space `display-p3`. `drawingBufferToneMapping()` is absent with no flag and accepts `extended` with the flag. |
| 26.4 | That canvas on screen in the test browser | empty (measured) | With software compositing the canvas shows nothing and the console logs `GL_INVALID_OPERATION: glReadPixelsRobustANGLE: Invalid format and type combination` for each frame. With an 8-bit drawing buffer the same frame is shown. The page therefore asks for the float buffer at the start only where `(dynamic-range: high)` matches, and has a control for both. |
| 26.4 | Bloom | works in 8-bit output (measured by screenshot) | Bright pass above 1.0, two blur rounds at a quarter of the size, composite. The map view colours the badge, the button, the word and the bars. |
| 26.5 | A registered `<custom-ident>` read with `getComputedStyle()` | the name (measured) | The page looks it up in `{ none, wave, split, lines }` and sets one float uniform. Editing the rule in the shown `<style>` element changes the effect on the next frame. |
| 26.5 | The same property in a 1 s linear transition | `none` at 0.25 s, `wave` at 0.75 s; a registered number read 0.25 and 0.75 (measured) | So an effect change cannot be cross-faded by the property itself. |

## On the test phone (A159, experimental features flag on), reported 2026-11-22

| Question | Result | Notes |
|---|---|---|
| Is a WebGL canvas with an `RGBA16F` drawing buffer shown | yes (reported) | Status line: "Drawing buffer: RGBA16F, display-p3, tone mapping: extended". The page chose it at the start, so `(dynamic-range: high)` matches. |
| Are the raised parts brighter than white | yes (reported) | "Searing white". At a headroom of 4.0 and a bloom of 1.0 the labels were hard to make out. The page now starts at 2.5 and 0.4. |
| The same scene with the 8-bit drawing buffer | flat white where raised, labels lost (reported, screenshot) | Each channel was cut off at 1.0, so the button, the badge and their white labels were all 1.0. The composite now divides such a pixel by its largest channel, which keeps the hue. Measured by screenshot in C157 after the change: blue button, red badge, white labels. Not yet seen on the phone. |

## Things that bit

- Stale click targets when one canvas serves several experiments (row 4 of the table). The first build was clicked through.
- The first build asked for the float drawing buffer always, and every screenshot of that experiment was empty. The scene texture and the drawing buffer both read 4.00, so the loss is between the buffer and the screen in the software compositor.
- A float drawing buffer has to be asked for again after the canvas is resized, and `ElementGL.begin()` has to run again after `drawingBufferStorage()` because the buffer is new.
- Playwright's screenshot is slower than a 750 ms page turn in software rendering. The turn was photographed by freezing `performance.now()`.

## Not verified

- A159 on the test phone: the other four experiments, and the float buffer after the change of 2026-11-22 (are the labels readable at 2.5, and is the word in the strip readable).
- What `Summarizer` returns for the six tiles, and how long the model download takes. To verify: press "Use the Summarizer API" in a Chrome that has the model.
- `TextMetrics.getSelectionRects()` in Chrome 160 without a flag.
- Touch selection of the top line of "Text rectangles" and of the book text.
- Frame rate of the page turn and the bloom on a phone.

## Open ideas

- 26.5 asked for the binding to move into `lib/shader-fx.js`. That file is shared and generates `lib/fx.js`, so it was not changed here. The binding is `readCards()` in the page, about 15 lines on top of `lib/css-uniforms.js`. Moving it needs a pull request that changes only the library.
- 26.1 named `/board/`. The zoom is built on its own 2D canvas here, so `/board/` is unchanged.
- A book longer than about ten pages needs one element for each handful of pages, because one texture holds them all.

## For the index

- Backlog group 26: items 26.1 to 26.5 are built on `/plan-followups/`. 26.5 is built without the move into `shader-fx.js`.
- Hit testing: an element that a paint does not draw keeps the click target of its last draw; draw it off the canvas with alpha 0, or move it with `updateElementGeometry()`.
- Hit testing: `updateElementGeometry(el, { canvasTransform })` takes CSS pixels. `/hdr-glow/` passed device pixels on its WebGPU route and is corrected in the same pull request.
- Multi-column: one element with `columns: n` is one picture with every column. `::column::scroll-marker` is not in the picture of a drawn scroller.
- Canvas text: `TextMetrics.getSelectionRects()` (experimental flag in C157) agrees with `Range.getClientRects()` to within half a pixel, including across a change of direction.
- WebGL and HDR: a drawable WebGL canvas accepts an `RGBA16F` drawing buffer and holds values above 1.0. The software compositor of the test browser does not show it. The test phone shows it brighter than white (reported).
- CSS: a registered `<custom-ident>` selects a shader effect; it changes at the halfway point of a transition.
