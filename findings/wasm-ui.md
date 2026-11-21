# A WebAssembly loop on the paint event (`/wasm-ui/`)

Measured in C157 (headless, 2.625 device scale, touch) on 2026-11-21. `native/wasm-ui/ui.c` is 170 lines of C built with `clang --target=wasm32 -nostdlib` (3 KB). Demo 28 of the Chrome APIs plan.

| Experiment | Result | Detail |
| --- | --- | --- |
| A C main loop that never returns, blocked on the canvas `paint` event through JSPI | works | `new WebAssembly.Suspending(wait_event)` on the import, `WebAssembly.promising(run)` on the export. The promise is settled in the `paint` listener and the program draws with `drawElementImage()` in the microtask that follows. |
| The loop is idle between events | works | 0 frames drawn during 30 animation frames. One changed field gives one paint event and one frame. A focused text field gives one frame per caret blink. |
| A blocking modal dialog made of a real element with two real buttons | works | `ask()` has its own loop, suspends in the same import two C calls deep, and returns 1 or 0 to `run()`. |
| Elements under the dialog take no input | works with `inert` | The browser hit tests an element where it was last drawn. The page sets `inert` on what the program draws as not interactive and on the dialog while it is not drawn. No `updateElementGeometry()` call was needed in a 2D canvas. |
| A tap reaches the program as a press and a release | needs a queue | Both pointer events can arrive between two paint events. The page queues pointer states and gives the program one per frame. |
| `requestPaint()` called inside a `paint` listener | works | It gives a second paint event. |
| Calling another export while `run()` is suspended | works | The C edge filter runs on the same memory. About 10 ms for 900×220 pixels read with `getImageData()`. |
| The edge filter as a WebNN graph on the element's pixels | not verified | `navigator.ml` is missing from C153 and C157. |

## Things that bit

- The first version of `ask()` waited before it drew, so the dialog appeared only after the next event. A nested loop has to draw first and then wait.
- A press and a release dispatched in one task were seen by the program as a single state. The pointer queue fixed it.
- `setPointerCapture()` throws for a synthetic pointer event, which stopped the listener in the live checks. The call is wrapped.
- A rule for `[data-ui]` also matched the buttons inside the dialog and stacked them at the canvas origin. The rule now matches only children of the canvas.

## Not verified

- WebNN. The graph code (cast, transpose, one 3×3 convolution with two filters, L2 norm, clamp, and the MLTensor calls) ran only against a JavaScript stand-in, where its output matched the C filter. The "Run the edge filter" button and the last live check on `/wasm-ui/` report the result in a browser with WebNN on.
- A real phone (A159): touch on the slider and dialog, the keyboard over the canvas, and whether the 2D canvas keeps its context on load.
- The slider and Delete button drawn by the program have no DOM node, so a screen reader cannot reach them. Not tested with one.

## For the index

- Paint event: a WebAssembly program can block on `paint` through JSPI and draw in the microtask after the listener. (`/wasm-ui/`)
- Hit testing: `inert` is enough to keep a drawn element from taking the pointer in a 2D canvas. (`/wasm-ui/`)
