# Split-flap output element (`/split-flap/`)

Measured in Chromium 157 (headless shell), 2026-11-21, at 412 px wide with a device scale factor of 2 and at 1100 px wide. Not yet run on the test phone (Chrome 159 for Android).

Idea built: "Split-flap output" from `public/elements/ideas.js` (rank 2, forms).

| Question | Result | Notes |
|---|---|---|
| Does setting `output.value` fire `paint`? | measured: yes | 1 paint event, no `requestPaint()`. The paint handler compares each output's value with what its flaps show. The canvas code has no input listener and no observer. |
| Nine-argument `drawElementImage(source, sx, sy, sw, sh, dx, dy, dw, dh)` on an element | measured: works | The source rectangle is in CSS pixels of the element at any device scale factor. 390 pixels in the destination box, 0 outside it. Against a clipped full draw of the same box, 244 of 18048 channel values differed (edges). |
| The same call on an `ElementImage` from `captureElementImage()` | measured: works | |
| Does a snapshot keep the old value? | measured: yes | The first character's box drew 402 pixels from the snapshot (A) and 49 from the live element (a full stop). |
| `captureElementImage()` outside a paint handler | measured: works | Used at the end of a settled paint here, and in a timer on `/flip-clock/`. |
| Is an `<output form="id">` inside the canvas in `form.elements` of a form outside it? | measured: yes | |
| A drum (a line of every flap character) as a drawable nested in the section | measured: characters outside the window have no picture | See `findings/keycaps.md`. The drums are direct children of the canvas. |
| Box of a character with `letter-spacing` | measured: the spacing is inside the box, after the glyph | A 12 px glyph with 10 px spacing has a 22 px box with ink from 1 to 10.5 px. Cards are shifted left by half the spacing. |
| Does the page stop asking for frames when the flaps settle? | measured: yes | 0 `requestAnimationFrame()` calls in the 300 ms after settling. |
| Does a point on a drawn character hit test to the output? | measured: yes | After the pieces are drawn, a whole draw inside an empty clip (`home()`) puts the hit region back. `updateElementGeometry()` alone leaves it the size of the last piece. |

## Things that bit

- An `ElementImage` has a `close()` method and holds memory until it is called. The first version took a new snapshot at every settled paint and closed none. The board now closes the old snapshot before it takes a new one. A closed snapshot throws `InvalidStateError` when drawn.

- The live text shows the new value at once, so a card that is still flipping is drawn again over the section's picture.
- A drum in the board's own colour made the yellow row flip in white. There is one drum per output style.
- Fixed-pitch fonts differ in advance width, so the font size is set from a measured character box and not from an assumed 0.6 em.
- A snapshot compare of "A" against "I" failed its threshold in a fixed-pitch font, because "I" has wide serifs there.

## Not verified

- Chrome 159 for Android, including the speed of 120 cards with up to 120 flaps in motion.
- Screen readers: an `<output>` is a live region. Whether TalkBack announces each new row once is not measurable here. To verify: turn TalkBack on and press Next departure.
- Selection of a row by long press on the phone.

## Open ideas

- A flap sound from Web Audio, one click per flip, started by the first tap.
- Flaps for any element: the direct mode works on pictures, so a table cell or a price could flip the same way.

## For the index

- The canvas, the attributes and the paint event: setting `output.value` fires `paint`, so a paint handler can find changes by comparing values (measured, C157, `/split-flap/`).
- drawElementImage() in a 2D context: the nine-argument form works for elements and for `ElementImage` snapshots, with the source rectangle in CSS pixels (measured, C157, `/split-flap/`).
- ElementImage: a snapshot keeps the old text after the element changes, and `captureElementImage()` works outside a paint handler (measured, C157, `/split-flap/`, `/flip-clock/`).
- Ideas built from `public/elements/ideas.js`: "Split-flap output" is `/split-flap/`.
