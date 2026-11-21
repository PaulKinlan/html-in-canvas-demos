# Tab switcher of live pages (`/tab-fan/`)

Measured in C157 (headless shell, 412 px wide, touch emulation) on 2026-11-21. Not yet run on A159.

Four to seven same-origin iframes are canvas children with `drawable`. Each holds a page from `/tab-fan/app/`. The pages share state over a `BroadcastChannel`.

| Question | Result | Notes |
|---|---|---|
| Same-origin iframe drawn rotated and scaled | works | 100% ink in the middle of a card rotated by 20 degrees. |
| Tap inside a rotated card | reaches the framed page at the right place | A touch tap on the Start button of the Timer card, drawn rotated at 0.63 scale, started the timer. Two seconds later the Notes card's footer showed "Timer 00:02". |
| Typing in the open card | works | Tap the textarea in the Notes card and type: the character count in the frame went from 47 to 50. |
| A change inside the framed document | raises the outer canvas's `paint` event | Timer ticks, typing and a colour set by a channel message. The page runs no timer for the cards. |
| `iframe.contentDocument.title` inside `paint` | readable | The title bars are drawn from it. |
| Two drawn iframes overlap | the one drawn last is hit | Tested in both document orders. In a 2D canvas the picture and the hit testing agree. This differs from the note "hit testing follows document order" recorded for WebGL geometry on `/carousel/`. |
| Layout size of a frame while its card grows | unchanged | The iframe stays 300 by 440 CSS px. Only the drawn scale changes, so the framed page does not reflow. |
| Cards dropped below the canvas | keep running | Their hit regions are parked at a point with `updateElementGeometry()`. |
| Adding and removing iframes from click handlers | no crash | Never inside `paint`: that crashes Chromium 157 (recorded on `/iframe-tiles/`). Live checks leave the `paint` event with a timer before the harness removes a fixture. |

## Things that bit

- The title bars are canvas drawing, so the page hit tests them with the inverse of each card's matrix. `ctx.getTransform()` is in canvas pixels, so the pointer position is multiplied by `canvas.width / canvas.clientWidth` first.
- A drag that starts on a card belongs to the framed page. The fan turns only from a drag that starts on a bar or the background, or from the arrow buttons.

## Not verified

- Text entry in a rotated card with the on-screen keyboard, and scrolling inside a rotated card by touch.
- How many live iframes a phone keeps drawing smoothly. "Open another page" goes up to seven.
- Whether Android throttles or freezes frames whose cards are parked.

## For the index

- Across workers, tabs, origins and devices: A same-origin iframe drawn rotated and scaled takes taps and typing at the drawn position, and changes in its document raise the canvas's `paint` event. measured, C157, `/tab-fan/`.
- Input and hit testing: Where two elements drawn by a 2D canvas overlap, the one drawn last is hit, in either document order. measured, C157, `/tab-fan/`.

## Ideas built

- "Tab switcher of live pages" from `public/elements/ideas.js` (frames).

## Open ideas

- Navigation inside a card (`<a href>` between the app pages) with the bar following `contentDocument.title` and a back mark that calls `contentWindow.history.back()`.
- The same fan in 3D through `lib/element-gl.js`, with perspective on the cards.
