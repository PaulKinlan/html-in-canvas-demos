# Pull-to-refresh and stretch overscroll (`/pull-stretch/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL, emulated touch and mouse wheel). Chrome 159 on Android and `npm run check:jank` (requires Playwright) are **not verified** yet.

The question: can I recreate Android 12+ non-uniform stretch overscroll and a gooey liquid-metaball pull-to-refresh droplet inside a single WebGL 2 canvas holding a live scrollable HTML feed, keeping interactive items clickable and `overscroll-behavior-y: contain` intact?

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context + `texElementSubImage2D()` non-uniform UV stretch | measured (Chrome 160 Canary, 2026-11-27) | Live check 1 passed (`gl.getError()=0`, uploaded `473x420`, rest vs 90 px stretched pixel delta `34.3/px`). Canvas stays at 1.3 MP (`927x1361`) and 10 MB live (peak 14 MB, 3 WebGL contexts during checks, 1 alive and 0 MB removed after `context-guard` tick). |
| Non-uniform `y - A * y * (1 - y) * exp(-k * y)` curve vs uniform `scaleY` | measured (Chrome 160 Canary, 2026-11-27) | Live check 3 passed: at +96 px pull, strain at `y = 0.02` is `+77.8%`, `y = 0.45` is `-7.9%` and `y = 0.98` is `-2.3%`, compared with `+33.6%` uniformly everywhere in CSS-like scale mode. |
| Analytic 2D metaball droplet (`r1/d1 + r2/d2`) pull-to-refresh cycle | measured (Chrome 160 Canary, 2026-11-27) | Live check 2 passed (`peak=93.2 px >= 78`, prepends `"Refreshed #1"`, settles to `-0.0080 px`). Emulated touch drag in Chrome 160 pulled `66.6 px` without scrolling the outer page (`outerScrollY` held at `581.3 px`), snapped cleanly past `78 px` and prepended `"Refresh #1: Metaball neck pinch telemetry"`. |
| Scrollable `drawable` feed (`overscroll-behavior-y: contain`) + `updateElementGeometry()` hit testing | measured (Chrome 160 Canary, 2026-11-27) | Live check 4 passed at `scrollTop = 40 px` (`elementsFromPoint()` hit `<button>` with `geometryUnit=1.000`). Mouse wheel inside the feed scrolled `feedScrollTop` to `220.2 px` while keeping `outerScrollY` stationary, and a real mouse click at `(97, 157)` incremented `+1 Like (0)` to `+1 Like (1)`. |
| Plain HTML fallback (`--disable-blink-features=CanvasDrawElement`) | measured (Chrome 160 Canary, 2026-11-27) | Stage added `.plain`, moved `#feed-scroll` into `#plain-host`, showed the notice and kept `"Trigger pull refresh"` working (`9` items, 0 console errors). |
| 2D 5-argument `drawElementImage()` strip fallback and `webglcontextlost` recovery | not verified | Implemented in `draw2DFallback()` and `ElementGL` `onLost` / `onRestored`, syntax-checked and gfx-checked, not exercised in a browser lacking WebGL 2 or under real GPU loss. |

## Things that bit

- Calling `stage.upload(feedEl)` before `stage.begin()` on frame 1 left `<canvas>` at its default `300x150` intrinsic size when `getElementImageDefaultSize()` ran, so the first upload was `300x150` instead of `473x420` (on the fixture) or `927x1361` (on the phone stage). Calling `stage.begin()` before `stage.upload()` sizes the backing store first.
- Leaving `neckScale = 1.0 - 0.78 * uSnap` after the metaball snapped left a small `1.8 px` dark bead anchored below the sticky header in `armed` screenshots. Driving `neckScale` down to `0.0` at `uSnap = 1.0` removes the residual bead cleanly.
- Setting `.phone-viewport` background to `#1b2232` left faint 1 px dark slivers at the bottom rounded corners outside `#feed-scroll`. Switching `.phone-viewport` background to `var(--bg)` matched the card bottom while keeping `#1b2232` on `.feed-topbar` to match the metaball shader colour.

## Not verified

- Chrome 159 on an Android phone at 412 px wide: real finger momentum handoff at `scrollTop === 0` and `scrollTop === maxScroll`, on-device WebGL frame rate during metaball spring return, and touch target feel on filter chips and `+1 Like` buttons.
- `npm run check:jank -- /pull-stretch/`: automated CLS, focus-move and viewport-height resize verification via Playwright (Playwright is not installed in this environment).
- The 2D 5-argument `drawElementImage()` strip fallback when `drawElementImage()` is present without `texElementSubImage2D()`, and real GPU `webglcontextlost` restoration on mobile hardware.

## For the index

- Transitions, text and motion: `/pull-stretch/` holds a single scrollable `drawable` HTML feed inside one `ElementGL` WebGL 2 canvas, recreates Android 12+ non-uniform UV stretch overscroll (`+77.8%` near `y = 0`, `-2.3%` near `y = 1` at 96 px pull in Chrome 160 Canary) with a `1/d1 + 1/d2` metaball pull-to-refresh droplet, preserves `overscroll-behavior-y: contain` and keeps scrolled feed buttons clickable via `updateElementGeometry()` scaled by `geometryUnit()`.
