# Declarative partial updates and `moveBefore()` (`/patch/`)

Measured in Chromium 157 (headless shell). Not yet run on the test phone.

| Question | Result | Notes |
|---|---|---|
| `<template for="name">` and `<?start name?>` … `<?end?>` ranges in a canvas child | work | In the document's own parse, in `document.write()`, and through the `stream…HTMLUnsafe()` methods. A streamed template patches a range that was in the document before the stream started. |
| Which methods apply a patch | only the streaming `Unsafe` ones | `streamAppendHTML()` and `appendHTML()` sanitise: processing instructions and patch templates are dropped. `appendHTMLUnsafe()` and `insertAdjacentHTML()` insert the template element and leave it unapplied. `innerHTML` applies a patch to a range in the same string only. |
| Content while the template is open | streams into the range | The range shows the part of the template that has arrived. |
| After the template closes | the `start` and `end` instructions are removed | A `<?marker?>` is consumed too. A repeatable patch writes new instructions inside its own content. |
| Paint events | one per chunk | No `requestPaint()`. `changedElements` names the nearest drawable element around the range, so with one drawable tile per range only that tile is uploaded. |
| A new `drawable` element inside a patch | drawn at the next paint | It has a picture when the `paint` event that follows its insertion runs. |
| `moveBefore()` on a drawable tile | state kept | Focus and selection of an input inside it, and the time of a CSS animation, are kept. The texture uploaded before the move is still the tile's picture. `insertBefore()` drops the focus and restarts the animation. |
| `moveBefore()` to a child of another canvas | works | Focus is kept and the second canvas gets `paint` events. |

## Not verified

- Chrome 159 on the test phone: whether it has `<template for>` and the `Unsafe` streaming methods. The page's first live check reports it.
- Chromium 153 has neither feature; the patch buttons are disabled there.

## For the index

- The canvas, the attributes and the paint event: each chunk of a streamed `<template for>` patch raises one `paint` event, and `changedElements` names only the nearest drawable element around the range (measured, C157, `/patch/`).
- The canvas, the attributes and the paint event: `moveBefore()` keeps the focus, animation time and uploaded texture of a drawable element (measured, C157, `/patch/`).
