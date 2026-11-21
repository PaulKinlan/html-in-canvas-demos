# Focus trail, target sizes, label lines and heading outline (`/a11y-views/`)

Measured in headless Chromium 157 (C157) on 2026-11-21. Rows marked "input" were measured with real key presses, taps and a CDP finger drag by `node tools/a11y-views/check.mjs` at 412 px wide. The other rows are the page's 14 live checks. Not yet run on A159.

PLAN.md backlog group 21: "Focus ring that leads the eye" and "Heading outline beside the page". The page also builds "Label coverage check" (element catalogue, rank 3, backlog 28.25) and a target size view that was not on any list.

## The focus ring and the picture

| Question | Result | Detail |
|---|---|---|
| Is the browser's focus ring in the picture when the focused element is inside the drawable element | yes | A 4 px red outline at an offset of 2 px round an 80 by 30 button inside a drawable `div`. The div was drawn at 40, 40. Red pixels spanned 54, 54 to 146, 96. |
| Does moving focus raise a `paint` event | yes, one, if a pixel changes | The `div` was in `changedElements`. |
| The same with `outline: none` on the focused elements | 0 paint events for 2 focus changes | `focusin` fired both times, with `relatedTarget` null and then the first element. A trail must listen for `focusin`. It cannot wait for `paint`. |
| A ring that reaches past the border box of the drawable element | cut at the border box | The button was in the top left corner of its drawable parent. Only 120, 40 to 126, 70 was red: the part of the ring to the right of the button. |
| An outline round the drawable element itself | not in the picture | With `outline-offset: 2px` no red pixel, and still one paint event. With `outline-offset: -6px` red at 42, 42 to 118, 68. |
| Start and end of the trail when the fixture is drawn at half size at 100, 50 | at the drawn positions | Centres 115, 57.5 and 115, 82.5. The page has no code for the scale: `getBoundingClientRect()` reports the drawn box. |
| Touch tap on a drawn field, then on a drawn button (input) | focus moves, `focusin` reaches the canvas, the trail runs | Also with the form drawn at 60%. |
| Three Tab presses through the drawn form (input) | name, email, phone, country in order | Moves of 170, 178 and 170 px. The page did not scroll. |
| A rectangle of the form's picture drawn 12% larger at the focused control, then the form drawn again with `globalAlpha = 0` | the hit box is back | Without the second draw a point on another button returned the canvas. |

## Target sizes and labels

| Question | Result | Detail |
|---|---|---|
| A 40 by 40 button drawn at half size | a 20 by 20 target | `getBoundingClientRect()` gave 20 by 20. `elementFromPoint()` returned the button at 110, 70 and the canvas at 130, 90, which is inside the full-size box. |
| The demo form at 100% and at 60% (input) | 2 of 12 targets under 24 px, then 5 of 12 | At 60% no target is 48 px or more. A tap on the 60% "Order" button still focused it. |
| Source of a control's name | six kinds told apart | Wrapping `<label>`, `for=`, `aria-labelledby`, `aria-label`, placeholder only, nothing. A label whose `for` matches no id has `control === null`. |
| Box of a label's words from `Range.getBoundingClientRect()` when the label is drawn at half size at 100, 60 | follows the picture | 10, 10 and 58.9 px wide at full size. 105, 65 and 29.5 px wide at half size. |

## The heading outline

| Question | Result | Detail |
|---|---|---|
| Collecting headings from the DOM | works with a rule of about 15 lines | `h1` to `h6` and `role="heading"`, level from `aria-level`, 2 for a `role="heading"` with no level. Left out: `role="presentation"`, not rendered, inside `aria-hidden="true"` or `inert`. |
| A row of the outline as a rectangle of the article's picture | the heading's own pixels | `drawElementImage(article, 0, 30, 150, 30, 200, 100, 75, 15)` put the red of the heading at the row. |
| The article's hit box after the pieces | back after one whole draw | A point on a link in the article returned the link. A point on the row returned the canvas. |
| Links drawn with `globalAlpha = 0` | take the hit, leave no pixels | Two 44 px links. Each row returned its link. No pixel of the canvas had alpha. |
| Tap on a row (input) | the container scrolls to the heading and the heading has focus | `scrollTo()` on the container and `focus({ preventScroll: true })` on the heading. The ring flies from the row to the heading while the scroll runs. The page did not move. |
| Changing a heading's text | 1 paint event | The row changes with no code, because it is the same pixels. |
| Changing `aria-level` | 0 paint events | The list of headings is rebuilt from a `MutationObserver`. |
| A sticky drawable canvas in a scroll container with a spacer | scrolls natively | `scrollHeight` was 160 + 240 with a 600 px child in the canvas. Setting `scrollTop` raised 0 paint events and the canvas stayed at the top of the container. |
| Finger drag of 250 px on the drawn article (input) | the container scrolled 235 px, the page 0 px | |
| Tab from above the canvas to a link about 710 px down the article, below the 520 px canvas (input) | the browser scrolled the container to 480 px by itself | The link ended in the middle of the canvas. The page did not move. A second Tab went to a link at 969 px. The same with the page's own handler removed, so the page has no code for it. |

## Things that bit

- The focus checks run in the hidden copy of the page (`apart: true`). `runBench()` does not empty the test stage between checks, so the third fixture was below the stage's 340 px box. Its paint event still fired, but the ring was not in the picture and the check passed for the wrong reason. Each of those checks now empties the stage first and confirms `:focus-visible` matches before it reads pixels.
- The page takes focus back from the hidden copy after each check. A check that focused its fixture at once could lose the ring part way through. The checks wait 200 ms first.
- `elementFromPoint()` gave a stale answer for a point it had been asked about before the hit box moved. The checks toggle an attribute before each question.
- "Next stop" took focus itself, so every move started from outside the canvas and the order restarted at the first stop. The buttons cancel `mousedown` and the page remembers the last stop.

## Not verified

- Chrome 159 on the phone. Open `/a11y-views/` and tap the fields: the line under the first picture counts `focusin` events and names the focused control.
- TalkBack. Its accessibility focus is not DOM focus. Whether `focusin` fires when TalkBack moves to a control, and so whether the trail runs, was not measured. Move through the form with TalkBack and read the `focusin` count. Whether TalkBack reads the outline's links ("What a level means, level 2") and puts its own rectangle at the row was not measured either.
- Whether a field focused by "Next stop" keeps the on-screen keyboard down (`inputmode="none"` until the field is tapped).
- The frame rate while the article scrolls under a finger. Each frame draws the article (about 1,730 px tall at 412 px wide) once and one piece of it per heading.
- Windows High Contrast and forced colours. The ring, the tail and the plates use fixed colours.
- `:focus-visible` after a touch tap on a button. The canvas ring does not depend on it.

## For the index

- Drawing elements: an outline is in an element's picture only where it falls inside the border box of the drawable element. A focus ring on a descendant is drawn and is cut at that box. An outline round the drawable element itself is not drawn unless `outline-offset` is negative (measured, C157, `/a11y-views/`).
- The canvas, the attributes and the paint event: a focus change raises a paint event only if it changes a pixel of a drawable element. With `outline: none` it raises none. `focusin` bubbles to the canvas with `relatedTarget` set (measured, C157, `/a11y-views/`).
- The canvas, the attributes and the paint event: a change to `aria-level` raises no paint event (measured, C157, `/a11y-views/`).
- Hit testing and updateElementGeometry(): an element drawn at half size is hit only inside the half-size box, so drawing a control smaller makes its touch target smaller (measured, C157, `/a11y-views/`).
- Hit testing and updateElementGeometry(): `Range.getBoundingClientRect()` inside a drawn element follows the draw transform (measured at half size, C157, `/a11y-views/`).
- Input and hit testing: the Tab key scrolls a native scroll container that holds a sticky drawable canvas to bring a focused link of a drawn child into view, and does not scroll the page (measured with real key presses, C157, `/a11y-views/`).
- Accessibility: links drawn with `globalAlpha = 0` are Tab stops with a hit box at the drawn position and no pixels, so a canvas can draw a control's appearance itself and keep the element for input (measured, C157, `/a11y-views/`).
- Ideas built: "Focus ring that leads the eye" and "Heading outline beside the page" (`ELEMENTS.md`, rank 2, a11y; PLAN.md backlog 21.1 and 21.2). "Label coverage check" (`ELEMENTS.md`, rank 3, a11y; PLAN.md backlog 28.25).

## API requests

- A paint event, or a field on it, for a focus change inside a drawable element when no pixel changed. A canvas that draws its own focus ring has to listen for `focusin` as well as `paint`.
- A way to include the outline of the drawable element itself in its picture, or its ink overflow box. A canvas that wants the browser's ring round a drawable button has to draw one itself.

## Open ideas

- The trail for a screen reader's accessibility focus, if a page can learn where it is.
- A reading-order view: the order a screen reader visits the drawn content, as a path, beside the Tab order of `/focus-path/`.
- A contrast view: text pixels of each element read from a `drawImage()` copy on a tap, with the measured ratio on a plate.
- The outline for a whole page, with the page's sections drawn by one canvas.
