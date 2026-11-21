# Animated image formats as paint clocks (`/animated-images/`)

Idea 22.6 of the backlog in PLAN.md. Measured in headless Chromium 157 (C157) on 2026-11-21 at 412 px wide. The page's seven live checks pass there, and `node tools/animated-images/check.mjs` drives the demo (22 steps, all pass). Nothing here has been run on a phone.

The question: which animated image formats raise `paint` once per frame when the image is a child of a drawable canvas?

Every test file shows the same spinner, 12 frames of 80 ms (12.5 frames a second). The files are in `public/animated-images/`. A rate below is the number of `paint` events per second whose `changedElements` named the element, counted over 1.6 s in a live check unless it says otherwise.

| Experiment | Result | Why |
|---|---|---|
| GIF, APNG, WebP, AVIF in an `<img>` | 12.5 each | One event per frame for all four raster formats. |
| SVG file in an `<img>`, SMIL with `calcMode="discrete"` | 12.5 | One event per step. |
| SVG file in an `<img>`, CSS animation with `steps(12)` | 12.5 | One event per step. |
| SVG file in an `<img>`, continuous SMIL rotation | 59.4 | No frames of its own: one event per display frame. |
| GIF as a CSS `background-image` of a `drawable` div | 12.5 | The event names the div. |
| `<picture>` with an AVIF `<source>` and a GIF fallback | 12.5 | |
| `<object data="smil.svg">` | 12.5 | |
| A div with `content: url(clock.gif)` | 12.5 | |
| Inline SVG with the stepped SMIL animation, in a `drawable` div | 9.4 in the live check (three runs), 12 to 15 in the demo | Sampled by the page's frames. The count is less even than for an image file. The live check allows 45% either way for it. |
| GIF with a loop count of one | 13 events for 12 frames, then 0 in the next second | A finished image raises nothing. A new query string on `src` plays it again. |
| GIF and APNG in one canvas | each named 12.5 times a second, in 12.5 events a second | Frames that fall in the same display frame share one event, and `changedElements` lists both images. |
| A div with a plain background | 0 in 1 s | The base line. |
| Canvas scrolled above the window for 2.3 s (tool script, count for the last second) | GIF, APNG, WebP, AVIF, inline SVG and CSS background: 12 to 13. All three SVG files in `<img>`: 0 | The handler ran 55 times while the canvas was off screen. |
| Only the lower 240 px of the canvas on screen | The SVG files in rows above the window: 0. The SVG file in the bottom row: 60 | An SVG image stops by the place it is drawn at, not by the place of its canvas. |
| An SVG image drawn at y = 1500 in a 1600 px canvas whose top is on screen (scratch page, 2 s) | 8.5, against 12.5 for a GIF drawn the same way | The same result from a fixture: it ran for part of the time and stopped. |
| An image that is never drawn, canvas on screen (scratch page) | SVG 12.5, GIF 12.5 | Not being drawn does not stop either kind. |
| A lost context | plain HTML | One `contextlost` event stops the drawing and shows the elements as plain HTML. Tested by dispatching the event. |

## Things that bit

- The page reuses `mount()`, `ticked()` and `meter()` from `/paint-clocks/kit.js`. The clocks are drawn at a fixed place and the swinging signs are separate `drawable` elements, because an element drawn at a new place raises a `paint` event that names it.
- An `<svg>` element has no `offsetWidth`, so the inline SVG sits in a `drawable` div and the div is what is drawn and named.
- The first version of the status line showed 0 for the SVG tiles before the page was scrolled. They were below the window. That is how the off-screen rule for SVG images was found.
- A string replace that removed `width="64" height="64"` from the inline SVG also removed it from the background `<rect>`.
- The test stage for live checks is 340 px tall and clips. Fixtures are 60 px tall so that five fit at once. A clipped SVG fixture would have stopped.

## Not verified

- Chrome 159 on Android: the demo by touch, and that all four raster formats decode and run at 12.5 a second there.
- Whether Chrome on Android pauses raster images, the inline SVG or the CSS background while the canvas is off screen. The line under the demo counts paint events that arrive while the canvas is off screen.
- The rate of the continuous SVG on a 90 or 120 Hz display.
- Why the inline SVG gives 9.4 events a second in the live check and 12 to 15 in the demo.
- How long an SVG image keeps running after its drawn place leaves the window. It showed 0 in the last second after 2.3 s.
- Whether a GIF that plays once and is below the window at load starts before it is scrolled into view. The demo's one-shot tile showed 2 events in the second after it was first scrolled into view, 2.5 s after load.
- Lottie. Not built: it is a script that animates an inline SVG or a canvas from `requestAnimationFrame()`, and `public/vendor/` has no player.

## For the index

- Paint event: GIF, APNG, WebP and AVIF, SVG files with stepped SMIL or CSS animation, a CSS background image, `<picture>`, `<object>` and `content: url()` each raise one `paint` per frame when the element is a drawable canvas child. A continuous SVG animation raises one per display frame. C157, `/animated-images/`.
- Paint event: a GIF with a loop count of one stops raising `paint` after its last frame.
- Paint event: an SVG file in an `<img>` stops raising `paint` when the place it is drawn at is outside the window. Raster images, inline SVG and CSS background images do not stop (headless C157).
- Backlog: idea 22.6 is built on `/animated-images/`, apart from Lottie.
