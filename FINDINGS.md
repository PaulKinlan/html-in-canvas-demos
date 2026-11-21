# Findings

Verified in Chromium 153 and 157 (headless, API on by default in those builds) on 2026-11-20. Every demo page re-runs these checks live in your browser.

The API surface used here is the current WICG explainer shape: `<canvas content="drawable">` (older builds: `layoutsubtree`), the `drawable` attribute on drawn elements, the `paint` event, `drawElementImage()`, `captureElementImage()` and `ElementImage`.

## Summary

The main results. Each is backed by the tables in the sections below.

- The slot pattern is a real answer to "the DOM has to live inside the canvas": the markup stays in the light DOM and only the canvas moves into a shadow root.
- Reprojection across documents is a pixel stream plus input forwarding, not a shared snapshot. Semantics (selection, accessibility tree, find-in-page) stay in the source document.
- The primitives all rest on the same wrapper and the same two workarounds: stretch one canvas over everywhere the element must appear, and move the single hit-test geometry to wherever the pointer is. A way to draw one element into several canvases, and a per-region geometry, would remove both.
- One element has one hit box. Effects that show an element in many pieces (shards, glyphs) can route one pointer correctly but not two, and a way to give `updateElementGeometry` several regions, or a hit-test callback, would close that gap.
- Accessibility largely survives, with one sharp edge: whatever is in the canvas but not drawn is still focusable. An opt-in such as "undrawn means inert" would remove the main hazard.
- Any element can be exported with one call today, and a whole ordinary page can be wrapped in a canvas for a single frame without the user seeing it.
- A native "draw this element by reference" hook for canvas (an id reference rather than DOM containment) would remove the need for the shadow root. An ElementImage that could be drawn into a second canvas would make cross-document reprojection first class; today it is deliberately bound to one canvas.
- For 3D, the texture half of the API is ready and the method names are the only obstacle in three.js today. The input half rests entirely on `updateElementGeometry()`: it accepts a perspective matrix, which covers every flat surface, and anything curved or occluded needs the app to re-place the element under the pointer.
- In XR there is no pointer for the browser to hit test, so input is synthetic and loses everything a trusted event does for free. A way to hand the browser a ray hit (element plus point) and have it dispatch a trusted event would remove most of `RayPointer`.
- A `<video>` is an ordinary canvas child: frames, native controls and `::cue` captions are drawn, `paint` fires once per video frame, and the frame in the canvas is the one `requestVideoFrameCallback()` reported. Cross-origin video without CORS and encrypted video are left out of the picture without tainting the canvas. HTML over video can be recorded with sound, exported frame-exactly and sent over WebRTC.

## Contents

- [Slots](#slots)
- [ElementImage and OffscreenCanvas](#elementimage-and-offscreencanvas)
- [Tabs and origins](#tabs-and-origins)
- [Transport lab (/transports/)](#transport-lab-transports)
- [UI primitives (/portal/, /lens/, /shader-css/, /physical/)](#ui-primitives-portal-lens-shader-css-physical)
- [Lens pipeline (/lens/, lib/lens-gl.js)](#lens-pipeline-lens-liblens-gljs)
- [Transitions and motion (/transitions/, /time-scrubber/, /particles/)](#transitions-and-motion-transitions-time-scrubber-particles)
- [Cross-context: tear-off, remote, embed, support](#cross-context-tear-off-remote-embed-support)
- [Accessibility (/a11y/)](#accessibility-a11y)
- [Capture (/capture/, public/lib/element-capture.js)](#capture-capture-publiclibelement-capturejs)
- [Performance (/perf/)](#performance-perf)
- [Video and sound (/video/, /overlay/, /audio/)](#video-and-sound-video-overlay-audio)
- [3D and spatial (/three-form/, /board/, /xr/)](#3d-and-spatial-three-form-board-xr)
- [Pages that hold still (npm run check:jank, tools/jank/)](#pages-that-hold-still-npm-run-checkjank-toolsjank)
- [Remote across real networks: the custom domain, STUN and TURN](#remote-across-real-networks-the-custom-domain-stun-and-turn)

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
| Click a glyph in mid-air | fails | One element, one hit box. One drawable span per letter gets a hit box each, at the cost of an element per character. |

Not tested here: whether Chrome's find-in-page highlight is painted into an element's picture (needs a person at a real browser), and frame rates on a real GPU (these numbers are from software rendering).
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

## Video and sound (`/video/`, `/overlay/`, `/audio/`)

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

### Not verified

- Hardware-decoded video on Android. Frames from a hardware decoder may take a different path into the element's picture. The first four live checks on `/video/` answer this on the device.
- Widevine and other hardware-backed key systems, and HDR video.
- Audible output and audio timing: the test browser has no sound card.
- The WebGPU route on screen for all three pages.
- `AudioEncoder` and seek accuracy on a phone.

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
- **Word-by-word highlighting.** `SpeechSynthesis` boundary events driving a shader on the word being spoken.

