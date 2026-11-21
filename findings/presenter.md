# A video presenter over a slide made of DOM (`/presenter/`)

Chromium 157 headless (C157), software rendering and software video decoding, 2026-11-21. Phone emulation: 412 px wide, touch, device scale factor 2.625. Every camera result below comes from Chromium's fake camera (`--use-fake-device-for-media-stream`, label `fake_device_0`, 640×360, a flat green picture with a moving yellow-green wedge). No real camera was used. All results are measured unless a row says otherwise.

The page draws a slide (two `drawable` elements of 640×360 layout pixels: body and title) and a presenter video in one canvas with a fixed 640×360 buffer. The presenter comes from a `<video>` or a canvas that is not a child of the drawable canvas.

## Composition and input

| Experiment | Result | Notes |
| --- | --- | --- |
| VP9 alpha clip as a `<video>` child of a drawable element, `drawElementImage()` | alpha kept | Of 1849 sampled points in the video's box, 1534 showed the slide and 315 the disc. |
| `drawImage(video)` of the alpha clip after `drawElementImage(slide)` | alpha kept | The 2D route of the page. 318 of 3600 points were the video. |
| Shadow of the presenter on the slide, 2D | works | `shadowBlur` with the picture drawn 4000 px off the canvas and `shadowOffsetX` bringing only the shadow back. 194 more points of the slide were darker. |
| `texImage2D(video)` of the alpha clip in WebGL 2 | alpha kept | The clear corner of the video showed the slide. An edge pixel read back as alpha 252 with unmultiplied colour. |
| Link under the presenter's pixels, 2D route | hit | `elementFromPoint()` returns the `<a>` at a point where the canvas shows the video. `caretRangeFromPoint()` returns a character offset in the link's text. |
| Tap on a link under the presenter (touch, demo) | received | 3 of 3 taps on the 2D route, 1 of 1 on the WebGL route. |
| Radio button and text field under or beside the presenter, WebGL route (touch, demo) | work | The radio was checked by a tap. A tap on the text field focused it and typed text arrived. |
| Text selection by mouse drag across text under the presenter | works | `getSelection().toString()` gave the whole sentence. The highlight is drawn in the canvas, under the presenter. Touch selection (long press) was not run. |
| Radio button under the keyed presenter, WebGL fixture | found and checked | `elementFromPoint()` returns the `<input>` after `updateElementGeometry()`. A script click checks it and fires `change`. One `paint` follows with no `requestPaint()`. |
| Presenter as a `<video>` element over the link (child of the slide) | takes the hit | `elementFromPoint()` on a clear pixel of the video returns `<video>`. With `pointer-events: none` on the video it returns `<a>`. Check row marked `expect: 'fail'`. |
| Title layer over the whole slide | does not block the body | The front layer has `pointer-events: none` and its `<h2>` has `auto`. Hits on empty parts of it reach the back layer. |
| Presenter between the two layers | works | Draw order back, presenter, front on both routes. |
| Moving the two `drawable` elements from the 2D canvas to a WebGL canvas and back with `append()` | works | Form state is kept. A `paint` of the old canvas that still held a reference threw "The element can only be drawn into its nearest ancestor canvas", so each handler checks `parentNode`. |
| `updateElementGeometry()` on a 640×360 buffer shown 354 px wide | unit is CSS pixels here | Identity gave a 640 px wide box. The page measures the unit and scales by `clientWidth / 640`. |
| `getElementImageDefaultSize()` for a 640 px element in a 640 px buffer shown 320 px wide | 1280×720 | The size follows buffer pixels per CSS pixel, not the device scale factor. |

## Background removal

| Route | Result | Notes |
| --- | --- | --- |
| `getCapabilities().backgroundBlur` | not listed | Fake camera. `getSupportedConstraints().backgroundBlur` is `false`. |
| `getCapabilities().backgroundSegmentationMask` | not listed | Fake camera. `getSupportedConstraints().backgroundSegmentationMask` is `false`. A frame read with `MediaStreamTrackProcessor` had no keys in `metadata()`. |
| Mask route (`applyConstraints({ backgroundSegmentationMask: true })`, `MediaStreamTrackProcessor`, `metadata().backgroundSegmentationMask` uploaded with `texImage2D()`) | not verified | Written. It stops at the capability test here and the page says so, then draws the camera with nothing removed. |
| Chroma key shader on a canvas `captureStream()` video (green with a red box) | works | Key colour read from the frame's corner: rgb(0, 208, 0). Green showed the slide, rgb(0, 255, 255) and rgb(255, 212, 0). The box stayed rgb(255, 0, 0). |
| Chroma key on the fake camera | works | Key colour rgb(0, 135, 0) taken from the top left corner. The wall was removed. The wedge is a lighter green and came out partly transparent. |
| Difference key against a captured frame, wall of two colours | works | Before capture the wall is drawn. After it both colours showed the slide and a box that entered stayed red. |
| Difference key on the fake camera | works | After "Capture background" only the parts of the wedge that had moved were drawn. |

## Output

| Experiment | Result | Notes |
| --- | --- | --- |
| `captureStream()` of the WebGL canvas through `RTCPeerConnection`, context made without `preserveDrawingBuffer` | black frames | 320×180 arrived, every sampled pixel rgb(0, 0, 0). The canvas is drawn only in its `paint` handler. |
| Same with `preserveDrawingBuffer: true` | works | The slide's link arrived as rgb(9, 254, 250) and the presenter's box as rgb(255, 2, 0). |
| "Send as a camera" in the demo, WebGL route, fake camera with chroma key | works | 640×360 received. 5 frames a second with software rendering. |
| "Record 5 s", `recordCanvas()` | works | 265 kB of `video/webm;codecs=vp9,opus`, 640×360. |
| `paint` with the presenter video outside the canvas and no `requestPaint()` | 0 a second | |
| Same with `requestPaint()` from `requestVideoFrameCallback()` | 30 a second | |
| Video as a child of the slide, no `requestPaint()` | 30 a second | |
| Paint rate of the demo, 2D route | 29.5 a second | With and without the difference blend. |
| Paint rate of the demo, WebGL route | 4.5 to 7 a second | Software GL. The shader takes 12 samples for the shadow and 12 more for three of the effects. Not a figure for a real GPU. |

## Things that bit

- A WebGL canvas that draws only in `paint` gave black frames to `captureStream()`. `preserveDrawingBuffer: true` fixed it. The 2D canvas did not need anything.
- After moving the layers to another canvas, the old canvas still got one `paint` and `drawElementImage()` threw. Guard with `layer.parentNode === canvas`.
- Toggling an attribute to clear the hit-test cache raises a `paint`. Doing it in every paint would loop, so the page places the layers once for each shown size.
- The alpha clip's disc moves, so a check cannot use a fixed point. The checks scan the canvas for a point that shows the video.
- A `<select>` with a long option overflowed the 412 px row until its label got `min-width: 0`.
- The bend effect displaces pixels by up to 27 px. Hit boxes stay where the elements are laid out.

## Not verified

- A real camera on a phone or laptop: what `getCapabilities()` lists for `backgroundBlur` and `backgroundSegmentationMask`, and the mask route end to end (including whether the mask is white on the person). The last live check and the line under the demo report the capabilities on the device. Picking "Camera, segmentation mask from the browser" runs the route.
- Chroma and difference keys on a real room: lighting, auto exposure and camera noise. Pick the two camera sources on a device.
- Hardware-decoded alpha video through `drawImage()` and `texImage2D()`. Live checks 1, 2 and 8 answer it on the device.
- Frame rate of the shader on a phone GPU, and of the stream. "Send as a camera" prints the received frame rate.
- Touch text selection (long press and handles) under the presenter.
- WebGPU: no WebGPU route was built.
- Whether the black `captureStream()` frames without `preserveDrawingBuffer` also happen with hardware GL.

## Open ideas

- A WebGPU route with `importExternalTexture(video)` for the presenter.
- Move the hit boxes with the bend effect, by giving each control its own `drawable` element and transform.
- A segmentation model in a worker (WebNN or WASM) as a fourth removal route for cameras with no mask.
- Slide transitions from `/transitions/` with the presenter held above them.

## For the index

- Video: a presenter drawn from a video outside the canvas takes no hits. Links, form controls and text selection work under it on the 2D and WebGL routes (`/presenter/`).
- Video: VP9 alpha is kept by a `<video>` child, by `drawImage(video)` and by `texImage2D(video)`.
- Video: a video outside the canvas raises no `paint`. Use `requestVideoFrameCallback()` with `requestPaint()`.
- Capture: `captureStream()` of a WebGL canvas that draws in `paint` needs `preserveDrawingBuffer: true`, else the frames are black (C157, software GL).
- Camera: Chromium's fake camera lists neither `backgroundBlur` nor `backgroundSegmentationMask`.
- Hit testing: a `drawable` layer that covers another needs `pointer-events: none`, with `auto` on its own content.
- Layout: `drawable` children can be moved between two canvases with `append()`.

## Chromium bugs

- Possible: `captureStream()` on a WebGL 2 drawable canvas drawn in the `paint` event delivers black frames unless `preserveDrawingBuffer` is set. Seen in C157 headless with software GL. Not reduced to a case without HTML-in-canvas.
