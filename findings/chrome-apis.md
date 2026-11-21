# Recent platform features on drawn elements (`/chrome-apis/`)

`/chrome-apis/` lists the 678 features that chromestatus.com records for Chrome 130 to 160 with an idea for 359 of them and a ranked plan of 28 demos; the same content as one document is `/chrome-apis/plan.md` (`public/chrome-apis/plan.md` after `npm run build`). `/chrome-apis/probes.html` holds 27 probes, each of which draws one small element with one feature on and reads the result back. `npm run record:probes` runs them with real mouse and keyboard input in the two Chromium builds installed beside Playwright: the 157 headless shell and the 153 full browser with the `canvas-draw-element` flag.

| Experiment | Result | Why |
|---|---|---|
| `corner-shape`, `border-shape`, `clip-path: shape()`, gap decorations, `text-fit` on a drawn element | works | All are applied in the element picture; outlines arrive as alpha. |
| `::scroll-marker` and `::scroll-button()` of a scroller inside a canvas | works | The pseudo-elements are in the picture, and a real click on a drawn marker scrolled the list. |
| `scroll-state(stuck)` query, and a scroll-driven animation, inside a drawn element | works | Both restyle the element and raise `paint` with no `requestPaint()`. |
| `streamAppendHTML()` into a drawn element | works (157) | One `paint` event per chunk. The method is missing in 153. |
| CSS `random()` | stable (157) | The same value on two paints, so a per-element seed does not flicker. Missing in 153. |
| An element outside the canvas anchored to a canvas child | follows the drawn position in 157 | Drawn at 100,50, the anchored element moved by 100,50. In 153 it stays at the layout box. |
| `interestfor` on a drawn button | opens on hover in 157 | Hover at the drawn position opened the hint. Failed in 153. |
| `highlightsFromPoint()` and `OpaqueRange` rects on an element drawn away from its box | use the drawn position in 157 | In 153 both use the layout box. |
| `command` and `commandfor` on a drawn button | works | A click opened a popover that lives outside the canvas. |
| A popover that is a descendant of a drawn element | not in the picture | It is shown in the top layer at its own position and hit tested there. |
| `focusgroup` arrow keys between drawn buttons | works | |
| `caret-shape: block` with `caret-animation: manual` | works | 215 caret pixels in the picture against 24 for a bar. |
| `interactivity: inert` on a drawn element | works | Still drawn; `elementFromPoint()` skips it. |
| Element Timing for text and an image inside a canvas | reported | Entries carry `renderTime` and `presentationTime`. |
| Display P3 and values above 1.0 in a `float16` canvas | kept | `color(display-p3 1 0 0)` read back as 1, 0, 0; `color(srgb-linear 4 4 4)` read back as 1.82. |
| `:visited` colour in a picture that script can read | drawn as unvisited | Measured in 153 with a profile that keeps history: 921 visited-colour pixels on screen, 0 in the canvas. |
| `<geolocation>`, `<usermedia>`, `<camera>`, `<microphone>` as canvas children | drawn, not valid | `<geolocation>` reports `isValid` false, reason `intersection_occluded_or_distorted`. |

Things that bit:

- The two installed builds are different versions. The headless shell is 157 and behaves as if experimental web platform features were on; the full browser is 153 and needs the flag. Four results differ between them, and all four are about where the browser thinks a drawn element is. Chrome 159 on a phone has not been compared with either.
- The headless shell keeps no history, so `:visited` never matches there. The probe reports that it could not tell, and the 153 run is the one that counts.
- A fixture that sits below a 200 px `overflow: hidden` box is clipped out of screenshots. The comparison link for the `:visited` probe was invisible until the box was made taller.
