# Multi-detent refractive bottom sheet (`/bottom-sheet/`)

Built on 2026-11-27. Static checks (`node --check public/bottom-sheet/sheet.js`, `node tools/gfx/check.mjs` and `node tools/writing/check.mjs --strict /bottom-sheet/`) pass. Browser runtime runs (headless Chromium 157, `npm run check:jank -- /bottom-sheet/` and Chrome 159 on Android at 412 px wide) are **not verified** yet.

The question: can a single WebGL canvas coordinate a 3-detent spring-physics bottom sheet with single-gesture nested-scroll handoff (`scrollTop === 0` transition into sheet drag) while progressively blurring, dimming and edge-refracting a live interactive backdrop beneath rounded corners?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context uploading `#backdrop-dom` and `#sheet-dom` via `texElementSubImage2D()` | not verified | Pass 0 scales `#backdrop-dom` down toward 94.5%, dims it and draws a soft upward drop shadow; Pass 1 samples the backdrop texture on `TEXTURE1` through a top-only rounded SDF (`24 px` morphing to `8 px`), refracting the curved top rim with Snell's law and progressive frost blur behind `.sheet-header`. Live check 1 probes `gl.getError() === 0` and pixel values on `testStage()`. |
| Velocity-aware spring detent selector across 18% (Peek), 52% (Half) and 90% (Full) | not verified | `chooseDetent()` reads a 95 ms pointer sample window so pauses before lifting don't cause phantom jumps, while brisk upward or downward flicks commit to the next or extreme detent and `stepSpring()` integrates with sub-stepped damping (`k = 260`, `c = 24`). Under `prefers-reduced-motion: reduce` (or the Reduced motion toggle), detents snap straight to target with zero overshoot. Live check 2 verifies both regimes. |
| Single-gesture nested-scroll handoff at `scrollTop === 0` | not verified | Using `touch-action: none` on `#sheet-dom` and `#sheet-scroll` keeps Chrome from firing `pointercancel` once inner scrolling starts. `applyDragDelta()` consumes downward motion inside `#sheet-scroll` until `scrollTop === 0`, then feeds leftover pixels straight into `sheetFrac` without lifting the pointer (and reverses back into `scrollTop` if you push back up past Full). Live check 3 verifies all four handoff transitions on an isolated fixture. |
| Calibrated `updateElementGeometry()` scaled by `geometryUnit()` + `dataset.hitTick` cache clearing | not verified | `syncBothGeometries()` updates both `#backdrop-dom` (scaled 94.5% to 100%) and `#sheet-dom` (translated to `sheetTop`) only when their transform key changes, keeping `Recentre`, `Traffic`, map pins, search `<input>`, category pills and list `Route`/`Save` buttons interactive. Live check 4 tests `document.elementsFromPoint()` and click delivery on both layers. |
| Five-argument 2D `drawElementImage()` and plain-HTML context-loss fallbacks | not verified | Drops to `render2DFallback()` with explicit 5-arg `drawElementImage()` calls in CSS pixels when `texElementSubImage2D()` is absent, and moves `#backdrop-dom` and `#sheet-dom` into `#plain-host` with CSS `backdrop-filter` if HTML-in-canvas is missing or `onLost` fires. |

## Things that bit

- Setting `touch-action: pan-y` on `#sheet-scroll` lets Chrome start compositor scrolling natively, which fires `pointercancel` and breaks single-gesture handoff when `scrollTop` reaches `0`. Handling touch drags through `applyDragDelta()` with `touch-action: none` on `#sheet-dom` preserves pointer continuity across the `scrollTop === 0` boundary while mouse wheel and keyboard navigation still scroll `#sheet-scroll` natively.
- Resizing `#sheet-dom` on each spring frame would trigger CSS layout reflow and clamp `#sheet-scroll.scrollTop` whenever the sheet dropped below Full. Fixing `#sheet-dom` at `94%` stage height and sliding it via `updateElementGeometry()` preserves `scrollTop` across Peek, Half and Full transitions.
- Putting the map's `Recentre` and `Traffic` controls inside the top `35 px` band keeps `(5 + 30) * 0.945 + 4 = 37.1 px` above `sheetTop` (`44 px` to `58 px`) even at Full (90%) detent.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /bottom-sheet/`, `node tools/draw-size/audit.mjs /bottom-sheet/`, and live checks 1 to 5): confirm zero layout shift, zero timed readbacks, backing store under 4 MP at 412 px and DPR 2.625, and exact hit-test coordinates on `testStage()`.
- Chrome 159 on Android at 412 px wide by touch: test single-finger drag from `scrollTop > 0` past `scrollTop === 0` down to Half/Peek, brisk flicks between detents, typing in `#sheet-search` with the on-screen keyboard, tapping `Recentre`/`Traffic` above a 90% sheet, and verifying `touch-action: pan-y` on the uncovered map scrolls the outer page.
- Keyboard traversal and screen reader behaviour across `#backdrop-dom` and `#sheet-dom` controls, plus `onLost` / `onRestored` recovery on a real phone GPU reset.

## For the index

- Transitions, text and motion: `/bottom-sheet/` coordinates a three-detent spring bottom sheet (`18%`, `52%`, `90%`) and live interactive street map inside one `ElementGL` canvas, handling single-gesture nested-scroll handoff at `scrollTop === 0`, progressive backdrop blur/dimming/scaling, curved top-edge Snell refraction (`24 px` to `8 px` corners) and `updateElementGeometry()` hit testing.
