# tvOS multi-layer parallax poster (`/tvos-poster/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` and `412x780` viewports, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /tvos-poster/` and `--docs --strict`), social validation, and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (`playwright` isn't installed in this environment), and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas tilt three separate `drawable` HTML poster layers in 3D with inter-layer cast shadows and a diagonal glossy sheen while keeping an editable title input and action buttons clickable?

## What was built

One `<canvas id="tv-canvas" content="drawable" layoutsubtree>` inside `.tv-viewport` (`460 px` tall on desktop, `416 px` capped at `64svh` below `620 px`, with zero `dvh`) compositing three `268 x 376` CSS px `drawable` HTML layers:

- **Depth 0 (`#tv-layer-bg`)**: atmospheric key-art gradient, orbital glow and geometric inline SVG silhouettes for three themes (`Midnight Orbit`, `Solar Dune`, `Emerald Noir`).
- **Depth 1 (`#tv-layer-mid`)**: format, rating and runtime pills, a centred inline SVG geometric emblem and a metadata strip separated along Z.
- **Depth 2 (`#tv-layer-fg`)**: status pill, editable embossed `<input id="poster-title-input">`, director subtitle and live `Play trailer` / `+ Watchlist` buttons floating highest above the card.
- **One `ElementGL` WebGL 2 context (`/lib/element-gl.js`)**: sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` on creation, in `onRestored`, and inside every fixture; gates uploads on `hasPainted = true` inside `paint`; calls `stage.begin()` before `stage.upload()`; clips poster corners to a continuous squircle SDF; blurs midground and foreground alpha masks at UV offsets opposite the pointer light; and sweeps a diagonal specular sheen across the card face.
- **Controls and fallbacks**: `Midnight Orbit`, `Solar Dune` and `Emerald Noir` theme buttons, `Centre`, `Auto tilt`, `Reduced motion` (synced with `prefers-reduced-motion` and `.motion-warn`), `Split layers` (`0..40 px`) and `Tilt depth` (`0..20°`), plus a 5-argument `drawElementImage()` 2D parallax fallback and plain-HTML stacking inside `#plain-host` on context loss.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Do all three `drawable` layers upload cleanly via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`glErr=0`, `473x630` layer textures, midground cyan `[82,217,255,255]`, foreground amber `[255,179,33,255]`). |
| Does pointer tilt `(-1,-1)` vs `(+1,+1)` shift foreground relative to background and sweep corner sheen? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed: spring settled `(0.58, 0.30)` with explicit timestamps; foreground marker moved `(31.6, 29.3) px`; top-left/bottom-right corner luminance flipped from `111/23` to `23/112`. |
| Does raising `Split layers` Z-separation (`0 -> 36 px`) increase inter-layer parallax shift and cast shadows? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: foreground offset relative to background centre grew from `-0.1 px` at `0 px` to `+21.0 px` at `36 px` (`+21.1 px`), with shadow-side luminance `89` vs lit-side `415`. |
| Does projective `updateElementGeometry()` keep tilted foreground buttons clickable and the title input editable? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on fixture (`trailer (103.9,229.5)=true [BUTTON]`, `watchlist (195.3,226.5)=true [BUTTON]`, `clicks=1`). Real CDP pointer clicks on the live tilted page toggled `Stop trailer`, `✓ In Watchlist` and inserted text into `#poster-title-input`. |
| Does `webglcontextlost`/`webglcontextrestored` rescue to plain HTML and does 5-arg `drawElementImage()` 2D fallback render? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`rescuedToPlain=true`, `restored=true`, `glErr=0`, `2dFallback=true`, `cyan=7670`, `amber=7200`, `wrongDraws=0`). |
| Does the stage stay drawn, hold steady under 4x CPU throttle at `412 px` (`2.625` DPR), and toggle `.motion-warn` cleanly? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%`). Idle 4x-throttled run (`412x780`, 3.2 s) measured `cls=0`, `focusMoves=0`, `scrollX=0`, `scrollY=0`, `scrollWidth=412 === innerWidth=412`, `1` WebGL context (`1.09 MP` `994x1092`, `8.68 MB`), `0` lost, `0` unasked readbacks, `0` open snapshots, `0` wrong-size draws, peak `2` GL contexts during checks. Emulating `prefers-reduced-motion: reduce` raised `.motion-warn`, toggled `#tv-stage.hidden`, and restored cleanly on `no-preference`. |
| Do the 2D `drawElementImage()` and plain-HTML fallbacks work without horizontal overflow? | measured (Chrome 160 Canary, 2026-11-27) | With `texElementSubImage2D` deleted, 2D mode rendered `4.49 MB` (`1.12 MP`), `scrollWidth=412 === innerWidth=412`, Checks 4, 5 and 6 passed, `0` errors. With `drawElementImage` deleted, `#plain-host` stacked the three layers at `scrollWidth=412`, `0` errors. |

## Things that bit

- **Keeping `glPeak` under the jank guard's limit during sequential checks**: `window.__gfx.retire()` releases removed WebGL canvases asynchronously on a `500 ms` tick, so five consecutive fixture checks pushed `glPeak` to `5`. Calling `settleGfx(baseActive)` at the end of each fixture's `finally` block dropped `glPeak` from `5` to `2`.
- **Avoiding `pow(0.0, 3.8)` inside the squircle SDF**: GLSL ES `pow(x, y)` can produce `NaN` on `x == 0` along straight box edges in SwiftShader and mobile drivers, so `sdSquircleBox` clamps corner terms before exponentiation and skips `pow` when `pos` is near zero.
- **Separating pointer hit targets across depth layers**: giving `#tv-layer-bg` and `#tv-layer-mid` `pointer-events: none` while keeping `pointer-events: auto` on `#poster-title-input`, `#btn-trailer` and `#btn-watchlist` prevents lower layers from intercepting taps or dragging on empty card areas.

## Not verified

- Real Android hardware on Chrome 159 (`412 px` wide, `2.625` DPR): touch drag smoothness, hardware GPU frame pacing, and on-screen keyboard behaviour when focusing `#poster-title-input` on a tilted plane.
- `npm run check:jank -- /tvos-poster/` (`playwright` isn't installed in this environment).

## For the index

- 3D, spatial and WebXR: `/tvos-poster/` composites three `drawable` HTML layers in one `ElementGL` WebGL 2 canvas (`texElementSubImage2D()`) as a tvOS multi-layer parallax poster card with inter-layer cast drop shadows, a squircle glossy specular sheen, and clickable tilted controls via `updateElementGeometry()`.
