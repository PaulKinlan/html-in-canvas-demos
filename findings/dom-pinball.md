# DOM pinball made from live form controls (`/dom-pinball/`)

Built on 2026-11-22. Live browser behaviour is not verified in Chromium 157 (C157) or Chrome on Android (A159) yet; static checks (`check:gfx` and `check:writing`) passed locally, and the page ships six isolated live checks to measure each behaviour in the visitor's browser.

This experiment builds on the four element games in `/play/` and takes inspiration from classic web DOM-physics toys such as Google Gravity and Matter.js DOM wrappers. Rather than syncing CSS transforms onto separate DOM elements and fighting stacking order for shadows and motion trails, every playfield control lives inside one drawable 2D canvas.

The question: can a 2D physics pinball table use real HTML form controls as its bumpers, tiltable ramps, gates, scoreboards and ball traps so collisions mutate the DOM and user taps on the controls change the physics mid-flight?

| Experiment | Result | Why |
|---|---|---|
| Three round `<button class="bumper" drawable>` bumpers mutated by ball impact | not verified | On collision, the physics loop adds `.hit`, increments the bumper's `<small>` hit counter and updates `<output id="scoreboard">`. Live check 1 measures whether the class and text mutation raises `paint` and changes the copied pixels without calling `requestPaint()`. |
| Two `<input type="range" drawable>` ramp sliders rotated via `ctx.rotate()` | not verified | Dragging either slider updates its tilt angle in degrees, redraws the slider rotated with five-argument `drawElementImage()`, toggles `data-moved` to clear Chromium's hit-test cache, and rotates the ramp collision segment. Live check 2 tests `elementFromPoint()` on and off a 25 degree rotated slider. |
| `<label drawable><input type="checkbox"> Gate</label>` diverter barrier | not verified | Unticking the checkbox disables the right-lane diverter segment and opens an express `+75` lane. Live check 3 verifies that changing `.checked` raises `paint` and tests the collision solver in both states. |
| `<details drawable>` saucer trap toggled open on capture | not verified | Rolling into the saucer zone sets `details.open = true`, expanding the drawn control to reveal `+250` while holding the ball for 720 ms before ejecting it. Live check 4 checks that `details.open = true` raises `paint`, increases `offsetHeight` and paints the revealed bonus pixels. |
| Two pivoted `<button drawable>` flippers driven by touch, clicks or keyboard | not verified | Each flipper rotates round its hinge using `ctx.translate()` and `ctx.rotate()`, transfers surface velocity from angular speed to the ball, and toggles `data-moved` while swinging. Live check 5 verifies `elementFromPoint()` and click dispatch on a blade rotated to -25 degrees. |
| Single 2D canvas budget, reduced motion and `contextlost` / `contextrestored` fallback | not verified | Logical table is 380 by 560 CSS pixels (~1.47 MP at DPR 2.625, under the 4 MP limit). Loop pauses off screen (`IntersectionObserver`) and starts paused when `prefers-reduced-motion: reduce` is set. `contextlost` moves the ten controls into a plain HTML container; `contextrestored` moves them back. Live check 6 runs `stillDrawn()` via a plain `drawImage()` copy. |

## Design notes

- Passing five arguments to `drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight)` inside the DPR-scaled context keeps every control at its CSS size on high-density phones instead of inflating by `devicePixelRatio`.
- Pixel reads in the live checks and `stillDrawn()` copy the drawable canvas into a plain 2D canvas (`willReadFrequently: true`) with `drawImage()` and retire every fixture canvas with `window.__gfx?.retire()`.
- `touch-action: pan-y` on the canvas and `touch-action: none` on the ramp sliders and flippers is meant to let you scroll the page from empty playfield space while dragging a ramp or holding a flipper.

## Not verified

- Running the six live checks in headless Chromium 157 (`npm run check:jank -- /dom-pinball/` and `node tools/draw-size/audit.mjs /dom-pinball/`).
- Chrome on Android (412 px wide, DPR 2.625): dragging a rotated `<input type="range">` thumb with a finger while balls are moving, holding both flippers at once with multitouch, and verifying `touch-action` separation between the canvas and the sliders.
- Frame rate during three-ball multi-ball with trails, drop shadows and expanding bumper rings on a phone GPU.
- Screen reader announcements for `<output id="scoreboard" aria-live="polite">` and keyboard focus visibility on rotated controls.
- Real `contextlost` and `contextrestored` recovery on Android hardware, plus Web Audio click and chime latency when the sound checkbox is ticked.

## For the index

- Drawing and hit testing: a 2D physics pinball table built from ten live `drawable` controls (`<button>`, rotated `<input type="range">`, `<input type="checkbox">`, `<details>`, `<output>`) on one canvas. not verified, `/dom-pinball/`.
