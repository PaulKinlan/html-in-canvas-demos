# A window that pours into the dock (`/genie/`, `lib/genie.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1, 2 and 2.625, mouse, touch emulation and keyboard) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The idea is Raphael Salaja's Genie Minimise, after the macOS Dock effect, and the page links to it. The code and the copy are mine: I didn't read his source.

| Question | Result | Notes |
|---|---|---|
| Bend a `<dialog>` into a funnel in a 2D context | works | `genie()` draws one strip for each 2 px row. Up to 92 strips a frame for a window 250 by 184 px. |
| Strips copied with `drawImage()` from one picture of the window (the default) | works, 60 paints a second | The window is drawn once at the start of a paint, that part of the canvas is copied into a plain canvas, and the canvas is cleared. Live check: 37.7% ink, the same as the other routes, and 20 of 20 points still hit the window. |
| Speed by source rectangle | 60 paints a second | 33 paints in 0.55 s, software rendering. |
| Speed by clip (a whole draw for each row, clipped) | 60 paints a second | 33 paints in 0.55 s. |
| Do the two routes draw the same shape | yes | Live check: 37.7% of the fixture canvas has ink by each. |
| Time to issue 60 strips | about 0.2 ms a frame by source rectangle or clip, 0.1 ms from a copy | Recording only. It doesn't include rasterising. |
| Hit box after 60 source-rectangle strips | wrong | 0 of 20 points in the layout box hit the window. |
| Hit box after 60 clipped strips | wrong | 4 of 20 points hit it. |
| One whole draw afterwards | restores it | 20 of 20. |
| `updateElementGeometry()` scaled to a point, after strips | no hits | 0 of 20. The page does this for a window that is moving. |
| A closed dialog in a `drawable` wrapper | nothing to draw | The wrapper is 0 px tall, the draw doesn't throw, 0% ink. |
| `<dialog open drawable>` with its default `position: absolute` | has a picture | 100% ink in the live check. `findings/top-layer.md` says a drawable dialog needs `position: static`. In this fixture it didn't. |
| `dialog.show()` with the window's hit box parked | scrolls the page | With the canvas half below the fold the page scrolled 477 px, to the middle of the canvas where the box was parked. The page sets the `open` attribute and calls `focus({ preventScroll: true })`. Scroll after that: 0. |
| Strips on the first paint after opening | works | No frame was missed for want of a picture in the test browser. The page waits up to 60 frames if there is none. |
| State while closed | kept | Text typed in the textarea was there after a round trip. The timer counted 2.4 s across a minimise and restore. |
| Keyboard | works | Enter on the minimise button closes the window and focus goes to its dock button. Enter there opens it and the page puts focus on the minimise button. The page didn't scroll. |
| Touch | works in emulation | Taps on the dock, Start and minimise. |
| Reduced motion | no movement | The dialog closes at once. |
| No API | plain HTML | The dialogs open and close from the same buttons. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 14 MB in canvases. |

## On the phone

Paul opened the first version on A157 on 2026-11-23 and said it was "a bit janky and slow". `npm run reports -- --since 3h --page /genie/` had nothing, because nothing crashed and the page sent no numbers. Two causes I could find by reading the code:

- The time step was capped at 1/30 s, so any paint rate under 30 a second also slowed the movement down. It now uses real time, capped at 0.25 s.
- Each strip was a new draw of the element at its own scale, up to 92 a frame. The default is now the copy route.

The page now sends a `genie` report after each movement (route, strips, paints, ms, rate, longest gap, scale). Paul tried the second version on A159 the same day and said it was faster. Three reports arrived from that visit, all by the copy route: 34, 34 and 35 paints in 0.55 to 0.57 s (61 or 62 a second), longest gap 18 or 19 ms, 92 strips. No report has come from the phone for the source rectangle or clip routes, so how much slower they are there is not measured.

## Things that bit

- The clock for the first frame of a movement was meant to start at the tap. The test for "nothing is moving" ran after the window had been told to move, so it never did, and the first frame could jump by 0.25 s. Found from the "longest gap" number: 2,479 ms.

- `"question"` in `page.json` had a bare `<dialog>` in it. The About box puts that text in the page as HTML, so the rest of the question went inside a closed dialog and wasn't shown. I saw it at desktop width, where the box is open. The text now uses `&lt;dialog&gt;`.
- A centred dock with `left: 50%` and `transform: translateX(-50%)` can't be placed from `offsetLeft`, which ignores the transform. The dock is centred with `margin: auto` and `width: max-content`.
- The first report line said "0 strips a frame", because the last frame of a minimise draws none. It now reports the most strips in any frame.

## Not verified

- The paint rate of the source rectangle and clip routes on a phone. The copy route is measured above.
- Whether the on-screen keyboard stays down when a window comes back by touch. The page focuses the minimise button.
- What a screen reader says when a window closes. The dock buttons have `aria-expanded` and `aria-controls`.
- Why 4 of 20 points still hit after the clip route. My guess is that the last clipped draw leaves a whole-sized box under the last strip's transform.

## Open ideas

- Drag a window by its title bar, and pour it into the dock from wherever it is.
- The macOS "scale" effect and a "suck" effect beside this one, as other shapes for the same strips.
- A WebGL mesh version to compare with 92 strips.
- Pour a `popover` out of the button that opens it.

## For the index

- 2D drawing: strips copied with `drawImage()` from one picture of an element (drawn once, then copied from the drawable canvas into a plain one) draw the same shape as strips drawn from the element. measured, C157, `/genie/`. On A159 the copy route ran at 61 paints a second with a longest gap of 19 ms (three reports).
- Focus: `dialog.show()` on a dialog whose hit box is parked scrolls the page to the parked place. measured, C157, `/genie/`.
- 2D drawing: a window can be bent into a funnel with one nine-argument `drawElementImage()` for each 2 px row. 92 strips a frame drew at 60 paints a second in software, and a clip for each row cost the same. measured, C157, `/genie/`.
- Hit testing: after many source-rectangle draws of an element none of its layout box is hit. One whole draw restores it. `updateElementGeometry()` scaled to a point takes it out of hit testing meanwhile. measured, C157, `/genie/`.
- Elements: a closed `<dialog>` in a `drawable` wrapper leaves the wrapper 0 px tall, and drawing it doesn't throw. A `<dialog open drawable>` with `position: absolute` has a picture. measured, C157, `/genie/`.
- Our mistake: an unescaped tag in a `page.json` question hides the rest of the About box. A check in `tools/site/` could catch it. `/genie/`.
