# Video as a material for editable text (`/video-text/`)

Chromium 157 headless (C157), software rendering and software video decoding, 2026-11-21. Phone emulation at 412 px wide. All results are measured by the page's live checks unless a row says "script" (a Playwright script run against the page) or "inferred". The clip is `/media/clip.webm`, loaded as a blob URL.

The question: can live DOM text (editable, selectable, wrapped by the browser) be filled, lit or displaced by a playing video in a shader, and which of those can plain CSS do with no canvas.

## The demo

Two `contenteditable` elements in one `drawable` child of a canvas. A `<video hidden>` beside the canvas. One fragment shader reads the text as an element texture and the video frame as a second texture. Six effects: fill, displace, chrome, punch, mosaic, weight. Three routes, chosen through `shared/backend.js`: WebGPU, WebGL 2, 2D canvas.

| Experiment | Result | Notes |
| --- | --- | --- |
| Text texture from `texElementSubImage2D()` for a white letter on a clear background | 16.1% white and opaque, 83.0% clear, 0.9% antialiased edge, 0 coloured pixels | Premultiplied. Antialiasing on a clear background is greyscale, so the smallest of r, g, b equals alpha on every glyph pixel. |
| Fill in the shader: pixel inside a glyph against `drawImage(video)` at the same place | largest difference 1 of 255 over 111 points | 533 points outside the glyph equal the background exactly. |
| Typing, caret and selection on the drawn text, WebGL route | work (script) | Clicked in the text, typed, extended a selection with Shift and arrow keys. The text reflows when the canvas width changes: the font size is a fraction of `canvas.clientWidth`. |
| Edit the DOM text, no `requestPaint()` | `paint` came 21 ms later with the new picture | 222 ms when the visible demo was also drawing in software. |
| `elementFromPoint()` and `caretPositionFromPoint()` at a drawn letter on a new WebGL canvas | before `updateElementGeometry()`: the canvas, no caret. After, with an identity matrix: the paragraph, offset 3 of "CARET" | |
| Caret in the picture | drawn, and it blinks with no `requestPaint()` (script) | 6 `paint` events in 3 s with the video paused. In WebGL about 11 pixels in the caret colour come and go. |
| Selection highlight in the text texture | premultiplied 0,91,255,115 for CSS `rgb(0 90 255 / 0.45)` | The glyph pixels inside the selection stay white. |
| How the shader treats what is not a glyph | coverage is `min(r, g, b)` of the premultiplied texel. `alpha - coverage` is "other" and is drawn over the effect in its own colour at 60% | Other is the highlight, the caret, the focus ring and colour emoji. At one highlight pixel WebGL drew 8,64,166 where the video was 10,130,81. |
| The same pixel in the 2D `source-in` route | 11,66,47: the video at the highlight's alpha | `source-in` reads alpha only, so a selection is a block of video and the caret is a bar of video. |
| 2D route: `drawElementImage()` then `drawImage(video)` with `source-in` | same fill as the shader, mean difference 1.46 of 255, largest 232 | The large values are single edge pixels. `source-out` gives punch. |
| 2D route: displace, chrome, mosaic, weight | not built | They read the text and the video at different places. That needs a per-pixel loop in script on a 2D canvas. The menu disables them on that route. |
| Displace in the shader | 818 of 14400 sampled pixels lit where the text texture has no coverage | The video's brightness and colour moved those glyph pixels. |
| Switching route | works (script) | A canvas keeps its first context type, so the page makes a new canvas, moves the text element into it and removes the old canvas. One GPU context is in the document at a time. |
| Camera as the video | works (script) | Chromium's fake camera through `srcObject`. Started from the menu only. |

## Timing

| Experiment | Result | Notes |
| --- | --- | --- |
| `paint` events with the video beside the canvas, no `requestPaint()` | 0 a second | `texImage2D(video)` does not invalidate the canvas. The page calls `requestPaint()` from `requestVideoFrameCallback()`. |
| The same video as a child of the drawable element, frame moved out with `object-position: -9999px 0` | 30 a second | `texImage2D()` of that child still gives the frame. With `opacity: 0` on the child: 30 a second. |
| Frame from `texImage2D(video)` minus the frame number written into the DOM by `requestVideoFrameCallback()`, read from one paint, demo off screen | 0 in 26 of 28 paints, +1 in 2. A later run: 0 in 28 of 28 | 28 to 29 callbacks a second. The same with the video outside the document and with it in the document. |
| The same while the visible demo was also drawing in software | +2 to +6 frames | 7 to 11 callbacks a second. The paint handler ran that long after the callback. This row fails on the page when the median is above 1. |

## CSS and SVG with no shader

| Experiment | Result | Notes |
| --- | --- | --- |
| `mix-blend-mode: multiply`, white text on a black box over a `<video>`, plain DOM | fill, with editable HTML text | Visual only on the page (first box). `screen` with black text on white gives the punch. |
| The same markup inside one drawable element, `drawElementImage()` | blend kept: block pixel 173,246,7 equals the video, outside 0,0,0 | The video and the text are both in the element's picture. |
| `mix-blend-mode: multiply` on the drawn element itself, video drawn first with `drawImage()` | the blend reaches the 2D canvas: block 173,246,7, outside 0,0,0. Without the property: block 255,255,255 | Not expected. `drawElementImage()` composites the element with its own blend mode against what the canvas holds. |
| The same element through `texElementSubImage2D()` | unblended: block 255,255,255,255, outside 0,0,0,255 | A shader does not see the blend mode. |
| `globalCompositeOperation = 'multiply'` then `drawElementImage()` | fill | A second 2D way beside `source-in`. |
| `background-clip: text` with the video as the background image | no route | `CSS.supports()`: `element()` no, `-moz-element()` no, `-webkit-canvas()` no, `paint()` parses. A paint worklet draws CSS image values only (inferred from its interface, not run). |
| HTML `<video>` with `clip-path: url(#…)` to an SVG `<clipPath>` holding `<rect>` and `<text>`, as a drawable child | works: rect pixel equals the video, alpha 0 outside, 1474 video pixels in the shape of the SVG text | SVG text only: no wrapping, no editing. `clip-path` with `path()` or `polygon()` cannot follow text. |
| `<video>` in a `<foreignObject>` with an SVG `<mask>`, as a drawable child | works: rect pixel equals the video, alpha 0 outside | |

Which effects need the canvas: fill and punch do not. Displace, chrome, mosaic and weight do, because each output pixel is computed from text pixels and video pixels at other places. CSS blending, clipping and masking combine two pictures at the same place only.

## WebGPU

| Experiment | Result | Notes |
| --- | --- | --- |
| WGSL version of the shader against the GLSL one, off screen, software adapter (`--enable-unsafe-webgpu --enable-unsafe-swiftshader`) | mean difference 0.00 of 255 for all six effects | `drawElementImageToTexture()` for the text, render into a texture, read back. |
| `copyExternalImageToTexture({ source: video })` on that adapter | throws "Failed to copy content from video element" | Same for a `VideoFrame` made from the video, paused or playing, in or out of the document (script). |
| `importExternalTexture({ source: video })` on that adapter | throws "Failed to import texture from video" | |
| `drawImage(video)` into a 2D `OffscreenCanvas`, then `copyExternalImageToTexture(canvas)` | works | The route falls back to this when the direct copy throws. `createImageBitmap(video)` also works but is asynchronous. |
| Default headless launch | no adapter | The WebGPU check row fails with "not run". |

## Contexts

The page makes 1 WebGL context on load. During the checks the largest number alive is 3: the demo, one fixture canvas shared by every WebGL check, and one new canvas for the hit-test check, which must never have been given a geometry. The jank guard reports `gl 1/0` on load and `gl 3/0` with checks. The visible demo does no readback except one 24 px copy in the last check.

## Things that bit

- A listener added after the page's `paint` listener does not run before code that awaits a promise resolved in the first listener. A microtask checkpoint runs between listeners. A value "captured at paint time" by the second listener was one paint old.
- The frame-sync numbers depend on what else the page draws. With the demo on screen in software rendering, callbacks dropped to 8 a second and the lag rose to 6 frames. Scrolled to the checks, the lag was 0.
- `updateElementGeometry()` stays in force on an element. A reused fixture reported a working hit test "before" the call. The hit-test check uses a new canvas.
- A drawing error inside the `paint` handler left a check waiting for a readback. The wait now reports the error text.
- A software WebGPU adapter refuses video sources. Without the 2D canvas fallback the WGSL comparison could not run.

## Not verified

- The WebGPU route on screen. The page's "Drawn with" menu offers it where `webgpu()` gives a device. The WebGPU check row compares it with WebGL off screen on the device.
- `copyExternalImageToTexture(video)` and `importExternalTexture(video)` on a hardware adapter. The WebGPU check row reports both. The shader uses a plain `texture_2d`, so an external texture is not used for drawing.
- A hardware-decoded frame through `texImage2D(video)` on Android. The second check row answers it.
- Frame lag and paint rate on a phone. The fourth and sixth check rows report them.
- Touch selection handles, long-press selection and the on-screen keyboard on the drawn text. Needs a hand on the phone.
- The camera on a real device.
- Whether a paint worklet can be given a video frame. Not run.
- Whether `drawElementImage()` applying the element's `mix-blend-mode` is intended. Checked for `multiply` only.

## Open ideas

- Per-glyph effects from real glyph boxes: `Range.getClientRects()` per character as a uniform array or a small data texture, so each letter gets its own video crop or delay.
- A signed distance field made from the text texture once per edit, for wide outlines and bevels without 68 texture reads per pixel.
- The video inside the drawable element at `opacity: 0`, as a way to get one paint per frame with no `requestVideoFrameCallback()` loop.
- The same shader with the page's own scrolled content as the material in place of the video.

## For the index

- Element textures: text styled white on clear gives a coverage mask as `min(r, g, b)`. Selection highlight, caret and focus ring are in the same texture as coloured pixels (`/video-text/`).
- 2D compositing: `drawElementImage()` honours `globalCompositeOperation` (`source-in`, `source-out`, `multiply`) and applies the drawn element's own `mix-blend-mode` against the canvas. `texElementSubImage2D()` does not apply it (`/video-text/`).
- Video: a video beside the canvas raises no `paint`. As a child of the drawn element it raises 30 a second even with its frame moved out or `opacity: 0` (`/video-text/`).
- Video timing: `requestVideoFrameCallback()` then a DOM write and `texImage2D(video)` in the next paint hold the same frame when the page is idle (`/video-text/`).
- Hit testing: `caretPositionFromPoint()` works on text drawn by WebGL after `updateElementGeometry()` (`/video-text/`).
- WebGPU: a software adapter refuses `copyExternalImageToTexture(video)` and `importExternalTexture(video)`. A 2D canvas in between works (`/video-text/`).
- CSS: `mix-blend-mode` inside a drawable element is kept in its picture. SVG `clip-path` and `<mask>` on a video are kept too (`/video-text/`).

## API requests

- A way to ask for a `paint` per frame of a video that is not a canvas child, or a statement that `requestVideoFrameCallback()` plus `requestPaint()` is the intended way.
- A statement in the explainer on whether `drawElementImage()` applies the element's own `mix-blend-mode`, and why the texture upload differs.
