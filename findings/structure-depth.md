# Page structure drawn in depth (`/structure-depth/`)

Measured in C157 (headless shell 157.0.8103.78) on 2026-11-21, at 412 px wide with emulated touch and at 1000 px wide with a mouse and a keyboard. Not yet run on A159. Input was sent by a Playwright script (touch through CDP `Input.dispatchTouchEvent` and `touchscreen.tap()`), which is not in the repository. The eight live checks on the page repeat the API results.

Six demos on one page, 2D canvas only, backlog group 17.

| Question | Result | Notes |
|---|---|---|
| Four `<section drawable>` on a cube, drawn in 26 vertical strips per face while it turns | works | The front face is one flat draw at rest. While turning, the face most towards the reader gets one more draw at alpha 0 at its flat place and the other is parked. |
| Landmarks and headings of faces that are turned away | in the accessibility tree | CDP `Accessibility.getFullAXTree`: four `region` nodes named by their headings, three `navigation` nodes, four headings. |
| Tab into a section that is parked (scale 0.001) | works | Focus moves there, `focusin` fires, the page turns the cube to it. |
| `<a drawable>` drawn in 4 px strips, each turned to the angle of a curve | works | Hit region: the link's box turned to the angle at its middle. `elementFromPoint()` returns the link, a click navigates, `href` is unchanged. |
| A drag that starts on a link | pulls the ribbon | Pointer capture is taken only after 8 px of movement, and the click that follows a drag is cancelled. A tap is left alone. |
| Cut an article at each `<hr>` | works | `hr.offsetTop + hr.offsetHeight`, with `position: relative` on the article. Each slice is the whole article under a clip. |
| One element drawn as several pieces, hit in every piece at once | fails | One hit region, at the last draw. Live check, expected fail. |
| Move the region on `pointerdown` with a draw at `globalAlpha = 0` outside a `paint` event | works | The draw is allowed outside `paint`. A touch tap with no delay then presses the control in the piece under the finger. An attribute toggle is needed after the draw. |
| Move the region on `pointerdown` with `updateElementGeometry()` | works | Tried on a test page only. Not used, because the unit of `canvasTransform` has been seen to differ between canvases. |
| Move the region in the next `paint` event after `pointerdown` | too late for a fast tap | With no delay between touch start and end the click went to the canvas. With 60 ms it worked. |
| A `position: sticky` canvas in a native scroller, content drawn at minus `scrollTop` | works | Touch drag on drawn content and wheel scroll the scroller, not the page. Buttons in the article are hit where drawn. |
| Does a scroll of that scroller raise `paint`? | no | 0 events in 300 ms. The `scroll` listener calls `requestPaint()`. |
| Does an element taller than the canvas, inside it, add to the scroller's length? | no | `scrollHeight` 450 px for a 150 px canvas plus a 300 px spacer, with a 450 px element in the canvas. |
| `<header drawable>` folded in four sheared strips by scroll distance | works | Parked while folded, one flat draw when open. |
| Open `<details>` drawn as two parts: body rows widening above, summary larger below | works | Region follows the pointer between the two parts. Checkbox, range input and button in the squashed body took touch taps. |
| Closing drawer | drawn from a snapshot | `captureElementImage()` while open and at rest; the old snapshot is closed before a new one is taken. |
| `<aside drawable>` drawn under a rotation about a pin | works | Client rect is the bounding box of the turned box (115.5 by 94.2 px for 100 by 60 at 0.4 rad). Its checkbox took a tap while it hung turned. |
| `npm run check:jank -- /structure-depth/` | passes | cls 0, 3.5 MB in canvases, 0.88 MP largest, 0 readbacks. |

## Things that bit

- A point-in-piece test in the page's own coordinates is needed before the browser's hit test, so the listener is on the canvas in the capture phase. The target of `pointerdown` itself is still chosen from the old region. Only the tap (click) that follows uses the new one.
- A pendulum whose pin moves straight up or down does not swing. The notes are pushed sideways by the change in scroll speed (direction from the sign), and the real effect of the moving pin is only the stretch of the string.
- The drawer that is out covers the slot below it and takes its taps. The body was made shorter (104 px, drawn at 0.7 of its height) so that only one slot is covered.
- `offsetTop` of a control inside a `<details>` in a canvas was not usable to find its place in the test script. The script used fractions of the drawn body.
- An `<aside>` inside a `<section>` with no name is not a complementary landmark in Chromium's tree. The notes are therefore not listed as landmarks. That is ordinary HTML mapping, not an effect of the canvas.

## Not verified

- Everything on a phone (A159). Opening the page and using each demo would verify it. The most uncertain item: that a real finger tap is resolved after the `pointerdown` listener has moved the hit region (slices and drawer body).
- Frame rate of the ribbon, about 100 clipped and turned draws a frame, and of the cube, 52 strips a frame while turning.
- The long-press menu on a ribbon link ("Open in new tab").
- Scroll momentum in the two inner scrollers, and how momentum scrolling pushes the notes.
- TalkBack on the cube and the cabinet.
- Loss of a context. The fallback to plain HTML was run with a dispatched `contextlost` event only.

## For the index

- Hit testing and updateElementGeometry(): `drawElementImage()` with `globalAlpha = 0` works outside a `paint` event and moves the hit region. Done in a capture-phase `pointerdown` listener it lets one element shown in several pieces take a tap in the piece under the pointer. An attribute toggle is needed after it. measured, C157, `/structure-depth/`.
- Hit testing and updateElementGeometry(): moving the region in the `paint` event that follows `pointerdown` is too late for a touch tap with no delay. measured, C157, test page.
- Drawing elements: a `position: sticky` drawable canvas inside a native scroller is scrolled by touch and wheel on its drawn content. The scroll raises no `paint` event, and content inside the canvas does not add to the scroll length. measured, C157, `/structure-depth/`.
- Accessibility: sections that are parked and not drawn stay in Chromium's accessibility tree as named regions, and Tab reaches them. measured, C157, `/structure-depth/`.

## API requests

- Several hit regions for one element, or a hit-test callback (already requested in `FINDINGS.md`). The slices and the drawer are two more cases, and the `pointerdown` route is the workaround.

## Ideas built

From `public/elements/ideas.js` (structure): "Sections on a cube", "Navigation on a ribbon", "Slices between hr elements", "Header that folds away", "Drawer cabinet from details", "Aside as a margin note on a string". PLAN.md backlog 17.1 to 17.6.
