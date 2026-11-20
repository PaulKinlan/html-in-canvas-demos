# Findings

Verified in Chromium 153 and 157 (headless, API on by default in those builds) on 2026-11-20. Every demo page re-runs these checks live in your browser.

The API surface used here is the current WICG explainer shape: `<canvas content="drawable">` (older builds: `layoutsubtree`), the `drawable` attribute on drawn elements, the `paint` event, `drawElementImage()`, `captureElementImage()` and `ElementImage`.

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
| three `WebGPURenderer` drawing those textures | not verified | Any WebGPU render pass loses the device in this software GPU. Needs real hardware: `/three-form/?renderer=webgpu`. |
| `drawElementImage` under a zoom transform, 40% to 800% | works | Text is re-rasterised (no in-between pixels at 800%) and hit testing follows the transform. |
| Same-origin iframes as canvas children | works | They paint, take clicks, typing and wheel at any zoom, and a change inside one fires the board's `paint` naming that tile. Other HTML-in-canvas pages, a WebGL scene and the board itself nest. |
| Pointer and wheel events over an iframe tile | swallowed | They never reach the parent, so pan and zoom need a cover element until the tile is activated. |
| A tile that is no longer drawn | still clickable | It keeps the hit region of its last draw until it is parked with `updateElementGeometry()`. |
| Overlapping tiles | last drawn wins | `z-index` on the elements changes nothing. Bring-to-front is draw order, so iframes never move in the DOM (and never reload). |
| `elementFromPoint` on canvas children | viewport only | Like any element. Live checks have to scroll the canvas into view first. |
| WebXR session with HTML panels (emulated Quest 3, IWER) | works | Paint events keep arriving, a DOM change re-uploads in session, and `elementFromPoint` still answers for a flat layout of the elements. |
| Controller ray to DOM input | works, by hand | Raycast, UV to element pixels, `elementFromPoint`, synthetic pointer and mouse events. Untrusted events do not focus, place a caret, drag a range or open a `<select>`, so `RayPointer` in `html3d.js` does each of those itself. |
| On-panel keyboard | works | Keys cancel `mousedown` so focus stays put; `setRangeText()` plus an `input` event types at the caret; Enter calls `requestSubmit()`. |
| The form as an `XRQuadLayer` (sharp text, composited by the headset) | not verified | Written, opt-in, and reports its result on the page. The emulator has no `createQuadLayer`. |

Not tested here: a real headset or Android AR session. Whether `paint` keeps firing while the page is hidden behind an immersive session is the open question; `/xr/` counts paint events in session, shows the result on a panel inside the headset, and falls back to uploading from the last paint record if they stop.

## What this means

- The slot pattern is a real answer to "the DOM has to live inside the canvas": the markup stays in the light DOM and only the canvas moves into a shadow root.
- Reprojection across documents is a pixel stream plus input forwarding, not a shared snapshot. Semantics (selection, accessibility tree, find-in-page) stay in the source document.
- The primitives all rest on the same wrapper and the same two workarounds: stretch one canvas over everywhere the element must appear, and move the single hit-test geometry to wherever the pointer is. A way to draw one element into several canvases, and a per-region geometry, would remove both.
- One element has one hit box. Effects that show an element in many pieces (shards, glyphs) can route one pointer correctly but not two, and a way to give `updateElementGeometry` several regions, or a hit-test callback, would close that gap.
- Accessibility largely survives, with one sharp edge: whatever is in the canvas but not drawn is still focusable. An opt-in such as "undrawn means inert" would remove the main hazard.
- Any element can be exported with one call today, and a whole ordinary page can be wrapped in a canvas for a single frame without the user seeing it.
- A native "draw this element by reference" hook for canvas (an id reference rather than DOM containment) would remove the need for the shadow root. An ElementImage that could be drawn into a second canvas would make cross-document reprojection first class; today it is deliberately bound to one canvas.
- For 3D, the texture half of the API is ready and the method names are the only obstacle in three.js today. The input half rests entirely on `updateElementGeometry()`: it accepts a perspective matrix, which covers every flat surface, and anything curved or occluded needs the app to re-place the element under the pointer.
- In XR there is no pointer for the browser to hit test, so input is synthetic and loses everything a trusted event does for free. A way to hand the browser a ray hit (element plus point) and have it dispatch a trusted event would remove most of `RayPointer`.
