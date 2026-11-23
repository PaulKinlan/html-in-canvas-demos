# Split live HTML across Blue and Orange portals (`/portal-split/`)

Built on 2026-11-22. Live browser behaviour is not verified in Chromium 157 (C157) or Chrome on Android (A159) yet; static checks (`check:gfx` and `check:writing`) passed locally, and the page ships six isolated live checks to measure each behaviour in your browser.

This experiment takes its Blue and Orange portal mechanic and momentum conservation rule ("speedy thing goes in, speedy thing comes out") from Valve's *Portal* (2007), and builds on `/portal/` (`<dom-portal>`, double-drawing one element with pointer-tracked hit boxes) and `/dom-pinball/` (live HTML form controls inside a 2D canvas physics loop).

The question: can one live interactive HTML element pass halfway through a Blue portal and emerge simultaneously out of an angled Orange portal on a 2D canvas with momentum preserved and working controls on both halves?

| Experiment | Result | Why |
|---|---|---|
| Simultaneous split-clip drawing of one `drawable` HTML card across Blue and Orange portals | not verified | One element is drawn twice per frame with five-argument `drawElementImage()` under complementary half-plane `ctx.clip()` paths (`dot(p - portal, normal) >= 0`). Live check 1 verifies one DOM node paints its right half at Blue and its left half at Orange in the same frame via a plain `drawImage()` copy canvas. |
| Angled exit orientation via rigid portal transform `exitNormal - entryNormal + PI` | not verified | Entering a floor portal (`-PI/2`) and exiting a left-wall portal (`0`) rotates the emerging half by `-90` degrees; optional `Exit scale` (`0.6x` to `1.4x`) scales the exit transform around the exit portal. Live check 2 verifies rotated stripe pixels on a plain copy canvas. |
| Single-hit-box routing across two split halves using draw order | not verified | An HTML-in-canvas element has one hit-test region; on a 2D canvas the last `drawElementImage()` call wins it. Tracking `pointermove` and `pointerdown` to draw the half nearest the pointer second and toggling `data-hit-tick` routes clicks and typing to either half. Live check 3 verifies `elementFromPoint()` flips between halves when draw order reverses. |
| Momentum conservation across angled portals and live DOM physics controls | not verified | Crossing a portal rotates `(vx, vy)` by `exitNormal - entryNormal + PI` while keeping speed unchanged unless `Preserve momentum` inside the live card is unticked (damping to `35%`). Changing `<select>` `Cube mode` on Tile 02 updates its restitution and gravity scale. Live check 4 verifies velocity rotation and speed conservation across opposite, 90-degree and floor-to-floor pairs. |
| Live DOM mutations inside a split element repainting both halves | not verified | Adding a class or mutating form state inside the one DOM node should raise `paint` without `requestPaint()` and update both clipped halves. Live check 5 verifies both entry and exit pixels change after a class mutation. |
| Sightline previews, reduced motion, off-screen pause and `contextlost` fallback | not verified | Portal sightlines draw before the cards so preview draws never claim an element's hit box. The canvas stays under 4 MP at DPR 2.625, pauses off screen (`IntersectionObserver`), stops portal swirl under `prefers-reduced-motion: reduce`, and moves both cards to plain HTML on `contextlost`. Live check 6 runs `stillDrawn()` via a plain `drawImage()` copy. |

## Things that bit

- **Single hit box for one element.** Drawing one element twice in the same 2D paint pass paints pixels in both places, but only the last `drawElementImage()` call sets the hit box. Drawing the pointer-side half second and toggling `data-hit-tick` clears Chromium's hit-test cache and lets you interact with controls sticking out of either portal.
- **Sightline preview draw order.** Because the optional portal-to-portal sightline preview also calls `drawElementImage()` clipped to the thin oval aperture, drawing sightlines after the main cards would hand the hit box to the tiny preview. Painting sightlines in Layer 1 behind the cards avoids that conflict.
- **Continuous dragging across a portal plane.** Swapping a card's coordinates the moment its centre crosses `d = 0` during a pointer drag would jump the drag anchor across the chamber. Letting `d` go negative while held and swapping once the card fully clears (or on `pointerup`) keeps dragging continuous without moving any drawn pixels.

## Not verified

- Running the six live checks in headless Chromium 157 (`npm run check:jank -- /portal-split/` and `node tools/draw-size/audit.mjs /portal-split/`).
- Chrome on Android (412 px wide, DPR 2.625): dragging the card header bars and portal rotation knobs by touch, plus single-tap activation on the previously inactive split half without a prior hover event.
- Text caret and selection rendering when `<input id="subject-input">` is sliced directly across a portal boundary while focused.
- Frame rate during `Infinite fall (floor to ceiling)` with `Portal sightlines` enabled on a phone GPU.
- Real `contextlost` and `contextrestored` recovery on Android hardware.

## For the index

- Drawing and hit testing: splitting one live `drawable` HTML form card across draggable, rotatable Blue and Orange portals with half-plane `ctx.clip()`, momentum conservation and pointer-driven last-draw hit-box routing. not verified, `/portal-split/`.
