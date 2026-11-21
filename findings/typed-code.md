# Code that types itself (`/typed-code/`)

Measured in Chromium 157 (headless shell), 2026-11-21, at 412 px wide with a device scale factor of 2 and at 1100 px wide. Not yet run on the test phone (Chrome 159 for Android).

Idea built: "Code that types itself" from `public/elements/ideas.js` (rank 2, text).

| Question | Result | Notes |
|---|---|---|
| Does a clip path of character boxes over one `drawElementImage()` call reveal glyphs one at a time? | measured: yes | With 4 of 25 characters typed, characters 1 and 3 drew 130 and 137 pixels, characters 7 and 16 drew 0. |
| Is the undrawn text still in the document? | measured: yes | A `Range` over the block returns all 25 characters. `elementFromPoint()` on the box of an undrawn character returns `<code>`, and `caretPositionFromPoint()` gives offset 15 in the text node. |
| Are `::highlight()` colours from the CSS Custom Highlight API in the picture? | measured: yes | 431 orange pixels in a keyword. The block is one text node with no spans. |
| Can a character that is not in the text be shown? | measured: yes | The box of another letter copied to the caret position with the nine-argument `drawElementImage()` drew 208 pixels. `textContent` did not change. |
| Does the page stop its frame loop when typing ends? | measured: yes | 0 `requestAnimationFrame()` calls after the end. The caret blinks from a 530 ms timer while the canvas is on screen. |
| Is selected text drawn before it is typed? | measured: yes, for boxes passed to the reveal | The selection's line boxes are added to the clip. A real selection made by pointer was not driven in the test browser. |

## Things that bit

- The demo text is `reveal.toString()`, the function that draws the block. Lines had to stay under 46 characters to fit a 412 px screen without wrapping.
- The last `drawElementImage()` call decides the hit region. After the glow and wrong-key pieces, a draw of the whole block at alpha 0 puts it back.
- A newline has no box. The caret takes the right edge of the previous character there.
- Highlight ranges are registered once on shared `Highlight` objects. Fixtures add their own ranges to the same objects.

## Not verified

- Chrome 159 for Android: long-press selection of text that is not drawn yet, and the Copy button (the Clipboard API needs a user gesture and a secure context).
- Find-in-page on undrawn text. It should match, because the text is in the document, and the match highlight would be clipped away. Not measurable in the test browser.
- A real copy of a partial selection (the `copy` event listener reports its length).

## Open ideas

- Type a diff: the reveal runs over `<ins>` and `<del>` elements and removes the deleted glyphs one at a time.
- Drive the position from a scroll timeline, so the code is typed as the reader scrolls.
- The same clip for prose that is "spoken" by speech synthesis, using `boundary` events as the position.

## For the index

- What is in an element's picture: `::highlight()` colours from the CSS Custom Highlight API are drawn (measured, C157, `/typed-code/`).
- drawElementImage() in a 2D context: a clip path of per-character boxes reveals text glyph by glyph while the whole text stays selectable and copyable (measured, C157, `/typed-code/`).
- Ideas built from `public/elements/ideas.js`: "Code that types itself" is `/typed-code/`.
