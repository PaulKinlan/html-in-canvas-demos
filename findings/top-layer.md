# A tooltip, a modal and toasts beside the top layer (`/top-layer/`)

Ideas 18.2 and 18.3 of the backlog in PLAN.md, and "Toast stack in the scene" from the element catalogue. Measured in headless Chromium 157 (C157) on 2026-11-21 with a mouse, a keyboard and emulated touch at 412 px wide. The page's four live checks pass there, and `node tools/top-layer/check.mjs` drives the three demos with real input (22 steps, all pass). Nothing here has been run on a phone.

The question: a canvas cannot draw the top layer or a native tooltip. What can it do for a tooltip, a modal dialog and a toast instead?

| Experiment | Result | Why |
|---|---|---|
| Place of an inline element inside a rotated draw | `getClientRects()` gives it | A paragraph drawn rotated by 0.3 rad: the middle of a span's box was 0.1 px from the rotated place. The box is the bounding box of the rotated text (42.4 by 29.5 px for a 39 by 19 px span). |
| Tooltip as a `drawable` element with `role="tooltip"`, drawn above the term | works | Its text is set when a term becomes active, and it is drawn with a tail by the canvas. It has `pointer-events: none`. |
| Opening it by mouse, tap and keyboard | works | `pointerover` (mouse), `click` (tap) and `focusin` on the drawn terms. Escape and a tap elsewhere close it. Terms that are not focusable get `tabindex="0"`. |
| The browser's own `title` tooltip | removed | Each `title` is moved to `data-tip` at start. Whether headless Chromium would have shown the native tooltip is not known: it is painted outside the page. |
| The term drawn again, larger, in a clipped box | works | The card is drawn a second time through a clip at the term's box with a scale of 1.28, then marked with a `multiply` fill. A draw inside an empty clip puts the hit region back. |
| A link with a `title`, tapped | navigates | The tap follows the link, so on touch its tooltip is seen only with a mouse or the keyboard. |
| An open popover inside a `drawable` element | not in the picture | 0 of 50 sampled pixels had the popover's colour (live check). |
| Scene behind a modal dialog | drawn by the canvas from `dialog.open` | 84% size, `blur(3.5px) saturate(0.15) brightness(0.55)` over a dark fill. The `toggle` and `close` events of the dialog ask for a paint. The canvas total brightness fell below 60% and came back to within 1% after closing. |
| Hit testing the drawn scene while the dialog is modal | returns the dialog | The scene is inert. With `closedby="any"` a tap on it closed the dialog with no code. |
| The scene after the dialog closed | works | A checkbox took a tap. A filter on a draw does not move the hit region (live check). |
| `<dialog open>` as a `drawable` child of the canvas | drawn, buttons found | Needs `position: static`. Live check: pixel 29,35,48 inside it and its button returned by `elementFromPoint()`. |
| Toasts added while the page runs | drawn from the next paint | The first draw of a new element can fail because it has no picture yet. The paint loop tries again in the next frame. |
| A toast that is leaving | `inert`, then removed | Its hit region is shrunk to a point before it is removed. |
| A lost context | plain HTML | One `contextlost` event stops all three and shows the elements as plain HTML (3 boxes). Tested by dispatching the event. |

Idea 18.1, "Menu that stays readable on a tilted toolbar", is not built again here: `/popovers/` already opens popovers from buttons drawn in perspective and keeps them on the drawn button with CSS anchor positioning.

## Things that bit

- A live check must not open a modal dialog, because `showModal()` moves focus and the jank guard counts that. The modal facts are covered by `tools/top-layer/check.mjs` with real taps.
- `python3 -m http.server` stopped between two test runs. Start it again before running the tool.

## Not verified

- Chrome 159 on Android: all three demos by touch.
- A long press on a term. Android may show its own selection or link menu.
- The on-screen keyboard over the toast form, and where Android centres the modal dialog while the keyboard is open.
- A screen reader on the tooltip (`aria-describedby` to a drawn element) and on the toasts.
- Whether the native `title` tooltip would appear at the drawn place of a term with a real mouse, if the titles were left in place.

## For the index

- Hit testing and geometry: `getClientRects()` of an inline element in a drawn canvas child returns the bounding boxes of its drawn, rotated place (C157, `/top-layer/`).
- Top layer: an open popover is not in the picture of the element that contains it. A `<dialog open>` with `position: static` is drawn as a `drawable` child and its buttons work.
- Top layer: while a dialog is modal the canvas scene is inert and `elementFromPoint()` returns the dialog. The canvas can draw its own backdrop effect from `dialog.open`.
- Backlog: ideas 18.2 (tooltip drawn by the canvas) and 18.3 (modal that leaves the scene) are built on `/top-layer/`, with "Toast stack in the scene" from group 28. Idea 18.1 is covered by `/popovers/`.
