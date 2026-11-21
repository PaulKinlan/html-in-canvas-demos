# Draw size on a high-density screen (`drawElementImage()` with no size, every page and library)

Measured in headless Chromium 157 (C157) with `--force-device-scale-factor=2.625` and a 412 px wide window, on 2026-11-21. Reported from the phone (A159, device pixel ratio 2.625) on the same day: the marquee ticker on `/element-ideas/` showed a few large blocks in place of text. The rule and the checks are in [../docs/draw-size.md](../docs/draw-size.md).

## What the default size is

A 100 by 40 CSS pixel `drawable` element in a canvas 300 by 150 CSS pixels.

| Canvas backing store | Context | Call | Result | Detail |
| --- | --- | --- | --- | --- |
| 788 by 394 (CSS size times 2.625) | not scaled | `drawElementImage(el, 0, 0)` | measured: right | 263 by 105 canvas pixels, hit region 100 by 40 CSS pixels. |
| 788 by 394 | `scale(2.625, 2.625)` | `drawElementImage(el, 0, 0)` | measured: 2.625 times too large | 689 by 276 canvas pixels, hit region 262.5 by 105 CSS pixels. |
| 788 by 394 | `scale(2.625, 2.625)` | `drawElementImage(el, 0, 0, 100, 40)` | measured: right | 263 by 105 canvas pixels, hit region 100 by 40. |
| 788 by 394 | not scaled | `drawElementImage(el, 0, 0, 100, 40)` | measured: too small | 100 by 40 canvas pixels, hit region 38.1 by 15.2 CSS pixels. |
| 300 by 150 (the ratio ignored) | not scaled | `drawElementImage(el, 0, 0)` | measured: right | 100 by 40 canvas pixels and CSS pixels. |
| Any of the three | not scaled | `drawElementImage(snapshot, 0, 0)` with a `captureElementImage()` picture | measured: same as the element | 263 by 105 on the two large canvases, 100 by 40 on the third. |
| The same seven at a device scale factor of 1 | | | measured: all 100 by 40 | The fault cannot be seen at a ratio of 1. |

So the default size is the layout size times the canvas's backing scale, in the units of the context, and the transform is applied on top. A call with no size is right only in a context with no scale.

## The audit

| Question | Result | Detail |
| --- | --- | --- |
| How many `drawElementImage()` calls are there, and how many have no size? | measured | 402 calls in the source under `public/` (vendored and compiled files left out): 328 with five arguments, 27 with nine or ten, 3 that spread their arguments, 43 with three, and one in page text. |
| Which of the 43 draw at the wrong size at a ratio of 2.625? | measured: 2 | `put()` in `/element-ideas/kit.js`, used by all 17 demos on that page, and the row drawing in `/elements/index.html`. Both are under `ctx.scale(dpr, dpr)`. They now pass `el.offsetWidth, el.offsetHeight`. Pull request 104 makes the same two edits; this branch carries them so that the new build rule passes whichever merges first. |
| What are the other 41? | measured: right | Live checks and receivers that draw into a new context or straight after `ctx.reset()`, on `/slot/`, `/slot-bare/`, `/time-scrubber/`, `/transports/`, `/offscreen/`, `/cross-origin/`, `/cross-tab/`, `/patch/`, `/datalist/`, `/elements/probe.js` and `lib/glyph-field.js`. Their contexts have no scale, so the default size is the right one. One check on `/slot/` scales the context on purpose to compare the two calls. |
| Does any page draw an element at the wrong size when it runs? | measured: none after the two fixes | `node tools/draw-size/audit.mjs`: 122 pages at device scale 2.625, each scrolled from top to bottom, its "Run these checks" button pressed. Before the fixes `/element-ideas/` counted 200 or more wrong calls (the first: an `<option>` on the select wheel, context scale 2.28). |
| Does a call that passes a size make the same mistake anywhere? | measured: none found | The guard looks for a size in device pixels in a scaled context, and a size in CSS pixels in an unscaled context on a scaled canvas. No page was counted. A first, looser version of this test (any element drawn at 2.625 or 1/2.625 times its layout size, within 3%) counted the fisheye on `/input-ideas/`, whose buttons pass through that size, so the test now needs an exact match. |
| Were the blank widgets on `/nested-frames/` (pull request 102) the same fault? | measured: no | The page has no call without a size and the guard counted no wrong size on it at 2.625. |

## Things that bit

- Passing `el.offsetWidth, el.offsetHeight` everywhere would have broken the 41 calls that are right: in an unscaled context on a canvas with a scaled backing store that size is in the wrong unit and draws the element at 38%.
- `npm run check:jank` runs at device scale 2.625 and still passed the old `/element-ideas/`, because it does not scroll and that page starts each demo when it comes near the screen. The audit script scrolls.
- A source check cannot know whether a context is scaled. The build rule lets through a call made straight on `getContext('2d')` or straight after `reset()`, and asks for a `gfx-allow: draw-size` comment with the reason anywhere else (six calls have one).

## Not verified

- On the phone (A159): that `/element-ideas/` and `/elements/` now draw at the right size. Open `/element-ideas/#ticker`; the ticker should show readable text. The guard sends a `draw-size` report if any page still draws at the wrong size (`npm run reports -- --since 2h --list`).
- Draws made only after a tap or a drag in a page. The audit loads, scrolls and runs the live checks, and does not operate the demos. The guard measures those draws on the device and reports them.
- Draws into an `OffscreenCanvas` in a worker (`/transports/worker.js`, `/offscreen/`): the guard does not run in a worker. Read from the source: each resets the context before the draw.
- Screens with a ratio of 2 or 3: the sized-call test is off there, the no-size test is on.

## For the index

- 2D drawing: `drawElementImage(el, x, y)` with no size draws at the layout size times the canvas's backing scale, in the units of the context, with the transform on top; under `ctx.scale(devicePixelRatio)` it is `devicePixelRatio` times too large, and the hit region with it. measured, C157 at device scale 2.625, `findings/draw-size.md`.
- Testing: Playwright's `deviceScaleFactor` and a ratio of 1 hide the fault; `--force-device-scale-factor=2.625` shows it. `node tools/draw-size/audit.mjs` runs every page that way.
- ARCHITECTURE.md needs `tools/draw-size/audit.mjs`, the `draw-size` rule of `check:gfx`, point 14 of the guard and the `wrongDrawSize` limit of `check:jank`.

## API requests

- A no-size `drawElementImage()` that follows the current transform's unit (CSS pixels after `scale(dpr)`) would remove the fault, or the explainer could state the default size in terms of the backing scale. `getElementImageDefaultSize()` exists and returns the size in canvas pixels.
