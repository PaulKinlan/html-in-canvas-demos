# CSS carousel as a cover flow (`/carousel/`)

Measured in Chromium 157 (headless shell) with synthetic touch, wheel, mouse and keyboard input. Not yet run on the test phone.

| Question | Result | Notes |
|---|---|---|
| A `drawable` element nested inside another drawable element | own picture | It is left out of the outer element's picture, can be uploaded on its own with `texElementSubImage2D()`, and `updateElementGeometry()` accepts it. |
| Drawable slides that scroll with the list | clipped pictures | The scroller's clip applies to a nested drawable element. A slide that is half out of the scroller's box uploads half empty. |
| Scroll snap when slides have hit boxes at their drawn positions | snaps to the drawn positions | A scroll to slide 3 came to rest between two slides. Snap areas use the geometry given to `updateElementGeometry()`. The snap stops must be elements the canvas does not move. |
| Hit boxes that follow tilted cards out of the canvas | pictures go empty | Cards whose hit box had been outside the canvas were drawn empty after they came back, with a perspective matrix and with an affine one. With no geometry call, or a hit box that stays inside the canvas, the pictures stayed whole. Cause not isolated; worth a reduced test case. |
| `::scroll-button()` and `::scroll-marker` drawn by the canvas | work | They are in the picture of the element that contains the scroller. A click or tap on the drawn button or dot scrolls the list. A full-width `::scroll-marker-group` laid over absolutely positioned buttons takes their clicks, in a canvas or out of one. |
| `scroll-state(snapped: x)` on a slide whose card is drawn | works | It restyles the card, and `changedElements` then names that card only. The page also uses it to set `pointer-events` on the snapped card's button. |
| `sibling-index()` in a custom property that a child uses | needs `@property` | Unregistered, the function is resolved on the element that uses the value, so every card got index 1. |
| Touch swipe and wheel over a card | scroll the list | The cards have `pointer-events: none` and the scroller is under them. |

The layout that works: the snap stops are plain list items; each card is a `drawable` descendant of its stop, positioned against the deck so that it neither scrolls nor is clipped; the canvas computes each card's place from `scrollLeft`.
