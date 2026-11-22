# Visual node graph made of live HTML forms (`/node-graph/`)

Built on 2026-11-22. Inspired by node editors such as Blender Shader Nodes, ComfyUI, cables.gl, Rete and React Flow, and building on `/board/` (which showed that 2D `drawElementImage()` re-rasterises DOM vector paint commands sharply at any zoom scale). Source checked with `npm run check:gfx` and `node tools/writing/check.mjs --strict`. Live browser execution in headless Chromium 157 (C157) and Chrome 159 on Android (A159) is **not verified** in this run; the six checks on the page run on isolated fixtures in the visitor's browser and report their own pixel and hit-test measurements directly.

The question: can an infinite pan-and-zoom node graph draw glowing Bézier wires behind draggable HTML `<form>` nodes on one 2D canvas so text stays sharp from 35% overview to 300% zoom without CSS-transform blur?

| Experiment | Status | Notes |
|---|---|---|
| Drawing a `<form drawable>` node at 2.5x zoom via `drawElementImage()` | Not verified | Live check 1 scales an isolated form node to 2.5x, copies the canvas into a plain 2D canvas via `drawImage()`, and checks luminance contrast and sharp pixel step transitions across the scaled text and border. |
| Hit-testing a moved and zoomed form control | Not verified | Live check 2 translates an isolated `<form drawable>` to `(45, 24)` at 1.8x zoom, toggles `data-hit` to clear Chromium's hit-test cache, and checks `document.elementFromPoint()` over its button. |
| Layering glowing cubic Bézier wires behind form nodes on one 2D canvas | Not verified | Live check 3 strokes a red cubic Bézier wire across the canvas before calling `drawElementImage()` for an opaque white card, then verifies wire pixels stay visible outside the node while the node centre stays solid white. |
| Live rewiring of output and input ports updating the computed graph output | Not verified | Live check 4 runs `evaluateGraph()` and `buildPreviewSvg()` on a routed 4-wire chain vs a bypassed 1-wire chain (`gen:signal -> out:signal`) and confirms `transformed`, `paletteActive` and the SVG output update deterministically. |
| Parking an off-screen node with `updateElementGeometry()` | Not verified | Live check 5 draws a node button, confirms hit-testing hits it, skips `drawElementImage()` on the next paint while parking it off stage with `updateElementGeometry()`, and checks that the old coordinates no longer hit the button. |
| Context loss fallback and visible canvas survival (`stillDrawn()`) | Not verified | The page listens for `contextlost` and `contextrestored`, moving the four `<form>` nodes into a plain CSS grid with a visible notice on loss. Live check 6 runs `stillDrawn()` on a plain `drawImage()` copy of `#graph-canvas`. |

## Things that bit

- Measuring port anchor coordinates with `getBoundingClientRect()` depends on the canvas's current zoom and DPR, which drifts during drags. Walking `offsetTop` from each `.port-btn` up to its `<form>` gives exact graph-space coordinates that stay locked to the port dots at any zoom level.
- Toggling a DOM attribute on a drawable form inside `paint` can trigger another `paint` event. Clearing Chromium's hit-test cache (`node.el.dataset.hit = ...`) only when a node drag, pan or zoom settles avoids a paint loop while keeping form inputs clickable in their new positions.
- Putting a second `<canvas>` inside `#node-out` for the live pattern swatch would add a second context and more backing-store memory. Rendering the procedural Sine, Spiral, Checker and Plasma swatch as an inline `<svg>` keeps the page to one 2D canvas and lets the swatch vectors re-rasterise cleanly at 300% zoom alongside the form labels.
- Starting continuous `requestAnimationFrame` pulse animation on load burns battery and risks jank checks on low-end phones. Signal pulses start off, pause automatically when the stage leaves the viewport or the tab hides, and stay off when `prefers-reduced-motion: reduce` is active.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /node-graph/` and `node tools/draw-size/audit.mjs /node-graph/`): run both to verify zero layout shift, backing-store sizing at 412 px wide and scale 2.625, zero timed readbacks, and all six live check results.
- Chrome 159 on Android at 412 px wide by touch: 1-finger background panning, 2-finger pinch zoom from 35% to 300%, dragging node headers, tap-to-wire and drag-to-wire on port buttons, interacting with native `<select>`, `<input type="range">` and `<input type="color">` controls at 250% zoom, and minimap tap-panning.
- Visual sharpness comparison at 250% to 300% zoom on a HiDPI screen against a CSS `transform: scale(2.5)` baseline.

## For the index

- 2D canvas and zoom: `/node-graph/` draws four draggable HTML `<form>` nodes on one pan-and-zoom 2D canvas (35% to 300%) with glowing cubic Bézier wires behind them, a live SVG preview node and a corner minimap.
