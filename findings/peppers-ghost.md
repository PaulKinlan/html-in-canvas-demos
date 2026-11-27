# Pepper's Ghost pyramid (`/peppers-ghost/`)

Not verified in a live browser yet as of 2026-11-27. Syntax, graphics rules (`node tools/gfx/check.mjs`) and strict writing rules (`node tools/writing/check.mjs --strict /peppers-ghost/`) were checked statically; live Chromium rendering (C157) and real Android phone hardware and acrylic pyramid reflections (A159) still need to be run.

| Question | Result | Reason or detail |
|---|---|---|
| Does one `ElementGL` WebGL 2 context upload `#ghost-card` with `texElementSubImage2D()` and render both the 3D virtual acrylic chamber and the 4-quadrant Phone Pyramid projector with `gl.getError() === 0`? | Not verified | Check 1 on `/peppers-ghost/` tests both passes on an isolated `ElementGL` fixture and reads a centre pixel of the 3D floating hologram. Run in Chromium 157+ to record the measured result. |
| Do all four Phone Pyramid quadrants (Top, Right, Bottom, Left) paint non-black pixels while the central apex cutout stays pure `rgb(0, 0, 0)`? | Not verified | Check 2 renders the 4-way layout at `apexPx = 44` on an isolated 240 by 240 `ElementGL` canvas and reads all four quadrant centres plus the dead-centre apex pixel. |
| Does projective `updateElementGeometry()` scaled by `geometryUnit()` align `elementsFromPoint()` to buttons and the `<input>` on the floating 3D hologram? | Not verified | Check 3 applies `M_ndcToCss * VP * M_elemToWorld` scaled by `geometryUnit()` plus `dataset.hitTick` and probes the projected button centre and outside corner with `document.elementsFromPoint()`. |
| Can pointer-following `updateElementGeometry()` keep all four rotated and mirrored quadrants interactive in Phone Pyramid mode? | Not verified | `ghost.js` swaps `canvasTransform` to whichever quadrant's inverse affine transform contains the pointer (with cold-tap fallback for touch). Needs browser and Android phone verification, especially on negative-determinant mirrored transforms (`scale(-s, s)`). |
| Does `webglcontextlost` fall back cleanly to plain HTML without calling `loseContext()`? | Not verified | Check 4 dispatches a synthetic cancelable `webglcontextlost` event and verifies `preventDefault()` and DOM move to the plain wrapper. Real memory-pressure loss on Chrome 159 for Android still needs checking. |

## Things that bit

- A single reflection off a 45-degree acrylic sheet flips handedness once. Without horizontal mirroring in each quadrant's local radial frame, text such as `GHOST 1862` reads backwards inside a real smartphone pyramid. `computeProjectorLayout()` defaults `mirrorFlip` to on so physical reflections read left-to-right, and provides a toggle for direct screen viewing.
- Sizing the floating 3D hologram inside a 45-degree inverted frustum has a tight geometric link to the four floor projections: placing the hologram bottom at `y_bot = HOLO_Y - HOLO_H / 2` gives a frustum inner half-width of `r(y_bot) = PYR_R0 + (y_bot - PYR_Y0) = 0.3925`. Keeping `HOLO_W / 2 = 0.36 < 0.3925` keeps the floating hologram clear of all four glass walls and simultaneously places all four 1:1 floor projections radially in `[0.3925, 0.9775]` with zero overlap between adjacent quadrants.
- Drawing all four transparent acrylic faces in a single unordered pass causes front faces to occlude or clip the floating hologram depending on orbit yaw. Sorting faces by `dot(faceDir, eyeHorizontal)` into back faces (drawn before the floating hologram with `depthMask(false)`) and front faces (drawn after it) keeps the glass enclosing the hologram from every 360-degree angle.
- Any bright overlay UI inside the stage (such as the orbit hint pill or crosshair lines crossing the dead centre) reflects as unwanted double-vision ghosts inside a real acrylic pyramid. Phone pyramid mode hides `.pg-hint` and discards crosshair fragments inside the `apexPx` square so the central apex void stays pure `rgb(0, 0, 0)`.
- Fullscreen mode on a desktop monitor can push a full-viewport canvas above the 4 megapixel mobile graphics rule. Styling `.pg-wrap:fullscreen #ghost-canvas` as a centred square capped at `min(92vmin, 640px)` on a `#000000` wrapper matches a physical square pyramid base and stays below 4 megapixels even at device scale 3.

## Not verified

- Running the four live checks on `/peppers-ghost/` in Chromium 157+ and Chrome 159 for Android (A159) at 412 px wide and device scale 2.625.
- Running `npm run check:jank -- /peppers-ghost/` to verify zero layout shift, memory under 96 MB, canvas area under 4 megapixels and zero blank frames on load.
- Physical acrylic pyramid reflection quality on an Android OLED phone screen in Phone pyramid projector mode (including typing into `#ghost-input`, toggling phosphor colours and tapping `+1 Signal` on rotated, mirrored quadrants by touch).
- Confirming Chromium's native hit-testing (`elementsFromPoint()`) behaves consistently when `updateElementGeometry()` receives a negative-determinant mirrored 2D affine `DOMMatrix` in Phone pyramid mode.
- Real GPU frame rate and visual check of Fresnel acrylic edge light-piping and halo bloom on desktop and mobile GPUs.

## For the index

- 3D optics and 4-way reflection: one `ElementGL` WebGL 2 context driving both a 3D 45-degree Fresnel acrylic pyramid chamber (with projective `updateElementGeometry()` on the floating translucent live HTML hologram) and a pitch-black 4-quadrant smartphone Pepper's Ghost projector with pointer-following hit reprojection (not verified in a live browser yet).
