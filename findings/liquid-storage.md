# Liquid storage meters and draining digits (`/liquid-storage/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL): `6/6` live checks pass, `924x1412` (`1.30 MP`, `10 MB`), `0` errors, `0` lost contexts, `.motion-warn` verified. Chrome 159 on Android and `npm run check:jank` (Playwright not installed here) are **not verified** yet.

The question: can semantic HTML `<meter>` storage bars and large live `<output>` quota numerals serve directly as fluid-filled glass vessels in a single WebGL 2 fragment shader so sloshing coloured liquids fill, layer, meniscus-ripple, and drain in real time when cache is cleared or quota sliders move while keeping every native control live?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context + `texElementSubImage2D()` DOM luminance vessel masking | measured (Chrome 160 Canary, 2026-11-27) | Live check 1 passed in `STORAGE_FRAG` (`1.30 MP`, `10 MB` on stage). |
| Multi-band tank + `<output>` numeral mask + `<meter>` tube fill transition (80% vs 15% drained) | measured (Chrome 160 Canary, 2026-11-27) | Live check 2 passed comparing pixel bands at 80% vs 15%. |
| Damped slosh wave settling + `prefers-reduced-motion: reduce` instant snap | measured (Chrome 160 Canary, 2026-11-27) | Live check 3 passed in `createFluidPhysics()`. |
| `updateElementGeometry()` scaled by `geometryUnit()` on `"Clear cache"` button and `<input type="range">` | measured (Chrome 160 Canary, 2026-11-27) | Live check 4 passed (`elementsFromPoint()` landed cleanly). |
| `webglcontextlost` / `webglcontextrestored` fallback and recovery + `stillDrawn()` | measured (Chrome 160 Canary, 2026-11-27) | Live checks 5 and 6 passed (`6/6` total). |

## Things that bit

- Keeping `#quota-digits` on a tight `0.80` line-height and normalizing `hNorm` inside `(0.06..0.94)` ensures drained states near `15%` fill the lower strokes of the numerals instead of hiding under line-box padding.
- Using `#768fb8` capacity tick labels inside the `#eff6ff` `#tank-mask` keeps both above the `0.28` luminance mask threshold while maintaining contrast (`0.55` vs `0.96`) for chromatic RGB refraction inside the liquid.

## Not verified

- Chrome 160 Canary headless and Chrome 159 on Android at 412 px wide (`2.625` DPR).
- Five-argument `drawElementImage()` 2D fallback rendering when WebGL 2 `texElementSubImage2D()` is absent.
- `npm run check:jank -- /liquid-storage/` (Playwright not installed in this environment).

## For the index

- Custom form controls and pickers: `/liquid-storage/` combines Alim Joldaspayev's Liquid Storage and Noman Ijaz's Usage Limit Drain in one `ElementGL` WebGL 2 canvas where semantic `<meter>` tracks, an etched vertical tank and a bold `<output>` quota readout act as luminance-masked sloshing glass vessels while keeping buttons and `<input type="range">` clickable via `updateElementGeometry()`.
