# Staggered hero dashboard entry choreography (`/entry-choreo/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 at `412x915` (`2.625` DPR, touch emulation) and `1024x900` (`1` DPR), plus a plain-HTML fallback check with `--disable-blink-features=CanvasDrawElement`. Syntax, graphics rules and writing checks ran via `node --check`, `node tools/gfx/check.mjs` and `node tools/writing/check.mjs`. Chrome 159 on Android, `npm run check:jank -- /entry-choreo/` and `node tools/draw-size/audit.mjs /entry-choreo/` are **not verified** yet.

The question: can one `ElementGL` WebGL 2 canvas choreograph staggered entry and exit transitions across four live `drawable` HTML dashboard modules with blur-scale, 3D origami unfold, elastic wave and directional smear shaders while locking hit testing 1:1 on settle?

## What was built

One `<canvas id="ec-canvas" content="drawable" layoutsubtree>` inside `.ec-viewport` (`472 px` tall above `600 px`, `490 px` tall at `<= 600 px`, zero `dvh`) compositing four live `drawable` HTML dashboard sections:

- **Header (`#ec-header`)**: badge, editable dashboard title `<input>` (`user-select: text` while stage keeps `user-select: none` and cancels `selectstart` outside inputs), and three clickable region filter pills (`All regions`, `Edge POPs`, `GPU workers`).
- **Key metrics (`#ec-kpi`)**: live Throughput, P95 latency and Error rate readouts plus a `+1k req/s` increment button.
- **Region load (`#ec-chart`)**: six clickable bar buttons (`T-50m` through `Now`) updating the focus readout and responding to region filters and increment controls.
- **Quick actions (`#ec-actions`)**: live activity log plus `+1 Spike` and `Reset metrics` buttons.

A single `ElementGL` WebGL 2 context (`/lib/element-gl.js`) sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` on creation and inside `onRestored`, waits for `hasPainted` and calls `stage.begin()` before `stage.upload()`, generates texture mipmaps (`gl.generateMipmap` + `LINEAR_MIPMAP_LINEAR`) and renders each module on a `36 px` padded quad across four modes (`Blur-scale rise`, `3D origami unfold`, `Elastic wave`, `Directional smear`).

## Results

| Question | Result | Detail |
|---|---|---|
| Do all four dashboard modules upload cleanly via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`gl.getError()=0`, four `279x205` textures, distinct RGBA `readPixels()` match). Live page at `412x915 @ 2.625` ran at `927x1282` (`1.19 MP`, `9.51 MB`, `1` active WebGL context, `0` lost, `0` open snapshots, `0` timed readbacks, `scrollWidth === 412`). |
| Does `Progress 35%` settle `#ec-header` while `#ec-actions` stays unrevealed, and does `Elastic wave` overshoot and settle? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`t35=308 ms`, `springMid=1.29`, `headerA=255`, `actionsA=0`; live page at `35%` set `#ec-header.inert=false` and `#ec-actions.inert=true`). |
| Do all four choreography modes render distinct mid-entry signatures without clipping? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed (`minModeDiff=38.5`, `blurBleed=true`, `origamiShadow=true`, `smearFringe=true`). |
| Does `updateElementGeometry()` hit controls in all four settled cards at `Progress 100%`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`buttonHits=[true, true, true, true]`, `inputHit=true`, `clicks=[1, 1, 1, 1]`). Live page hit testing passed across all controls on both `412x915 @ 2.625` and `1024x900 @ 1`. |
| Do synthetic `webglcontextlost`/`webglcontextrestored` and 5-argument 2D `drawElementImage()` recover? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`preventDefault=true`, `plainWhileLost=true`, `restored=true`, `err=0`, `2dFill=53.3%`). With `--disable-blink-features=CanvasDrawElement`, `#plain-host` held all 4 modules cleanly at `scrollWidth=412`. |
| Does the visible stage remain drawn after checks finish (`stillDrawn`)? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 passed (`6/6` total, `100.0%` drawn, `0` console/page errors). |
| Real Android phone touch feel, `npm run check:jank` and `draw-size/audit.mjs` | not verified | Needs Chrome 159 on Android at `412 px` wide and a local Playwright run. |

## Things that bit

- **Ghost ringing in Blur-scale and Directional smear on thin HTML text**: sampling LOD 0 with 12 Vogel taps or 11 smear steps produced faint duplicate copies of thin labels (`REGION LOAD`, `T-50m`) mid-entry. Generating mipmaps (`gl.generateMipmap`) on upload and switching to 24 jittered `textureLod()` taps for Blur-scale and 20 jittered taps for Directional smear smoothed both effects while keeping settled text at LOD 0.
- **Caching `geometryUnit()` across uneven card widths**: `#ec-kpi` and `#ec-chart` are narrower than `#ec-header` on desktop, so calling `geometryUnit()` per card width would bust its WeakMap cache every frame. Passing `#ec-header` as the single reference element keyed on `${canvas.width}x${canvas.height}` calibrates all four slots once per resize.
- **2D fallback readback canvas accounting**: in Check 5, leaving the temporary plain `2D` readback copy canvas unsized left `661 KB` reported in `window.__gfx.memory().removed` until `copy.width = 0; copy.height = 0; window.__gfx?.retire?.(copy)` cleared it cleanly to `0`.

## Not verified

- Chrome 159 on Android (`412 px` wide, `2.625` DPR): real GPU frame rate during staggered entry/exit runs, touch scrubbing on `Progress` and `Stagger` sliders, and on-screen keyboard opening inside `#ec-title-input`.
- `npm run check:jank -- /entry-choreo/` and `node tools/draw-size/audit.mjs /entry-choreo/` (Playwright was absent in this environment).
- Chromium 153 2D 5-argument `drawElementImage()` visual output on the live page.
- `npm run build` and `node tools/social/capture.mjs /entry-choreo/`.

## For the index

- Transitions, text and motion: `/entry-choreo/` composites four live `drawable` dashboard modules on one `ElementGL` WebGL 2 canvas with staggered `tMs` entry/exit choreography across blur-scale, 3D origami unfold, elastic wave and directional smear shaders (measured in Chrome 160 Canary, 2026-11-27; Android not verified).
