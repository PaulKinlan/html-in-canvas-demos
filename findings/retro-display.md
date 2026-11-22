# Temporal display shaders: E-Ink, Playdate crank and Game Boy LCD (`/retro-display/`)

Not verified in a live browser as of 2026-11-22. None of the checks or visual modes have been run in headless Chromium 157 (C157) or on Chrome 159 for Android (A159) yet. Static checks (`npm run check:gfx` and `tools/writing/check.mjs`) passed on 2026-11-22.

Inspired by E-Ink Pearl and Carta partial-refresh panels, Panic's Playdate handheld (1-bit Sharp Memory LCD and physical rotary crank), Nintendo's Game Boy DMG-01 4-shade passive-matrix LCD, plus `/canvas-skin/` and `/time-scrubber/` on this site.

| Question | Result | Reason or detail |
|---|---|---|
| Can a WebGL 2 ping-pong feedback shader keep E-Ink partial-refresh ghosting across live DOM updates and clear it with a 220 ms black flash? | Not verified | Implemented with two RGBA8 ping-pong framebuffers allocated on `ElementGL`'s single WebGL 2 context (`stage.gl`). The green channel accumulates residual dark pigment when a dark DOM pixel clears to light; the 220 ms flash waveform inverts to black, clears to paper white and zeroes the ghost channel. |
| Can a canvas-rendered Playdate rotary crank drive `#rd-screen.scrollTop` while live controls inside the screen stay interactive? | Not verified | Implemented with an accessible `#crank-pad` slider overlaid on the right bezel (`touch-action: none`) using `setPointerCapture()`, wheel events and keyboard arrows to drive `#rd-screen.scrollTop`, while `canvas.updateElementGeometry()` and `screen.dataset.hitTick` keep hit boxes aligned to the recessed screen rectangle. |
| Can a 4-shade Game Boy DMG-01 passive-matrix LCD persistence trail run without keeping an idle animation loop alive? | Not verified | Implemented with an asymmetric temporal decay factor in the feedback pass and an 850 ms settling timer (`dmgSettleUntil`) that stops `requestAnimationFrame()` once trails finish fading out. |
| Does the page work with one WebGL 2 context and a 2D Bayer fallback? | Not verified | Uses one `ElementGL` context for both element texture uploads (`gl.texElementSubImage2D()`) and off-screen ping-pong framebuffers. If WebGL 2 is unavailable, a 2D fallback draws with 5-argument `drawElementImage()` and copies into a plain non-drawable `willReadFrequently: true` scratch canvas for ordered 4x4 Bayer dithering. |
| Does `webglcontextlost` preserve the live reader state? | Not verified | On `webglcontextlost`, `#rd-screen` moves out of `<canvas>` into `#rd-wrap` as plain HTML so typed notes, scroll position, checkboxes and counters stay intact until `webglcontextrestored` rebuilds the FBOs and moves `#rd-screen` back. |

## Things that bit

- `ElementGL` enables premultiplied alpha blending (`gl.enable(gl.BLEND)`) when building its context. Writing non-colour state channels (displayed luminance in `R`, accumulated E-Ink ghosting in `G`, previous live luminance in `B`) into the off-screen ping-pong FBO requires `gl.disable(gl.BLEND)` during Pass 1 and `gl.enable(gl.BLEND)` again before Pass 2.
- Putting `touch-action: none` on the whole `<canvas>` would interfere with native vertical touch scrolling inside `#rd-screen` on a phone. Placing `#crank-pad` as a sibling overlay restricted to the right-bezel crank bay isolates circular touch drags from screen scrolling and text selection.
- Mapping `aPos * 2.0 - 1.0` in the Pass 1 vertex shader keeps FBO row 0 aligned with `texElementSubImage2D()` row 0 (top of the DOM element), matching `ElementGL.rect()` in Pass 2 with no vertical flip.

## Not verified

- Running the 7 live checks in Chromium 157 (C157) and confirming exact readback pixel counts for E-Ink ghosting, full flash clearing, Playdate 1-bit Bayer stippling, Game Boy DMG trail decay and `updateElementGeometry()` hit testing.
- Real touch feel and frame pacing on Chrome 159 for Android (A159) at 412 px wide (device scale 2.625): dragging the Playdate rotary crank by thumb, typing with the on-screen keyboard inside `#rd-screen`, selecting text inside the recessed screen, and checking total GPU memory with `npm run check:jank -- /retro-display/`.
- Whether scrolling `#rd-screen` inside `<canvas content="drawable" layoutsubtree>` raises native `paint` events on every scroll step on A159, or relies on the page's `scroll` listener calling `canvas.requestPaint()`.
- Visual legibility of the 4x4 Bayer dithering and 4-shade DMG dot-matrix gaps at pixel scales from `1.0x` to `4.0x` on a HiDPI phone screen.
- The 2D ordered-Bayer fallback path when WebGL 2 is disabled, and real `webglcontextlost` / `webglcontextrestored` recovery under memory pressure on a phone.
- `prefers-reduced-motion: reduce` behaviour (instant ghost clear instead of the 220 ms black flash waveform, and suppressed continuous DMG settling).
- Screen reader announcements and keyboard navigation for `#crank-pad` (`role="slider"`) alongside controls inside `#rd-screen`.

## For the index

- Shaders and feedback: one `ElementGL` WebGL 2 context can host off-screen RGBA8 ping-pong framebuffers alongside `gl.texElementSubImage2D()` to add stateful E-Ink ghosting, full-refresh waveforms and passive-matrix LCD persistence to live interactive HTML (not verified yet).
- Hit testing and touch: pairing `canvas.updateElementGeometry()` on a scrollable drawable child with a sibling `touch-action: none` bezel overlay lets a canvas-rendered rotary crank scroll live HTML without blocking touch interaction inside the screen (not verified yet).
