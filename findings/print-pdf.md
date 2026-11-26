# Print and PDF handoff (`/print-pdf/`)

Created on 2026-11-26. Static syntax and graphics checks passed; browser print and PDF output are not yet verified in C157 or on A159.

The page puts two copies of one dispatch invoice card side by side. The left card stays inside a `<canvas content="drawable" layoutsubtree>` when the page prints or saves to PDF. The right card uses `beforeprint` (and `window.matchMedia('print')`) with `Element.prototype.moveBefore()` to move out of its canvas into a sibling `#print-host` container during print, and moves back into the canvas with `canvas.requestPaint()` on `afterprint`.

| Question | Result | Notes |
|---|---|---|
| Does Chrome's print / PDF pipeline emit selectable vector text and clickable `<a>` annotations from a drawable `<canvas>`, or flatten to a bitmap? | not verified | Requires printing or saving `/print-pdf/` to PDF in Chrome 148+ with `#canvas-draw-element` enabled and inspecting both cards in a PDF viewer. |
| `Element.prototype.moveBefore()` availability | not verified | Checked live on load by check 1 (`typeof Element.prototype.moveBefore === 'function'`). |
| Moving a live card out of `<canvas layoutsubtree>` on `beforeprint` and back on `afterprint` with `moveBefore()` preserves `<input>` value, selection range and checkbox state | not verified | Checked live on an isolated fixture by check 2, and interactively via the "Simulate print handoff" button with timestamped event logging. |
| `canvas.requestPaint()` repaints non-empty pixels after `moveBefore()` returns the element to the canvas | not verified | Checked live on an isolated fixture by check 3 (clears canvas while moved out, moves back, calls `requestPaint()`, reads pixels via a plain copy canvas). |
| `window.matchMedia('print')` listener registration | not verified | Checked live by check 4. |
| `node --check public/print-pdf/print.js` and `node tools/gfx/check.mjs` | passes | Verified on 2026-11-26 with 0 syntax errors and 0 graphics rule problems. |

## Things that bit

- Putting `display: none` on `#print-host` while idle would drop keyboard focus if `moveBefore()` moves a focused `<input>` into it before CSS updates. Keeping `#print-host` rendered (empty when idle) and un-hiding `#handoff-canvas` before moving the card back avoids that.
- Both `beforeprint` and `window.matchMedia('print')` `change` events can fire for the same print session. Tracking `printing` and `simulated` flags separately keeps the handoff idempotent and stops `afterprint` from overriding an active on-screen simulation.
- Reading pixels back in live checks must copy the drawable canvas with `drawImage()` into a plain `willReadFrequently: true` canvas first, never reading the drawable canvas directly or passing `willReadFrequently: true` to a drawable canvas.

## Not verified

- Actual PDF output from Chrome on macOS, Linux, Windows and Android (A159): whether the left card (`#raw-canvas`) prints as a raster bitmap, vector text, or a blank box, whether its `<a href="https://html-in-canvas.page/">` link is clickable in the PDF, and how sharp the inline SVG barcode looks at 800% zoom compared with the right card (`#print-host`). Press "Print / Save as PDF" on `/print-pdf/` to verify.
- Whether Chrome's print preview fires `beforeprint` early enough for layout of the moved `#handoff-card` to settle before Chrome captures the print page, and whether `afterprint` reliably fires after cancelling the print dialog on Android Chrome.
- Live check pass/fail results in C157 and `npm run check:jank -- /print-pdf/` (requires running `npm run build` first so `public/shared/pages.js` includes `/print-pdf/`).

## For the index

- `/print-pdf/`: side-by-side print and PDF audit comparing a card kept inside `<canvas layoutsubtree>` against one moved out to plain DOM on `beforeprint` via `moveBefore()` and returned on `afterprint` with `requestPaint()`. PDF vector vs raster behaviour not yet verified in a real browser.
