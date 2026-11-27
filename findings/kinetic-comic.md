# Kinetic comic halftone UI (`/kinetic-comic/`)

Built on 2026-11-27. Syntax checked with `node --check public/kinetic-comic/comic.js`, graphics rules checked with `node tools/gfx/check.mjs`, and prose checked with `node tools/writing/check.mjs --strict /kinetic-comic/`. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /kinetic-comic/`, and Chrome 159 on Android at 412 px) are **not verified** yet.

The question: can plain semantic `<nav>` and `<form>` HTML be turned on the GPU into rotated CMYK Ben-Day halftone print with cursor-lit dot radius, chromatic ink-outline offset, diagonal blade-wipe panel transitions and subtle hit-stop shake while remaining keyboard-accessible and responsive to `prefers-reduced-motion: reduce`?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context + `texElementSubImage2D()` CMYK Ben-Day halftone print (`C 15 deg`, `M 75 deg`, `Y 0 deg`, `K 45 deg`) over newsprint tooth | not verified | Fragment shader separates un-premultiplied DOM texels into four angled Ben-Day grids, keeps dense black key ink solid above 72% coverage for label readability, and shifts cyan/magenta edge samples for chromatic ink outlines. Live check 1 verifies `gl.getError() === 0` and halftone luma variation on an isolated fixture. |
| Outgoing GPU framebuffer capture + 35 ms hit-stop and diagonal jagged blade-wipe tab transition | not verified | On tab switch, `captureOutgoingFBO()` copies the outgoing panel texture into an off-screen RGBA8 framebuffer before swapping `inert` to the outgoing panel and enabling the incoming panel. Live check 2 probes mid-wipe pixel contrast and `inert` state on `testStage()`. |
| Slanted `updateElementGeometry()` scaled by `geometryUnit()` + `dataset.hitTick` cache clearing | not verified | `syncPanelGeometry()` multiplies `buildPanelMatrix()` by `geometryUnit()`, calls `updateElementGeometry()` on the active panel and sends the inactive panel `OFFSTAGE`. Live check 3 probes `document.elementsFromPoint()` on the transformed `<nav>` button and `<input>`. |
| `prefers-reduced-motion: reduce` and Reduced motion toggle suppressing hit-stop shake to `0 px` | not verified | `computeWipeMotion()` returns `shakeX = 0, shakeY = 0` and immediate `wipeProgress = 1` whenever reduced motion is active, and `learn.js` shows the site's reduced-motion banner via `meta[name="reduced-motion-note"]`. Live check 4 samples the impulse curve across 0 to 320 ms. |
| 2D 5-arg `drawElementImage()` fallback and plain-HTML context-loss rescue | not verified | Draws the tilted active panel with 5-argument `ctx2d.drawElementImage(activeEl, ...)` when WebGL 2 is absent, and moves both panels into `#plain-host` when HTML-in-canvas is missing or `onLost` fires. |

## Things that bit

- Shifting pure black text (`RGB = 0`) in standard CMYK leaves `C = M = 0` because under-colour removal moves dark ink entirely onto `K`. Adding the excess dark-ink edge difference (`max(0.0, kShifted - k0)`) into the cyan and magenta plates puts chromatic print misregistration outlines on dark headings and borders without blurring the centered `K` glyphs.
- Reading `ElementGL` texture handles for the outgoing FBO capture can't reach `#textures` because `#textures` is a private field in `/lib/element-gl.js`. Caching the `{ tex, w, h }` object returned by `stage.upload(el)` lets `captureOutgoingFBO()` bind the outgoing panel texture directly inside the same WebGL 2 context.
- Switching tabs inside a keyboard `<nav>` flow makes the clicked panel `inert` immediately. Moving focus to the matching `<nav>` button inside the incoming panel (`focus({ preventScroll: true })`) only inside trusted click transitions keeps `Tab` advancing into the incoming `<form>` instead of dropping focus back to `document.body`.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /kinetic-comic/` and live checks 1 to 5): confirm zero layout shift, zero timed readbacks, backing store under 4 MP at 412 px and DPR 2.625, and record exact measured hit-test coordinates and FBO wipe output.
- Chrome 159 on Android at 412 px wide by touch: tap `<nav>` tabs, type into the callout and callsign `<input>` controls, toggle radios and checkboxes, drag across the canvas for cursor-lit dot gain and verify `touch-action: pan-y` scrolls the page past the stage.
- Screen reader announcements and keyboard traversal across both panels under OS `prefers-reduced-motion: reduce`.

## For the index

- Transitions, text and motion: `/kinetic-comic/` turns semantic `<nav>` and `<form>` HTML on one `ElementGL` canvas into rotated CMYK Ben-Day halftone print with cursor-lit dot gain, chromatic ink edge offset, an FBO diagonal blade-wipe with 35 ms hit-stop shake (`0 px` under `prefers-reduced-motion: reduce`), and slanted `updateElementGeometry()` hit testing.
