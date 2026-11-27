# Refractive glass text magnifying loupe (`/text-loupe/`)

Measured in headless Chrome Canary 160 (`160.0.8187.0`, 412 px wide at device scale 2.625) on 2026-11-27. Real Android phone touch testing (Chrome 159, A159) and `npm run check:jank -- /text-loupe/` are not verified yet.

| Question | Result | Reason or detail |
|---|---|---|
| Can one `ElementGL` WebGL 2 context draw a 1:1 editable editorial card and a floating refractive glass loupe from the same `texElementSubImage2D()` upload? | Works (measured, C160) | All 6 live checks pass (`gl.getError() === 0`, peak 2 WebGL contexts, `927x1313` backing store = 1.22 MP at `353x500` CSS px, `11.31 MB` total canvas memory, `0` unasked readbacks). `LOUPE_FRAG` samples `(p - loupeCenter) / zoom + target` from `uTex` with analytic `textureGrad()` derivatives, radial barrel lensing, edge chromatic dispersion and a top meniscus highlight. |
| Moving loupe focus from a dark text block to a coloured accent strip updates magnified pixels cleanly? | Works (measured, C160) | Live check 2 measured `gl.getError() === 0` with `rgb(23,22,21)` on the dark block shifting to `rgb(210,74,32)` on the vermilion accent strip with uniform-only updates on one uploaded texture. |
| Does `loupeCenter` clamp cleanly when the target approaches the top edge (`y < 60 px`) without losing target accuracy? | Works (measured, C160) | Live check 3 verified `computeLoupeLayout()` bounds across `y = 10, 30, 59` for both `pill` and `round` shapes and measured a `y = 22 px` fixture clamping the pill centre to `y = 32.0 px` (top edge `8.0 px >= 8 px`) with centre pixel `rgb(30,92,255)`. |
| Do `<textarea>` typing, text selection and inline swatch/weight buttons stay clickable via `updateElementGeometry()`? | Works (measured, C160) | Live check 4 verified `document.elementsFromPoint()` hits both `<button>` and `<textarea>` (`unit = 1.00`). Real CDP clicks focused `#note-editor`, inserted `[LIVE]` (`col 18, ln 2`), switched themes via inline swatch buttons inside `<canvas>`, and hovered/scrubbed across the card with zero console errors. |
| Do the 2D fallback (9-argument zoomed clip) and plain-HTML fallback recover cleanly without WebGL 2 or HTML-in-canvas? | Works (measured, C160) | Under `--disable-webgl`, `render2DFallback()` drew the 2D card and zoomed clip and kept the Cobalt swatch clickable (`elementsFromPoint` hit = `true`) after a zero-area clipped 5-arg draw. Under `--disable-blink-features=CanvasDrawElement`, `#loupe-card` moved into `#loupe-wrap.plain` cleanly; live check 5 confirmed synthetic `webglcontextlost` recovery without `loseContext()`. |

## Things that bit

- Setting `canvas.updateElementGeometry()` with an unscaled `DOMMatrix` shrinks hit testing by `1 / devicePixelRatio` on high-DPI screens; multiplying by `geometryUnit(canvas, card, cw)` aligns buttons, paragraph text selection and `<textarea>` across DPRs.
- Calling 9-argument `drawElementImage()` in the 2D fallback to draw the zoomed loupe clip narrows the element's hit box to that source rectangle, and `updateElementGeometry()` does not restore it; issuing a zero-area clipped 5-argument `drawElementImage(card, 0, 0, cw, ch)` afterwards restores the full 1:1 hit region.
- On initial load, `ResizeObserver` fired after the default specimen target was positioned at character `58` and called `measureSelectionTarget()`, which read `noteEditor.selectionStart === 0` and snapped the loupe back to `(25, 275)`. Tracking `caretHasFocusOrEdit` keeps the default target on `"0.0042 px"` until the reader actually focuses, clicks, types or scrubs the field.
- In `Loupe drag scrub` mode, allowing `pointerdown` to bubble natively caused mouse drags across `#note-editor` to start a browser range selection alongside caret scrubbing; calling `e.preventDefault()` on `pointerdown` when `state.mode === 'scrub'` keeps single-caret scrubbing crisp while preserving native selection in `caret` mode.
- Computing `dFdx(p)` / `dFdy(p)` inside conditional shader branches risks quad-derivative artefacts along the loupe rim; evaluating screen-space UV derivatives unconditionally and passing them to `textureGrad()` keeps the bevel boundary free of mipmap seams.

## Not verified

- Real GPU rendering, frame rate, `Loupe drag scrub` touch behaviour alongside vertical scroll, on-screen keyboard focus scrolling, and 8 px hairline legibility on Chrome 159 for Android (A159) at 412 px wide and device scale 2.625.
- Running `npm run check:jank -- /text-loupe/` in the full Playwright jank harness (no local `playwright` package installed in this workspace).
- Testing in Chromium 157 specifically (measured in Chrome Canary 160 `160.0.8187.0`).

## For the index

- Text input and loupes: single-upload `ElementGL` + `texElementSubImage2D()` refractive glass magnifying loupe (`pill` and `round` iOS 6 shapes) floating 58 px above the live caret, `window.getSelection()`, or pointer with 1:1 `updateElementGeometry()` hit testing and 2D 9-arg clip fallback (measured, C160).
