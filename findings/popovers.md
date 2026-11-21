# Native popovers on a tilted panel (`/popovers/`)

Measured in Chromium 157 (headless shell), 2026-11-21, with synthetic mouse, touch and keyboard input. Not yet run on the test phone.

| Question | Result | Notes |
|---|---|---|
| Anchor rectangle of an element inside a drawn canvas child | the bounding box of its drawn quad | With a 50 degree turn and perspective, a 60 by 30 pixel button anchored a popover at a 34 by 29 pixel box at the projected place. `getBoundingClientRect()` returns the same box. Chromium 153 uses the layout box. |
| An open popover while the matrix changes | follows | `updateElementGeometry()` in each `paint` event is enough. No script positions the popover. |
| `commandfor` with `toggle-popover`, `hide-popover`, `show-modal` from a button drawn in perspective | works | By mouse, tap and keyboard. The target is outside the canvas. |
| `interestfor` on a drawn button | works | The hint opened on hover over the drawn place and on keyboard focus. Long press on touch is not verified. |
| Dragging a range input on a panel that turns under the pointer | works | The thumb moved with a synthetic mouse drag while each `input` event changed the matrix. |
| `anchored(fallback: flip-block)` container query on a popover anchored into a canvas | applies | The arrow moves to the other edge when `position-try-fallbacks` flips the popover. Seen in screenshots; no live check. |
| Hit testing a point of the demo that is outside the window | returns nothing | `elementFromPoint()` needs the point in the viewport. The run button for checks that hit test the visible demo sits under the demo, not in the checks section. |

## Not verified

- Chrome 159 on the test phone. Chromium 153 anchors to the layout box, so the phone may place the popovers at the panel's untransformed position. The page's third and fourth live checks report it.
- Long press on touch for the `interestfor` hint.

## For the index

- Hit testing and geometry: the CSS anchor rectangle of an element in a drawn canvas child is the bounding box of its drawn quad, also under perspective (measured, C157, `/popovers/`).
