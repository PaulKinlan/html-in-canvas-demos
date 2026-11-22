# Blocks to handle: legend, summary, figure, template and a table of buttons (`/block-play/`)

Backlog group 28 in PLAN.md, ideas 28.4, 28.11, 28.22, 28.26 and 28.27. Measured in headless Chromium 157 (C157) on 2026-11-21 at 412 px wide. The page's five live checks pass there, and `node tools/block-play/check.mjs` drives the five demos by touch (33 steps, all pass). Nothing here has been run on a phone.

The question: can a 2D canvas turn block elements into things to pick up, pull and press while every tap still goes to the element?

| Experiment | Result | Why |
|---|---|---|
| Two fieldsets of 200 px, the first drawn at y 0 and the second at y 40 | the tab button of the first is found at (40, 15); at (100, 110), in the overlap, the element is the input of the second | The element drawn last takes the input. Folder tabs from legends (28.4) draws three fieldsets from the back and changes the order on a tap. |
| A `legend` with `padding: 0` and a button in it | 80 by 30 px, at the top of its fieldset; `margin-left` moves it | The tab. The fieldset has no border and no background, so only the body and the button are seen. |
| A tap on the text area of the front folder, and on a tab of a folder behind | the text area was focused; the order changed (Crew, Stores, Log to Log, Crew, Stores) | The back folders are also drawn with `ctx.filter = brightness()` and a smaller scale. |
| A closed `details` | 24 px tall, the height of its summary; its content reports 48 px | The content is not painted while closed, so it cannot be drawn part open. Open: 72 px. |
| A click on a `summary` with `preventDefault()` | `details.open` stayed false | Summary as a lever (28.27): the summary throws the lever, and the lever sets `open` and how much of the height is drawn. |
| A touch drag on the canvas-drawn knob (CDP touch events) | lever at 48% part way, `details.open` true, 66 of 138 px shown; 100% after release; page scroll 0 px | `pointerdown` with the canvas as target, pointer capture, and a non-passive `touchstart` that cancels touches on the knob. |
| A figure drawn under `ctx.rotate(0.5)` about (150, 100) | the `img` is found at the turned place of its corner; the unturned place gives the canvas | Photo gallery with real alt text (28.11). The alt text is drawn by the canvas from the attribute (81 characters for the picked print). |
| A `template` as a canvas child, and 12 clones of its content | template 0 by 0 px, 0 client rectangles; 12 of 12 clones found at their places | Template stamped many times (28.22): up to 18 tickets in four layouts, each with its own tap count. |
| A 6 by 6 table of buttons, table drawable | 36 of 36 found at their places; 1 paint event after one button changed; a disabled button is still what `elementFromPoint()` gives | Minesweeper from a table of buttons (28.26). |
| The first tap on the minefield | 15 cells open after 0.12 s, 28 after 1.5 s (one run, the board is random) | Cells are opened 45 ms per cell of distance, each drawn enlarged for 0.25 s from a clipped draw of the table. |
| A lost context | plain HTML | One `contextlost` event stops the five canvases and shows the elements as plain HTML (5 boxes). Tested by dispatching the event. |

## Things that bit

- The page first said that the content of a closed `details` has no box. The live check read 48 px for it. The element is short, and the content is not painted.
- A text field in a folder overflowed the folder's body: a grid item has `min-width: auto`. The body's children now have `min-width: 0`.
- The fan layout used a radius from the canvas height and put tickets off both sides at 412 px. The radius is now limited by the width.
- A print's alt text was counted by hand as 80 characters and is 81.

## Not verified

- Chrome 159 on Android: the five demos by touch.
- Dragging the knob with a real finger, and whether the page stays still while it is dragged.
- The long-press menu on a drawn `img` ("Save image", "Open image in new tab").
- A screen reader on the prints, the tickets and the minefield.
- The on-screen keyboard over the folder fields.
- 38 px cells under a thumb, and a long press as the way to set a flag (the page uses a check box).

## For the index

- Input: of two overlapping drawn elements the one drawn last takes the input; a 2D canvas needs no other stacking rule. C157, `/block-play/`.
- Input: a `pointerdown` whose target is the canvas is a press where no drawn element is; with a non-passive `touchstart` that cancels, a canvas-drawn handle can be dragged without scrolling.
- Elements: a closed `details` is as tall as its summary and its content is not painted, though the content reports a height.
- Elements: a `template` in a canvas has no box; its clones are separate drawable children.
- Backlog: ideas 28.4, 28.11, 28.22, 28.26 and 28.27 are built on `/block-play/`.
