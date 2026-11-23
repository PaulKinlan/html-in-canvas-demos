# A window that pours into the dock (`/genie/`, `lib/genie.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1, 2 and 2.625, mouse, touch emulation and keyboard) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The idea is Raphael Salaja's Genie Minimise, after the macOS Dock effect, and the page links to it. The code and the copy are mine: I didn't read his source.

| Question | Result | Notes |
|---|---|---|
| Bend a `<dialog>` into a funnel in a 2D context | works | `genie()` draws one strip for each 2 px row. Up to 92 strips a frame for a window 250 by 184 px. |
| Speed by source rectangle | 60 paints a second | 33 paints in 0.55 s, software rendering. |
| Speed by clip (a whole draw for each row, clipped) | 60 paints a second | 33 paints in 0.55 s. |
| Do the two routes draw the same shape | yes | Live check: 37.7% of the fixture canvas has ink by each. |
| Time to issue 60 strips | about 0.3 ms a frame by either route | Recording only. It doesn't include rasterising. |
| Hit box after 60 source-rectangle strips | wrong | 0 of 20 points in the layout box hit the window. |
| Hit box after 60 clipped strips | wrong | 4 of 20 points hit it. |
| One whole draw afterwards | restores it | 20 of 20. |
| `updateElementGeometry()` scaled to a point, after strips | no hits | 0 of 20. The page does this for a window that is moving. |
| A closed dialog in a `drawable` wrapper | nothing to draw | The wrapper is 0 px tall, the draw doesn't throw, 0% ink. |
| `<dialog open drawable>` with its default `position: absolute` | has a picture | 100% ink in the live check. `findings/top-layer.md` says a drawable dialog needs `position: static`. In this fixture it didn't. |
| `dialog.show()`, then strips on the next paint | works | No frame was missed for want of a picture in the test browser. The page waits up to 60 frames if there is none. |
| State while closed | kept | Text typed in the textarea was there after a round trip. The timer counted 2.4 s across a minimise and restore. |
| Keyboard | works | Enter on the minimise button closes the window and focus goes to its dock button. Enter there opens it and `show()` puts focus on the minimise button. The page didn't scroll. |
| Touch | works in emulation | Taps on the dock, Start and minimise. |
| Reduced motion | no movement | The dialog closes at once. |
| No API | plain HTML | The dialogs open and close from the same buttons. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 14 MB in canvases. |

## Things that bit

- `"question"` in `page.json` had a bare `<dialog>` in it. The About box puts that text in the page as HTML, so the rest of the question went inside a closed dialog and wasn't shown. I saw it at desktop width, where the box is open. The text now uses `&lt;dialog&gt;`.
- A centred dock with `left: 50%` and `transform: translateX(-50%)` can't be placed from `offsetLeft`, which ignores the transform. The dock is centred with `margin: auto` and `width: max-content`.
- The first report line said "0 strips a frame", because the last frame of a minimise draws none. It now reports the most strips in any frame.

## Not verified

- The paint rate on a phone, and the cost there of 92 draws of one element a frame.
- Whether the on-screen keyboard stays down when a window comes back by touch. `show()` focuses the minimise button, which is first in the markup for that reason.
- What a screen reader says when a window closes. The dock buttons have `aria-expanded` and `aria-controls`.
- Why 4 of 20 points still hit after the clip route. My guess is that the last clipped draw leaves a whole-sized box under the last strip's transform.

## Open ideas

- Drag a window by its title bar, and pour it into the dock from wherever it is.
- The macOS "scale" effect and a "suck" effect beside this one, as other shapes for the same strips.
- A WebGL mesh version to compare with 92 strips.
- Pour a `popover` out of the button that opens it.

## For the index

- 2D drawing: a window can be bent into a funnel with one nine-argument `drawElementImage()` for each 2 px row. 92 strips a frame drew at 60 paints a second in software, and a clip for each row cost the same. measured, C157, `/genie/`.
- Hit testing: after many source-rectangle draws of an element none of its layout box is hit. One whole draw restores it. `updateElementGeometry()` scaled to a point takes it out of hit testing meanwhile. measured, C157, `/genie/`.
- Elements: a closed `<dialog>` in a `drawable` wrapper leaves the wrapper 0 px tall, and drawing it doesn't throw. A `<dialog open drawable>` with `position: absolute` has a picture. measured, C157, `/genie/`.
- Our mistake: an unescaped tag in a `page.json` question hides the rest of the About box. A check in `tools/site/` could catch it. `/genie/`.
