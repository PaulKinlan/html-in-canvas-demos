# Directional whip-pan motion-blur cut (`/whip-pan/`)

Measured on 2026-11-27 in `HeadlessChrome/160.0.0.0` (Chrome Canary `160.0.8188.0` with `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement`, plus `--disable-blink-features=CanvasDrawElement`, `?route=2d`, `?route=plain` and emulated `prefers-reduced-motion: reduce`) at `412x915` (DPR `2.625`, touch emulation) and `960x800` desktop (DPR `2`). Headless Chromium 157 (`npm run check:jank`, Playwright not installed here) and Chrome 159 on Android (A159) are **not verified**.

| Question or check | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context uploads `#wp-scene-a` and `#wp-scene-b` via `texElementSubImage2D()` with `gl.getError() === 0` | measured (Chrome 160, 2026-11-27) | `1` WebGL context on load (`peak: 2` across tap checks), `945x893` backing store at `412 px` (`0.844 MP`, `6.75 MB` initial, `12.18 MB` peak), `0` console errors. Live check 1 passed: `fixA 630x473, fixB 630x473, glErr=0, centre rgba(251,247,238,255)`. |
| Bell-curve velocity peaks at `50%` with 16-tap directional smear and damped overshoot spring vs sharp `0%` rest | measured (Chrome 160, 2026-11-27) | Live check 2 passed: `rest=255, mid50% trail lum=177` (`185` on desktop), `peakOver=1.026`, `bell(0.5)=1.00`. |
| Reversing whip direction swaps directional smear axis cleanly (`Left` vs `Up`) | measured (Chrome 160, 2026-11-27) | Live check 3 passed: `Left(H=97 vs V=12), Up(V=84 vs H=12)` on mobile (`Left H=98 vs V=12, Up V=85 vs H=12` on desktop). |
| `updateElementGeometry()` + `geometryUnit()` + `data-hit-tick` route live clicks and typing to View A (`0%`) and View B (`100%`) | measured (Chrome 160, 2026-11-27) | Live check 4 passed: `0% hit btnA (1 click); 100% hit btnB (1 click) + inpB`. Real CDP interactions hit `Take #1` (`Take #2`), `#wp-title-a` (`STUDIO REEL · OPENING EDITED`), `Whip to B ->`, `Marker #1` (`Marker #2`), `#wp-title-b` (`TIMELINE SEQ 04 · WHIP LIVE`), and touch swipe returned to `0%`. |
| Synthetic `webglcontextlost`/`webglcontextrestored`, 5-argument 2D fallback (`?route=2d`), `?route=plain` and disabled API | measured (Chrome 160, 2026-11-27) | Live check 5 passed: `loss->plain->restored OK; 5-arg 2D fallback ink=100%`. `?route=2d` reported `wrongDraws=0, noSizeDraws=0`; `?route=plain` and `--disable-blink-features=CanvasDrawElement` placed both scenes in `#plain-host` (`inert=false`, `scrollWidth=412`). |
| Stage holds a valid picture after all fixtures retire | measured (Chrome 160, 2026-11-27) | Live check 6 (`stillDrawn()`) passed: `100.0%` drawn, `openSnapshots: 0`, `unaskedReads: 0`, `wrongDraws: 0`. |
| Reduced motion (`prefers-reduced-motion: reduce`) pauses idle loop and snaps cuts | measured (Chrome 160, 2026-11-27) | `#ctl-reduced` starts checked, `Auto preview` `aria-pressed="false"`, clicking `Up` jumped directly to `100%` (`View B settled`, `vel 0%`). |
| Accessibility self-audit (`public/lib/a11y-audit.js`) at `960x800` desktop | measured (Chrome 160, 2026-11-27) | With tab focus emulation enabled: `9` pass (`calm`, `blank`, `dom`, `hit`, `ghost`, `focus` 6/6, `names` 6/6, `sharp`, `motion`), `0` fail, `1` warn (`zoom` 150% CSS zoom scaling in `ElementGL`), `1` info (`find`). |
| Real Android GPU frame rate, touch swipe feel, soft keyboard and phone memory pressure | not verified | Needs a live run on Chrome 159 for Android (`412 px`, touch, DPR `2.625`). |

## Things that bit

- **Calling `stopShowcase()` before reading `ctlScrub.value`:** invoking `stopShowcase()` at the top of the `Scrub` `input` handler called `syncControlsUI()`, which overwrote `ctlScrub.value` from the previous `state.progress` before reading the slider's new value. Reading and applying `ctlScrub.value` before calling `stopShowcase()` fixed scrubbing immediately.
- **Discrete 16-step comb echoes on 1 px text at high blur spans:** uniform 16-tap sampling across `42..64 px` produced visible step echoes on crisp UI glyphs and thin timeline borders. Adding screen-space interleaved gradient noise (`fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5`) to the sample phase turned the comb into a smooth streak with the same 16 taps.
- **Keeping `glPeak <= 2` across multiple WebGL fixture checks:** running three `ElementGL` live checks back-to-back in under `200 ms` overlapped before `context-guard.js`'s `500 ms` retirement sweep freed earlier contexts (`peak = 4`). Waiting briefly for `window.__gfx.active() <= 1` between WebGL fixtures kept peak WebGL contexts at `2`.
- **Headless unfocused tab `el.focus()` behaviour:** when `document.hasFocus()` is `false` in headless Chrome, `el.focus()` moves `document.activeElement` without firing `focusin` or `focus` events, so `a11y-audit` saw the idle timer still armed unless tab focus emulation (`Emulation.setFocusEmulationEnabled`) was active. Adding a `document.activeElement` check inside `scheduleShowcaseStep()` plus a capture-phase `focus` listener stops the idle sweep cleanly when focus enters either scene.

## Not verified

- `npm run check:jank -- /whip-pan/` and `node tools/draw-size/audit.mjs /whip-pan/` (Playwright is not installed in this environment): confirming layout stability across viewport height changes and zero timed readbacks under 4x CPU throttle.
- Chrome 159 on Android (`412 px` wide, DPR `2.625`, touch): touch swipe responsiveness across `#wp-canvas`, real GPU frame rate during 16-tap directional blur + RGB fringe, soft-keyboard behaviour on `#wp-title-a` and `#wp-title-b`, and memory stability.
- `public/whip-pan/social.jpg` capture via `node tools/social/capture.mjs /whip-pan/`.

## For the index

- Transitions, text and motion: `/whip-pan/` composites two high-contrast live HTML scenes (`#wp-scene-a` warm Studio Storyboard and `#wp-scene-b` dark indigo Timeline Sequence) on one `ElementGL` WebGL 2 canvas with a 16-tap IGN-dithered directional velocity blur, RGB velocity fringe, bell-curve velocity peaking at `50%` and a damped overshoot spring across `Left`, `Right`, `Up`, `Down`, swipe gestures and `0..100%` scrub while keeping settled buttons and title inputs clickable via `updateElementGeometry()` (`6/6` live checks pass in Chrome 160 headless; Android phone and `check:jank` not verified).
