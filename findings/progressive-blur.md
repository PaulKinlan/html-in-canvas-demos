# Progressive backdrop blur behind floating bars (`/progressive-blur/`)

Measured in headless Google Chrome `160.0.0.0` Canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation enabled, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /progressive-blur/`), and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed here), and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas run a multi-pass separable Gaussian blur that ramps smoothly behind a floating header and bottom capsule over a live scrolling feed, while keeping buttons and inputs in both subtrees clickable with `updateElementGeometry()`?

## What was built

One `<canvas id="pb-canvas" content="drawable" layoutsubtree>` inside `.phone-viewport` (`min(100%, 384 px)` wide, `min(510 px, 64svh)` tall, zero `dvh`) compositing two live `drawable` subtrees on a single `ElementGL` WebGL 2 context (`/lib/element-gl.js`):

- **Subtree 1 (`#pb-feed`)**: scrollable rich HTML feed (`overflow-y: auto`, `overscroll-behavior-y: contain`, `touch-action: pan-y`, `user-select: none` on the scroller and `user-select: text` on `#pb-search`) with live search filtering, topic chips, high-contrast colour swatches, vertical calibration stripes and six cards with `+1 Like` and `Pin` buttons.
- **Subtree 2 (`#pb-chrome`)**: transparent-backed floating top header (`.pb-topbar`) and bottom action capsule (`.pb-dock`) with live search/filter readout, total likes pill and action buttons (`Top`, `Liked`, `Optics`, `Colour`, `Mid`), using `pointer-events: none` on `#pb-chrome` and `pointer-events: auto` on both floating bars.
- **Six-pass separable FBO pyramid**: horizontal and vertical 9-tap Gaussian passes across three levels (half-res prefilter, `0.42x` CSS px, `0.18x` CSS px), unbinding offscreen FBOs (`gl.bindFramebuffer(gl.FRAMEBUFFER, null)`) and VAOs (`gl.bindVertexArray(null)`) before calling `stage.begin()` for screen output.
- **Modes and controls**: `Progressive`, `Stepped CSS bands` (4 quantized mask steps with visible step edges), `Uniform` (constant blur clipped to rounded chrome capsules), `Blur intensity` (`0..32 px`), `Edge ramp height` (`40..140 px`), and `Reduced motion` synced with `(prefers-reduced-motion: reduce)`.
- **Fallbacks**: 5-argument `drawElementImage()` 2D strip blur via an offscreen plain copy buffer, and plain-HTML extraction into `#plain-host` with CSS `backdrop-filter: blur(18px)` on context loss or unsupported browsers.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#pb-feed` and `#pb-chrome` (`UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`), run the 6-pass FBO pyramid, and draw with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `220x180` (`578x473` at `2.625` DPR) fixture (`glErr=0`, `midRms=83.1`, `midRgb=[122,110,123]`). |
| Does `Progressive` mode smooth spatial contrast monotonically toward the top edge while keeping the middle sharp compared with `Uniform`? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed: Progressive RMS luminance contrast dropped `64.2` (`y=145`) to `52.8` (`y=68`), `11.6` (`y=38`) and `4.5` (`y=10`); Uniform stayed flat inside the bar (`y=16: 3.9`, `y=36: 3.9`) and jumped to `84.6` outside (`y=68`). |
| Does scrolling `#pb-feed` change the blurred backdrop pixels sampled behind the top bar? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: behind the top bar at `y = 26 px`, `scrollTop = 0` averaged `[177,115,96]` (vermilion) and `scrollTop = 210` averaged `[94,124,158]` (cobalt). |
| Does `updateElementGeometry()` scaled by `geometryUnit()` land `elementsFromPoint()` on buttons in both `#pb-chrome` and scrolled `#pb-feed`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`unit=1.000`, `topBtn=true`, `dockBtn=true`, `feedBtn=true`). On the live stage, real pointer clicks incremented `+1 Like (6)` to `+1 Like (7)` (`26 likes`), clicked `#btn-dock-colour` (`Colour · 3`) and typed `"pyramid"` in `#pb-search` (`"pyramid" · 1`). |
| Does `webglcontextlost` rescue to plain HTML, `webglcontextrestored` recover WebGL, and 5-arg `drawElementImage()` render in 2D? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainRescue=true`, `restored=true`, `premul=true`, `glErr=0`, `2dRgb=[210,73,31,255]`, `wrongDrawSize=0`). Check 6 (`stillDrawn()`) passed (`100.0%`). |
| Does the page fit `412x915` at `2.625` DPR within memory rules and sync `prefers-reduced-motion`? | measured (Chrome 160 Canary, 2026-11-27) | `scrollWidth === innerWidth === 412`, `0` console/page errors, `927x1335` (`1.24 MP`, `9.9 MB`), `1` active WebGL context (`6` peak during checks, `1` alive and `0.88 MB` removed after guard tick), `0` unasked readbacks, `0` open snapshots. `prefers-reduced-motion: reduce` checked `#ctl-reduced` and mounted `.motion-warn` when page metadata was injected; turning it off cleared both. |
| Do `?route=2d` and `?route=plain` fallbacks render without errors or overflow? | measured (Chrome 160 Canary, 2026-11-27) | `?route=2d` ran at `1.24 MP` with `0` `draw-size` errors; `?route=plain` moved both subtrees to `#plain-host` (`0.00 MP`, `scrollWidth=412`). |

## Things that bit

- **Collapsing `inset: 0` on `#pb-chrome` inside `<canvas layoutsubtree>`**: giving `#pb-chrome` `position: absolute; inset: 0;` without `width: 100%; height: 100%;` caused Chromium's `<canvas>` layout box to shrink `#pb-chrome` to a thin top-left strip and place `.pb-dock` above the canvas. Setting explicit `width: 100%; height: 100%;` fixed both compositing and `elementsFromPoint()` on the bottom capsule.
- **Total variation vs RMS contrast on step-edge stripes**: measuring mean `|L[x+1] - L[x]|` stays nearly constant under small blur radii because a monotonic edge spread preserves L1 sum until adjacent stripes overlap. Switching Check 2 to RMS luminance deviation around the row mean measured monotonic attenuation (`64.2 -> 52.8 -> 11.6 -> 4.5`) across the ramp.
- **CSS-pixel-normalized pyramid stride at `2.625` DPR**: sizing all blur FBOs as fractions of the device-pixel backing store made a 9-tap blur `2.625x` narrower on a phone screen than on a `1x` display. Keeping level 1 as an exact `2:1` backing prefilter and sizing levels 2 and 3 to `0.42x` and `0.18x` CSS pixels gave matching blur width across both pixel ratios.

## Not verified

- Chrome 159 on Android at `412 px` wide and `2.625` DPR: real GPU frame timing during touch momentum, soft keyboard resizing when tapping `#pb-search`, and touch feel on `.pb-bar-btn` inside `#pb-chrome`.
- `npm run check:jank -- /progressive-blur/` (Playwright isn't installed in this environment).

## For the index

- Transitions, text and motion: `/progressive-blur/` composites a live scrollable HTML feed (`#pb-feed`) and floating top/bottom bars (`#pb-chrome`) inside one `ElementGL` WebGL 2 canvas using a 6-pass separable Gaussian FBO pyramid (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`), comparing optical progressive blur against stepped CSS bands and uniform blur.
