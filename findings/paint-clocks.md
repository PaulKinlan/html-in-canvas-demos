# Paint clocks (`/paint-clocks/`)

Four ideas from the element catalogue (ideas 18.4 to 18.7 of the backlog in PLAN.md). Measured in headless Chromium 157 (C157) on 2026-11-21 at 412 px wide. The page's seven live checks pass there, and `node tools/paint-clocks/check.mjs` drives the four demos with real input (20 steps, all pass). Nothing here has been run on a phone.

The question: can the repaints of an element be the only clock for a canvas effect, with no `requestAnimationFrame()`, no timer and no `requestPaint()` loop?

| Experiment | Result | Why |
|---|---|---|
| A canvas whose elements do not change | 0 paint events in 1 s | The base line. |
| `<progress>` with no value and a CSS animation on its background | 60.0 paint events per second | Each animation frame repaints the element. The loading effect runs from it. |
| The browser's own indeterminate `<progress>` | 8.0 per second | The built-in animation repaints at that rate in C157. |
| The same bars after `value` is set | 0.0 | `:indeterminate` no longer matches, the animation ends, and `paint` stops. The page cancels nothing. |
| A focused `<input>` | 2 per second, 500 ms apart | One event each time the caret goes on or off. A typed letter raises one as well (5 in a second while typing three letters). After blur: none. |
| A playing 30 fps `<video>` | 30.7 per second | 46 paint events for 45 frames from `requestVideoFrameCallback()` in 1.5 s. Paused: 0. |
| Seek of a paused video | one `paint` for the new frame | The scene, placed from `currentTime`, moved to 7.01 s after a seek to 70% of 10 s with no `seeked` listener. |
| Animated GIF, 80 ms and 240 ms per frame | 12.7 and 4.2 per second | The file's frame rate. A handler that counts events runs at the speed stored in the file. |
| The image is never drawn by the handler | 12.0 per second | A `drawable` element raises `paint` whether or not `drawElementImage()` is called for it. |
| The image is removed | 0.0 | |
| `opacity: 0` on the image from the start | 0.0 | It was never painted, so it never started. |
| `opacity: 0` given to a running image | 12.5 per second | The events continue. An earlier version of this page claimed they stop: that was the page's own text, not a count. |
| `visibility: hidden` on the image | no picture | `drawElementImage()` throws "No cached paint record for element". |
| Drawing an element at a different place than in the last paint | a second paint event one frame later | `changedElements` names the element that was moved, not the clock. Live check: 10 events named a 240 ms image and 10 more named only the div drawn 5 px further along each time. |
| The effect of that on a handler that counts paint events | twice the rate | Before it was handled the flag showed 26 events a second for a 12.5 per second image, and the card beat twice per blink, 17 ms apart. |
| The fix | `changedElements` and a clock that stays still | A tick is counted only when `changedElements` holds the clock element. Any other event redraws the same frame. The clock must not be moved by the drawing: a video drawn with a tilt that changed each frame gave 42 events a second that named the video, and 30 when drawn at a fixed place. The caret's field is its own `drawable` element, separate from the card that beats. |
| A lost context | plain HTML | One `contextlost` event stops all four and shows the elements as plain HTML (4 boxes). Tested by dispatching the event. |

## Things that bit

- The doubled rate was first seen as "paint events in the last second: 26" under a 12.5 per second image. A fixture that drew the image alone showed 12.5, so the cause was the other draws.
- `python3 -m http.server` has no range requests, so the video is not seekable from it (`seekable.length` 0) and a seek goes to 0. `tools/paint-clocks/check.mjs` serves `public/` itself with ranges.
- A demo that stops gets no paint event in which to write "stopped". The status line is written in the last paint event the element raises (the bar's value change, the blur, the removal), and for the video in a `pause` listener.
- A switch between the CSS-animated bar and the browser's own bar inside the demo gave 27 to 61 events a second that named the bar, not 8. A fixture with the browser's bar beside a moving element gave 8. The cause was not found, the switch was removed, and the rate of the browser's bar is measured by a live check.
- An element has no picture until the browser has painted it once. With no frame loop a failed first draw would leave the canvas empty, so the handler asks for one more paint after a failed draw, at most 30 times.

## Not verified

- Chrome 159 on Android: all four demos by touch.
- The caret's blink interval on Android, and whether the on-screen keyboard changes it. The line under the heartbeat prints the interval.
- Whether Chrome on Android pauses an animated image, a CSS animation or a video's paint events while the canvas is scrolled off screen.
- The paint rate of a video decoded in hardware.
- Why the browser's own bar raised more than 8 events a second inside the loading demo (see "Things that bit").
- Whether the second paint event after a moved draw is intended. It needs a reduction outside this page.

## For the index

- Paint event: an indeterminate progress bar (8 per second, or 60 with a CSS animation), a caret (2), a playing video (its frame rate) and an animated image (its frame rate) raise `paint` by themselves and can be the only clock of an effect. C157, `/paint-clocks/`.
- Paint event: `drawElementImage()` of an element at a different place than in the last paint raises a second `paint` one frame later, with that element in `changedElements`. A handler that counts events has to check `changedElements`.
- Paint event: a `drawable` element raises `paint` when it is not drawn. `opacity: 0` from the start prevents the events, and `opacity: 0` set later does not stop them.
- Video: one `paint` per shown frame, and one for a seek while paused.
- Backlog: ideas 18.4 to 18.7 (loading state that stops by itself, caret as a heartbeat, video as a frame clock for a whole scene, animated image as the only clock) are built on `/paint-clocks/`. Ideas 18.1 to 18.3 (top layer) are not built yet.

## API requests

- A way to tell, in a `paint` event, which elements repainted by themselves and which are listed only because the last paint drew them at a new place.
