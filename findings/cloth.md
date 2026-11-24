# A notice printed on cloth (`/cloth/`, `lib/cloth-mesh.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1 and 2.625, mouse, touch emulation and keyboard) on 2026-11-24. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The ideas are Jesper Landberg's cloth posters, Thomas Richter-Trummer's HTML cloth and the Cloth component in CanvasUI, and the page links to all three. The code and the copy are mine: I didn't read the source of any of them.

| Question | Result | Notes |
|---|---|---|
| An element drawn as a moving cloth | works | One element draw, a `drawImage()` copy of that rectangle of the canvas, then 216 triangles from the copy each frame (`drawCloth()`, with `drawTriangle()` from `lib/paper-mesh.js`). |
| A draw with `globalAlpha` 0 under a sheared matrix moves the hit box | works | Live check: 0 pixels painted, the button is found at 222, 98 and not at 60, 60. |
| Controls hit where the cloth draws them | works at the pointer | `triangleAt()` gives the matrix of the triangle under the pointer. One alpha 0 draw under it on `pointermove`, on `pointerdown` (capture phase) and on each frame. Live check on a bent cloth. |
| The same with a held corner | works | Mouse holds the left corner up. The checkbox, drawn 30 px from its flat place, is ticked by a touch tap at the drawn place. The button counts a press. |
| One matrix for the whole cloth | wrong away from its triangle | Live check: the matrix of a corner triangle misses the button in the middle of a bent cloth. |
| Touch taps on the moving button | 4 of 4 in emulation | The alpha 0 draw in the `pointerdown` listener is in time for the click. |
| A control that changes while the cloth moves | new copy | `click`, `input` and `change` on the article set a flag and the next frame copies again. |
| Coming to rest | works | A pull towards each point's flat place stands in for weight. Live check: 40 px from flat to 0.66 px in 4 seconds of steps. When the cloth is within 1.2 px of flat and slow for 0.25 s, the element is drawn again. |
| Cost of a frame | 2.9 ms in a live check | Two steps and 216 triangles at scale 2.625. Script on the page: 1.1 to 1.5 ms a paint. |
| Paint rate | 41 to 47 a second at scale 2.625, 60 at scale 1, in software | Longest gap 29 to 45 ms. The same with and without the alpha 0 draw, so the time is in filling the triangles. |
| Corners as empty buttons with `touch-action: none` | works in emulation | A touch drag on a corner moved it to 174, 158 with no scroll. A touch drag on the cloth scrolled the page by 135 px. |
| Scrolling the page swings the cloth | works | A `scroll` listener pushes each point by the scroll distance. |
| Keyboard | works | Enter on a corner button tugs it. Enter on the article's button presses it while the cloth moves. |
| Reduced motion | no swing from scroll | A gust lasts 1.4 s and then the cloth is flat at once. |
| No API | plain HTML | The article is shown and its controls work. The corner buttons are hidden. |
| `npm run check:jank` | passes | cls 0, 0 reads, 18.6 MB in canvases, no WebGL context. `/crumple/` passes with the changed `drawTriangle()`. |

## Things that bit

- Pale lines between triangles. `drawTriangle()` drew exactly the triangle's box of the copy, and its clip path is 0.6 px larger, so the rim of each clip was empty. It now draws 1 px more on each side. `/crumple/` uses the same function and gets the fix.
- With gravity, the links stretched and the cloth came to rest 8.8 px from flat, so the element was never drawn again. Gravity is now 0 and a pull to the flat place does its job.
- In a live check I worked out by hand where a sheared matrix puts a point and got it wrong (172 for 222).
- CDP touch events with two fingers didn't hold the first finger down. The held-corner test uses the mouse to hold and a touch to tap.

## Not verified

- The paint rate on a phone. The page sends a `cloth` report after each disturbance (paints, rate, longest gap, script ms, how far from flat, scale).
- Taps on the moving cloth on a real touch screen, and `touch-action: none` on the corner buttons there. The page sends a report if the browser cancels a corner drag.
- Whether the `scroll` push feels right with a phone's momentum scrolling.
- A screen reader while the cloth moves.

## Open ideas

- Several notices in a native horizontal scroller, each draping as it's scrolled, which is what Jesper Landberg's carousel does.
- Perspective, with a 4 by 4 matrix for the triangle given to `updateElementGeometry()`.
- The cloth through `lib/element-gl.js`, with smooth shading in place of flat triangles.
- A hit box for each of two fingers isn't possible with one element. A second, invisible copy of the article could carry the second finger's hit box.

## For the index

- Hit testing: an element drawn as a mesh can be hit where it's drawn by giving it the matrix of the triangle under the pointer, with one alpha 0 `drawElementImage()` on `pointermove`, `pointerdown` and each frame. measured, C157, `/cloth/`.
- Hit testing: an alpha 0 draw under a sheared 2D matrix moves the hit box and paints nothing. It works in a capture-phase `pointerdown` listener, in time for the click of a touch tap (emulation). measured, C157, `/cloth/`.
- 2D drawing: 216 triangles over 270 by 350 px took 2.9 ms; the page reached 41 to 47 paints a second in software at scale 2.625. measured, C157, `/cloth/`.
- Our mistake: a clipped `drawImage()` of exactly a triangle's box leaves an antialiased seam; draw 1 px more. `/cloth/`, `/crumple/`.
