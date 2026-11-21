# A worker as the video compositor (`/worker-compositor/`)

Chromium 157 headless, software rendering and software video decoding, 2026-11-21. Measured by the page's live checks and by scripts that drove the page with Playwright. The camera in these runs is Chromium's fake camera (`--use-fake-device-for-media-stream`).

The page transfers a drawable canvas to a worker. The worker reads `VideoFrame`s, draws a transferred `ElementImage` of the overlay HTML over each one, and writes `new VideoFrame(canvas)` to a video track. The worker is `public/worker-compositor/compositor.js`.

## Getting frames into the worker and a track out

| Experiment | Result | Notes |
| --- | --- | --- |
| `MediaStreamTrackProcessor` in a worker | not defined | The specification defines it for workers only. Chromium 157 has it in the window only. |
| `VideoTrackGenerator` in a worker | not defined | The window has the older `MediaStreamTrackGenerator` and no `VideoTrackGenerator`. |
| `postMessage(track, [track])` to a worker | fails | `DataCloneError`: a `MediaStreamTrack` is not transferable. |
| `MediaStreamTrackProcessor` in the window, `readable` transferred to the worker | works | Frames arrive in the worker as I420, 640×360 from the clip and from the fake camera. |
| `MediaStreamTrackGenerator` in the window, `writable` transferred to the worker | works | The worker writes `new VideoFrame(canvas, { timestamp })`. A `<video>`, `MediaRecorder` and `RTCPeerConnection` on the page take the track. |
| Timestamps | kept | 18 of 18 frames read back from the output track carried the timestamp of an input frame. |
| Single `VideoFrame`s made on the page (`new VideoFrame(video)`) and posted | works | The route for a browser with no `MediaStreamTrackProcessor`. Each frame costs a main-thread task. |
| The WebM clip fetched, read and decoded with `VideoDecoder` in the worker | works | A 40 line WebM reader finds 300 VP9 frames. Frames arrive as I420. Nothing passes through the main thread. |
| `captureStream()` on the page's canvas after `transferControlToOffscreen()` | works | 10 frames in 1 s while the worker drew 30. A second way out, with no generator. |

## Drawing the DOM in the worker

| Experiment | Result | Notes |
| --- | --- | --- |
| `drawElementImage(ElementImage)` over a video frame on the transferred canvas | works | Video pixel `rgb(16 64 192)` and HTML pixel `rgb(255 0 255)` read back in the worker. 0.2 ms for a 320×180 frame. |
| The snapshot drawn into an `OffscreenCanvas` made in the worker | fails | `InvalidStateError`: "The source was captured from a different canvas." The output canvas has to be the page's canvas, at its buffer size. |
| A CSS animation in the scene | one snapshot per paint | 61 `paint` events and 61 snapshots in 1 s. `captureElementImage()` plus `postMessage()` took 0.05 ms. |
| A button in a 320 px buffer shown 160 px wide, drawn by the worker with the buffer size | hit where drawn | Its box is 35×25 px and `elementFromPoint()` finds it. A touch on the drawn buttons and typing in the drawn field worked at 412 px. |
| WebGL 2 on the transferred canvas: `texElementSubImage2D(ElementImage)` and `texImage2D(VideoFrame)` in one shader | works | Both textures read back through the shader. The page's looks use the 2D context. |

## With the main thread blocked

Each row blocks the main thread with a busy loop for 0.8 s (2 s for the button on the page) and counts frames in the worker.

| Source and conversion | Frames composed during the block | Notes |
| --- | --- | --- |
| Clip decoded in the worker, `copyTo()` of the planes and a YUV to RGB loop in script | 23 in 0.8 s, 58 in 2 s | The track delivered 22 to a second processor. About 4 to 6 ms per 640×360 frame. |
| Fake camera through a transferred `readable`, same conversion | 40 in 2 s | The camera's rate was 20 a second. |
| Pattern drawn in the worker (BGRA frames from an `OffscreenCanvas`), `createImageBitmap()` | 58 in 2 s | |
| Clip decoded in the worker, `drawImage(VideoFrame)` | 1 read, 0 written | The call waits for the main thread. |
| Clip decoded in the worker, `createImageBitmap(VideoFrame)` | 1 read, 0 written | The promise settles after the block. |
| I420 camera frame, `texImage2D(VideoFrame)` in a worker WebGL 2 context | 1 read, 0 done | Measured in a script, not a live check. |
| `copyTo(buffer, { format: 'RGBA' })` of a canvas-made frame | 1 | Measured in a script. `copyTo()` with no format conversion did not wait. |
| Clip played by a `<video>`, `video.captureStream()` | 0 read | The element's capture stops delivering frames. |
| Output through `captureStream()` of the page's canvas | 0 delivered | The worker drew 18 frames in that time. |
| `paint` events and new snapshots | 0 | The worker draws the last snapshot it has. |

## Things that bit

- The first version drew each frame with `drawImage(frame)`. It ran at the full rate and stopped completely when the main thread was blocked, including for frames the worker made itself. The cause was the YUV to RGB step, not the read loop: a worker that only read and closed frames kept its rate.
- `MediaStreamTrackProcessor` frames from the clip have `codedWidth` 704 and a visible width of 640. `copyTo()` with no rectangle copies the visible rectangle, so the conversion sizes its buffers from `visibleRect`.
- A message handler that awaits `createImageBitmap()` must keep the read loop in order. The loop awaits each compose before the next `read()`.
- The fixture box of the check harness takes taps. As on the other media pages it is set to `pointer-events: none` except during an `elementFromPoint()` call.

## Not verified

- Whether the conversions that waited for the main thread also wait on a device with a GPU. The four "blocked main thread" live checks answer this on the phone, and the "Frame to RGB" menu with the block button shows it on the visible demo.
- Hardware-decoded frames. They can arrive as NV12 or with `format` null. The script conversion handles I420, I420A and NV12 and falls back to `createImageBitmap()` for the rest. NV12 was not run.
- A real camera, and the frame rate and compose time on a phone. The status lines under the demo report both.
- Whether Chrome 159 for Android has `MediaStreamTrackProcessor` or `VideoTrackGenerator` in a worker. The two "standard route" live checks report it, and the page uses those routes first when they exist. That code path has not run.
- Sound. The output track is video only.

## For the index

- Across workers, tabs, origins and devices: a worker composes `VideoFrame`s and transferred `ElementImage` snapshots on the page's transferred canvas and writes a video track through a transferred `MediaStreamTrackGenerator` stream. measured, C157, `/worker-compositor/`.
- Across workers, tabs, origins and devices: `MediaStreamTrackProcessor` and `VideoTrackGenerator` are not defined in a worker and `MediaStreamTrack` is not transferable. measured, C157, `/worker-compositor/`.
- Video and sound: with the main thread blocked, a worker keeps composing if it decodes the file itself with `VideoDecoder` and converts frames with `copyTo()`. `drawImage(VideoFrame)`, `createImageBitmap(VideoFrame)` and `texImage2D(VideoFrame)` of I420 frames, `video.captureStream()` and `canvas.captureStream()` all stop. measured with software rendering, C157, `/worker-compositor/`.

## Chromium bugs

- In a worker, `drawImage(VideoFrame)`, `createImageBitmap(VideoFrame)` and `texImage2D(VideoFrame)` of an I420 frame wait for the main thread (Chromium 157, software rendering). A blocked main thread stops a worker that draws video frames. Not reduced to a report yet: the check rows on `/worker-compositor/` are the reproduction.

## API requests

- Allow an `ElementImage` to be drawn into another canvas owned by the same worker, or give `captureElementImage()` a size, so the composed frame does not have to be the size of the visible canvas and the visible canvas does not have to show it.
- Ship `MediaStreamTrackProcessor` and `VideoTrackGenerator` in workers and make `MediaStreamTrack` transferable, as specified in mediacapture-transform.

## Open ideas

- The looks as WebGL 2 shaders in the worker, with the snapshot and the frame as textures.
- Sound: an `AudioWorklet` beside the worker and an audio track added to the output stream.
- An encoder in the same worker (`VideoEncoder`) that writes a file with `lib/webm-mux.js`, so a recording also survives a blocked main thread.
