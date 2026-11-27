# Dolly-zoom camera stretch (`/dolly-zoom/`)

Measured on 2026-11-27 in `HeadlessChrome/160.0.0.0` (Chrome Canary 160.0.8188.0 with `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement` at 412 px wide, DPR 2.625 and 1080 px desktop, DPR 2) plus static checks (`node --check`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs --strict /dolly-zoom/`). Headless Chromium 157 (`npm run check:jank`) and Chrome 159 on Android (A159) are **not verified** yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context uploading both `bg-layer` and `hero-card` with `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` and `stage.begin()` before `stage.upload()` | measured (Chrome 160, 2026-11-27) | `1` active WebGL context at load (`peak: 2` during checks), `1.096 MP` canvas (`994×1103` at 412 px @ 2.625 DPR), `8.77 MB` initial (`12.91 MB` peak), 8x anisotropic mipmaps, 0 console errors. Live check 1 passed: `bg 473×316, card 315×211, gl.getError()=0, centre rgba(255,106,61,255)`. |
| Keeping `fov_width * d == const` (`d = d0 * (f / f0)`) holds foreground HTML card width 1:1 while background HTML layer and 3D corridor stretch across `18 mm` to `135 mm` | measured (Chrome 160, 2026-11-27) | Live check 2 passed: `locked scaleDelta=0.00 px, bgDelta=821.6 px (3.95x), zoomOnly=7.50x`. On the visible phone stage, `#hero-card` held `252 px` width at `18 mm`, `50 mm` and `135 mm` while `#bg-layer` expanded from `278.07 px` to `1099.64 px`; `Zoom only` scaled `#hero-card` to `680.40 px` at `135 mm`. |
| `updateElementGeometry()` calibrated with `geometryUnit()` + `dataset.hitTick` keeps card controls clickable and editable at every focal length | measured (Chrome 160, 2026-11-27) | Live check 3 passed (`18 mm button (160,147) & 135 mm button (160,147) both hit`). Real CDP clicks hit `Jaws`, `Cue take #1` (`Cue take #2`), and `#subject-input` (`JAWS AMITY`). |
| Reduced motion snaps presets immediately, `Auto push-pull` sweeps smoothly, and context loss / disabled API falls back without `loseContext()` | measured (Chrome 160, 2026-11-27) | Live check 4 passed on `stepFocalAnim(..., true)` (`18->135 mm`) and synthetic `webglcontextlost`/`webglcontextrestored`. Desktop reduced-motion click on `Vertigo` snapped synchronously to `28 mm`. Disabling `CanvasDrawElement` hid `#stage-viewport` and mounted both cards cleanly in `#plain-host` (`overflow: 0`). |
| Accessibility self-audit (`public/lib/a11y-audit.js`) at 1080 px desktop | measured (Chrome 160, 2026-11-27) | 8 pass (`calm`, `blank`, `dom`, `hit`, `ghost`, `names`, `sharp`, `motion`), 0 fail, 2 warn (`focus` pixel hash on idle WebGL, `zoom` 150% CSS zoom backing-store scaling in `ElementGL`), 1 info (`find`). |

## Things that bit

- Sampling mipmapped `texElementSubImage2D()` textures across a wide `2.4`-texel `3×3` grid in the telephoto DoF shader produced discrete cross-hatch echoes on 1 px badge text at `135 mm`. Adding mipmap LOD bias (`texture(uTex, uv, lodBias)` up to `1.35`) with a tighter `1.65`-texel disk kernel turned the background blur into smooth bokeh without grid ghosting.
- Omitting `preserveDrawingBuffer: true` on an idle WebGL 2 canvas caused `a11y-audit.js`'s `canvasState()` check to read empty transparent pixels (`blank: fail`) between frames. Adding `preserveDrawingBuffer: true` to `ElementGL` attributes made `blank` pass cleanly without adding contexts or timers.
- Calling `requestRender()` after snapping `state.focalMm` under reduced motion waited until the next `requestAnimationFrame` before updating `#out-focal` and `#card-scale-out`. Calling `updateCardReadouts(frame)` and `syncToolbarUI(frame)` synchronously inside `setShot()` when reduced motion snaps avoids a one-frame stale readout.
- Placing `bg-layer` at `BG_WORLD_Y = 0.45 m` clipped its top streetlight gantry off the top edge of the `440 px` desktop stage at `50 mm`, and `MARKER L -4.4 m` wrapped inside the narrow badge box. Lowering `BG_WORLD_Y` to `0.16 m`, trimming `bg-layer` height to `292 px` and adding `white-space: nowrap` kept the gantry and badges framed cleanly.

## Not verified

- `npm run check:jank -- /dolly-zoom/` and `node tools/draw-size/audit.mjs /dolly-zoom/` (Playwright is not installed in this environment): verifying zero layout shift across viewport height changes and zero timed readbacks under 4x CPU throttle.
- Chrome 159 on Android (412 px wide, touch, DPR 2.625): dragging sideways across the canvas without scrolling the page, tapping inside `#hero-card` (`Vertigo`/`Jaws`/`Corridor`, `Cue take`, `<input>` with the on-screen keyboard), real GPU frame rate during `Auto push-pull` and telephoto DoF, and testing the 2D `drawElementImage()` fallback when WebGL 2 `texElementSubImage2D()` is absent on its own.
- Real keyboard Tab traversal and screen reader output on C157 and A159.

## For the index

- 3D, spatial and WebXR: `/dolly-zoom/` runs a 18 mm to 135 mm dolly-zoom rig on one `ElementGL` WebGL 2 context (`UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`), locking a live foreground HTML slate card at 1:1 width (`0.00 px` drift) via `d = d0 * (f / f0)` and `updateElementGeometry()` while a transparent background HTML scene layer (`3.95x` stretch with focal-length DoF bokeh) and procedural 3D corridor telescope behind it across `Vertigo`, `Jaws` and `Corridor` presets (measured in Chrome 160 headless; Android phone not verified yet).
