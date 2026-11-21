# Text selection (/selection/, lib/selection-fx.js)

Measured in headless Chromium 157 (Linux, software renderer) on 2026-11-21. The page's live checks repeat the rows that do not need focus.

| Experiment | Result | Why |
|---|---|---|
| The browser's selection highlight in the pixels of `drawElementImage()`, `texElementSubImage2D()` and a read-back | works | The highlight is part of the element's paint record, in the active colour, and is transformed with the element. |
| `paint` fires when the selection changes | works | No `requestPaint()` needed. A 30-step mouse drag fired 19 paint events. |
| `::selection` colours | works | A custom background and colour are drawn. `background-color: transparent` with no `color` gives a picture identical to the unselected one while the selection still exists. |
| `::highlight()` (CSS Custom Highlight API) | works | Drawn, and setting or clearing the registry fires `paint`. A Highlight with no style gives ranges to measure and draws nothing. |
| `Range.getClientRects()` against the drawn highlight, element drawn with a translation | works | Within 1 px. Rectangles are in page coordinates and follow the drawn position. |
| `Range.getClientRects()` on an element drawn rotated | fails | Returns the upright bounding box of each rotated line (72×24 becomes 76×38 at 0.2 rad). `getBoxQuads()` is not in Chromium. |
| `updateElementGeometry(identity)`, measure, restore, in one task | works | `getClientRects()` follows the geometry synchronously, so this gives element-local rectangles with no visible change. Note that `geometryUnit()` in `lib/surface.js` applies the identity itself. |
| `range.getClientRects()` on a selection that spans paragraphs | misleading | It also returns the boxes of block elements fully inside the range. `textRects()` uses one Range per text node. |
| Mouse drag, double click and `caretPositionFromPoint()` on an element drawn rotated and scaled | works | Selection hit testing follows the drawn geometry. Also checked at device scale factor 2.625. |
| Drag from one drawable element to another, and from outside the canvas into it | works | Selects across them in document order. |
| Drag from outside into a `contenteditable` canvas child | stops at its edge | The usual editing-boundary rule. |
| Caret of a focused editable canvas child | works | Drawn, and each blink fires `paint` (4 events in 2.2 s). |
| Selection inside `<input>` or `<textarea>` | drawn, cannot be measured | `getSelection()` has no range inside the control and there is no rectangle API for `selectionStart`/`selectionEnd`. |
| `window.find()` | works | It selects the match, so it is drawn like any selection. |
| WebGPU against WebGL for the same effect (off-screen, software adapter) | works | Mean difference 0.00 of 255 for `wave`. The WGSL of all three shader effects compiles. |
| Touch long press, Android handles, the copy menu | not verified | Long press selected nothing in the headless browser, inside or outside a canvas. Needs a phone, in particular: handles on a rotated line, and handles when `::selection` is transparent. |
| `::target-text`, find-in-page marks, spelling marks | not verified | None appeared in the headless browser even outside a canvas. The explainer lists spelling and find-in-page marks as left out of element pictures. |
| `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas that holds an element texture | crashes the tab (Chromium 157) | Seen in a live check that released its context while the fixture was still in the document. Removing the canvas first avoids it. |
| A WebGL canvas losing its context | fires `webglcontextlost`, not `contextlost` | `SurfaceElement` in `lib/surface.js` only listens for `contextlost`, so a subclass using WebGL has to listen itself. `<selection-fx>` moves its content to a new 2D canvas on either event. |
| A canvas with a lost context on Android Chrome 159 | shows a white box with a broken-picture icon | Reported from Paul's phone on first load of `/selection/` (2026-11-21), cause not identified. The page now starts on a 2D effect, starts GPU checks only on a tap, and replaces a lost or picture-less canvas. |
| `caret-color` and `caret-shape` in the element's picture (`/caret/`) | works | At device scale factor 2 a block caret covers 578 canvas pixels and a bar 102. |
| `caret-animation: manual` | works | The caret pixels stay in every read-back and no `paint` fires while the caret rests. With `auto` the caret is in about one read-back in three. |
| Caret position from a collapsed `Range` | works | `getClientRects()` returns one zero-width rectangle at the drawn position. Nothing on an empty line. |
| `CSS.highlights.highlightsFromPoint()` on an element drawn away from its layout position | works | Returns the Highlight and range at the drawn position, and nothing at an empty point of the canvas. |
| `::highlight(*)` | not in Chromium 157 | `CSS.supports('selector(::highlight(*))')` is false. Listed for 158. |
| A shader finding the caret and highlights by colour key, with no rectangles (`key-glow`) | works | Checked on WebGL with a keyed `::highlight()` background. |
| Playwright screenshots | hide the caret | `page.screenshot()` defaults to `caret: 'hide'`. Pass `caret: 'initial'` when the caret is the subject. |
| WebGPU on screen, and shader speed on a phone | not verified | The software adapter cannot present a WebGPU canvas. |

How `<selection-fx>` uses this: one `::selection` rule hides the browser's highlight inside the element, `selectionchange` triggers a measurement of one Range per text node, and the rectangles go to a 2D effect directly or to a shader as a mask texture (red: selected, green: selected in the last 1.2 s, blue: selected and blurred by 10 px). The element's geometry stays at its layout position, so the caret and hit testing do not follow what an effect draws.

## Five pages drawn from ranges (`/selection-peers/`, `/selection-glyphs/`, `/redact/`, `/selection-heat/`, `/share-card/`)

Measured in headless Chromium 157 (Linux, software renderer, device scale factor 2) on 2026-11-21. Each row is a live check on the page named. The first four pages are 2D effects registered on `<selection-fx>` with `defineSelectionEffect()` from their own modules. Shared helpers are in `lib/selection-tools.js` and shared styles in `lib/selection-article.css`.

| Experiment | Result | Why |
|---|---|---|
| Rectangles of a range that is not selected (`/selection-peers/`) | works | `Range.getClientRects()` needs no selection. A canvas draws any number of other readers' ranges with no change to the DOM or to the document's selection (HTML and selection compared before and after). |
| A selection sent as two offsets into `textContent` and rebuilt in another document | works | Round trip checked across an inline element. A message on a `BroadcastChannel` arrived in 25 ms and the range was drawn 48.2 px wide for 4 characters of 12 px. |
| A same-origin frame as a second reader | works | Each document has its own selection, so selecting in the frame does not clear the page's selection. Checked with a script, not a live check: both selections were held at once and each side drew the other's range. |
| One `Range` per character (`/selection-glyphs/`) | works | 12 rectangles for 12 letters, each 12.0 px wide in a 20 px monospace font. The box is the advance width and the line's text height, not the ink. |
| Letters taken out of the element's picture with an even-odd clip and drawn elsewhere | works | After dropping 12 letters: 0 ink pixels on their line, 3047 under it, `textContent` unchanged. |
| The canvas outside the element's ink | transparent | An element with no background leaves the canvas transparent between glyphs, so a piece of the canvas is a letter with nothing behind it. |
| 288 letters per frame from a snapshot (`drawImage()`) against from the live element (`drawElementImage()` through a clip, once per letter) | 49.6 ms against 442.3 ms | Software renderer, and both numbers include `getImageData()` of the whole canvas. The live route replays the element's paint record once per letter. |
| A bar drawn over a range after the element (`/redact/`) | covers every pixel | 10560 canvas pixels inside the range's rectangle, all the bar colour. |
| The DOM after a canvas redaction | still has the text | `textContent`, `Range.toString()` and copy return it. The page's copy handler and "Remove the text from the DOM" are the two ways it offers to close that. |
| `ctx.filter = 'blur()'` on `drawElementImage()` | works | The blur style changed 9196 pixels inside the range and 0 outside. Filter lengths are canvas pixels, so the page multiplies by the canvas scale. |
| `drawImage(canvas)` with the canvas itself as the source, after `drawElementImage()` | works | The pixel style reads the part of the canvas it replaces. The canvas is not tainted by same-origin element content. |
| Replacing characters in the DOM under a Custom Highlight range | offsets stay valid | Setting `node.data` collapses live ranges in that node, so the page rebuilds its ranges from stored offsets. 10 characters replaced, the range kept one rectangle. |
| One element drawn twice in a frame at different sizes (`/selection-heat/`) | works | The minimap is the article at scale 0.169 in the fixture: 478 text pixels and 57 heat pixels at the scaled position. |
| A minimap in a second canvas | not possible | An element is drawn only by its own canvas (known from the first findings), so the minimap is inside the article's canvas, in a column the article reserves with padding. |
| `document.caretPositionFromPoint()` on text drawn by the canvas | works | Returned offset 7 for a point on the eighth character. |
| An element drawn at four times its layout size (`/share-card/`) | drawn again, not stretched | A 1 px line became 4 black pixels with 0 grey pixels beside it. |
| `canvas.toBlob()` after `drawElementImage()` | works | PNGs of 1200×630, 1080×1080 and 1080×1920 decoded at those sizes. |
| `scrollHeight` and `clientHeight` on a canvas child | work | They drive the card's type size: 67.5 px for 3 words, smaller for 420 characters, both fit. |
| A canvas child wider than the canvas element | works | The figure is 600 px wide in a canvas shown about 396 px wide. The picture is complete. |

### Things that bit

- `shared/style.css` gives `figure` a `max-width: 100%`, and a canvas child obeys it against the canvas's CSS width. The share card was laid out 396 px wide and drawn stretched until the figure got `max-width: none`.
- After a 2D `drawElementImage()` with a size different from the layout size, `getBoundingClientRect()` of the element reports the drawn size (396×208 for a 600×315 figure). Layout sizes come from `offsetWidth` and `clientHeight`.
- `s.rects` in a `<selection-fx>` effect holds the selection and the `highlight` attribute's ranges together. An effect that draws the two differently reads `s.marked` for the ranges and uses `s.rects` only while something is selected.
- Fitting type by `scrollHeight` and then changing `line-height` undoes the fit. The line height is fixed in CSS.
- The site menu stays at the top of the window, so a minimap that follows the scroll is placed 64 px below the window's top edge.
- The article's own minimap column is part of the element, so the minimap shows an empty strip at its right edge.

### Not verified

- Touch on all five pages: long-press selection, the Android handles, the automatic drop 0.7 s after the last selection change on `/selection-glyphs/`, and dragging in the minimap column on `/selection-heat/`. Needs a phone.
- Frame rate with several hundred loose letters, and how closely the minimap follows a touch scroll. Needs a phone.
- `navigator.share()` with a PNG file and `navigator.clipboard.write()` with a PNG on `/share-card/`. The headless browser has no share sheet and no clipboard permission. Press Share and Copy picture on a phone.
- What find-in-page and TalkBack report for a range covered on `/redact/`. Both read the DOM, so the expected answer is the original text until it is removed.
- Two people on two devices on `/selection-peers/`. The page has a `BroadcastChannel` only, so it reaches tabs and frames of one browser. A relay server would carry the same message.

### Ideas not built

- A relay (Durable Object or WebRTC data channel) so `/selection-peers/` works between devices, and readers' carets as well as selections.
- Letters on `/selection-glyphs/` that collide with each other and can be pushed with a finger.
- Redaction that also exports a PDF, and a "peek" that shows a range while it is pressed.
- Heat collected from real visitors, and a minimap for a whole page of several canvases.
- Share cards with a QR code of a text-fragment link to the passage.

### For the index

- Text and ranges: any `Range` has rectangles at the drawn position whether or not it is selected; one `Range` per character gives per-letter boxes (`/selection-peers/`, `/selection-glyphs/`).
- 2D drawing: `ctx.filter`, `clip('evenodd')` and a self-sourced `drawImage()` all apply to `drawElementImage()` output (`/redact/`, `/selection-glyphs/`).
- 2D drawing: an element drawn larger than its layout is re-rasterised, and one element can be drawn several times per frame at different sizes (`/share-card/`, `/selection-heat/`).
- Export: `toBlob()` and `getImageData()` work after `drawElementImage()` of same-origin content (`/share-card/`, `/redact/`).
- Layout: `scrollHeight` works on canvas children; `max-width: 100%` on a canvas child resolves against the canvas's CSS width (`/share-card/`).
- Accessibility and privacy: drawing over text in the canvas hides nothing from the DOM (`/redact/`).
