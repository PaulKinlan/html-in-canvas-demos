# Per-element themes (`/canvas-skin/`, `lib/canvas-skin.js`, `lib/canvas-skin-themes.js`)

Measured in headless Chromium 157 (C157) on 2026-11-22, at 412 px wide, device scale 2 and 2.625, with taps sent as touch events. Not run on a phone.

`<canvas-skin>` wraps one element in a small drawable 2D canvas. A `skin` attribute on an ancestor chooses how every wrapper under it draws. Twelve skins are built in: glass, pencil, gel, terminal, blueprint, thermal camera, neon sign, embroidery, polished metal, sea, space and native (the browser's own drawing).

| Question | Result | Reason or detail |
|---|---|---|
| Can a page be themed with one drawable canvas per element instead of one canvas for the page? | Yes (measured). 53 wrappers on the page, 32 of them in the form. | Shadow root: `<canvas content="drawable" layoutsubtree><div drawable><slot></slot></div></canvas>`. The element is slotted and stays in the page's DOM. |
| Do the wrapped controls take input? | Yes (measured). Tap on a checkbox, click on a range, label click, typing, form data. | The canvas has `pointer-events: none`, the drawable `<div>` has `pointer-events: auto`. `elementFromPoint()` at a button's centre returns the button. |
| Does the canvas's extra 14 px on each side take hits from neighbours? | No (measured). | A point 6 px outside a wrapped button, over its canvas, returned the element under the canvas. |
| Can a skin draw a control from its state without painting the native control? | Yes (measured) for checkbox, radio, switch, range, progress. | The native control is drawn once per paint inside an empty clip. It toggled on `click()` and on a tap, and a click at 80% of a range set 82. |
| Is a block `<div>` inside `<canvas layoutsubtree>` as wide as the canvas? | No (measured). It is as wide as its content: a heading was 211 px in a 380 px canvas. | It needs `width: calc(100% - 28px)`. |
| Does a wrapper inside a wrapper draw and take input? | Yes (measured in C157). | The outer canvas had the inner button's pixels, and the point found the `<button>`. `/nested-frames/` has a report of nested canvases not drawing on A159. |
| Can the wrappers share one WebGL context? | Not to draw elements (inferred from `findings/` results on `ElementImage` and `texElementSubImage2D()`: an element is drawn only by a canvas it is inside). Yes for pixels that are not an element (measured, headless Chromium 157, 2026-11-22). | The elements are drawn by 2D canvases, with SVG filters used as `ctx.filter = 'url(#id)'` in each wrapper's shadow root. The glass skin uses one WebGL2 context on a detached canvas (`lib/glass-gl.js`): each glass element sends the part of the background copy that lies behind it as a texture, the shader runs, and the wrapper copies the result with `drawImage()`. |
| Can a glass skin show the page background through an element? | Yes, when the background is known to the skin (the live check "The glass shader bends the background" compares refractive index 1.5 with 1). | The canvas cannot read what is behind it. The skin has the root's CSS gradients and diagonal lines again as canvas calls and draws them into a shared plain canvas. The shader treats the element as a slab with a rounded rim: signed distance to the rounded rectangle, surface height and normal, `refract()` once each for red, green and blue, an 8-tap blur for frost, highlights from a light direction. Settings: light angle, rim width, thickness, refractive index, dispersion, frost, highlights, tint. Five modes are sets of these values (Regular, Clear, Frosted, Thick lens, Prism); the values are this page's, not Apple's. Without WebGL, or after the shared context is lost, glass is drawn in 2D as 12 enlarged rings. No check exercises the 2D version after a real loss. |
| How is a change of skin animated? | Each wrapper copies its canvas with `drawImage()` into a plain canvas, switches, and fades the copy out over the new drawing in 640 ms (measured: order 10, 130, 323 ms for three buttons at 0.3 px per ms). | `CanvasSkin.apply(root, name, { x, y })` gives each wrapper a delay by distance from the point. The root's old background stays on a layer whose mask has a growing hole. |
| What does it cost? | 18.8 MB for all canvases by the guard's estimate at scale 2.625 (`npm run check:jank`, 2026-11-22), largest canvas 0.67 MP, 1 WebGL context. 30 wrapped buttons: 99 KB each at scale 2 (measured). | Wrappers more than one screen away set their canvas to 0 by 0. The WebGL context is made when the first glass element paints, which is at load on this page because it opens in glass. |
| What happens after a lost context? | The wrapper moves the element out of the canvas and sets `plain` (measured with a dispatched `contextlost` event). | The element then has the skin's font and colours and a CSS border. |

## Things that bit

- A block wrapper has no intrinsic width, because its only in-flow content is the box that holds the canvas. In a flex row or a grid cell with `justify-items: start` it was 0 px wide and got no paint event. Wrappers of buttons, checkboxes, radios, switches, labels and outputs are inline and are sized from the element.
- Glass background: a CSS gradient tile cuts each blob at the tile's edge. The seam showed in the page and in the canvas copy until each blob was listed three times, one tile apart.
- `ResizeObserver` on the canvas as well as on its child would report a loop error, because the canvas is the child's ancestor. The wrapper observes the child only and computes the canvas size from it.
- Reported from A159 on 2026-11-22, three times in one visit: "ResizeObserver loop completed with undelivered notifications". The wrapper wrote its box size inside the observer callback, which resizes other observed elements (the outer wrapper of a nested pair, a neighbour in a flex row). The sizes are now read and written in one animation frame for all wrappers. The error did not occur in C157 before or after, so the fix is not verified.
- Playwright's `setViewportSize()` resets a forced device scale factor to 1.

## Skins added on 2026-11-22 (headless Chromium 157)

| Question | Answer | How |
|---|---|---|
| Can a skin work on the pixels of the element's picture? | Yes (seen in screenshots, no live check yet). | `grab()` in `lib/canvas-skin-draw.js`: the wrapper's canvas draws the element, the whole canvas is copied into a plain canvas with `drawImage()`, and the wrapper's canvas is cleared. The embroidery skin draws that copy small and enlarges it with no smoothing, then uses a repeated cross as a `destination-in` mask. The sea skin gives the copy to a shader as a texture. |
| Can other shaders use the glass skin's WebGL context? | Yes. `check:jank` counts 1 WebGL context with glass, metal, sea and space all on the page. | `shade(name, body, panel, scale, values, source, copy)` in `lib/glass-gl.js` compiles a program per name in the same context. Each call is one pass into the shared canvas and one `drawImage()` into the wrapper. |
| Can a skin animate without painting every frame? | Yes. | A skin sets `frame.wait` to a number of milliseconds and the wrapper asks for its next paint after that time. The sea skin uses 50 ms. |
| Can a skin use where the page was touched? | Yes (seen in screenshots after synthetic pointer events, no live check yet). | The thermal skin listens for `pointerdown` and `pointermove` on the document, keeps the last 40 points for 4.5 seconds, and asks the wrapper under the pointer to paint. |

Problems met: a grain of 0.6 on the metal normal made the reflection unreadable noise and hid the field text; 0.07 reads as brushing. A cross-stitched heading at 2.2 px cells was not legible, so only pictures are cross-stitched and text is drawn through a lighting filter.

## Not verified

- Everything on Chrome 159 for Android: how many small 2D canvases it keeps, the speed of a change of skin with about 20 wrappers fading at once, the pencil skin's SVG displacement filter on every wrapper, the native picker of a wrapped `<select>`, the on-screen keyboard over a wrapped field, a screen reader. Opening `/canvas-skin/` on the phone, changing skins and running the checks would verify these. The line under the form reports how many wrappers fell back to plain HTML and why.
- Frame rate. The test browser renders in software.
- The sea skin on the phone: every near wrapper does a canvas copy, a texture upload, a shader pass and a `drawImage()` 20 times a second. If the phone cannot keep up, raise `frame.wait` or animate only the element under the pointer.
- The no-WebGL versions of metal, sea and space. They are written and no check runs them.
- The glass shader on a phone GPU: the cost of one texture upload and one shader pass per glass element per paint, and how dragging a glass slider (every glass element repaints per input event) feels. The line under the form says whether glass is drawn by the shader or the 2D version, and why.
- A WebGPU version of the glass shader. The project order is WebGPU, WebGL, 2D; only WebGL and 2D are written.
- The "ResizeObserver loop" error reported from the phone on 2026-11-22. Sizes are now applied in one animation frame; the error did not occur in Chromium 157 before or after, so the fix is not confirmed.
- `computedRole` was not available in the test browser, so the role check reports only form and label behaviour there.

## For the index

- Custom elements and slots: a drawable `<div>` round a `<slot>` in a per-element canvas, with `pointer-events: none` on the canvas, leaves the slotted control hit-testable and keeps the canvas's margin from taking hits.
- Layout: a block child of `<canvas layoutsubtree>` shrinks to its content unless given a width.
- Forms: a control drawn only in an empty clip (never painted) still takes taps and drags.

## Open ideas

- A skin whose background moves (the glass background drifting) would need every glass wrapper to repaint per frame.
- A wrapper could take `backdrop` from a second canvas that draws the root, to show arbitrary content through glass.
- `CanvasSkin.wrap()` could run again from a `MutationObserver` for elements added later.
