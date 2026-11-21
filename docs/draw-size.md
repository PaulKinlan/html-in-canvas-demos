# Draw size: an element drawn too large on a high-density screen

On the test phone (Chrome 159, Android, device pixel ratio 2.625) the marquee on `/element-ideas/` was drawn about 2.6 times too large, so the ticker showed a few blocks in place of text. The same page was right in the test browser, which runs at a ratio of 1. This document says what the default size of `drawElementImage()` is, the rule that follows, and what checks it. The measurements are in [../findings/draw-size.md](../findings/draw-size.md).

## What the call does

`ctx.drawElementImage(element, x, y)` has no width and height. The picture is then drawn at the element's layout size multiplied by the canvas's backing scale (`canvas.width / canvas.clientWidth`), in the units of the context, and the context's transform is applied on top of that.

Measured in Chromium 157 with `--force-device-scale-factor=2.625`, a 100 by 40 CSS pixel element:

| Canvas backing store | Context | Call | Drawn, canvas pixels | Drawn, CSS pixels |
|---|---|---|---|---|
| CSS size times 2.625 | not scaled | no size | 263 by 105 | 100 by 40, right |
| CSS size times 2.625 | `scale(2.625, 2.625)` | no size | 689 by 276 | 263 by 105, too large |
| CSS size times 2.625 | `scale(2.625, 2.625)` | `el.offsetWidth, el.offsetHeight` | 263 by 105 | 100 by 40, right |
| CSS size times 2.625 | not scaled | `el.offsetWidth, el.offsetHeight` | 100 by 40 | 38 by 15, too small |
| CSS size (ratio ignored) | not scaled | no size | 100 by 40 | 100 by 40, right |

The hit region follows the picture, so a wrong size also moves where taps land. A snapshot from `captureElementImage()` has the same default size as its element. `canvas.getElementImageDefaultSize(elementOrSnapshot)` returns that default size.

At a ratio of 1 every row gives 100 by 40, which is why a test browser at its defaults shows nothing. Playwright's `deviceScaleFactor` does not show it either. `--force-device-scale-factor` does.

## The rule

Pass the width and height, in the units of the context:

- A context scaled with `ctx.scale(dpr, dpr)`: `ctx.drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight)`.
- A context that is not scaled, on a canvas whose backing store is the CSS size times `dpr`: `ctx.drawElementImage(el, x * dpr, y * dpr, el.offsetWidth * dpr, el.offsetHeight * dpr)`.

A call with no size is right only where the context has no scale. That is the case in a live check that draws into a new context or straight after `ctx.reset()`, and in a worker that draws a snapshot, which has no layout size to pass.

## What checks it

| Check | When | What it finds |
|---|---|---|
| `draw-size` in `npm run check:gfx` (`tools/gfx/check.mjs`) | In `npm run build`, so a preview or a deploy fails | A `drawElementImage()` call with three arguments. Not reported where the context is plainly unscaled: `reset()` on the same line or the line above with no scale after it, or a call made straight on `getContext('2d')`. Any other exception needs `// gfx-allow: draw-size <reason>` at the call. A call that spreads its arguments cannot be counted in the source. |
| Point 14 of `/shared/context-guard.js` | On every page load, on every device | A call with no size on a canvas whose backing scale is not 1, in a context whose scale is not 1. On a screen whose ratio is not a whole number (the test phone's 2.625), also a call with a size that makes one of two mistakes: a size in device pixels in a context already scaled by the ratio (drawn 2.625 times too large), or a size in CSS pixels in an unscaled context on a canvas whose backing store has the ratio (drawn at 38%). Both need an exact match, so an effect that changes an element's size over time is not counted when it passes the ratio. The first on a page is written to the console and sent as a `draw-size` report (`npm run reports`), and `window.__gfx.draws` holds the counts. |
| `wrongDrawSize` in `npm run check:jank` | For each page a pull request changes | Fails when the guard counted any such call while the page loaded at device scale 2.625. It does not scroll, so it measures only the demos that draw on the first screen: with the old `/element-ideas/` code it passed, because that page starts each demo when it comes near the screen. |
| `node tools/draw-size/audit.mjs` | By hand, for each page a pull request adds or changes, or for every page | Opens each page at device scale 2.625 and 412 px wide, scrolls through it so that each demo starts, presses "Run these checks", and prints the guard's counts for the page and its frames. |
| `node tools/gfx/test-guard.mjs` | By hand | Seven cases for point 14 at device scale 2.625: four right draws that must not be counted and three wrong ones that must. |

A page that draws at the wrong size on purpose, to measure it, puts `data-gfx-any-size` on that canvas and the guard does not count it (`/slot/` has one such check).

## Limits of the checks

- The sized-call check compares against the device pixel ratio, so it runs only where the ratio is not a whole number. On a screen with a ratio of 2 or 3 a deliberate enlargement by 2 or 3 would look the same as the fault.
- A call with no size in a scaled context is counted even if the page meant the enlargement and works in canvas pixels. Pass a size there too.
- The guard does not run in a worker, so a draw into an `OffscreenCanvas` in a worker is not measured.
- `texElementSubImage2D()` and `drawElementImageToTexture()` are not covered. They take no draw size.
