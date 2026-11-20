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

## Transitions and motion (`/transitions/`, `/time-scrubber/`, `/particles/`)

| Experiment | Result | Why |
|---|---|---|
| Two slotted states as WebGL textures, re-uploaded every frame of a transition | works | Animations, typing, checkbox ticks and selection highlights show up on shards, folds and embers as they happen. |
| Press a button on a flying shard | works | WebGL draws don't move hit boxes, so the triangle under the pointer is found on the CPU and its affine matrix is given to `updateElementGeometry`. |
| Per-pixel routing through a burn mask | works | The shader's noise is mirrored on the CPU; `pointer-events` flips between the two states under the pointer. |
| Shared-element morph from sub-rectangles of the two state textures | works | No extra snapshots. The hole an element leaves is filled by smearing the pixels just outside it. |
| Upload a state that has never been painted (`visibility: hidden`) | fails | "No cached paint record for element." The first frame has to wait for a paint. |
| A modal `<dialog>` or popover inside a state travels with it | fails | The top layer is not part of the canvas child's picture. |
| Hold 600 ElementImages and draw the oldest | works | About 0.014 ms per capture here, against 0.26 ms and 33 MB for the same frames as ImageBitmaps. |
| Snapshot keeps drawing after its element changes, is removed, or the canvas is resized | works | After a resize its default size is recomputed for the new canvas grid. |
| Old snapshot drawn at 4× | sharp | It is replayed paint commands, not pixels. |
| `globalAlpha`, `filter`, `globalCompositeOperation` with `drawElementImage` | works | Enough for trails and ghosts. |
| `paint` event's `changedElements` | precise | Lists only children that repainted, including for a caret blink or a CSS animation. Moving elements share one snapshot across frames. |
| Select or query the text of a past frame | fails | ElementImage has `close()` and nothing else. Rewinding for real means storing state next to each frame. |
| Drawing an ElementImage | moves the hit box | The live element becomes hit-testable where its snapshot was last drawn. |
| Nine-argument `drawElementImage` (source rectangle) | works | The source rectangle is in the element's CSS pixels. The hit box moves as if the whole element had been drawn with that source-to-destination mapping. |
| Nested and inline `drawable` descendants drawn on their own | works | A parent's picture still includes them. |
| A particle per grapheme from `Range.getClientRects()`, no spans | works | Shaping, selection, links, `window.find()` and editing are untouched. |
| 1,000 upright glyph draws in 2D | works | About 17 ms in software rendering. |
| 1,000 glyph draws in 2D, each at its own angle | fails | About 1.5 s: each angle re-rasterises text. WebGL instanced quads from one texture cost well under 1 ms of script per frame for 400 glyphs. |
| `updateElementGeometry` after 2D draws in the same `paint` handler | works | It overrides the hit box the draws left behind, so pieces can be drawn anywhere while the element stays put. |
| Click a glyph in mid-air | fails | One element, one hit box. One drawable span per letter gets a hit box each, at the cost of an element per character. |

Not tested here: whether Chrome's find-in-page highlight is painted into an element's picture (needs a person at a real browser), and frame rates on a real GPU (these numbers are from software rendering).

## What this means

- The slot pattern is a real answer to "the DOM has to live inside the canvas": the markup stays in the light DOM and only the canvas moves into a shadow root.
- Reprojection across documents is a pixel stream plus input forwarding, not a shared snapshot. Semantics (selection, accessibility tree, find-in-page) stay in the source document.
- One element has one hit box. Effects that show an element in many pieces (shards, glyphs) can route one pointer correctly but not two, and a way to give `updateElementGeometry` several regions, or a hit-test callback, would close that gap.
- A native "draw this element by reference" hook for canvas (an id reference rather than DOM containment) would remove the need for the shadow root. An ElementImage that could be drawn into a second canvas would make cross-document reprojection first class; today it is deliberately bound to one canvas.
