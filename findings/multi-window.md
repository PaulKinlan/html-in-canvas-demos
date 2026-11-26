# Multi-window canvas world (`/multi-window/`)

Built on 2026-11-26. Static checks (`node --check public/multi-window/world.js`, `node tools/gfx/check.mjs`, `node tools/writing/check.mjs /multi-window/`) pass. Live browser execution in headless Chromium 157 (C157), desktop multi-monitor Chrome and Chrome 159 on Android (A159) is not verified yet; every runtime claim below is marked with its status and what verifies it.

The question: can a single live HTML card straddle the bezel between two separate Chrome windows positioned in screen coordinates (via `window.screenX/Y` and `window.getScreenDetails()`), stay interactive on whichever side owns authority, and clip cleanly at the canvas edge?

How it is built: a shared world-coordinate 2D canvas projection that runs in two modes. By default on load (and on a 412 px phone), split-bezel mode places two side-by-side drawable canvases (`#canvas-a` and `#canvas-b`) separated by an adjustable bezel gap (0 to 64 px). Multi-window mode opens `/multi-window/?role=wing` on button click and aligns both windows in desktop screen coordinates over `BroadcastChannel('hic-multi-window')`. Each pane subtracts its world origin from the card's world position and draws its `<form class="world-card" drawable>` with 5-argument `ctx.drawElementImage(card, localX, localY, cardW, cardH)`, including negative and overflow coordinates. Whichever pane holds more than 50% of the card's area owns live input while the peer holds an `inert` mirror.

| Experiment | Status | Result | Why |
|---|---|---|---|
| `window.getScreenDetails()` availability | not verified | Check runs feature detection only on tap; permission is requested only when pressing "Read screen topology". | Needs a live browser run (desktop Chrome with Window Management permission and Android Chrome without it). |
| `BroadcastChannel` loopback and clean close | not verified | Check sends a world packet between two channels and closes both in `finally` with guarded `postMessage`. | Needs a live browser run to record latency and confirm no `Channel is closed` errors. |
| Negative-offset `drawElementImage(el, -w/2, y, w, h)` | not verified | Fixture draws a 120×60 red/blue split box at `x = -60` and checks the `drawImage()` copy for blue pixels at `x = 16` and transparent pixels at `x = 90`. | Needs C157 / Canary 160 run (click "Run these 4 checks" on `/multi-window/`). |
| Authority handoff at 50% midpoint | not verified | Check verifies overlap fractions flip from Peer A (>50%) to Peer B (>50%) and input value, slider and `inert` state transfer over `BroadcastChannel`. | Needs a live browser run; single-document `moveBefore()` reparenting between two drawable canvases also needs live verification. |
| Two-window desktop alignment across real OS bezels | not verified | Uses `window.screenX/Y`, estimated chrome thickness (`outerHeight - innerHeight`), `getBoundingClientRect()`, and `requestAnimationFrame()` polling while visible. | Cannot be verified in headless Chromium; needs two real windows dragged side by side on desktop. |
| Static graphics and writing checks (2026-11-26) | measured | `node --check`, `node tools/gfx/check.mjs` (0 problems), `node tools/writing/check.mjs /multi-window/` (0 errors). | Run locally against `public/multi-window/`. |

## Things that bit

- Pointer capture breaks if you capture on a child inside the card and then reparent that card with `moveBefore()` at the 50% seam. Capturing on the stationary `#stage-wrap` container keeps drags uninterrupted across the bezel and across authority handoffs, while ignoring `pointerdown` targets inside `input, button, select, textarea, a, label` so form controls still work natively.
- `window.screenX` and `window.screenY` have no DOM move event, so multi-window mode polls window geometry in `requestAnimationFrame()` only while multi-window mode is active, the stage is visible (`IntersectionObserver`) and `!document.hidden`. Split-bezel mode runs no idle loop at all.
- Calling `BroadcastChannel.postMessage()` after a channel closes throws `BroadcastChannel: Channel is closed` (seen in live reports on `/support/`). Every broadcast goes through `safePost()`, and `pagehide` sends `bye` before setting `channelOpen = false` and closing the channel.
- Reading edge-clipping pixels directly from a drawable canvas on Android Chrome 159 loses all 2D canvases after repeated reads. Both the tap-triggered "Sample edge pixels" probe and the negative-offset live check copy the drawable canvas via `drawImage()` into a plain `willReadFrequently: true` 2D canvas, read from the copy, and immediately zero and retire the copy via `window.__gfx?.retire(copy)`.

## Not verified

- Negative-offset and right-overflow `drawElementImage()` clipping and sub-pixel rendering in C157, Canary 160 and A159. Run the page's four live checks and press "Clip left (-50%)" followed by "Sample edge pixels".
- `canvas.moveBefore(liveCard, null)` reparenting a painted `drawable` child between two `<canvas content="drawable">` elements without losing focus, caret selection or triggering a paint glitch. Drag a focused `<input>` across the bezel in split-bezel mode with "Reparent with `moveBefore()`" enabled, then compare with it unchecked.
- Real two-window alignment and vertical chrome offset (`outerHeight - innerHeight`) when Window A is a normal browser tab and Window B is a popup window (`?role=wing`), both on one monitor and across two monitors with different device pixel ratios via `window.getScreenDetails()`.
- Touch dragging across the split bezel, canvas memory and stability on Chrome 159 on Android at 412 px wide (`npm run check:jank -- /multi-window/`).

## For the index

- Clipping: 5-argument `drawElementImage(el, -w/2, y, w, h)` negative-offset and overflow edge clipping probe. Not verified yet, `/multi-window/`.
- Windows: multi-window world coordinates (`window.screenX/Y`, `getScreenDetails()`) and 50% live DOM authority handoff over `BroadcastChannel` (and `moveBefore()` in single-document split-bezel mode). Not verified yet, `/multi-window/`.

## Open ideas

- Compensate for differing device pixel ratios between two monitors when `window.getScreenDetails()` reports mixed-DPI displays.
- Support dragging a card vertically across stacked windows as well as horizontally across side-by-side windows.
- Add a WebGL 2 or WebGPU refraction/perspective strip along the bezel seam behind the 2D route.
