# Split-diopter two-plane focus lens (`/split-diopter/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 at `412x780` (device scale factor `2.625`, touch emulation) and `1024x900` (device scale factor `1`), plus a fallback check with `--disable-blink-features=CanvasDrawElement`. Syntax, graphics rules, and writing checks ran via `node --check`, `node tools/gfx/check.mjs`, and `node tools/writing/check.mjs --strict /split-diopter/`. Chrome 159 on Android, `npm run check:jank`, and `node tools/draw-size/audit.mjs` are **not verified** yet.

The question: can one `ElementGL` WebGL 2 canvas render a close-up foreground HTML card and a distant background HTML panel sharply side-by-side across an adjustable optical seam while blurring each defocused half and keeping controls in both planes clickable?

## What was built

One `<canvas id="diopter-canvas" content="drawable" layoutsubtree>` inside `.diopter-viewport` (`440 px` tall desktop, `420 px` tall at `<= 620 px`, zero `dvh`, `1.02 MP` / `8.2 MB` at `412 px` and `2.625` DPR) holding two live `drawable` HTML planes:

- **Foreground close-up card (`#fg-card`)**: near focal plane (`0.42 m`, `+2 diopter`) with a close-up badge, an editable `<input type="text">` cue note (`user-select: text`), a `Trigger cue` `<button>` that echoes fired cues to `#bg-card`, and shallow depth metadata.
- **Background wide shot panel (`#bg-card`)**: distant focal plane (`8.5 m`, `28 mm`) with a practical lamp rail peeking behind `#fg-card`, live cue echo, three toggleable stage rig pills, and a `Mark slate` action `<button>`.

A single `ElementGL` WebGL 2 context (`/lib/element-gl.js`) with `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` uploads both planes via `texElementSubImage2D()`, generates mipmaps (`gl.generateMipmap` with `LINEAR_MIPMAP_LINEAR`), and runs `DIOPTER_FRAG` across `uSplitPos`, `uSplitAngle`, `uSoftness`, and `uLensMode` (`Split-diopter` vs `Single lens`). A 5-argument `drawElementImage()` 2D fallback clips and blurs half-planes with `ctx.filter`, and plain HTML extraction (`#plain-host`) recovers from missing API support or `webglcontextlost`.

## Results

| Question | Result | Detail |
|---|---|---|
| Do `#fg-card` and `#bg-card` upload via `texElementSubImage2D()` on one `ElementGL` canvas with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Live check 1 passed on `240x160` (`gl.getError()=0`, `fg=268x347 rgb(210,73,31)`, `bg=268x347 rgb(14,165,233)`). Live page at `412x780 @ 2.625` DPR ran at `927x1099` (`1.02 MP`, `8.2 MB`, `0` lost, `0` unasked readbacks, `0` open snapshots). |
| Does single-lens mode blur the right plane while split-diopter mode holds both planes sharp? | measured (Chrome 160 Canary, 2026-11-27) | Live check 2 passed with 4 px vertical stripes: single-lens `L=255, R=47`; split-diopter `L=255, R=255`; seam swept across `#fg-card` (`uSplitPos=0.25`) `L=255, R=58`. |
| Does `updateElementGeometry()` keep controls in both focal planes clickable via `elementsFromPoint()`? | measured (Chrome 160 Canary, 2026-11-27) | Live check 3 passed (`fgInput=true`, `fgBtn=true (1)`, `bgBtn=true (1)`). On the live page at `412x780 @ 2.625` DPR and `1024x900 @ 1` DPR, `elementsFromPoint()` and real CDP pointer clicks hit `#fg-cue-input`, `#fg-trigger-btn`, and `#bg-action-btn` cleanly. |
| Does `webglcontextlost` move both planes to plain HTML and `webglcontextrestored` recover `ElementGL`? | measured (Chrome 160 Canary, 2026-11-27) | Live check 4 passed on synthetic cancelable `webglcontextlost` and `webglcontextrestored` (`preventDefault=true`, `plainWhileLost=true`, `restored=true`, `err=0`). |
| Does the stage still hold a painted picture after live checks, and does the plain-HTML fallback work? | measured (Chrome 160 Canary, 2026-11-27) | Live check 5 (`stillDrawn`) passed (`100.0%`). With `--disable-blink-features=CanvasDrawElement`, both cards moved to `#plain-host` (`is-plain`, `0` horizontal overflow). |
| Real Android phone touch feel, `npm run check:jank`, and `draw-size/audit.mjs` | not verified | Needs Chrome 159 on Android at 412 px wide and a local Playwright run of `npm run check:jank -- /split-diopter/`. |

## Things that bit

- **Stale `geometryUnit()` cache across initial backing-store resize**: calling `syncPlaneGeometry()` in `initBackend()` before the first `paint` (and `stage.begin()`) cached `lastGeoKey` against the default `300x150` canvas buffer instead of the `927x1099` DPR-scaled buffer, causing `elementsFromPoint()` on the live page to miss until `syncPlaneGeometry()` included `${canvas.width}x${canvas.height}` in `geoKey` and deferred calibration until `canvas.width > 0`.
- **Discrete bokeh echoes on thin HTML text**: a 24-tap Vogel disc over LOD 0 textures left faint dotted copies of blurred text in single-lens mode. Generating texture mipmaps (`gl.generateMipmap` + `LINEAR_MIPMAP_LINEAR`) in `uploadWithMip()` and sampling `textureLod()` with static interleaved gradient noise rotation produced smooth optical bokeh while keeping sharp areas at LOD 0.
- **Flex compression inside `#bg-card` on 412 px viewports**: with three pill buttons wrapping on a narrow phone width, `.bg-echo` shrank vertically until `flex-shrink: 0` was added across `#bg-card` rows.

## Not verified

- Chrome 159 on Android (412 px wide, `2.625` DPR): touch drag smoothness across `#diopter-canvas` and the top/bottom `#seam-handle-*` tabs, on-screen keyboard opening inside `#fg-cue-input`, and real GPU frame rates.
- `npm run check:jank -- /split-diopter/` and `node tools/draw-size/audit.mjs /split-diopter/` (Playwright was not installed in this environment).
- Chromium 153 2D 5-argument `drawElementImage()` fallback visual quality.
- `npm run build` and `node tools/social/capture.mjs /split-diopter/`.

## For the index

- Transitions, text and motion: `/split-diopter/` splits one `ElementGL` WebGL 2 canvas along a draggable diagonal boundary so a near HTML cue card (`0.42 m`) and a distant HTML scene panel (`8.5 m`) stay sharp simultaneously while mipmapped Vogel bokeh blurs each defocused half (measured in Chrome 160 Canary, 2026-11-27; Android not verified).
