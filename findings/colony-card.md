# Cellular colony growth over live HTML (`/colony-card/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL). Rebuilds sucodee's Colony Card (`/elsewhere/#colony-card`). Chrome 159 on Android and `npm run check:jank` (Playwright is not installed here) are **not verified** yet.

The question: can a ping-pong framebuffer simulation run on the GPU without pixel readback to grow organic cellular colonies outward from every tap on a live HTML card, recolouring and inverting typography, checkboxes and buttons while every control underneath stays clickable and editable?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context + two `192x256` `RGBA8` ping-pong framebuffers | measured (Chrome 160 Canary, 2026-11-27) | Smoke check passed (`924x1234`, `1.14 MP`, `9.1 MB`, `0` errors, `0` lost, `0` open snapshots). Live checks passed (`5/5`, `gl.getError() === 0`). |
| Top-left UV parity across ping-pong passes and `texElementSubImage2D()` DOM texture | measured (Chrome 160 Canary, 2026-11-27) | Live check seeded `(0.22, 0.22)` across 25 ping-pong steps (an odd buffer count) and confirmed colony pixels stay in the top-left corner without vertical flipping. |
| Ink-guided reaction-diffusion growth and Voronoi palette inversion | measured (Chrome 160 Canary, 2026-11-27) | Live check verified colonised DOM ink inverts brighter than colonised paper while uncolonised ink stays dark against pale paper. |
| `updateElementGeometry()` + `geometryUnit()` hit testing across checkboxes, `<input>` and `<button>` | measured (Chrome 160 Canary, 2026-11-27) | Live check passed (`document.elementsFromPoint()` hit all three controls and checkbox click + input edits worked). |
| 5-argument `drawElementImage()` 2D fallback & real Android touch feel | not verified | Needs testing on Chrome 159 for Android at 412 px and on a browser without WebGL 2. |

## Things that bit

- Leaving `dst.fbo` bound at the end of `runSimPass()` caused downstream composite draws (`ElementGL.begin()` + `stage.quad()`) in the fixture path to clear and sample the same attached FBO texture (`GL_INVALID_OPERATION` `1282`, black canvas). Unbinding `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` and `gl.bindVertexArray(null)` at the end of every `runSimPass()`, and calling `stage.begin()` before `stage.upload()` on frame 1, prevents both the feedback loop and `300x150` initial texture uploads.
- Standard `RGBA8` (`UNSIGNED_BYTE`) ping-pong FBOs work reliably on SwiftShader and avoid float render-target extension issues, as long as small growth increments nudge `nextB` past 8-bit rounding thresholds.

## Not verified

- Chrome 159 on an Android phone at 412 px wide (`2.625` DPR): touch tap accuracy while typing into `#specimen-word`, strain switching (`Moss`, `Coral`, `Cobalt`, `Neon`), and continuous growth frame rate.
- `npm run check:jank -- /colony-card/` (Playwright unavailable here) and 2D fallback visual fidelity.

## For the index

- Shaders and generative UI: `/colony-card/` rebuilds sucodee's Colony Card (`5/5` checks in Chrome 160 Canary, `1.14 MP`, `9.1 MB`), swapping two `192x256` `RGBA8` ping-pong framebuffers in one `ElementGL` context with top-down UV parity to grow ink-guided Voronoi cellular colonies over live checkboxes, text fields and buttons.
