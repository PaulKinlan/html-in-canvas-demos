# A theme switch that sweeps up the page (`/theme-sweep/`, `lib/theme-sweep.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1, 2 and 2.625, mouse, touch emulation and keyboard) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The idea is saint's Shader Transition, and the page links to it. The code and the copy are mine: I didn't read the source.

| Question | Result | Notes |
|---|---|---|
| `color-scheme: dark` on an element in a canvas changes `light-dark()` colours in its picture | works | Live check: rgb(255,255,255) then rgb(0,0,0). |
| The browser's own button is drawn for the dark scheme | works | Live check: brightness at the middle of an unstyled `<button>` falls by more than 60. The text field darkens too. |
| The change raises `paint` | works | 1 paint event, with no call from the page. |
| The old look from a `drawImage()` copy of the canvas | works | Taken in the `change` listener, before the class changes. |
| The old look from `captureElementImage()` | works | A picture taken before the change draws the light scheme afterwards. The page doesn't use it. |
| A sweep made only from two pictures, in 2D | works, 60 paints a second | The new look, the old look through an even-odd clip that leaves out a circle, and a radial gradient with `lighter`. Longest gap 18 to 33 ms. |
| The same through a shader | works, 26 to 41 paints a second in software | One texture holds both pictures. `shade()` in `lib/glass-gl.js` runs the pass on the context the site's glass effect uses, and the result is drawn with `drawImage()`. Longest gap 123 to 139 ms, on the first frame. |
| Hit testing during the sweep | works | No element is drawn for the length of the sweep. Live check: `elementFromPoint()` returns the card's button after a frame made of the two pictures. |
| Flip again in the middle of a sweep | works | The old look is then the frame that was on screen. |
| Keyboard | works | Space on the switch. The page didn't scroll. |
| Touch | works in emulation | Tap on the switch and on the button. |
| Reduced motion | no sweep | The class changes and the card is drawn once. |
| No API | plain HTML | The switch still changes the scheme. |
| `switch` attribute on a checkbox | not in C157 | The page uses `role="switch"` and its own styles. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 9.4 MB in canvases, no WebGL context until the shader route is chosen. |

## Things that bit

- A direct child of the canvas still needs the `drawable` attribute. Without it `drawElementImage()` threw "Descendants passed to DrawElementImage must have the 'drawable' attribute" and the card was blank.
- The site's `button { background: var(--card) }` kept the card's button pale in the dark scheme. `all: revert` on it fixed that.
- `mount()` in `lib/stage-2d.js` clears the canvas before each paint, so the old look has to be copied in the `change` listener and not in the next paint.

## Not verified

- The paint rate of either route on a phone. The page sends a `theme-sweep` report after each sweep (route, paints, ms, rate, longest gap, scale).
- Whether the first shader frame (compile and texture upload) drops frames on a phone as it does in software.
- A screen reader on the switch.

## Open ideas

- The whole page as the card, in tiles under the 4 megapixel limit.
- The front starting at the switch and not below the card.
- Other fronts from the same two pictures: a wipe along the text lines, a dissolve by noise.
- A WebGPU route through `shared/backend.js`.

## For the index

- Elements: `color-scheme` on a drawn element changes `light-dark()` colours and native controls in its picture and raises `paint`. measured, C157, `/theme-sweep/`.
- 2D drawing: a transition between two states of an element needs one element draw. Copy the canvas before the change, draw once after it and copy again, then draw frames from the copies. The hit box stays where the last draw put it. measured, C157, `/theme-sweep/`.
- WebGL: two pictures stacked in one plain canvas can be one texture for `shade()` in `lib/glass-gl.js`, so a second effect shares the page's one context. measured, C157, `/theme-sweep/`.
- Our mistake: a direct child of a drawable canvas without the `drawable` attribute can't be drawn. `/theme-sweep/`.
