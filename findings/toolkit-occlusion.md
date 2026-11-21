# Occlusion without a guard in a Dear ImGui app (`/toolkit-occlusion/`)

Measured in C157 (headless Chromium 157.0.8103.78, 2.625 device scale, touch) on 2026-11-21. Dear ImGui 1.92.5, Emscripten, WebGL2, no GLFW or SDL. Source in `native/toolkit-occlusion/`. The build is 362 KB of WebAssembly and 91 KB of JavaScript. PLAN.md backlog item 27.2.

The question: a DOM field shown in an ImGui window keeps taking the pointer when another ImGui window is drawn over it. `/imgui-dom/` asks ImGui what is on top in a listener at every pointer event (the guard). Can the geometry say it in advance.

How the numbers were made. The live checks run a second copy of the app in a 360 px wide frame. Each field has 96 sample points (16 by 6). For each point ImGui answers whether a window above the form takes the pointer there (`FindHoveredWindowEx()`), and `elementFromPoint()` answers which element the browser finds, after an attribute on the canvas is toggled. A wrong hit is a covered point where the browser finds the field. A lost hit is an uncovered point where it does not. Window A is put in four positions over the textarea: over all of it (96 points covered), over its right side (42), across its middle (24), over its bottom right corner (28). The tables give the textarea's numbers.

## Routes

| Route | Wrong hits (full, side, middle, corner) | Lost hits of visible points (side, middle, corner) | Visible points that take the pointer | Result |
| --- | --- | --- | --- | --- |
| 1. No handling | 96, 42, 24, 28 | 0 of 54, 0 of 72, 0 of 68 | 100% | fails: every covered point hits the field |
| 2. Guard: a capture listener asks ImGui at each pointer event on a field | 96, 42, 24, 28 in the browser's hit test; 0 get through the listener | 0, 0, 0 | 100% | works for mouse and tap; the hit test stays wrong |
| 3. `canvasClip` as the largest visible rectangle | 0, 0, 0, 0 | 0 of 54, 36 of 72, 14 of 68 | 74% over the four positions (middle 50%, corner 79%) | fails for a split field and an L shape |
| 4. `canvasClip` as anything other than one rectangle | see the next table | | | not accepted |
| 5a. CSS `clip-path: path()` on the field | 0, 0, 0, 0 | 0, 0, 0 | 100% | works, with one upload per move |
| 5b. CSS `mask` on the field | 96, 42, 24, 28 | 0, 0, 0 | 100% | fails: hit testing ignores a mask |
| 6. Blocker: an empty drawable `<div>` per window, placed after the fields | 0, 0, 0, 0 | 0, 0, 0 | 100% | works |
| 7a. `inert` while any part is covered | 0, 0, 0, 0 | 54 of 54, 72 of 72, 68 of 68 | 0% in the partial positions | fails: all or nothing |
| 7b. `pointer-events: none` while any part is covered | 0, 0, 0, 0 | 54 of 54, 72 of 72, 68 of 68 | 0% in the partial positions | fails: all or nothing |
| 7c. Two hit boxes for one element | | | | not possible: the second `updateElementGeometry()` call replaces the first |
| 8. A plain `<div>` above the canvas, outside it | 0, 0, 0, 0 | 0, 0, 0 | 100% | works, with no canvas API |

Cost of ten 4 px moves of window A across the textarea, and the questions put to ImGui during ten pointer events at a covered point:

| Route | `paint` events | Texture uploads | `updateElementGeometry()` calls | Style writes | Questions to ImGui in 10 pointer events |
| --- | --- | --- | --- | --- | --- |
| 1. No handling | 0 | 0 | 0 | 0 | 0 |
| 2. Guard | 0 | 0 | 0 | 0 | 1, then the field is parked off the canvas and the canvas gets the events |
| 3. `canvasClip` rectangle | 0 | 0 | 10 | 0 | 0 |
| 5a. `clip-path` | 10 | 10 | 0 | 10 | 0 |
| 5b. `mask` | 10 | 10 | 0 | 10 | 0 |
| 6. Blocker | 0 | 0 | 10 | 0 | 0 |
| 7a. `inert`, 7b. `pointer-events` | 0 | 0 | 0 | 0 | 0 |
| 8. Element above the canvas | 0 | 0 | 0 | 10 | 0 |

On every route one listener sends ImGui each pointer event whose target is not a field, because ImGui has no other input in a browser. "Questions" counts only the calls that ask ImGui what is on top.

## What `canvasClip` accepts (route 4)

Before each try the clip was the right half of the input. The try asked for the left half, or for the two outer parts in the case of the array.

| Value | Result |
| --- | --- |
| `new DOMRect(x, y, w, h)`, `{ x, y, width, height }` | used. The rectangle is in the element's own coordinates, before `canvasTransform` |
| An array of two `DOMRect`s, an array of four numbers, a `Path2D`, a `DOMRectList`, a `DOMQuad`, `{}`, `null` | no throw. Read as a dictionary with no members, which is an empty rectangle: the field has no hit box at all |
| A string (`'inset(0 50% 0 0)'`), a number | throws `TypeError` ("not of type 'DOMRectInit'"). The earlier clip stays |
| `{ x, y, width, height, radii: [20] }` | used as a plain rectangle. The point 1 px inside the corner still hits |
| A zero-size or zero-width rectangle | no hit box. `getBoundingClientRect()` stays where the transform put the field |
| A negative width (`w/2, 0, -w/2, h`) | normalised: the left half |
| A `NaN` x, an infinite width | the earlier clip stays. The transform in the same call is applied (measured in a scratch probe, not in a live check) |
| No `canvasClip` member | the earlier clip stays. A clip is removed by passing a rectangle larger than the element |

## Other results

| Experiment | Result | Detail |
| --- | --- | --- |
| Does hit testing of a drawable child follow CSS `clip-path` | yes | `path()` with several rectangles, `path(evenodd, …)` with a hole (hit pattern across the input 11001) and `polygon()` (11100) |
| Does the clipped part leave the texture | yes | A texel in the covered corner read `rgba(28, 43, 74, 255)` without the clip and `rgba(0, 0, 0, 0)` with it. A texel in the uncovered part was the same before and after. ImGui draws its window over the hole |
| Which element wins where two hit boxes overlap | the one whose `updateElementGeometry()` call was the most recent | Field then blocker: blocker. Blocker then field: field. A repeat of the same field call raises the field again |
| `z-index` on either element | no effect | Tried with 9 on the field and with 9 on the blocker, in both call orders |
| DOM order of the two elements | no effect | Blocker first and blocker last among the canvas's children, in both call orders |
| A repaint of the field after the blocker was placed | the blocker stays on top | The field's value was changed and uploaded again |
| A blocker of 1 by 1 CSS px scaled by `canvasTransform` | works | The hit box is the scaled rectangle. No layout and no `paint` event when it moves. A blocker resized with CSS width and height fired one `paint` event per change (scratch probe) |
| `focus()` on a fully covered field | works on every route except `inert` | Live check, inside the fixture frame |
| Tab from the input with the textarea fully covered | goes to the textarea on every route except `inert`, where it goes to the select | Playwright key press on the page |
| `getBoundingClientRect()` of a fully covered field | where ImGui drew it, on every route | Routes 3 and 5a use a zero-size `canvasClip` for a fully covered field instead of moving it off the canvas |
| Touch: drag an ImGui window over a field, on every route | works | CDP touch events at 412 px wide |
| Touch: tap a covered point of the textarea | routes 1 and 5b focus the textarea. The others do not | |
| Touch: start a drag on a covered point of the textarea | routes 3, 5a, 6, 7a, 7b, 8: the window moves. Routes 1, 2 and 5b: `pointercancel`, and the page scrolls | The browser picked the field as the target before any script ran. `touch-action: none` on the canvas did not apply to the touch that began on the field. The guard moved the window by two steps and then lost the pointer |
| Touch: tap a visible point of a partly covered textarea | focuses it on routes 1, 2, 3, 5a, 5b, 6, 8. Not on 7a and 7b | |

## Things that bit

- ImGui gives a window the pointer in a rectangle larger than the one it draws: `FindHoveredWindowEx()` pads `OuterRectClipped` by `TouchExtraPadding`, or by `WindowBorderHoverPadding` for a resizable window (4 px here). The app reports the padded rectangle, so the routes and ImGui's own answer agree at every sample point.
- While a window is being dragged, `FindHoveredWindowEx(pos, false, …)` answers the moving window for every point. The measurement uses the form with `true`, which ignores the drag.
- An omitted `canvasClip` does not clear the clip. The first probe read "ignored" where the truth was "the earlier value stays", until each try started from a known clip.
- Every `updateElementGeometry()` call on a field raises it above the blockers, including a call with unchanged values. The page sends a field's geometry only when it changed and places every blocker again in the same frame.
- Two covering windows that overlap each other make `path(evenodd, …)` with one hole per window wrong: the doubly covered part comes back. The route builds the visible part as rectangles that do not overlap and writes them as one `path()`.
- `outline.hidden = false` did nothing on an `<svg>` element: `hidden` is not a property of SVG elements. The page toggles the attribute.
- `elementFromPoint()` answers `null` for a point outside the viewport. The table says how many sample points were not tested, and measures again when more of the canvas scrolls into view.
- A stage 560 px tall with a long introduction put the whole canvas below the first screen at 412 by 840. The route selector is the only control above the canvas now.

## Not verified

- A real phone (A159). The touch results are CDP touch events in headless Chromium 157. What would verify it: open the page, pick each route, drag window A over the textarea and tap the covered part.
- Screen readers. A covered field keeps its bounds and its place in the Tab order on every route except `inert`. Whether a reader announces it was not run.
- An ImGui popup, combo or tooltip over a field. This app has only root windows. The blocker route would need one blocker per popup.
- A window with rounded corners. `clip-path` on the blocker element was not tried.
- More than two covering windows. The page has two blockers and two overlay elements in its markup.
- A form that is not behind every other window. The call order should express any z-order (place elements back to front), inferred from the two-element result and not run.
- The cost of the `clip-path` route on a real GPU. One upload per move was counted. Frame time was not measured.
- Whether the "most recent call wins" order is specified or an accident of Chromium 157.
- Nested drawables. In a scratch probe a drawable `<input>` inside a drawable `<div>` took its own `updateElementGeometry()` call without a throw and was hit at its own place. Not built into the page.

## For the index

- `updateElementGeometry()`: `canvasClip` is one `DOMRectInit` in the element's coordinates. Arrays, `Path2D`, `DOMRectList` and `DOMQuad` are read as an empty rectangle without a throw, which removes the hit box. Omitting the member keeps the earlier clip. (`/toolkit-occlusion/`)
- `updateElementGeometry()`: where two hit boxes overlap, the element of the most recent call takes the pointer. `z-index` and DOM order have no effect. (`/toolkit-occlusion/`)
- Hit testing: CSS `clip-path` on a drawable child cuts both its hit area and its texture. CSS `mask` cuts only the texture. (`/toolkit-occlusion/`)
- Hit testing: `inert` and `pointer-events: none` on a drawable child remove its hit box. Only `inert` removes focus and the Tab stop. (`/toolkit-occlusion/`)
- Native toolkits: occlusion by another toolkit window without script at event time works with an empty drawable blocker element placed last (no repaint), or with `clip-path` on the field (one upload per move). (`/toolkit-occlusion/`)
- Touch: `touch-action: none` on the canvas did not stop a touch that began on a drawable child from scrolling the page. (`/toolkit-occlusion/`)

## API requests

- A hit-test order that is stated. Today the order is the order of the last `updateElementGeometry()` calls, which a page can only learn by measuring. A `zIndex` or `order` member in the options, or a statement that call order is the order, would let a toolkit hand over its own z-order.
- A clip that is more than one rectangle: a list of rectangles or a `Path2D` for `canvasClip`. A covered corner and a field split in two both need it. Until then a list should throw, because it is now read as an empty rectangle and silently removes the hit box.
- A way to clear `canvasClip` (`null` is read as an empty rectangle).
- A hit-only region with no element: the blocker is an element whose only purpose is to take the pointer for the canvas. An option on the canvas such as "these rectangles belong to the canvas itself" would say the same without a node in the accessibility tree.
