# Findings

Verified in Chromium 153 and 157 (headless, API on by default in those builds) on 2026-11-20. Every demo page re-runs these checks live in your browser.

The API surface used here is the current WICG explainer shape: `<canvas content="drawable">` (older builds: `layoutsubtree`), the `drawable` attribute on drawn elements, the `paint` event, `drawElementImage()`, `captureElementImage()` and `ElementImage`.

## Slots

| Experiment | Result | Why |
|---|---|---|
| Draw a light-DOM element slotted into a shadow canvas | works | Layout and paint use the flat tree, so the slotted element is a canvas descendant. |
| Slotted element without `drawable` | fails | "Descendants passed to DrawElementImage must have the 'drawable' attribute." |
| `<slot drawable>` | fails | Slots are `display: contents`: no box, so "No cached paint record". |
| `<div drawable><slot></slot></div>` wrapper in the shadow tree | works | Draws everything slotted into it as one image, without touching author markup. |
| Declarative shadow DOM, no custom element | works | Only the `paint` handler needs script. |
| Manual slot assignment (`slot.assign()`) | works | |
| Slot fallback content, several elements per slot, deeply nested slots, slot-through-slot | works | |
| `<slot>` inside a light-DOM canvas picking up `slot="x"` elsewhere | fails | Slots are inert outside a shadow tree. |
| Slotting an element that isn't a child of the host | fails | `assign()` ignores non-children. |
| Shadow root on `<body>` with a canvas and named slots | works | Any top-level element opts in with `slot="…"`. |
| Clicks, focus, typing on slotted elements at their drawn position | works | `drawElementImage` updates element geometry. |

## ElementImage and OffscreenCanvas

| Experiment | Result | Why |
|---|---|---|
| Transfer ElementImage to a worker, draw into the canvas's transferred OffscreenCanvas | works | The explainer's pattern. |
| Redraw one ElementImage for many frames | works | Until `close()`. |
| Draw an ElementImage into any other canvas (new OffscreenCanvas, second canvas, another document) | fails | "The source was captured from a different canvas." Snapshots are bound to their source canvas. |
| `structuredClone(ElementImage)`, BroadcastChannel | fails | Transferable, not serializable. |
| Worker keeps animating while the main thread is blocked | works | But snapshots stop updating: only the main thread's rendering update makes them. |
| Worker draws update main-thread hit testing | works | Batched; `elementgeometryupdate` fires on the canvas. |
| Read back pixels of drawn DOM (`getImageData`, `createImageBitmap`) | works | "Read-back-allowed rendering": sensitive content is never painted, so the canvas is not tainted. |
| Source canvas with `display: none` or `visibility: hidden` | fails | No paint record is made. |
| Source canvas far off-screen | draws transparent | Culled. |
| Source canvas at `opacity: 0` | works | Usable as a hidden source. |

## Tabs and origins

| Experiment | Result | Why |
|---|---|---|
| Transfer ElementImage over MessageChannel / `window.postMessage`, same or cross origin | works | |
| Receiver draws it into its own canvas | fails | Bound to the source canvas. |
| Cross-origin frame draws our ElementImage into our transferred OffscreenCanvas | works | Canvas and snapshot must travel together. The frame can read the pixels back. |
| Our clicks land on our real element under the other origin's rendering | works | |
| ImageBitmap of drawn DOM over MessagePort / BroadcastChannel / to a popup | works | This is how the cross-tab demo moves content. |
| Same-origin iframe inside a drawable canvas | paints | |
| Cross-origin iframe inside a drawable canvas | blank | Excluded by read-back-allowed rendering. |

## Transport lab (`/transports/`)

49 routes tested live. In Chromium 157 headless: 30 work, 15 fail, 4 can't be tested there (no WebGPU adapter, no cross-origin isolation, one crash kept opt-in).

Works:
- ElementImage → its own canvas as 2D, as WebGL (`texElementSubImage2D`, element or ElementImage), on the main thread or in a worker.
- Worker owns the canvas, draws the snapshot, then `transferToImageBitmap()`, `createImageBitmap()` or `new VideoFrame()` to send pixels on. A cross-origin frame can do the same and send pixels back.
- Nested drawable canvases; a same-origin iframe as a drawable child; a page-wide overlay canvas with `pointer-events: none` (element hit-testable where drawn, page underneath still clickable).
- Pixels: ImageBitmap over MessageChannel, BroadcastChannel, cross-origin postMessage and `bitmaprenderer`; VideoFrame to a MessageChannel or worker; ArrayBuffer, Blob and data URL routes.
- Streams: `captureStream()` to `<video>`, MediaStreamTrackProcessor, `ReadableStream<VideoFrame>` to a worker, `ReadableStream<ImageBitmap>` to a cross-origin frame, MediaStreamTrackGenerator back into a `<video>`, WebRTC loopback, VP8 encode → bytes → decode.

Fails:
- ElementImage into any other canvas (2D or WebGL), `drawImage(ElementImage)`, `createImageBitmap(ElementImage)`, `new VideoFrame(ElementImage)`, `structuredClone`.
- VideoFrame and `ReadableStream<VideoFrame>` to a cross-origin document (`messageerror` / "chunk could not be cloned").
- MediaStreamTrack transfer (not transferable in this build).
- Sandboxed opaque-origin iframe inside a drawable canvas (blank).
- Hit testing outside the canvas box via `updateElementGeometry`.

Possible browser bug: `adoptNode()` of a drawable canvas into a same-origin iframe works if the canvas has never painted, and crashes the tab if it has (`/transports/crash-adopt.html`, button B).

## What this means

- The slot pattern is a real answer to "the DOM has to live inside the canvas": the markup stays in the light DOM and only the canvas moves into a shadow root.
- Reprojection across documents is a pixel stream plus input forwarding, not a shared snapshot. Semantics (selection, accessibility tree, find-in-page) stay in the source document.
- A native "draw this element by reference" hook for canvas (an id reference rather than DOM containment) would remove the need for the shadow root. An ElementImage that could be drawn into a second canvas would make cross-document reprojection first class; today it is deliberately bound to one canvas.
