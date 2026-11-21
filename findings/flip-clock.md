# Flip clock from a time element (`/flip-clock/`)

Measured in Chromium 157 (headless shell), 2026-11-21, at 412 px wide with a device scale factor of 2 and at 1100 px wide. Not yet run on the test phone (Chrome 159 for Android).

Idea built: "Flip clock from a time element" from `public/elements/ideas.js` (rank 2, text).

| Question | Result | Notes |
|---|---|---|
| Does changing the text of a `<time>` element fire `paint`? | measured: yes | 1 paint event per change, `changedElements` holds the time element. |
| Does an animation of a registered custom property (`@property --flip`) fire `paint`? | measured: no | 0 paint events in a 400 ms animation. |
| The same animation with `border-top-color: rgb(0 0 0 / calc(var(--flip) * 0.02))` on the element | measured: one paint event per frame | 25 paint events in 400 ms. `getComputedStyle()` inside the handler returned an interpolated value in 23 of them. The colour change cannot be seen. |
| Can a flip animation run with no `requestAnimationFrame()` and no `requestPaint()`? | measured: yes | A fixture clock drew 33 paint events during one 520 ms flip and 0 in the 400 ms after it, with 0 calls to either function. On the page, 170 to 351 paint events in 10 seconds and 2 `requestPaint()` calls in total (canvas size, scrolling into the window). |
| `captureElementImage()` in a timer, just before the text changes | measured: keeps the old digits | The last digit's box drew 667 pixels from the snapshot (4) and 575 from the live element (1). |
| An animated CSS counter shown with `content: counter()` | measured: fires `paint` for each new number | 7 paint events in 700 ms for a counter that steps 10 times a second. No script changes the text. |

## Things that bit

- A non-inherited registered property is not visible to the element's `::after`. A first test that used `--flip` for the opacity of a pseudo-element measured nothing, because the pseudo-element read the initial value. The test was removed.
- `fill: 'forwards'` keeps `--flip` at 1 after the animation, so the last paint draws the settled clock. Without it the value falls back to the initial value. The initial value is 1 for the same reason.
- The old text is compared with the new text by index, so only the digits that differ flip. A time zone change flips most of them.
- `margin-right: -0.14em` on the digits takes off the letter spacing after the last digit, which would otherwise push the centred line to the left.

## Not verified

- Chrome 159 for Android. Whether the timer and the animation stay in step when the browser throttles timers, and the paint count per second there. The status line reports it.
- Battery cost against a `requestAnimationFrame()` loop. Not measurable in the test browser.
- `prefers-reduced-motion: reduce`: the code skips the animation, so the digits change without a flip. Not run.

## Open ideas

- A clock with no script: the digits from animated counters in generated content, with the flip progress from a second animation. The measurement above says the paint events would arrive.
- The same paint-driven clock for a `<progress>` or `<meter>` whose value changes.

## For the index

- The canvas, the attributes and the paint event: an animated registered custom property fires `paint` every frame once a painted colour is computed from it, and nothing by itself; `getComputedStyle()` in the handler gives the progress. A canvas animation can run with no frame loop (measured, C157, `/flip-clock/`).
- The canvas, the attributes and the paint event: generated content from an animated CSS counter fires `paint` (measured, C157, `/flip-clock/`).
- Ideas built from `public/elements/ideas.js`: "Flip clock from a time element" is `/flip-clock/`.
