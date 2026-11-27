# Panavision 2.39:1 anamorphic streak & oval bokeh (`/anamorphic-flare/`)

Measured in headless Chrome 160.0.0.0 canary (`C160`) on 2026-11-27 at 412 px mobile (`deviceScaleFactor = 2.625`) and 1040 px desktop (`deviceScaleFactor = 1`). All live checks wait for a tap (`<meta name="checks" content="tap">`) and run on isolated `testStage()` fixtures. Chrome 159 on Android (`A159`) is **not verified** yet.

This experiment places one interactive widescreen cinema HUD (`#cinema-panel`, `drawable`) inside a single `<canvas id="flare-canvas" content="drawable" layoutsubtree>` backed by one `ElementGL` WebGL 2 context (`/lib/element-gl.js`). Bright specular elements inside the HTML panel (glowing `Ignite flare` and `Spotlamp` toggle buttons, callout badges, editable `<input>` slugline text and the draggable `SPOT` puck) are uploaded via `gl.texElementSubImage2D()`, filtered above `uThreshold` in an offscreen bright-pass FBO, convolved horizontally across two 21-tap cyan-cobalt streak passes with point-reflected warm lens ghosting, softened through a 32-tap Vogel-disc oval bokeh pass and composited with center-anchored edge barrel breathe inside a 2.39:1 cinema letterbox frame.

| Experiment or question | Result | Notes |
|---|---|---|
| `ElementGL` + `texElementSubImage2D()` pipeline renders bright DOM highlights with `gl.getError() === 0` | measured (`C160`, 2026-11-27) | Live check 1 passed (`gl.getError()=0`; fixture texture `683x342`, bright centre `rgb(255,255,255)`, dark matte top `rgb(7,10,16)`). Canvas backing store stays at `948x784` px (`0.74 MP`, `5.9 MB` live, `0` lost, `0` unasked readbacks, `0` open snapshots) at 412 px DPR 2.625, with `docScrollWidth === 412`. |
| Horizontal cyan-cobalt streak spill and oval bokeh driven straight from DOM luminance above `uThreshold` | measured (`C160`, 2026-11-27) | Live check 2 passed on a `280x120` fixture: `78 px` left and right of a `24x24` white badge over dark matte DOM measured `rgb(65,84,95)`, vertical oval bokeh halo measured `rgb(15,21,29)` above a `rgb(6,9,15)` dark baseline, and `intensity=0` dropped back to `rgb(6,9,15)`. |
| `2.39:1 Desqueeze`, `1.33x Squeeze (raw)` and `Flat` aspect scaling with `updateElementGeometry()` hit testing | measured (`C160`, 2026-11-27) | Live check 3 passed (`desqueeze=263x110` hit `true` at `(231.0, 90.0)`; `squeeze=165x110` hit `true` at `(204.8, 90.0)` using `geometryUnit()` and `dataset.hitTick`). Real CDP mouse clicks also toggled `#btn-spotlamp` in `2.39:1 Desqueeze`, dragged `#light-puck` to `74.1%, 41.5%`, and toggled `#btn-ignite` while squeezed to `1.33x`. |
| Synthetic `webglcontextlost` fallback to plain HTML and `webglcontextrestored` recovery without `loseContext()` | measured (`C160`, 2026-11-27) | Live check 4 passed (`preventDefault=true`, `inPlain=true`, `restored=true`, `err=0`) with `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` re-applied on restore. |
| Touch drag on `#light-puck` (`touch-action: none`), 2D `drawElementImage()` fallback (`C153`) and mobile GPU frame rate | not verified | Needs a live run on Chrome 159 for Android at 412 px and Chromium 153 without `texElementSubImage2D()`. |

## Things that bit

- Three 8-tap concentric rings in the initial `BOKEH_FRAG` left visible ghost copies of sharp `<input>` glyphs and button borders around the HUD. Replacing those rings with a 32-tap golden-angle Vogel disc (`r = sqrt((k + 0.5) / 32)`) produced smooth tall vertical oval bokeh in `2.39:1 Desqueeze` without discrete ring stepping.
- Dark text inside lit bright cyan buttons (`Ignite flare` and `Spotlamp`) washed out when full-strength horizontal streaks and bokeh added over the button interior. Attenuating the additive flare slightly over the top and bottom HUD chrome bands while keeping full intensity across `.cinema-field` and the outer letterbox wings kept button labels legible while still shooting full-strength streaks across the frame.
- Muted matte HUD readout colours with a blue channel above `0.54` (`#6f87a3`) leaked faintly into the bright-pass filter at the default `0.54` threshold. Keeping matte HUD borders and labels at or below `0.49` peak channel (`#596f86`) isolates flares to the glowing controls, input glyphs and light puck.
- Shortening `page.json` `"blurb"` under 200 characters avoided `tools/social/meta.mjs` `shorten()` splitting at the decimal dot inside `"2.39:1"`.

## Not verified

- `npm run build` menu integration and `npm run check:jank -- /anamorphic-flare/` (requires Playwright and a full site build pass).
- Chrome 159 on Android (`A159`, 412 px wide, DPR 2.625): touch dragging `#light-puck` while vertical swipes over `#flare-canvas` scroll the page (`touch-action: pan-y`), real GPU shader throughput and real WebGL context-loss recovery.
- Chromium 153 (`C153`): 5-argument 2D `drawElementImage()` fallback when WebGL 2 `texElementSubImage2D()` is absent.

## For the index

- Motion and shaders: a single `ElementGL` WebGL 2 canvas can drive Panavision `2.39:1` horizontal cyan-cobalt streak flares, 32-tap Vogel-disc oval bokeh, warm internal lens ghosts and corner barrel breathe directly from live HTML buttons, inputs and a dragged light puck uploaded through `texElementSubImage2D()` (measured in `C160`, `/anamorphic-flare/`).
- Hit testing: anchoring quadratic barrel warp at `r2 = 0.35` keeps interactive buttons and editable inputs aligned with affine `updateElementGeometry()` transforms scaled by `geometryUnit()` across `2.39:1 Desqueeze` and `1.33x Squeeze (raw)` (measured in `C160`, `/anamorphic-flare/`).
