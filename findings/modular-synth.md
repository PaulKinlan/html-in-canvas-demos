# Eurorack modular synth with dangling patch cables (`/modular-synth/`)

Built on 2026-11-22. Static graphics and writing checks passed; live browser checks in Chromium 157 headless (C157) and Chrome 159 on Android (A159) are not verified yet.

Prior work credited: hardware Eurorack modular synthesisers, VCV Rack's dangling patch cables, and `/instruments/` plus `/cassette/` on this site (which showed that real HTML form controls can be drawn inside a canvas as tactile audio hardware).

| Experiment | Result | Notes |
| --- | --- | --- |
| Three drawable `<fieldset>` synth modules (`VCO-1`, `LFO-1`, `VCF / MIX`) drawn in one 2D canvas with five-argument `drawElementImage()` | not verified | Check 1 paints three isolated `<fieldset drawable>` modules on `testStage()` and verifies pixel coverage via a plain 2D copy canvas. |
| Verlet-simulated patch cables with cast shadows painted after `drawElementImage()` | not verified | Check 2 verifies orange cable strokes composite over blue module pixels via a plain 2D copy canvas. |
| Form controls (`<input type="range">`, `<select>`, `<button>`) hit-tested behind painted cables | not verified | Check 3 paints opaque cables directly over a range slider and button and asserts `document.elementFromPoint()` still returns the HTML controls. |
| Slider mutation inside a drawn `<fieldset>` updates the canvas picture | not verified | Check 4 changes a fixture range input from 10 to 95 and counts changed pixels via a plain 2D copy. |
| Jack rewiring and 12-node Verlet rope sag | not verified (browser) | Check 5 exercises `createPatchEngine()` directly: normalising reversed jack order, checking midpoint sag after 20 Verlet steps, and unplugging a cable. |
| Live canvas survives fixture checks (`stillDrawn()`) | not verified | Check 6 inspects `#rack-canvas` through a plain `drawImage()` copy and falls back to plain HTML if blank. |
| Web Audio patch routing (`AudioContext`, `OscillatorNode`, `BiquadFilterNode`, `AnalyserNode`) | not verified | Starts only on user tap of the Power button inside `VCF / MIX`. Muted preview math drives the oscilloscope on initial load. |
| Responsive two-row phone skiff (412 px wide at 2.625 scale) | not verified | Backing store caps below 4 megapixels (`590 CSS px` tall on mobile, about 1.68 megapixels at 2.625 DPR). |

## Things that bit

- Keeping hit-testing accurate across both desktop (one row) and narrow mobile (two rows) meant sizing each `<fieldset class="rack-mod">` to the exact CSS width and height of its slot before calling five-argument `drawElementImage(mod, s.x, s.y, s.w, s.h)`.
- Reading jack coordinates and the oscilloscope window via `offsetLeft` and `offsetTop` relative to each `<fieldset>` avoids mixing scroll-dependent viewport coordinates into canvas-space cable endpoints.
- Touch drag on a 3.5 mm jack button needs `touch-action: none` on `.jack` so dragging a patch cable doesn't pan the page, while keeping `touch-action: pan-y` on the canvas so normal vertical scrolling still works outside the jacks.
- All pixel readbacks in the live checks copy through a plain temporary `<canvas>` (`willReadFrequently: true`) and call `window.__gfx?.retire(copy)` instead of reading directly from a drawable canvas, following the Chrome 159 Android context-loss findings in `docs/graphics-rules.md`.

## Not verified

- Running the six live checks in Chromium 157 headless (`C157`) and running `npm run check:jank -- /modular-synth/` (run both after `npm run build` in a browser-enabled pass).
- Touch drag patching and two-tap patching on Chrome 159 on Android (`A159`) at 412 px wide, including whether dragging a jack conflicts with page scrolling.
- Native `<select>` dropdown popup anchoring when opened from inside a drawn `<fieldset>` on desktop and Android.
- Real-time Web Audio output, filter cutoff CV modulation and `AnalyserNode` oscilloscope frames after pressing Power on real hardware.
- `contextlost` and `contextrestored` fallback switching on Android under GPU memory pressure.

## For the index

- Drawing: canvas paths (dangling Verlet patch cables and cast shadows) painted after `drawElementImage()` visually overlay HTML `<fieldset>` form controls without blocking hit tests. not verified, `/modular-synth/`.
- Media: Web Audio oscillator, LFO and low-pass filter controlled by drawable HTML form panels with an `AnalyserNode` oscilloscope drawn over a recessed slot. not verified, `/modular-synth/`.
