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
| A `drawable` element nested inside another drawable element has its own picture and is left out of the outer one. | measured | C157 | `/carousel/`, `/translate-lens/` | CSS carousel as a cover flow; Language models, voice and input |
| Each chunk of a streamed `<template for>` patch or of `streamAppendHTML()` raises one `paint` event. `changedElements` names only the nearest drawable element around the change. | measured | C157 | `/patch/`, `/stream/` | Declarative partial updates and `moveBefore()`; Streamed HTML |
| `moveBefore()` keeps the focus, animation time and uploaded texture of a drawable element. | measured | C157 | `/patch/`, `/component-kit/` | Declarative partial updates and `moveBefore()`; Newer DOM features in a drawable custom element |
| A WebAssembly program can block on `paint` through JSPI and draw in the microtask after the listener. | measured | C157 | `/wasm-ui/` | A WebAssembly loop on the paint event |
| `canvas.when('paint')` (Observable) delivers the same events as `addEventListener('paint')`. `ElementImage` has `close()` and no `[Symbol.dispose]`, so `using` needs a wrapper. | measured | C157 | `/component-kit/` | Newer DOM features in a drawable custom element |
| Scroll-driven animations, `scroll-state()` and `timeline-trigger` set registered custom properties on canvas children. | measured | C157 | `/scroll-fx/` | Effects driven by CSS, the tilt sensor and text measured by CSS |
| A drawable element inside another drawable element is recorded only where its drawn position is inside the canvas and the window when it repaints. The rest is transparent, nothing throws, and the hole stays until it repaints fully in view. A drawable element whose ancestors are not drawable is always whole. | measured | C157 | `/minimap/` | Live minimap |
| A change to a custom property alone raises no `paint` event. | measured | C157 | `/css-uniforms/` | Shader uniforms from CSS |
| A CSS height transition on `::details-content` raises a `paint` event for each frame. | measured | C157 | `/accordion/` | Accordion from `<details>` |
| `content="drawable"` on a canvas with a `bitmaprenderer` context gives `paint` events and geometry, with no way to draw the element. | measured | C157 | `/flutter-dom/` | A DOM form inside a Flutter web app |
| A `<tr drawable>` in a table that is a canvas child keeps table layout and can be drawn on its own at any position. A `<td drawable>` with no background is drawn as text on transparent pixels. | measured | C157 | `/sort-table/`, `/heat-map/` | Sortable table; Heat map over table cells |
| A state change raises `paint` only if it changes a pixel of a drawable element: `value` set from script, `stepUp()`, `output.value`, `:active`, `:focus` with a visible outline, `input.files`, `fieldset.disabled`. A change to `aria-label`, `aria-level` or a custom property alone raises none. | measured | C157 | `/form-state/`, `/form-scenes/`, `/instruments/`, `/a11y-views/`, `/landmark-map/` | Form effects driven by the paint event; Form controls in a drawn setting |
| An animated registered custom property raises `paint` every frame once a painted colour is computed from it. Generated content from an animated CSS counter does too. A canvas animation can run with no frame loop. | measured | C157 | `/flip-clock/` | Flip clock from a time element |
| A transform or opacity animation on the drawable element itself raises no `paint`. The same animation on a descendant raises one per frame. | measured | C157 | `/paint-inspector/` | Paint event inspector |
| `paint` rates per second at 60 Hz: a background animation or `<marquee>` 60, a 30 fps video 30, an indeterminate `<progress>` 8, a caret 2. Each can be the only clock of an effect. | measured, software rendering | C157 | `/paint-inspector/`, `/paint-clocks/` | Paint event inspector; Paint clocks |
| Drawing an element at a different place than in the last paint raises a second `paint` one frame later with that element in `changedElements`. | measured | C157 | `/paint-clocks/` | Paint clocks |
| A `drawable` element raises `paint` when it is not drawn. `opacity: 0` from the start prevents the events. `opacity: 0` set later does not. | measured | C157 | `/paint-clocks/` | Paint clocks |
| An element is named in `changedElements` once for its first picture. A listener added after that sees an empty list from `requestPaint()`. | measured | C157 | `/paint-inspector/` | Paint event inspector |
| A drawable canvas can be a `drawable` child of a drawable canvas. A draw in the inner one raises `paint` on the outer one. A scroll inside a drawn same-origin iframe raises `paint` with the iframe in `changedElements`. | measured | C157 | `/nested-frames/` | Frames and nested canvases |
| A `drawable` scroll container scrolls natively inside a canvas by touch and wheel and raises `paint` on every scroll step. A `position: sticky` drawable canvas inside a native scroller is scrolled on its drawn content and raises none. | measured | C157 | `/list-table/`, `/structure-depth/` | Lists and tables, second batch; Page structure drawn in depth |
| `left`, `top` and percentage insets do not position a child of a canvas. Each child is laid out at 0, 0. `max-width: 100%` on a child resolves against the canvas's CSS width. | measured | C157 | `/gpu-video/`, `/text-notes/`, `/share-card/` | A video as a WebGPU external texture under HTML cards; Annotated article; Text selection |
| `drawable` children can be moved between two canvases with `append()`. | measured | C157 | `/presenter/` | A video presenter over a slide made of DOM |
| GIF, APNG, WebP and AVIF images, SVG files with stepped SMIL or CSS animation, a CSS background image, `<picture>`, `<object>` and `content: url()` each raise one `paint` per frame when the element is a drawable canvas child. A continuous SVG animation raises one per display frame. A GIF with a loop count of one raises none after its last frame. | measured | C157 | `/animated-images/` | Animated images |
| An SVG file in an `<img>` stops raising `paint` when the place it is drawn at is outside the window. Raster images, inline SVG and CSS background images do not stop. | measured | C157, headless | `/animated-images/` | Animated images |
| A drawable `marquee` raises one paint event per step (60 a second with `scrolldelay="16" truespeed`) and none after `stop()`. A marquee nested in a drawable block raises 60 a second naming the block, whatever its `scrolldelay`. | measured | C157 | `/table-data/`, `/odd-elements/` | Table data; Odd elements |
| `:state()`, `:checked`, `details:open`, `:user-invalid` and `:popover-open` set registered custom properties on a canvas through `:has()`. A transition of such a property raises `transitionrun` and `transitionend` on the canvas and no `paint`. | measured | C157 | `/media-state/` | Media controls and state |
| A registered `<custom-ident>` property selects a shader effect. It changes at the halfway point of a transition. | measured | C157 | `/plan-followups/` | Follow-ups to the Chrome APIs plan |

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
| A `drawable` descendant can be passed to `drawElementImage()` by itself. It is then left out of its drawable ancestor's picture (a third test, agreeing with the video test). | measured | C157 | `/translate-lens/` | Language models, voice and input |
| About 7 µs of script per call. More than about 100 clipped draws a frame is slow (85 draws 2 ms, 136 draws 140 ms). 1,000 draws of text each at its own angle take about 1.5 s. | measured, software rendering | C157 | `/perf/`, `/lens/`, `/particles/` | Performance; UI primitives; Transitions and motion |
| Pixels of drawn DOM can be read back (`getImageData`, `createImageBitmap`, `toDataURL`). The canvas is not tainted. | measured | C157 | `/offscreen/` | ElementImage and OffscreenCanvas |
| A float16 Display P3 2D canvas keeps CSS `color()` values above 1.0 through `drawElementImage()`. A CSS `filter` or `mix-blend-mode` on the element, `ctx.filter`, `lighter`, a shadow on the draw and `drawImage()` of a float canvas clamp to 1.0. | measured | C157 | `/hdr-glow/` | HDR interface |
| An element moved in the DOM can be drawn in the same task, with its old picture. | measured | C157 | `/sort-table/` | Sortable table |
| A nested drawable content element of a closed `<details>` throws "No cached paint record". Its open picture is available only as a snapshot taken while it was open. | measured | C157 | `/accordion/` | Accordion from `<details>` |
| `drawElementImage()` has a nine-argument form with a source rectangle in CSS pixels of the element. It works for elements and for `ElementImage` snapshots. One element can be drawn more than 100 times in a frame in slices under different transforms. | measured | C157 | `/input-ideas/`, `/keycaps/`, `/split-flap/` | Five more input pickers; Keycaps drawn from kbd; Split-flap output element |
| `ctx.filter` (`blur()` and `url()` to an SVG filter), `globalCompositeOperation` (`source-in`, `source-out`, `source-atop`, `multiply`, `difference`), `clip('evenodd')`, a canvas shadow and a reflection all apply to `drawElementImage()`. The element's own `mix-blend-mode` is applied against the canvas. | measured | C157 | `/text-notes/`, `/video-text/`, `/redact/`, `/timed-comments/`, `/play/`, `/list-table/` | Annotated article; Video as a material for editable text; Text selection |
| `ctx.filter = 'url(#id)'` resolves the id in the tree of the canvas, so a canvas in a shadow root finds filters in that shadow root. | measured | C157 | `/nested-frames/` | Frames and nested canvases |
| An element's picture is rastered at the drawn size. An element drawn at four times its layout size is drawn again, not stretched. | measured | C157 | `/media-tiles/`, `/share-card/` | Video, image and chart tiles; Text selection |
| A draw made outside the `paint` event works, including at `globalAlpha = 0`, and can be copied with `drawImage()` in the same task. `captureElementImage()` works outside a paint handler. | measured | C157 | `/play/`, `/structure-depth/`, `/split-flap/` | Four games made of live elements; Page structure drawn in depth; Split-flap output element |
| 288 letters per frame drawn from a snapshot with `drawImage()` took 49.6 ms. From the live element through a clip, once per letter, it took 442.3 ms. | measured, software rendering | C157 | `/selection-glyphs/` | Text selection |
| A `<col>` has a box and no picture, and `drawElementImage(col)` throws. A `<figure>` that is not drawable can hold a `drawable` `<img>` and `<figcaption>`. A `<label for>` and its field can be drawn as separate elements, and label activation is unchanged. | measured | C157 | `/list-table/`, `/media-tiles/`, `/form-scenes/` | Lists and tables, second batch; Video, image and chart tiles; Form controls in a drawn setting |
| `drawImage()` into a second canvas, `toDataURL()` and `toBlob()` work after `drawElementImage()` of same-origin content. Read the copy, not the drawable canvas (see "Phones and lost contexts"). | measured | C157 | `/input-ideas/`, `/select-ideas/`, `/share-card/` | Five more input pickers; Five more select pickers; Text selection |
| `drawElementImage(el, x, y)` with no size draws at the layout size times the canvas's backing scale, in the units of the context, with the transform on top. Under `ctx.scale(devicePixelRatio)` the element is `devicePixelRatio` times too large, and its hit region with it. Playwright's `deviceScaleFactor` and a ratio of 1 hide this; `--force-device-scale-factor=2.625` shows it. | measured | C157 at device scale 2.625 | `/element-ideas/`, `node tools/draw-size/audit.mjs` | `findings/draw-size.md` |
| `drawElementImage()` throws `TypeError` for a `CSSPseudoElement` and for a `ShadowRoot`, `InvalidStateError` for an element in a shadow tree that has no `drawable` attribute, and `InvalidStateError` for an open popover child. | measured | C157 | `/media-state/`, `/blocked/` | Media controls and state; Blocked ideas |
| `ctx.filter` with `brightness(0)` first recolours a clipped piece of an element to one colour. | measured | C157 | `/table-data/` | Table data |
| Several clipped draws of one element in a frame each rasterise it again in software. One whole draw plus `drawImage()` copies into a plain canvas is cheaper and needs no readback. | measured | C157 | `/odd-elements/` | Odd elements |
| `drawElementImage()` of a BT.2020 video into a `display-p3` 2D canvas keeps colours outside sRGB, with the same values as `drawImage(video)`. An HDR10 (PQ) video is tone-mapped to at most 1.0 in a `float16` canvas (software decoding). | measured | C157 | `/video-lab/` | Video, second batch |

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
| `getBoundingClientRect()` on a canvas child reports the box it was last drawn in, after the draw transform. Layout has to be measured with `offsetTop` and `offsetLeft`. | measured | C157 | `/translate-lens/`, `/agent-view/` | Language models, voice and input |
| Scroll snap uses the place given to `updateElementGeometry()`. A nested drawable element inside a scroller is clipped by the scroller. | measured | C157 | `/carousel/` | CSS carousel as a cover flow |
| The CSS anchor rectangle of an element in a drawn canvas child is the bounding box of its drawn quad, also under perspective. Chromium 153 anchors to the layout box. | measured | C157, C153 | `/popovers/` | Native popovers on a tilted panel |
| A perspective matrix given to `updateElementGeometry()` keeps buttons on a leaning card pressable. | measured | C157 | `/tilt-card/`, `/agent-view/` | Effects driven by CSS, the tilt sensor and text measured by CSS; Language models, voice and input |
| `inert` is enough to keep a drawn element from taking the pointer in a 2D canvas. | measured | C157 | `/wasm-ui/` | A WebAssembly loop on the paint event |
| `createValueRange()` rects of a drawn input are at the drawn position and match the ink. | measured | C157 | `/text-labels/` | Effects driven by CSS, the tilt sensor and text measured by CSS |
| `getBoundingClientRect()` on a canvas child that is drawn moved or scaled reports the drawn box. `offsetTop` and `offsetLeft` report layout. | measured | C157 | `/translate-lens/`, `/focus-nav/` | Language models, voice and input; Controller, keyboard and haptic navigation |
| A draw with `globalAlpha = 0`, or one clipped away completely, still moves the element's hit region. | measured | C157 | `/element-ideas/` | Every HTML element |
| Focusing an element whose hit region was moved far away scrolls the page towards that place. | measured | C157 | `/element-ideas/` | Every HTML element |
| An element in a `layoutsubtree` canvas that is never drawn gets its box from `updateElementGeometry()` alone. Role, name, state, hit testing, Tab order and focus then work. | measured | C157 | `/toolkit-aria/` | An accessibility tree for a Dear ImGui app |
| `canvasClip` cuts the hit box. `getBoundingClientRect()` ignores it. | measured | C157 | `/toolkit-aria/` | An accessibility tree for a Dear ImGui app |
| `canvasTransform` accepts a 4×4 matrix with perspective, and hit testing follows it. | measured | C157 | `/flutter-dom/` | A DOM form inside a Flutter web app |
| Where two elements drawn by a 2D canvas overlap, the one drawn last is hit, in either document order. | measured | C157 | `/tab-fan/` | Tab switcher of live pages |
| The browser does not scroll a scroll container in a canvas for wheel or touch unless the container itself is drawable and has a hit region. A `wheel` listener on such a container is treated as passive. | measured | C157 | `/minimap/` | Live minimap |
| Drawing a canvas child at its view transition group box retargets the group, so it does not move, unless `updateElementGeometry()` puts the hit box back after each draw. | measured | C157 | `/scoped-transitions/` | Transitions and motion, View transitions drawn by a canvas |
| Where two elements drawn by a 2D canvas overlap, the one drawn last is hit, in either document order. A drawable child has a hit region only in a frame that draws it. | measured | C157 | `/hit-regions/`, `/cassette/`, `/play/`, `/text-notes/` | Hit region viewer; Annotated article |
| A clip on the context does not clip the hit region of a 2D draw. A draw inside an empty clip, or at `globalAlpha = 0`, moves the hit region and adds no pixels. | measured | C157 | `/hit-regions/`, `/form-state/`, `/input-ideas/` | Hit region viewer; Form effects driven by the paint event |
| A draw with a source rectangle gives the element a hit region at the piece, with the size of the piece. `updateElementGeometry()` moves it and keeps that size. A whole draw in an empty clip restores it. | measured | C157 | `/text-notes/`, `/speak-words/`, `/list-table/` | Annotated article; Words highlighted as they are spoken |
| An element drawn at half size is hit only inside the half-size box, so drawing a control smaller makes its touch target smaller. | measured | C157 | `/a11y-views/` | Focus trail, target sizes, label lines and heading outline |
| After a rotated or sheared draw, `getBoundingClientRect()`, `getClientRects()` and `Range.getClientRects()` of the element and its descendants are bounding boxes at the drawn position and scale. `getBoxQuads()` is not available. The element is hit inside its drawn parallelogram. | measured | C157 | `/layout-debug/`, `/focus-path/`, `/mark-pen/`, `/form-scenes/`, `/top-layer/` | Layout debugger overlay; Marker-pen highlight on mark; Form controls in a drawn setting |
| `caretPositionFromPoint()` answers for a drawn element at its drawn position, in 2D and on WebGL after `updateElementGeometry()`. | measured | C157 | `/speak-words/`, `/text-notes/`, `/video-text/`, `/selection-heat/` | Words highlighted as they are spoken; Video as a material for editable text |
| Any `Range` has rectangles at the drawn position whether or not it is selected. One `Range` per character gives per-letter boxes. | measured | C157 | `/selection-peers/`, `/selection-glyphs/` | Text selection |
| `touch-action` on a drawable element applies at the place it was drawn, so a canvas with `pan-y` can hold elements with `none`. | measured with CDP and emulated touch | C157 | `/instruments/`, `/play/` | Form controls drawn as instruments; Four games made of live elements |
| The remembered hit-test answer (bug 6) applies to plain 2D draws too, holds the last two points asked, and is not used by `elementsFromPoint()`. | measured | C157 | `/hit-regions/` | Hit region viewer |
| Moving a hit region in a capture-phase `pointerdown` listener lets one element shown in several pieces take a tap in the piece under the pointer. Moving it in the `paint` event that follows `pointerdown` is too late for a touch tap. | measured | C157 | `/structure-depth/` | Page structure drawn in depth |
| Drawing an `ElementImage` moves the live element's hit region to the picture. A draw of the element at `globalAlpha` 0 moves it back. | measured | C157 | `/form-scenes/` | Form controls in a drawn setting |
| `canvasTransform` starts at the canvas origin in CSS pixels. An identity matrix puts the hit box at the origin. | measured | C157 | `/gpu-video/` | A video as a WebGPU external texture under HTML cards |
| A touch press does not set `:active` on a button drawn in a canvas. A mouse press does. | measured, emulated touch; not verified on A159 | C157 | `/form-state/` | Form effects driven by the paint event |
| A `draggable` element drawn by a canvas starts a native drag with a mouse, and the canvas and drawn elements take `dragover` and `drop`. A drawn `<input type="file">` opens the file chooser on a tap and takes a drop. | measured | C157 | `/play/`, `/form-scenes/` | Four games made of live elements; Form controls in a drawn setting |
| `canvasClip` is one `DOMRectInit` in the element's coordinates. An array, a `Path2D`, a `DOMRectList`, a `DOMQuad` and `null` are read as an empty rectangle without a throw, which removes the hit box. Omitting the member keeps the earlier clip. | measured | C157 | `/toolkit-occlusion/` | Occlusion between toolkit windows |
| Where two hit boxes overlap, the element of the most recent `updateElementGeometry()` call takes the pointer; on a 2D canvas it is the element drawn last. `z-index` and DOM order have no effect. | measured | C157 | `/toolkit-occlusion/`, `/block-play/` | Occlusion between toolkit windows; Block play |
| CSS `clip-path` on a drawable child cuts its hit area and its texture. CSS `mask` cuts only the texture. `inert` and `pointer-events: none` remove the hit box; only `inert` removes focus and the Tab stop. | measured | C157 | `/toolkit-occlusion/` | Occlusion between toolkit windows |
| `updateElementGeometry()` accepts a `DOMMatrix` with a perspective row on a 2D canvas. Hit testing, text selection, native video controls and buttons follow it, by mouse and by emulated touch. It throws for a canvas child without `drawable`. | measured | C157 | `/select-selection/`, `/video-lab/`, `/odd-elements/` | Select and selection, second batch; Video, second batch; Odd elements |
| `canvasTransform` is in CSS pixels. With a transform scaled by the device pixel ratio the element does not answer `elementFromPoint()` at its drawn place. | measured | C157 at device scale 2 | `/hdr-glow/`, `/plan-followups/` | HDR interface |
| A nine-argument `drawElementImage()` limits the element's hit region to the source rectangle of the last draw, and `updateElementGeometry()` does not undo it. A last draw of the whole element at `globalAlpha` 0 restores the whole region. | measured | C157 | `/motion-capture/`, `/select-selection/` | Transitions and motion; Select and selection, second batch |
| One `drawable` element has one hit box, so the second of two simultaneous pointers on pieces of it misses (1 of 6 presses reached its pad). One element for each piece, or routing in a capture listener of the canvas, gives 6 of 6. | measured | C157, touches sent through the DevTools protocol | `/motion-capture/` | Transitions and motion |
| The `click` after a tap is hit tested again and follows a hit box moved during `pointerdown`. | measured | C157 | `/motion-capture/` | Transitions and motion |
| An element that a paint does not draw keeps the click target of its last draw. Draw it off the canvas with alpha 0, or move it with `updateElementGeometry()`. | measured | C157 | `/plan-followups/` | Follow-ups to the Chrome APIs plan |
| A `pointerdown` whose target is the canvas is a press where no drawn element is. With a non-passive `touchstart` that cancels, a handle drawn by the canvas can be dragged without scrolling the page. | measured | C157, emulated touch | `/block-play/` | Block play |
| `touch-action: none` on the canvas did not stop a touch that began on a drawable child from scrolling the page. | measured | C157, emulated touch | `/toolkit-occlusion/` | Occlusion between toolkit windows |
| Links inside a scrolling drawable marquee are hit tested at their current place. | measured | C157 | `/table-data/` | Table data |
| Client rectangles of content inside a drawable element follow the last `drawElementImage()` call for it; `offsetLeft` and `offsetTop` do not. A block drawn in several pieces reports rectangles for the last piece. | measured | C157 | `/text-marks/` | Text marks |

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
| An `ElementImage` is refused by every canvas other than the one it was captured from, including an `OffscreenCanvas` ("The source was captured from a different canvas"). `createImageBitmap()` accepts neither an `ElementImage` nor an element. | measured | C157 | `/flutter-dom/` | A DOM form inside a Flutter web app |
| An `ElementImage` taken before a DOM change, or before its element moved, still draws afterwards and serves as the old state of a transition drawn by the canvas. | measured | C157 | `/scoped-transitions/`, `/sort-table/` | Transitions and motion; Sortable table |
| A worker composes `VideoFrame`s and transferred `ElementImage` snapshots on the page's transferred canvas and writes a video track through a transferred `MediaStreamTrackGenerator` stream. `MediaStreamTrackProcessor` and `VideoTrackGenerator` are not defined in a worker. | measured | C157 | `/worker-compositor/` | A worker as the video compositor |
| With the main thread blocked, a worker keeps composing only if it decodes the file itself with `VideoDecoder` and converts frames with `copyTo()`. `drawImage(VideoFrame)`, `createImageBitmap(VideoFrame)` and `texImage2D(VideoFrame)` of I420 frames stop. | measured, software rendering | C157 | `/worker-compositor/` | A worker as the video compositor |
| An `ElementImage` keeps the element's old rendering after its value or text changes, across frames. | measured | C157 | `/form-scenes/`, `/split-flap/`, `/flip-clock/` | Form controls in a drawn setting; Split-flap output element |

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
| `texElementSubImage2D()` refuses float textures. Element copies on WebGL and WebGPU do not carry values above 1.0. | measured | C157 | `/hdr-glow/` | HDR interface |
| A foreign engine's texture can be found without engine internals by wrapping `gl.createTexture` for the length of the engine call that creates it. | measured | C157 | `/godot-dom/` | A DOM form in a Godot 4 web export |
| Dear ImGui's OpenGL backend needs straight alpha for an element texture. egui and Qt Quick need premultiplied alpha. | measured | C157 | `/imgui-dom/`, `/native-ui/` | Dear ImGui with DOM elements |
| Element textures store straight alpha for translucent content on WebGL and WebGPU. This disagrees with the earlier "Pixels are premultiplied" row under WebGPU. Neither result has been re-run against the other. | measured | C157 | `/gpu-video/` | A video as a WebGPU external texture under HTML cards |
| `texElementSubImage2D()` does not apply the element's own `mix-blend-mode`. `mix-blend-mode` inside the element is kept in its picture. | measured | C157 | `/video-text/` | Video as a material for editable text |
| Text styled white on clear gives a coverage mask as `min(r, g, b)`. The selection highlight, caret and focus ring are in the same texture as coloured pixels. | measured | C157 | `/video-text/` | Video as a material for editable text |
| `captureStream()` of a WebGL canvas that draws in `paint` needs `preserveDrawingBuffer: true`, or the frames are black. | measured, software GL | C157 | `/presenter/` | A video presenter over a slide made of DOM |
| A drawable WebGL canvas accepts an `RGBA16F` drawing buffer and holds values above 1.0. The software compositor of the test browser does not show it. | measured | C157 | `/plan-followups/` | Follow-ups to the Chrome APIs plan |
| Video clips and HTML cards as shots of one WebGL canvas, joined by shader transitions, export frame by frame with `exportFrames()` driven by a timeline object. | measured | C157 | `/video-lab/` | Video, second batch |

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
| A swizzled view, immediates and a float blend target all work on a texture filled by `drawElementImageToTexture()`. | measured | C157 | `/webgpu-features/` | Newer WebGPU features on element textures |
| A compatibility mode device builds and draws every shader of `/webgpu-features/`. | measured, software adapter | C157 | `/webgpu-features/` | Newer WebGPU features on element textures |
| `dual-source-blending` and `primitive-index` shaders. | not verified | | `/webgpu-features/` | Newer WebGPU features on element textures |
| `primitive_index` and dual-source blending work on an element texture, and `/webgpu-features/` draws with WebGPU on screen: 10 of 10 live checks pass on the phone. A compatibility mode device there draws the same picture within 2 of 255. | reported | A159 | `/webgpu-features/` | Newer WebGPU features on element textures |
| One pass samples a video texture and element textures from `drawElementImageToTexture()`. An element that contains a playing video uploads with the frame `requestVideoFrameCallback()` reported. | measured, software adapter | C157 | `/gpu-video/` | A video as a WebGPU external texture under HTML cards |
| `importExternalTexture()` and `copyExternalImageToTexture(video)` fail on the software adapter. `createImageBitmap(video)` or a 2D canvas in between works. | measured, software adapter | C157 | `/gpu-video/`, `/video-text/` | A video as a WebGPU external texture under HTML cards |
| On the phone a plain float16 Display P3 2D canvas, a drawable one filled by `drawElementImage()`, and a WebGPU `rgba16float` canvas with tone mapping `extended` each show 4.0 brighter than 1.0. | reported | A159 | `/hdr-glow/repro.html` | HDR interface |
| The probe-colour measurement of the native video controls works through `copyTextureToBuffer()` when the destination texture of `drawElementImageToTexture()` has `COPY_SRC`. | measured | C157, software adapter | `/video-lab/` | Video, second batch |

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
| A custom highlight (`CSS.highlights`) on a text node is in the element's texture, and a shader bends it with the text. | measured | C157 | `/voice/` | Language models, voice and input |
| An `ElementImage` from `captureElementImage()` still draws after its element is removed from the canvas. | measured | C157 | `/nav-shader/` | Navigations drawn by a shader |
| A navigation inside an iframe adds entries to the tab's joint history, and `history.back()` in the iframe can undo a navigation the top page made after them. Checks that navigate in a hidden copy must not run while the reader navigates. | measured | C157 | `/nav-shader/` | Navigations drawn by a shader |
| `focusgroup` arrow keys move focus between buttons drawn through a shader, along DOM order on one axis; `reading-flow` on the container makes them, and Tab, follow the drawn order. | measured | C157 | `/focus-nav/` | Controller, keyboard and haptic navigation |
| A focus ring shown by `focus({ focusVisible: true })` is in the element's texture. | measured | C157 | `/focus-nav/` | Controller, keyboard and haptic navigation |
| Native media controls, `::cue` captions and rules on `::-webkit-media-controls-*` are drawn. | measured | C157 | `/video/`, `/player-parts/` | Video and sound |
| A drawable canvas is never tainted. A cross-origin or sandboxed iframe, and an image, video or CSS background loaded without CORS, are left out of the picture (0 pixels) with no error, in 2D and through `texElementSubImage2D()`. The iframe still takes clicks where it was drawn. | measured | C157, C153 | `/protected/`, `/iframe-tiles/` | Protected content in a drawable canvas; Iframes as tiles |
| A visited link is drawn in its unvisited colour. A password field is drawn as dots. An open popover and a modal dialog are not in the picture. | measured | C157, C153 | `/protected/` | Protected content in a drawable canvas |
| A real click on a permission element (`<geolocation>`) in a canvas reaches it and opens no prompt. The same click outside a canvas opens it. | measured | C157, C153 | `/protected/` | Protected content in a drawable canvas |
| `corner-shape`, `border-shape` and `clip-path: shape()` are in the element's alpha, and hit testing follows them. | measured | C157 | `/shape-ui/` | Effects driven by CSS, the tilt sensor and text measured by CSS |
| `text-fit`, `text-box-trim` and `sideways-lr` size a canvas child, which is drawn at that size. | measured | C157 | `/text-labels/` | Effects driven by CSS, the tilt sensor and text measured by CSS |
| A custom highlight and a script-set `:focus-visible` outline are in the texture. | measured | C157 | `/voice/`, `/focus-nav/` | Language models, voice and input; Controller, keyboard and haptic navigation |
| Registered custom properties, including values from `attr()`, `if()`, `sibling-index()`, `random()`, `progress()`, `@function`, transitions and view timelines, can be read each frame and set as shader uniforms. | measured | C157 | `/css-uniforms/` | Shader uniforms from CSS |
| A displayed, editable `<style>` element inside a drawn element is drawn and stays live. | measured | C157 | `/css-uniforms/` | Shader uniforms from CSS |
| An outline is in an element's picture only where it falls inside the border box of the drawable element. A focus ring on a descendant is drawn and cut at that box. | measured | C157 | `/a11y-views/`, `/instruments/`, `/input-ideas/` | Focus trail, target sizes, label lines and heading outline |
| The selection highlight in its `::selection` colour and `::highlight()` colours are in the picture. A `<mark>` with `background: none` paints nothing of its own. | measured | C157 | `/text-notes/`, `/typed-code/`, `/mark-pen/` | Annotated article; Code that types itself; Marker-pen highlight on mark |
| An `outside` list marker is not in the picture of its `<li>`. An `inside` marker is. The picture of the `<ol>` has both. | measured | C157 | `/list-table/` | Lists and tables, second batch |
| The picture of a drawable nested in another drawable holds only the part inside the window. A direct child of the canvas, including an inner canvas, is recorded whole. | measured | C157 | `/keycaps/`, `/split-flap/`, `/nested-frames/` | Keycaps drawn from kbd; Frames and nested canvases |
| A drawable element in a shadow tree that contains a `<slot>` holds the picture of the slotted children. The slot itself and a `foreignObject` cannot be the drawable element. | measured | C157 | `/nested-frames/` | Frames and nested canvases |
| An open popover is not in the picture of the element that contains it. A `<dialog open>` with `position: static` is drawn as a `drawable` child and its buttons work. While a dialog is modal the canvas scene is inert. | measured | C157 | `/top-layer/` | A tooltip, a modal and toasts beside the top layer |
| Drawing a bar over text in the canvas hides nothing from the DOM: `textContent`, `Range.toString()` and copy still return it. | measured | C157 | `/redact/` | Text selection |
| The browser's validation message points at the drawn position of a field. An `inert` drawable fieldset is drawn, submitted and validated. | measured; the message was seen in a screenshot | C157 | `/instruments/` | Form controls drawn as instruments |
| One element with `columns: n` is one picture with every column. `::column::scroll-marker` is not in the picture of a drawn scroller. | measured | C157 | `/plan-followups/` | Follow-ups to the Chrome APIs plan |
| A `data:` URL frame and a sandboxed `srcdoc` frame are left out of a drawable element's picture (alpha 0) and still take input. `contentDocument` is null for both. | measured | C157 | `/odd-elements/` | Odd elements |
| A cross-origin image is drawn when it is loaded with `crossorigin` and a CORS header. Which images are left out can be told from the URL and the attribute. | measured | C157, `localhost` and `127.0.0.1` as the two origins | `/blocked/` | Blocked ideas |
| `HTMLUnknownElement` names (blink, applet, spacer) and obsolete elements (center, font, big, tt, nobr, acronym, marquee, xmp) have boxes and are in the picture. | measured | C157 | `/odd-elements/` | Odd elements |
| A closed `details` is as tall as its summary and its content is not painted, though the content reports a height. A `template` in a canvas has no box; its clones are separate drawable children. | measured | C157 | `/block-play/` | Block play |
| `caption` and `tfoot` have offset boxes inside a drawable table with `position: relative`. The `datetime` and `value` attributes and the `title` tooltip of an `abbr` are not in the picture. | measured | C157 | `/table-data/`, `/text-marks/` | Table data; Text marks |
| `br` has one client rectangle 0 px wide, `wbr` has none, and `q` has a rectangle for each of its two generated marks as well as one per line. | measured | C157 | `/text-marks/` | Text marks |
| A `<title>` moved into a canvas with `display: block` is drawn and still sets `document.title`. | measured | C157 | `/field-heads/` | Field heads |

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
| A scoped `CustomElementRegistry`, `slotAssignment: 'manual'` and Reference Target each work with a canvas that draws slotted children. | measured | C157 | `/component-kit/` | Newer DOM features in a drawable custom element |
| An element in an open shadow tree of a canvas child is drawn as its own picture, with its own hit region, when it has `drawable`. | measured | C157 | `/media-state/` | Media controls and state |

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
| At 40 kbit/s WebRTC shrinks a 960×540 element to 320×180. `degradationPreference: 'maintain-framerate-and-resolution'` keeps it at 960×540. | measured | C157 | `/transports-2/` | Transport lab 2: newer transport APIs |
| A frame sent with `Document-Isolation-Policy` gets `SharedArrayBuffer` while the page around it stays non-isolated. | measured | C157 | `/transports-2/` | Transport lab 2: newer transport APIs |
| `frame-sizing: content-height` parses and does not size an iframe. `window.requestResize()` throws `NotAllowedError`. | measured | C157, C153 | `/iframe-tiles/` | Iframes as tiles |
| Element Capture, a frozen tab, and WebTransport against a real server. | not verified | | `/transports-2/` | Transport lab 2: newer transport APIs |
| A same-origin iframe drawn rotated and scaled takes taps and typing at the drawn position, and changes in its document raise the canvas's `paint` event. | measured | C157 | `/tab-fan/` | Tab switcher of live pages |
| One same-origin iframe drawn as nine clipped tiles takes clicks, the wheel and touch scroll on each tile when its hit region is moved under the pointer. Input reaches a control through two nested canvas draws and through a drawn iframe. | measured | C157 | `/play/`, `/nested-frames/` | Four games made of live elements; Frames and nested canvases |
| A selection sent as two offsets into `textContent` over a `BroadcastChannel` is rebuilt and drawn in another document. | measured | C157 | `/selection-peers/` | Text selection |
| `captureStream()` of a drawable canvas carries the drawn elements and reaches another page over WebRTC. | measured | C157, one machine | `/media-state/` | Media controls and state |

### Accessibility, focus and selection

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Canvas children are ordinary nodes in the accessibility tree under a "Canvas" node, however they got into the canvas (child, slot, worker, WebGL texture). | measured through the DevTools protocol | C157 | `/a11y/` | Accessibility |
| Tab order is DOM order. `window.find()` finds and highlights text. Mouse drag and double click select. | measured | C157 | `/a11y/` | Accessibility |
| A drawable child that is never drawn is still a Tab stop and in the accessibility tree, at the canvas origin. `inert` fixes it. | measured | C157 | `/a11y/` | Accessibility |
| A pixel mirror (another tab, another origin, a video) has no role, name, focus or text. | measured | C157 | `/a11y/` | Accessibility |
| Selection hit testing follows the drawn geometry, also rotated and scaled. `Range.getClientRects()` follows the drawn position and returns upright bounding boxes under rotation. | measured | C157 | `/selection/` | Text selection |
| Screen reader output, IME candidate windows, the find bar, OS magnifiers. | not verified | | `/a11y/` section C | Accessibility |
| `allow="focus-without-user-activation 'none'"` stops an iframe tile taking focus in C153 and not in C157. | measured | C153, C157 | `/iframe-tiles/` | Iframes as tiles |
| `focusgroup="toolbar wrap"` moves focus in DOM order through buttons drawn by a shader. With `reading-flow: grid-rows`, arrows and Tab follow the drawn order. | measured, real key events from a test script | C157 | `/focus-nav/` | Controller, keyboard and haptic navigation |
| Canvas children without `layoutsubtree` (fallback content) are in the accessibility tree and focusable and have no boxes. A text input among them cannot be typed in. | measured | C157 | `/toolkit-aria/` | An accessibility tree for a Dear ImGui app |
| Any screen reader on the toolkit accessibility tree. | not verified | | `/toolkit-aria/` | An accessibility tree for a Dear ImGui app |
| Links drawn with `globalAlpha = 0` are Tab stops with a hit box at the drawn position and no pixels. A canvas child that is not drawn is a Tab stop until it is `inert`. | measured with the real Tab key | C157 | `/a11y-views/`, `/focus-path/` | Focus trail, target sizes, label lines and heading outline; Focus order drawn as a path |
| A Tab order worked out from the DOM matched the real Tab key for canvas children in six arrangements. | measured | C157 | `/focus-path/` | Focus order drawn as a path |
| Landmark roles of canvas children follow the whole document: a `<header>` drawn in a canvas inside a `<main>` is not a banner. `computedRole` and `computedName` are not available without a flag. | measured through the DevTools protocol | C157 | `/landmark-map/` | Landmark map |
| Sections that are parked and not drawn stay in the accessibility tree as named regions, and Tab reaches them. | measured | C157 | `/structure-depth/` | Page structure drawn in depth |
| `TextMetrics.getSelectionRects()` agrees with `Range.getClientRects()` to within half a pixel, including across a change of direction. | measured | C157, experimental flag | `/plan-followups/` | Follow-ups to the Chrome APIs plan |
| A selection inside `<input>` or `<textarea>` has no rectangles from the browser. It can be measured with `measureText()` or a hidden block. | measured | C157 | `/select-selection/` | Select and selection, second batch |
| `focusin` between elements of one shadow root is not seen on `window`. A tap past the end of the text in a canvas-drawn `<input>` keeps a full selection, where a plain input clears it; the cause was not identified. | measured | C157 | `/qt-textfield/` | Qt text field |

### Form controls and pickers

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Built-in form controls draw and work rotated in a canvas. | measured | C157 | `/inputs/` | Datalist and other inputs |
| A `base-select` select can hold a drawable canvas that draws its options, and keeps the value, keyboard and form entry. | measured | C157 | `/select/` | Customisable select |
| The picker of a select that is itself inside a canvas is not drawn by that canvas, and its options are not hit-testable there. | measured | C157 | `/select/`, `/elements/` | Customisable select; PR #48 |
| The select fires no `toggle` event, has no `hidePicker()`, and `showPicker()` uses up user activation. | measured | C157 | `/select/` | Customisable select |
| The built-in popups of `<input list>`, date, time and colour have no element. A canvas cannot draw them. | measured | C157 | `/datalist/`, `/inputs/` | Datalist and other inputs |
| Where native popups open for a control that is drawn transformed. | not verified | | `/inputs/`, `/elements/` | Datalist and other inputs; PR #48 |
| An option drawn twice in one frame is hit where it was drawn last. Options stop painting when the picker closes, so a copy of the picker canvas is the only picture left. A datalist option can be drawn inside the picture of its input. | measured | C157 | `/select-ideas/`, `/input-ideas/` | Five more select pickers; Five more input pickers |
| `disabled` on a drawn fieldset behaves as outside a canvas. A press on a disabled control still reaches the canvas as `pointerdown`. | measured | C157 | `/form-scenes/` | Form controls in a drawn setting |
| A canvas inside `<select multiple>` is not laid out. With the select in the canvas each `drawable` option can be drawn. A list box (`size`) is drawn with its rows and hit-tests under a shear. | measured | C157 | `/select-selection/`, `/blocked/` | Select and selection, second batch; Blocked ideas |
| `showPicker()` works on a customisable select with a hidden button, needs a user activation and takes the focus. | measured | C157 | `/select-selection/` | Select and selection, second batch |
| `<selectedcontent>` has a box inside the select's picture and can be drawn alone with a clip. | measured | C157 | `/field-heads/` | Field heads |
| `input.list.options` works for a field in a canvas. A datalist has no box. Removing `list` stops the browser's own list. | measured | C157 | `/field-heads/` | Field heads |
| The picture of a password field is the same for two values of one length. | measured | C157 | `/field-heads/` | Field heads |
| A permission element's `isValid` is false when a canvas draws it, true when it is positioned over a canvas, false for about a second after it moves, and true under a small rotation. | measured | C157 | `/blocked/` | Blocked ideas |
| There is no `overscroll-area` property. Touch events on a drawable scroller continue past its end, which a page can use for a pull. | measured | C157, emulated touch | `/blocked/` | Blocked ideas |

### Video and sound

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| A `<video>` is an ordinary canvas child. `paint` fires once per video frame. After `requestVideoFrameCallback()` or `seeked`, one `requestPaint()` gives the exact frame (40 of 40, 10 of 10). | measured, software decoding | C157 | `/video/` | Video and sound |
| HTML over video can be recorded with sound, exported frame by frame with WebCodecs, and sent over WebRTC. | measured | C157 | `/overlay/` | Video and sound |
| Media state pseudo-classes (`:paused`, `:playing` and others) are valid only with experimental web platform features on. | measured | C157 | `/player-parts/` | Video and sound |
| `video.shadowRoot` is `null`. No part of the native controls can be drawn by itself. | measured | C157 | `/player-parts/` | Video and sound |
| Videos errored and the page jumped when checks started on load on the phone. | reported | A159 | the media pages | Video and sound |
| Hardware-decoded video, Widevine, HDR, audible output. | not verified | | `/video/` | Video and sound, Not verified |
| A text track in `hidden` mode keeps `activeCues` current and draws nothing, so captions can be a separate drawn element. `getCueAsHTML()` exposes cue time stamps. Comments as `VTTCue`s in a `metadata` track give the set of elements to draw at any time. | measured | C157 | `/captions/`, `/timed-comments/` | Captions drawn apart from the video; Timed comments that cross the video |
| A video outside the canvas raises no `paint`. As a child of the drawn element it raises one per shown frame, even with `opacity: 0`. Several source-rectangle draws of a playing video in one paint handler show one frame. | measured | C157 | `/video-text/`, `/presenter/`, `/media-tiles/` | Video as a material for editable text; Video, image and chart tiles |
| VP9 alpha is kept by a `<video>` child, by `drawImage(video)` and by `texImage2D(video)`. A presenter drawn from a video outside the canvas takes no hits, so links and controls work under it. | measured | C157 | `/presenter/` | A video presenter over a slide made of DOM |
| A `getDisplayMedia()` stream in a canvas child `<video>` is drawn and does not taint the canvas. A tab capture restricted to the canvas that draws it is a closed loop. | measured | C153 real tab capture, C157 fake monitor | `/telestrator/` | Screen capture with HTML annotation tools |
| The native control panel of `<audio>` accepts a CSS grid, so its parts can be rearranged without script. A source rectangle of the play button copies the browser's own glyph, which follows the element's state. | measured | C157 | `/cassette/` | Cassette deck from audio controls |
| `recognition.start(track)` accepts the audio track of `video.captureStream()`. A caption element in the canvas is part of `canvas.captureStream()`. | measured (start only) | C157 | `/live-captions/` | Live captions with a second language |
| Speech synthesis has no voices in the test browser (`synthesis-failed`), and no speech was recognised. | not verified |  | `/speak-words/`, `/live-captions/` | Words highlighted as they are spoken |
| The box of `::-webkit-media-controls-timeline` is the full width of the player and 24 px high, the track is at its top edge, and the thumb travels between points 22 px inside it. | measured | C157 | `/video-lab/` | Video, second batch |
| `createMediaElementSource()` of a video that is a canvas child feeds a `PannerNode`. | measured | C157, no sound output | `/video-lab/` | Video, second batch |

### View transitions

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| A named drawable canvas works in a document view transition. The new snapshot is live. | measured | C157 | `/view-transitions/` | View Transitions API |
| A named child of the canvas gets a group and empty snapshots. | measured | C157 | `/view-transitions/` | View Transitions API |
| `element.startViewTransition()` on the canvas blanks it unless the canvas has `view-transition-name: none`. Group positions inside a canvas scope read 0,0. | measured | C157 | `/view-transitions/` | View Transitions API |
| `element.startViewTransition()` on a `drawable` child of a drawable canvas crashes the renderer. | measured | C157 | `/view-transitions/crash.html` | View Transitions API |
| A `navigate` listener with `precommitHandler` can append the new view as a canvas child and blend both live views with a shader. `sourceElement` gives the transition origin. | measured | C157 | `/nav-shader/` | Navigations drawn by a shader |
| A snapshot from `captureElementImage()` still draws after its element was removed. | measured | C157 | `/nav-shader/` | Navigations drawn by a shader |
| A transition scoped to a canvas works as a set of CSS-timed clocks for 2D and WebGL drawing. The canvas needs `view-transition-name: none`. | measured | C157 | `/scoped-transitions/` | Transitions and motion, View transitions drawn by a canvas |
| `view-transition-scope: all` on a canvas is needed to start a canvas-scoped transition while a transition on an ancestor is running. Without it the inner one is rejected with "Snapshot capture failed". | measured | C157 | `/scoped-transitions/` | Transitions and motion, View transitions drawn by a canvas |
| `view-transition-class` on canvases is matched by `::view-transition-group(.class)` in a scoped transition. | measured | C157 | `/scoped-transitions/` | Transitions and motion, View transitions drawn by a canvas |

### Capture and export

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Any ordinary element can be wrapped in a temporary canvas and captured in the first rendering update, in about 10 to 20 ms. | measured | C157 | `/capture/` | Capture |
| Frame-exact video export: set `animation.currentTime`, ask for a paint, wrap the canvas in a `VideoFrame`, encode. | measured | C157 | `/capture/`, `/overlay/` | Capture; Video and sound |
| `page.pdf()` includes drawn DOM as a bitmap. | measured | C157 | `/capture/` | Capture |
| Whether a capture flickers on a real screen. | not verified | | `/capture/` | Capture |
| Element Timing reports a canvas child even when the canvas never draws it. `presentationTime` is when the element's picture was painted. A 2D canvas shows a DOM change in the same frame as plain DOM (5 ms median against 4 ms, software rendering). | measured | C157 | `/perf/` | Performance, Latency and long frames |
| `copyElement(el, { html: true })` writes PNG, HTML and text in one `ClipboardItem`. | measured | C157 | `/capture/` | Capture, Clipboard, print margins, folders |
| Redaction done in the paint handler is in `captureStream()`, `MediaRecorder` and WebRTC output. | measured | C157 | `/telestrator/` | Screen capture with HTML annotation tools |
| `toBlob()` on a drawable canvas that holds a figure with a nested plain canvas gives one untainted PNG. | measured | C157 | `/media-tiles/` | Video, image and chart tiles |
| The history of `<dom-rewind>` encodes to WebM through `frames()`, `VideoFrame` and `VideoEncoder` without reading the drawable canvas: 121 frames at 720 by 568 took 5.0 ms each. VP9, VP8, AV1 and H.264 encoders all accept the frames. | measured | C157, software encoders | `/motion-capture/` | Transitions and motion |

### 3D, XR and native toolkits

| Result | Label | Browser | Page | Section |
|---|---|---|---|---|
| Live HTML on flat and curved three.js surfaces takes clicks, typing and selection through `updateElementGeometry()`. A curved surface needs the geometry re-placed on each pointer move. | measured | C157 | `/three-form/` | 3D and spatial |
| In an emulated WebXR session `paint` keeps arriving and DOM changes re-upload. Controller input is synthetic. | measured with the IWER emulator | C157 | `/xr/` | 3D and spatial |
| A real headset, Android AR, `XRQuadLayer`. | not verified | | `/xr/` | 3D and spatial |
| egui and Qt Quick compiled to WebAssembly can use DOM elements as widgets with a bridge of about 200 lines each. | measured | C157 | `/native-ui/` | Native UI toolkits |
| The browser does not know what a toolkit draws over an element, and Tab does not cross from a DOM field to a toolkit widget. | measured | C157 | `/native-ui/` | Native UI toolkits |
| A folded surface drawn as two tilted planes keeps hit testing through a perspective matrix per half. `devicePosture` and `viewport.segments` place the panes. | measured, emulated posture | C157 | `/fold/` | Devices |
| Canvas children convert to Stream Deck HID reports, ESC/POS raster and RGB565 frames, and simulated devices are drawn from the bytes. | measured, no device | C157 | `/hardware-out/` | Devices |
| A title bar element drawn by a canvas works in a simulated window, and the computed `app-region` is found at the drawn position. | measured, simulated window | C157 | `/window-chrome/` | Devices |
| A real foldable, a real Stream Deck, printer or LED matrix, and an installed app window. | not verified | | `/fold/`, `/hardware-out/`, `/window-chrome/` | Devices |
| A fingertip position works as a pointer on a panel, and a panel snaps to a plane, in a simulated room and in the IWER headset emulator. | measured, simulated and emulated | C157 | `/xr-room/` | 3D and spatial, Panels in a real room |
| Real hand joints, detected planes, depth occlusion and a quad layer filled with `texElementSubImage2D()`. | not verified | | `/xr-room/` | 3D and spatial, Panels in a real room |
| Dear ImGui shows a DOM element with one `ImGui::ImageWithBg()` call, and `FindHoveredWindowEx()` gives occlusion. It takes a press from outside through `NavActivateId`. | measured | C157 | `/imgui-dom/`, `/toolkit-aria/` | Dear ImGui with DOM elements; An accessibility tree for a Dear ImGui app |
| Flutter web shows a live DOM form through `createImageFromTextureSource()` from a 2D drawable canvas. With `canvasKitForceMultiSurfaceRasterizer` and `texImage2D()` replaced by `texElementSubImage2D()`, the element lives in Flutter's own canvas. | measured | C157 | `/flutter-dom/`, `/flutter-dom/?design=in-canvas` | A DOM form inside a Flutter web app |
| A Qt Widgets raster window draws DOM fields after each `putImageData()` flush. | measured | C157 | `/qt-widgets-dom/` | Qt Widgets with DOM elements |
| A stock Godot 4.7.2 web export takes a DOM element as a texture through `texture_get_native_handle()` and Emscripten's `GL.textures`. Godot's `mousedown` handler calls `canvas.focus()`, so events have to be stopped at the element. | measured | C157 | `/godot-dom/` | A DOM form in a Godot 4 web export |
| The four toolkit pages on a phone: keyboard, IME, native pickers, frame rate. | not verified | | `/imgui-dom/`, `/flutter-dom/`, `/qt-widgets-dom/`, `/godot-dom/` | their files in `findings/` |
| A QML text field whose text is a real `<input>` drawn with `texElementSubImage2D()` and bound both ways to a QML property works. A scripted composition deleted earlier letters in Qt's own `TextField` and not in the DOM field. | measured | C157 | `/qt-textfield/` | Qt text field |
| Occlusion by another toolkit window with no script at event time works with an empty drawable blocker element placed last (no repaint), or with `clip-path` on the field (one upload per move). | measured | C157 | `/toolkit-occlusion/` | Occlusion between toolkit windows |

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
| A guard on every page (PR #63) counts contexts and puts a note with a Reload button over a canvas that stays lost. `check:jank` limits a page to 8 live WebGL contexts and 0 lost canvases. Whether this ends the white boxes on the phone has not been reported. | measured in C157; not verified on A159 | C157 | every page | Pages that hold still |
| On the phone the float16 Display P3 2D contexts of `/hdr-glow/` were lost every 1.5 s, the interval of the page's float readback. PR #75 made the readback a button and added an 8-bit fallback. Which of the readback, the float canvas or the GPU process causes the loss is not known. | reported | A159 | `/hdr-glow/` | HDR interface |
| On the phone a 2D canvas of `/scoped-transitions/` showed white with the broken-picture icon. Killing the GPU process in the test browser loses all thirteen contexts and all come back within 2.5 s. | reported; recovery measured | A159, C157 | `/scoped-transitions/` | Transitions and motion, View transitions drawn by a canvas |
| A drawable 2D canvas made with `willReadFrequently: true`, after one `drawElementImage()`, loses every 2D context on the page, and they are lost again every half second while it exists. Ten other 2D operations tried do not lose a canvas. | reported | A159 (Android 10); no loss in C157 | `/canvas-loss/`, `/crashes/` | Which 2D operation loses the canvas |
| `getImageData()` with `pixelFormat: 'rgba-float16'` on a float16 Display P3 2D canvas loses every float16 2D context on the page, on a timer and on a tap, though not on every call. Drawing elements into that canvas with no readback does not lose it. | reported | A159 | `/hdr-glow/` | HDR interface |
| With `willReadFrequently` removed from drawable canvases by the guard and reads made from a `drawImage()` copy, the phone ran all 21 trials with both fixes holding. | reported | A159 | `/canvas-loss/` | Which 2D operation loses the canvas |
| `/instruments/`, `/scoped-transitions/` and the five text pages of PR #80 lost 2D canvases or the tab on the phone with small canvases and no WebGL context. The cause is not identified. | reported | A159 | those pages | Which 2D operation loses the canvas |
| Crashes, lost contexts and script errors from every copy of the site are stored by `/api/reports` and listed by `npm run reports`. | measured | C157 | `docs/crash-reports.md` | Which 2D operation loses the canvas |
| The inner canvases of `/nested-frames/` were empty on the owner's phone on 2026-11-21 with no report sent, and drew on 2026-11-22 after the page began to ask each inner canvas for its first paint with `requestPaint()`. Whether that request is what changed it is not known. | reported | A159 | `/nested-frames/` | Frames and nested canvases |
| `/element-ideas/` drew its elements 2.625 times too large on the phone because of no-size draws under a scaled context. The audit found 2 wrong calls in 402 across 122 pages; both are corrected and `npm run build` now fails on a no-size call. | reported, then measured | A159, C157 at device scale 2.625 | `/element-ideas/` | `findings/draw-size.md` |
| `/friction/` lists 79 places where the API did not behave as expected, by kind and area, and re-runs 19 of them in the visitor's browser. | measured | C157 | `/friction/` | `findings/friction.md` |

## Chromium bugs worth filing

Crashes and behaviour that looks wrong, each with where to reproduce it. All were seen in headless Chromium 157 unless the row says otherwise. None has been filed. Some may be intended behaviour: the notes say where that is likely.

| # | What happens | Reproduce | Note |
|---|---|---|---|
| 1 | Renderer crash: `element.startViewTransition()` on a `drawable` child of `<canvas content="drawable">`. | `/view-transitions/crash.html` | Crashes with or without `layoutsubtree`, with or without a draw. A child without `drawable` does not crash. |
| 2 | Tab crash: inserting, moving or removing an iframe inside a `paint` handler or a microtask of one. | `/capture/` (the library avoids it with a MessageChannel task) | The same CHECK every time (`trap int3`, same address). |
| 3 | Tab crash: `adoptNode()` of a drawable canvas that has painted into a same-origin iframe. | `/transports/crash-adopt.html`, button B | Works if the canvas has never painted. Probably the same failure as 2. |
| 4 | Tab crash: an opacity effect around a drawable canvas, inside an iframe that is itself drawn into a canvas. | `/board/` with a page tile whose fixtures sit in a box with `opacity: .02` | `visibility: hidden` does not crash. |
| 5 | Tab crash: `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas holding an element texture. | Seen in check fixtures of `/selection/` and `/player-fx/` | A smaller case with one canvas did not crash. The cause is not known. |
| 6 | `updateElementGeometry()` does not invalidate the cached hit-test result for a point. `elementFromPoint()` and a click at the same point see the old layout. | Live check on `/particles/`; also `/native-ui/`, `/hit-regions/` | A point 1 or 2 px away is correct. Any DOM attribute change clears it. The same happens after a 2D `drawElementImage()` moves an element. The cache holds two points. `elementsFromPoint()` is not affected. |
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
| 19 | Reported from Chrome 159 on Android: canvases on new pages lose their context on first load and show a white box with a broken-picture icon. | `/selection/` and other pages built on 2026-11-21 | Two causes were found later (bugs 27 and 28). Pages that do neither still lost canvases, so this row stays open. `/crashes/` lists every case with steps. |
| 20 | Tab crash: `SpeechRecognition.available({ langs: ['en-US'], processLocally: true })`. | Any page, headless Chromium 157 (`/voice/` asks only after a tap) | Not related to HTML-in-canvas. Not tried in a headed browser. |
| 21 | `Translator.availability({ sourceLanguage: 'en', targetLanguage: 'fr' })` never settles. | `/translate-lens/`, headless Chromium 157 | The page gives up after 3 s. |
| 22 | Possible: a drawable element whose hit box was outside the canvas keeps an empty picture after the hit box returns, until something else repaints it. | `/carousel/` | Not reduced to a small page yet. |
| 23 | `<geolocation>` in a canvas reports `isValid` false with reason `intersection_occluded_or_distorted`, even drawn over its own box with no transform. | `/protected/` | May be intended. |
| 24 | A touch drag on `<input type="range">` drawn rotated 90 degrees is not followed. A mouse drag is, and a slider drawn at 17 degrees drags by touch. | `/element-ideas/`, touch emulation | Needs a check on a real phone before it is reported. |
| 25 | A drawable element nested in another drawable element gets a cut or empty paint record when it repaints partly outside the canvas or the window, and the record is not refreshed when it comes into view. | Live check on `/minimap/` | Possibly the same as bug 22. That is inferred, not tested. `/keycaps/` reproduces it in its last live check: the record is clipped to the window at the last drawn position and not recorded again when it scrolls in (Chromium 157.0.8103.78). |
| 26 | A scroll container that is a non-drawable child of a drawable canvas does not take user scrolls from its drawn descendants, and a `wheel` listener on it does not make wheel events cancelable. | `/minimap/` | |
| 27 | Reported from Chrome 159 on Android: `getImageData()` with `pixelFormat: 'rgba-float16'` on a float16 Display P3 2D canvas loses every float16 2D context on the page. | `/hdr-glow/`, `/crashes/` | Corrected on 2026-11-21: drawing elements with no readback does not lose the context. Needs a reduced page, without HTML-in-canvas if it still reproduces, before filing. HDR output itself showed no bug on `/hdr-glow/repro.html`. |
| 28 | Reported from Chrome 159 on Android 10: a drawable 2D canvas made with `willReadFrequently: true` loses every 2D context on the page after one `drawElementImage()`, and again every half second while it exists. | `/canvas-loss/` (trial `wrf`), `/crashes/repro/readback-matrix.html` | No loss in headless Chromium 157. |
| 29 | Candidate: `:active` is not applied to a `drawable` descendant of a canvas for a touch press. It is for a mouse press. | `/form-state/`, emulated touch | Needs a reduction and a real touch screen before filing. |
| 30 | Candidate: the content of a `<canvas>` (2D or `bitmaprenderer`) nested in a `drawable` element is drawn shifted by minus the canvas's offset inside that element, and cut by the canvas's box. | Live check "Where the content of an inner canvas is drawn when it has padding round it" on `/media-tiles/` | `contain: paint` or a transform on the inner canvas avoids it. Ratio 1 and 2. |
| 31 | After `drawElementImage()` with a source rectangle, `updateElementGeometry(el, { canvasTransform })` leaves the hit region with the size of the source rectangle. | Live check on `/text-notes/` | May be intended. Then the API has no call that restores the whole region without a draw. |
| 32 | Possible: `captureStream()` on a WebGL 2 drawable canvas drawn in the `paint` event delivers black frames unless `preserveDrawingBuffer` is set. | `/presenter/`, software GL | Not reduced to a case without HTML-in-canvas. |
| 33 | In a worker, `drawImage(VideoFrame)`, `createImageBitmap(VideoFrame)` and `texImage2D(VideoFrame)` of an I420 frame wait for the main thread. | Check rows on `/worker-compositor/`, software rendering | Not related to HTML-in-canvas. |

`/crashes/` (`public/crashes/cases.js`) holds every crash and context loss with steps and evidence for a report. Add a case there when a new one is found.

Further cases of bugs 2 and 5. On `/iframe-tiles/`, removing an iframe canvas child inside `paint` or a microtask of it crashes the tab, and so does `loseContext()` there when the canvas has an iframe child; leaving the event with `setTimeout(0)` first avoids both. On `/protected/`, `loseContext()` on a drawable canvas that is then removed crashes the tab: at once when both happen in one task, and after a 150 ms wait too when the canvas has an iframe child.

## API changes that would help

Requests that came out of the experiments. Each is followed by the section that explains it.

Drawing:

- Draw an element by reference (an id) and not only by DOM containment. It would remove the need for a shadow root in the slot pattern. (Summary; Slots)
- Draw one element into more than one canvas, or draw an `ElementImage` into a second canvas. It would make cross-document reprojection possible without pixels. (Summary; ElementImage and OffscreenCanvas)
- `drawElementImage()` taking a pseudo-element or a `::part()`, so one part of a closed shadow tree (for example one media control) can be drawn. (Video and sound, Further experiments)
- A way to read a view transition's old snapshot into a canvas or texture. (View Transitions API)
- A way to use an `ElementImage` outside its canvas, for example `createImageBitmap(elementImage)` or drawing it into an `OffscreenCanvas`. A framework that renders off screen and presents bitmaps, such as Flutter's default rasterizer, cannot use element images without it. (A DOM form inside a Flutter web app)
- `texElementSubImage2D()` accepting `RGBA16F` storage, and `drawElementImageToTexture()` keeping values above 1.0 in a float texture, so GPU routes receive HDR CSS colours. (HDR interface)
- A way to ask for the whole picture of an element whatever is clipped or off screen, or a documented rule for when a paint record is cut. (Live minimap)
- A way for top-layer content (a popover, a dialog, a select's picker) to be in a canvas's picture, or for a picker's content to keep painting for a moment after it closes. (Customisable select)
- A no-size `drawElementImage()` that follows the unit of the current transform (CSS pixels after `scale(dpr)`), or an explainer that states the default size in terms of the backing scale. `getElementImageDefaultSize()` returns the size in canvas pixels. (`findings/draw-size.md`)
- `drawElementImage()` taking a `CSSPseudoElement`. Today it throws `TypeError`. (Media controls and state)

Hit testing and input:

- Several regions for one element in `updateElementGeometry()`, or a hit-test callback. It would make two pointers on shards or glyphs correct. (Summary; Transitions and motion)
- A way to describe occlusion: subtract regions from an element's geometry, or let the browser ask what covers it. Asked for by the portal, lens, 3D and native toolkit work. (3D and spatial; `docs/native-frameworks.md`)
- A way to hand the browser a ray hit (element plus point) and have it dispatch a trusted event, for XR controllers. (Summary; 3D and spatial)
- `updateElementGeometry()` invalidating cached hit-test results. (Transitions and motion)
- One documented unit for `canvasTransform`. (UI primitives)
- `touch-action` taking effect for elements drawn by a canvas in the top layer. (Customisable select)
- A way to set the hit region of an element without drawing it, including resetting the source rectangle that a nine-argument draw leaves on it. (Select and selection, second batch)
- A stated hit-test order. Today it is the order of the last `updateElementGeometry()` calls, which a page can only learn by measuring. A `zIndex` or `order` member, or a statement that call order is the order, would let a toolkit hand over its own z-order. (Occlusion between toolkit windows)
- A `canvasClip` of more than one rectangle (a list or a `Path2D`), and a way to clear it. Until then a list or `null` should throw: both are read as an empty rectangle and remove the hit box. (Occlusion between toolkit windows)
- A hit-only region that belongs to the canvas itself, with no element, so a blocker does not need a node in the accessibility tree. (Occlusion between toolkit windows)

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
- Rectangles for a selection inside a text control. (Select and selection, second batch)

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
