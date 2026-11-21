# Findings

What the experiments in this repository measured about the HTML-in-canvas API: what works, what fails, what is only reported and what has not been verified. Every thread of work appends its results to this file.

The API surface used here is the current WICG explainer shape: `<canvas content="drawable">` (older builds: `layoutsubtree`), the `drawable` attribute on drawn elements, the `paint` event, `drawElementImage()`, `captureElementImage()`, `ElementImage`, `updateElementGeometry()`, `texElementSubImage2D()` and `GPUQueue.drawElementImageToTexture()`.

Related files: [PLAN.md](PLAN.md) (open work and what needs real hardware), [ARCHITECTURE.md](ARCHITECTURE.md) (how the code uses these results), [KNOWN-LINKS-AND-RESOURCES.md](KNOWN-LINKS-AND-RESOURCES.md) (the explainer and other sources).

## How to read this file

The file has three layers.

1. **This top part.** How results are labelled, an index of the main results by API area, the Chromium bugs worth filing, and the API changes the experiments asked for.
2. **Summary.** The conclusions in prose.
3. **One section per strand of work**, in the order the work was done. Each has the full tables. A new strand appends a section at the end and adds one line to Contents. Do not reorder the sections: several branches append at the same time.

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

Unless a row or a section says otherwise, a result in the sections below was measured in C157. Numbers for speed come from software rendering with no GPU and only show the shape of a result. Every experiment page re-runs its checks live in the browser that opens it, so the page named in the index is where to confirm a row.

Device scale factor matters. Results marked "real HiDPI" were measured with `--force-device-scale-factor` (1.5, 2 or 2.625) and no viewport emulation. DevTools and Playwright device emulation hide size bugs (see "Accessibility", "Pattern by pattern").

## Index of results by API area

One row per main result. "Section" is the section of this file with the detail.

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
| A WebGL canvas losing its context fires `webglcontextlost`, not `contextlost`. | measured | C157 | `/selection/` | PR #49 |
| `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas that holds an element texture crashed the tab in two check fixtures. A smaller case did not crash. | measured | C157 | `/selection/`, `/player-fx/` | PR #49; PR #51 |
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
| Focus rings, carets, typed text, selection highlight, `::selection` colours, `::highlight()`, IME composing text, forced colours and system colours are painted. | measured | C157 | `/a11y/`, `/selection/` | Accessibility; PR #49 |
| The top layer is not in the picture: a modal `<dialog>`, a popover, and the picker of a `base-select` select are painted by the page. | measured | C157 | `/transitions/`, `/select/`, `/elements/` | Transitions and motion; Customisable select; PR #48 |
| A cross-origin iframe, a cross-origin image or video without CORS, and a sandboxed opaque-origin iframe are left out. The canvas stays readable. A blank cross-origin iframe still takes clicks where it is drawn. | measured | C157 | `/cross-origin/`, `/capture/`, `/video/`, `/elements/` | Tabs and origins; Capture; Video and sound; PR #48 |
| Clear Key encrypted video is drawn black. The canvas is not tainted. | measured | C157 | `/video/` | Video and sound |
| Same-origin iframes paint, take input at any zoom and nest. | measured | C157 | `/board/` | 3D and spatial |
| Links are drawn as unvisited. | measured | C153 | `/chrome-apis/probes.html` | PR #50 |
| Spelling markers on a `spellcheck` textarea are not drawn. | measured | C157 | `/native-ui/` | Native UI toolkits |
| Find-in-page marks, `::target-text`, autofill previews. | not verified | | | Transitions and motion; PR #49 |
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
| Selection hit testing follows the drawn geometry, also rotated and scaled. `Range.getClientRects()` follows the drawn position and returns upright bounding boxes under rotation. | measured | C157 | `/selection/` | PR #49 |
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
| New pages showed a white box with a broken-picture icon on first load: a canvas with a lost context. | reported | A159 | `/selection/` and other new pages | PR #49 |
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

- `getBoxQuads()`, or `Range.getClientRects()` that returns quads, so a selection on a rotated element can be measured. (PR #49)

Libraries:

- three.js using the current method names (`texElementSubImage2D`, `drawElementImageToTexture`). (3D and spatial)
- IDL-generated bindings (web-sys, Emscripten, Dart `web`) that include the new methods. (`docs/native-frameworks.md`)

## What is not verified

The full list of what waits on real hardware or a person, with how to verify each item, is in [PLAN.md](PLAN.md), "Not verified: needs real hardware or a person". Each section below also ends with its own "Not verified" or "Not tested" note.

## Summary

The main results. Each is backed by the tables in the sections below.

- The slot pattern is a real answer to "the DOM has to live inside the canvas": the markup stays in the light DOM and only the canvas moves into a shadow root.
- Reprojection across documents is a pixel stream plus input forwarding, not a shared snapshot. Semantics (selection, accessibility tree, find-in-page) stay in the source document.
- The primitives all rest on the same wrapper and the same two workarounds: stretch one canvas over everywhere the element must appear, and move the single hit-test geometry to wherever the pointer is. A way to draw one element into several canvases, and a per-region geometry, would remove both.
- One element has one hit box. Effects that show an element in many pieces (shards, glyphs) can route one pointer correctly but not two, and a way to give `updateElementGeometry` several regions, or a hit-test callback, would close that gap.
- Accessibility largely survives, with one hazard: whatever is in the canvas but not drawn is still focusable. An opt-in such as "undrawn means inert" would remove the main hazard.
- Any element can be exported with one call today, and a whole ordinary page can be wrapped in a canvas for a single frame without the user seeing it.
- A native "draw this element by reference" hook for canvas (an id reference rather than DOM containment) would remove the need for the shadow root. An ElementImage that could be drawn into a second canvas would make cross-document reprojection first class; today it is deliberately bound to one canvas.
- A customisable select can hand its options to a canvas inside its own picker and keep the value, the keyboard and hit testing. A select inside a canvas cannot have its picker drawn by that canvas, because the picker is in the top layer.
- Datalist, date, time and colour popups have no element, so a canvas cannot draw them. The `<datalist>` element and its options can be drawn, and a picker made of real buttons in a popover canvas can replace the others on the same input.
- For 3D, the texture half of the API is ready and the method names are the only obstacle in three.js today. The input half rests entirely on `updateElementGeometry()`: it accepts a perspective matrix, which covers every flat surface, and anything curved or occluded needs the app to re-place the element under the pointer.
- In XR there is no pointer for the browser to hit test, so input is synthetic and loses everything a trusted event does for free. A way to hand the browser a ray hit (element plus point) and have it dispatch a trusted event would remove most of `RayPointer`.
- A `<video>` is an ordinary canvas child: frames, native controls and `::cue` captions are drawn, `paint` fires once per video frame, and the frame in the canvas is the one `requestVideoFrameCallback()` reported. Cross-origin video without CORS and encrypted video are left out of the picture without tainting the canvas. HTML over video can be recorded with sound, exported frame-exactly and sent over WebRTC.
- Native UI toolkits compiled to WebAssembly can use real DOM elements as widgets today. egui and Qt Quick each took a bridge of about 200 lines and no toolkit changes. The browser does not know what the toolkit draws over an element, and focus order is not shared. Research on ten frameworks is in `docs/native-frameworks.md`.

## Contents

- [How to read this file](#how-to-read-this-file)
- [Index of results by API area](#index-of-results-by-api-area)
- [Chromium bugs worth filing](#chromium-bugs-worth-filing)
- [API changes that would help](#api-changes-that-would-help)
- [What is not verified](#what-is-not-verified)
- [Summary](#summary)
- [Slots](#slots)
- [ElementImage and OffscreenCanvas](#elementimage-and-offscreencanvas)
- [Tabs and origins](#tabs-and-origins)
- [Transport lab (/transports/)](#transport-lab-transports)
- [UI primitives (/portal/, /lens/, /shader-css/, /physical/)](#ui-primitives-portal-lens-shader-css-physical)
- [Lens pipeline (/lens/, lib/lens-gl.js)](#lens-pipeline-lens-liblens-gljs)
- [Transitions and motion (/transitions/, /time-scrubber/, /particles/)](#transitions-and-motion-transitions-time-scrubber-particles)
- [Text selection (/selection/, lib/selection-fx.js)](#text-selection-selection-libselection-fxjs)
- [Cross-context: tear-off, remote, embed, support](#cross-context-tear-off-remote-embed-support)
- [Accessibility (/a11y/)](#accessibility-a11y)
- [Capture (/capture/, public/lib/element-capture.js)](#capture-capture-publiclibelement-capturejs)
- [Performance (/perf/)](#performance-perf)
- [Video and sound (/video/, /overlay/, /audio/, /player-parts/, /player-fx/)](#video-and-sound-video-overlay-audio-player-parts-player-fx)
- [Customisable select (/select/, lib/select-picker.js)](#customisable-select-select-libselect-pickerjs)
- [Datalist and other inputs (/datalist/, /inputs/)](#datalist-and-other-inputs-datalist-inputs)
- [3D and spatial (/three-form/, /board/, /xr/)](#3d-and-spatial-three-form-board-xr)
- [Pages that hold still (npm run check:jank, tools/jank/)](#pages-that-hold-still-npm-run-checkjank-toolsjank)
- [Remote across real networks: the custom domain, STUN and TURN](#remote-across-real-networks-the-custom-domain-stun-and-turn)
- [Native UI toolkits (/native-ui/)](#native-ui-toolkits-native-ui)

## Slots

| Experiment | Result | Why |
|---|---|---|
| Draw a light-DOM element slotted into a shadow canvas | works | Layout and paint use the flat tree, so the slotted element is a canvas descendant. |
| Slotted element without `drawable` | fails | "Descendants passed to DrawElementImage must have the 'drawable' attribute." |
| `<slot drawable>` | fails | Slots are `display: contents`: no box, so "No cached paint record". |
| `<div drawable><slot></slot></div>` wrapper in the shadow tree | works | Draws everything slotted into it as one image, without touching author markup. |
| Declarative shadow DOM, no custom element | works | Only the `paint` handler needs script. |
| Manual slot assignment (`slot.assign()`) | works | |
| Slot fallback content, several elements per slot, deeply nested slots, slot-through-slot | works | |
| `<slot>` inside a light-DOM canvas picking up `slot="x"` elsewhere | fails | Slots are inert outside a shadow tree. |
| Slotting an element that isn't a child of the host | fails | `assign()` ignores non-children. |
| Shadow root on `<body>` with a canvas and named slots | works | Any top-level element opts in with `slot="…"`. |
| Clicks, focus, typing on slotted elements at their drawn position | works | `drawElementImage` updates element geometry. |
| Content from outside the component: `<canvas-slot from="#promo">`, `adopt()`, `release()` | works | Something has to move the element in. The component leaves a comment where it was and puts it back on release. `/slot/#outside` lists every route. |
| A `<slot name>` in a light-DOM canvas used as a named mount point (Extensible Web Apps pattern) | works | It projects nothing, but an element moved into it is a canvas descendant and draws. No shadow root or component. `/slot/mount.html` |
| `moveBefore()` an element out of a drawable canvas and back in the same task | fails (Chromium 157) | Afterwards drawing throws "The element can only be drawn into its nearest ancestor <canvas>". A plain insert works, so `canvas-slot.js` skips `moveBefore` for an element it moved in the last two frames. |
| Drawing in a canvas that is far off screen (for example in an unscrolled iframe) | fails until visible | "No cached paint record for element". Demos retry on a timer, and live checks run on a fixed on-screen stage (`testStage()`, `stageFrame()` in `shared/support.js`). |
| `<template shadowrootmode>` via `innerHTML` | fails | Only the parser, `setHTMLUnsafe()` and `parseHTMLUnsafe()` build the shadow root. Parsed normally, the template is consumed and the canvas inside is live at once (`/slot-bare/#template`). |

## ElementImage and OffscreenCanvas

| Experiment | Result | Why |
|---|---|---|
| Transfer ElementImage to a worker, draw into the canvas's transferred OffscreenCanvas | works | The explainer's pattern. |
| Redraw one ElementImage for many frames | works | Until `close()`. |
| Draw an ElementImage into any other canvas (new OffscreenCanvas, second canvas, another document) | fails | "The source was captured from a different canvas." Snapshots are bound to their source canvas. |
| `structuredClone(ElementImage)`, BroadcastChannel | fails | Transferable, not serializable. |
| Worker keeps animating while the main thread is blocked | works | But snapshots stop updating: only the main thread's rendering update makes them. |
| Worker draws update main-thread hit testing | works | Batched; `elementgeometryupdate` fires on the canvas. |
| Read back pixels of drawn DOM (`getImageData`, `createImageBitmap`) | works | "Read-back-allowed rendering": sensitive content is never painted, so the canvas is not tainted. |
| Source canvas with `display: none` or `visibility: hidden` | fails | No paint record is made. |
| Source canvas far off-screen | draws transparent | Culled. |
| Source canvas at `opacity: 0` | works | Usable as a hidden source. |

## Tabs and origins

| Experiment | Result | Why |
|---|---|---|
| Transfer ElementImage over MessageChannel / `window.postMessage`, same or cross origin | works | |
| Receiver draws it into its own canvas | fails | Bound to the source canvas. |
| Cross-origin frame draws our ElementImage into our transferred OffscreenCanvas | works | Canvas and snapshot must travel together. The frame can read the pixels back. |
| Our clicks land on our real element under the other origin's rendering | works | |
| ImageBitmap of drawn DOM over MessagePort / BroadcastChannel / to a popup | works | This is how the cross-tab demo moves content. |
| Same-origin iframe inside a drawable canvas | paints | |
| Cross-origin iframe inside a drawable canvas | blank | Excluded by read-back-allowed rendering. |

## Transport lab (`/transports/`)

49 routes tested live. In Chromium 157 headless: 30 work, 15 fail, 4 can't be tested there (no WebGPU adapter, no cross-origin isolation, one crash kept opt-in).

Works:
- ElementImage → its own canvas as 2D, as WebGL (`texElementSubImage2D`, element or ElementImage), on the main thread or in a worker.
- Worker owns the canvas, draws the snapshot, then `transferToImageBitmap()`, `createImageBitmap()` or `new VideoFrame()` to send pixels on. A cross-origin frame can do the same and send pixels back.
- Nested drawable canvases; a same-origin iframe as a drawable child; a page-wide overlay canvas with `pointer-events: none` (element hit-testable where drawn, page underneath still clickable).
- Pixels: ImageBitmap over MessageChannel, BroadcastChannel, cross-origin postMessage and `bitmaprenderer`; VideoFrame to a MessageChannel or worker; ArrayBuffer, Blob and data URL routes.
- Streams: `captureStream()` to `<video>`, MediaStreamTrackProcessor, `ReadableStream<VideoFrame>` to a worker, `ReadableStream<ImageBitmap>` to a cross-origin frame, MediaStreamTrackGenerator back into a `<video>`, WebRTC loopback, VP8 encode → bytes → decode.

Fails:
- ElementImage into any other canvas (2D or WebGL), `drawImage(ElementImage)`, `createImageBitmap(ElementImage)`, `new VideoFrame(ElementImage)`, `structuredClone`.
- VideoFrame and `ReadableStream<VideoFrame>` to a cross-origin document (`messageerror` / "chunk could not be cloned").
- MediaStreamTrack transfer (not transferable in this build).
- Sandboxed opaque-origin iframe inside a drawable canvas (blank).
- Hit testing outside the canvas box via `updateElementGeometry`.

Possible browser bug: `adoptNode()` of a drawable canvas into a same-origin iframe works if the canvas has never painted, and crashes the tab if it has (`/transports/crash-adopt.html`, button B).

## UI primitives (`/portal/`, `/lens/`, `/shader-css/`, `/physical/`)

Four drop-in elements in `public/lib/`, 40 live checks between them. Tested in Chromium 157 at 1×, 2× and a 2.625× phone profile with touch.

| Experiment | Result | Why |
|---|---|---|
| Wrap any element in place (shadow root, canvas, one `<div drawable><slot>`) and draw it | works | `surface.js`. The author's markup, listeners and state are untouched; only the parent changes. |
| Draw one element twice and keep both copies interactive | works | One canvas spans home and every portal. The element has one geometry, so it is pointed at the copy under the pointer. Real clicks, typing and cold touch taps work in a half-size copy. |
| Scroll with a portal on the page | no redraws | The canvas covers the union of the boxes in page coordinates, so the compositor scrolls it. |
| Portal of an element inside `overflow: hidden` | fails | The canvas is a child of the source, so the ancestor clips it. |
| Same, with the canvas in the top layer (`popover`) | works | A drawable canvas works as a popover. It escapes clipping, at the cost of painting above everything and redrawing on scroll. |
| `canvasClip` on `updateElementGeometry` | works | Clips hit testing. The rect is in the element's own coordinates, before the transform. |
| Wrapper between `<tbody>` and `<tr>`, a flex item, a block with margins | works | Margins have to move to the wrapper to keep collapsing. |
| Magnify by scaling `drawElementImage` | sharp | The paint record is replayed at the new scale: 0.6 soft pixels per ink pixel against hundreds for a stretched bitmap. |
| Fisheye in 2D | works | Not affine, so it is a polar mesh of clipped affine triangles, one draw each. Concentric scaled rings do not work: the image tears at every ring. |
| Many clipped draws per frame | slow past ~100 | 85 draws took 2ms, 136 took 140ms (software raster). The lens uses a coarse mesh while moving and refines at rest. |
| Fisheye (and any warp) as one magnified draw plus a shader | works, 8× faster | See “Lens pipeline” below. The mesh is now only the fallback without WebGL. |
| Hit testing under a lens | works | The pointer is the fixed point of the scale. A pinned lens switches geometry while the pointer is inside it. |
| `texElementSubImage2D` → fragment shader, per element | works | Texture storage must be exactly `getElementImageDefaultSize()`, rounded up. Row 0 is the top. |
| More shaded elements than WebGL contexts | works | First eight get their own context; the rest draw to 2D, copy into one shared context and back. Pixel-identical output. |
| CSS transition on a registered custom property driving a uniform | works | `--fx-progress` is sampled each frame; drawing only happens when a uniform changed. |
| WebGPU `queue.drawElementImageToTexture({ source }, { texture })` → WGSL | works | Verified by reading the texture back. Presenting a WebGPU canvas destroys the device on the headless test machine, with or without DOM. |
| Hit testing on a deforming mesh | works | Geometry is set each frame to the affine transform of the triangle under the pointer. A button drawn 85px from its layout box is still the click target. |
| Touch drag on a lens or a material | works | `touch-action: none` on the host; the lens is drawn above the finger. |

Things that bit:

- Every `drawElementImage()` call moves the element's geometry at once, so `getBoundingClientRect()` read after a magnified draw returns magnified boxes. Measure first.
- `updateElementGeometry`'s `canvasTransform` behaved as CSS pixels on some canvases and canvas-buffer pixels on others. It only shows on high-DPI screens, where it scaled hit boxes by 2.6×. The libraries measure the unit at runtime instead of assuming one.
- Anything outside the drawable element's box (a pseudo-element poking out, a shadow) is not in its image.
- One canvas means one place in z-order. A portal inside a later stacking context is covered unless the canvas is raised (`--dom-portal-z`) or moved to the top layer.

- Under the CSS `zoom` property, `getBoundingClientRect()` and pointer coordinates include the zoom while `offsetWidth`, ResizeObserver sizes and the canvas's own style do not. Geometry calibrated against one and applied in the other left hit boxes at the unzoomed size, and put the portal's canvas in the wrong place. The libraries now read `element.currentCSSZoom` and convert. Browser zoom (a `devicePixelRatio` change) never had the problem.
- On a real HiDPI screen (`--force-device-scale-factor=1.5`, not DevTools emulation) all five pages pass as they do at 1×, because every `drawElementImage()` here passes an explicit size. The one real bug it showed: when a very tall canvas is capped, width and height round separately, and using the width ratio alone cut the last few pixels off the bottom.

- A text selection inside an `fx` element is painted into its WebGL texture (about 2,000 pixels change when a heading is selected), so selection highlight goes through the shader. The find-in-page highlight itself cannot be triggered from script (`window.find()` only makes a selection), so whether it is painted still needs a person with the find bar open.

### Touch, top layer and live checks on a phone

- **A drawable canvas in the top layer takes its content out of the page's scroll chain.** With `layer="top"` the portal canvas is a popover, and its child content is hit tested there. A wheel or a finger on a document that sits inside a scrolling box then scrolls the page, not the box, so the minimap demo could not be scrolled on a phone. `<dom-portal-source>` now puts the chain back by hand: it finds the nearest scrolling ancestor with room (starting from the copy under the pointer), scrolls it on wheel, and pans it on touch with a short fling. `touch-action: pinch-zoom` on the content keeps the browser from panning the page under the finger.
- **A finger does not hover.** Portal hit testing follows the last pointer position, so after a tap on a copy the geometry stayed on that copy and the next touch on the source hit nothing. The pointer is now forgotten 350ms after a touch ends (long enough for the tap's click to land).
- **Live checks must not touch the page a visitor is using.** `scrollIntoView()` for `elementFromPoint()`, `focus()` and `scrollTo(0, 0)` at the end all fight a person on a phone. Checks on these pages now build fixtures in a small panel fixed to the bottom of the window (`checkBench()` in `shared/support.js`), which is in the viewport without scrolling, and remove it when done. Each check starts with an empty bench so canvases and GPU contexts are given back.
- **A canvas clipped away by `overflow: hidden` is not painted.** Twenty fixtures in a bench with a capped height left ten without a picture until the bench was allowed to grow.
- **The first frame can come before the canvas has its real size.** On a 2.6× screen a shader slot drew one frame at the default buffer size, was resized (which clears it), and was blank until the next paint. Wait a few frames after the first before reading pixels.
- **A dying WebGL context fails shader compiles with an empty log before `isContextLost()` turns true.** Treating that as a broken shader cached the failure and left the effect off. An empty log is now treated as a lost context and not remembered.
- **Lost or blank canvases say so.** Surfaces fall back to plain HTML with a short note when a 2D or WebGL context does not come back; the portal source swaps in a fresh canvas up to three times, then shows plain HTML and inert copies. Every page ends with a check that the visible demos still have pixels, and switches a blank one to plain HTML.
- **`fx-backend` on an adopted element was ignored**, because the wrapper connects before the element is moved into it. It only showed once fixtures stopped piling up (the page used to hit the direct-context limit by accident).

### The fx attribute as a library (`/lib/fx.js`)

- **`shader-fx.js` could not be loaded from another site.** `/lib/*` is served with `Access-Control-Allow-Origin: *`, but the module imports `/shared/backend.js`, which is not. `/lib/fx.js` is the same code joined into one file by `tools/bundle/fx.mjs`, so one request under `/lib/` is the whole library.
- **A module script that runs after the document is parsed wraps elements at once**, before a later module on the page has called `defineEffect()`. An effect defined afterwards was drawn, but with the `bleed` of the effect that was missing (0). The surface now takes its bleed from the effect each time the effect changes.
- **A second copy of the library on a page** would wrap every `[fx]` element a second time with a class that is not registered. The second copy now logs a warning and does nothing.
- **An effect with only WGSL** used to fail its GLSL compile with an empty source. It now gets the pass-through GLSL, so WebGL draws the element unshaded.

### Named effects and shader slots (`/slot-effects/`)

`<canvas-slot effect="tilt">` extends the existing element: without the attribute nothing changes. 15 live checks.

| Experiment | Result | Why |
|---|---|---|
| Several slots as textures in one WebGL canvas, each through its own shader | Works | `texElementSubImage2D` per slot, one blended full-canvas quad each. |
| Hit testing in shader mode | Works | Nothing moves the element for you (there is no `drawElementImage`), so the renderer calls `updateElementGeometry()` per slot. |
| `canvasTransform` with perspective (a 3D `DOMMatrix`) | Works | A tilted card's box narrows from 140px to 79px and `elementFromPoint` finds its button where the shader drew it. The shader samples through the inverse homography of the same matrix. |
| CSS transitions and keyframes driving uniforms | Works | Registered `--fx-*` properties are sampled each frame while on screen; a paint is requested only when one changed. |
| Switching between 2D, WebGL and WebGPU on a live element | Works, by swapping canvases | A canvas keeps its first context type. Moving the `<slot>`s to a new canvas keeps content, focus and typed values. |
| More shaded elements than WebGL contexts | Works | After six, elements keep a 2D canvas and borrow one shared context (draw slot, upload canvas, shade, copy back). Twenty on one page all draw. |
| WebGPU backend with WGSL effects | Works off-screen | `drawElementImageToTexture` into a texture per slot, read back correctly. |
| WebGPU presenting to the canvas | Fails in headless software Chrome | The device is lost on present. The element falls back to WebGL. Not yet tried on a real GPU. |

- Losing the WebGPU device took every WebGL context **and every large 2D canvas context** on the page with it. Restored contexts came back, but slots drawn into them stayed blank, so the element replaces its canvas instead of waiting for `contextrestored`.
- `fx` and `<canvas-slot effect>` are one system: `effects.js` holds the registry, the GLSL/WGSL contract and the CSS properties. `fx` wraps one element where it sits; `<canvas-slot>` composes several slots on one canvas.


## Lens pipeline (`/lens/`, `lib/lens-gl.js`)

Paul found the fisheye "super slow" on his phone. It was a polar mesh of clipped triangles, one `drawElementImage()` per triangle: 60 to 70 draws a frame while moving (sized to a 14ms budget) and 199 at rest, on top of a full-canvas redraw for every pointer move.

Every lens is now the same four steps: draw the square of page under the lens once, clipped, at the lens's magnification, into a patch of the element's own canvas; copy the patch to a texture on one shared WebGL context; run the lens's fragment shader; `drawImage()` the result back and repaint only the patch and the old lens position with the page at rest. Two paint-record replays, two copies and one shader pass per frame, whatever the lens does.

Measured in headless Chromium 157 as a phone (412px wide, `--force-device-scale-factor=2.625`, `viewport: null`, CPU 4× slower, lens radius 80, zoom 3, lens swept across the card). The test machine has no GPU, so rasterization, the copies and the shader all run in software; a real phone GPU should do relatively better on the new route, and only a phone can say by how much. The page has a "Measure on this device" button for that.

| Route | ms per frame | worst 5% | draws per frame |
|---|---|---|---|
| Fisheye, old mesh | 254 | 567 | 63 moving, 199 at rest |
| Fisheye, shader, full-size patch every frame | 115 | 167 | 2 |
| Fisheye, shader, patch sized to the frame rate | 32 | 50 | 2 |
| Magnifier, old (full canvas redraw) | 62 | 83 | 2 |
| Magnifier, shader route (redraws the lens's neighbourhood only) | 26 | 33 | 2 |
| Real glass (three ray traces per pixel) | 38 | 50 | 2 |
| Black hole | 35 | 50 | 2 |

Without CPU throttling the same sweep runs at 59 frames a second for the shader fisheye and 16 for the mesh.

| Experiment | Result | Why |
|---|---|---|
| Keep text sharp through a shader | works | The patch is rasterized at the lens's zoom by `drawElementImage()`, so the shader samples real pixels: 0.17 soft pixels per ink pixel against 3.86 for a stretched bitmap at zoom 6. The lens is drawn on whole device pixels and the patch has an even size, so at 1:1 texels land on pixels. |
| Use the element's own canvas as scratch space | works | An element image only draws into its own canvas, so the patch borrows a square near the lens and is painted over in the same task. Nothing in between is ever presented. |
| Copy a sub-rectangle of a 2D canvas into a texture | works | `texImage2D(target, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, canvas)` with `UNPACK_SKIP_PIXELS` / `UNPACK_SKIP_ROWS`. Same speed here as going through a small 2D canvas first (`copy="scratch"`); the speed test runs both because a phone may differ. |
| One WebGL context for every lens on the page | works | Shaders are compiled on first use and the canvas only grows. A lens that just animates (ripples, the black hole's glow) reuses the texture if it was the last to upload. |
| Cost per frame | scales with patch pixels | A fisheye at zoom 3 needs a patch three times the lens's width for a sharp centre: 1262px for an 80px lens at 2.625×. In software that was 70ms of the frame; mipmaps were only 9ms of it. |
| Draw the patch smaller while the lens moves | works | The element times its own frames. Over 26ms it steps the patch down (1.5×, 1×, 0.6× the lens size) and redraws at full size 140ms after the lens stops. A run of fast frames steps it back up, and each relapse doubles the run needed. |
| A physically modelled magnifying glass | works | A biconvex lens of two spherical caps, ray traced per pixel with Snell's law at both faces, once per colour channel with indices 1.508, 1.520 and 1.534. Edge distortion is real spherical aberration; the zoom slider solves for the lens's height above the page from a paraxial ray. |
| Gravitational lens | works | The point-mass lens equation β = θ − θE²/θ. Negative β samples the far side, which gives the second image inside the Einstein ring for free. |
| A lens that burns the page's own letters (the fiery eye) | works | Driven by the sampled page, not painted over it: ink is found from luminance, the page is pushed outward from the eye and stretched towards the rim, each glyph throws a flame (six samples back towards the centre), ink goes from soot to ember to white hot and crumbles against a noise threshold, and the lens ends in a ragged, glowing burn edge with sparks. The element passes the shader an eased direction (travel, or the pointer when pinned) for the pupil. Still two draws. |
| WebGPU route for the lenses | works, picked automatically | All 15 lenses are also written in WGSL (`lib/lens-gpu.js`). `queue.copyExternalImageToTexture({ source: canvas2d, origin }, …)` takes the patch straight out of the 2D canvas, a blit pipeline builds six mip levels, one render pass draws the lens into a shared WebGPU canvas and `drawImage()` copies it back. Compared with WebGL by reading the texture back: mean difference under 3 levels of 255 for every lens. |
| `drawElementImageToTexture()` for the lens | not used | It draws the element at its own size. The lens needs the patch re-rasterized at the lens's zoom, which only the 2D context's transform gives, so both GPU routes start from the 2D patch. |
| Choosing WebGPU safely | works | `shared/backend.js`: needs an adapter that is not a software one, then a self-test (clear a WebGPU canvas, `drawImage()` it to 2D, read the pixel). The headless test browser has no adapter by default and only SwiftShader with flags, so it always falls to WebGL; a dying WebGPU device takes WebGL contexts with it, which is why the test is strict. |
| X-ray overlay without `ctx.filter` | works | `difference`, `color` and a dim fill on the patch replace `grayscale() invert() sepia() hue-rotate()`; the element boxes are drawn onto the patch before the shader. |
| `getImageData()` on the demo's canvas from a check | avoided | A full-canvas readback can move a 2D canvas off the GPU, which would turn both copies into readbacks. The "still drawn" check reads a 160px copy instead. |

Not verified here: frame times on a real phone GPU, and whether Chrome on Android keeps the canvas-to-texture copy on the GPU for a sub-rectangle. The WebGPU route has only been checked by texture readback on a software adapter: presenting it on screen, and its speed against WebGL, need a real device (the speed test on the page times both).

## WebGPU across the shader demos (`/shader-css/`, `/slot-effects/`, `/particles/`, `/transitions/`, `/physical/`, `/three-form/`)

Every demo that put an element through a WebGL shader now has a WebGPU route as well, picked by itself when `shared/backend.js` says WebGPU is usable, with WebGL (and 2D where there was one) behind it. Each page has a "Drawn with" switch and a line saying what is drawing and, when that is not WebGPU, why.

| Experiment | Result | Notes |
|---|---|---|
| `GPUQueue.drawElementImageToTexture({ source: element }, { texture })` | works | Chromium 157. The texture is `rgba8unorm` with `COPY_DST`, `RENDER_ATTACHMENT` and `TEXTURE_BINDING`, sized from `canvas.getElementImageDefaultSize(el)`. Row 0 is the top of the element and the pixels are premultiplied. The canvas must hold a `webgpu` context, even if nothing is ever shown on it. |
| `fx` effects in WGSL against GLSL | same picture | none, ripple, glass, dissolve: 0.00 mean difference per channel of 255. curl 0.17, haze 0.20, tilt 0.58, crt 0.50 (the last two are animated or antialiased differently). |
| `<physical-ui>` mesh in WGSL, 4x MSAA | same picture | jelly, cloth, paper: 0.04 at rest, 0.05 to 0.13 mid-wobble. The simulation and hit testing do not change. |
| `<live-transition>` in WGSL | same picture | fade, morph, burn, ripple, pixelate, swirl 0.00; fold 0.05; shatter 0.14. A shader effect given only as GLSL moves the element to WebGL. |
| `<glyph-field engine="webgpu">`, instanced quads | same picture at rest | `engine="auto"` (the `/particles/` default now) is WebGPU, else the 2D atlas. WebGL is skipped by `auto` because it came out as a solid block on one Android phone. |
| `<canvas-slot effect>` and the `fx` attribute | WebGPU by default when usable | Only when every effect in use has WGSL source; a GLSL-only custom effect keeps that element on WebGL and the note says so. `backend="gl"` / `fx-backend="gl"` pins WebGL. |
| A custom effect typed into the page, in WGSL | works | `/shader-css/` has a WGSL editor beside the GLSL one. The text is compiled with `createShaderModule().getCompilationInfo()` before it is used, so an error shows with its line and the card keeps the last version that compiled. An effect that gains WGSL later moves its elements from WebGL to WebGPU. WGSL that fails inside an element's first frame is reported as the effect's error and no longer counts as WebGPU being broken. |
| Switching route on a live element | works | A canvas keeps its first context type, so the element swaps in a cloned canvas and moves its children across. Focus, form state and listeners stay. |
| Falling back by itself | works | Three guards: the first frame runs inside a validation error scope; the `webgpulost` event; and the first two shown frames are copied to a 24px 2D canvas, and if both are empty the element goes to WebGL with "WebGPU showed an empty canvas". The reason is on `element.gpuNote`. |
| Showing a WebGPU canvas in the headless test browser | fails | With `--enable-unsafe-webgpu --enable-unsafe-swiftshader` the adapter is SwiftShader. Render passes into textures work; `submit()` of a pass into any canvas texture (DOM or OffscreenCanvas, main thread or worker) destroys the device, with 15 sets of flags tried. So the comparisons above render to a texture and read it back (`offscreen` / `fx-offscreen` attributes). |
| A lost device and the rest of the page | collateral damage | Losing the device also loses every WebGL context and large 2D canvas on the page, even when the device lived in a worker. A cross-site iframe is spared. This is why `webgpu()` refuses software adapters. |
| three `WebGPURenderer` picked by itself | wired, not verified | `/three-form/` loads the WebGPU build when `webgpu()` passes. If the renderer does not start, falls back inside three, or loses its device, the page reloads on WebGL and shows the reason. |
| WebXR on WebGPU | not possible here | `XRGPUBinding` is missing in Chromium 157, so `/xr/` stays on three's `WebGLRenderer`. |

Not verified here, because the cloud browser cannot show a WebGPU canvas: every on-screen WebGPU path, its speed against WebGL, and three's `WebGPURenderer`. Each page has two checks for a real device: "the same picture as WebGL" (off-screen, pixel by pixel) and "on screen" (reads the shown canvas). On the cloud browser the first passes with the software adapter and the second fails with the reason.

## Transitions and motion (`/transitions/`, `/time-scrubber/`, `/particles/`)

| Experiment | Result | Why |
|---|---|---|
| Two slotted states as WebGL textures, re-uploaded every frame of a transition | works | Animations, typing, checkbox ticks and selection highlights show up on shards, folds and embers as they happen. |
| Press a button on a flying shard | works | WebGL draws don't move hit boxes, so the triangle under the pointer is found on the CPU and its affine matrix is given to `updateElementGeometry`. |
| Per-pixel routing through a burn mask | works | The shader's noise is mirrored on the CPU; `pointer-events` flips between the two states under the pointer. |
| Shared-element morph from sub-rectangles of the two state textures | works | No extra snapshots. The hole an element leaves is filled by smearing the pixels just outside it. |
| A transition written as one fragment shader (gl-transitions convention) over the two live states | works | The two textures are the two DOM states, refreshed only when they repaint. Shaders from gl-transitions.com paste in unchanged. A bad shader is refused with the compiler's log before the transition starts. |
| Hit testing inside an arbitrary shader | partly | The browser cannot know which state a pixel came from. A shader can ship a small `pick(x, y, p)` mirror (ripple does); without one the pointer goes to the old state before half way and the new one after. Shaders that move pixels (swirl) leave hit boxes at their flat positions. |
| Read the time scrubber's history back out as pictures (`frames()`) | works | Each past frame is redrawn from its ElementImages and copied with `createImageBitmap`; 13 frames of a 320 px rig at 2× came back in order, and live drawing resumed after. Not yet fed to a real encoder. |
| Live checks that run on load, on a phone | disturbing | A rig pinned over the page covers the demo, checks on the visible demo rebuild it under the reader, and a table that fills in later makes scroll anchoring jump the page. On these three pages the checks now wait until their own section is on screen (`onScreen` in `shared/on-screen.js`), run only on fixtures inside that section, list their rows up front, and never focus with scrolling or open a modal. `?checks` starts them at once. |
| Lost WebGL or 2D context | handled | A canvas with a lost context is an empty box with live, invisible controls. The elements move their slotted children out of the canvas and show them as plain HTML, then move them back on restore. The pages also read the canvas back and do the same if it comes out blank or one solid block. Tested with `WEBGL_lose_context`; a real phone losing a context has not been observed. |
| Upload a state that has never been painted (`visibility: hidden`) | fails | "No cached paint record for element." The first frame has to wait for a paint. |
| A modal `<dialog>` or popover inside a state travels with it | fails | The top layer is not part of the canvas child's picture. |
| Hold 600 ElementImages and draw the oldest | works | About 0.014 ms per capture here, against 0.26 ms and 33 MB for the same frames as ImageBitmaps. |
| Snapshot keeps drawing after its element changes, is removed, or the canvas is resized | works | After a resize its default size is recomputed for the new canvas grid. |
| Old snapshot drawn at 4× | sharp | It is replayed paint commands, not pixels. |
| `globalAlpha`, `filter`, `globalCompositeOperation` with `drawElementImage` | works | Enough for trails and ghosts. |
| `paint` event's `changedElements` | precise | Lists only children that repainted, including for a caret blink or a CSS animation. Moving elements share one snapshot across frames. |
| Select or query the text of a past frame | fails | ElementImage has `close()` and nothing else. Rewinding for real means storing state next to each frame. |
| Drawing an ElementImage | moves the hit box | The live element becomes hit-testable where its snapshot was last drawn. |
| Nine-argument `drawElementImage` (source rectangle) | works | The source rectangle is in the element's CSS pixels. The hit box moves as if the whole element had been drawn with that source-to-destination mapping. |
| Nested and inline `drawable` descendants drawn on their own | works | A parent's picture still includes them. |
| A particle per grapheme from `Range.getClientRects()`, no spans | works | Shaping, selection, links, `window.find()` and editing are untouched. |
| 1,000 upright glyph draws in 2D | works | About 17 ms in software rendering. |
| 1,000 glyph draws in 2D, each at its own angle | fails | About 1.5 s: each angle re-rasterises text. WebGL instanced quads from one texture cost well under 1 ms of script per frame for 400 glyphs. |
| `updateElementGeometry` after 2D draws in the same `paint` handler | works | It overrides the hit box the draws left behind, so pieces can be drawn anywhere while the element stays put. |
| Animated transparent WebGL canvas with drawable children on Android (Chrome 159, real phone) | reported broken | The glyph canvas became a solid white block once letters moved. Not reproducible in headless software rendering, cause unconfirmed. `<glyph-field>` now defaults to a 2D canvas with an ImageBitmap atlas (draw block, `createImageBitmap`, clear, `drawImage` per glyph, all in one `paint` handler), keeps WebGL as `engine="webgl"`, and shows plain HTML if its context is lost. |
| Click a glyph in mid-air | works for one pointer | One element, one hit box, so the box follows the pointer: the block is placed with `updateElementGeometry` so the home of the letter under the pointer sits under it. Mouse clicks and taps on a flying link letter reach the link. Two pointers at once still cannot both be right; one drawable span per letter gets a hit box each, at the cost of an element per character. |
| Ask what is at a point again after `updateElementGeometry` moved a box there | stale | Chromium 157 keeps its last hit-test answer for a point, and this call does not clear it, so `elementFromPoint` and a click at the same point still see the old layout. One pixel away is correct, and any DOM change (toggling an attribute) clears it. `<glyph-field>` and `<live-transition>` toggle `data-moved` when the box moves. Live check on `/particles/`. Worth reporting upstream. |
| CSS zoom on the motion elements | works | The canvases are sized by `devicePixelRatio × currentCSSZoom` and re-measured through a `device-pixel-content-box` ResizeObserver, and pointer positions are divided by the zoom. `canvasTransform` stays in unzoomed layout px whatever the backing store size (probed at 1× and 2× backing, zoom 1 and 1.5). |

Not tested here: whether Chrome's find-in-page highlight is painted into an element's picture (needs a person at a real browser), and frame rates on a real GPU (these numbers are from software rendering).

### View Transitions API (`/view-transitions/`)

Tested in headless Chromium 157 with `document.startViewTransition()`, `element.startViewTransition()` and `@view-transition { navigation: auto }`.

| Question | Result | Detail |
| --- | --- | --- |
| A `<canvas layoutsubtree>` with a `view-transition-name` in a document transition | works | The old snapshot is the canvas bitmap, HTML children included. The new snapshot is live: the canvas keeps getting `paint` events and a clock inside it keeps counting while the group moves and resizes. |
| `view-transition-name` on a child of the canvas | group only, no picture | `::view-transition-group(name)` exists and animates between the boxes that `drawElementImage()` (or `updateElementGeometry()`) gave the child. Both snapshots are empty. To move one element on its own, give it its own canvas and name the canvas. |
| A shader in place of the cross-fade | works | `::view-transition-old(name) { display: none }` and `::view-transition-new(name) { animation: none }` leave the live canvas showing. The view transition moves the box and `<live-transition>` draws the change. `begin()` must finish before `startViewTransition()`: no `paint` event arrives while the update callback is pending. |
| Read `::view-transition-old()` into a canvas or texture | not possible | `ViewTransition` has no call that returns pixels. A shader transition keeps its own copy of the old state. |
| `element.startViewTransition()` on an ancestor of the canvas | works | Same result as on the document. The rest of the page stays interactive. |
| `element.startViewTransition()` on the canvas itself | canvas is blank during the transition | A scope takes part in its own transition as `view-transition-name: root`. The pseudo-elements that would show its snapshot are inside the canvas, which renders none of its contents. |
| The same, with `view-transition-name: none` on the canvas | works, shows nothing by itself | The canvas keeps drawing and getting `paint` events. Named descendants get groups that are never shown. `vt.transitionRoot` is the canvas. |
| Read those hidden groups as a clock and draw the move in the canvas | works | Replace the group keyframes with one that animates a registered custom property (`--vt-p`) from 0 to 1 and read it with `getComputedStyle(canvas, '::view-transition-group(name)')`. CSS keeps control of duration, easing and per-item delay. The canvas draws each item with the nine-argument `drawElementImage()` and can add an arc, a turn and a shadow. The page stays interactive and other scoped transitions run at the same time. |
| Position of a group inside a canvas-scoped transition | wrong | Width and height are right. The transform is 0,0 for every group, so positions have to be measured with `offsetLeft` and `offsetTop` before and after the change. In a document transition the group of a canvas child has the right position. |
| Flow layout of direct canvas children | no | Each `drawable` child is laid out alone at the canvas origin. Put a grid or flex container in as one `drawable` child and name its children. |
| `element.startViewTransition()` on a `drawable` child of `<canvas content="drawable">` | renderer crash | Crashes with or without `layoutsubtree`, with or without a draw, and with `view-transition-name: none` on the child. A child without the `drawable` attribute does not crash. A canvas without `content="drawable"` rejects with "Unsupported layout or style". Reproduction: `/view-transitions/crash.html`. |
| Cross-document transition with a named canvas on both pages | works | The canvas cross-fades and morphs like an image. `pagereveal` can fire before a module script runs, so listen for it in a classic script. |
| A shader between two documents | works with pixels | An `ElementImage` cannot follow a navigation. The old page stores a WebP of its canvas in `sessionStorage` before navigating. The new page inserts it as the first state of a `<live-transition>` and burns to the real content. The old snapshot stays visible underneath until the canvas has drawn. When the two boxes have different shapes the stored picture is stretched. |

Element-scoped view transitions shipped in Chrome 147 (developer testing from 140). References: https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions, https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using_element-scoped, https://drafts.csswg.org/css-view-transitions-2/.

Not tried yet: the canvas-scoped clock driving a WebGL or WebGPU shader; a scoped transition on an ancestor with a canvas-scoped one nested inside it; Navigation API `intercept()` with a shader for single-page route changes; `view-transition-class` and nested groups with one canvas per list item; one page-wide canvas that draws every transition itself.

## Cross-context: tear-off, remote, embed, support

Verified in headless Chromium 157 on 2026-11-20, with two local Workers as two origins. Pages: `/tear-off/`, `/remote/`, `/embed/`, `/support/`. Not yet run in a real browser, on a real phone, or in Safari and Firefox (the viewer pages are written not to need the API).

The building block is `live-surface.js`: any element gets a shadow root holding `<canvas content="drawable"><div drawable><slot></slot></div></canvas>`, so its children stay in the light DOM and are painted through the canvas.

| Experiment | Result | Why |
|---|---|---|
| Convert an existing element in place (`attachSurface(el)`) | works | Children do not move in the DOM or on screen. Grid and flex hosts need their layout properties copied to the inner box. |
| Children of a drawable canvas fill its width like blocks | fails | They are shrink-to-fit. The inner box needs `width: 100%`. |
| Canvas backing store at 2x on a 1x screen | works | The DOM is re-rasterised sharp, not scaled. `drawElementImage()` then needs an explicit width and height, because the default is the snapshot's pixel size. |
| Two renderings of one element in one `paint` | works | Draw 1:1, `drawImage()` the canvas to a second canvas, `reset()`, draw the effect. The copy is the clean, shareable frame. |
| Redaction by selector | works | Rects of `[data-private]` and password inputs are filled on the copy only. The local canvas is untouched. |
| `captureStream()` on the copy (a canvas not in the document) | works | Feeds `<video>`, video Picture-in-Picture and WebRTC. |
| First `paint` always has a snapshot | fails | It can arrive before the element has a paint record, and nothing triggers another. Ask again until one succeeds. |
| A frame scrolled out of view keeps painting | fails | No `paint`, so nothing to send. Same for a hidden tab. |

Tear-off (`/tear-off/`, 11 routes, each clicked through with a real popup):

| Route | Result | Notes |
|---|---|---|
| `window.open` + MessagePort, pixels out and input back | works | Same origin and cross-origin. |
| `about:blank` popup scripted by the opener | works | No messages: direct calls, ImageBitmaps passed by reference. |
| Move the real element into the popup (`popup.document.body.append(el)`) | works | Listeners, timers and input values survive. Closing the popup brings it home. Needs a window reference and the same origin. |
| A moved element painted by a canvas in its new document | works | So the destination can stream it onward. |
| Document Picture-in-Picture, streamed or with the real DOM | works | `requestWindow()` works in headless. |
| Video Picture-in-Picture | works | View only. Media Session actions are mapped to the widget's buttons; not checked visually. |
| `noopener` tab over BroadcastChannel | works | ImageBitmaps are cloned. Input comes back on the same channel. |
| `noopener` tab over a SharedWorker-brokered MessagePort | works | |
| `noopener` tab, same or other origin, over the Worker relay and WebRTC | works | The only route that crosses browsers and devices. |
| `localStorage` events carrying a JPEG data URL | works | Not recommended. |
| Other origin, no link, bridge frame from the source origin using BroadcastChannel | works here | Also worked with `localhost` and `127.0.0.1` as the two sites. Chrome's storage partitioning is expected to block the cross-site case; check in a real browser. |
| Adopt a whole painted `<live-region>` into another document | works | Did not reproduce the earlier `adoptNode()` crash in this shape. Kept behind a button. |

Remote (`/remote/`): WebRTC video plus a data channel for input, signalled through a Durable Object room, works between two browser contexts including an emulated phone. Relayed JPEGs through the room work when WebRTC is refused. Phone keyboards send `input` events rather than keys, and a `<select>` popup cannot be streamed, so the viewer raises its own keyboard and its own native picker. Both are tested with synthetic events, not a real phone. No TURN server is configured.

Embed (`/embed/`):

| Experiment | Result | Why |
|---|---|---|
| Host draws a cross-origin card through a WebGL shader and clicks land | works | The shader's screen-to-source function is repeated in JS for the pointer. |
| Host restyles the card | works, by contract | The card accepts five custom properties and ignores everything else. |
| Host resizes the card | works | The card reflows in its own document. |
| Fallback content of the host canvas as an accessible proxy | works | Buttons and fields rebuilt from the card's element map. Not tested with a screen reader. |
| Card lends its canvas; host draws; the card's real button is clicked natively | works | Hit testing follows the host's last `drawElementImage()`. That is a clickjacking surface the embed opts into. |

Support (`/support/`): a region picked by the user reaches an agent console as video, with the agent's pointer drawn on the user's canvas and control refused until the user allows it. The model variant sends a JPEG and the element list to Workers AI. Checked once by hand against the API with a real 260 px frame: Mistral Small 3.1 answered correctly in about 1 s, Llama 4 Scout in about 12 s, and Gemma 4 returned an empty answer. The Worker endpoint itself has not run with the AI binding yet (local dev has none).

### Portable widgets (`/slot-view/`, `lib/slot-view.js`, `lib/slot-provider.js`)

`<slot-view src name>` shows a named piece of another site's page with no iframe box, and the providing site asks the person before anything leaves. The protocol is written down in `public/slot-view/PROTOCOL.md`.

| Experiment | Result | Notes |
| --- | --- | --- |
| A cross-origin piece sized by its content, on the text baseline of a sentence | works | The provider reports its size and the distance from its first baseline to its bottom edge; the element sets `vertical-align` to match. |
| Text wrapping round the piece's outline | works | `shape-outside: url(…)` built from the alpha of the frames. The browser lays a shape image out at its own pixel size, so it must be made exactly as many pixels as the element has CSS pixels. |
| Canvas shrinking to its content | fails, worked around | A drawable canvas has no intrinsic width, so `width: max-content` on its host gives nothing useful. The provider measures the region's one child and sets the width in pixels. |
| No pixel or element map before consent | works | Every protocol message before the grant is refused. |
| Consent that the embedder cannot fake | works | The question is drawn in the provider's real frame, never in the pictures, and only a trusted click answers it. `IntersectionObserver` v2 (`trackVisibility`) turns Allow off when the embedder fades, filters or covers the frame. |
| Consent in a window on the provider's origin (for inline or small embeds) | works | The window has to find the waiting frame by itself. `opener.frames` does not list it, because frames inside a shadow root are left out of `window.frames`. `window.open('', name)` with the frame's window name does find it, and same-origin access then works even though the frame's storage is partitioned. A BroadcastChannel is the third try; not needed in Chromium 157. |
| Consent window opened by the frame itself | works | When Allow is switched off, the prompt offers this. The click in the frame gives it the activation to open a window. |
| View and input granted separately; public view-only slots | works | A slot marked `slot-consent="none"` arrives with no prompt and refuses input. |
| A guarded button (`data-trusted`) pressed by forwarded input | refused, as designed | The provider asks the person to confirm in its frame or window. The embedder can dismiss the question but cannot answer yes. |
| Grant remembered per embedding site | works | Kept in the frame's `localStorage`, which the browser already partitions by top-level site. |
| Theme contract | works | Custom properties on the provider's list are applied; the rest are reported back as ignored. |
| Provider without HTML-in-canvas | falls back | The element shows the frame as it is. |

Found on the way: `serve()` dropped a frame that arrived while the previous one was being packed, so a viewer could be left with a blank default-sized first picture until the next change. It now sends once more when that happens, and never sends before the first paint.

Not tested: real cross-site storage partitioning (headless Chromium on two localhost ports is same-site), so the window-name route needs a look on the two deployed Workers. Android opens the consent window as a tab; untested on a real phone.

### Picture-in-picture for any element (`/pip/`, `lib/element-pip.js`)

`pipElement(el, { mode })` floats any element. The tear-off demo had these routes for its own widgets; this is the same thing as one call.

| Mode | Result | Notes |
| --- | --- | --- |
| `move`: Document PiP, the real element adopted by the floating window | works | Needs no HTML-in-canvas. Stylesheets are copied across. While the element is away, `document.getElementById()` in the page no longer finds it, so page code must hold references. |
| `stream`: Document PiP showing a live picture, input sent back | works | The element stays in the page. Stops updating while the tab is hidden, because `paint` stops. |
| `video`: `captureStream()` into classic video PiP | works, view only | Media Session actions can be mapped to buttons inside the element. A fresh surface must paint once before the stream has a size. |
| Elements that cannot take a shadow root (`button`, `table`, `form`, `svg`) | works by wrapping | They get a `<live-region>` wrapper. An inline-block holding a canvas sits on the line by its bottom edge, not the text baseline, so the wrapper is lowered by how far the element hung below the baseline. Layout then moves by less than 0.1 px. Table parts (`tr`, `td`) cannot be wrapped. |
| Opening without a click | refused | `NotAllowedError`, as it should be. |

Device pixels: every `drawElementImage()` call in these pages passes a width and height. Checked at a real `--force-device-scale-factor=1.5`: all live checks pass and a click on a streamed picture lands on the right button.

### Live checks and lost pictures on a real phone

Reported on Chrome for Android: `/embed/` drew correctly, then the page jumped about, and it ended as a white box. Not reproducible in emulation, so these are the causes found by reading and what was done about each.

- **The checks drove the visible demo.** They changed its effect, restyled it, shrank it to 62% (the page reflowed), scrolled to the second demo and scrolled back. If the last check timed out, the scroll back never ran. Checks that press, type, restyle, resize or scroll now run in a hidden second copy of the page (`apart: true` in `runTests`, an invisible frame of the same URL plus `?bench`, removed when done). Applied to `/embed/`, `/tear-off/`, `/remote/`, `/support/`, `/pip/` and `/slot-view/`. Measured in Chromium: no scroll, focus or DOM change on the visible page while the checks run.
- **Nothing handled a lost graphics context.** `<live-card>` had no `webglcontextlost` handler, so a dropped context left a transparent canvas, which on the pale backdrop is a white box. It now says so over the card, restores itself on `webglcontextrestored`, and has a Try again button. Simulated with `WEBGL_lose_context`: message shown, picture back after restore.
- **A blank picture looked like a working one.** `LiveSurface` now repaints on `contextrestored` and when the page becomes visible again, checks once a second whether the outgoing picture is one flat colour, and tells viewers (`{ t: 'trouble' }`). `<live-view>` and `<live-card>` show a message instead of the dead picture. Each page has a check that fails on a blank result.
- **One failed draw in the lent-canvas demo stopped it for good.** It now asks the frame for a new snapshot and keeps going.
- Found while moving the checks: a remembered `<slot-view>` grant never sent the provider's `app` messages (an early return skipped the line that set it up).

Not confirmed without the phone: which of these Paul actually hit, and whether a 2D drawable canvas on Android fires `contextlost` at all when its pixels are dropped. The hidden copy doubles the page's canvases for the few seconds the checks run, which on a small GPU could itself cause a context loss; the visible demo now recovers from one.

## Accessibility (`/a11y/`)

Measured in Chromium 157 headless on 2026-11-20: in-page probes, plus the DevTools protocol for the accessibility tree, real key and mouse input, IME composition and forced-colours emulation. Screen reader output, the find bar, IME candidate windows, native popups and OS magnifiers are not automated: `/a11y/` section C is the list to try by hand.

| Check | Result | Notes |
|---|---|---|
| Accessibility tree | works | Canvas children are ordinary nodes under a "Canvas" node, with the same roles and names as outside a canvas. |
| Tab order, focus ring, caret | works | Real Tab walks canvas children in DOM order. Focus rings, carets and typed text are painted, and each focus change fires `paint` with the right `changedElements`. |
| Geometry (`getBoundingClientRect`, `elementFromPoint`, `scrollIntoView`) | works | Follows where the element is drawn, including under rotation and scale. |
| Mouse: click, caret placement, drag and double-click selection | works | |
| Selection highlight, `window.find()` | works | Both are painted into the canvas. |
| IME composition (`Input.imeSetComposition`) | works | Composition events fire and composing text is painted. |
| Forced colours, system colours, `light-dark()` | works | Painted with their real values. The explainer allows system colours to be left out; this build paints them. |
| A drawable child the paint handler never draws | hazard | Still a Tab stop and still in the accessibility tree, reported at the canvas origin. Focus lands on nothing visible. `inert` on undrawn children fixes it; nothing does that for you. |
| WebGL (`texElementSubImage2D`) | hazard | No geometry until the author calls `updateElementGeometry`: the texture is on screen but hit testing and focus position are not. |
| Pixel mirrors (`drawImage(canvas)`, other tabs, other origins) | hazard | A plain canvas with no role, name, focus or text. Needs its own label. |
| Zoom | author's job | Layout and hit testing follow, but a canvas with a fixed `width` attribute is stretched. `<canvas-slot>` resizes itself with a device-pixel ResizeObserver; most hand-written canvases here do not. |

Per-demo results (the same audit, `public/lib/a11y-audit.js`, run over every page in `shared/demos.js`): geometry, focus, names, find and selection hold up wherever content is actually drawn. The recurring caveats are canvases that go soft at 150% zoom (`/slot-bare/`, `/offscreen/`, `/cross-origin/`, `/transitions/`, `/time-scrubber/`, `/particles/`), continuous animation with no `prefers-reduced-motion` handling (`/slot/`, `/transitions/`, `/particles/`), unlabelled pixel-only canvases (`/cross-origin/`, `/transports/`), and one invisible tab stop: the lent card's button on `/cross-origin/` was not hit-testable in the audit frame.

### Pattern by pattern (`/a11y/` section B, `/a11y/pattern.html?p=…`)

The same card (heading, sentence, text field, button, link) built into a canvas thirteen ways, measured live, plus a recording made from outside with the DevTools protocol (`a11y/patterns-recorded.json`: real accessibility tree, real Tab key, real mouse, real devicePixelRatio 1.5).

| Pattern | Accessibility tree | Focus order | Find in page | Selection | Zoom |
| --- | --- | --- | --- | --- | --- |
| Child of the canvas, `<canvas-slot>`, bare slot in a shadow canvas, `light-slots.js` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Shadow root on `<body>`, page overlay canvas | ✓ | ✓ | ✓ | ✓ | ✓ |
| Drawn by a worker (`<canvas-slot worker>`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `<dom-portal>`, Shader CSS, `<dom-lens>`, `<physical-ui>` | ✓ | ✓ | ✓ | ✓ | ! CSS `zoom` |
| `<live-transition>` | ✓ | ✓ | ✓ | ✓ | ! stretched under CSS `zoom` |
| Pixel mirror (other tab, other origin, video) | ✗ | ✗ | ✗ | ✗ | ! |

- **How the DOM gets into the canvas does not matter to assistive technology.** In every live pattern the accessibility tree has the same four nodes with the same roles and names, as children of one `Canvas` node; a real Tab key visits field, button, link in DOM order; `window.find()` finds and highlights the text; a real mouse drag selects it. Slots, shadow roots on body, workers, WebGL textures: all the same.
- **The differences are all in zoom.** Patterns that place the element with their own transform (`updateElementGeometry`, or a canvas sized from `devicePixelRatio`) ignore the CSS `zoom` property: the page grows, the drawing grows, but the element's reported box stays the old size, so clicks near the far edges miss. Real browser zoom is a devicePixelRatio change, and at a real ratio of 1.5 all twelve live patterns are sharp and clickable.
- `<physical-ui>` is the one pattern where a mouse drag does not select text: the drag grabs the material. Keyboard selection and find still work.
- A pixel mirror fails everything, by construction. It needs a label and a way back to the live element.
- **`drawElementImage(el, x, y)` without a size draws in device pixels.** On a real HiDPI screen the element comes out at `devicePixelRatio` × its CSS size in canvas pixels, which is right for an unscaled context and wrong after `ctx.scale(devicePixelRatio, devicePixelRatio)`: it is then drawn (and hit-tested) dpr times too large. Pass the size: `drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight)`. Measured at 1, 1.5 and 2 with `--force-device-scale-factor`.
- **Emulated device pixel ratios mislead in a different way.** DevTools device emulation and Playwright's `deviceScaleFactor` change `devicePixelRatio` and the snapshot size, but `devicePixelContentBoxSize` keeps reporting CSS pixels. A canvas sized from that box stays at 1× under emulation, its scale factor is 1, and the oversize drawing never shows. Test HiDPI with `--force-device-scale-factor` (and no viewport emulation), or on a device. The default size is also fractional at real phone ratios (262.33 × 104.8 for a 100 × 40 element at 2.625, measured in the motion thread), one more reason to pass the size.

### Staying calm on a phone

- Live checks that run on load are the main way a demo misbehaves on a phone: a test that calls `focus()` on a field opens the keyboard, `scrollIntoView` or moving a focused element makes the browser scroll the page, and rows of results arriving push the demo around.
- The audit now measures this for every demo, before it touches the page: scroll position still at the top, nothing focused, cumulative layout shift while loading, and whether each canvas shows a picture (`canvasState(canvas)`: drawn, blank, one solid colour, WebGL context lost). `/a11y/?url=/slot/` checks one page.
- A WebGL canvas reads back empty outside a frame, so it is sampled from inside `requestAnimationFrame` callbacks, and an empty read is reported as "could not be read", not "blank".
- What keeps a test page calm: fixtures in a `position: fixed` strip inside the viewport (nothing to scroll to), `inputmode="none"` on any field a test focuses (focus without the keyboard), restore scroll after a run, and start anything heavy from a button on touch devices (`(hover: hover) and (pointer: fine)` tells them apart).

## Capture (`/capture/`, `public/lib/element-capture.js`)

| Experiment | Result | Why |
|---|---|---|
| Wrap an ordinary element in a temporary canvas and snapshot it | works | Ready in the first rendering update: the `paint` event fires in the frame the canvas was inserted. About 10 to 20 ms. |
| Move the element in with `moveBefore()` | works | Focus, caret, typed value, scroll offsets and iframes survive; custom elements get `connectedMoveCallback`, not disconnect. |
| CSS animations across the move | restart | Becoming a canvas descendant restarts them (attaching a shadow root does too). Reading `currentTime` before and seeking after hides it. |
| `drawElementImage(el, 0, 0, w × 4, h × 4)` | works | Re-rasterized, not upscaled: a 1px line becomes 4 hard pixels. Print-quality output from any element. |
| `parent > child` selectors during capture | fails | The canvas is the element's parent for that frame. |
| Box-shadow and outline outside the border box | cut off | `drawElementImage` draws the border box. |
| Element already in a drawable 2D canvas | works | Borrow that canvas for one synchronous tiled draw with `preserveElementGeometry`, then restore its pixels. |
| Element in a worker-owned canvas | clone only | No context on the main thread to draw with. |
| Cross-origin iframe; cross-origin image without CORS | blank | Left out by design; the canvas stays readable. With CORS the image paints. |
| `canvas.captureStream()` + MediaRecorder on the temporary canvas | works | The element stays live and clickable while it is recorded. |
| Printing a page that has a drawable canvas | works | `page.pdf()` includes the drawn DOM as a bitmap. |
| Body shadow root: `canvas > div[drawable] > slot` | works | Whole page captured with no light-DOM mutation; selectors, focus, caret, iframes and scroll position untouched. The shadow root cannot be removed afterwards. |
| Move body's children into a canvas and back (in flow, or a fixed overlay) | works | Needs `moveBefore()`. The page sees mutation records, `body > x` selectors stop matching for the frame, and the browser scrolls when the focused element moves back (restored). |
| Body already has an open shadow root | works via move | Moving the page's own shadow tree into a canvas drops focus, so `capturePage()` uses the move route instead. |
| Body has a closed shadow root | works via move | `attachShadow` throws; the canvas goes in the light DOM. |
| Fixed and sticky elements | works for a viewport shot | A drawable element is a containing block, so the capture wraps content in a viewport-sized frame with an inner scroller. In a full-page shot fixed elements land at the document end and sticky ones at their static position. |
| View transition to hide the swap | fails | `paint` events do not fire while a view transition holds rendering; the capture waited out the 4s timeout. |
| Flicker | none measured | The snapshot is drawn in the frame the canvas appears. Headless screencasts do not show canvas content, so this still wants an eye: the "Flicker check" button runs 30 captures. |

Browser bug: inserting, moving or removing an iframe from inside a `paint` handler (or a microtask of one) crashes the tab, the same CHECK every time (`trap int3`, same address). Taking an iframe-holding subtree out of a canvas in that handler does it, and so does appending a new iframe to `<body>`. The library leaves the paint event with a MessageChannel task before touching the DOM. This is probably the same failure as the `adoptNode` crash above.

### Video with WebCodecs and print-quality PNG

- **`exportVideo(el, { fps })` is frame-exact.** Animations under the element are paused and their `currentTime` stepped one frame at a time; each frame is drawn in a paint event, wrapped in a `VideoFrame` and encoded with `VideoEncoder` (VP9, VP8 fallback). A square animated 160px in 1s is found at x = 0, 80, 144 at 0, 0.5 and 0.9s: exactly where it should be. One rendering update per frame, so 144 frames at 640×360 took 2.4s here.
- Setting `animation.currentTime` and asking for a paint gives that time's pixels in the very next paint event. No extra frame of delay.
- Script-driven motion is stepped with an `onframe(ms)` callback; motion that cannot be stepped uses `mode: 'realtime'`. `encodeFrames(iterable)` encodes frames you already have, in the `{ time, bitmap }` shape `<dom-rewind>.frames()` yields.
- **WebM needs no library.** `lib/webm-mux.js` is about a hundred lines: EBML header, Info with a real duration, one track, Cues before the clusters (so the file seeks), one cluster per key frame. Chrome plays and seeks the result. MP4 would need a larger muxer and H.264, whose software encoder crashed the tab in earlier testing.
- `captureElement(el, { dpi: 300 })` re-rasterizes at 3.125× and writes a PNG `pHYs` chunk, so the file opens at the element's real size in print tools. A 1px rule comes out as 3 crisp pixels.

## Performance (`/perf/`)

The page ramps 10 to 1,600 moving elements per renderer and reports where the frame rate falls below 90% of the display's refresh. Numbers from headless Chromium use software rendering and only show the shape; run it on real hardware for the wall.

- Script is not the limit. A `drawElementImage` call costs about 7 µs, so 200 cards is roughly 1 ms of a frame. Rasterising and compositing run out first.
- In software rendering the 2D canvas carried more moving cards (200 at 60 fps) than the same cards as individually composited DOM layers (100).
- A worker holding `ElementImage` snapshots costs the main thread nothing per frame when content is static. With the main thread blocked 40 ms per frame, a main-thread canvas drops to 23 fps and the worker stays at 60 fps (content updates at the main thread's rate, motion stays smooth).
- The worker has no advantage when every element changes every frame: each one needs a fresh snapshot captured on the main thread.

## Customisable select (`/select/`, `lib/select-picker.js`)

Measured in headless Chromium 157 with software rendering on 2026-11-21, driven by Playwright with a mouse, a keyboard and emulated touch. Not yet tried on a phone.

A select with `appearance: base-select` has a picker made of HTML in the top layer. Two combinations were tested: a canvas inside the select, and a select inside a canvas.

| Experiment | Result | Why |
|---|---|---|
| `<select><canvas content="drawable"><option drawable>` | works | The select collects options from all its descendants. `select.options`, the value, the form entry, arrow keys, typeahead, Enter and Escape are unchanged. |
| The picker canvas draws each option under its own 2D transform | works | `drawElementImage()` moves the option's hit box. Click, hover and `:checked` are the browser's. |
| Options as WebGL textures with a perspective matrix | works | `texElementSubImage2D()`, then `updateElementGeometry()` with the same matrix the shader uses. |
| Options as WebGPU textures | works off screen | `drawElementImageToTexture()` into a texture, read back. Not shown on a canvas here: the software adapter loses its device when it presents. |
| Two options overlap | the one drawn last gets the click | The last `drawElementImage()` or `updateElementGeometry()` wins. `z-index` on the options has no effect. |
| An option the canvas does not draw | keeps its last hit box | The library moves it far outside the canvas. It stays reachable by arrow key. |
| `toggle` or `beforetoggle` on the select when the picker opens | no event | The canvas's first `paint` event is the earliest signal. Before it the options have no paint record. |
| Close the picker from script | works, with a workaround | There is `showPicker()` and no `hidePicker()`. `blur()`, a synthetic Escape, `option.click()`, `disabled`, `inert` and `display: none` restored in the same task all leave it open. Showing an empty `popover="auto"` element closes it: the picker is in the popover stack. |
| Close the picker by setting `appearance: auto` for one style recalculation | closes it, then breaks the select | Chromium logs a console warning. If the mouse is over the picker at that moment, the select's computed `appearance` stays `auto` afterwards, whatever the stylesheet and inline style say, and it is the browser's own select until reload. |
| Open several pickers from one tap | fails | `showPicker()` needs user activation and uses it up. One tap opens one picker. Synthetic clicks and key events do not open one. |
| Mouse press on an option, drag, release over another option | chooses the second | The select chooses on mouseup. The library captures the pointer on the canvas once a drag passes 7 px. |
| `touch-action: none` on the picker canvas and on the options | does not stop the page panning | In touch emulation a vertical drag in the picker scrolled the page and cancelled the pointer. Cancelling `touchmove` stops it. |
| An animation when the picker closes | fails | The options stop painting in the frame the picker closes, so the canvas has nothing to draw. |
| A canvas inside an option draws its own drawable child | works while open | With the picker closed: "No cached paint record". A plain canvas in an option that is given pixels with `drawImage()` can be drawn at any time. |
| `<selectedcontent>` with a canvas in the chosen option | clones the element only | The clone has no pixels and no `paint` handler, and it is replaced on every change. Its cloned children are drawable in it. |
| `position-area: center` on `::picker(select)` | works | The radial picker opens centred on the button. |
| A select as a drawable child of a canvas, drawn rotated | works | The button is hit tested where it is drawn. |
| The picker of that select in the canvas's picture | fails | The picker is top-layer content. The browser paints it upright, anchored to the bounding box of the drawn button. |
| The outer canvas draws an option of the open picker | fails | "No cached paint record for element." |
| A canvas-drawn picker inside a select that is itself drawn by a canvas | works | Two nested drawable canvases. The inner one is in the top layer while the picker is open. |
| A canvas in the select's `<button>` with `<selectedcontent drawable>` inside it | works | The browser still fills `<selectedcontent>` on every change, and the canvas draws it. `rollSelected()` keeps the old value's pixels and rolls the new value in. |
| `display` set on `::picker(select)` without `:open` | renders the closed picker | A rule such as `::picker(select) { display: flex }` overrides the rule that hides the closed picker. Write it as `select:open::picker(select)`. |

What would help:

- `hidePicker()`, and `toggle` events on the select, as popovers have.
- A way for a picker's content to keep painting for a moment after the select closes, so a canvas can draw a closing animation or move the chosen option into the button.
- `<selectedcontent>` cloning a canvas with its bitmap, or an event when it replaces its clone.
- `touch-action` taking effect for elements drawn by a canvas in the top layer. This needs checking on a real phone before it is reported.

## Datalist and other inputs (`/datalist/`, `/inputs/`)

Measured in headless Chromium 157 with Playwright, mouse and emulated touch at 412 px. The shared part is `public/lib/placed-popover.js`: a `popover="manual"` element positioned with CSS anchor positioning that holds a drawable canvas.

The built-in popups of `<input list>`, `type="date"`, `type="time"` and `type="color"` are not elements. They have no pseudo-element, `appearance: base-select` does nothing for them, and nothing can be put inside an `<input>`. A canvas can draw the control and can replace the popup, but cannot draw the built-in popup.

| Test | Result | Detail |
| --- | --- | --- |
| `<canvas><datalist style="display:block"><option drawable>`, `drawElementImage(option)` | works | The option is a grandchild of the canvas. Without `drawable` on the option the call throws "Descendants passed to DrawElementImage must have the 'drawable' attribute". |
| Hit testing, `:hover` and click on a datalist option drawn that way | works | `elementFromPoint()` returns the `<option>`. |
| An element inside a datalist option, such as `<option>Leeds <small>LDS</small></option>` | not rendered | It parses and stays in the DOM, but the option renders its label as plain text. The child has no box and `checkVisibility()` is false. Computed `display` of the option stays `block`. `::before` and `::after` on the option do render. |
| CSS Custom Highlight API range in an option's text node | paints nothing | The text shown is in the browser's internal tree, not the option's text node. |
| Keep the built-in datalist keyboard handling and replace only the popup | not possible | Removing `list` is the only way to stop the popup, and it removes the keyboard handling too. |
| Range input with a datalist, drawn in a canvas | works | The tick marks are part of the input's picture. Option labels are never shown by the browser. `RangeLabels` draws the options themselves under the ticks. |
| date, time, datetime-local, month, week, number, color, range, file, checkbox, radio, progress, meter drawn rotated by one `drawElementImage()` | works | Date segments take focus and typing where they are drawn. A click on the rotated range track sets the value at that point. |
| Built-in colour chooser of a rotated input | outside the canvas | It opens upright next to the bounding box of the drawn swatch. |
| Built-in date and time pickers, and the datalist popup, of a rotated input | not observed | The test browser has no window and never shows them. |
| A picker made of `<button>` children of a popover canvas (clock, calendar, swatches) | works | Focus, `:focus-visible`, `aria-pressed`, hover and click follow the drawing. Buttons that are not drawn are moved away with `updateElementGeometry()`. |
| Stopping the Android date and time dialogs by making the input `readonly` while the replacement is open | not verified | Needs a phone. |

What would help:

- A picker pseudo-element for `<input list>`, `type="date"`, `type="time"` and `type="color"`, as `::picker(select)` is for select, so a canvas could go inside the real picker.
- Options in a datalist rendering their children, as options in a customisable select do.
- A way to stop a built-in picker opening without removing the feature that provides it (`list`) or making the input read-only.

## 3D and spatial (`/three-form/`, `/board/`, `/xr/`)

Measured in headless Chromium 157 with software rendering, three.js r187 (vendored in `public/vendor/three/`). The shared helper is `public/lib/html3d.js`.

| Experiment | Result | Detail |
| --- | --- | --- |
| three.js `HTMLTexture` as shipped in r187 | fails | three calls `gl.texElementImage2D` and `queue.copyElementImageToTexture`. Chromium 157 has `texElementSubImage2D` and `drawElementImageToTexture`, so nothing is drawn. |
| The same `HTMLTexture` with a 20-line shim for the new names | works | `installThreeShims()` in `html3d.js`. three asks for RGBA8, which washes out sRGB colours; the shim stores SRGB8_ALPHA8. |
| `texElementSubImage2D` into immutable sRGB storage, `UNPACK_FLIP_Y_WEBGL`, `generateMipmap` | works | Mipmaps keep a far-away billboard readable. The element image is CSS size × (canvas backing px ÷ canvas CSS px), and a fractional size is rounded up. |
| Hit testing a WebGL-drawn element via a CSS `matrix3d` (three's `InteractionManager` route) | fails | The element is not hit-testable where it is drawn. |
| Hit testing via `updateElementGeometry()` with a perspective `DOMMatrix` | works | Clicks, focus rings, caret, selection and bounding rects follow a quad at any angle. |
| Curved surface (100° cylinder arc), mouse | works | No single matrix fits, so the geometry is re-placed on every pointer move from the raycast triangle's UV Jacobian. Selection, slider drags and wheel scrolling work. |
| Curved surface, touch | partly | Geometry is placed on `pointerdown`. A first tap can land about 10px off (touch adjustment); the next is right. |
| Scene objects occluding a surface | app's job | The DOM does not know about the drone in front of the screen. Raycast, and park the element off-canvas. `clearElementGeometry()` did not remove the old hit region. |
| Moving the geometry of a focused text field | scrolls the page | Scroll anchoring follows the field. `overflow-anchor: none` on the canvas stops it. |
| Element of a WebGL canvas copied into a `GPUTexture` on a separate device | works | Checked by reading the texture back. Top-left origin, unscaled. |
| three `WebGPURenderer` drawing those textures | not verified | Showing a WebGPU canvas loses the device in this software GPU (render passes into textures are fine). Needs real hardware: `/three-form/` picks it by itself when WebGPU is usable, and `?renderer=webgpu` forces it. |
| `drawElementImage` under a zoom transform, 40% to 800% | works | Text is re-rasterised (no in-between pixels at 800%) and hit testing follows the transform. |
| Same-origin iframes as canvas children | works | They paint, take clicks, typing and wheel at any zoom, and a change inside one fires the board's `paint` naming that tile. Other HTML-in-canvas pages, a WebGL scene and the board itself nest. |
| Pointer and wheel events over an iframe tile | swallowed | They never reach the parent, so pan and zoom need a cover element until the tile is activated. |
| A tile that is no longer drawn | still clickable | It keeps the hit region of its last draw until it is parked with `updateElementGeometry()`. |
| Overlapping tiles | last drawn wins | `z-index` on the elements changes nothing. Bring-to-front is draw order, so iframes never move in the DOM (and never reload). |
| `elementFromPoint` on canvas children | viewport only | Like any element. Live checks have to scroll the canvas into view first. |
| `updateElementGeometry()` under the CSS `zoom` property | layout pixels | The transform is in the canvas's layout pixels (`clientWidth`), while `getBoundingClientRect()` and pointer events are scaled by zoom. Mixing them puts hit regions 1.5× off at `zoom: 1.5`. |
| Tabbing into a far-away surface | camera's job | Focus order works, but a field in the overview is a few pixels tall. `/three-form/` flies to the surface that receives keyboard focus. |
| WebXR session with HTML panels (emulated Quest 3, IWER) | works | Paint events keep arriving, a DOM change re-uploads in session, and `elementFromPoint` still answers for a flat layout of the elements. |
| Controller ray to DOM input | works, by hand | Raycast, UV to element pixels, `elementFromPoint`, synthetic pointer and mouse events. Untrusted events do not focus, place a caret, drag a range or open a `<select>`, so `RayPointer` in `html3d.js` does each of those itself. |
| On-panel keyboard | works | Keys cancel `mousedown` so focus stays put; `setRangeText()` plus an `input` event types at the caret; Enter calls `requestSubmit()`. |
| The form as an `XRQuadLayer` (sharp text, composited by the headset) | not verified | Written, opt-in, and reports its result on the page. The emulator has no `createQuadLayer`. |

Not tested here: a real headset or Android AR session. Whether `paint` keeps firing while the page is hidden behind an immersive session is the open question; `/xr/` counts paint events in session, shows the result on a panel inside the headset, and falls back to uploading from the last paint record if they stop.

## Pages that hold still (`npm run check:jank`, `tools/jank/`)

On a phone every demo jumped, flashed or scrolled itself while loading. Measured on 2026-11-20 with Chromium 157 driven over the DevTools Protocol as a phone (412 px wide, real device scale factor 2.625, touch, CPU slowed 4x), touching nothing from navigation until the page's live checks finished plus three seconds: layout-shift entries with their sources, every scroll and focus the page did by itself with the line of code that did it, canvas backing-store writes, long tasks, a trace for layout counts, and every compositor frame from a screencast compared with the ones before it.

Before, on `main`: 2 of 28 pages held still. The median page shifted its layout by 0.27 (0.1 is the usual "good" limit, the worst was 1.79), 13 pages scrolled themselves (up to 11,029 px on `/capture/`), 12 moved focus, and the 28 pages spent 279 seconds in long tasks between them.

The causes, in the order they hit:

- **The menu bar arrived after first paint.** `nav.js` waited for `demos.js` before inserting itself, so every page moved down 53 px (0.07 of shift on every page, 0.42 on `/remote/`). The bar now goes in at its final height the moment the script runs and the menu is filled in later.
- **Demos were built after first paint.** Module scripts run after parsing, and most pages fill the status banner, size the stage and build tiles from them. Whether the browser painted in between was a race, which is why the same page measured 0 on one run and 0.37 on the next, and why a phone on a real network loses it more often. `nav.js` now keeps the body below the menu unpainted until `DOMContentLoaded` and until the page height has been the same for three frames (capped at 0.8 s, and 3 s in all). This is `blocking="render"` done by hand, because that attribute only works in `<head>`. It uses `opacity: 0`, not `visibility: hidden`: hidden canvases get no paint events and `elementFromPoint()` skips them, which made live checks that start early fail. Shift at load is now 0 on every page but two.
- **Live checks drove the visible demo.** They called `scrollIntoView()`, `scrollTo()` and `focus()`, flew the board's camera about and rebuilt canvases in front of the reader: `/board/` called `scrollIntoView()` 34 times in 15 seconds. A check that scrolls down and back inside one task is invisible; the same check with an `await` in the middle is a jump, twice.
- **Moving the checks to in-flow fixtures traded scrolling for layout shift.** After the first round of fixes `/lens/` stopped scrolling but shifted by 1.28 and `/slot-effects/` by 1.40, because each fixture was inserted above the results and removed again. Fixtures have to be out of flow (fixed or absolute) or in a hidden copy of the page, as the 3D pages do.
- **A tab crash: opacity around a canvas, inside an iframe that is drawn into a canvas.** In Chromium 157, `/board/` crashed the tab within 300 ms of opening once the slot page (a tile on the board) put its test fixtures in a fixed box with `opacity: .02`. Any opacity effect around a drawable canvas inside a canvas-drawn iframe does it: holding the framed page's first paint with `opacity: 0` crashed the same way, `visibility: hidden` did not. So a demo page shown as a tile does not run its own checks (the board loads it with `?autochecks=0`, which also saves seconds of main thread) and `nav.js` does not hold the first paint of a framed page.
- **`dvh` on a canvas stage.** `/board/` sized its stage with `100dvh`, so every time the phone's URL bar hid or showed, the stage changed height, everything below it moved and the canvas backing store was reallocated. It uses `svh` now. Assigning `canvas.width` clears the canvas even when the value is unchanged, so the libraries only assign on a real change.

What is left is on the pages themselves. Seven pages still have checks that scroll or focus the visible page, shift the layout with in-flow fixtures, pin a panel over it or blank a canvas: `/cross-origin/`, `/remote/`, `/portal/`, `/lens/`, `/shader-css/`, `/slot-effects/` and `/physical/`. They are listed in `CHECKS_WAIT_FOR_TAP` in `shared/support.js`: there the checks wait for a "Run these checks" button, so opening the page never moves it. A page comes off the list when `npm run check:jank -- --checks /page/` passes. `/transitions/`, `/time-scrubber/` and `/particles/` have their own rule (checks start when the reader scrolls to them). `runTests()` also waits while someone is scrolling or typing, and puts scroll position and focus back if a check moved them and nobody touched the page.

After: all 28 pages hold still on load (this includes the per-page fixes that landed the same day in PRs #23 to #28). Across the 28 pages: median layout shift 0.27 to 0, worst 1.79 to 0.07; pages that scroll themselves 13 to 0; scroll and focus calls on the visible page 115 and 30 to 0 and 1; frames that flash 26 to 0; frames with a blanked canvas 446 to 1; layouts 4,284 to 2,155; time in long tasks 279 s to 116 s. Four small things are recorded as known in `tools/jank/allow.json` rather than fixed: `/transports/` grows its source list a row at a time (0.07), `/slot-view/` moves a paragraph when its first picture arrives (0.04), one `/shader-css/` tile is blank for a single frame, and one `/slot/` check focuses an input in its fixture.

| Page | Before: shift / scrolled px / focus moves / flashes / blank frames | After | Live checks on load |
|---|---|---|---|
| `/` | 0.00 / 0 / 0 / 0 / 0 (0.37 on other runs) | 0.00 / 0 / 0 / 0 / 0 | none |
| `/slot/` | 0.07 / 2387 / 1 / 3 / 0 | 0.00 / 0 / 1 / 0 / 0 | run |
| `/slot-bare/` | 0.11 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/slot-bare/plain.html` | 0.07 / 0 / 0 / 0 / 2 | 0.00 / 0 / 0 / 0 / 0 | none |
| `/offscreen/` | 0.14 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/cross-tab/` | 0.11 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/cross-origin/` | 0.20 / 994 / 0 / 2 / 0 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/transports/` | 0.32 / 0 / 0 / 0 / 0 | 0.07 / 0 / 0 / 0 / 0 | run |
| `/tear-off/` | 0.56 / 0 / 2 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/remote/` | 0.58 / 0 / 4 / 0 / 2 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/embed/` | 0.25 / 1519 / 3 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/support/` | 0.40 / 0 / 1 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run |
| `/slot-view/` | 0.37 / 0 / 0 / 0 / 0 | 0.04 / 0 / 0 / 0 / 0 | wait at the consent prompt |
| `/pip/` | 0.00 / 0 / 0 / 0 / 0 (0.39 on other runs) | 0.00 / 0 / 0 / 0 / 0 | run |
| `/portal/` | 1.34 / 3758 / 0 / 0 / 1 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/lens/` | 0.70 / 2814 / 0 / 0 / 1 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/shader-css/` | 1.28 / 3160 / 0 / 0 / 44 | 0.00 / 0 / 0 / 0 / 1 | wait for a tap |
| `/slot-effects/` | 0.27 / 5279 / 1 / 0 / 4 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/physical/` | 1.52 / 3467 / 0 / 0 / 5 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap |
| `/transitions/` | 0.23 / 0 / 2 / 8 / 0 | 0.00 / 0 / 0 / 0 / 0 | start when scrolled to |
| `/time-scrubber/` | 0.29 / 0 / 0 / 0 / 365 | 0.00 / 0 / 0 / 0 / 0 | start when scrolled to |
| `/particles/` | 0.74 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | start when scrolled to |
| `/three-form/` | 0.12 / 338 / 7 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run, on a hidden copy |
| `/board/` | 0.11 / 470 / 2 / 6 / 0 | 0.00 / 0 / 0 / 0 / 0 | run, on a hidden copy |
| `/xr/` | 0.06 / 493 / 3 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | run, on a hidden copy |
| `/a11y/` | 0.63 / 4159 / 3 / 4 / 0 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap on touch devices |
| `/capture/` | 1.79 / 11029 / 1 / 3 / 22 | 0.00 / 0 / 0 / 0 / 0 | wait for a tap on touch devices |
| `/perf/` | 0.11 / 0 / 0 / 0 / 0 | 0.00 / 0 / 0 / 0 / 0 | none |

With their checks forced to run on load (`--checks`), the seven gated pages still fail: `/cross-origin/` scrolls 990 px, `/remote/` moves focus four times, `/portal/`, `/lens/`, `/shader-css/` and `/physical/` shift by 0.25 to 1.03 as the fixture panel `#check-bench` grows and shrinks, and `/slot-effects/` shifts by 1.40 and covers more than 40% of the screen with that panel.

Not measured here, because it needs a real phone: the URL bar is simulated by changing the window height, which also changes `vh` (a phone does not), there is no real GPU so a lost-context white box cannot happen, and touch scrolling while checks run is not exercised.

## Remote across real networks: the custom domain, STUN and TURN

Reported from a phone on 2026-11-20: on `html-in-canvas.page` the room WebSocket failed, and between two machines the viewer ended on "relayed through the room (WebRTC failed)".

- **The room refused the custom domain.** The Worker only accepted WebSocket handshakes whose `Origin` was a `workers.dev` name, so on `html-in-canvas.page` it answered 403. A failed handshake tells a page nothing, so both ends quietly fell back to a BroadcastChannel room, which only reaches tabs of the same browser: two machines could never meet. The Worker now accepts any page it served itself (same host), on whatever name it is reached. When a room does fall back, both pages say so and why, found by asking `/api/x/status` over HTTP.
- **STUN was already there; it is not enough.** STUN tells a device its public address. Mobile carriers and many offices use a different public port for every destination (symmetric NAT), so the address STUN reports is not the one the other device can reach, and ICE fails after about 15 seconds. That needs TURN. `/api/x/ice` hands out Cloudflare Realtime TURN servers with one-hour credentials when the Worker has `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`; the key's own token never reaches a browser. Port 53 addresses are removed because browsers refuse them slowly.
- **"Video over WebRTC" was announced too early.** `ontrack` fires when the offer is read, long before packets flow, and it cancelled the timer that starts the relay fallback. A viewer that could not connect therefore stared at an empty video until ICE gave up. Video is now shown on `connectionState === 'connected'`; relayed pictures start after 7 seconds and are replaced by video if WebRTC connects later.
- **Candidates are held until the description is set.** `addIceCandidate()` before `setRemoteDescription()` throws and loses the candidate.
- **A phone needs its errors on the page.** Both ends write a connection log (room, servers offered, each kind of candidate, the route chosen, every `icecandidateerror`) with a Copy button. When ICE fails the log says which case it was: no candidates from the other end (signalling), no `srflx` (UDP blocked), public addresses on both sides but no route (symmetric NAT, needs TURN), or TURN itself unreachable. The viewer has links to force a route: WebRTC only, TURN only, or relayed pictures.

Not verified: any connection between two real networks. The cloud test browser has no outbound UDP at all (STUN fails with 701), so only host candidates on one machine were exercised here. Two new live checks on `/remote/` report STUN and TURN from whatever device opens the page.

## Video and sound (`/video/`, `/overlay/`, `/audio/`, `/player-parts/`, `/player-fx/`)

Chromium 157 headless, software video decoding and software rendering, 2026-11-21. The test clips are generated by `tools/media/make.sh`. `clip.webm` carries its frame number as 16 stripes in the top right corner, so a check can read which video frame a canvas holds.

### A `<video>` as a canvas child (`/video/`)

| Experiment | Result | Notes |
| --- | --- | --- |
| Playing `<video>` inside a `drawable` element, `drawElementImage()` | works | The current frame is in the element's picture. |
| Same element through `texElementSubImage2D()` | works | Frame 77 was asked for and read back from the texture. |
| `paint` events with no `requestPaint()` | 30 a second for a 30 fps clip | The video invalidates the canvas for each presented frame. No render loop is needed. |
| `requestVideoFrameCallback()` then `requestPaint()` | the canvas holds the reported frame, 40 of 40 | The frame number in the picture equals `Math.round(metadata.mediaTime * 30)`. |
| Set `currentTime`, wait for `seeked`, `requestPaint()` | the exact frame, 10 of 10 | About 20 to 35 ms per seek and paint at 320×180. This is what frame-by-frame export uses. |
| `<track>` captions with a `::cue` rule | drawn with the rule's colours | The cue box moves up when the controls are shown, as in a plain element. |
| Native controls | drawn when the element shows them | Hidden while playing with no hover, as usual. |
| Click on the drawn timeline, element drawn at half size 100 px away | seeks | The controls are part of the element, so they follow its hit-test geometry. Play, mute and the overflow menu were also pressed on the drawn controls under the shader, and the menu is drawn in the canvas. Fullscreen and Picture-in-Picture were entered from script. |
| VP9 clip with an alpha channel | alpha kept | The parent's background shows through. |
| Camera stream in `srcObject` | works | Chromium's fake camera. |
| `<audio controls>` | drawn and usable | |
| Child `<video>` playing the canvas's own `captureStream()` | works | The picture repeats inside itself. No crash. |
| `<video drawable>` inside a `drawable` parent | missing from the parent's picture | A nested `drawable` element is left out. Leave the attribute off, or draw the video with its own call. |
| Cross-origin video without CORS | left out, canvas not tainted | The video plays. Its area in the picture is clear. `toDataURL()` and `getImageData()` still work. |
| Cross-origin video with `crossorigin` and a CORS header | works | |
| Clear Key encrypted video (EME) | black, canvas not tainted | Plays in a plain element. `drawImage(video)` gives the same black frame. Needed a WebM encryptor (`tools/media/encrypt-webm.mjs`): ffmpeg's `cenc` MP4 output was refused by Chromium's demuxer. |
| Video in a Picture-in-Picture window | the element paints a black placeholder | `paint` drops to about 4 a second while it is away. |
| Fullscreen on the video | works | The element fills the screen as plain DOM and is drawn in the canvas again after exit. |

### HTML over video: record, export, send (`/overlay/`, `lib/video-export.js`)

| Experiment | Result | Notes |
| --- | --- | --- |
| `canvas.captureStream()` plus the audio track of `video.captureStream()` into `MediaRecorder` | works | The audio track is there while the element is muted. The file has the frame, the HTML and the sound. |
| Frame-by-frame export: seek, set each animation's `currentTime`, one `paint`, `new VideoFrame(canvas)`, `VideoEncoder` | exact | Frame numbers read back from the exported file are the ones asked for. A box moved by a CSS animation is 10 px further in each frame. 21 to 26 ms per frame at 640×360 here. |
| Sound in the export: `OfflineAudioContext.decodeAudioData()`, `AudioEncoder` (Opus), second WebM track | works | `lib/webm-mux.js` gained `addAudio()`. No user gesture is needed. |
| Canvas stream through `RTCPeerConnection` | works | 640×360 at 30 frames a second with the overlays in it. |
| Buttons in a scene drawn into a fixed 640×360 buffer shown at another size | work | `drawElementImage(el, 0, 0, canvas.width, canvas.height)` scales the picture and the hit-test region together. |
| `drawElementImage(el, 0, 0)` on a buffer that is not the shown size | overflows | With no size, the element is drawn at the size that shows it at its CSS size on screen, whatever the buffer size. |
| Export of a camera or other live stream | not possible | It cannot be seeked. Only the real-time recording applies. |

### Sound driving DOM (`/audio/`)

| Experiment | Result | Notes |
| --- | --- | --- |
| `AnalyserNode` levels written to `--fx-amount`, `--fx-x`, `--fx-y`, `--fx-progress` each frame | the shader and plain CSS both follow | The four registered properties are the only link between the audio code and the drawing. |
| Native `<audio>` controls under the shader | work | Play was pressed by touch on the drawn control. |
| Text field and button in the same card | work | |
| `OfflineAudioContext` with an `AnalyserNode` and `suspend(t)` | gives band levels with no tap | Live analysis needs a tap, because a new `AudioContext` starts suspended. |
| GLSL and WGSL versions of the page's effects | same picture, mean difference 0.00 to 0.35 of 255 | Compared off screen with a software WebGPU adapter. |

### Parts of the native player (`/player-parts/`)

Chrome builds the controls of `<video>` and `<audio>` as elements in a user-agent shadow tree. The question was what a canvas can do with those parts.

| Experiment | Result | Notes |
| --- | --- | --- |
| Rules on `::-webkit-media-controls-panel`, `-timeline`, `-play-button`, time displays | drawn in the canvas | Background, colour, `accent-color`, `border-radius`, `display: none`, `zoom`. Same on `<audio>`. The restyled controls keep working. |
| `:paused`, `:playing`, `:seeking`, `:muted`, `:buffering`, `:stalled`, `:volume-locked` | not valid selectors by default | Valid with experimental web platform features on. Then `:has(video:paused)` on the drawn element sets a registered custom property, a CSS transition moves it, and the shader reads it. No script takes part. `:picture-in-picture` and `:fullscreen` work without the flag. |
| The same with attributes set from `play`, `pause`, `seeking`, `seeked`, `volumechange` | works | The fallback the page uses when `CSS.supports('selector(:paused)')` is false. |
| `object-fit: none; object-position: -9999px 0` on the video | the frame leaves, the controls stay | `drawImage(video)` still gives the frame. An 80 px tall `<video>` is then a strip of controls on a clear background. |
| Frame from `drawImage(video)` with `ctx.filter`, controls from `drawElementImage()` | two layers | The filter does not reach the controls. The strip can be drawn under the picture, over it, or 1.5 times larger, and takes hits where it is drawn. |
| Keeping the video's controls visible during playback | timeline only | Chrome adds a class to the panel, fades it, then sets `display: none`. `opacity: 1 !important` on the panel and the timeline keeps the timeline. The row of buttons is `::-internal-media-controls-button-panel`, which author CSS cannot name. Focus on the video keeps the buttons after `focus()` with no pointer input, but not after a mouse click. |
| `<audio controls>` playing the same file, muted video following it | controls never fade | Play, pause, seek and speed are copied from the audio element's events, with a drift correction on `timeupdate`. No fullscreen or captions button. |
| `video.shadowRoot`, `video.attachShadow()` | `null`, `NotSupportedError` | No part can be given `drawable`, measured, or drawn by itself. |
| HTML or a canvas as a child of `<video>` | not rendered | Children of a media element are fallback content. Nothing can be put among the controls. |
| `transform` on the panel to move it below the video | clipped to the video's box | Shrink the element to its controls instead. |

Compared with controls written in HTML: the native ones bring the overflow menu, captions switch, playback speed, Picture-in-Picture, keyboard handling and accessibility for no code, and can be restyled only through the named parts. HTML controls take about 25 lines for play, seek, time and mute, and each one can be drawn and placed by itself.

While checks run, the shared fixture box covered the bottom left of the window and took taps meant for the page. The four media pages now set `pointer-events: none` on it, and switch it back only for the synchronous `elementFromPoint()` call of a hit-test check.

Reported from Chrome on Android (2026-11-21): with the checks starting on load, videos on these pages errored and the page jumped. A check fixture is one or two more playing videos beside the three on the page, and a phone has a small number of hardware decoders. Since then the checks on the four media pages wait for a tap, each player on `/player-parts/` gets its file only when it is scrolled near and pauses when it leaves the window, and a media error is written under the player with a button to load the file again. Whether that is the whole cause is not confirmed on the device.

### One shader over the controls and the frame (`/player-fx/`)

Paul asked for effects where the controls and the picture work on each other, for example the play button melding in and out of the video. One `<video controls>` fills a WebGL 2 canvas with its frame moved out of its box.

| Experiment | Result | Notes |
| --- | --- | --- |
| `texElementSubImage2D()` for the controls and `texImage2D(video)` for the frame, same element | two textures, one decoder | The controls texture is clear where there is no control. The loading ring and the menu are in it too. |
| Hit testing with a WebGL canvas | needs `updateElementGeometry()` | A WebGL draw does not place the element. With an identity `canvasTransform` taps reach the native controls. |
| Position of one part | found | A class gives each named part a flat colour for one paint. That picture goes to a spare texture, is read back, and each colour's bounding box is the part. Play button, timeline, mute, fullscreen and both time displays. The coloured picture never reaches the screen (0 pixels in three frames). |
| Glyph of one part as a shape | works | The shader reads the play button's glyph out of its measured box and draws it large as a lens. The browser swaps the glyph between play and pause. |
| Effects | six | Meld (large play glyph that shrinks into the button on play), glass (frosted bar, each control refracts the frame), melt (thickened shapes filled with the inverted frame that run downwards on play and pause), ripple (wave from the play button's centre), light (the frame lit from the timeline thumb), outlines of the measured parts. |
| `WEBGL_lose_context.loseContext()` on a check fixture | the tab crashed | Chromium 157. A smaller case with one canvas did not crash, so the cause is not known. The checks leave the context to the garbage collector. |

Not built: a WebGPU version of the shader. Not found by the colour method: parts with internal names only (menu button, the row of buttons). Not verified: `texImage2D(video)` with a hardware decoder on Android, the boxes in the touch layout, the frame rate on a phone.

### Media state, lazy loading, the iframe policy, output latency (demo 19 of the Chrome APIs plan)

Added to `/player-parts/`, `/video/` and `/audio/`.

| Experiment | Result | Notes |
| --- | --- | --- |
| HTML controls in a canvas whose labels come from `:has(#lv:paused)`, `:has(#lv:muted)`, `:has(#lv:buffering)` | work, no state code | `/player-parts/` part 3. The style change raises `paint` with no `requestPaint()`. Chromium 157 needs the experimental features flag for the selectors, and the page falls back to attributes set from media events. chromestatus lists the selectors for Chrome 158. |
| `<video loading="lazy">` as a canvas child | loads and is drawn | The browser has `video.loading`. A canvas in the window counts as near the viewport for its child. |
| Video in an iframe with `media-playback-while-not-visible 'none'`, iframe a canvas child | keeps playing | The frame counts as rendered. `getImageData()` after a forced repaint of that fixture crashed the tab. It did not crash in smaller cases, so the cause is not known and the check reads only the clock. |
| Visualiser delayed by `AudioContext.playbackStats.averageLatency`, else `outputLatency` | built | `/audio/`. The test browser reports 0 ms and has no sound card, so the alignment is not verified. A checkbox turns the delay off. |

### Not verified

- Hardware-decoded video on Android. Frames from a hardware decoder may take a different path into the element's picture. The first four live checks on `/video/` answer this on the device.
- Widevine and other hardware-backed key systems, and HDR video.
- Audible output and audio timing: the test browser has no sound card.
- The WebGPU route on screen for all three pages.
- `AudioEncoder` and seek accuracy on a phone.
- Which media state pseudo-classes Chrome 159 on Android has by default, and how the touch layout of the controls fits an 80 px strip. The fourth live check on `/player-parts/` lists the selectors the browser accepts.

### Further experiments

- **WebGPU external textures.** `importExternalTexture(video)` for the frame and `drawElementImageToTexture()` for the overlays, composed in one pass. Compare the cost with putting the video inside the element.
- **A worker as the compositor.** Camera frames from `MediaStreamTrackProcessor`, overlays as transferred `ElementImage` snapshots, output through `VideoTrackGenerator`. That is a camera track made off the main thread, with no `captureStream()`.
- **A presenter over live slides.** An alpha or background-segmented camera over a slide made of DOM, where the slide's links and form controls take clicks.
- **Live captions.** `SpeechRecognition` results as DOM cues over the video, in the recording and in the stream. The Translator API for a second language.
- **Timed comments.** Comments as DOM elements that cross the video, placed by `requestVideoFrameCallback()`, each one clickable.
- **A title editor.** Several clips, HTML title cards with CSS animations keyed to video time, the `/transitions/` shaders between clips, exported with `exportFrames()`.
- **A screen-share telestrator.** `getDisplayMedia()` video in the canvas with HTML annotation tools over it, sent on as one stream.
- **A cinema screen in 3D.** The `/video/` player on a wall in the `/three-form/` scene, native controls hit tested through the perspective matrix, with a `PannerNode` at the screen's position.
- **Video as a material for text.** A shader that fills or displaces DOM text with the video frame.
- **Animated images.** GIF, APNG, animated WebP and AVIF, SVG SMIL and Lottie as canvas children: does `paint` fire per frame?
- **Colour.** A `display-p3` canvas with HDR or wide-gamut video and CSS colours beside it: what survives `VideoFrame` and the encoder.
- **Casting.** The composed stream to a TV with the Presentation or Remote Playback API.
- **A player skin as a shader.** Hide every native part except the timeline, draw the timeline alone as a strip, and run a shader on that strip only (a waveform or thumbnails behind the thumb).
- **Named parts for canvas drawing.** A proposal to test against: `drawElementImage()` taking a pseudo-element or a `::part()`, so one part of a closed shadow tree can be drawn without opening it. Custom elements with `part` attributes are the place to prototype it.
- **Customisable media controls.** The same step `<select>` took with `appearance: base-select`: controls built from author HTML in slots, with the browser keeping the behaviour. Mock it with a custom element and compare what a canvas can then draw.
- **State pseudo-classes on other elements.** `:open` on `<details>` and `<dialog>`, `:popover-open`, `:user-invalid`, `:checked` driving `--fx-*` through `:has()`, as `/player-parts/` does for `:paused`.
- **Word-by-word highlighting.** `SpeechSynthesis` boundary events driving a shader on the word being spoken.

## Native UI toolkits (`/native-ui/`)

Tested in headless Chromium 157 at 1× and at a 2.625 device scale with touch. egui 0.37 (eframe, glow, WebGL2) and Qt Quick 6.10.3 (Emscripten 4.0.7, WebGL2). Sources in `native/`. The survey of other frameworks and the list of what would have to change is `docs/native-frameworks.md`.

| Experiment | Result | Detail |
| --- | --- | --- |
| DOM element as an egui widget, drawn by an `egui_glow::CallbackFn` paint callback | works | `texElementSubImage2D` into a texture bound by Rust, inside egui's own WebGL pass. An egui window covers it and an egui scroll area clips it. |
| DOM element as a Qt Quick item | works | A `QQuickItem` with a `QSGSimpleTextureNode` over `QSGOpenGLTexture::fromNative()`. Uploaded on `QQuickWindow::beforeRendering`. Qt's `opacity` and `rotation` apply. |
| `content="drawable"` set on a canvas after the toolkit made its WebGL context | works | Both toolkits create the context before the bridge runs. |
| Element moved into Qt's canvas, which is in a shadow root | works | Page stylesheets do not apply there, so the page copies computed styles inline first. |
| Toolkit sets the width, browser reports the height | works | `style.width`, then `offsetHeight`. One frame late. |
| Typing, caret, Tab between DOM fields, click from a toolkit field to a DOM field and back | works | Events are stopped at the element so the toolkit does not also handle them. |
| Hit testing a field rotated by Qt Quick | works | `QQuickItem::itemTransform()` passed to `updateElementGeometry()`. |
| A toolkit window drawn over a DOM field | needs a guard | The browser still hits the field. The egui bridge asks `Context::layer_id_at()` before the event is delivered. |
| Tab from a DOM field to a toolkit widget | fails | The toolkit's widgets are not DOM nodes. |
| Upload without `UNPACK_PREMULTIPLY_ALPHA_WEBGL` | wrong | Text on a transparent background is too heavy, because both toolkits blend premultiplied alpha. |
| Spelling markers on a `spellcheck` textarea in the texture | not drawn | The explainer excludes them from element images. |
| `elementFromPoint()` at a point hit tested just before `updateElementGeometry()` moved the element away | stale (Chromium 157) | Returns the old element; a point 2px away is correct. A DOM mutation clears it, so the bridges toggle an attribute on the canvas after each geometry update. Possible browser bug. |
| eframe under DevTools device emulation | wrong scale | The canvas buffer stays at CSS size while egui uses the device pixel ratio. `--force-device-scale-factor` is correct. |
| eframe start-up | takes focus | It focuses its hidden text input. The page makes `focus()` a no-op while the app starts. |
| Raw GL in Qt Quick's frame | warnings | Five `texParameter: no texture bound` warnings per item at start-up. Textures draw correctly. |

Not verified: a real phone, IME composition, where native pickers open for a rotated field, screen readers, Qt Widgets (2D canvas, `putImageData`).

## Text selection (/selection/, lib/selection-fx.js)

Measured in headless Chromium 157 (Linux, software renderer) on 2026-11-21. The page's live checks repeat the rows that do not need focus.

| Experiment | Result | Why |
|---|---|---|
| The browser's selection highlight in the pixels of `drawElementImage()`, `texElementSubImage2D()` and a read-back | works | The highlight is part of the element's paint record, in the active colour, and is transformed with the element. |
| `paint` fires when the selection changes | works | No `requestPaint()` needed. A 30-step mouse drag fired 19 paint events. |
| `::selection` colours | works | A custom background and colour are drawn. `background-color: transparent` with no `color` gives a picture identical to the unselected one while the selection still exists. |
| `::highlight()` (CSS Custom Highlight API) | works | Drawn, and setting or clearing the registry fires `paint`. A Highlight with no style gives ranges to measure and draws nothing. |
| `Range.getClientRects()` against the drawn highlight, element drawn with a translation | works | Within 1 px. Rectangles are in page coordinates and follow the drawn position. |
| `Range.getClientRects()` on an element drawn rotated | fails | Returns the upright bounding box of each rotated line (72×24 becomes 76×38 at 0.2 rad). `getBoxQuads()` is not in Chromium. |
| `updateElementGeometry(identity)`, measure, restore, in one task | works | `getClientRects()` follows the geometry synchronously, so this gives element-local rectangles with no visible change. Note that `geometryUnit()` in `lib/surface.js` applies the identity itself. |
| `range.getClientRects()` on a selection that spans paragraphs | misleading | It also returns the boxes of block elements fully inside the range. `textRects()` uses one Range per text node. |
| Mouse drag, double click and `caretPositionFromPoint()` on an element drawn rotated and scaled | works | Selection hit testing follows the drawn geometry. Also checked at device scale factor 2.625. |
| Drag from one drawable element to another, and from outside the canvas into it | works | Selects across them in document order. |
| Drag from outside into a `contenteditable` canvas child | stops at its edge | The usual editing-boundary rule. |
| Caret of a focused editable canvas child | works | Drawn, and each blink fires `paint` (4 events in 2.2 s). |
| Selection inside `<input>` or `<textarea>` | drawn, cannot be measured | `getSelection()` has no range inside the control and there is no rectangle API for `selectionStart`/`selectionEnd`. |
| `window.find()` | works | It selects the match, so it is drawn like any selection. |
| WebGPU against WebGL for the same effect (off-screen, software adapter) | works | Mean difference 0.00 of 255 for `wave`. The WGSL of all three shader effects compiles. |
| Touch long press, Android handles, the copy menu | not verified | Long press selected nothing in the headless browser, inside or outside a canvas. Needs a phone, in particular: handles on a rotated line, and handles when `::selection` is transparent. |
| `::target-text`, find-in-page marks, spelling marks | not verified | None appeared in the headless browser even outside a canvas. The explainer lists spelling and find-in-page marks as left out of element pictures. |
| `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas that holds an element texture | crashes the tab (Chromium 157) | Seen in a live check that released its context while the fixture was still in the document. Removing the canvas first avoids it. |
| A WebGL canvas losing its context | fires `webglcontextlost`, not `contextlost` | `SurfaceElement` in `lib/surface.js` only listens for `contextlost`, so a subclass using WebGL has to listen itself. `<selection-fx>` moves its content to a new 2D canvas on either event. |
| A canvas with a lost context on Android Chrome 159 | shows a white box with a broken-picture icon | Reported from Paul's phone on first load of `/selection/` (2026-11-21), cause not identified. The page now starts on a 2D effect, starts GPU checks only on a tap, and replaces a lost or picture-less canvas. |
| `caret-color` and `caret-shape` in the element's picture (`/caret/`) | works | At device scale factor 2 a block caret covers 578 canvas pixels and a bar 102. |
| `caret-animation: manual` | works | The caret pixels stay in every read-back and no `paint` fires while the caret rests. With `auto` the caret is in about one read-back in three. |
| Caret position from a collapsed `Range` | works | `getClientRects()` returns one zero-width rectangle at the drawn position. Nothing on an empty line. |
| `CSS.highlights.highlightsFromPoint()` on an element drawn away from its layout position | works | Returns the Highlight and range at the drawn position, and nothing at an empty point of the canvas. |
| `::highlight(*)` | not in Chromium 157 | `CSS.supports('selector(::highlight(*))')` is false. Listed for 158. |
| A shader finding the caret and highlights by colour key, with no rectangles (`key-glow`) | works | Checked on WebGL with a keyed `::highlight()` background. |
| Playwright screenshots | hide the caret | `page.screenshot()` defaults to `caret: 'hide'`. Pass `caret: 'initial'` when the caret is the subject. |
| WebGPU on screen, and shader speed on a phone | not verified | The software adapter cannot present a WebGPU canvas. |

How `<selection-fx>` uses this: one `::selection` rule hides the browser's highlight inside the element, `selectionchange` triggers a measurement of one Range per text node, and the rectangles go to a 2D effect directly or to a shader as a mask texture (red: selected, green: selected in the last 1.2 s, blue: selected and blurred by 10 px). The element's geometry stays at its layout position, so the caret and hit testing do not follow what an effect draws.
