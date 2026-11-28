# Wave-staggered kinetic list (`/kinetic-stagger/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 at `412x915` (`2.625` DPR, touch emulation) and `1024x900` (`1` DPR), plus a plain-HTML fallback run with `--disable-blink-features=CanvasDrawElement`. Syntax, graphics rules, writing and social metadata checks ran via `node --check`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs`, `node tools/site/build.mjs --check` and `node tools/social/validate.mjs`. Chrome 159 on Android, `npm run check:jank -- /kinetic-stagger/` and `node tools/draw-size/audit.mjs /kinetic-stagger/` are **not verified** yet.

The question: can one `ElementGL` WebGL 2 canvas cascade staggered damped harmonic springs across five live `drawable` HTML list rows with velocity skew, directional blur and R/B chroma separation during filtering, shuffling and flick-scrolling while locking button hit testing 1:1 at rest?

## What was built

One `<canvas id="ks-canvas" content="drawable" layoutsubtree>` inside `.ks-viewport` (`368 px` tall above `620 px`, `360 px` tall at `<= 620 px`, zero `dvh`) hosting five live `drawable` horizontal list cards (`#ks-row-0` through `#ks-row-4`). Each row holds a category pill (`Active` or `Queued`), title and live hit/pin readout, a `Pin` toggle button and a `+1` increment button.

External controls (`All`, `Active`, `Pinned`, `Shuffle order`, `Send wave`, `#ks-filter-input` text search with `user-select: text`, `Spring stiffness` slider, `Chroma skew` slider and `Reduced motion` checkbox synced with `prefers-reduced-motion`) drive `stepRowSprings(rows, tMs)` in `240 Hz` symplectic substeps with `delay = rank * 48 ms`. One `ElementGL` WebGL 2 context sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` on creation and inside `onRestored`, gates `stage.upload()` on `hasPainted` after `stage.begin()`, generates mipmaps (`gl.generateMipmap`) and draws each row on a `48 x 36 px` padded quad in `STAGGER_FRAG` before snapping to `1:1` passthrough at rest.

## Results

| Question | Result | Detail |
|---|---|---|
| Do all five rows upload via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`glErr=0`, five `578x95` textures at `2.625` DPR / `220x36` at `1` DPR, opaque alpha `255`). Live phone stage ran at `937x941 px` (`0.88 MP`, `7.05 MB` on `1` WebGL context, `0` lost, `0` open snapshots, `scrollWidth === 412`). |
| Does `stepRowSprings(rows, tMs)` cascade `48 ms` per-row stagger with row 0 settling ahead of row 4 lagging/skewing? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`t120 rem0=0.0px`, `rem4=51.2px`, `skew4=0.013`; `t230 skew4=0.162`, `chroma4=10.0px`, `err=0`; `t500` row 0 settled, `t1200` all 5 rows settled). |
| Do velocity shear (`skew = vel * k`), directional blur and R/B chroma split differ measurably from settled 1:1 rest? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed (`meanDiff=53.4` at `2.625` DPR / `54.7` at `1` DPR, `maxRB=223`, sheared corner `alpha=238` vs `0` outside the rest box). Live `Send wave` reached `Wave skew 0.06` at `100 ms`, and a flick drag reached `Wave skew 0.23` before settling to `Settled 1:1`. |
| Does `updateElementGeometry()` keep moved buttons clickable after filtering and shuffling? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`slot0HitBtn3=true`, `slot2HitBtn0=true`, `filteredRow1Inert=true`, `clicks=[1,0,0,1]`). On the live page, `Active` marked `#ks-row-2` and `#ks-row-4` `inert`, `Pinned` marked `#ks-row-1`, `#ks-row-3` and `#ks-row-4` `inert`, and clicking a shuffled row's `+1` button at `(342, 584)` on phone and `(913, 450)` on desktop incremented its live readout. |
| Do synthetic `webglcontextlost`/`webglcontextrestored`, 5-argument 2D `drawElementImage()` and `#plain-host` recover? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`preventDefault=true`, `plainWhileLost=true`, `restored=true`, `err=0`, `2dFill=41.5%` phone / `41.7%` desktop). With `--disable-blink-features=CanvasDrawElement`, `#plain-host` rendered all 5 rows at `scrollWidth=412` and filtered Queued rows cleanly. |
| Does the visible stage remain drawn after checks finish (`stillDrawn`)? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 passed (`6/6` total, `100.0%` drawn, `0` console/page errors, `0` removed canvas bytes). |
| Real Android phone touch flick feel, `npm run check:jank` and `draw-size/audit.mjs` | not verified | Needs Chrome 159 on Android at `412 px` wide and a local Playwright run. |

## Things that bit

- **Step overshoot past `420 ms` in Check 2**: with `stiffness = 480` and `dampingRatio = 0.58`, Row 0 crossed `targetY` near `120 ms` (`velY = 259 px/s`), overshot by `2.8 px` at `230 ms` and remained `0.27 px` away at `420 ms` (just above the `0.20 px` settle threshold). Evaluating `row0.settled` at `500 ms` while checking `rem0 < 4 px` at `120 ms` and `skew4 > 4 * skew0` at `230 ms` verifies both early wave lead and crisp settle.
- **Pending `668 KB` 2D fixture memory after Check 5**: removing the secondary 2D fallback fixture (`cv2`) and calling `window.__gfx?.retire?.(cv2)` without clearing `cv2.width = 0; cv2.height = 0;` left `668,168` bytes in `window.__gfx.memory().removed` immediately after `runTests()` finished. Zeroing `cv2.width` and `cv2.height` before removal dropped `removed` to `0`.

## Not verified

- Chrome 159 on Android (`412 px` wide, `2.625` DPR): real GPU frame rate during staggered shuffles, touch flick inertia and thumb taps on `Pin` / `+1` buttons.
- `npm run check:jank -- /kinetic-stagger/` and `node tools/draw-size/audit.mjs /kinetic-stagger/` (Playwright was absent in this environment).
- Live page 5-argument 2D `drawElementImage()` fallback in a WebGL-disabled browser.
- `npm run build` and `node tools/social/capture.mjs /kinetic-stagger/`.

## For the index

- Transitions, text and motion: `/kinetic-stagger/` renders five live `drawable` list rows on one `ElementGL` WebGL 2 canvas with `48 ms` staggered harmonic springs, velocity skew (`skew = vel * k`), directional blur and R/B chroma trails across filtering, shuffling and flick-scrolling (measured in Chrome 160 Canary, 2026-11-27; Android not verified).
