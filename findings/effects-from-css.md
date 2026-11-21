# Effects driven by CSS, the tilt sensor and text measured by CSS (`/scroll-fx/`, `/shape-ui/`, `/tilt-card/`, `/text-labels/`)

Measured in C157 (headless shell, software rendering) on 2026-11-21. The WebGPU comparisons used a software adapter in the same browser.

## `/scroll-fx/` and `/shape-ui/`

Built from the Chrome APIs plan (`/chrome-apis/`, demos 6 and 7). Both pages use the `fx` attribute, with effects defined in the page. Chromium 157, software rendering.

| Experiment | Result | Why |
|---|---|---|
| `animation-timeline: view()` on an element that is a canvas child, animating `--fx-progress` | works | The element's view timeline follows the page's scroll position although the element is only drawn through its canvas. The fx library reads the property once per frame. |
| `animation-timeline: scroll(root)` on an ancestor, inherited by canvas children | works | Registered custom properties with `inherits: true` cross the shadow root and the canvas. |
| Scroll speed with no script: `--lag: var(--pos); transition: --lag 120ms linear`, speed = `--pos - --lag` | works | The transition has to be on a descendant of the element whose animation moves `--pos`. Peak difference 0.42 of the scroll range in the check. |
| `scroll-state(stuck: top)` container outside the canvas styling an element inside it | works | The sticky holder is the query container. The drawn bar gets `--fx-amount: 1` and a new background. |
| `timeline-trigger` with `animation-trigger: play-forwards reset` on a canvas child | works | The animation runs by the clock after the scroll stops. In the small check fixture the reset on leaving was not seen within 200 ms. On the page it resets. |
| A drawer on the overscroll area | not built | No `overscroll-area` property in Chromium 157. |
| `corner-shape`, `border-shape: circle()`, `clip-path: shape()` in the element's alpha | works | Corner pixel alpha 0, middle 255, for all three. |
| A normal from alpha: 16 samples in a 7 px disc, height = share inside, slope = alpha-weighted mean offset | works | One pass, no blur pass. Smooth between about 3 px and 14 px of bevel. |
| A shadow with the element's outline, drawn by the element's own shader | works | Alpha read 18 px towards the light, 8 jittered samples, inside 30 px of canvas bleed. It cannot darken a neighbouring canvas. |
| `elementFromPoint()` in a corner cut away by `corner-shape`, `border-shape` or `clip-path` | outline | Not the element, in a canvas and as plain DOM. Hit testing follows all three outlines. |
| Pressing: `:active` scales a key inside a shared picture | works | The alpha changes, so bevel and shadow follow with no code. |
| GLSL and WGSL versions of the eight new effects give the same picture | works | Mean difference under 0.4 of 255 per channel, WebGPU drawn into a texture on a software adapter. |

Both pages ask `/shared/backend.js` for WebGPU first and otherwise mark every element `fx-backend="shared"`, so a page opens one WebGPU device or one WebGL context (`/shared/fx-route.js`).

## `/tilt-card/` and `/text-labels/`

Built from the Chrome APIs plan (`/chrome-apis/`, demos 11 and 8). Chromium 157, software rendering, 2026-11-21.

`/tilt-card/` draws three HTML cards through `fx` effects defined in the page (foil, hologram, lenticular). `lib/tilt-light.js` writes the lean to `--fx-x` and `--fx-y`. `/text-labels/` is one 2D canvas with no shader.

| Experiment | Result | Why |
|---|---|---|
| A `deviceorientation` event drives the shader and the hit box through `--fx-x` and `--fx-y` | works with a synthetic event | A 14 degree turn with a range of 28 gives `--fx-x` 0.50. The test browser has no sensor, so real events are not verified. `DeviceOrientationEvent.requestPermission()` and `navigator.vibrate` exist in the test browser, `navigator.haptics` does not. |
| A button on a card that leans in perspective is hit where it is drawn | works | The effect's `geometry` matrix goes to `updateElementGeometry()`. The button's box changed by 7.6 px and `elementFromPoint()` at its drawn middle returned the button. |
| The surface changes with the lean without a new upload of the element | works | 26% of the pixels changed between lean -0.6 and 0.6 with the card held flat. Only uniforms changed. |
| A colour key: CSS paints a block magenta and the shader replaces it with a hologram | works | Middle of the block reads 255,0,255 in plain HTML and 1,64,49 under the shader. The key is a distance in colour, so a magenta-like colour elsewhere on the card would also be replaced. |
| Two faces of a badge interleaved in 6 px strips by `mask-image` whose stops depend on `--fx-x` | works | Share of the second face 0.00 at lean -0.4, 0.50 at 0, 1.00 at 0.4. The shader adds only the lens ridges. Input goes to one face through `pointer-events`, switched by script when the lean crosses zero. |
| GLSL and WGSL versions of foil, hologram and lenticular give the same picture | works | Mean difference at most 0.10 of 255 per channel, WebGPU on a software adapter in the Chromium 157 shell. |
| `text-fit: grow` on a canvas child, drawn at its `offsetWidth` | works | 12 px text is drawn 233 px wide in a 240 px box. `text-fit` only grows, so a label that must also shrink needs a small base font size. |
| `text-box: trim-both cap alphabetic` on a canvas child | works | Untrimmed the element is 72 px tall and the ink starts at row 14. Trimmed it is 41 px tall and the ink starts at row 0. Descenders are outside the trimmed box and are cut by the element's picture, so the page uses capitals where it trims. |
| `writing-mode: sideways-lr` with `text-fit` | works | Ink 25 × 108 px in an element of 25 × 110 px. The fit is along the vertical axis. |
| `input.createValueRange(i, i + 1).getBoundingClientRect()` for an input drawn in a canvas | works | One box per character, and the drawn ink is inside the boxes (143, 0 and 151 ink pixels for a letter, a space and a letter). The rect is in viewport coordinates at the drawn position, as in the plan's probe for Chromium 157. |
| `measureText()` with the input's computed font against `createValueRange()` | agrees | 12 characters, left edges differ by at most 0.01 px. `lib/char-rects.js` uses it where `createValueRange()` is missing. It does not handle scrolled or right-to-left values. |
| Animating single characters of a live input | works | The canvas draws the input, copies the pixels of a character box and draws that copy scaled, flying or in 4 px pieces. A deleted character is taken from the copy of the previous frame. Letter colour is recovered from darkness, so it assumes dark text on a light field. |

## Things that bit

- An `fx` element inside a flex stage needs a holder with `flex:none; box-sizing:content-box` and an explicit width, or the surface has width 0 and is never drawn.
- A surface reports `ready` and a frame count above 0 before the element's picture is uploaded. A check that reads a snapshot first waits for a pixel of the element.
- Elements moved into their canvases after the menu revealed the page, which shifted the layout about one run in five. `loadFx()` sets `data-hold` on `<html>` and `nav.js` keeps the first paint held while it is set.
- An idle animation of the light starved the live checks in software rendering. The checks turn it off while they run.
- The WebGPU comparison check needs the Chromium 157 shell started with `--enable-unsafe-webgpu --enable-unsafe-swiftshader --enable-features=Vulkan --use-angle=swiftshader`. Chromium 153 has no `updateElementGeometry()`.

## Not verified

- Touch scrolling against main-thread property reads (the shader may trail the block by a frame or more), the tilt sensor, frame rate on a phone, and the WebGPU route on screen. Verify on the phone: scroll `/scroll-fx/` by touch and press "Use the phone's tilt" on `/shape-ui/`.
- the tilt sensor (event rate, the permission step, vibration), the on-screen keyboard and IME composition in the drawn input on `/text-labels/`, `createValueRange()` on Chrome 159 (the plan's probe gave a different rect in Chromium 153), frame rate on a phone, and the WebGPU route on screen. `/tilt-card/` prints the sensor's event rate under the cards and `/text-labels/` prints which measuring method it used under the picture.

## For the index

- CSS: scroll-driven animations, `scroll-state()` and `timeline-trigger` set registered custom properties on canvas children (measured, C157, `/scroll-fx/`).
- CSS: `corner-shape`, `border-shape` and `clip-path: shape()` are in the element's alpha, and hit testing follows them (measured, C157, `/shape-ui/`).
- CSS: `text-fit`, `text-box-trim` and `sideways-lr` size a canvas child, which is drawn at that size (measured, C157, `/text-labels/`).
- Input: `createValueRange()` rects of a drawn input are at the drawn position and match the ink (measured, C157, `/text-labels/`).
- Hit testing: a perspective matrix given to `updateElementGeometry()` keeps buttons on a leaning card pressable (measured, C157, `/tilt-card/`).
- Sensors: `deviceorientation` to shader and hit box works with synthetic events (measured, C157). Real sensor not verified.

## For the other documents

- README libraries: `public/lib/tilt-light.js` (`tiltLight(el)` writes the pointer, a drag or `deviceorientation` to `--fx-x` and `--fx-y`; call `light.useSensor()` in a tap), `public/lib/char-rects.js` (`charRects(input)`: one box per character from `createValueRange()`, else `measureText()`), `public/shared/fx-route.js` (`loadFx({ targets, mount })`: one graphics context for an fx page, plain HTML for a surface whose context is lost; `sameOnWebGPU(names)` live check).
- PLAN: demos 6, 7, 11 and 8 of the Chrome APIs plan are built as these four pages. The overscroll drawer of demo 6 was not built (no `overscroll-area` in C157).
