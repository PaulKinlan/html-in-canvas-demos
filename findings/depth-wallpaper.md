# Depth wallpaper with spatial clock occlusion (`/depth-wallpaper/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` viewport, device scale factor `2.625`, touch emulation, SwiftShader WebGL). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing checks (`node tools/writing/check.mjs --strict /depth-wallpaper/` and `--docs --strict`), social tag validation, and 6/6 live checks all passed. Headless Chromium 157, `npm run check:jank` (Playwright isn't installed here), and Chrome 159 on Android are **not verified**.

The question: can one `ElementGL` WebGL 2 canvas composite a live editable HTML lock-screen clock and quick widgets behind a foreground HTML and SVG cutout at distinct parallax depths while keeping clock controls clickable with `updateElementGeometry()`?

## What was built

One `<canvas id="dw-canvas" content="drawable" layoutsubtree>` inside `.dw-viewport` (`max-width: 416 px`, `448 px` up to `66svh` on desktop, `432 px` up to `62svh` below `620 px`, zero `dvh`) containing two `drawable` layers (`ELEMENT_COUNT = 2`):

- **Clock and widgets (`#dw-clock-layer`)**: editable date pill `<input id="dw-date-tag">`, three lock-screen quick pills (`07:30 Alarm`, `Demo 09:41`, `Depth On`), and giant live `<output id="dw-clock-time">` tabular numerals.
- **Foreground cutout (`#dw-subject-layer`)**: inline SVG granite peak and left-shoulder observatory silhouette with rim highlight, plus engraved HTML badge (`PEAK 3,420 M FOREGROUND MASK`), kept `inert` with `pointer-events: none` so upper clock controls stay unobstructed.
- **One `ElementGL` WebGL 2 context (`/lib/element-gl.js`)**: sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` on creation, inside `onRestored`, and in every live-check fixture; gates `stage.upload(layerEl)` on `hasPainted = true` inside `'paint'` after calling `stage.begin()`; renders a procedural twilight sky and distant mountain ridge backdrop at `0.35x`, `#dw-clock-layer` at `0.70x`, and `#dw-subject-layer` at `1.35x`; composites premultiplied alpha via `fg.rgb + col * (1.0 - fg.a)`.
- **Modes, themes and fallbacks**: `Depth occlusion on`, `Flat overlay (clock in front)` and `Mask alpha debug` modes; `Sunset`, `Alpine` and `Nocturne` themes; `Auto drift`, `Reduced motion` (synced with `prefers-reduced-motion: reduce`), `Parallax X` slider (`-26` to `+26 px`), `Center` reset, passive `deviceorientation` listener, 5-argument `drawElementImage()` 2D fallback, and `#plain-host` plain-HTML fallback.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Do both `#dw-clock-layer` and `#dw-subject-layer` upload into `ELEMENT_COUNT` slots with premultiplied alpha and `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed on a `240x160` fixture (`glErr=0`, translucent `rgba(255,255,255,0.20)` pill `rgb(67,78,101)` over `rgb(15,20,36)` sky, foreground `rgb(26,54,93)`). |
| Does `Depth occlusion on` mask clock digits behind `#dw-subject-layer`, while `Flat overlay` paints clock in front? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`topClock rgb(255,255,255)`, `depthOverlap rgb(29,53,87)` vs `flatOverlap rgb(255,255,255)`). |
| Does parallax offset shift the foreground cutout (`1.35x`) faster than clock digits (`0.70x`) without re-uploading? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed using cached textures (`-20` to `+20 px`: clock shifted `28.0 px` from `111.0` to `139.0`, subject shifted `54.0 px` from `99.0` to `153.0`). |
| Does `updateElementGeometry()` scaled by `geometryUnit()` keep the `<input>` and widget `<button>` clickable across parallax offsets? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on fixture (`-18` and `+18 px` both hit `BUTTON` and `INPUT`, `clicks=1`), and live page `elementsFromPoint()` hit `#dw-widget-depth` and `#dw-date-tag` across a `28.0 px` shift (`-20` to `+20 px`). |
| Does `webglcontextlost` move layers to plain HTML, `webglcontextrestored` recover `ElementGL`, and 5-arg 2D fallback occlude cleanly? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`plain=true`, `restored=true`, `glErr=0`; 2D fallback `2dTop=[255,255,255]`, `2dOccluded=[29,53,87]`). |
| Does the stage stay drawn, hold still on load and stay within canvas memory rules at `412x915` @ `2.625` DPR? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%`). Idle run measured `cls=0`, `scrollX=0`, `scrollY=0`, `focusMoves=0`, `scrollW=412 === innerW=412`, `1` WebGL context alive (`9.02 MB`, `1.13 MP` `994x1134` buffer, `2` uploads flat during `Auto drift`, `0` unasked readbacks, `0` open snapshots, `0` lost). |
| Does `prefers-reduced-motion: reduce` pause automatic motion and toggle `.motion-warn` cleanly? | measured (Chrome 160 Canary, 2026-11-27) | `ctl-reduced` checked, `ctl-drift` unchecked, `.motion-warn` `Hide stage` hid `#dw-stage` (`hidden=true`) and `Show stage` restored it (`hidden=false`, `994x1134` canvas intact, `0` errors). |
| Do the 5-argument `drawElementImage()` 2D fallback and plain-HTML fallback run without errors or overflow? | measured (Chrome 160 Canary, 2026-11-27) | Deleting `texElementSubImage2D` ran the 2D route (`5.61 MB`, `0` `draw-size` warnings, Check 4, 5, 6 passed); deleting `drawElementImage` moved both layers into `#plain-host` (`0 MB`, `scrollW=412 === innerW=412`). |

## Things that bit

- **Flipping `dataset.hitTick` triggered redundant `paint` re-uploads during `Auto drift`**: reading `e.changedElements` unconditionally inside `paint` treated the hit-test cache attribute toggle on `#dw-clock-layer` as a visual DOM edit, pushing uploads from `108` to `181` in `1.2 s`. Tracking visual edits through explicit `slot.dirty` flags (and checking `changedElements` only while `#dw-date-tag` has focus) locked uploads at `2` across continuous drift.
- **Synchronous `stage.upload()` outside `paint` lagged one mode click behind**: calling `drawCurrentFrame()` right after updating `#dw-widget-depth.textContent` uploaded the previous paint record and cleared `slot.dirty` before Chromium fired the next `'paint'` event, leaving the pill label one state stale (`Depth On` while in `Flat overlay`). Gating `uploadDirtySlots()` exclusively behind `allowUpload = true` inside the `'paint'` listener keeps DOM text and shader mode in lockstep.
- **Unclamped `Mask alpha debug` clipped the occlusion zone to pure white**: adding `maskTint + overlapGlow` on top of `clock.rgb = 1.0` pushed channels past `1.0`, making covered digit segments look solid white against the blue alpha matte. Switching to `mix()` blending keeps the occluded digit overlap a distinct warm amber (`vec3(0.98, 0.56, 0.22)`).
- **Check 1 pill overlapped the Nocturne moon halo**: placing the `rgba(255,255,255,0.20)` test pill at `(72, 42)` (`uv = 0.30, 0.26`) landed directly on Nocturne's moon glow (`orbPos = 0.32, 0.26`), reading `rgb(187,223,255)` rather than dark sky contrast. Moving the pill to `(176, 37)` over clear dark sky (`rgb(15,20,36)`) measured true premultiplied translucency (`rgb(67,78,101)`).

## Not verified

- Headless Chromium 157 and `npm run check:jank -- /depth-wallpaper/` (Playwright isn't installed in this environment).
- Chrome 159 on Android at `412 px` and `2.625` DPR: real GPU frame rate, touch-drag feel on the lock screen while tapping quick widgets, and live `deviceorientation` gyro parallax.

## For the index

- 3D, spatial and WebXR: `/depth-wallpaper/` composites a live editable HTML lock-screen clock and quick widgets behind a sculptural HTML and SVG foreground cutout on one `ElementGL` WebGL 2 canvas (`texElementSubImage2D()`, premultiplied `fg.rgb + clock.rgb * (1.0 - fg.a)` occlusion, 3-plane parallax, and `updateElementGeometry()`).
