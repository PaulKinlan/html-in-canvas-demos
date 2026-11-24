# A canvas only while something moves (`/canvas-on-demand/`, `lib/canvas-on-demand.js`)

Measured in C157 (headless shell, software rendering, 412 px and 1280 px wide, device scale 1 and 2.625, mouse, touch emulation and keyboard) on 2026-11-24. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The idea is VFX-JS Transitions by AMAGI, which wraps an element in a canvas only while a transition plays, and the page links to it. The code and the copy are mine: I didn't read its source.

| Question | Result | Notes |
|---|---|---|
| A canvas made when a transition starts and removed when it ends | works | `wrap()` makes a drawable canvas of the card's size in the card's place and moves the card in. `unwrap()` moves it out, removes the canvas and calls `__gfx.retire()`. |
| `moveBefore()` into a new canvas keeps focus, and out again | works | Live check, and on the page by mouse, touch and Tab then Enter: "kept" in the table. |
| The same move with `insertBefore()` | loses focus | Live check, expected to fail: focus is on `<body>`. |
| Typed text and a selection survive the move | works | Live check: value "typed", selection 1 to 3 after wrap and unwrap. |
| First draw of a new canvas | by the next animation frame | Live check: `wrap()` 0.6 ms, picture present after 1 frame, 13 ms after the call. |
| Press to first frame of the transition, permanent canvas against one made on the spot | no difference measured | Middle of 5 at scale 2.625: 32.9 ms and 33.1 ms. Single presses 19 to 50 ms on both. Software rendering. |
| Paint rate during the transition | 60 a second on both | Longest gap 17 to 26 ms. |
| Canvas memory at rest | 2.0 MB against none | Card of 412 by 175 CSS px at scale 2.625. 0.3 MB at 1280 px wide and scale 1. |
| Canvas memory during the transition | 6.0 MB on both | The canvas, and a plain canvas with the two copies side by side. |
| The guard stops counting the removed canvas | works | Live check: `__gfx.memory().bytes` is back to its starting value 1.2 s after `unwrap()`. |
| An inert clone behind the new canvas until its first draw | works, need not shown | Live check: one child while wrapped, the card alone afterwards. With the clone turned off the transition looked the same in the test browser. |
| A second press during a transition | ignored | The page's `busy` flag. |
| Reduced motion | no transition | Neither card sweeps and the second makes no canvas. "Run each 5 times" says there is nothing to time. |
| No API | plain HTML | The second card needs nothing. The first is taken out of its canvas by script, because a canvas without the API shows none of its children. |
| `npm run check:jank` | passes | cls 0, 0 reads, 2.3 MB in canvases, no WebGL context. The live checks wait for a tap, because two of them move focus to a fixture button. `node tools/draw-size/audit.mjs`: 0 calls with no size. |

## Things that bit

- A live check that calls `focus({ preventScroll: true })` on its own fixture still counts as a focus move in `npm run check:jank` (focusMoves 2). The page's checks wait for a tap (`<meta name="checks" content="tap">`).
- A card that lives in a canvas is invisible in a browser without the API. The first version of the page showed an empty box there.
- `status` as a bare name in a test script is `window.status`, a string. Use `document.getElementById('status')`.

## Not verified

- Any of the times on a phone. "Run each 5 times" sends the middle of five for both cards to the report log (`canvas-on-demand`). `npm run reports -- --page /canvas-on-demand/` shows them.
- If a phone presents one empty frame between the canvas being inserted and its first paint when the clone is turned off. A headless browser can't show what was presented.
- A card whose parent is a grid or a flex row, or whose siblings are styled by position or type. The canvas takes the card's place for 0.9 s.
- A card that changes size during the transition. The canvas is sized from the card once.
- A screen reader's view of the card while it is inside the canvas.

## Open ideas

- The same wrap for a WebGL transition through `ElementGL`, where the cost of making a context is larger than a 2D canvas and the 8 context limit on Android makes "only while it moves" more useful.
- `wrap()` for several elements at once into one canvas that covers their common ancestor's box.
- Count the paints a permanent canvas makes at rest (the caret in its field blinks) against none for the plain card.

## For the index

- An element can be moved into a drawable canvas made in a click handler with `moveBefore()` and keeps focus, value and selection. `insertBefore()` loses focus. The new canvas has its first picture by the next animation frame (C157).
- No delay measured from making the canvas on the spot: 33 ms from press to first frame either way, in software.
- A canvas with drawable children shows nothing in a browser without the API, so a permanent canvas needs script to take its children out. An element wrapped only for a transition needs no fallback.
