# ElementImage and OffscreenCanvas

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
