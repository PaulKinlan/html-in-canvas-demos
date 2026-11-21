# Focus order drawn as a path (`/focus-path/`, `lib/devtools/focus-path.js`)

Measured in headless Chromium 157 (C157) on 2026-11-21. Tab presses were real key events from `node tools/devtools-pages/verify.mjs`. The other rows are the page's live checks.

| What | Result | Detail |
|---|---|---|
| Tab order worked out from the DOM against the real Tab key | agrees | Six arrangements of the page (as in the document, last group drawn first, turned with `tabindex="1"`, last group not drawn, last group inert with a disabled field, details open), 9 to 15 stops each. Every press landed on the next stop of the drawn path. |
| Positive `tabindex`, then tree order | works | Five stops in a fixture: order `d b a c e`. |
| Elements that Tab skips | left out | Disabled, inside `inert`, `tabindex="-1"`, `type="hidden"`, `display: none`, `visibility: hidden`, a link in a closed `<details>`, an unchecked radio button. |
| `tabIndex` of an editing host and of a scroll container with nothing focusable inside | -1, and both are Tab stops | The rule tests for them separately. |
| Position of a stop | the drawn box | `getBoundingClientRect()` gave 150, 90 for a button laid out at 0, 0 and drawn at 150, 90. |
| Position under a draw turned 30 degrees | bounding box, same centre | An 80 by 30 button reports 84 by 66. The centre is the centre of the button. |
| A child of the canvas that is not drawn | still a Tab stop | Tab moved focus to all four stops of a group that was not drawn. The page lists them in a strip. |
| `inert` on the group that is not drawn | removes its stops | 14 stops became 9 (with the disabled field). |
| Opening a `<details>` | adds the stops inside | The path is worked out again from a `toggle` listener and a MutationObserver. |
| A positive `tabindex` inside the canvas | first in the whole document | Tab from the top of the page went to "Sign up" before the menu bar. Tab from the element before the canvas skipped it. |

## Things that bit

- `tabIndex >= 0` is not the whole rule. `contenteditable` elements and keyboard-scrollable containers report -1.
- Positive `tabindex` values are ordered across the document, not inside the canvas. The first version of the Tab comparison started just before the canvas and never reached the element.
- Under a rotation the outline round a stop is its bounding box. `getBoxQuads()` does not exist in Chromium, so the page has no turned outline to draw.

## Not verified

- A phone: there is no Tab key. The "next" key of the on-screen keyboard and TalkBack's swipe order were not run. With a keyboard connected, press Tab and read the count in the status line under the picture.
- Shadow trees, slots, frames, `focusgroup` and `reading-flow` are not followed by the rule.

## For the index

- Hit testing and updateElementGeometry(): `getBoundingClientRect()` after a rotated draw is the bounding box of the drawn element, and its centre is the element's centre (measured, C157, `/focus-path/`).
- Accessibility: a Tab order worked out from the DOM (positive `tabindex`, then tree order, minus disabled, inert, hidden and unchecked radio buttons) matched the real Tab key for canvas children in six arrangements (measured, C157, `/focus-path/`).
- Accessibility: a canvas child that is not drawn is a Tab stop until it is `inert` (measured with the real Tab key, C157, `/focus-path/`). This confirms the earlier rule in DESIGN.md.
- Ideas built: "Focus order shown as a path" (`ELEMENTS.md`, rank 1, a11y).
