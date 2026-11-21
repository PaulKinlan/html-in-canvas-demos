# Streamed HTML (`/stream/`, `lib/element-gl.js`)

Measured in Chromium 157 (headless shell). Not yet run on the test phone.

| Question | Result | Notes |
|---|---|---|
| `streamAppendHTML()` into a drawable canvas child | works | The writer accepts chunks that split a tag. Where the method is missing the page streams through `document.write()` on a second document whose container is moved into the page. |
| Paint event per chunk | yes | One `paint` event for each chunk that changed the picture, with no call to `requestPaint()`. |
| Which blocks are new | from a MutationObserver | `changedElements` names the drawable element, not the blocks inside it. The page records the time each block was added or last changed and passes up to 16 rectangles to the shader. |
| Effect on new blocks only | works | One fragment shader pass over the element's texture. Older blocks are drawn unchanged. |
| Selection, links and buttons during the effect | work | The quad covers the element's layout box, so `updateElementGeometry()` with an identity matrix is enough. Without that call a WebGL canvas has no hit box for the child and `elementFromPoint()` returns the canvas. |
| Lost WebGL context | handled | The element is moved out of the canvas and shown as plain HTML with a message. It goes back when the context returns. |
