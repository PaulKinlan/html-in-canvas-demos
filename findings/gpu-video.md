# A video as a WebGPU external texture under HTML cards (`/gpu-video/`, `gpu-video/compose.js`, `gpu-video/measure.js`)

Chromium 157 headless (157.0.8103.78), software rendering and software video decoding, 2026-11-21. Every WebGPU row was measured with the SwiftShader software adapter (`--enable-unsafe-webgpu --enable-unsafe-swiftshader`), off screen: the pass draws into a texture that is read back. The default headless launch has no WebGPU adapter, and there only the 2D check runs. WebGPU on screen is not verified.

The page draws two `drawable` HTML cards and a `<video>` in one shader pass. The video is a child of the canvas with no `drawable` ancestor. Routes in order: WebGPU (`importExternalTexture(video)`, else `copyExternalImageToTexture(video)`, plus `drawElementImageToTexture()` for each card), WebGL 2 (`texImage2D(video)` plus `texElementSubImage2D()`), 2D (`drawImage(video)` plus `drawElementImage()`). In the test browser the visible demo runs on WebGL 2 and the page says why WebGPU is not in use.

## The pass (live checks, software adapter)

| Experiment | Result | Notes |
| --- | --- | --- |
| `device.importExternalTexture({ source: video })` | fails here | `OperationError: Failed to import texture from video`. Same for a detached video, an attached one, inside `requestVideoFrameCallback()`, and with the launch flags `--enable-features=Vulkan --use-angle=swiftshader`, `--ignore-gpu-blocklist`, `--in-process-gpu`, `--enable-features=SkiaGraphite`. Same in the full Chromium 153 build. The `texture_external` variant of the shader compiled but drew nothing here. |
| `importExternalTexture({ source: new VideoFrame(video) })` | fails here | Same message. The frame is I420, coded size 704×360. A `VideoFrame` made from a canvas (BGRA) and from RGBA and I420 buffers failed the same way in a probe script. |
| `queue.copyExternalImageToTexture({ source: video }, …)` | fails here | `Failed to copy content from video element.` in Chromium 157. In the full Chromium 153 build with the same adapter it worked for the video and for a `VideoFrame` (probe script, not a page check). |
| `createImageBitmap(video)`, then `copyExternalImageToTexture({ source: bitmap }, …)` | works | The route the checks fall back to. It is asynchronous. |
| One render pass sampling the frame texture and two element textures | works | Read back from a 320×180 `rgba8unorm` target: the clip's frame stripes, the card's colour 0, 200, 83 and a half transparent blue tag over the frame (126, 64, 250). The frame came through the bitmap route. |
| Frame in the composed picture against `requestVideoFrameCallback()` metadata | 12 of 12 match | With the bitmap route, which resolves after the callback. At software speed the video presented about every fifth frame. Not measured for an external texture. |
| Using a `GPUExternalTexture` in a later task | not measured | The import fails here, so the row fails before the test. |
| An element that contains the playing video, `drawElementImageToTexture()` | works | The texture holds the frame and the label over it. In 6 uploads, each in the first `paint` after a `requestVideoFrameCallback()`, the frame was the one the callback reported. |
| WGSL pass against the GLSL draw, video paused on frame 60 | same picture | Mean difference 0.00 of 255 for glass, video inside the text and ripple. Largest difference 1. The WebGPU frame came through the bitmap route and the WebGL frame through `texImage2D(video)`. |
| `importExternalTexture({ source: element })` | refused | `TypeError`: the source must be `HTMLVideoElement` or `VideoFrame`. Row marked `expect: 'fail'`. |
| 2D route: `drawImage(video)` then `drawElementImage(card, x, y, w, h)` | works | Measured with the default launch too. The button on the card is found by `elementFromPoint()` with no `updateElementGeometry()` call. |

## Layout and hit testing of canvas children

| Experiment | Result | Notes |
| --- | --- | --- |
| `position: absolute; left: 200px; top: 100px` on a child of a `layoutsubtree` canvas | does not move it | `getBoundingClientRect()` is at the canvas origin until a draw call or `updateElementGeometry()` places it. `offsetLeft` and `offsetTop` are -1. `offsetParent` is the canvas. |
| `left: 3%; right: 3%; bottom: 5%` on a canvas child with no width | 0 px wide | Percentages did not resolve against the canvas box. The page sets the card's width in pixels from `canvas.clientWidth` and keeps each card's position in script. |
| After a WebGPU pass alone, `elementFromPoint()` at the drawn button | the canvas | |
| `updateElementGeometry(card, { canvasTransform: new DOMMatrix() })` | hit box at the canvas origin | Not at the drawn position. |
| `canvasTransform: new DOMMatrix().translate(200, 100)` plus an attribute toggle | the button is hit where it is drawn | CSS pixels, with a 320 px wide canvas and a 320 px or 640 px buffer. `translate(400, 200)` missed. |
| Alpha of an element texture | straight, not premultiplied | `rgb(200 100 50 / .5)` is stored as 199, 100, 50 and `rgb(0 0 255 / .5)` as 0, 0, 255, alpha 0.5, on WebGPU and WebGL 2. `FINDINGS.md` says "Pixels are premultiplied" for `drawElementImageToTexture()`. This page measured the opposite on translucent content, and its shaders multiply by alpha. The seventh live check reports which one a device does. |
| A `<video>` child of the canvas with no `drawable` ancestor | plays, is never painted | `requestVideoFrameCallback()` fires. `texImage2D(video)` and `drawImage(video)` take its frames. Moving it to a new canvas that is already in the document does not pause it. |

## Cost per frame ("Measure on this device", software adapter and software GL)

40 draws, one per presented video frame, plain shader, 640×360 target that is not shown. "calls" is CPU time inside the upload and draw calls. "done" runs until `onSubmittedWorkDone()` (WebGPU) or a one pixel `readPixels()` (WebGL, since replaced by `gl.finish()`). "pass" is the render pass from a `timestamp-query` query set on a second device. These numbers are from a software rasterizer and say nothing about a GPU.

| Route | Uploaded each frame | calls | done | pass |
| --- | --- | --- | --- | --- |
| WebGPU, software | `importExternalTexture(video)` + card texture | failed: import | | |
| WebGPU, software | `importExternalTexture(video)`, card uploaded once | failed: import | | |
| WebGPU, software | element that contains the video (640×360), one `drawElementImageToTexture()` | 2.11 ms | 68.39 ms | 41.60 ms |
| WebGPU, software | `copyExternalImageToTexture(video)` + card texture | failed: copy | | |
| WebGPU, software | `createImageBitmap(video)`, `copyExternalImageToTexture(bitmap)` + card texture (200×120) | 3.30 ms | 69.74 ms | 35.68 ms |
| WebGL 2 | `texImage2D(video)` + `texElementSubImage2D(card)` | 3.71 ms | 26.83 ms | |
| WebGL 2 | element that contains the video, one `texElementSubImage2D()` | 2.37 ms | 18.77 ms | |
| 2D | `drawImage(video)` + `drawElementImage(card)` | 1.45 ms | | |
| 2D | element that contains the video, one `drawElementImage()` | 0.03 ms | | |

The WebGL numbers moved between runs (done 26.83 to 43.47 ms for the first row, 18.77 to 49.78 ms for the second), so no order between the two arrangements can be read from them. The 2D calls only record the drawing, so their numbers leave out the rasterization. The adapter listed `timestamp-query`, and a device made with it gave pass times.

## Things that bit

- Both cards were drawn in the top left corner at first. CSS `left`, `top` and percentages do nothing for a canvas child, and `offsetLeft` is -1. The page now computes positions and passes them to the shader and to `updateElementGeometry()`.
- Every translucent control was drawn solid white. The element texture has straight alpha and the shader added its colour to the frame without multiplying. A check with a half transparent box over black found it.
- `requestDevice()` a second time on the same adapter throws `adapter is "consumed"`. An earlier version of the measurement made a second device with `timestamp-query` from a new adapter, and the pass times in the table come from it. The page now uses only the shared device, which has no `timestamp-query`, so the pass column reads "not timed".
- A canvas keeps the kind of context it first gave, so changing route needs a new canvas. Moving the children to a clone that is not yet in the document pauses the video. The clone is inserted first and the children are moved after.
- `GPUElementTexture` textures have no `COPY_SRC` usage, so a check cannot read one directly. The checks draw it to a target and read that.
- The two measured arrangements first used different shaders (glass against plain), which made "done" and "pass" measure the shader. Both now draw with the plain effect.

## Not verified

- `importExternalTexture(video)` and `importExternalTexture(VideoFrame)` on a real GPU, with a hardware or a software decoder. Live checks 1 and 8 on the device.
- Whether a `GPUExternalTexture` from a video is refused in a later task. Live check 3 reports the validation error or the frame it drew.
- Frame accuracy of an external texture against `requestVideoFrameCallback()`. Live check 4.
- `copyExternalImageToTexture(video)` in Chrome 159. Live check 10.
- The WebGPU route on screen: `GPUCanvas` presentation, the fallback to `copyExternalImageToTexture()` and to WebGL when the first frame has a validation error or is blank. None of that code ran in the test browser. Open the page on a device with WebGPU and read the line under the picture.
- Every cost on a real GPU, and the comparison the experiment asked for (external texture plus card texture against the video inside the element). The "Measure on this device" button gives the table on the phone. Chrome quantizes timestamp queries to 100 µs unless developer features are on, so short passes will read 0.00 or 0.10 ms.
- The live checks under the jank guard with a WebGPU adapter. `tools/jank/check.mjs --checks` uses the default launch, where the WebGPU rows stop at "no WebGPU device".
- Typing with an on-screen keyboard, and touch on a real phone. Taps, the buttons and typing were driven by Playwright touch and key events at 412 px on the WebGL and 2D routes.

## For the index

- WebGPU: one pass samples a video texture and element textures from `drawElementImageToTexture()`; frame numbers and colours read back (measured, software adapter, C157, `/gpu-video/`).
- WebGPU: `importExternalTexture()` fails for a `<video>` and for a `VideoFrame` on the SwiftShader adapter, and `copyExternalImageToTexture(video)` fails in C157 on it; `createImageBitmap(video)` as the source works (measured, C157, `/gpu-video/`).
- WebGPU: an element that contains a playing video uploads with `drawElementImageToTexture()` and holds the frame `requestVideoFrameCallback()` reported (measured, software adapter, C157, `/gpu-video/`).
- WebGPU and WebGL: element textures store straight alpha for translucent content, which disagrees with the existing "Pixels are premultiplied" row (measured, C157, `/gpu-video/`).
- Hit testing: `canvasTransform` starts at the canvas origin in CSS pixels; an identity matrix puts the hit box at the origin (measured, C157, `/gpu-video/`).
- Layout: `left`, `top` and percentage insets do not position a child of a `layoutsubtree` canvas; `offsetLeft` is -1 (measured, C157, `/gpu-video/`).
- Video: a `<video>` canvas child outside any `drawable` element plays and feeds `texImage2D()` and `drawImage()` without being painted (measured, C157, `/gpu-video/`).

## API requests

- A `GPUExternalTexture` (or another no-copy binding) for a drawn element, as `importExternalTexture()` gives for a video. Today an element reaches WebGPU only through the copy in `drawElementImageToTexture()`.
- One documented alpha convention for `texElementSubImage2D()` and `drawElementImageToTexture()`.
- Documented layout for canvas children: whether `left`, `top` and percentages are meant to apply.

## Open ideas

- Run the measurement at the texture sizes of the visible demo on a phone (device pixel ratio 2.625 gives cards of about 1000×250).
- The same pass with a camera `MediaStreamTrack` frame as the external texture.
- A worker that owns the device and receives `VideoFrame`s and `ElementImage` snapshots.
