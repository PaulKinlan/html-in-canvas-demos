# Risograph spot-ink press (`/risograph/`)

Measured in headless Chrome Canary 160 (`160.0.8187.0`, ANGLE SwiftShader, `412x780` viewport at device scale `2.625`) on 2026-11-27. Real GPU hardware rendering, `npm run check:jank -- /risograph/`, and Chrome 159 on a physical Android phone are **not verified** yet.

The question: can I split a live interactive HTML zine flyer on the GPU into 2 or 3 subtractive spot-ink Risograph drum plates with tactile paper tooth, soy-ink overprint darkening, and spring-physics drum misregistration that knocks plates briefly out of register whenever you type or click?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context + `gl.texElementSubImage2D()` separation of a live `drawable` flyer across 3 spot-ink palettes | Works (measured, C160) | Live check 1 uploads a `300x150` DOM fixture into `RISO_FRAG` with `gl.getError() === 0`; reads paper `rgb(247,242,227)`, Fluorescent Pink `rgb(245,73,159)` and Medium Blue `rgb(13,118,171)`. Page opens with `1` WebGL context (`994x1229`, `1.222 MP`, `9.77 MB`), zero horizontal overflow (`scrollWidth = 412`). |
| Beer-Lambert multiplicative overprint darkening (`pow(ink, absorb)`) for Fluorescent Pink + Medium Blue | Works (measured, C160) | Live check 2 compares single-drum Pink (`lum 116.0`, `rgb(246,73,159)`) and Medium Blue (`lum 99.6`, `rgb(13,118,173)`) against overlapping `#0000ff` (`lum 36.5`, `rgb(13,35,121)`). |
| Plate offset uniform shifting across a high-contrast step edge | Works (measured, C160) | Live check 3 renders a vertical white-to-magenta edge at `x = 70` and verifies a `+12 px` drum offset shifts `x = 75` from pink (`lum 116`) to cream Munken paper (`lum 241`) while `x = 88` turns pink (`lum 116`). |
| `updateElementGeometry()` alignment scaled by `geometryUnit()` + `dataset.hitTick` | Works (measured, C160) | Live check 4 hits both `<input>` and `<button>` via `document.elementsFromPoint()` on a `(28, 22)` translated `ElementGL` fixture (`geometryUnit = 1.00`). Real CDP pointer clicks on `#poster-stamp`, `Spot 1`, and `#poster-title` + typing `'!'` succeeded, including single-plate Drum 1 isolation shifted `+10 px` (`hitsButton: true`). |
| Spring-physics bounce, `prefers-reduced-motion` gate, and `webglcontextlost` plain-HTML rescue | Works (measured, C160) | Real click on `+1 Impression` kicked offsets to `A(+3.6,-1.8) B(-4.0,+2.2)` and settled back to `A(+1.0,-0.5) B(-1.0,+0.7)`. With `--disable-blink-features=CanvasDrawElement` or a dispatched `webglcontextlost` event, `#poster-card` moves into `#plain-host`. |

## Things that bit

- Separating live DOM RGB directly with raw `cmy = 1 - rgb` causes pure pink (`#ff0099`) or cyan (`#00b8ff`) flyer elements to bleed into the third ink drum. Pulling out the neutral grey component `k = min(cmy)` first and separating `chr = cmy - k` keeps primary spot colours isolated on their own plates while allowing neutral dark typography to print across multiple drums.
- On a 412 px phone, sizing the canvas height from `vh` or `dvh` resizes the backing store when the mobile URL bar moves. Fixing `.press-viewport` height in CSS pixels (`468 px` below `480 px` wide, `496 px` above) keeps the backing store at `1.22 MP` (below the 4 MP limit) with zero viewport-resize clears.
- When reading pixels back in a live check right after `g.begin()`, `cv.width` only reflects `devicePixelRatio` after `g.begin()` runs. Computing `dpr = cv.width / w` before `g.begin()` used the HTML default `300` width instead of the DPR-scaled buffer width.
- Placing `.stage-hud` as an absolute overlay inside `.press-viewport` overlapped the bottom margin registration crosshairs on a 412 px screen. Moving it into a fixed-height bar directly below `.press-viewport` keeps all four margin crosshairs and roller tracks clear.

## Not verified

- Running `npm run check:jank -- /risograph/` (skipped here because it invokes `npm run build` and writes generated files outside the page folder).
- Real GPU hardware rendering, spring frame rate, and touch interaction (direct sheet dragging, typing with the virtual keyboard, range sliding, `+1 Impression` stamping) on Chrome 159 for Android at 412 px and device scale `2.625`.
- Visual comparison of `Roller streaks` and ~240 LPI stipple grain on a physical HiDPI phone display versus ANGLE SwiftShader.

## For the index

- WebGL shaders and spot printing: `/risograph/` separates one live editable HTML zine flyer uploaded with `texElementSubImage2D()` on a single `ElementGL` context into 2 or 3 subtractive spot-ink Risograph plates with Beer-Lambert overprinting, stochastic halftone grain, spring-physics misregistration and `updateElementGeometry()` hit alignment (measured, C160).
