# Scroll direction, `:target-before`/`:target-after` and rounded `polygon()` (`/scroll-directions/`)

Built on 2026-11-22 for the `scroll-directions` item in `tools/chrome-apis/demos.json`. Source checked with `npm run check:gfx` and `node tools/writing/check.mjs --strict`. Browser execution of the six live checks is **not verified** in this run (no headless Chromium pass or Android phone pass was run yet); every live check runs on isolated fixtures in the visitor's browser and reports its own browser support and pixel readings directly.

The question: can `@container scroll-state(scrolled)`, `:target-before`/`:target-after` on `::scroll-marker`, and `clip-path: polygon(round ...)` drive interactive 2D `drawElementImage()` effects without scroll listeners?

| Experiment | Status | Notes |
|---|---|---|
| `@container scroll-state(scrolled: bottom / top)` toggling registered `@property --hide` inside a drawable 2D scroller | Not verified in Chromium yet | The page checks `CSS.supports('container-type', 'scroll-state')` and parses `@container scroll-state(scrolled: bottom)` via `CSSStyleSheet`, then folds `#s1-toolbar` in two hinged halves on `paint` with zero `scroll` listeners. Manual "Simulate scroll down / up" buttons toggle `data-sim` for browsers without `scroll-state(scrolled)`. |
| Scrolling a drawable child firing `paint` with zero scroll listeners | Not verified in Chromium yet | Live check 2 scrolls an isolated drawable child with no scroll listener attached and reads pixels from a plain `drawImage()` copy canvas to confirm `paint` ran and the scrolled band moved into view. |
| `:target-before`, `:target-current` and `:target-after` setting `--fan-side` and `--fan-tilt` on `::scroll-marker` | Not verified in Chromium yet | The carousel reads `getComputedStyle(stop, '::scroll-marker')` to tilt passed cards left, centre the active card and stack upcoming cards right. Falls back to `scrollLeft` if the pseudo-classes are not active in the visitor's browser. Live check 3 verifies `-1`, `0`, `1` on a 3-slide fixture. |
| `clip-path: polygon(round ...)` clipped outline on a drawn card | Not verified in Chromium yet | The page reports `CSS.supports('clip-path', 'polygon(round 12px, 0 0, 100% 0, 100% 100%, 0 100%)')`. Where unsupported, a canvas `arcTo()` rounded polygon path supplies the shadow and clip so the corner-radius slider still works. Live check 4 tests both `CSS.supports()` and transparent corner pixels in a plain copy canvas. |
| Canvas 2D drop shadow following the clipped polygon outline | Not verified in Chromium yet | Live check 5 draws a diamond-clipped card with `shadowOffsetX = 14` and checks that the bounding corner outside the diamond stays transparent while pixels shifted off the angled edge carry shadow alpha. |
| Context loss and plain-HTML fallback across all three canvases | Not verified in Chromium yet | All three canvases handle `contextlost` and `contextrestored`, moving their drawable DOM back into `.stage.plain` with a visible notice. Live check 6 runs `stillDrawn()` over plain 2D copies of all three canvases. |

## Things that bit

- Drawing a folding toolbar in two clipped `drawElementImage()` calls overwrites the element's hit box with the second half's transform. The draw path switches to a single unclipped `drawElementImage()` call once `--hide <= 0.01`, and sets `toolbar.inert = true` past 60% folded so hidden buttons drop out of keyboard Tab order.
- A drawable card left inside a horizontal snap scroller gets clipped by the scroller's viewport. Keeping each `.f2-card` positioned against `#f2-deck` (outside `#f2-track`'s clip, following the pattern from `/carousel/`) preserves the full picture of side cards while keeping `::scroll-marker`, `scroll-state(snapped)` and DOM order intact.
- Applying a canvas `ctx.clip()` around a `drawElementImage()` call clips `ctx.shadowBlur` too. When falling back to `arcTo()` rounding on browsers without `polygon(round ...)`, the shadow is drawn first from the rounded polygon fill and the clipped DOM card is drawn on top.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /scroll-directions/` and `node tools/draw-size/audit.mjs /scroll-directions/`): run both to verify layout stability, zero timed readbacks, backing-store sizing at 412 px and DPR 2.625, and live check outcomes.
- Chrome 159 on Android at 412 px wide by touch: scrolling `#s1-scroller` without scroll listeners, swiping `#f2-track` and tapping Pin/Lock on cards, and dragging `#c3` with `touch-action: none` while tapping Check in and Seat buttons.
- Exact milestone availability of `@container scroll-state(scrolled)` and `clip-path: polygon(round ...)` across Chrome 157, 159 and 160.

## For the index

- CSS container queries: `/scroll-directions/` tests `@container scroll-state(scrolled: bottom / top)` driving a registered `@property --hide` on a drawable 2D canvas with zero scroll listeners.
- CSS carousels: `/scroll-directions/` reads custom properties from `::scroll-marker:target-before`, `:target-current` and `:target-after` to fan nested drawable cards on a 2D canvas.
- CSS shapes and clipping: `/scroll-directions/` tests `clip-path: polygon(round ...)` alpha clipping and matching 2D canvas drop shadows on a pointer-tilted card.
