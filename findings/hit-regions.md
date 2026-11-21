# Hit region viewer (`/hit-regions/`, `lib/devtools/hit-map.js`)

Measured in headless Chromium 157 (C157) on 2026-11-21 by the page's live checks, by `node tools/devtools-pages/verify.mjs` (the real click) and by one-off scripts (the last three rows). The viewer asks `document.elementFromPoint()` at the centre of each 8 px square.

| Case | Result | Detail |
|---|---|---|
| A straight 2D draw | region equals the drawn box | 50 of 50 squares agree. |
| A draw turned 45 degrees | region turns with it | 86 squares agree, 2 on the edge differ. A corner of the bounding box hits the canvas. |
| The same element drawn twice | only the second draw is hit | 66 squares show the button and are not hit. |
| A draw under a clip | region is not clipped | The hidden half hits the button where the pixel has alpha 0. |
| `globalAlpha = 0` | still hit | 49 squares hit and show nothing. |
| Two elements overlapping | the later draw is hit | Checked in both orders. |
| An element no longer drawn | keeps its region | Asked after a frame that drew nothing and an attribute toggle. |
| `updateElementGeometry()` after a 2D draw | moves the region | In the visible page, under an emulated device pixel ratio of 2, the matrix had to be in canvas buffer pixels: `translate(x * k, y * k).scale(k)`. FINDINGS.md records that this differs between canvases, and the viewer shows where the region lands. |
| `drawImage()` copy of an element's pixels | not hit | A tap on the copy reaches the canvas. |
| `elementFromPoint()` at a point asked before a 2D redraw moved the element | returns the old element | A change to an attribute or to text clears it. |
| How many points are remembered | 2 | After two other points were asked, the first point gave the new answer. |
| `elementsFromPoint()` at a remembered point | new answer | It does not use the memory. |
| A real mouse click at a remembered point | went to the new target | One run with a mouse. |
| How long a remembered answer lasts with no document change | 240 frames and more in a page with one canvas; 14 to 20 frames on `/hit-regions/` | The reason for the difference is not known. A MutationObserver on the document saw no change. |

## Things that bit

- The first version of the last case scanned the whole grid without changing the document and expected stale squares. There were none: with a memory of two points, a scan of 2,500 points never reads a remembered answer. The case now asks two fixed points on every frame.
- Writing the counts into the status line on every pass changed the document and cleared the memory. The counts are drawn in the canvas.
- `elementFromPoint()` returns null outside the window and another element where the menu bar or a check fixture covers the canvas. Those squares are left without a tint.
- The check fixtures need `pointer-events: auto` on the shared test stage, which other pages set to `none`.

## Not verified

- A finger on a phone. Touch adjustment may send a tap near an edge to an element that `elementFromPoint()` does not report. Tap near the edges of the button and compare the two lines in the status text.
- Whether a tap (not a mouse click) at a remembered point uses the memory.
- WebGL and WebGPU canvases. The viewer's recorder wraps the 2D `drawElementImage()` only.

## For the index

- Hit testing and updateElementGeometry(): where two elements overlap in a 2D canvas, the element drawn later is hit (measured in both orders, C157, `/hit-regions/`).
- Hit testing and updateElementGeometry(): a clip on the context does not clip the hit region of a 2D draw (measured, C157, `/hit-regions/`).
- Hit testing and updateElementGeometry(): the remembered hit-test answer applies to plain 2D draws too, holds the last two points asked, is not used by `elementsFromPoint()`, and did not affect one real mouse click (measured, C157, `/hit-regions/`). This narrows Chromium bug 6 in FINDINGS.md.
- Ideas built: "Hit region viewer" (`ELEMENTS.md`, rank 2, tools).

## Chromium bugs

- Addition to bug 6 (`updateElementGeometry()` does not invalidate the cached hit-test result): the same happens after a 2D `drawElementImage()` moves an element. The cache holds two points. `elementsFromPoint()` is not affected.

## API requests

- A call that returns the hit region of a drawn element as a shape, or the element's drawn quad. The viewer samples 2,500 points to draw what the browser already knows.
