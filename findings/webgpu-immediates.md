# WebGPU immediates, external textures and MediaStreamTrack speech (`/webgpu-immediates/`)

Written 2026-11-22. The live checks on `/webgpu-immediates/` are not verified in a browser yet; prior baseline facts from C157 and A159 are cited from `findings/webgpu-features.md` and `findings/live-captions.md` (2026-11-21).

This page puts three Chrome 130 to 160 APIs together with HTML-in-canvas:

1. One WGSL `texture_external` pipeline that binds either a playing `<video>` via `device.importExternalTexture({ source: video })` or a drawable DOM card's `GPUTextureView` (uploaded via `GPUQueue.drawElementImageToTexture()`), or both side by side in split screen in the same render pass.
2. Four interactive drawable DOM cards warped on a subdivided mesh in one render pass, pushing 48 bytes per card (offset, tilt, wave phase, highlight and canvas size) through `pass.setImmediateData()` (or `pass.setImmediates()` where Chromium exposes the earlier name) with zero uniform buffers, falling back to a shared uniform buffer with 256-byte dynamic offsets or a 2D canvas.
3. Playing `/media/talk.webm`, capturing `video.captureStream().getAudioTracks()[0]`, and calling `recognition.start(audioTrack)` to transcribe into a selectable, editable DOM caption banner drawn over the video in a single 2D canvas, falling back to `/media/talk.vtt` cues when track recognition isn't available or emits no words.

## Experiments

| Experiment | Status | Notes |
| --- | --- | --- |
| `GPUTextureView` bound to a WGSL `texture_external` entry alongside `GPUExternalTexture` | Not verified | Probed on startup inside a WebGPU validation error scope; switches to a 2D canvas with `drawElementImage()` and `drawImage()` if WebGPU or the view binding is rejected. |
| Per-element uniforms via `pass.setImmediateData()` / `pass.setImmediates()` (zero uniform buffers) | Not verified on `/webgpu-immediates/` (immediates parity measured in C157 and reported in A159 on `/webgpu-features/`, 2026-11-21) | Checks `GPURenderPassEncoder.prototype` for `setImmediateData` first, then `setImmediates`, `wgslLanguageFeatures.has('immediate_address_space')`, and `device.limits.maxImmediateSize >= 48`. Falls back to a shared uniform buffer with 256-byte dynamic offsets or 2D canvas. |
| `SpeechRecognition.start(audioTrack)` from `video.captureStream().getAudioTracks()[0]` into an editable DOM caption banner | Not verified on real hardware (headless C157 has no recognition service, measured on `/live-captions/`, 2026-11-21) | Falls back to `/media/talk.vtt` cues after an error, early `onend`, or 2.5 s with no result, while keeping the banner selectable and editable inside the 2D canvas. |

## Things that bit

- **Method name drift for WebGPU immediates.** Chromium 157 exposed `GPURenderPassEncoder.prototype.setImmediates()` (with `maxImmediateSize` of 64 bytes), while the newer WebGPU spec uses `setImmediateData()`. Checking `setImmediateData` first and falling back to `setImmediates` lets the page use real immediates on both Chrome 157/159 and newer builds, while printing the exact method name in use.
- **Two uniform buffers for split-screen `texture_external` draws.** Drawing both the DOM card (`GPUTextureView`) and the playing video (`GPUExternalTexture`) in one render pass requires two separate uniform buffers (one per bind group) so the second `writeBuffer()` call doesn't overwrite the first draw's rectangle before `queue.submit()`.
- **Muting silences `video.captureStream()`.** In Chrome, a muted `<video>` produces a silent captured audio track, so Demo 3 starts playback unmuted on the visitor's Play tap and warns if the Mute speakers checkbox is ticked.
- **Hit-test cache invalidation after WebGPU moves.** Both Demo 1 and Demo 2 call `canvas.updateElementGeometry(el, { canvasTransform })` and toggle a `data-hit-tick` attribute on the element when its transform changes so Chromium clears its hit-test cache.

## Not verified

- Running the six live checks in headless Chromium 157 (`npm run check:jank -- /webgpu-immediates/` and tapping "Run these 6 checks") to measure `GPUTextureView`-in-`texture_external` validation and off-screen pixel parity.
- Running the page on Chrome desktop and Chrome for Android (real GPU) to verify live WebGPU presentation, touch dragging on the split line, hit testing on the four warped cards, and whether `SpeechRecognition.start(audioTrack)` produces live words from `/media/talk.webm`.
- Confirming whether Chrome 159/160 exposes `setImmediateData` or `setImmediates` on `GPURenderPassEncoder.prototype`.

## For the index

- WebGPU: binding a `GPUTextureView` from `drawElementImageToTexture()` to a WGSL `texture_external` slot alongside `importExternalTexture({ source: video })` (not verified, `/webgpu-immediates/`).
- WebGPU: per-element 48-byte uniforms for four warped DOM cards via `pass.setImmediateData()` / `setImmediates()` with zero uniform buffers (not verified on `/webgpu-immediates/`).
- Speech: `SpeechRecognition.start(audioTrack)` from `video.captureStream()` into an editable DOM caption banner over video in one 2D canvas (not verified on real hardware, `/webgpu-immediates/`).
