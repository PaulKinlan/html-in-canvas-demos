# Shared-element container morph (`/morph-container/`)

Measured in headless Google Chrome `160.0.8188.0` canary on 2026-11-27 (`412x915` viewport at `2.625` DPR with touch emulation, `1024x900` at `1` DPR, `?route=2d`, `--disable-blink-features=CanvasDrawElement`, and `prefers-reduced-motion: reduce` media emulation). Syntax check (`node --check`), graphics rules (`node tools/gfx/check.mjs`), strict writing checks (`node tools/writing/check.mjs --strict /morph-container/` and `--docs --strict`), page validation (`node tools/site/build.mjs --check`) and social metadata validation (`node tools/social/validate.mjs /morph-container/`) all passed. Chrome 159 on Android, headless Chromium 157, `npm run check:jank` and `node tools/draw-size/audit.mjs` are **not verified** yet.

The question: can one `ElementGL` WebGL 2 canvas melt any of four live HTML grid cards continuously into an expanded detail sheet and back into its slot using a rounded-rect SDF mask, cross-blur UV scaling and `updateElementGeometry()` hit testing?

## What was built

One `<canvas id="mc-canvas" content="drawable" layoutsubtree>` inside `.mc-viewport` (`432 px` tall and capped at `64svh` below `640 px`, `456 px` tall at `640 px` and above, zero `dvh`, `924x1129` / `1.04 MP` / `8.35 MB` at `412 px` and `2.625` DPR) compositing two live `drawable` HTML subtrees:

- **2×2 project card grid (`#mc-grid`)**: four colour-coded compact HTML cards (`Coral Audio`, `Cobalt Lens`, `Emerald Synth`, `Amber Reel`), each with a live counter button (`★ 12`, `★ 8`, `★ 19`, `★ 5`) and an `Open` button (plus full-card click target).
- **Expanded detail sheet (`#mc-detail`)**: colour accent matched to the chosen slot, clickable action pills (`+1 Take`, `Pin card`, `HQ master`) synced back to `#mc-grid`, an editable `<input id="mc-note-input">` (`user-select: text` while the stage keeps `user-select: none` and cancels `selectstart` outside inputs), and a `Collapse` button (`#mc-close-btn`).

One `ElementGL` WebGL 2 context (`/lib/element-gl.js`) sets `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at creation and in `onRestored`, gates `stage.upload()` on `hasPainted = true` inside `paint` after `stage.begin()`, generates texture mipmaps (`gl.generateMipmap()` + `LINEAR_MIPMAP_LINEAR`), and drives the morph through `stepMorphSpring()` (`tMs` deterministic spring with `Slow 0.25x` and `prefers-reduced-motion: reduce` snap). `IntersectionObserver` and `document.hidden` pause animation off screen, `?route=2d` renders a rounded-rect clip morph via 5-argument `drawElementImage()`, and `?route=plain` or `webglcontextlost` moves both subtrees into `#plain-host`.

## Results

| Experiment or question | Result | Notes |
|---|---|---|
| Does `ElementGL` upload both `#mc-grid` and `#mc-detail` via `texElementSubImage2D()` with `gl.getError() === 0`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`glErr=(0,0)`, `card0rgb=(239,68,68)`, `detailCenter=(255,255,255)`, `scrimEdge=(10,12,20)`). Live `412x915 @ 2.625` stage held `1.04 MP` (`8.35 MB` resting, `12.3 MB` peak across checks), `1` active WebGL context (`peak 2`), `0` lost contexts, `0` open snapshots, `0` unasked readbacks and `0` removed bytes at end. |
| Does the morph origin at `t = 0.25` track card #0 (top-left) vs card #3 (bottom-right)? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed on `readPixels()`: card #0 at `box0=(89,73)` sampled `(240,88,88)` and card #3 at `box3=(191,152)` sampled `(42,192,142)` while the opposite slot stayed dimmed. |
| Do `0% -> 100% -> 0%` SDF bounds and `stepMorphSpring()` (`tMs`) settle and respect `Slow 0.25x` and reduced motion? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed (`expand=35 frames / 583 ms`, `peak=1.029`, `collapse=35 frames`, `300 ms slow=0.38 < 1x=1.03`, `reduced=1 step`). On the live stage, `Slow 0.25x` mid-morph read `6%` at `420 ms` and collapsed cleanly to `0%` after clicking the darkened scrim. |
| Does `updateElementGeometry()` hit grid cards at `0%` and `#mc-detail` buttons and `<input>` at `100%`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`card3Hit=true`, `closeHit=true`, `inputHit=true`). Live CDP taps opened Card 2 (`Emerald Synth`), bumped `+1 Take (20)` (`★ 20` synced back on `#mc-grid`), edited and preserved Card 3's `#mc-note-input` (`Verified splice at 00:42`), and collapsed via both `Collapse` and `Escape`. |
| Do synthetic `webglcontextlost`/`webglcontextrestored` and 5-arg 2D `drawElementImage()` recover cleanly? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`lostOk=true`, `restoredOk=true`, `2dInk=61.6%`, `wrongDrawSize=0`). Live `?route=2d` passed `6/6` checks (`draws.wrong=0`, `draws.noSize=0`), and `--disable-blink-features=CanvasDrawElement` kept both subtrees usable in `#plain-host` at `scrollWidth=412`. |
| Does the visible stage remain drawn after checks finish (`stillDrawn`), with calm load (`CLS = 0`)? | measured (Chrome 160 Canary, 2026-11-27) | Check 6 passed (`100.0%`), load measured `cls=0`, `scrollX=0`, `scrollY=0`, `active=BODY`, `0` console/page errors, `scrollWidth=412`. |
| Real Android phone touch feel, `npm run check:jank` and `draw-size/audit.mjs` | not verified | Needs Chrome 159 on Android at `412 px` (`2.625` DPR) and a Playwright run of `npm run check:jank -- /morph-container/`. |

## Things that bit

- **Ghost text echoes during mid-morph blur**: sampling `uTex` and `uDetailTex` at LOD 0 with 9 taps left faint duplicate copies of card titles around `35%` morph. Calling `gl.generateMipmap(gl.TEXTURE_2D)` with `LINEAR_MIPMAP_LINEAR` after upload and using 16 golden-angle Gaussian `textureLod()` taps (peaking at `7.5 px`, returning to LOD 0 at endpoints) removed the echoes while keeping settled text crisp.
- **HUD bar overlapping lower card buttons on `412 px`**: placing `#mc-hud` inside `.mc-viewport` at `bottom: 8px` covered the bottom row's `Open` buttons and `#mc-note-input` at `412 px`. Moving `#mc-hud` into normal flow directly below `.mc-viewport` left all four cards and the note field unobstructed.
- **Deferred focus across the `inert` threshold**: calling `detailCloseBtn.focus()` immediately inside `openCard()` was ignored when `spring.value < 0.5` kept `#mc-detail` `inert`. Tracking `pendingFocusTarget` and applying `.focus({ preventScroll: true })` in `syncGeometry()` right after toggling `inert = false` kept keyboard focus transitions working across animated opens and collapses.
- **Residual 2D fixture memory after `retire()`**: leaving a `240×180` 2D fixture canvas sized until `onTick()` ran left `1.19 MB` reported in `window.__gfx.memory().removed` straight after checks finished; setting `cv2d.width = 0; cv2d.height = 0` before `remove()` dropped `removed` to `0`.

## Not verified

- Chrome 159 on Android (`412 px` wide, `2.625` DPR): touch tap responsiveness on the 4 cards, soft keyboard behaviour when focusing `#mc-note-input`, real GPU frame rate during spring overshoot and cross-blur, and `prefers-reduced-motion` `.motion-warn` banner mounting once `npm run build` generates `pages.js`.
- `npm run check:jank -- /morph-container/` and `node tools/draw-size/audit.mjs /morph-container/` (Playwright isn't installed in this environment).
- Headless Chromium 157 behaviour, `npm run build`, and `node tools/social/capture.mjs /morph-container/`.

## For the index

- Transitions, text and motion (`motion`): `/morph-container/` melts any of four live HTML grid cards (`#mc-grid`) into a full-stage detail sheet (`#mc-detail`) and back into its originating slot on one `ElementGL` WebGL 2 canvas using `sdRoundBox`, mipmapped Gaussian cross-blur UV scaling, `stepMorphSpring()` (`tMs`) and `updateElementGeometry()` (`1.04 MP`, `8.35 MB` at `412 px`, `6/6` checks in Chrome 160 Canary; Android not verified) (`texElementSubImage2D()`, `drawElementImage()`, `updateElementGeometry()`).
