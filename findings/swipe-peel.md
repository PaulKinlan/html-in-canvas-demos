# Elastic peel-away swipe list (`/swipe-peel/`)

Status on 2026-11-27: static checks passed (`node --check public/swipe-peel/peel.js`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs --strict /swipe-peel/`, and `node tools/social/validate.mjs /swipe-peel/`). Live browser runs on headless Chromium 157 (C157) and Chrome 159 on Android (A159) are not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context uploading six live `drawable` inbox rows via `texElementSubImage2D()` and rendering 28 by 10 Sticker Peel and Elastic Taffy meshes | not verified | Sticky viewport-sized canvas (`388 px` desktop, `368 px` below `520 px`) sits inside an `overflow-y: auto` track so GPU backing store stays near 1 MP at 412 px and 2.625 DPR regardless of list height. Covered by live check 1 on an isolated `testStage()` fixture. |
| Angle-locked touch arbitration (`|dx| > 8, |dx| > |dy| * 1.4` horizontal vs `|dy| > 8` vertical) alongside native `touch-action: pan-y` | not verified | Uses an 8 px deadzone so taps pass straight to Star and checkbox controls; horizontal lock engages `setPointerCapture()` plus a non-passive `touchmove` guard while diagonal 45-degree drags yield to vertical scroll. Covered by live check 2. |
| Commit peel/collapse and Undo texture lifecycle via `ElementGL.forget()` | not verified | Committed rows spring-collapse via 240 Hz sub-stepped symplectic springs (`prefers-reduced-motion: reduce` settles immediately), detach from DOM, and call `stage.forget(rowEl)` so `stage.has(rowEl)` becomes `false`. Undo re-inserts the preserved DOM element and re-uploads on the next `paint`. Covered by live check 3. |
| `updateElementGeometry()` scaled by `geometryUnit()` keeping Star and checkbox controls hit-testable across scroll and collapse | not verified | Applies `DOMMatrix().scale(unit, unit, 1).translate(drawX, drawY)` per visible row, marks offscreen or peeled rows `inert` offstage, and gates `dataset.hitTick` flips behind a quantized transform key. Covered by live check 4 via `document.elementsFromPoint()`. |
| 2D 5-argument `drawElementImage()` fallback and plain HTML context-loss fallback | not verified | Drops to explicit 5-argument `drawElementImage(row.el, 0, 0, rowW, ROW_H)` when WebGL `texElementSubImage2D()` is absent, and moves live rows into `#plain-list` with explicit Archive/Delete buttons on `webglcontextlost`, `contextlost`, or unsupported browsers. |

## Things that bit

- Drawing columns left-to-right across a right-side sticker peel paints the flat adhesive half over the curled underside flap because both overlap in X without depth testing. Keeping depth testing off (so anti-aliased rounded corners never write dirty depth values) and choosing a reversed-column index buffer (`meshRevVao`) for right swipes renders back-to-front in exact Painter's order for both directions.
- Growing a scrollable list's `<canvas>` to total content height pushes mobile GPU memory up as rows are added. Pairing a sticky viewport-tall `<canvas>` (`368 px` on 412 px phones) with an outer `overflow-y: auto` track keeps canvas memory near 1 MP while avoiding nested `drawable` clipping inside a `drawable` scroller.
- Starting a horizontal swipe over a row's Star button or checkbox can fire a synthetic `click` on pointer release. Deferring `setPointerCapture()` until horizontal lock crosses the 8 px deadzone and adding a short capture-phase `click` suppressor after horizontal lock stops accidental toggles while leaving short taps untouched.
- Fixed pixel heights (`368 px` mobile, `388 px` desktop) instead of `dvh` or `svh` prevent viewport URL-bar height changes from resizing the canvas backing store or shifting content below the stage.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /swipe-peel/` and `?autochecks=1`): verifying all four live checks, zero layout shift, GPU memory under 96 MB, canvas under 4 MP, and clean retirement of `testStage()` fixtures.
- Chrome 159 on Android (412 px wide, scale 2.625): touch arbitration between vertical `pan-y` list scrolling and horizontal 3D Sticker Peel / Elastic Taffy swipes, real `42%` threshold pop feel, tapping Star/checkbox controls after scroll or collapse, `"Swipe row #2 demo"`, `"Undo last"`, and `"Reset list"`.
- Context loss and restoration (`webglcontextlost` and `webglcontextrestored`) moving the live inbox rows between `<canvas>` and `#plain-list` without losing starred or checked state.

## For the index

- `texElementSubImage2D()`: a sticky viewport-sized `ElementGL` canvas inside an outer `overflow-y: auto` track renders a scrollable inbox of live `drawable` rows with a 28 by 10 3D Sticker Peel and Elastic Taffy mesh, using reversed column index order for back-to-front curl sorting and `stage.forget()` on commit (not verified, `/swipe-peel/`).
- Input and hit testing: angle-locked touch arbitration (`|dx| > 8 && |dx| > |dy| * 1.4` vs `|dy| > 8`) pairs native `touch-action: pan-y` scrolling with horizontal `setPointerCapture()` row peeling while `updateElementGeometry()` scaled by `geometryUnit()` keeps Star and checkbox controls hit-testable across collapse and Undo (not verified, `/swipe-peel/`).
