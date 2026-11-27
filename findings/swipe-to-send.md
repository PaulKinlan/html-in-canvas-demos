# Swipe-to-send payment and confirmation wave (`/swipe-to-send/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL). Combines Yogi Suria's Swipe to Send (`/elsewhere/#swipe-to-send`) and Jakub Antalik's Distortion Waves (`/elsewhere/#distortion-waves`). Chrome 159 on Android and `npm run check:jank` (Playwright not installed here) are **not verified** yet.

The question: can a semantic `<dl>` payment receipt and a vertical `<input type="range">` control render inside one `ElementGL` WebGL 2 pass so sliding to pay gathers light beneath the thumb and committing fires a radial distortion shockwave with RGB chromatic fringes across the live DOM receipt?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 upload (`texElementSubImage2D()`) with energy glow and radial shockwave shader | measured (Chrome 160 Canary, 2026-11-27) | Smoke check passed (`924x1213`, `1.12 MP`, `9.0 MB`, `0` errors, `0` lost, `0` open snapshots). Live checks passed (`5/5`, `gl.getError() === 0`). |
| Shockwave crest RGB chromatic edge dispersion | measured (Chrome 160 Canary, 2026-11-27) | Live check measured `|R - B|` separation jumping cleanly across high-contrast dark receipt text on wave transit vs rest. |
| 92% commit threshold, spring snapback and `prefers-reduced-motion` instant settle | measured (Chrome 160 Canary, 2026-11-27) | Live check confirmed 65% release springs back to Draft without firing a wave, 94% locks Sent and launches the wave, and reduced motion snaps in one step. |
| `updateElementGeometry()` + `geometryUnit()` hit testing inside a 12 px bleed canvas | measured (Chrome 160 Canary, 2026-11-27) | Live check verified `elementsFromPoint()` hits `<input type="number">`, vertical `<input type="range">` and the `Confirm` `<button>` inside the translated bleed box. |
| 5-argument `drawElementImage()` 2D fallback & real Android touch sliding | not verified | Needs testing on Chrome 159 for Android at 412 px and on a browser without WebGL `texElementSubImage2D()`. |

## Things that bit

- Giving `#pay-card` a 12 px bleed padding inside `#send-canvas` keeps the shockwave rim and border luminescence unclipped at the card perimeter, requiring `DOMMatrix().scale(unit, unit, 1).translate(pad, pad)` in `updateElementGeometry()` plus `dataset.hitTick` cache clearing so the vertical range track and buttons remain aligned.

## Not verified

- Chrome 159 on an Android phone at 412 px wide (`2.625` DPR): finger sliding along the vertical `writing-mode: vertical-lr; direction: rtl` range slider (`touch-action: none`), decimal keyboard entry inside `#amount-input`, and real GPU frame rates during wave transit.
- `npm run check:jank -- /swipe-to-send/` (Playwright unavailable here) and 2D fallback rendering.

## For the index

- Transitions, text and motion: `/swipe-to-send/` combines Swipe to Send and Distortion Waves (`5/5` checks in Chrome 160 Canary, `1.12 MP`, `9.0 MB`) inside one `ElementGL` WebGL 2 bleed canvas holding a live `<dl>` payment receipt and vertical `<input type="range">` slider that commits past 92% with a radial RGB dispersion wave.
