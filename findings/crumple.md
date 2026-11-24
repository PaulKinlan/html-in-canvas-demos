# A receipt you can crumple and throw away (`/crumple/`, `lib/paper-mesh.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1 and 2.625, mouse, touch emulation and keyboard) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The ideas are Lorenzo Cabra's Crumpled Receipt and Matt Ölschlegel's CrumpledPaper Reveal, and the page links to both. The code and the copy are mine: I didn't read the source of either.

| Question | Result | Notes |
|---|---|---|
| A `<table>` in an element in a canvas has a picture | works | Live check: a cell's pixel is rgb(16, 32, 48). |
| A ball of paper from one element draw | works | Draw the receipt, `drawImage()` that rectangle of the canvas into a plain canvas, clear. Every later frame is 280 triangles from the copy (`drawSheet()`), until the receipt is flat again. |
| One triangle from a copy: clip, transform, `drawImage()` | works | Live check: the red half of a square lands inside the target triangle and nowhere else. |
| Time for 280 triangles | 2.6 ms in software at scale 2.625 | Live check, mean of 10 draws into a plain canvas. |
| Paint rate | 52 to 60 paints a second in software | Crumple, throw and smooth. Longest gap 19 to 41 ms; the longest is the first frame of a crumple, which has the element draw and the copy in it. |
| `inert` on a drawn element | works | Live check: `elementFromPoint()` at its button returns the canvas. The page also shrinks the hit box with `updateElementGeometry()`. |
| Hit box after `inert` is removed | works | One whole `drawElementImage()` puts it back. Live check. |
| Paint over an element | doesn't block it | Creases drawn over the receipt. Live check: its button is still hit. |
| An empty `<button>` as the thing you drag | works | Drawn at the paper's position each frame: 0 pixels, and `elementFromPoint()` returns it there. Pointer capture keeps the drag. A click smooths the paper, so Enter and Space do too. Its focus ring is drawn because `outline-offset` is negative. |
| `touch-action: none` on the empty button | works in emulation | A touch drag on the ball didn't scroll the page (CDP touch events). A drag on the empty canvas scrolled it by 135 px. |
| Where no child is drawn, the canvas is hit | works | Live check. |
| Keyboard | works | Enter on "Crumple it" moves focus to the ball button with `preventScroll`. Enter there smooths it and focus goes back to "Crumple it". The page didn't scroll. |
| Reduced motion | no animation | Ball and flat in one paint each. |
| No API | plain HTML | The receipt is shown. The crumple button, the bin and the ball are hidden. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 14.7 MB in canvases, no WebGL context. |

## Things that bit

- The first creases were bands 10 to 28 px wide across the whole receipt and covered the text. They're now 6 to 14 px wide and shorter.
- A straight blend from flat to ball looked like a bag being pulled shut. A random push out of the sheet for each grid point, largest half way, made it look like paper.
- A click follows a drag on a captured button. The page ignores the click that comes straight after a drag.

## Not verified

- The paint rate on a phone. The page sends a `crumple` report after each movement (move, paints, ms, rate, longest gap, scale).
- `touch-action: none` on a drawn child whose hit box moves, on a real touch screen. The page sends a `crumple` report if the browser cancels a drag.
- A screen reader on the ball button and the bin.

## Open ideas

- A real cloth or paper simulation for the folds, in place of a blend between two fixed shapes.
- The crease lines placed where the mesh actually folded.
- More than one receipt, and a bin that fills.
- The ball as a WebGL mesh with a lit normal map, through `lib/element-gl.js`.

## For the index

- Elements: a `<table>` inside a drawn element is in its picture. measured, C157, `/crumple/`.
- 2D drawing: a textured triangle mesh from one copy of an element. 280 triangles (clip, transform, `drawImage()`) drew in 2.6 ms in software at scale 2.625. measured, C157, `/crumple/`.
- Input: an empty button drawn each frame at a moving drawing gives that drawing a hit box, pointer capture, a click and keyboard focus. measured, C157, `/crumple/`.
- Input: `inert` on a drawn element takes it out of hit testing; a whole draw after removing it restores the hit box. measured, C157, `/crumple/`.
- Input: `touch-action: none` on a drawn child stops a touch drag on it from scrolling, while the rest of the canvas scrolls. measured in touch emulation, C157, `/crumple/`. Not verified on a phone.
