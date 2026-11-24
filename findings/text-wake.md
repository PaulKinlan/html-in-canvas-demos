# Text that makes room for a shape you drag (`/text-wake/`, `lib/text-wake.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1 and 2.625, mouse, touch emulation and keyboard) on 2026-11-24. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The idea is Baked Design Studio's Margin Dragon, and the page links to it. The code and the copy are mine: I didn't read its source.

| Question | Result | Notes |
|---|---|---|
| A `shape-outside` polygon on a float inside a drawn element moves the text in its picture | works | Live check: 351 dark pixels in the left 140 px of a line before, 0 after the polygon is widened, drawn in the next `paint` event. |
| The change raises `paint` | works | 1 paint event with no `requestPaint()` call. |
| A layout on every frame | works, 60 paints a second in software | The frame callback writes the polygon and reads `offsetHeight`. 0.3 ms for each layout of three paragraphs, longest 1.1 ms. Longest gap between paints 17 to 19 ms. |
| Hit testing after the text moved | works | Live check: a link pushed 140 px is returned by `elementFromPoint()` at its new place and not at the old one. The article's hit box is the same draw each time. |
| A polygon with 82 points | accepted | One point for every 6 px of height. |
| Text on both sides of the shape | not possible | A float has text on one side. `CSS.supports('wrap-flow', 'both')` is false in C157. |
| An empty `<button>` as the head, with `touch-action: none` | works in emulation | A touch drag on it moved the worm with no scroll. A touch drag on the text scrolled the page by 135 px. |
| Keyboard | works | Arrow keys on the head button move it by 18 px. `preventDefault()` stops the page scrolling. |
| The link in the text | works | A click on it at its moved place followed it. |
| Reduced motion | no spring | The head jumps to where it's dragged. The 3 second run still moves. |
| No API | plain HTML | The article is shown with the float's starting polygon. The head button is hidden. |
| `npm run check:jank` | passes | cls 0.026, 0 reads, 12.5 MB in canvases. The shift is the live checks' own fixture text, which three checks move on purpose. |

## Things that bit

- The float's polygon is first written by script, after the first paint, so the text shifted when the page started. The worm's resting polygon is now in the stylesheet as well (copied from `polygonFrom()`).
- With reduced motion the body's follow step was skipped, the worm never came to rest and the frame loop didn't stop. The body now jumps with the head.
- A link that wraps over two lines has a bounding box whose middle isn't on the link. Tests use `getClientRects()[0]`.

## Not verified

- The cost of a layout, and the paint rate, on a phone. The page sends a `text-wake` report after each movement (layouts, mean and longest ms, paints, rate, longest gap, scale).
- `touch-action: none` on the head button on a real touch screen. The page sends a report if the browser cancels a drag.
- Whether a text selection survives the re-flow on a phone, with its handles.
- A screen reader on the head button.

## Open ideas

- A longer article, to find the length at which a layout no longer fits in a frame.
- Two columns with a float in each, so that a shape in the gutter pushes text both ways.
- The worm coming in from the right when the pointer is on that side, with a right float.
- A shape that eats the words it touches, as Margin Dragon's fire does.

## For the index

- Layout: a `shape-outside` polygon rewritten every frame on a float inside a drawn element re-flows its text, and the next `paint` event's picture has the new layout. 0.3 ms a layout for three paragraphs in software. measured, C157, `/text-wake/`.
- Input: hit testing inside a drawn element follows its layout. A link moved by a re-flow is hit at its new place with no new call from the page. measured, C157, `/text-wake/`.
- API gap: text can't wrap on both sides of a shape drawn in the middle of a block. Floats are one-sided and CSS exclusions aren't in C157. `/text-wake/`.
