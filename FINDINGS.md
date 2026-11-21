# Findings

What the experiments in this repository measured about the HTML-in-canvas API: what works, what fails, what is only reported and what has not been verified. This file holds what applies across pages: how results are labelled, the index by API area, the Chromium bugs, the API requests and the summary. The tables for each strand of work are separate files in [findings/](findings/), one file per page or strand.

The API surface used here is the current WICG explainer shape: `<canvas content="drawable">` (older builds: `layoutsubtree`), the `drawable` attribute on drawn elements, the `paint` event, `drawElementImage()`, `captureElementImage()`, `ElementImage`, `updateElementGeometry()`, `texElementSubImage2D()` and `GPUQueue.drawElementImageToTexture()`.

Related files: [PLAN.md](PLAN.md) (open work and what needs real hardware), [ARCHITECTURE.md](ARCHITECTURE.md) (how the code uses these results), [KNOWN-LINKS-AND-RESOURCES.md](KNOWN-LINKS-AND-RESOURCES.md) (the explainer and other sources).

## How to read this file

The findings are in two places.

1. **This file.** How results are labelled, an index of the main results by API area, the Chromium bugs worth filing, the API changes the experiments asked for, and a summary in prose.
2. **[findings/](findings/), one file per page or strand of work.** Each has the full tables. The "Section" column of the index names the title of one of these files. A new page adds a new file there and does not edit this one, so two branches that record findings at the same time do not touch the same file. [findings/README.md](findings/README.md) says what goes in a file.

The index, the bug list and the API requests in this file are brought up to date from the files in `findings/` in a separate documentation pass, not in the pull request that adds a page.

Labels used in the index:

| Label | Meaning |
|---|---|
| measured | A live check on the named page, or a test script, produced the result in the named browser. |
| reported | Seen by Paul on his phone and described in the project chat. Not reproduced in the test browser. |
| inferred | Reasoned from other results or from documentation. No test produced it. |
| not verified | Built or expected, and nothing has run that could confirm it. |

Browsers:

| Short name | What it is |
|---|---|
| C157 | Chromium 157 headless shell on Linux, software rendering, no GPU, no sound, no native popup windows. The API is on by default and it behaves as if experimental web platform features were on. Dates: 2026-11-20 and 2026-11-21. |
| C153 | Chromium 153 full browser with `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement`. Used for some probes and the earliest checks. |
| A159 | Chrome 159 on an Android phone. |

Unless a row or a section says otherwise, a result in the files in `findings/` was measured in C157. Numbers for speed come from software rendering with no GPU and only show the shape of a result. Every experiment page re-runs its checks live in the browser that opens it, so the page named in the index is where to confirm a row.

Device scale factor matters. Results marked "real HiDPI" were measured with `--force-device-scale-factor` (1.5, 2 or 2.625) and no viewport emulation. DevTools and Playwright device emulation hide size bugs (see "Accessibility", "Pattern by pattern").

## Index of results by API area

One row per main result. "Section" is the title of the file in [findings/](findings/) with the detail.

### The canvas, the attributes and the paint event

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| `content="drawable"` on the canvas is required. `layoutsubtree` alone is not enough. | measured | C157 | `/start/` | not in a section; checked for the tutorial, PR #36 |
| A descendant passed to `drawElementImage()` needs the `drawable` attribute, or the call throws. | measured | C157 | `/slot/` | Slots |
| An element can be drawn only into its nearest ancestor canvas. | measured | C157 | `/slot/` | Slots |
| Direct `drawable` children of a canvas do not flow together. Each is laid out alone at the canvas origin and is shrink-to-fit. | measured | C157 | `/view-transitions/`, `/tear-off/` | View Transitions API; Cross-context |
| The computed `display` of a drawable child is `block`. An inline element or table part drawn alone loses its layout. | measured | C157 | `/elements/` | Every HTML element (PR #48) |
| `paint` fires when a drawn element's rendering changes, and `changedElements` lists only the children that repainted (a caret blink, a CSS animation). | measured | C157 | `/time-scrubber/` | Transitions and motion |
| The first `paint` can arrive before the element has a paint record, and nothing triggers another. Ask again. | measured | C157 | `/tear-off/` | Cross-context |
| No `paint` while the canvas is scrolled out of view, far off screen, clipped by `overflow: hidden`, `display: none`, `visibility: hidden`, or in a hidden tab. `opacity: 0` still paints. | measured | C157 | `/offscreen/`, `/portal/` | ElementImage and OffscreenCanvas; UI primitives |
| No `paint` while a view transition holds rendering or while its update callback is pending. | measured | C157 | `/capture/`, `/view-transitions/` | Capture; View Transitions API |
| A video, an animated image, a `marquee`, an indeterminate `progress`, a focused input, a scroll-driven animation and a `scroll-state()` change each raise `paint` with no `requestPaint()`. | measured | C157 | `/video/`, `/elements/`, `/chrome-apis/probes.html` | Video and sound; PR #48; PR #50 |
| Becoming a canvas descendant restarts an element's CSS animations. | measured | C157 | `/capture/` | Capture |
| Inserting, moving or removing an iframe inside a `paint` handler crashes the tab. | measured | C157 | `/capture/` | Capture |
| A `drawable` element nested inside another drawable element has its own picture and is left out of the outer one. | measured | C157 | `/carousel/`, `/patch/` | CSS carousel as a cover flow |
| A nested drawable element inside a scroller is clipped by the scroller, and scroll snap uses the place given to `updateElementGeometry()`. | measured | C157 | `/carousel/` | CSS carousel as a cover flow |
| Each chunk of a streamed `<template for>` patch raises one `paint` event, and `changedElements` names only the nearest drawable element around the range. | measured | C157 | `/patch/` | Declarative partial updates and moveBefore() |
| `moveBefore()` keeps the focus, animation time and uploaded texture of a drawable element. | measured | C157 | `/patch/` | Declarative partial updates and moveBefore() |
| The CSS anchor rectangle of an element in a drawn canvas child is the bounding box of its drawn quad, also under perspective. | measured | C157 | `/popovers/` | Native popovers on a tilted panel |

### drawElementImage() in a 2D context

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| `drawElementImage()` returns `undefined`. | measured | C157 | `/start/` | not in a section; checked for the tutorial, PR #36 |
| The picture is replayed paint commands. Drawing at 4× or 8× is sharp, not upscaled. | measured | C157 | `/lens/`, `/board/`, `/capture/` | UI primitives; 3D and spatial; Capture |
| With no width and height, the element is drawn in device pixels. Under `ctx.scale(devicePixelRatio)` it is then too large. Always pass a size. | measured, real HiDPI | C157 | `/a11y/` | Accessibility, Pattern by pattern |
| The default size is fractional at phone ratios (262.33 × 104.8 for a 100 × 40 element at 2.625). | measured, real HiDPI | C157 | `/transitions/` | Accessibility, Pattern by pattern |
| The nine-argument form takes a source rectangle in the element's CSS pixels. | measured | C157 | `/time-scrubber/` | Transitions and motion |
| `globalAlpha`, `filter`, `globalCompositeOperation`, transforms and clips apply. | measured | C157 | `/time-scrubber/` | Transitions and motion |
| The picture is the element's border box. A box shadow, outline, overflowing child or pseudo-element outside the box is cut off. | measured | C157 | `/capture/`, `/portal/` | Capture; UI primitives |
| A nested element with its own `drawable` attribute is left out of its `drawable` parent's picture in the video test, and included in the motion test. The two results disagree. | measured | C157 | `/video/`, `/time-scrubber/` | Video and sound; Transitions and motion |
| About 7 µs of script per call. More than about 100 clipped draws a frame is slow (85 draws 2 ms, 136 draws 140 ms). 1,000 draws of text each at its own angle take about 1.5 s. | measured, software rendering | C157 | `/perf/`, `/lens/`, `/particles/` | Performance; UI primitives; Transitions and motion |
| Pixels of drawn DOM can be read back (`getImageData`, `createImageBitmap`, `toDataURL`). The canvas is not tainted. | measured | C157 | `/offscreen/` | ElementImage and OffscreenCanvas |

### Hit testing and updateElementGeometry()

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| A 2D `drawElementImage()` moves the element's hit box to where it was drawn, at once. Clicks, focus rings, caret, selection, `getBoundingClientRect()` and `elementFromPoint()` follow. | measured | C157 | `/slot/`, `/a11y/` | Slots; Accessibility |
| Drawing an `ElementImage` also moves the live element's hit box. | measured | C157 | `/time-scrubber/` | Transitions and motion |
| WebGL and WebGPU draws do not move the hit box. Call `updateElementGeometry()`. | measured | C157 | `/slot-effects/`, `/three-form/` | Named effects and shader slots; 3D and spatial |
| `canvasTransform` accepts a `DOMMatrix` with perspective and hit testing follows it. | measured | C157 | `/slot-effects/`, `/three-form/` | Named effects and shader slots; 3D and spatial |
| A CSS `matrix3d` on the element (three's `InteractionManager` route) does not make a WebGL-drawn element hit-testable. | measured | C157 | `/three-form/` | 3D and spatial |
| `canvasClip` clips hit testing. The rectangle is in the element's own coordinates, before the transform. | measured | C157 | `/portal/` | UI primitives |
| One element has one hit box. The last draw or geometry update wins. `z-index` on the elements changes nothing. | measured | C157 | `/portal/`, `/board/`, `/select/` | UI primitives; 3D and spatial; Customisable select |
| An element that is no longer drawn keeps the hit box of its last draw until it is moved away. `clearElementGeometry()` did not remove it. | measured | C157 | `/board/`, `/three-form/` | 3D and spatial |
| Hit testing cannot be placed outside the canvas box. | measured | C157 | `/transports/` | Transport lab |
| `canvasTransform` behaved as CSS pixels on some canvases and canvas-buffer pixels on others. | measured | C157 | `/portal/` | UI primitives |
| Under the CSS `zoom` property `canvasTransform` is in unzoomed layout pixels, while client rects and pointer coordinates include the zoom. | measured | C157 | `/particles/`, `/board/` | Transitions and motion; 3D and spatial |
| `updateElementGeometry()` does not clear the browser's remembered hit-test answer for a point. `elementFromPoint()` and a click there are stale until any DOM attribute changes. | measured | C157 | `/particles/` | Transitions and motion; Native UI toolkits |
| Moving the geometry of a focused text field scrolls the page (scroll anchoring). `overflow-anchor: none` on the canvas stops it. | measured | C157 | `/three-form/` | 3D and spatial |
| Untrusted (synthetic) events do not focus, place a caret, drag a range or open a `<select>`. | measured | C157 | `/xr/` | 3D and spatial |
| A drawable canvas in the top layer takes its content out of the page's scroll chain. | measured | C157 | `/portal/` | UI primitives, Touch, top layer and live checks |
| In C157 the browser tracks where an element is drawn for anchor positioning, `interestfor`, `highlightsFromPoint()` and `OpaqueRange` rects. In C153 they use the layout box. | measured | C157, C153 | `/chrome-apis/probes.html` | PR #50 |

### ElementImage, workers and OffscreenCanvas

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| An `ElementImage` transfers to a worker and draws into the source canvas's transferred OffscreenCanvas, for many frames, until `close()`. | measured | C157, C153 | `/offscreen/` | ElementImage and OffscreenCanvas |
| An `ElementImage` draws only into its source canvas. Any other canvas throws "The source was captured from a different canvas." | measured | C157, C153 | `/offscreen/`, `/transports/` | ElementImage and OffscreenCanvas; Transport lab |
| It is transferable and not cloneable: `postMessage` and MessagePort work, same or cross origin. `structuredClone` and BroadcastChannel fail. | measured | C157, C153 | `/cross-origin/`, `/transports/` | Tabs and origins |
| `drawImage(ElementImage)`, `createImageBitmap(ElementImage)` and `new VideoFrame(ElementImage)` fail. | measured | C157 | `/transports/` | Transport lab |
| Snapshots are made only by the main thread's rendering update. A worker keeps animating old snapshots while the main thread is blocked. | measured | C157 | `/offscreen/`, `/perf/` | ElementImage and OffscreenCanvas; Performance |
| Worker draws update main-thread hit testing, batched. `elementgeometryupdate` fires on the canvas. | measured | C157 | `/offscreen/` | ElementImage and OffscreenCanvas |
| A snapshot keeps drawing after its element changes or is removed and after the canvas is resized. It has `close()` and no other member: no text, no selection. | measured | C157 | `/time-scrubber/` | Transitions and motion |
| Holding 600 snapshots costs about 0.014 ms per capture, against 0.26 ms and 33 MB for the same frames as ImageBitmaps. | measured, software rendering | C157 | `/time-scrubber/` | Transitions and motion |
| An `ElementImage` cannot follow a navigation. | measured | C157 | `/view-transitions/` | View Transitions API |

### WebGL: texElementSubImage2D()

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| The method in C157 is `gl.texElementSubImage2D()`. It takes an element or an `ElementImage`. | measured | C157 | `/shader-css/`, `/transports/` | UI primitives; Transport lab |
| Texture storage must be exactly `getElementImageDefaultSize()` rounded up. Row 0 is the top of the element. | measured | C157 | `/shader-css/` | UI primitives |
| Immutable sRGB storage (`SRGB8_ALPHA8`), `UNPACK_FLIP_Y_WEBGL` and `generateMipmap` work. RGBA8 washes out sRGB colours. | measured | C157 | `/three-form/` | 3D and spatial |
| Toolkits that blend premultiplied alpha need `UNPACK_PREMULTIPLY_ALPHA_WEBGL`. | measured | C157 | `/native-ui/` | Native UI toolkits |
| three.js r187 calls older method names, so its `HTMLTexture` draws nothing until `installThreeShims()` maps them. | measured | C157 | `/three-form/` | 3D and spatial |
| A page gets about 16 WebGL contexts. Past six to eight shaded elements, sharing one context (draw to 2D, upload, shade, copy back) gives pixel-identical output. | measured | C157 | `/shader-css/`, `/slot-effects/` | UI primitives; Named effects and shader slots |
| A canvas keeps its first context type. Switching between 2D, WebGL and WebGPU means swapping the canvas. | measured | C157 | `/slot-effects/` | Named effects and shader slots |
| A dying WebGL context fails shader compiles with an empty log before `isContextLost()` is true. | measured | C157 | `/shader-css/` | UI primitives, Touch, top layer and live checks |
| A WebGL canvas losing its context fires `webglcontextlost`, not `contextlost`. | measured | C157 | `/selection/` | Text selection |
| `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas that holds an element texture crashed the tab in two check fixtures. A smaller case did not crash. | measured | C157 | `/selection/`, `/player-fx/` | Text selection; Video and sound |
| An animated transparent WebGL canvas with drawable children became a solid white block on the phone. | reported | A159 | `/particles/` | Transitions and motion |

### WebGPU: drawElementImageToTexture()

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| The method in C157 is `GPUQueue.drawElementImageToTexture({ source: element }, { texture })`. The texture is `rgba8unorm` with `COPY_DST`, `RENDER_ATTACHMENT` and `TEXTURE_BINDING`. Row 0 is the top. Pixels are premultiplied. The canvas must hold a `webgpu` context. | measured by texture readback, software adapter | C157 | `/shader-css/` | WebGPU across the shader demos |
| WGSL versions of the effects give the same picture as GLSL (mean difference 0.00 to 0.58 of 255). | measured by texture readback, software adapter | C157 | the shader pages | WebGPU across the shader demos |
| It draws the element at its own size, so it cannot re-rasterize at a zoom. The lens starts from a 2D patch for that reason. | measured | C157 | `/lens/` | Lens pipeline |
| Showing a WebGPU canvas destroys the device in the headless test browser. | measured | C157 | the shader pages | WebGPU across the shader demos |
| Losing a WebGPU device also loses every WebGL context and large 2D canvas on the page, even when the device lived in a worker. | measured | C157 | `/slot-effects/` | Named effects and shader slots; WebGPU across the shader demos |
| WebGPU draws on screen on the phone for the `fx` attribute ("Drawn with WebGPU (6), WebGL (1)"). | reported | A159 | `/shader-css/` | not in a section; from the project notes, 2026-11-21 |
| Every other on-screen WebGPU path, its speed against WebGL, and three `WebGPURenderer`. | not verified | | the shader pages, `/three-form/` | WebGPU across the shader demos |
| `XRGPUBinding` is missing, so WebXR stays on WebGL. | measured | C157 | `/xr/` | WebGPU across the shader demos |
| A real phone GPU should do relatively better on the shader lens route than software rendering does. | inferred | | `/lens/` | Lens pipeline |

### What is in an element's picture

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Every element that lays out a box draws and hit tests: 150 of 180 entries work, 4 partly, 3 are blank, 22 have no box, 1 could not be measured. | measured | C157 | `/elements/` | PR #48 |
| Focus rings, carets, typed text, selection highlight, `::selection` colours, `::highlight()`, IME composing text, forced colours and system colours are painted. | measured | C157 | `/a11y/`, `/selection/` | Accessibility; Text selection |
| The top layer is not in the picture: a modal `<dialog>`, a popover, and the picker of a `base-select` select are painted by the page. | measured | C157 | `/transitions/`, `/select/`, `/elements/` | Transitions and motion; Customisable select; PR #48 |
| A cross-origin iframe, a cross-origin image or video without CORS, and a sandboxed opaque-origin iframe are left out. The canvas stays readable. A blank cross-origin iframe still takes clicks where it is drawn. | measured | C157 | `/cross-origin/`, `/capture/`, `/video/`, `/elements/` | Tabs and origins; Capture; Video and sound; PR #48 |
| Clear Key encrypted video is drawn black. The canvas is not tainted. | measured | C157 | `/video/` | Video and sound |
| Same-origin iframes paint, take input at any zoom and nest. | measured | C157 | `/board/` | 3D and spatial |
| Links are drawn as unvisited. | measured | C153 | `/chrome-apis/probes.html` | PR #50 |
| Spelling markers on a `spellcheck` textarea are not drawn. | measured | C157 | `/native-ui/` | Native UI toolkits |
| Find-in-page marks, `::target-text`, autofill previews. | not verified | | | Transitions and motion; Text selection |
| Permission elements (`<geolocation>` and others) are drawn and report themselves invalid (`intersection_occluded_or_distorted`). | measured | C157 | `/elements/`, `/chrome-apis/probes.html` | PR #48; PR #50 |
| A `float16` `display-p3` 2D canvas keeps values above 1.0 from a drawn element (4.0 read back as 1.82). | measured | C157, C153 | `/chrome-apis/probes.html` | PR #50 |
| Recent CSS is applied in the picture: `corner-shape`, `border-shape`, `clip-path: shape()`, gap decorations, `text-fit`, `caret-shape`, `::scroll-marker`, `::scroll-button()`. | measured | C157, C153 | `/chrome-apis/probes.html` | PR #50 |
| Native media controls, `::cue` captions and rules on `::-webkit-media-controls-*` are drawn. | measured | C157 | `/video/`, `/player-parts/` | Video and sound |

### Slots and shadow DOM

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| A light-DOM element slotted into a canvas in a shadow root draws and stays interactive. Layout and paint use the flat tree. | measured | C157, C153 | `/slot/` | Slots |
| `<slot drawable>` fails: a slot has no box. `<div drawable><slot></slot></div>` draws everything slotted into it. | measured | C157 | `/slot/` | Slots |
| Declarative shadow DOM works with no custom element. `<template shadowrootmode>` through `innerHTML` does not build a shadow root. | measured | C157 | `/slot-bare/` | Slots |
| A `<slot>` in a light-DOM canvas projects nothing. Used as a named mount point that script moves elements into, it works. | measured | C157 | `/slot-bare/plain.html`, `/slot/mount.html` | Slots |
| A shadow root on `<body>` with a canvas and named slots works for page-level slots and for capturing a whole page. | measured | C157 | `/slot-bare/`, `/capture/` | Slots; Capture |
| `moveBefore()` out of a drawable canvas and back in the same task breaks later draws of that element. | measured | C157 | `/slot/` | Slots |
| `moveBefore()` into a canvas keeps focus, caret, typed value, scroll offsets and iframes. | measured | C157 | `/capture/` | Capture |

### Across workers, tabs, origins and devices

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| 49 routes for moving DOM out of its canvas: 30 work, 15 fail, 4 cannot be tested in the test browser. | measured | C157 | `/transports/` | Transport lab |
| Sharing across documents is a pixel stream (ImageBitmap, VideoFrame, `captureStream()`, WebRTC, JPEG) plus input sent back. Semantics stay in the source document. | measured | C157 | `/cross-tab/`, `/tear-off/`, `/remote/` | Tabs and origins; Cross-context |
| A cross-origin frame can draw our `ElementImage` into our transferred OffscreenCanvas, and our clicks land on our real element under its rendering. | measured | C157 | `/cross-origin/` | Tabs and origins |
| A lent canvas is a clickjacking surface: hit testing follows the host's last draw. | measured | C157 | `/embed/` | Cross-context |
| VideoFrame and `ReadableStream<VideoFrame>` do not cross to a cross-origin document. MediaStreamTrack is not transferable in this build. | measured | C157 | `/transports/` | Transport lab |
| The real element can be moved into a popup or a Document Picture-in-Picture window and keeps its listeners, timers and values. | measured | C157 | `/tear-off/`, `/pip/` | Cross-context |
| WebRTC video plus a data channel for input works between two browser contexts on one machine. | measured | C157 | `/remote/` | Cross-context |
| Any connection between two real networks, and TURN. | not verified | | `/remote/` | Remote across real networks |
| Chrome's storage partitioning is expected to block the BroadcastChannel bridge between two real sites. | inferred | | `/tear-off/` | Cross-context |
| `adoptNode()` of a drawable canvas that has painted, into a same-origin iframe, crashes the tab. | measured | C157 | `/transports/crash-adopt.html` | Transport lab |

### Accessibility, focus and selection

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Canvas children are ordinary nodes in the accessibility tree under a "Canvas" node, however they got into the canvas (child, slot, worker, WebGL texture). | measured through the DevTools protocol | C157 | `/a11y/` | Accessibility |
| Tab order is DOM order. `window.find()` finds and highlights text. Mouse drag and double click select. | measured | C157 | `/a11y/` | Accessibility |
| A drawable child that is never drawn is still a Tab stop and in the accessibility tree, at the canvas origin. `inert` fixes it. | measured | C157 | `/a11y/` | Accessibility |
| A pixel mirror (another tab, another origin, a video) has no role, name, focus or text. | measured | C157 | `/a11y/` | Accessibility |
| Selection hit testing follows the drawn geometry, also rotated and scaled. `Range.getClientRects()` follows the drawn position and returns upright bounding boxes under rotation. | measured | C157 | `/selection/` | Text selection |
| Screen reader output, IME candidate windows, the find bar, OS magnifiers. | not verified | | `/a11y/` section C | Accessibility |

### Form controls and pickers

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Built-in form controls draw and work rotated in a canvas. | measured | C157 | `/inputs/` | Datalist and other inputs |
| A `base-select` select can hold a drawable canvas that draws its options, and keeps the value, keyboard and form entry. | measured | C157 | `/select/` | Customisable select |
| The picker of a select that is itself inside a canvas is not drawn by that canvas, and its options are not hit-testable there. | measured | C157 | `/select/`, `/elements/` | Customisable select; PR #48 |
| The select fires no `toggle` event, has no `hidePicker()`, and `showPicker()` uses up user activation. | measured | C157 | `/select/` | Customisable select |
| The built-in popups of `<input list>`, date, time and colour have no element. A canvas cannot draw them. | measured | C157 | `/datalist/`, `/inputs/` | Datalist and other inputs |
| Where native popups open for a control that is drawn transformed. | not verified | | `/inputs/`, `/elements/` | Datalist and other inputs; PR #48 |

### Video and sound

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| A `<video>` is an ordinary canvas child. `paint` fires once per video frame. After `requestVideoFrameCallback()` or `seeked`, one `requestPaint()` gives the exact frame (40 of 40, 10 of 10). | measured, software decoding | C157 | `/video/` | Video and sound |
| HTML over video can be recorded with sound, exported frame by frame with WebCodecs, and sent over WebRTC. | measured | C157 | `/overlay/` | Video and sound |
| Media state pseudo-classes (`:paused`, `:playing` and others) are valid only with experimental web platform features on. | measured | C157 | `/player-parts/` | Video and sound |
| `video.shadowRoot` is `null`. No part of the native controls can be drawn by itself. | measured | C157 | `/player-parts/` | Video and sound |
| Videos errored and the page jumped when checks started on load on the phone. | reported | A159 | the media pages | Video and sound |
| Hardware-decoded video, Widevine, HDR, audible output. | not verified | | `/video/` | Video and sound, Not verified |

### View transitions

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| A named drawable canvas works in a document view transition. The new snapshot is live. | measured | C157 | `/view-transitions/` | View Transitions API |
| A named child of the canvas gets a group and empty snapshots. | measured | C157 | `/view-transitions/` | View Transitions API |
| `element.startViewTransition()` on the canvas blanks it unless the canvas has `view-transition-name: none`. Group positions inside a canvas scope read 0,0. | measured | C157 | `/view-transitions/` | View Transitions API |
| `element.startViewTransition()` on a `drawable` child of a drawable canvas crashes the renderer. | measured | C157 | `/view-transitions/crash.html` | View Transitions API |

### Capture and export

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Any ordinary element can be wrapped in a temporary canvas and captured in the first rendering update, in about 10 to 20 ms. | measured | C157 | `/capture/` | Capture |
| Frame-exact video export: set `animation.currentTime`, ask for a paint, wrap the canvas in a `VideoFrame`, encode. | measured | C157 | `/capture/`, `/overlay/` | Capture; Video and sound |
| `page.pdf()` includes drawn DOM as a bitmap. | measured | C157 | `/capture/` | Capture |
| Whether a capture flickers on a real screen. | not verified | | `/capture/` | Capture |

### 3D, XR and native toolkits

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Live HTML on flat and curved three.js surfaces takes clicks, typing and selection through `updateElementGeometry()`. A curved surface needs the geometry re-placed on each pointer move. | measured | C157 | `/three-form/` | 3D and spatial |
| In an emulated WebXR session `paint` keeps arriving and DOM changes re-upload. Controller input is synthetic. | measured with the IWER emulator | C157 | `/xr/` | 3D and spatial |
| A real headset, Android AR, `XRQuadLayer`. | not verified | | `/xr/` | 3D and spatial |
| egui and Qt Quick compiled to WebAssembly can use DOM elements as widgets with a bridge of about 200 lines each. | measured | C157 | `/native-ui/` | Native UI toolkits |
| The browser does not know what a toolkit draws over an element, and Tab does not cross from a DOM field to a toolkit widget. | measured | C157 | `/native-ui/` | Native UI toolkits |

### Phones and lost contexts

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Live checks that scroll, focus or rebuild the visible demo are the main way a page misbehaves on a phone. | reported, then measured under phone emulation | A159, C157 | every page | Pages that hold still |
| After the fixes all 28 pages measured hold still on load. | measured, phone emulation | C157 | `npm run check:jank` | Pages that hold still |
| Paul tried the fixes on his phone and said "I think it all works". No pages were named. | reported | A159 | | not in a section; project notes, 2026-11-20 |
| `/embed/` ended as a white box on the phone. The cause was not reproduced. | reported | A159 | `/embed/` | Cross-context, Live checks and lost pictures |
| New pages showed a white box with a broken-picture icon on first load: a canvas with a lost context. | reported | A159 | `/selection/` and other new pages | Text selection |
| The cause is several WebGL contexts and a WebGPU device opened at once. | inferred | | | PLAN.md, Site-wide work that is open |
| `dvh` on a canvas stage resizes it each time the URL bar moves. Assigning `canvas.width` clears the canvas even when the value is unchanged. | measured | C157 | `/board/` | Pages that hold still |
| An opacity effect around a drawable canvas inside an iframe that is itself drawn into a canvas crashes the tab. | measured | C157 | `/board/` | Pages that hold still |

## Chromium bugs worth filing

Crashes and behaviour that looks wrong, each with where to reproduce it. All were seen in headless Chromium 157 unless the row says otherwise. None has been filed. Some may be intended behaviour: the notes say where that is likely.

| # | What happens | Reproduce | Note |
|---|---|---|---|
| 1 | Renderer crash: `element.startViewTransition()` on a `drawable` child of `<canvas content="drawable">`. | `/view-transitions/crash.html` | Crashes with or without `layoutsubtree`, with or without a draw. A child without `drawable` does not crash. |
| 2 | Tab crash: inserting, moving or removing an iframe inside a `paint` handler or a microtask of one. | `/capture/` (the library avoids it with a MessageChannel task) | The same CHECK every time (`trap int3`, same address). |
| 3 | Tab crash: `adoptNode()` of a drawable canvas that has painted into a same-origin iframe. | `/transports/crash-adopt.html`, button B | Works if the canvas has never painted. Probably the same failure as 2. |
| 4 | Tab crash: an opacity effect around a drawable canvas, inside an iframe that is itself drawn into a canvas. | `/board/` with a page tile whose fixtures sit in a box with `opacity: .02` | `visibility: hidden` does not crash. |
| 5 | Tab crash: `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas holding an element texture. | Seen in check fixtures of `/selection/` and `/player-fx/` | A smaller case with one canvas did not crash. The cause is not known. |
| 6 | `updateElementGeometry()` does not invalidate the cached hit-test result for a point. `elementFromPoint()` and a click at the same point see the old layout. | Live check on `/particles/`; also `/native-ui/` | A point 1 or 2 px away is correct. Any DOM attribute change clears it. |
| 7 | After `moveBefore()` takes an element out of a drawable canvas and back in the same task, drawing throws "The element can only be drawn into its nearest ancestor <canvas>". | `/slot/` | A plain insert works. |
| 8 | `clearElementGeometry()` does not remove the old hit region. | `/three-form/` | |
| 9 | `canvasTransform` is in CSS pixels on some canvases and buffer pixels on others. | `/portal/` on a HiDPI screen | Seen in the UI primitives work. The motion work later measured unzoomed layout pixels at 1× and 2× backing. The conditions for the difference were not isolated. |
| 10 | Losing a WebGPU device loses every WebGL context and every large 2D canvas context on the page, including when the device lived in a worker. Restored contexts came back but slots drawn into them stayed blank. | `/slot-effects/` with a software adapter | A cross-site iframe is spared. Possibly a GPU process restart, which would make it intended. |
| 11 | Setting `appearance: auto` on a `base-select` select for one style recalculation while the mouse is over the open picker leaves its computed `appearance` at `auto` until reload. | `/select/` | Chromium logs a console warning. |
| 12 | In a canvas-scoped view transition every group's transform is 0,0. Width and height are right. | `/view-transitions/` | In a document transition the group of a canvas child has the right position. |
| 13 | `element.startViewTransition()` on the canvas itself blanks the canvas for the transition. | `/view-transitions/` | Follows from the scope taking part as `view-transition-name: root` inside a canvas that renders none of its contents. May be intended. |
| 14 | A `base-select` picker of a select inside a canvas: `elementFromPoint()` at an option returns the canvas, and ArrowDown then Enter leaves the value unchanged. The picker was painted under the drawn select in some runs and not in others. | `/elements/` (PR #48) | |
| 15 | `touch-action: none` on a picker canvas and its options does not stop the page panning. | `/select/`, touch emulation | Needs a check on a real phone before it is reported. |
| 16 | The H.264 software encoder in WebCodecs crashed the tab. | Earlier testing for `/capture/` | Not re-tested. The library uses VP9 with a VP8 fallback. |
| 17 | A click on a new canvas at the spot where the pointer already rested does not focus the element under it until the pointer moves. | `/elements/` recording (PR #48) | Seen with Playwright input. |
| 18 | Reported from Chrome 159 on Android: an animated transparent WebGL canvas with drawable children becomes a solid white block. | `/particles/` with `engine="webgl"` | Not reproduced in software rendering. Cause unconfirmed. |
| 19 | Reported from Chrome 159 on Android: canvases on new pages lose their context on first load and show a white box with a broken-picture icon. | `/selection/` and other pages built on 2026-11-21 | Cause not identified. May be a resource limit and not a bug. |

## API changes that would help

Requests that came out of the experiments. Each is followed by the section that explains it.

Drawing:

- Draw an element by reference (an id) and not only by DOM containment. It would remove the need for a shadow root in the slot pattern. (Summary; Slots)
- Draw one element into more than one canvas, or draw an `ElementImage` into a second canvas. It would make cross-document reprojection possible without pixels. (Summary; ElementImage and OffscreenCanvas)
- `drawElementImage()` taking a pseudo-element or a `::part()`, so one part of a closed shadow tree (for example one media control) can be drawn. (Video and sound, Further experiments)
- A way to read a view transition's old snapshot into a canvas or texture. (View Transitions API)
- A way for top-layer content (a popover, a dialog, a select's picker) to be in a canvas's picture, or for a picker's content to keep painting for a moment after it closes. (Customisable select)

Hit testing and input:

- Several regions for one element in `updateElementGeometry()`, or a hit-test callback. It would make two pointers on shards or glyphs correct. (Summary; Transitions and motion)
- A way to describe occlusion: subtract regions from an element's geometry, or let the browser ask what covers it. Asked for by the portal, lens, 3D and native toolkit work. (3D and spatial; `docs/native-frameworks.md`)
- A way to hand the browser a ray hit (element plus point) and have it dispatch a trusted event, for XR controllers. (Summary; 3D and spatial)
- `updateElementGeometry()` invalidating cached hit-test results. (Transitions and motion)
- One documented unit for `canvasTransform`. (UI primitives)
- `touch-action` taking effect for elements drawn by a canvas in the top layer. (Customisable select)

Accessibility and focus:

- An opt-in such as "an undrawn drawable child is inert". (Summary; Accessibility)
- A way to interleave canvas-drawn widgets with real elements in the tab order. (`docs/native-frameworks.md`)

Form controls:

- `hidePicker()` and `toggle` events on a customisable select, as popovers have. (Customisable select)
- `<selectedcontent>` cloning a canvas with its bitmap, or an event when it replaces its clone. (Customisable select)
- A picker pseudo-element for `<input list>`, `type="date"`, `type="time"` and `type="color"`, as `::picker(select)` is for select. (Datalist and other inputs)
- Options in a datalist rendering their children. (Datalist and other inputs)
- A way to stop a built-in picker opening without removing the feature that provides it. (Datalist and other inputs)

Geometry:

- `getBoxQuads()`, or `Range.getClientRects()` that returns quads, so a selection on a rotated element can be measured. (Text selection)

Libraries:

- three.js using the current method names (`texElementSubImage2D`, `drawElementImageToTexture`). (3D and spatial)
- IDL-generated bindings (web-sys, Emscripten, Dart `web`) that include the new methods. (`docs/native-frameworks.md`)

## What is not verified

The full list of what waits on real hardware or a person, with how to verify each item, is in [PLAN.md](PLAN.md), "Not verified: needs real hardware or a person". Each file in [findings/](findings/) also ends with its own "Not verified" or "Not tested" note.

## Summary

The main results. Each is backed by the tables in the files in [findings/](findings/).

- The slot pattern is a real answer to "the DOM has to live inside the canvas": the markup stays in the light DOM and only the canvas moves into a shadow root.
- Reprojection across documents is a pixel stream plus input forwarding, not a shared snapshot. Semantics (selection, accessibility tree, find-in-page) stay in the source document.
- The primitives all rest on the same wrapper and the same two workarounds: stretch one canvas over everywhere the element must appear, and move the single hit-test geometry to wherever the pointer is. A way to draw one element into several canvases, and a per-region geometry, would remove both.
- One element has one hit box. Effects that show an element in many pieces (shards, glyphs) can route one pointer correctly but not two, and a way to give `updateElementGeometry` several regions, or a hit-test callback, would close that gap.
- Accessibility largely survives, with one hazard: whatever is in the canvas but not drawn is still focusable. An opt-in such as "undrawn means inert" would remove the main hazard.
- Any element can be exported with one call today, and a whole ordinary page can be wrapped in a canvas for a single frame without the user seeing it.
- A native "draw this element by reference" hook for canvas (an id reference rather than DOM containment) would remove the need for the shadow root. An ElementImage that could be drawn into a second canvas would make cross-document reprojection first class; today it is deliberately bound to one canvas.
- Every HTML element with a box draws and hit tests in a canvas (180 entries measured on `/elements/`). The exceptions are the top layer (modal dialogs, popovers, the base-select picker), other origins (blank, though a cross-origin iframe still takes clicks) and permission elements (they report themselves invalid).
- Any descendant of the canvas with `drawable` can be drawn on its own, including `<option>`, `<li>` and `<td>`, while its undrawn parent keeps working. `/element-ideas/` builds 17 demos on this. A range input turned 90 degrees cannot be dragged by touch.
- A customisable select can hand its options to a canvas inside its own picker and keep the value, the keyboard and hit testing. A select inside a canvas cannot have its picker drawn by that canvas, because the picker is in the top layer.
- Datalist, date, time and colour popups have no element, so a canvas cannot draw them. The `<datalist>` element and its options can be drawn, and a picker made of real buttons in a popover canvas can replace the others on the same input.
- For 3D, the texture half of the API is ready and the method names are the only obstacle in three.js today. The input half rests entirely on `updateElementGeometry()`: it accepts a perspective matrix, which covers every flat surface, and anything curved or occluded needs the app to re-place the element under the pointer.
- In XR there is no pointer for the browser to hit test, so input is synthetic and loses everything a trusted event does for free. A way to hand the browser a ray hit (element plus point) and have it dispatch a trusted event would remove most of `RayPointer`.
- A `<video>` is an ordinary canvas child: frames, native controls and `::cue` captions are drawn, `paint` fires once per video frame, and the frame in the canvas is the one `requestVideoFrameCallback()` reported. Cross-origin video without CORS and encrypted video are left out of the picture without tainting the canvas. HTML over video can be recorded with sound, exported frame-exactly and sent over WebRTC.
- Native UI toolkits compiled to WebAssembly can use real DOM elements as widgets today. egui and Qt Quick each took a bridge of about 200 lines and no toolkit changes. The browser does not know what the toolkit draws over an element, and focus order is not shared. Research on ten frameworks is in `docs/native-frameworks.md`.
