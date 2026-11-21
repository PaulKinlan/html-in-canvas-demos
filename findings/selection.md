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
