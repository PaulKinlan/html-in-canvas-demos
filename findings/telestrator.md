# Screen capture with HTML annotation tools (`/telestrator/`, `public/telestrator/telestrator.js`)

Chromium 157 headless (C157), software rendering and software video decoding, 2026-11-21, for the canvas, the tools, the stream and the live checks. Chromium 153 with a window under Xvfb (C153, `channel: 'chromium'`, `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement`), same date, for every row that needed a real display capture: the C157 headless shell cannot start one. Nothing here was run on a phone or on desktop Chrome with a person at it.

The page is one 2D canvas with a 640×360 buffer and two `drawable` children: a `<div>` that holds the `<video>`, and a layer of annotations. The paint handler draws the first child, then regions of the video with `drawImage(video, sx, sy, …)` and `ctx.filter`, then the layer.

## The canvas and the tools

| Experiment | Result | Notes |
| --- | --- | --- |
| Two `drawable` children, both `position: absolute` at 0,0 and 640×360, each drawn with `drawElementImage(el, 0, 0, canvas.width, canvas.height)` | works, measured C157 | Pointer events reach the elements of the upper child. No `updateElementGeometry()` call. |
| `drawImage(video, sx, sy, sw, sh, …)` of a canvas child `<video>` inside the `paint` handler, between the two element draws | works, measured C157 | Used for the magnifier, the spotlight and the redaction. One decoder, no second video. |
| Pen stroke as one SVG `<path>` in the layer | in the canvas, in the `MediaRecorder` file and in the WebRTC stream, measured C157 | Check 2: 255,0,255 on the stroke in the canvas and in the file. Check 6: 255,0,255 on the stroke and 0,201,0 on the video after WebRTC, 320×180 at 25 frames a second. |
| Glow colour from the video under the stroke | works, measured C157 | A 64×36 `drawImage(video)` copy is read at the stroke's points. Over 0,200,0 the hue read was 120 and the pixel 5 px beside the stroke was 18,216,18. The glow is two CSS `drop-shadow()` filters on the path. |
| `PointerEvent.pressure` to stroke width | a ribbon path when the pressure varies, measured C157 | Touch points dispatched through CDP with a force rising from 0.2 to 1 gave a 21 point filled outline path. Points with one pressure give a stroked centre line. The pressure values of a real stylus are not verified. |
| Touch drag on the canvas with `touch-action: none` | the page did not scroll (`scrollY` 0), measured C157 with emulated touch | |
| `<textarea>` note: tap with the Note tool, then type | focus went to the `<textarea>` and the typed text was its value, measured C157 | Playwright keyboard input on the visible demo. Check 5 sets the value by script and reads the drawn text. |
| Note shown at half size, then moved 60 px | hit where drawn before and after the move, measured C157 | Check 5. The `<textarea>` box on screen is 105×24 px, half its layout size. |
| Step marker, spotlight, magnifier, redact box by tap or drag, Move, Erase, Undo, Clear | work, measured C157 with emulated touch | Erase finds strokes by distance to their points, not by SVG hit testing. |
| Fade mode: CSS opacity animation on the path | raises `paint` with no `requestPaint()`, measured C157 | Check 7: 0 events in 600 ms with a still stroke, 0 in the 550 ms the keyframes hold opacity at 1, 28 in the 450 ms in which it changes. The path is removed on `animationend`. |

## Annotations that change the video

| Experiment | Result | Notes |
| --- | --- | --- |
| Redact box, read from `canvas.captureStream()` | the source pixel is gone in all three styles, measured C157 | Check 3. A 4 px red mark (255,0,0): 255,254,254 with 14 px cells, 213,206,206 with `ctx.filter = 'blur()'`, 0,0,0 with black, 255,0,0 again when the box is removed. |
| Pixelation by `drawImage()` down to one pixel per cell with `imageSmoothingQuality` left at its default, then up with smoothing off | works | The 4 px mark was not visible in its cell. Whether a mark as large as a cell is averaged or sampled was not measured. |
| Magnifier: video region drawn 2.2 times larger inside a clipped circle | works, measured C157 | Check 4: 16 red pixels plain, 64 under the lens. |
| Magnifier over a redact box | 0 red pixels, measured C157 | The lens reads the video, so the paint handler redacts again inside each lens. Without that pass the lens would draw the hidden region enlarged (inferred from the code, not run). |
| Spotlight: `clip('evenodd')` then the frame with `ctx.filter = 'grayscale(1) brightness(.35)'` | works, seen in a screenshot, C157 | No check reads it. |

## Sources and capture options

| Experiment | Result | Notes |
| --- | --- | --- |
| Clip, then camera, then clip | works, measured C157 | Chromium's fake camera, 640×360. |
| `getDisplayMedia()` in the C157 headless shell | `NotReadableError: Could not start video source` with `--use-fake-ui-for-media-stream` and `--auto-select-desktop-capture-source=Entire screen` or `--auto-accept-this-tab-capture`. `NotSupportedError: Not supported` with only `--auto-select-tab-capture-source-by-title` | measured C157 |
| The same with `--use-fake-device-for-media-stream` added | resolves with a fake monitor: plain `MediaStreamTrack` "screen:-3:0", `displaySurface` monitor, 1082×610, the fake camera pattern | measured C157. It is drawn in the canvas and the tools work on it. `preferCurrentTab: true` was accepted and still gave this monitor. |
| On that monitor track: `cropTo`, `restrictTo` | the track has neither method | measured C157 |
| On that monitor track: `controller.forwardWheel(canvas)`, `increaseZoomLevel()` | `NotSupportedError: Action only supported for tab-capture` | measured C157 |
| `{ preferCurrentTab: true, selfBrowserSurface: 'include' }` with `--auto-accept-this-tab-capture`, C153 with a window | resolves: `BrowserCaptureMediaStreamTrack`, `displaySurface` browser, 800×900 (the viewport), cursor motion | measured C153 |
| The canvas drawing a capture of its own tab | the page with the canvas in it, repeated inside itself; no crash | measured C153, screenshot. The canvas's place in the frame differed from the canvas by a mean of 35.6 of 255 per channel (the copy is one generation behind and smaller). `getImageData()` on a copy of the canvas worked, so the capture does not taint. |
| `CropTarget.fromElement(canvas)`, `track.cropTo()` on that track | resolved in 1 ms; the video became 640×360 | measured C153 |
| `RestrictionTarget.fromElement(canvas)`, `track.restrictTo()` | resolved in 12 ms; the video was still 800×900 0.5 s later and 640×360 at the next reading | measured C153. The canvas has `isolation: isolate`. |
| Picture after the crop or the restriction to the canvas | a closed loop | measured C153, screenshots. The frame is only the canvas and the canvas draws only the frame. The page picture from before the crop stayed, and the arrow's glow grew on each pass because the arrow is drawn over its own copy. Mean difference between frame and canvas 17.0 and 16.5. |
| `cropTo(null)`, `restrictTo(null)` | both resolve | measured C153 |
| Capture of another tab (`--auto-select-tab-capture-source-by-title`), then `cropTo()` and `restrictTo()` with the canvas | resolves as `BrowserCaptureMediaStreamTrack`, browser, 800×900; both calls throw `NotAllowedError: Invalid target` | measured C153. The picture of the other tab in the canvas was not inspected. |
| `forwardWheel(canvas)`, `increaseZoomLevel()` on a tab capture (other tab and own tab) | neither promise settled in 3 s | measured C153. Consistent with a permission prompt that nothing answered. Not verified further. |
| `setFocusBehavior('no-focus-change')` before the call | no exception; effect not verified | The log line was overwritten in the run that used it; the page now writes it after the call line. |
| Same-size stand-in for self capture: the canvas's own `captureStream()` in its child video at half size | nesting levels 0 to 3 drawn; a removed stroke left level 0 after 65 ms, level 1 after 65 ms, level 2 after 133 ms; no crash | measured C157, check 8 |
| `getDisplayMedia` missing | the page disables Screen and This tab and says so | Code path not run: both test browsers have the method. |

## Output

| Experiment | Result | Notes |
| --- | --- | --- |
| "Record 5 s" with the clip, canvas on screen | 998 kB of `video/webm;codecs=vp9,opus` with the clip's sound | measured C157 |
| "Record 5 s" and "Send as one stream" with the canvas scrolled out of the window | 0 kB; 2 frames decoded at the far end in 3.5 s | measured C157. The clip is paused by the page's IntersectionObserver there, and `requestPaint()` every 100 ms produced no frames. Which of the two stops it was not separated. |
| Live checks | 8 of 8 pass | C157, 412 px wide, touch, device scale factor 2.625 |
| `node tools/jank/check.mjs --base … /telestrator/` and with `--checks` | both pass | cls 0 and 0.001 |

## Things that bit

- The redact box's own label ("hidden", black background) lay over the pixel the first version of check 3 read, so all three styles read 0,0,0. The mark is now in the lower half of the box.
- The fade keyframes hold opacity at 1 for the first 55%. Nothing is painted in that time, so a paint count over the first 600 ms of a 1 s fade was 2.
- A video whose `srcObject` is the canvas's own `captureStream()` showed nothing until `play()` was called on it.
- `--use-fake-device-for-media-stream` also replaces the display capture with the fake camera pattern labelled as a monitor. It looks like a pass and is not a screen capture.
- A `Promise.race()` with a timer logged "has not settled" after the call had already rejected. The timer now checks a flag.

## Not verified

- Anything on Chrome 159 on Android: touch drawing, the note with the phone keyboard, the camera, the disabled Screen button. The live checks and the log under the source buttons report it on the device.
- A real stylus: pressure range and the look of the ribbon. Draw with the Pen tool.
- Desktop Chrome with a person: the picker, the sharing bar, `displaySurface` and `selfBrowserSurface` changing what the picker offers, `setFocusBehavior()`, the permission prompt and the effect of `forwardWheel()` and zoom. The Screen button with the options, then the buttons under "Capture options", write each result in the log.
- The crop and restriction rows on Chromium 157 or later. They were measured on Chromium 153. The "This tab" button, then "Crop to the canvas" and "Measure the picture", repeat them.
- Frame rate and cost with a 1920 px or 4K capture and several annotations.
- Whether an off-screen canvas alone (video still playing) stops the stream.
- System audio from `getDisplayMedia({ audio: true })` in the recording. The page asks for video only.

## Further experiments

- Crop the self capture to a sibling element (the page content beside the canvas) and annotate that, so the page annotates itself with no loop.
- Send the annotations as DOM over a data channel beside the raw capture, and compose at the receiver, so the viewer can select the note text. Compare with the single composed stream.
- A WebGPU route with `importExternalTexture(video)` for the magnifier at capture resolution.
- Recognise the text under a redact box before hiding it (`TextDetector`) and redact by match.

## For the index

- Video and media: a `getDisplayMedia()` stream in a canvas child `<video>` is drawn by `drawElementImage()` and `drawImage()` and does not taint the canvas (measured C153 with a real tab capture, C157 with a fake monitor).
- Video and media: a tab capture cropped or restricted to the canvas that draws it is a closed loop; the old picture stays and annotations accumulate (measured C153).
- Hit testing: two `drawable` children drawn with a size each keep scaled hit boxes; the upper one takes the pointer events (measured C157).
- Paint events: a CSS opacity animation on an SVG path in a drawable child raises `paint` only while the value changes (measured C157).
- Capture and export: redaction done in the paint handler is in `captureStream()`, `MediaRecorder` and WebRTC output (measured C157).
