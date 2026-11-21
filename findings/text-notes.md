# Annotated article: six text effects (`/text-notes/`)

Measured in Chromium 157 (headless shell, 157.0.8103.78), 2026-11-21, at 412 px wide with device scale factors 2 and 2.625, and at 1100 px wide with scale 1. Not yet run on the test phone (Chrome 159 for Android).

Ideas built, all from `public/elements/ideas.js` (rank 2, text), PLAN.md backlog group 14: "Ruby that appears near the pointer", "Pull quote behind the column", "Selection that glows", "Kinetic heading", "Footnotes that slide out", "Strike-through drawn by hand". One page, one 2D canvas, one article element, and three footnote elements that are separate children of the canvas.

| Question | Result | Notes |
|---|---|---|
| Does a 2D canvas `filter` apply to `drawElementImage()`? | measured: yes, for `blur()` and for `url()` to an SVG filter | Through `blur(3px)` a paragraph had 5,319 soft pixels (alpha 40 to 215) against 987 plain (scale 2.625). Through an SVG filter with a colour matrix and a blur, 13,161 pixels came out around the selected words and 0 over plain text 100 px away. |
| Can the selection be picked out of the picture by colour, with no readback? | measured: yes | `feColorMatrix` with alpha = 1.5 G + 1.5 B - 3 R - 1.2 keeps `#19e3ff` and rejects the text colours used on the page. The filter also lights a `<mark>` of the same colour, which a route based on `Range.getClientRects()` cannot see. |
| Is a selection set from script in the picture, and does it fire `paint`? | measured: yes | 1 paint event after `setBaseAndExtent()`, 9,824 pixels of the `::selection` colour in the Range box. |
| Is a source rectangle drawn larger taken from the recorded picture or from pixels? | measured: from the recorded picture | A 12 px word drawn at five times its size had 0.07 soft edge pixels for each solid pixel. The same word enlarged with `drawImage()` of the canvas pixels had 0.77 (scale 2.625; 0.22 against 4.45 at scale 1). |
| Does an `<rt>` have its own client rectangle, and does a clip hole remove only the annotation? | measured: yes | rt box 53 by 13 px. 557 gold pixels in it without the hole, 0 with it, base text unchanged (942 pixels). |
| Do pieces for each glyph box rebuild a heading exactly? | measured: yes, within 0.1% | 16 boxes for 16 characters, 7,972 ink pixels from one draw, 7,969 from 16 pieces padded by 0.5 px. |
| Where is an element's hit region after a draw with a source rectangle? | measured: at the piece, with the size of the piece | A 120 px heading with one 17 px glyph drawn at 150, 60: 0 of 36 points in the layout box hit the heading, the piece did. |
| Does `updateElementGeometry()` restore the region after that? | measured: the place yes, the size no | 6 of 36 points hit. The region is at 0, 0 with the size of the glyph. |
| Does a whole draw in an empty clip restore it? | measured: yes | 36 of 36 points. The page ends each frame with it (`settle()`). |
| Is a drawable child that is not drawn in a frame hit tested? | measured: no | A note drawn at 160, 60 is returned by `elementFromPoint()`. In the next paint that does not draw it, the point returns the paragraph under it. |
| Which of two overlapping drawn children takes a click? | measured: the one drawn last | With the article's empty-clip draw after the note, a point on the open note returned an element of the article. With the note drawn last it returns the note. DOM order did not decide it. |
| Does `caretPositionFromPoint()` work on a drawn element? | measured: yes | A paragraph drawn at 20, 10: offset 9 in its text node for the middle of a word at offsets 6 to 12. The page uses it to find the word under a tap. |
| Does wrapping a word in `<del>` fire `paint`? | measured: yes | 1 paint event, 3 line boxes for a `del` over three lines. |
| How are the canvas's children laid out with `layoutsubtree`? | measured: each at 0, 0 | The three notes all have `offsetTop` 0. They do not stack as blocks under the article. |
| Cost of a paint | measured: 0.3 to 1.2 ms of script | Software rendering. The filter runs on the compositor side and is not in this number. |
| Jank guard | measured: pass | `cls 0 scroll 0 focus 0`, 5.8 MB and 1.46 megapixels of canvas at 412 px and scale 2.625, 0 readbacks, 0 open snapshots. |
| Touch (Playwright `touchscreen.tap`, 412 px) | measured: works | A tap near a ruby word shows its annotation. A tap on a footnote number opens the note and a tap elsewhere closes it. With the checkbox on, a tap on a word wraps it in `<del>` and a second tap removes it. |
| Without the API (`--disable-blink-features=CanvasDrawElement`) | measured: plain HTML | The article, then the three notes. Ruby is shown, `s`, `del` and `ins` have the browser's lines, and the footnote links jump to the notes. |

## Things that bit

- `home()` in `lib/text-canvas.js` uses `updateElementGeometry()`. After a draw with a source rectangle that leaves the element with a hit region the size of the piece (see the table). `/text-notes/` does not use it and ends the frame with a whole draw in an empty clip. The five pages that use `home()` (`/mark-pen/`, `/keycaps/`, `/split-flap/`, `/flip-clock/`, `/typed-code/`) should be checked for clicks that miss after a piece draw. Not changed here: the file belongs to another strand.
- `getClientRects()` follows the last draw, so one frame must read every rectangle before its first piece draw. The page does this in `readBoxes()`.
- `.ann ::selection` does not match text that is a direct child of `.ann`. A check fixture whose paragraph had the class itself was painted with the default selection colour, and the colour count was 0. The rule is `.ann::selection, .ann ::selection`.
- `ctx.filter` lengths are in canvas pixels and are not scaled by the context's transform. The blur radius is multiplied by the pixel ratio (`stdDeviation` is set from script for the SVG filter).
- The element drawn last takes the click. The article's empty-clip draw has to come before the open note is drawn.
- A global `.note` rule exists in `shared/style.css`. The footnotes use the class `side-note`.
- After a real mouse click inside the article in the test browser, a selection set from script (the "Select the quote" button called with `element.click()`) was in `getSelection()` and fired `paint`, but was not in the picture. A real click on the button, which moves focus to it, showed it. Cause not found. A selection set from script before any click in the canvas is painted.

## Not verified

- Chrome 159 for Android, all of it. To verify: open `/text-notes/` on the phone. The heading should fly in, the pen strokes should draw after it, a tap near a Japanese word should show its reading, and a tap on a footnote number should slide the note in from the right.
- Long-press selection inside the article and its glow. The headless browser selects nothing on a long press. To verify: long-press a word, or press "Select the quote".
- The cost of the SVG filter on a phone GPU. The filter is applied to the whole article on every paint while a selection exists, including paints caused by scrolling. To verify: select the quote, scroll, and compare with Glow set to "Range rectangles" or "Off".
- Whether a tap is a usable replacement for hover for the ruby effect. Ruby "All" shows every annotation.
- Screen reader output for `rt`, the notes (`role="note"`, `aria-expanded` on the links) and `del`/`ins`.
- CJK font on the phone. The test browser used IPAGothic.

## Open ideas

- Cache the glow layer in a second plain canvas with `drawImage()` and reuse it until the selection changes, so the filter does not run on scroll.
- Open the gap for a footnote inside the text: draw the article in two pieces, above and below the line, and the note between them. This needs a hit region for each piece, which one element cannot have.
- Ruby driven by reading level: hide the annotation of a word after the reader has revealed it three times.
- A kinetic heading whose glyphs scatter when the heading scrolls off the stage and gather when it returns.
- Erase a pen stroke by rubbing over it, which removes the `<del>`.

## For the index

- What is in an element's picture: the selection highlight in its `::selection` colour (measured, C157, `/text-notes/`). A source rectangle drawn larger is drawn from the recorded picture and stays sharp (measured, C157, `/text-notes/`).
- 2D canvas state and `drawElementImage()`: `ctx.filter` applies, both `blur()` and `url()` to an SVG filter, so an element's picture can be keyed by colour with no readback (measured, C157, `/text-notes/`).
- Hit testing and updateElementGeometry(): a draw with a source rectangle gives the element a hit region at the piece with the size of the piece. `updateElementGeometry()` moves it back but keeps that size. A whole draw in an empty clip restores it (measured, C157, `/text-notes/`).
- Hit testing: a drawable child has a hit region only in a frame that draws it, and of two overlapping children the one drawn last takes the click (measured, C157, `/text-notes/`).
- Hit testing: `caretPositionFromPoint()` answers for a drawn element at its drawn position (measured, C157, `/text-notes/`).
- Layout: children of a `layoutsubtree` canvas are each laid out at 0, 0 (measured, C157, `/text-notes/`).
- Ideas built from `public/elements/ideas.js`: "Ruby that appears near the pointer", "Pull quote behind the column", "Selection that glows", "Kinetic heading", "Footnotes that slide out", "Strike-through drawn by hand" are all `/text-notes/`. PLAN.md backlog items 14.1 to 14.6.

## Chromium bugs

- After `drawElementImage()` with a source rectangle, `updateElementGeometry(el, { canvasTransform })` leaves the element's hit region with the size of the source rectangle. Reproduction: the live check "After a draw with a source rectangle, a whole draw in an empty clip restores the hit region" on `/text-notes/`. It may be intended (the region is the last drawn piece), in which case the API has no call that restores the whole region without a draw.
