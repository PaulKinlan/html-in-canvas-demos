# Capture (`/capture/`, `public/lib/element-capture.js`)

| Experiment | Result | Why |
|---|---|---|
| Wrap an ordinary element in a temporary canvas and snapshot it | works | Ready in the first rendering update: the `paint` event fires in the frame the canvas was inserted. About 10 to 20 ms. |
| Move the element in with `moveBefore()` | works | Focus, caret, typed value, scroll offsets and iframes survive; custom elements get `connectedMoveCallback`, not disconnect. |
| CSS animations across the move | restart | Becoming a canvas descendant restarts them (attaching a shadow root does too). Reading `currentTime` before and seeking after hides it. |
| `drawElementImage(el, 0, 0, w × 4, h × 4)` | works | Re-rasterized, not upscaled: a 1px line becomes 4 hard pixels. Print-quality output from any element. |
| `parent > child` selectors during capture | fails | The canvas is the element's parent for that frame. |
| Box-shadow and outline outside the border box | cut off | `drawElementImage` draws the border box. |
| Element already in a drawable 2D canvas | works | Borrow that canvas for one synchronous tiled draw with `preserveElementGeometry`, then restore its pixels. |
| Element in a worker-owned canvas | clone only | No context on the main thread to draw with. |
| Cross-origin iframe; cross-origin image without CORS | blank | Left out by design; the canvas stays readable. With CORS the image paints. |
| `canvas.captureStream()` + MediaRecorder on the temporary canvas | works | The element stays live and clickable while it is recorded. |
| Printing a page that has a drawable canvas | works | `page.pdf()` includes the drawn DOM as a bitmap. |
| Body shadow root: `canvas > div[drawable] > slot` | works | Whole page captured with no light-DOM mutation; selectors, focus, caret, iframes and scroll position untouched. The shadow root cannot be removed afterwards. |
| Move body's children into a canvas and back (in flow, or a fixed overlay) | works | Needs `moveBefore()`. The page sees mutation records, `body > x` selectors stop matching for the frame, and the browser scrolls when the focused element moves back (restored). |
| Body already has an open shadow root | works via move | Moving the page's own shadow tree into a canvas drops focus, so `capturePage()` uses the move route instead. |
| Body has a closed shadow root | works via move | `attachShadow` throws; the canvas goes in the light DOM. |
| Fixed and sticky elements | works for a viewport shot | A drawable element is a containing block, so the capture wraps content in a viewport-sized frame with an inner scroller. In a full-page shot fixed elements land at the document end and sticky ones at their static position. |
| View transition to hide the swap | fails | `paint` events do not fire while a view transition holds rendering; the capture waited out the 4s timeout. |
| Flicker | none measured | The snapshot is drawn in the frame the canvas appears. Headless screencasts do not show canvas content, so this still wants an eye: the "Flicker check" button runs 30 captures. |

Browser bug: inserting, moving or removing an iframe from inside a `paint` handler (or a microtask of one) crashes the tab, the same CHECK every time (`trap int3`, same address). Taking an iframe-holding subtree out of a canvas in that handler does it, and so does appending a new iframe to `<body>`. The library leaves the paint event with a MessageChannel task before touching the DOM. This is probably the same failure as the `adoptNode` crash above.

## Video with WebCodecs and print-quality PNG

- **`exportVideo(el, { fps })` is frame-exact.** Animations under the element are paused and their `currentTime` stepped one frame at a time; each frame is drawn in a paint event, wrapped in a `VideoFrame` and encoded with `VideoEncoder` (VP9, VP8 fallback). A square animated 160px in 1s is found at x = 0, 80, 144 at 0, 0.5 and 0.9s: exactly where it should be. One rendering update per frame, so 144 frames at 640×360 took 2.4s here.
- Setting `animation.currentTime` and asking for a paint gives that time's pixels in the very next paint event. No extra frame of delay.
- Script-driven motion is stepped with an `onframe(ms)` callback; motion that cannot be stepped uses `mode: 'realtime'`. `encodeFrames(iterable)` encodes frames you already have, in the `{ time, bitmap }` shape `<dom-rewind>.frames()` yields.
- **WebM needs no library.** `lib/webm-mux.js` is about a hundred lines: EBML header, Info with a real duration, one track, Cues before the clusters (so the file seeks), one cluster per key frame. Chrome plays and seeks the result. MP4 would need a larger muxer and H.264, whose software encoder crashed the tab in earlier testing.
- `captureElement(el, { dpi: 300 })` re-rasterizes at 3.125× and writes a PNG `pHYs` chunk, so the file opens at the element's real size in print tools. A 1px rule comes out as 3 crisp pixels.

## Clipboard, print margins, folders

Measured in headless Chromium 157 on 2026-11-21. Three rows in the page's element tests repeat them.

| Experiment | Result | Why |
|---|---|---|
| `copyElement(el, { html: true })`: PNG, HTML and text in one `ClipboardItem` | works | `navigator.clipboard.read()` returns all three types. The PNG is passed as a promise so the write starts inside the tap. |
| `printElement(el, { header, footer })` with `@page` margin boxes | kept | The print document's `CSSPageRule` holds all three boxes, with `counter(page)` and `counter(pages)`. Not checked on paper. |
| `saveToFolder()` into a folder handle, `watchFolder()` with `FileSystemObserver` | works | Run on the origin private file system, which has the same handle API. A change is reported 1 to 5 ms after the write; the tile for a changed HTML file was redrawn 23 ms after the write. |
| A folder of HTML files as tiles in a canvas, each saved back as a PNG | works | Each file is the `srcdoc` of an `<iframe sandbox="allow-same-origin">`. |

- Read `outerHTML` before the capture starts. During a capture the element carries a `drawable` attribute and inline size overrides, and they end up in the copied markup otherwise.
- An `<iframe sandbox>` with no `allow-same-origin` has an opaque origin and is left out of the canvas picture, like any cross-origin frame.
- `FileSystemObserver` reports one record per write step and names the temporary `.crswap` file too; `watchFolder()` filters those.
- The test browser's `MediaRecorder` writes VP8, VP9, AV1 and H.264 and has no HEVC encoder. `recordFormats()` lists what a browser can record.
- Not verified: `showDirectoryPicker()` and `FileSystemObserver` on Android, and a printed page.
