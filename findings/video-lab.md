# Video lab (`/video-lab/`, `video-lab/gl.js`, `editor.js`, `cinema.js`, `skin.js`, `p3.js`, `gpu-player.js`)

Measured in Chromium 157 headless (C157), software rendering and software video decoding, 2026-11-21. The WebGPU rows were measured with the SwiftShader software adapter (`--enable-unsafe-webgpu --enable-unsafe-swiftshader`), off screen: the pass draws into a texture that is read back. Rows marked "script" were driven by Playwright with real mouse or touch input, at 1000 px wide and at 412 px wide with touch and a device scale factor of 2.625. Nothing here was run on a phone.

The page builds ideas 22.1 to 22.5 of the backlog in `PLAN.md`. The first three share one WebGL canvas and one context (`lib/element-gl.js`), chosen by three buttons. A scene that is not chosen has its elements hidden.

## Title editor (22.1)

| Experiment | Result | Notes |
| --- | --- | --- |
| Video clips and HTML title cards as shots, one drawable child each, one or two uploaded per paint with `texElementSubImage2D()` | works | Live check: the card's background at 1.0 s, frame 60 of the clip at 2.3 s. |
| Transition where two shots overlap: fade, wipe, and the `ripple`, `pixelate` and `swirl` GLSL of `lib/live-transition.js` | works | The three borrowed shaders are used as they are, with `transition` renamed. Each starts on the first shot and ends on the second. In the middle 53 to 98 % of the picture differs from either shot. |
| Editing a title card on the WebGL canvas (`contenteditable="plaintext-only"`) | works (script, touch) | A tap on the heading put the caret in it and typing changed the text and the row in the list. The shot in front gets its hit box with `updateElementGeometry()`. The others are moved off the canvas. |
| A card's motion as CSS functions of one custom property (`--t`) | works | `letter-spacing`, `opacity`, `scaleX` and `translate` computed from `--t` with `calc()`, `min()` and `clamp()`. The picture uploaded in a paint has the value set before that paint. |
| `exportFrames()` over several videos and cards | works | It is given an object with `currentTime`, `pause()`, `play()` and a `seeked` event that seeks every video on the timeline. 36 frames across a transition: the first is the card, the last holds frame 57 of the clip, as asked. The whole default timeline: 306 frames, VP9, 107 ms per frame at 928×522 and 138 ms at 998×748 (script). |
| Sound in the export | not built | `exportFrames()` takes one `AudioBuffer` for one video. A timeline needs the tracks mixed first. |

## Cinema screen with a `PannerNode` (22.2)

| Experiment | Result | Notes |
| --- | --- | --- |
| A `<video controls>` on a quad in perspective, drawn with the page's WebGL context | works | The clip-space matrix of the quad, multiplied into CSS pixels, goes to `updateElementGeometry()` as a `DOMMatrix` with a perspective row. |
| Native controls on that quad | work with a mouse (script) | A click on the picture started playback. `elementFromPoint()` at the projected centre returns the video. |
| The same with touch | partly (script) | A tap on the picture shows the controls and does not start playback, as on a plain video. The play button itself is small on a phone, so the page has a Play button under the canvas as well. The video element is 400 CSS pixels wide to make its controls larger on the screen. |
| Seat buttons on a floor quad | work (script, mouse and touch) | A tap on the projected button chose the seat. `getBoundingClientRect()` of a button returns its projected place. |
| `createMediaElementSource(video)` into a `PannerNode` at the screen, `AudioListener` at the seat | works | Offline render, equal-power panning: a seat 3 m to the left hears 0.09 left and 0.15 right, a seat to the right the reverse, the front row 0.24 and the back row 0.10 in each ear. With the head turned 90° to the right: 0.17 left, 0.00 right. |
| The same graph live with `panningModel: 'HRTF'` | runs (script) | The two `AnalyserNode` levels moved the way the offline render says when the seat and the head changed. The headless browser has no sound output. |
| three.js for the room | not used | The site allows one WebGL context per page. The room is three quads in the page's own context, so the three scenes share it. `/three-form/` remains the three.js version of HTML on meshes. |

## A shader on the timeline only (22.4)

| Experiment | Result | Notes |
| --- | --- | --- |
| Finding the timeline: `::-webkit-media-controls-timeline` gets a magenta background for one paint, the picture goes into a spare texture, its bottom quarter is read once | works | The box is the full width of the player and 24 CSS pixels high at the bottom. The track is drawn at the top edge of that box, 16 px in from each side. |
| Replacing only the strip | works | With each skin on and off, nothing more than three strip heights above the strip changes, and 89 to 96 % of the strip does. |
| Input on the skinned strip | works (script) | A click at 75 % of the width seeked to 76 % (mouse, 928 px wide) and 78 % (touch, 380 px wide). The native thumb travels between points 22 px inside the box, so the shader draws its playhead with that inset. |
| Keeping the timeline during playback | works | `opacity: 1 !important` on the panel and the timeline, as on `/player-parts/`. The box found last is kept while the controls are not painted. |

## Wide-gamut and HDR video in a Display P3 canvas (22.3)

The test clips are `video-lab/wide.webm` (VP9 profile 0, tagged BT.2020 primaries with the BT.709 transfer function: bars of red, green, blue and white) and `video-lab/hdr.webm` (VP9 profile 2, 10 bit, BT.2020 and PQ: a grey ramp). Pixels are read from a `drawImage()` copy in a plain canvas with the same colour space, with `getImageData({ colorSpace: 'display-p3' })`.

| Experiment | Result | Notes |
| --- | --- | --- |
| BT.2020 video, `drawElementImage()` into a 2D canvas with `colorSpace: 'display-p3'` | colours outside sRGB are kept | The red bar reads (255, 0, 13) as Display P3. From an sRGB canvas it reads (234, 51, 35), which is sRGB red. 42.9 % of the P3 canvas is outside sRGB and none of the sRGB canvas. |
| The same through `drawImage(video)` | same values | Measured before the page was written: (118, 0, 3) and (119, 21, 12) on a dark band of the bar by both routes. |
| `color(display-p3 1 0 0)` in the same element | (255, 0, 0) in the P3 canvas, (234, 51, 35) from the sRGB canvas | |
| HDR10 (PQ) video in a `float16` Display P3 canvas | at most 1.0 | The canvas multiplies its picture by 0.25 after drawing and the copy reads 64 at the brightest part. So no float readback is needed to see that the value was 1.0. The live check is marked as expected to fail. |
| HDR10 video in an 8-bit canvas | tone-mapped | White reads 255. |

## The `/player-fx/` shader in WebGPU (22.5)

| Experiment | Result | Notes |
| --- | --- | --- |
| WGSL port of the shader (meld, glass, ripple, outlines) | compiles and draws, off screen | Meld changes 87 % of the picture of a paused player, glass 13 to 16 %, outlines 95 %. |
| Controls as a texture: `GPUQueue.drawElementImageToTexture()` of the element with the frame moved out of its box | works | The texture has straight alpha. |
| Frame as a texture: `copyExternalImageToTexture({ source: video })` | fails on the software adapter | The fallback, `createImageBitmap(video)` then a copy of the bitmap, gave frame 60 as asked. Same result as on `/gpu-video/`. |
| Finding the parts through WebGPU: the probe picture into a texture with `COPY_SRC`, `copyTextureToBuffer()`, one `mapAsync()` | works | Play, timeline, mute and fullscreen were found. `GPUElementTexture` from `lib/gpu-util.js` has no `COPY_SRC`, so the probe has its own texture. |
| The player on screen | not verified | `webgpu()` refuses the software adapter. The page then draws the frame and the controls with the 2D context and says why. |

## Things that bit

- Reported from Chrome on a Mac on 2026-11-21 (WebGPU on screen, `bgra8unorm`, frame through `copyExternalImageToTexture(video)`): the meld lens became a square while the tab had focus. A hovered or focused play button has a dark disc and a focus ring behind its glyph, and the shader took the glyph's shape from alpha. It now takes it from brightness: the glyph is white. A live check gives the button a dark background and compares the lens (41 % of it changed before, 6 % after). `/player-fx/` had the same alpha test in its GLSL and has the same fix.
- The same report showed the guard's `timed-readback` warning: the parts were measured again on every `pointerenter`, `pointerdown`, play and pause, each a `mapAsync()`. They are now measured once per canvas size and once after the video loads.

- A check that compared the canvas just before and just after a transition failed when the two times fell in different video frames. The fixture's clip starts half a frame into its file, so no seek lands on a frame boundary.
- `swirl` and `pixelate` are continuous at the ends of a transition but change fast there: 0.7 % before the end, `swirl` still turns the picture by 0.15 radians. The check reads half a millisecond from each end.
- A title card at `--t` 0 has no visible text, so a tap finds nothing to edit. The editor starts stopped at 1.0 s.
- The magenta probe does not cover the whole timeline box: the track and the thumb are painted over it. The bounding box of the magenta pixels is still the element's box.
- A listener that faced the centre of the screen from every seat heard no difference between a left and a right seat. Seats face the far wall.
- A canvas `getBoundingClientRect()` in a test only helps if the point is in the viewport: `elementFromPoint()` returns null below the fold. The check canvas is fixed in a corner of the window.
- The native controls of a small video (256×144) fill its lower half, so the play button starts at half height.

## Not verified

- WebGPU on screen on the phone, and the speed. Reported working on Chrome on a Mac on 2026-11-21: the pass presents to the canvas and `copyExternalImageToTexture(video)` gives the frame. To verify on the phone, open `/video-lab/`, scroll to "The player shader in WebGPU" and read the line under the canvas, then run the live checks and read the last row.
- A wide-gamut screen: that the Display P3 canvas looks more saturated than the sRGB one. The caption under the right canvas says what gamut the screen reports.
- An HDR screen: whether the PQ clip keeps values above 1.0 in the float16 canvas there. The ninth live check reports the value.
- The sound through speakers or headphones, and whether `AudioContext` starts from a tap on the play button drawn on the screen on Android.
- Typing on a title card with the Android keyboard, and whether the keyboard moves the page.
- Export speed and the largest size the encoder accepts on the phone.
- Hardware video decoding with three decoders on one page (two clips in the editor and one in the scene last used).

## Open ideas

- Sound in the export: decode each clip's track, mix them on the timeline with an `OfflineAudioContext`, and give the result to the muxer.
- Trim handles and a thumbnail strip for each clip, drawn by the same canvas.
- A transition picker that previews each shader on the two shots it joins.
- The cinema with `HTMLTexture` in three.js once the site has a way to share one context between three.js and `ElementGL`.
- 22.6 of the backlog (animated images as canvas children) is not part of this page.

## For the index

- Video: clips and HTML cards as shots of one WebGL canvas, joined by shader transitions and exported frame by frame with `exportFrames()` driven by a timeline object (measured, C157, `/video-lab/`).
- Hit testing: a `DOMMatrix` with a perspective row passed to `updateElementGeometry()` makes native video controls and buttons take input on a quad in perspective, with a mouse and with touch (measured, C157, `/video-lab/`).
- Colour: `drawElementImage()` of a BT.2020 video into a `display-p3` 2D canvas keeps colours outside sRGB, with the same values as `drawImage(video)` (measured, C157, `/video-lab/`).
- Colour: an HDR10 (PQ) video is tone-mapped to at most 1.0 in a `float16` canvas (measured, C157, software decoding, `/video-lab/`).
- Media controls: the box of `::-webkit-media-controls-timeline` is the full width of the player and 24 px high, the track is at its top edge, and the thumb travels between points 22 px inside it (measured, C157, `/video-lab/`).
- WebGPU: the probe-colour measurement of the native controls works through `copyTextureToBuffer()` when the destination texture of `drawElementImageToTexture()` has `COPY_SRC` (measured, software adapter, C157, `/video-lab/`).
- Web Audio: `createMediaElementSource()` of a video that is a canvas child feeds a `PannerNode` (measured, C157, `/video-lab/`).
- Plan: backlog ideas 22.1 to 22.5 are built on `/video-lab/`.
