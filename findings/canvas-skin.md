# Per-element themes (`/canvas-skin/`, `lib/canvas-skin.js`, `lib/canvas-skin-themes.js`)

Measured in headless Chromium 157 (C157) on 2026-11-22, at 412 px wide, device scale 2 and 2.625, with taps sent as touch events. Not run on a phone.

`<canvas-skin>` wraps one element in a small drawable 2D canvas. A `skin` attribute on an ancestor chooses how every wrapper under it draws. Six skins are built in: glass, pencil, gel, terminal, blueprint and native (the browser's own drawing).

| Question | Result | Reason or detail |
|---|---|---|
| Can a page be themed with one drawable canvas per element instead of one canvas for the page? | Yes (measured). 53 wrappers on the page, 32 of them in the form. | Shadow root: `<canvas content="drawable" layoutsubtree><div drawable><slot></slot></div></canvas>`. The element is slotted and stays in the page's DOM. |
| Do the wrapped controls take input? | Yes (measured). Tap on a checkbox, click on a range, label click, typing, form data. | The canvas has `pointer-events: none`, the drawable `<div>` has `pointer-events: auto`. `elementFromPoint()` at a button's centre returns the button. |
| Does the canvas's extra 14 px on each side take hits from neighbours? | No (measured). | A point 6 px outside a wrapped button, over its canvas, returned the element under the canvas. |
| Can a skin draw a control from its state without painting the native control? | Yes (measured) for checkbox, radio, switch, range, progress. | The native control is drawn once per paint inside an empty clip. It toggled on `click()` and on a tap, and a click at 80% of a range set 82. |
| Is a block `<div>` inside `<canvas layoutsubtree>` as wide as the canvas? | No (measured). It is as wide as its content: a heading was 211 px in a 380 px canvas. | It needs `width: calc(100% - 28px)`. |
| Does a wrapper inside a wrapper draw and take input? | Yes (measured in C157). | The outer canvas had the inner button's pixels, and the point found the `<button>`. `/nested-frames/` has a report of nested canvases not drawing on A159. |
| Can the wrappers share one WebGL context? | No (inferred from `findings/` results on `ElementImage` and `texElementSubImage2D()`: an element is drawn only by a canvas it is inside). | So the skins are 2D, and effects are SVG filters used as `ctx.filter = 'url(#id)'`, carried in each wrapper's shadow root. |
| Can a glass skin show the page background through an element? | Yes, when the background is known to the skin (measured by eye in screenshots). | The canvas cannot read what is behind it. The skin has the root's CSS gradients again as canvas calls and draws them 1.3 times larger inside each element. |
| How is a change of skin animated? | Each wrapper copies its canvas with `drawImage()` into a plain canvas, switches, and fades the copy out over the new drawing in 640 ms (measured: order 10, 130, 323 ms for three buttons at 0.3 px per ms). | `CanvasSkin.apply(root, name, { x, y })` gives each wrapper a delay by distance from the point. The root's old background stays on a layer whose mask has a growing hole. |
| What does it cost? | 12.6 MB for all canvases by the guard's estimate at scale 2.625, largest canvas 0.55 MP, 0 WebGL contexts. 30 wrapped buttons: 99 KB each at scale 2 (measured). | Wrappers more than one screen away set their canvas to 0 by 0. |
| What happens after a lost context? | The wrapper moves the element out of the canvas and sets `plain` (measured with a dispatched `contextlost` event). | The element then has the skin's font and colours and a CSS border. |

## Things that bit

- A block wrapper has no intrinsic width, because its only in-flow content is the box that holds the canvas. In a flex row or a grid cell with `justify-items: start` it was 0 px wide and got no paint event. Wrappers of buttons, checkboxes, radios, switches, labels and outputs are inline and are sized from the element.
- `GLASS` background: a CSS gradient tile cuts each blob at the tile's edge. The seam showed in the page and in the canvas copy until each blob was listed three times, one tile apart.
- `ResizeObserver` on the canvas as well as on its child would report a loop error, because the canvas is the child's ancestor. The wrapper observes the child only and computes the canvas size from it.
- Playwright's `setViewportSize()` resets a forced device scale factor to 1.

## Not verified

- Everything on Chrome 159 for Android: how many small 2D canvases it keeps, the speed of a change of skin with about 20 wrappers fading at once, the pencil skin's SVG displacement filter on every wrapper, the native picker of a wrapped `<select>`, the on-screen keyboard over a wrapped field, a screen reader. Opening `/canvas-skin/` on the phone, changing skins and running the checks would verify these. The line under the form reports how many wrappers fell back to plain HTML and why.
- Frame rate. The test browser renders in software.
- `computedRole` was not available in the test browser, so the role check reports only form and label behaviour there.

## For the index

- Custom elements and slots: a drawable `<div>` round a `<slot>` in a per-element canvas, with `pointer-events: none` on the canvas, leaves the slotted control hit-testable and keeps the canvas's margin from taking hits.
- Layout: a block child of `<canvas layoutsubtree>` shrinks to its content unless given a width.
- Forms: a control drawn only in an empty clip (never painted) still takes taps and drags.

## Open ideas

- A skin whose background moves (the glass background drifting) would need every glass wrapper to repaint per frame.
- A wrapper could take `backdrop` from a second canvas that draws the root, to show arbitrary content through glass.
- `CanvasSkin.wrap()` could run again from a `MutationObserver` for elements added later.
