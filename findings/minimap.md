# Live minimap (`/minimap/`)

Measured in C157 (headless shell) on 2026-11-21, with a mouse wheel and with CDP touch events at 412 px. Not yet run on A159.

The page has two structures and a menu to switch between them. In both, every `<article>` has `drawable` and is drawn twice per frame: small in the strip, then at full size in the reading area.

| Question | Scroll container not drawable (default) | Scroll container drawable |
|---|---|---|
| Picture of an article scrolled out of view | whole | whole, if it has not repainted while cut (next row) |
| Article repaints while half outside the reading area | whole | the hidden half is transparent |
| Article repaints while its drawn position is in a part of the canvas outside the window | whole | empty |
| Does the hole heal | does not occur | Not on scroll and not on `requestPaint()`. A style change on the article while it is fully in view records it whole again. `remove()` and insert again did not. A clone was whole. |
| Wheel on a drawn article | goes to the page. The container does not scroll. | scrolls the container |
| Touch drag on a drawn article | pans the page | scrolls the container |
| Page Down from a focused control inside, `scrollTop` from script | scroll the container | scroll the container |
| `wheel` listener on the container | runs, but the event is not cancelable and the page scrolls too | not needed |
| `wheel` listener on the canvas | cancelable. The page uses this one. | not needed |
| `touch-action: none` on the container | stops the page panning | not wanted |

Other results:

| Question | Result | Notes |
|---|---|---|
| A drawable scroll container's own picture | background only | Its drawable articles are left out. |
| Scrolling a drawable container by script | raises one `paint` event | With no `requestPaint()`. |
| An article drawn at a sixth of its size | hit at the small copy | So an article that is out of view takes taps in the strip, where it was last drawn. |
| `updateElementGeometry()` with a scale of 0.001 | takes it out of hit testing | The strip's input then reaches the rail element. |
| `will-change`, `transform: translateZ(0)`, `contain: paint`, `isolation`, `overflow: scroll`, a background, `overscroll-behavior` on the non-drawable container | no change | Wheel still scrolls the page. |
| Changes to an article that is out of view (text, background, added lines) | show in the strip | Both structures. |

What the page does: the default structure, with scrolling by script. Wheel deltas and touch movement set `scrollTop`, a short coast follows a touch drag, and what is left over at either end is passed to `window.scrollBy()` during the drag.

## Things that bit

- The first version used the drawable container. One article was blank in the strip and in the reading area from page load. It was the one whose drawn position was inside the canvas and below the bottom of the window. Changing its content, toggling `drawable`, `display` and removing and inserting it again while the page was at the top did not bring it back.
- The same article was whole with `?nohold` and with a taller window, which hid the cause for a while.
- A probe that read alpha from the strip always read 255, because the rail's background is under the copies. Read colour.

## Not verified

- How the scripted touch scrolling feels on a phone next to native scrolling. Opening `/minimap/` on the phone and switching the "Scroll container" menu compares the two.
- The on-screen keyboard over the note field.
- Whether Chrome 159 still cuts the picture of a nested drawable. The check "The same with drawable on the scroll container" on the page reports it on the device that opens it.

## For the index

- Drawing elements: A drawable element inside another drawable element is recorded only where its drawn position is inside the canvas and the window at the time it repaints. The rest is transparent, nothing throws, and the hole stays until the element repaints while fully in view. Drawable elements whose ancestors are not drawable are always whole. measured, C157, `/minimap/`.
- Input and hit testing: The browser does not scroll a scroll container in a canvas for wheel or touch unless the container itself is drawable and has a hit region. A `wheel` listener on such a container is treated as passive. measured, C157, `/minimap/`.

## Chromium bugs

- Nested drawable elements get a cut or empty paint record that is not refreshed when they come into view (rows 2 to 4 of the first table). Reproduced in the page's live check with a 200 px container: draw the article half above the canvas, change its background, draw it whole, and the top half has alpha 0.
- A scroll container that is a non-drawable child of a drawable canvas does not take user scrolls from its drawn descendants, and a `wheel` listener on it does not make wheel events cancelable.

## API requests

- A way to ask for the whole picture of an element whatever is clipped or off screen, or a documented rule for when a paint record is cut.

## Ideas built

- "Live minimap of a page" from `public/elements/ideas.js` (structure). The strip is a sixth of full size at 412 px, not a tenth: it is as wide as a thumb needs.

## Open ideas

- A minimap of the whole document. It needs every article of the page inside one canvas, which the site's page skeleton does not allow. A stand-alone page could try it.
- Search hits and text selections marked in the strip, from `Range.getClientRects()`.
