# Pixel sparkle ink ripple across live cards (`/sparkle-ripple/`)

Measured in headless Google Chrome `160.0.0.0` canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /sparkle-ripple/` and `--docs --strict`), social metadata validation (`node tools/social/validate.mjs /sparkle-ripple/`), and `6/6` live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed here), and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas burst up to four concurrent Pixel-style quantum sparkle ink ripples from exact tap coordinates across live Material buttons, switches and an editable input while illuminating edges sampled from `texElementSubImage2D()`?

## What was built

One `<canvas id="sr-canvas" content="drawable" layoutsubtree>` inside `.sr-viewport` (`max-width: 520 px`, `396 px` tall on desktop, `404 px` tall at `<= 520 px` width, zero `dvh`, `937x1057 px` / `0.99 MP` at `412 px` and `2.625` DPR) containing a live `drawable` Material You control surface (`#sr-surface`) with no `overflow: hidden` clipping:

- **Live interactive Material DOM (`#sr-surface`)**: editable status `<input id="sr-status-input">` (`user-select: text` inside a `user-select: none` stage), three palette filter chips (`Violet`, `Mint`, `Amber`), a media control card with `Pause` / `Play` and `Boost` buttons, and two `role="switch"` toggle cards (`Edge glow` and `Prism`).
- **One `ElementGL` WebGL 2 context (`/lib/element-gl.js`)**: sets `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at creation, inside `onRestored`, and inside every live-check fixture; gates uploads on `hasPainted = true` inside `'paint'`; calls `stage.begin()` before `stage.upload(surfaceEl)`; packs up to four concurrent ripples into `uRippleOrigins[4]` and `uRippleMeta[4]`; samples neighbouring texels of `uTex` for DOM edge illumination; adds turbulent perimeter noise, two layers of flickering sub-pixel quantum sparkles and crest chromatic shimmer; and keeps hit boxes synced via `updateElementGeometry()` scaled by `geometryUnit()` plus `dataset.hitTick`.
- **Mode controls and fallbacks**: external buttons (`Pixel sparkle`, `Noisy ink only`, `Flat circle CSS-like`), `Sparkle density` (`0%` to `200%`), `Ripple speed` (`0.4x` to `2.5x`), `Trigger ripple`, `Reduced motion` synced with `prefers-reduced-motion` (plus `<meta name="reduced-motion" content="warn">` and `<meta name="reduced-motion-note">` for `.motion-warn`), a 5-argument `drawElementImage()` 2D fallback, and plain-HTML extraction into `#plain-host` on `webglcontextlost` or unsupported browsers.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#sr-surface` via `texElementSubImage2D()` and render `RIPPLE_FRAG` with `glErr === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `240x180` fixture (`tex=630x473`, `glErr=0`, dark card `[18,21,32,255]`, primary button `[208,188,255,255]`). |
| Does launching a ripple at `(x, y)` brighten pixels around the expanding ring vs `t = 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`tMs = 0 -> 190`: 12-point ring mean luminance rose `23.6 -> 91.5`, max ring gain `+109.4`, `glErr=0`). |
| Do up to 4 concurrent ripples overlap cleanly and return to `0` pixel delta after completion? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: 5 launches capped to `4`, `8/8` quadrant sample points lit at `tMs = 260`, `0` active at `tMs = 1500` with `maxPostDelta=0`. |
| Does a tap pass through to live buttons and `<input>` via `updateElementGeometry()` without blocking clicks or ripples? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`btnHit=true`, `inpHit=true`, `clicks=1`, `edits=1`, `ripples=1`). Real pointer interactions on the live stage toggled `Play`/`Pause`, `Boost`, `Mint` palette and input text (`0.99 MP`, `4/4` concurrent waves). |
| Do `webglcontextlost`/`webglcontextrestored` and the 5-argument `drawElementImage()` 2D fallback both work? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`glRestore=true`, 2D copy-read luminance `21.4 -> 57.9`). Standalone 2D fallback run (`texElementSubImage2D` removed) drew `937x1055 px` (`0.99 MP`), `1/4 ripples` on trigger, `0` errors and `scrollWidth === innerWidth === 412`. |
| Does the stage stay drawn within canvas memory limits after fixtures retire? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%`). Post-settle state: `1` active WebGL context (`8.0 MB` across 2 canvases, `0.0 MB` in removed canvases, `0` lost, `0` unasked readbacks, `0` open snapshots, `0` wrong-size draws). |
| Does `prefers-reduced-motion` toggle and restore cleanly, and does plain HTML work without `drawElementImage`? | measured (Chrome 160 Canary, 2026-11-27) | Emulating `reduce` then `no-preference` synced `#ctl-reduced` (`true -> false`) and mounted/removed `.motion-warn` cleanly when page metadata is present in `window.PAGES`. Plain fallback moved `#sr-surface` into `#plain-host` (`scrollWidth === innerWidth === 412`, `0` errors). |

## Things that bit

- **rAF callback timestamps preceding click `performance.now()`:** `stepRipples()` initially dropped entries where `tMs - startMs < 0`, which caused the first `requestAnimationFrame` callback (`document.timeline.currentTime` roughly `0.5 ms` earlier than the input event's `performance.now()`) to delete freshly launched ripples in both WebGL and 2D loops. Keeping entries whenever `elapsed < durationMs` and clamping `elapsed` at `0` fixed it.
- **Readable primary buttons under multiple overlapping ripples:** additive ink wash plus sparkles pushed bright Material buttons (`#d0bcff`) toward white when two or three waves overlapped. Damping additive wash smoothly above `lum > 0.45` kept `"Play"` / `"Pause"` dark text readable while leaving dark card borders and quantum stars bright.
- **Segmented mode border wrapping at 412 px:** a single bordered `inline-flex` `.seg` wrapper left a half-empty border row when `Flat circle CSS-like` wrapped at `357 px` stage width. Giving each mode button its own rounded border with a `6 px` flex gap keeps wrapped rows tidy on narrow screens.

## Not verified

- Headless Chromium 157 and `npm run check:jank -- /sparkle-ripple/` (Playwright isn't installed in this environment).
- Real Chrome 159 on Android at `412 px` and `2.625` DPR: real GPU frame rate across four simultaneous ripples, touch tap vs vertical page scroll (`touch-action: pan-y`) and on-screen keyboard opening inside `#sr-status-input`.

## For the index

- Transitions, text and motion: `/sparkle-ripple/` renders up to four concurrent Pixel-style quantum sparkle ink ripples across live Material buttons, switches and an editable `<input>` in one `ElementGL` WebGL 2 canvas (`texElementSubImage2D()`, sampled DOM edge glow, 5-arg `drawElementImage()` 2D fallback and `updateElementGeometry()` hit testing).
