# Drawable subtree complexity and CSS invalidation (`/perf-subtree/`)

Built on 2026-11-26. Not verified in a live browser or on real hardware yet (no browser measurements are recorded below; every row waits for a sweep on Chrome with `#canvas-draw-element` enabled).

## Questions and expected measurements

| Experiment | Result | Notes |
|---|---|---|
| 1. Flat baseline cards (16 siblings, 1 mutated per frame) across Plain DOM, 2D `drawElementImage()`, WebGL `texElementSubImage2D()` | not verified | Baseline frame time (`p50`/`p95`), LoAF split and `paint` event rate. |
| 2. Deep nested DOM (24 wrapper divs around changing label) | not verified | Isolates style and layout tree depth inside a `drawable` card. |
| 3. Rich text and typography (emoji, CJK, OpenType ligatures, mixed weights) | not verified | Tests text shaping and glyph rasterisation cost on paint-record rebuild. |
| 4. CSS `box-shadow` stack (5 blurred layers per card) | not verified | Tests multi-layer blur ink-overflow cost and whether `contain: layout paint` clips sibling invalidation. |
| 5. CSS `filter: blur()` and `drop-shadow()` on children | not verified | Tests per-child filter rasterisation inside a drawable subtree and post-main-thread LoAF presentation time. |
| 6. CSS `backdrop-filter: blur(8px)` inside drawable subtree | not verified | Tests backdrop readback and blur cost across Plain DOM, 2D and WebGL drawable canvases. |
| 7. Inline SVG `<feTurbulence>` + `<feGaussianBlur>` filter | not verified | Tests SVG filter pipeline stalls inside `drawable` cards. |
| 8. Mutation type comparison: transform-only vs paint-only vs layout mutation | not verified | Checks whether an inner `transform: translateX()` mutation triggers `paint` events and rebuilds the card's paint record compared with colour and layout edits. |
| 9. Containment sweep: `contain: none` vs `contain: layout paint` vs `contain: strict` | not verified | Measures `p95` frame delta and `e.changedElements.length` over-invalidation delta when 1 of 16 siblings mutates. |
| Flow-layout sibling reflow (`e.changedElements.length` with `contain: none` vs `contain: layout paint`) | not verified | Live check 3 mutates card 0 width inside a wrapping flex layout and compares `e.changedElements.length`. |
| Selective WebGL re-upload via `e.changedElements` | not verified | Live check 4 verifies `ElementGL` uploads 16 cards on first paint and only listed cards after mutating 1 sibling. |

## Things that bit

- **`contain: strict` collapses cards without definite tracks.** Because `contain: strict` includes `size`, an auto-sized card collapses to 0 px tall unless its grid track fixes the box. Using `grid-template-rows: repeat(4, 78px)` keeps identical card geometry across `contain: none`, `contain: layout paint` and `contain: strict`.
- **Keeping the stage under mobile GPU budgets.** The stage is fixed at 356 px high (about 1.0 MP at 412 px wide and DPR 2.625, well below the 4 MP limit), starts statically on 2D with no animation loop and zero WebGL contexts, and retires every removed canvas via `window.__gfx?.retire(canvas)` between sweep runs.
- **No direct readback on drawable canvases.** Live check 1 verifies non-blank 2D output by copying the fixture canvas via `drawImage()` into a plain off-DOM canvas created with `willReadFrequently: true`, avoiding the Chrome 159 Android context-loss trigger on drawable canvases.

## Not verified

- Measured `p50` / `p95` frame times, FPS, and LoAF (`script`, `styleAndLayout`, post-main-thread presentation) splits on real desktop GPU and Android phone (A159) hardware. Run "Run full matrix" on `/perf-subtree/` and copy the Markdown output or read `npm run reports -- --page /perf-subtree/`.
- Whether `e.changedElements.length` over-invalidates sibling cards under `box-shadow`, `backdrop-filter` or flow layout without `contain: layout paint` in C157 and A159. Run Live checks 2, 3 and 5 on `/perf-subtree/`.
- Whether an inner CSS `transform` mutation fires `paint` automatically on every frame or skips `paint` without `requestPaint()`. Run Live check 5 and Workload 8 on `/perf-subtree/`.
- Jank audit (`npm run check:jank -- /perf-subtree/`) and HiDPI draw-size audit (`node tools/draw-size/audit.mjs /perf-subtree/`).

## For the index

- Performance / invalidation: `/perf-subtree/` times nine DOM and CSS complexity workloads (flat, 24-level nesting, rich typography, `box-shadow`, `filter`, `backdrop-filter`, SVG filter, mutation types, CSS containment) across Plain DOM, 2D `drawElementImage()` and WebGL `texElementSubImage2D()`, reporting `p50`/`p95`, LoAF splits and `e.changedElements` counts (not verified yet).
