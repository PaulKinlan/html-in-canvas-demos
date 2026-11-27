# Thumb-scrubbed page peel back navigation (`/edge-swipe/`)

Built on 2026-11-27. Syntax checked with `node --check public/edge-swipe/swipe.js`, graphics rules checked with `node tools/gfx/check.mjs`, and prose checked with `node tools/writing/check.mjs --strict /edge-swipe/`. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /edge-swipe/`, `node tools/draw-size/audit.mjs /edge-swipe/`, and Chrome 159 on Android at 412 px) are **not verified** yet.

The question: can I pair a safe inset gesture gutter with a GPU 3D cylinder page-peel shader over two live `drawable` app screens so scrubbing back reveals the underlying live page with parallax, shaded fold curl and mid-swipe spring cancellation?

## What was built

One `<canvas content="drawable" layoutsubtree>` inside a phone viewport (`width: min(368px, 100%)`, fixed `508 px` height / `488 px` below `620 px`, well under 4 MP at 2.625 DPR with no `dvh`) holding two live `drawable` app views:

- **Root Inbox screen (`#view-list`)**: live search `<input>`, unread filter toggle, five interactive `<button class="inbox-row">` threads and a live summary `<output>`.
- **Detail screen (`#view-detail`)**: layered on top with a 38 px left margin reserving a 28 px inset drag rail (`x <= 32`) inside the viewport padding, a `‹ Inbox` Back `<button>`, an editable note `<input>`, Read/Pin checkboxes and an Acknowledge counter `<button>`.

Rendering runs on a single WebGL 2 context created via `new ElementGL(canvas, ...)` from `/lib/element-gl.js` (`SWIPE_FRAG`), with a 2D 5-argument and 9-argument `drawElementImage()` fallback and plain-HTML extraction on unsupported browsers or context loss.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Do `#view-list` and `#view-detail` both upload through `ElementGL` `texElementSubImage2D()` with `gl.getError() === 0`? | not verified | Check 1 builds an isolated `ElementGL` fixture on `testStage()`, uploads both `drawable` children and checks `gl.getError() === gl.NO_ERROR`. |
| Does the inset gutter threshold (`x <= 32`) separate edge-swipe starts from central tap controls? | not verified | Check 2 verifies `isGutterStart(x, anyX)` across boundaries and confirms with `elementsFromPoint()` that `x = 16` hits the gutter while `Back` and `<input>` stay at `x >= 40`. |
| Does the 3D cylinder shader draw underside shadow, cream flap and `-24% -> 0%` parallax at `progress = 0.5`? | not verified | Check 3 renders at `progress = 0.5` and probes `readPixels()` across the parallaxed underlying split, cast shadow, cream underside and flat `#view-detail`. |
| Does `updateElementGeometry()` keep active screen controls clickable before and after navigating back? | not verified | Check 4 flips `inert`, `pointer-events` and `geometryUnit()`-scaled `updateElementGeometry()` with `dataset.hitTick` and verifies `elementsFromPoint()` on both views. |

## Things that bit

- Keeping the inset gutter out of Android OS back-navigation while keeping `x <= 32` intuitive: `<main>` and `.stage` already inset the phone viewport 28 px from the window edge, and `.view-detail` adds `padding-left: 38px` so the decorative gutter strip and `touch-action: none` capture zone sit over `x = 0..32` with every button and `<input>` cleanly clear of it.
- Preventing vertical page scroll from cancelling angled thumb swipes on Android: putting `touch-action: none` on `#swipe-gutter` (`width: 32px`, active only while `#view-detail` is settled on top) stops Chrome panning vertically during edge drags while leaving `touch-action: pan-y` on `<canvas>` so vertical scrolling still works across the rest of the screen.
- Avoiding redundant `texElementSubImage2D()` uploads while scrubbing: `onPaint(e)` inspects `e.changedElements` and only re-uploads whichever view repainted, so `requestAnimationFrame` drags and spring settles redraw `SWIPE_FRAG` directly against cached GPU textures.

## Not verified

- Headless Chromium 157: all five live checks, `npm run check:jank -- /edge-swipe/`, and `node tools/draw-size/audit.mjs /edge-swipe/` (confirm zero layout shift, zero timed readbacks, backing store under 4 MP, and real `readPixels()`/`elementsFromPoint()` outputs).
- Chrome 159 on Android at 412 px wide and 2.625 DPR: thumb-scrubbed edge drags from the 28 px inset gutter vs OS system back swipe, mid-swipe spring commit/cancel feel, on-screen keyboard inside the editable note `<input>` and `list-search`, and touch scrolling past the stage.
- Keyboard traversal and screen reader announcements across `#view-list` and `#view-detail` under `prefers-reduced-motion: reduce`.

## For the index

- Transitions, text and motion: `/edge-swipe/` pairs a 28 px inset gesture gutter with one `ElementGL` WebGL 2 cylindrical page-peel shader over two live `drawable` app screens (`-24%` to `0%` parallax, shaded cream underside, cast shadow, mid-swipe spring cancel/commit and `updateElementGeometry()` hit-box sync).
