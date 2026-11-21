# Layout debugger overlay (`/layout-debug/`, `lib/devtools/layout-boxes.js`)

Measured in headless Chromium 157 (C157) on 2026-11-21 by the page's live checks.

| What | Result | Detail |
|---|---|---|
| A draw with `globalAlpha = 0` at 0, 0 used only to measure | works | It leaves no pixels and places the element, so `getBoundingClientRect()` of every descendant is its layout position for the rest of the task. |
| Measured box against the pixels | equal | A 60 by 40 block with a 20 px margin, root drawn at 30, 20: box at 50, 40, red pixels at 50, 40. |
| Hit testing after a measuring draw and a real draw | at the real draw | `elementFromPoint()` found a button at 230, 140 and the canvas at 30, 20. |
| `getBoundingClientRect()` of a descendant after a draw turned 0.3 rad | bounding box | 44.1 by 30.9 for a 40 by 20 block. |
| `offsetLeft`, `offsetTop` after the same draw | layout, whole numbers | 50, 30. |
| `Range.getClientRects()` after a turned draw | bounding boxes | No call returns the layout rectangle of a line of text once the element is drawn turned. |
| Baseline = top of the Range rectangle + `fontBoundingBoxAscent` | matches a probe | 20 px serif with line-height 2, 40 px sans-serif, 14 px monospace: difference 0.00 px against a zero-size inline-block. |
| Collapsed margins | overlay rings overlap | Two paragraphs with `margin: 20px 0` are 20 px apart. Computed style reports 20 px for each. |
| A text change with no `requestPaint()` | paint event, new layout measured | 1 line before, 4 lines in the next paint event. |
| A tap on a turned and scaled article | reaches the element under the finger | The page uses the `click` target and converts no coordinates. |

## Things that bit

- The first design read `getBoundingClientRect()` after the real draw and inverted the transform. That works for a translation and a scale. A rotation returns bounding boxes, which cannot be inverted. The measuring draw replaced it.
- An `auto` margin (the chip pushed right in the flex row) is reported by computed style as the used length, so it is drawn as a margin. A flex `gap` and `border-spacing` are not margins and get no colour.

## Not verified

- A device pixel ratio of 2.625 on a phone, where layout positions are fractions of a device pixel, and a non-default system font size.
- Baselines of form controls and images, CSS transforms on descendants, vertical writing modes.

## For the index

- drawElementImage() in a 2D context: a draw with `globalAlpha = 0` can be used to read layout rectangles at 0, 0 before the real draw in the same frame; hit testing follows the last draw (measured, C157, `/layout-debug/`).
- Hit testing and updateElementGeometry(): after a rotated draw, `getBoundingClientRect()` and `Range.getClientRects()` of descendants are bounding boxes; `getBoxQuads()` is not available (measured, C157, `/layout-debug/`).
- Ideas built: "Layout debugger overlay" (`ELEMENTS.md`, rank 2, tools).

## API requests

- A way to read the quad an element or a Range was drawn to (`getBoxQuads()` or equivalent). Today a tool has to wrap `drawElementImage()` and record the transform itself.
