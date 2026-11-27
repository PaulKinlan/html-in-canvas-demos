# Wooden mirror (`/wooden-mirror/`)

Built on 2026-11-27. Browser runtime checks (headless Chromium 157, `npm run check:jank -- /wooden-mirror/`, and Chrome 159 on Android at 412 px) are **not verified** yet.

The question: can I transform a live editable HTML form into Daniel Rozin's 1999 motorised Wooden Mirror sculpture, tilting 900 physically shaded 3D wooden louvers in real time on the GPU with zero CPU readback from `texElementSubImage2D()` luminance while keeping the controls clickable via `updateElementGeometry()`?

| Experiment | Status | Notes |
|---|---|---|
| Zero-readback GPU tile state integration on one `ElementGL` WebGL 2 context | not verified | Pass 1 renders a tiny `N×N` ping-pong `RGBA8` framebuffer (14 KB for both buffers at 42×42) that takes 4×4 stratified samples per cell from the mipmapped `texElementSubImage2D()` texture, applies contrast, sums up to four pointer ripple waves and damps each servo toward its target angle. Needs Chromium 157+ live check run to confirm `gl.getError() === 0` and `window.__gfx.reads.unasked === 0`. |
| Instanced 3D bevelled louvers (`gl.drawElementsInstanced`) and material presets | not verified | Pass 2 draws a 3D bevelled tile mesh (`20` vertices, `30` indices) across `20×20`, `30×30` and `42×42` grids, clipping corners to an octagonal aperture (840 active tiles at 30×30) and tilting tiles between -56° and +54° with procedural Oak & Pine, Brushed Brass and Trash Plastic shading. Needs live check 2 and 3 run to record bright-vs-dark luminance separation and material switching. |
| Aligned `updateElementGeometry()` hit testing with `geometryUnit()` and `dataset.hitTick` | not verified | Uses a centred perspective camera calibrated so `z = 0` maps `[-1, +1] × [-1, +1]` to `(x0, y0, side, side)` in CSS pixels, matching `#source-card` at `0%` to `100%` Peek opacity and switching `pointer-events: none` + `inert` in Wave tiles mode. Live check 4 probes `<input>` and `<button>` via `document.elementsFromPoint()`. |
| Tap-gated live webcam input (`getUserMedia`) and `pagehide` track cleanup | not verified | Requests the camera only when the visitor taps Live Webcam, uploads `<video>` frames with `gl.texImage2D()`, mirrors horizontally, centre-crops to square and stops all tracks on switch or `pagehide`. Needs real camera hardware to verify. |
| 5-argument 2D `drawElementImage()` fallback and plain-HTML rescue | not verified | Draws `#source-card` at `(x0, y0, side, side)` under `ctx.setTransform(dpr, ...)` with warm oak slat lines in 2D fallback, and moves `#source-card` to `#plain-host` when HTML-in-canvas is missing or `webglcontextlost` fires. Needs `--disable-blink-features=CanvasDrawElement` and context-loss verification. |

## Things that bit

- Sampling one texel per tile cell at `20×20` or `30×30` causes thin CSS button borders and narrow letter strokes inside `#source-card` to flicker or drop out. Generating mipmaps on the `texElementSubImage2D()` upload and taking a 4×4 stratified box average per cell inside the Pass 1 state shader keeps text strokes and button edges stable across all three grid densities without CPU readback.
- The octagonal chamfer (`|nx| + |ny| <= 1.60`) trims the four corners of the tile grid. A full-bleed `360×360` rectangular card would have its top input and bottom controls partially outside the octagon. Insetting the top headline band and bottom contrast band by `26 px` horizontally while letting the middle three-button row span the full width keeps every control inside active octagonal tiles.
- Separating `Click HTML` from `Wave tiles` matters on touch screens: keeping `#source-card` interactive at `0%` Peek lets you type and click straight through the wood, while `Wave tiles` sets `inert` and `pointer-events: none` on the card with `touch-action: none` on the canvas so finger drags paint ripples without opening the phone keyboard or scrolling the page.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /wooden-mirror/` and tap-gated live checks 1 to 5): confirm zero layout shift, zero unasked readbacks, backing store under 4 MP at 412 px and DPR 2.625, and record measured bright-vs-dark luminance delta and `elementsFromPoint()` results.
- Chrome 159 on Android at 412 px wide by touch: test typing into `WOOD`, tapping `Wave`, `Invert` and `+1`, dragging the `Tone` contrast slider, dragging waves in `Wave tiles` mode, switching materials (`Oak & Pine`, `Brushed Brass`, `Trash Plastic`) and densities (`20×20`, `30×30`, `42×42`), and verify smooth frame rates and zero lost contexts.
- Real camera hardware: tap `Live Webcam`, verify horizontal mirror flip, 1:1 centre crop, and track stop when switching back to `Live HTML Form` or leaving the page (`pagehide`).
- `--disable-blink-features=CanvasDrawElement` and `webglcontextlost` event dispatch: confirm plain-HTML fallback renders `#source-card` cleanly in `#plain-host`.

## For the index

- WebGL and 3D: `/wooden-mirror/` drives an instanced 3D bevelled tile sculpture (Oak & Pine, Brushed Brass, Trash Plastic) directly from a live HTML form via `texElementSubImage2D()` and an `N×N` GPU ping-pong state framebuffer with zero CPU readback, keeping the hidden or peeked form clickable through `updateElementGeometry()`.
