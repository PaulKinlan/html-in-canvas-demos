# 35mm film light-leak and prism burn wipe (`/prism-burn/`)

Measured in headless Chrome 160.0.8188.0 Canary (`C160`) on 2026-11-27 at `412x915` (`deviceScaleFactor = 2.625`) and `1040x800` (`deviceScaleFactor = 1`). All 6 live checks wait for a tap (`<meta name="checks" content="tap">`) and run on isolated `testStage()` fixtures. Real Android Chrome 159 (`A159`) and `npm run check:jank` are **not verified** yet.

This page places two contrasting live HTML interfaces inside one `<canvas id="pr-canvas" content="drawable" layoutsubtree>` backed by one `ElementGL` WebGL 2 context (`/lib/element-gl.js`): `#pr-scene-a` (Amber Film Slate UI) and `#pr-scene-b` (Cool Projection Deck UI). Both stay live with clickable cue buttons and `<input type="text">` fields (`user-select: text`), while `BURN_FRAG` composites them across `0%..100%` using four-octave FBM noise, pointer-steered flare geometry, prism RGB dispersion, 10-tap golden-angle DOM highlight halation and scorched gate contrast.

| Experiment or question | Result | Notes |
|---|---|---|
| Dual-scene `ElementGL` upload via `texElementSubImage2D()` and `tMs` progression | measured (`C160`, 2026-11-27) | Check 1 passed (`glErr=0`; fixture textures `630x420` at mobile, `240x160` at desktop; `tMs(1000->1480->2050)=0.00->0.44->1.00`, reduced snap `1`). Live canvas at `412 px` DPR `2.625` stays at `948x941 px` (`0.89 MP`, `8.6 MB` live, `0` lost, `0` unasked readbacks, `0` open snapshots, `scrollWidth === 412`). |
| Mid-burn `48%` overexposure bloom and `Warm 35mm` vs `Prism cyan` R/B ratio flip | measured (`C160`, 2026-11-27) | Check 2 passed on neutral dark fixtures with a bright white highlight: intensity `0` baseline `maxLum=20`, `Warm 35mm` `mean R=235 / B=100` (`maxLum=248`), `Prism cyan` `mean R=137 / B=238` (`maxLum=242`), `glErr=0`. |
| Clean `1:1` View A (`0%`) and View B (`100%`) endpoint separation | measured (`C160`, 2026-11-27) | Check 3 passed with `leakIntensity = 1.6`: `0%` sampled `rgb(216,120,24)` (View A) and `100%` sampled `rgb(24,136,216)` (View B), `glErr=0`. |
| Hit-testing switch between View A and View B at `0%` and `100%` | measured (`C160`, 2026-11-27) | Check 4 passed across overlapping buttons at identical viewport coordinates: at `0%`, `hitA=true, hitB=false, inertA=false, inertB=true`; at `100%`, `hitA=false, hitB=true, inertA=true, inertB=false` via `updateElementGeometry()` scaled by `geometryUnit()` plus `dataset.hitTick`. |
| Synthetic `webglcontextlost`/`webglcontextrestored` recovery and 5-arg 2D fallback | measured (`C160`, 2026-11-27) | Check 5 passed (`inPlain=true`, `restored=true`, `glErr=0` after resetting `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`; 2D fallback `draw2DComposite()` at `48%` sampled `2dLeft=[228,167,86,255]` and `2dMid=[24,136,216,255]`). Interactive `?route=2d` and `?route=plain` also loaded with `0` errors. |
| Interactive DOM controls, `selectstart` guard and reduced-motion snap | measured (`C160`, 2026-11-27) | Real CDP clicks incremented `TAKE 04 -> TAKE 05` and `MARKS 01 -> MARKS 02`, typed into `#slate-cue-input`, prevented `selectstart` on labels while preserving input selection, moved flare coords to `(38%, 66%)`, and snapped back to `View A (1:1)` under emulated `prefers-reduced-motion: reduce`. |
| Real Android phone touch steering, `npm run check:jank` and `npm run build` menu output | not verified | Needs real Chrome 159 on Android (`412 px`, touch) and full repo `npm run build` plus `npm run check:jank -- /prism-burn/`. |

## Things that bit

- Setting `state.lastStatusMs = 0` skipped the first `updateStatus()` call whenever the initial `paint` arrived within `110 ms` of page navigation (leaving `#pr-status` on `"Starting canvas…"` on desktop and `?route=2d`). Initializing `lastStatusMs = -1000`, forcing `updateStatus(true)` on paint 1, and forcing `updateStatus(true)` when `stepBurn()` transitions from active to settled kept the status line current.
- In Check 4, reading `fixA.inert` and `fixB.inert` after both `0%` and `100%` draws checked the post-`100%` state twice. Capturing `inert0A` and `inert0B` right after the `0%` draw fixed the assertion.
- On `412 px` phones, long header tags (`VIEW A · FILM SLATE`, `VIEW B · PROJECTION DECK`) pushed `TAKE 04` and `MARKS 01` onto a second row, and `180.0° · 24 FPS` clipped with an ellipsis inside the 3-column metadata strip. Tightening the tags to `VIEW A · SLATE` / `VIEW B · DECK` and `180° · 24FPS` kept every cell and pill single-line inside `359 px`.
- Because `public/shared/pages.js` isn't regenerated on this branch (`npm run build` was intentionally skipped to avoid editing shared files), `LEARN.mount()` exits early and doesn't mount `.motion-warn` until `npm run build` includes `/prism-burn/`. Once built, `<meta name="reduced-motion" content="warn">` activates the warning banner automatically.

## Not verified

- Real Android Chrome 159 (`A159`, `412 px` wide, `2.625` DPR): touch drag flare steering alongside `touch-action: pan-y` vertical page scrolling, real GPU shader frame rates during animated burns, and real WebGL context-loss recovery.
- `npm run check:jank -- /prism-burn/` and `npm run build` (Playwright isn't installed in this workspace and shared build outputs were left untouched).
- Chromium 153 (`C153`) fallback when `texElementSubImage2D()` is unsupported by default.

## For the index

- Motion and shaders: a single `ElementGL` WebGL 2 canvas can composite two live HTML scenes through an organic 4-octave FBM film light-leak wipe with prism RGB dispersion, 10-tap DOM highlight halation, clean 1:1 endpoints and active-scene hit-test switching via `updateElementGeometry()` (measured in `C160`, `/prism-burn/`).
