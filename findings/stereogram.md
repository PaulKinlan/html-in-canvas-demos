# Live DOM autostereogram (`/stereogram/`)

Built on 2026-11-27. Syntax checked with `node --check public/stereogram/stereogram.js`, graphics rules checked with `node tools/gfx/check.mjs`, and prose checked with `node tools/writing/check.mjs --strict /stereogram/`. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /stereogram/`, and Chrome 159 on Android at 412 px) are **not verified** yet.

The question: can a live editable HTML form's contrast and element geometry drive a real-time GPU single-image random-dot autostereogram so typed letters and clickable buttons emerge in hidden 3D depth while staying directly interactive?

| Experiment | Status | Notes |
|---|---|---|
| Live HTML form uploaded via `ElementGL` (`texElementSubImage2D()`) into a single-pass backward-chain autostereogram fragment shader | not verified | Live check 1 creates an isolated `ElementGL` fixture on `testStage()`, uploads live HTML, draws Mode 0 and checks `gl.getError() === 0` plus non-flat luminance spread. Needs Chromium 157+ live run to record measured output. |
| Horizontal repeat-period shift over bright (raised) vs dark (recessed) live DOM regions | not verified | Live check 2 draws a split `#000000` / `#ffffff` fixture with `stripW = 60` px and `depth = 0.30` (expected 18 px shift) and measures the best-matching horizontal repeat lag on both scanlines via autocorrelation. Needs browser run to record measured periods. |
| Cross-eye stereo pair, red/cyan anaglyph, wiggle 3D parallax and depth overlay modes on the same WebGL 2 shader | not verified | Live check 3 draws modes 1 through 4 on an isolated fixture, checks `gl.getError() === 0` for each mode and verifies red/cyan channel edge separation (`|R - B|`) in Anaglyph mode. Needs Chromium 157+ run. |
| Interactive hit-box alignment with `updateElementGeometry()` scaled by `geometryUnit()` | not verified | Live check 4 places an isolated fixture form containing an `<input inputmode="none">` and `<button>` at a canvas offset, applies `updateElementGeometry()`, clears Chromium's hit-test cache with `data-hit-tick` and verifies `document.elementsFromPoint()` hits both controls. Needs Chromium 157+ run at DPR 1 and DPR 2.625. |
| 2D `drawElementImage()` 5-argument fallback and plain-HTML rescue on context loss or missing API | not verified | Uses a 5-argument `ctx.drawElementImage(cardEl, x, y, w, h)` fallback when WebGL 2 `texElementSubImage2D()` is absent, and moves `#depth-card` into `#plain-host` when HTML-in-canvas is disabled or the WebGL context is lost. |

## Things that bit

- A naive left-to-right autostereogram recurrence (`C(x) = C(x - S(d(x)))`) places the perceived 3D silhouette half a strip width to the left of the depth map, because the binocular pair `(x - S, x)` fuses at midpoint `x - S/2`. Sampling depth at `px - 0.5 * sep` inside the backward loop centres the perceived 3D relief straight over `updateElementGeometry()` so clicking a floating button hits the real button rather than empty space beside it.
- Non-periodic hash noise in the seed strip leaves visible vertical seams wherever a depth transition crosses `px = 0` or `px = stripW`. Quantising every noise lattice and ASCII glyph column count to an integer divisor of `stripW` with `mod(ix, N)` removes strip seams completely while keeping sub-pixel float coordinates smooth across bevelled edges.
- In Cross-eye stereo pair mode the same live HTML form is rendered twice side by side (right eye on the left half, left eye on the right half), while `updateElementGeometry()` holds only one `DOMMatrix` per drawable element. Tracking `pointermove` and `pointerdown` across the stage swaps `updateElementGeometry()` onto whichever half you point at and toggles `data-hit-tick` so Chromium clears its cached hit-test entry.
- `tools/writing/check.mjs` flags the word `magic` as a `vocabulary` error and JSON files can't hold a `writing-allow` comment, so `page.json` uses the technical title `Live DOM autostereogram` while the on-page mode switch keeps the familiar 1990s name behind an HTML allow comment.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /stereogram/` and tap-gated live checks 1 to 4): confirm zero layout shift, zero unasked readbacks, backing store well under 4 MP at 412 px and DPR 2.625, and record exact measured repeat periods and hit-test units.
- Real eyes on desktop and on Chrome 159 on Android at 412 px wide by touch: test free-fusing all four autostereogram patterns (confetti dots, retro wallpaper, ASCII stipple, live DOM texture), crossing eyes on the stereo pair, viewing Anaglyph 3D through red/cyan glasses, rocking Wiggle 3D, typing into the headline `<input>` inside the stereogram, and tapping `Pop +`, `Invert depth`, `Pulse wave` and the relief slider.
- Caret blink repaint rate in Chromium 159 on Android while `#stereo-text` is focused inside the stereogram canvas.

## For the index

- WebGL and 3D: `/stereogram/` drives a single-pass GPU backward-chain autostereogram (plus cross-eye stereo pair, red/cyan anaglyph, wiggle 3D and depth overlay) straight from an editable HTML form uploaded with `texElementSubImage2D()` on one `ElementGL` context, keeping the form clickable through `updateElementGeometry()` scaled by `geometryUnit()`.
