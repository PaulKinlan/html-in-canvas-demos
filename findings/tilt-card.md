# A card leaned by the tilt sensor, and text measured by CSS (`/tilt-card/`, `/text-labels/`)

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

Not verified in the test browser: the tilt sensor (event rate, the permission step, vibration), the on-screen keyboard and IME composition in the drawn input on `/text-labels/`, `createValueRange()` on Chrome 159 (the plan's probe gave a different rect in Chromium 153), frame rate on a phone, and the WebGPU route on screen. `/tilt-card/` prints the sensor's event rate under the cards and `/text-labels/` prints which measuring method it used under the picture.
