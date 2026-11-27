# Datamosh and RGB block-slice glitch cut (`/glitch-cut/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 (`412x915` at device scale factor `2.625` with touch emulation, and `960x800` at DPR `2`, SwiftShader WebGL), plus a fallback check with `--disable-blink-features=CanvasDrawElement` and emulated `prefers-reduced-motion: reduce`. All live checks wait for a tap (`<meta name="checks" content="tap">`). Chrome 159 on Android, headless Chromium 157 and `npm run check:jank` (Playwright not run here) are **not verified**.

I built a dual-scene NLE transition stage holding two live HTML panels (`#gc-scene-a` Editorial Broadcast Feed and `#gc-scene-b` Telemetry Node Console) inside one `<canvas id="gc-canvas" content="drawable" layoutsubtree>` rendered by one `ElementGL` WebGL 2 context (`/lib/element-gl.js`). `GlitchPipeline` uses two ping-pong `RGBA8` FBOs (`SMEAR_FRAG` -> `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` -> `COMPOSITE_FRAG` -> `gl.bindVertexArray(null)`) to drive `Block datamosh`, `Scan tear`, `Chroma shatter`, pointer drag glitch injection and a reduced-motion geometric wipe while keeping buttons, toggles and `<input>` fields active on the dominant scene.

| Question or check | Result | Notes |
|---|---|---|
| Dual-scene upload, FBO unbind and VAO unbind succeed with `gl.getError() === 0` | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`glErr=0`, `fbo=null`, `vao=null`, `pxA=[210,73,31,255]`, `pxB=[34,211,238,255]` on 412 px DPR 2.625 and 960 px DPR 2). |
| Macroblock tearing and RGB channel split peak at mid-cut vs `0%` rest | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`tMs=390`, `p=0.50`: `moshChanged=43/45`, `maxRGBSplit=199`, `glErr=0`). |
| `Block datamosh`, `Scan tear` and Reduced-motion wipe produce distinct outputs | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed (`moshVsTear=41/45`, `moshVsReducedWipe=29/45`, `glErr=0`). |
| `updateElementGeometry()` routes live DOM hits exclusively to Scene A at `0%` and Scene B at `100%` | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`at0%=true`, `clicksA=1`, `at100%=true`, `clicksB=1`; live stage verified `btnFound=true`, `inpFound=true`, inactive scene `inert=true`). |
| Synthetic `webglcontextlost`/`restored` recovery and 5-arg 2D slice fallback both work | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`rescued=true`, `restored=true`, `glErr=0`, `2dLeft=[34,211,238,255]`, `2dRight=[210,73,31,255]`, `draws.noSize=0`, `draws.wrong=0`). |
| Visible stage still holds a picture after all fixtures retire | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%` drawn; `948x1036`, `0.98 MP`, `7.86 MB` at rest, `8.52 MB` settled after checks, `glActive: 1`, `glPeak: 5`, `openSnapshots: 0`, `unasked: 0`). |
| Plain-HTML fallback when HTML-in-canvas is disabled | measured (Chrome 160 Canary, 2026-11-27) | With `--disable-blink-features=CanvasDrawElement` at 412 px, `#gc-stage` enters `.is-plain`, moves both scenes into `#plain-host`, `scrollWidth === 412`, `0` errors. |
| Reduced motion and drag selection guard | measured (Chrome 160 Canary, 2026-11-27) | Emulated `prefers-reduced-motion: reduce` checked `#gc-reduced`; dragging across the canvas left `window.getSelection().toString() === ""`; idle status stayed unchanged over `700 ms`. |
| Real Android GPU timing, touch drag feel and `check:jank` | not verified | Needs Chrome 159 on Android and Playwright `npm run check:jank -- /glitch-cut/`. |

## Things that bit

- **Screen quad UV polarity vs DOM texture polarity:** `QUAD_VERT` emits bottom-up framebuffer UVs (`vUv.y = 0` at the bottom), while `texElementSubImage2D()` uploads DOM elements top-down (`y = 0` at the top). Converting `topUv = vec2(vUv.x, 1.0 - vUv.y)` when sampling DOM textures and flipping the vertical advection sign (`vec2(blockVel.x, -blockVel.y)`) inside `SMEAR_FRAG` kept ping-pong P-frame trails aligned with screen space.
- **Reduced-motion wipe boundary sign at `0%`:** an initial `smoothstep(edge - px, edge + px, wipeCoord)` threshold mapped `wipeCoord > edge` to Scene B right past `0%`, flipping the edge at `0.01`. Inverting to `1.0 - smoothstep(...)` matched the 2D fallback wipe (`0..splitX` Scene B, `splitX..cw` Scene A) cleanly across `0..100%`.
- **2D fallback slice hit boxes and HiDPI scaling:** calling 5-argument `drawElementImage()` for glitch slices shifts Chromium's remembered hit box for the secondary view unless `syncSceneGeometry()` re-runs immediately afterwards to park the inactive scene `OFFSTAGE` and `inert = true`. Sizing the 2D check fixture with `dpr` and `setTransform(dpr, 0, 0, dpr, 0, 0)` kept `context-guard.js` `wrongDrawSize` at `0`.
- **412 px input width inside Scene A:** the initial 36-character headline slug (`"Transit grid switches to backup ring"`) clipped the last letter inside `#gc-a-input` at `361 px` canvas width. Shortening the default slug to `"Backup transit ring live"` at `12.5 px` monospace fits comfortably on mobile without scrolling inside the input.

## Not verified

- Headless Chromium 157: `npm run check:jank -- /glitch-cut/` and `node tools/draw-size/audit.mjs /glitch-cut/`.
- Chrome 159 on Android (`412 px` wide, DPR `2.625`): real GPU frame rate during `Trigger cut`, touch drag injection across the stage, on-screen keyboard opening inside `#gc-a-input` and `#gc-b-input`, and memory stability.
- `public/glitch-cut/social.jpg` capture via `node tools/social/capture.mjs /glitch-cut/`.

## For the index

- Transitions, text and motion: `/glitch-cut/` composites two live HTML panels (`#gc-scene-a` Editorial Broadcast Feed and `#gc-scene-b` Telemetry Node Console) inside one `ElementGL` WebGL 2 canvas with a ping-pong motion-smear FBO for `Block datamosh`, `Scan tear`, `Chroma shatter`, pointer drag glitch injection and a reduced-motion geometric wipe while swapping active hit boxes via `updateElementGeometry()` and `inert` (measured in Chrome 160 Canary, 2026-11-27; Chrome 159 Android not verified).
