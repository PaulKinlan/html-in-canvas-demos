# A WebAssembly loop on the paint event (`/wasm-ui/`)

Tested in headless Chromium 157 at a 2.625 device scale with touch. `native/wasm-ui/ui.c` is 170 lines of C built with `clang --target=wasm32 -nostdlib` (3 KB). Demo 28 of the Chrome APIs plan.

| Experiment | Result | Detail |
| --- | --- | --- |
| A C main loop that never returns, blocked on the canvas `paint` event through JSPI | works | `new WebAssembly.Suspending(wait_event)` on the import, `WebAssembly.promising(run)` on the export. The promise is settled in the `paint` listener and the program draws with `drawElementImage()` in the microtask that follows. |
| The loop is idle between events | works | 0 frames drawn during 30 animation frames. One changed field gives one paint event and one frame. A focused text field gives one frame per caret blink. |
| A blocking modal dialog made of a real element with two real buttons | works | `ask()` has its own loop, suspends in the same import two C calls deep, and returns 1 or 0 to `run()`. |
| Elements under the dialog take no input | works with `inert` | The browser hit tests an element where it was last drawn. The page sets `inert` on what the program draws as not interactive and on the dialog while it is not drawn. No `updateElementGeometry()` call was needed in a 2D canvas. |
| A tap reaches the program as a press and a release | needs a queue | Both pointer events can arrive between two paint events. The page queues pointer states and gives the program one per frame. |
| Calling another export while `run()` is suspended | works | The C edge filter runs on the same memory. About 10 ms for 900×220 pixels read with `getImageData()`. |
| The edge filter as a WebNN graph on the element's pixels | not measured | `navigator.ml` is missing from both test browsers. The graph code ran only against a JavaScript stand-in for the WebNN calls, where it matched the C filter. |
