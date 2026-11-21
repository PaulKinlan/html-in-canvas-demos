# UI primitives (`/portal/`, `/lens/`, `/shader-css/`, `/physical/`)

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

## Touch, top layer and live checks on a phone

- **A drawable canvas in the top layer takes its content out of the page's scroll chain.** With `layer="top"` the portal canvas is a popover, and its child content is hit tested there. A wheel or a finger on a document that sits inside a scrolling box then scrolls the page, not the box, so the minimap demo could not be scrolled on a phone. `<dom-portal-source>` now puts the chain back by hand: it finds the nearest scrolling ancestor with room (starting from the copy under the pointer), scrolls it on wheel, and pans it on touch with a short fling. `touch-action: pinch-zoom` on the content keeps the browser from panning the page under the finger.
- **A finger does not hover.** Portal hit testing follows the last pointer position, so after a tap on a copy the geometry stayed on that copy and the next touch on the source hit nothing. The pointer is now forgotten 350ms after a touch ends (long enough for the tap's click to land).
- **Live checks must not touch the page a visitor is using.** `scrollIntoView()` for `elementFromPoint()`, `focus()` and `scrollTo(0, 0)` at the end all fight a person on a phone. Checks on these pages now build fixtures in a small panel fixed to the bottom of the window (`checkBench()` in `shared/support.js`), which is in the viewport without scrolling, and remove it when done. Each check starts with an empty bench so canvases and GPU contexts are given back.
- **A canvas clipped away by `overflow: hidden` is not painted.** Twenty fixtures in a bench with a capped height left ten without a picture until the bench was allowed to grow.
- **The first frame can come before the canvas has its real size.** On a 2.6× screen a shader slot drew one frame at the default buffer size, was resized (which clears it), and was blank until the next paint. Wait a few frames after the first before reading pixels.
- **A dying WebGL context fails shader compiles with an empty log before `isContextLost()` turns true.** Treating that as a broken shader cached the failure and left the effect off. An empty log is now treated as a lost context and not remembered.
- **Lost or blank canvases say so.** Surfaces fall back to plain HTML with a short note when a 2D or WebGL context does not come back; the portal source swaps in a fresh canvas up to three times, then shows plain HTML and inert copies. Every page ends with a check that the visible demos still have pixels, and switches a blank one to plain HTML.
- **`fx-backend` on an adopted element was ignored**, because the wrapper connects before the element is moved into it. It only showed once fixtures stopped piling up (the page used to hit the direct-context limit by accident).

## The fx attribute as a library (`/lib/fx.js`)

- **`shader-fx.js` could not be loaded from another site.** `/lib/*` is served with `Access-Control-Allow-Origin: *`, but the module imports `/shared/backend.js`, which is not. `/lib/fx.js` is the same code joined into one file by `tools/bundle/fx.mjs`, so one request under `/lib/` is the whole library.
- **A module script that runs after the document is parsed wraps elements at once**, before a later module on the page has called `defineEffect()`. An effect defined afterwards was drawn, but with the `bleed` of the effect that was missing (0). The surface now takes its bleed from the effect each time the effect changes.
- **A second copy of the library on a page** would wrap every `[fx]` element a second time with a class that is not registered. The second copy now logs a warning and does nothing.
- **An effect with only WGSL** used to fail its GLSL compile with an empty source. It now gets the pass-through GLSL, so WebGL draws the element unshaded.

## Named effects and shader slots (`/slot-effects/`)

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
