# Spatial visionOS glass window (`/vision-glass/`)

Measured in headless Google Chrome `160.0.0.0` canary on 2026-11-27 (`412x915` mobile emulation at `2.625` DPR with touch, and `1100x820` desktop at `1` DPR, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing check (`node tools/writing/check.mjs --strict /vision-glass/` and `--docs --strict`), social metadata validation (`node tools/social/validate.mjs /vision-glass/`), page metadata validation (`node tools/site/build.mjs --check`), and 6/6 live checks all passed. Real Android Chrome 159 hardware and `npm run check:jank` (Playwright is not installed in this environment) are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas composite a live 3D tilted HTML window with mipmapped Gaussian frost, Snell rim refraction, chromatic bevel dispersion, directional edge highlights and pointer-proximity button glow while keeping tilted controls clickable with `updateElementGeometry()`?

## What was built

- **Live `drawable` workspace panel (`#vg-panel` inside `<canvas id="vg-canvas" content="drawable" layoutsubtree>`)**: translucent header pills, track metadata and 1 Hz timer readout (`tabular-nums`), playback pills (`Prev`, `Play`/`Pause`, `Next`), spatial option chips (`Focus`, `Spatial`, `Dim glass`), a live range scrubber (`#vg-scrub`) and an editable spatial note input (`#vg-note` with `user-select: text`).
- **One `ElementGL` WebGL 2 context (`/lib/element-gl.js`) + `GlassPipeline` FBO pre-pass**: sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` on context creation, inside `onRestored` and inside every fixture; gates `stage.upload(panelEl)` on `hasPainted = true` inside `paint` after `stage.begin()`; renders `Studio Dawn` or `Passthrough Loft` into a mipmapped `roomFbo` plus four separable 13-tap Gaussian blur passes across `blurFboA`/`blurFboB`, and explicitly calls `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` and `gl.bindVertexArray(null)` before screen compositing.
- **Spatial glass fragment shader (`COMPOSITE_FRAG`)**: casts a 3D perspective-projected drop shadow onto the room via `uInvH`, masks the tilted window with `sdRoundBox()` (`26 px` radius), bends screen UVs per R/G/B channel via Snell's law around the curved bevel rim, blends mipmapped room and Gaussian blur textures across the frosted core, sweeps a 1 to 2 px directional specular bevel + chromatic edge tint to `(lightX, lightY)`, tilts Fresnel sheen across 3D angles, illuminates `[data-gaze-slot]` button bounds behind the DOM at `uGazeLocal`, and composites premultiplied DOM UI on top.
- **Controls and fallbacks**: `Tilt mode` (`Pointer tilt`, `Locked 12°`, `Flat 0°`), `Environment` (`Studio Dawn`, `Passthrough Loft`), `Frost strength` (`0%` to `100%`), `Edge refraction` (`0%` to `100%`), and `Reduced motion` synced with `prefers-reduced-motion: reduce`; 5-argument `drawElementImage()` 2D glass fallback when `texElementSubImage2D()` is absent, plus plain-HTML extraction into `#plain-host` when HTML-in-canvas is unavailable or `webglcontextlost` fires.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload `#vg-panel` with `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`, run `GlassPipeline` room/blur FBOs and draw at `glErr === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`tex=526x342`, `glErr=0`, swatch `[242,107,65,255]`, frosted glass `[28,31,33,255]`, lit room `[178,219,248,255]`). |
| Does moving `uLight` from top-left to bottom-right shift the bright 1 to 2 px specular bevel around the window perimeter? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed: TL light gave `TL=255.0` vs `BR=91.3`; BR light swapped to `TL=145.5` vs `BR=255.0`. |
| Does 3D perspective tilt shift corner luminance and does pointer gaze brighten hovered buttons? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `0°` flat corner `21.7` vs `14°/22°` tilted corner `70.2` (`Δ=48.5`); gaze off-panel `51.0` vs gaze on button `182.0` (`+131.0`). |
| Does projective `updateElementGeometry()` scaled by `geometryUnit()` keep tilted buttons clickable? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on an off-centre button (`0°` `(170.0, 71.0)` and `16°/-24°` `(167.5, 68.6)`, `3.4 px` shift, `clicks=1`). On the live stage under `Locked 12°` (`8.0°/-11.8°`), `elementsFromPoint()` hit `#vg-next` (`102.2x37.6 px`). |
| Does `webglcontextlost` rescue to plain HTML, `webglcontextrestored` rebuild FBOs, and 5-arg `drawElementImage()` draw without WebGL 2? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plainWhileLost=true`, `restored=true`, `texAfter=525x342`, `glErr=0`, `2dFallback=[255,112,67,255]`). Separate browser runs with `texElementSubImage2D` or `drawElementImage` deleted showed `0` errors and `wrongDraws=0`. |
| Does the stage stay drawn within canvas memory limits and 412 px width, and does `.motion-warn` toggle and restore cleanly? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 passed (`100.0%`). Mobile `412x915` @ `2.625` DPR measured `scrollWidth=412 === innerWidth=412`, `994x987` (`0.98 MP`, `7.85 MB`), `1` WebGL context (`0` lost, `0` unasked readbacks, `0` open snapshots). Emulating `prefers-reduced-motion: reduce` showed `.motion-warn` and toggled `vg-stage.hidden` cleanly. |

## Things that bit

- **Keeping opposite bevel catchlights from washing out the directional specular swap**: an initial `0.14` base bevel + `0.34` opposite bounce + flat-rim Fresnel pushed the unlit opposite corner up to `238.9` over warm sconce light in `Passthrough Loft`, masking the directional light shift. Tightening base rim to `0.05`, opposite bounce to `0.14`, and scaling Fresnel predominantly with 3D panel tilt restored a clean `> 100` luminance swing between lit and unlit corners while boosting 3D tilt contrast (`Δ=48.5`).
- **HUD throttle hiding discrete button state updates**: `updateHud()` throttled updates to 100 ms intervals, so clicking `Flat 0°` right after toggling `Reduced motion` left the old tilt angle in `#stage-hud` when the animation loop stopped on the same tick. Passing `forceGeo` into `updateHud(forceGeo)` keeps `#stage-hud` synced on every control change.
- **Unbinding FBOs and VAOs before `ElementGL` compositing**: calling `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` and `gl.bindVertexArray(null)` at the end of `GlassPipeline.renderBackdropAndBlur()`, then re-running `stage.begin()` before `stage.quad()`, prevents leftover FBO or VAO bindings from corrupting the screen composite pass.

## Not verified

- Real Android Chrome 159 at 412 px and 2.625 DPR: real GPU frame rates for the 4-pass Gaussian blur + 3D composite shader, touch dragging across the spatial window, soft keyboard behaviour inside tilted `#vg-note`, and hardware WebGL context loss/restore.
- `npm run check:jank -- /vision-glass/` (Playwright is not installed in this environment).

## For the index

- 3D, spatial and WebXR: `/vision-glass/` composites a 3D perspective-tilted spatial glass workspace panel over a procedural room in one `ElementGL` WebGL 2 canvas with mipmapped Gaussian frost, Snell rim refraction, chromatic edge dispersion, directional specular bevels, pointer-proximity button glow and projective `updateElementGeometry()`.
