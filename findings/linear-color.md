# Linear-light colour spaces, `contrast-color()` and `ctx.lang` (`/linear-color/`)

Not verified in headless Chromium (C157) or on the test phone (A159) as of 2026-11-22. The page was written and checked with `npm run check:gfx` and `node tools/writing/check.mjs`; the live checks on the page report exact browser support and pixel measurements when opened.

The page pairs three newer colour and text APIs with 2D `drawElementImage()`: side-by-side `srgb` and `srgb-linear` (with a toggle for `display-p3-linear`) canvases blending neon DOM buttons, a drawable card whose text uses CSS `contrast-color(var(--tint))` over a reactive canvas tint, and `CanvasTextDrawingStyles.lang` beside a drawn `<span lang="...">` displaying CJK Han variant characters (`直 骨 海 角 刃 令`).

| Question | Result | Notes |
|---|---|---|
| `getContext('2d', { colorSpace: 'srgb-linear' })` accepted on a drawable canvas | not verified | Check 1 inspects `ctx.getContextAttributes().colorSpace`. |
| `getContext('2d', { colorSpace: 'display-p3-linear' })` accepted on a drawable canvas | not verified | Check 2 inspects `ctx.getContextAttributes().colorSpace`. |
| Overlapping red and cyan `drawElementImage()` calls blend brighter in `srgb-linear` than in `srgb` | not verified | Check 3 draws `#ff0000` under 50% `#00ffff`, copies both canvases into plain `willReadFrequently` 2D canvases and compares the centre RGB values (expected ~188 vs ~128 in sRGB 8-bit). |
| `ctx.filter = 'blur(8px)'` over a red/cyan `drawElementImage()` seam blends brighter in `srgb-linear` | not verified | Check 4 compares the midpoint pixel across the blurred seam. |
| `CSS.supports('color', 'contrast-color(red)')` and black/white flip on `var(--tint)` | not verified | Check 5 tests dark blue vs bright yellow with a registered `--tint` (`syntax: '<color>'`). |
| Changing `--tint` updates the drawn pixels of a `drawable` card using `contrast-color(var(--tint))` | not verified | Check 6 draws a fixture card before and after flipping `--tint` and counts changed pixels from a plain copy. |
| `CanvasTextDrawingStyles.lang` accepts `'ja'`, `'zh-Hans'` and `'zh-Hant'` | not verified | Check 7 checks `'lang' in CanvasRenderingContext2D.prototype` and reads back each tag. |
| `ctx.lang` and `drawElementImage(<span lang>)` render matching CJK Han variants | not verified | Check 8 draws `直骨海角刃令` with `ja` and `zh-Hans` on both paths and reports pixel differences; systems with one shared CJK fallback font will show 0 px difference. |

## Things that bit

- A 2D canvas cannot switch `colorSpace` after `getContext()` has been called. Toggling between `srgb-linear` and `display-p3-linear` therefore creates a fresh `<canvas content="drawable" layoutsubtree>`, moves the four neon `<button>` children into it with `moveBefore()` (falling back to `append()`), removes the old canvas and calls `window.__gfx?.retire(old)`.
- Reading pixels directly from a drawable canvas or setting `willReadFrequently: true` on a drawable canvas loses 2D canvases on Android Chrome 159. All pixel checks copy the drawable canvas into a plain 2D canvas with `drawImage()` and read from the copy.

## Not verified

- Headless Chromium 157: run `npm run check:jank -- /linear-color/` and record the live check results, layout shift count and memory estimate.
- Android Chrome 159 at 412 px wide (device pixel ratio 2.625): confirm touch dragging on the sliders, button hit testing in both canvases after toggling `srgb-linear` and `display-p3-linear`, and no context loss.
- Display P3 hardware screen: confirm visual gamut difference when switching the right canvas from `srgb-linear` to `display-p3-linear` with `color(display-p3 ...)` neon buttons.
- A device with separate Japanese, Simplified Chinese and Traditional Chinese CJK fonts installed: confirm that `ctx.fillText()` with `ctx.lang` picks the same regional glyph variants as `drawElementImage()` on `<span lang>`.

## For the index

- Colour spaces: side-by-side `srgb`, `srgb-linear` and `display-p3-linear` 2D drawable canvases with `ctx.filter` blur and semi-transparent `drawElementImage()` (not verified, `/linear-color/`).
- CSS and styling: `contrast-color(var(--tint))` on a drawable card driven by a registered `<color>` custom property and a reactive canvas backdrop (not verified, `/linear-color/`).
- Text: `CanvasTextDrawingStyles.lang` compared with `drawElementImage()` on `<span lang>` for CJK Han variants (not verified, `/linear-color/`).
