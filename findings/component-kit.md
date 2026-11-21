# Newer DOM features in a drawable custom element (`/component-kit/`)

Tested in headless Chromium 157 at 1x, 1.5x and a phone profile. `<kit-slot>` and `<kit-field>` in `public/component-kit/kit.js` are written with each feature and with the code it replaces; the page runs both.

| Feature | Result | Detail |
| --- | --- | --- |
| Scoped `CustomElementRegistry` on the shadow root that holds the element | works | The element draws its slotted children and `elementFromPoint()` on that root returns them at the drawn position. A scoped registry does not change how the canvas finds slotted children. Two classes share one tag name on one page. |
| `slotAssignment: 'manual'` with `slot.assign(child)` | works | The assigned child is drawn. An unassigned child has no box, cannot take focus and needs no `slot` attribute. A child added later is not drawn until script assigns it. |
| Reference Target (`shadowRoot.referenceTarget`) for an input that is a canvas child | works | A `<label for>` in the page focuses the input and labels it. `label.control` is the host. The target must be inside the shadow root, so it cannot name a slotted light-DOM child. |
| `using` with `ElementImage` | needs a wrapper | `ElementImage` has `close()` and no `[Symbol.dispose]`. `DisposableStack.adopt(image, (i) => i.close())` or a wrapper object closes it at the end of the block, at an early return and on a throw. Drawing a closed image throws `InvalidStateError`. |
| `using` as a feature check | needs its own module | It is syntax, so the code that uses it is in `using.js` and loaded with `import()` after a parse test. |
| `canvas.when('paint')` (Observable) | works | Same events as `addEventListener('paint')`. `map()`, `take()` and an AbortSignal work. |
| `moveBefore()` into a host that slots the node into a canvas | works | Focus stays and an iframe inside does not reload. `replaceWith()` plus `append()` reloads the iframe once. `surface.js` (fx, dom-lens, physical-ui) and `dom-portal.js` now wrap with `moveBefore()` where it exists. |
| `:has-slotted` | not in Chromium 157 | Not tested. |

Lines in the element, old code against new: registry 11 to 5, slots 15 to 6, label 15 to 1, closing snapshots 22 to 21, paint handlers 13 to 6. `moveBefore()` adds lines because the old path stays as the fallback. The page counts these from the running source.

Not confirmed on a phone: which of the six features Chrome 159 on Android reports, and whether the three small canvases on the page keep their contexts there.
