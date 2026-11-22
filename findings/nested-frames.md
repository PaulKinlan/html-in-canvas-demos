# Frames and nested canvases (`/nested-frames/`, `lib/effect-frame.js`)

Measured in C157 (headless Chromium 157.0.8103.78 shell) on 2026-11-21, at 412 px wide with emulated touch and at 1100 px with a mouse. Results come from the 14 live checks on the page and from `node tools/nested-frames/check.mjs`, which drives the five demos with taps, typed keys and touch drags (33 steps). Nothing here has been run on A159.

PLAN.md backlog group 19: 19.1 widget with its own effect inside a scene, 19.2 email preview on a drawn phone, 19.3 custom element that packages an effect, 19.4 HTML button inside an SVG diagram, 19.5 script that shows itself. Each demo is one 2D canvas (the widget demo has two small inner 2D canvases as well). No WebGL or WebGPU.

## A drawable canvas inside a drawable canvas

| Question | Result | Detail |
|---|---|---|
| Can a drawable canvas be a `drawable` child of a drawable canvas and be drawn by it? | measured: works | One `drawElementImage(inner, x, y, w, h)` call. The inner canvas's own fill and the element it drew are both in the picture. |
| Does a draw in the inner canvas raise `paint` on the outer canvas? | measured: yes, 1 event | `changedElements` holds the inner canvas. The outer canvas needs no listener on the inner one. |
| Does a change to an element inside the inner canvas reach the outer canvas? | measured: yes | 1 `paint` on the inner canvas, then 1 on the outer. The outer canvas shows the new colour. |
| Is a button two canvases down hit tested where it is drawn? | measured: yes | Inner draw at 20, 20, outer draw enlarged 1.25 and sheared 0.2. `elementFromPoint()` finds the button at the composed place. Taps counted (tool). Its `getBoundingClientRect()` is the drawn box. |
| Range input in a sheared inner canvas, touch drag | measured: works | Dragged to 90% of its drawn width: value 96. |
| Is an inner canvas wider than the outer canvas recorded whole? | measured: yes | 400 px inner canvas in a 240 px outer canvas, drawn at x = -300: the pixel at 360 px is drawn. A direct child of a canvas is recorded whole, unlike a drawable nested in a drawable element (`findings/keycaps.md`). |
| The inner canvas drawn twice (upright and mirrored) | measured: the last draw takes the input | The mirror image is drawn first. |
| `ctx.filter` on the inner canvas's draw of its element: `blur() brightness() saturate()`, and `url(#filter)` with `lighter` for a colour split | measured: works | Three draws through `feColorMatrix` filters that keep one channel each. |
| Paint events at rest | measured: 0 in 0.7 s | After the lamp's level settled. |

### Reported on A159: the inner canvases were empty

reported, A159, 2026-11-21: on the owner's phone the widget demo showed the room's gradient and neither widget. `npm run reports -- --since 2h --list --page /nested-frames/` showed no report for the page, so no error, lost context or script error was raised. Not reproduced in C157 with `--force-device-scale-factor=2.625`: the room and both widgets draw and a touch tap counts.

Not known: whether the inner canvases got no `paint` event, drew into themselves and were then drawn empty by the outer canvas, or threw in `drawElementImage()` until the retries ran out. What the page now does (measured in C157 with `drawElementImage()` in an inner canvas replaced by a function that does nothing, as a stand-in):

| Step | Result |
|---|---|
| Each inner canvas is asked for its first paint with `requestPaint()` | The first version waited for the browser to raise it. |
| One second after the scene's first paint, read one 8 by 8 patch of a `drawImage()` copy of the scene, at a point of the counter's card that holds only its pale background | Brightness 247 of 255 when the inner canvases draw, 42 in the stand-in. The limit is 140. |
| If dark: move the two cards out of the inner canvases to be children of the scene canvas, and let the scene run the same two effect functions inside its own transform | The widgets draw with bloom, colour split, mirror image and taps. `window.__gfx.report('nested-frames', …)` sends the paint counts. |
| The line under the demo | Names the route and why. A button switches route by hand. |

reported, 2026-11-22 08:04 UTC, the owner's phone, production with the changes above: both inner canvases draw on the nested route. His screenshot shows the lamp and the counter, mirrored, and the line "Route: nested, chosen with the button. Paint events: scene 35, lamp canvas 2, counter canvas 2. The last scene paint was raised by: #dialCanvas, #padCanvas in changedElements." No `nested-frames` report was sent in the 12 hours before, so the page's own check did not switch to the flat route: the route in the line comes from two presses of the button. So a drawable canvas nested in a drawable canvas draws on that phone. Which change made the difference is not known: the `requestPaint()` on each inner canvas, or the fix for draws with no size on high pixel ratios (PR #104), which merged in the same hour.

To find the cause on the phone: open the page, read the line under the room (it holds the paint counts of the three canvases at the moment of the check), and run the first four live checks, which build the same nesting on a small fixture.

## An iframe (`srcdoc`) as the drawable child

| Question | Result | Detail |
|---|---|---|
| Does a scroll inside the iframe raise `paint` on the canvas? | measured: yes | `scrollTo()` from script: 1 event, `changedElements` holds the iframe. A touch drag of 160 px on the drawn screen scrolled the iframe 145 px and the page 0 px. |
| Does a link inside the iframe take a tap at the drawn place? | measured: yes | With the iframe drawn 1:1 and at 0.84 scale (phone turned). The click listener is added to `contentDocument` by the page. |
| What does the outer document see at that point? | measured: the `<iframe>` | `elementFromPoint()` returns the iframe. `getBoundingClientRect()` of a rotated iframe is the box round the drawing (182 by 143 for a 160 by 100 iframe turned 0.3 rad). |
| Does resizing the iframe apply its document's media query and raise `paint`? | measured: yes, 1 event | 120 px to 200 px with a `min-width: 180px` rule. |
| Changing `srcdoc`, and toggling a class on the iframe's root element, from click listeners | measured: works | The picture is missing for a few frames after `srcdoc` changes. The paint loop tries again while `drawElementImage()` throws. |

## A custom element that draws its light-DOM children

| Question | Result | Detail |
|---|---|---|
| A `drawable` `<div>` in the shadow tree with a `<slot>` in it, as the canvas's child | measured: its picture holds the slotted children | The light-DOM children need no attribute. They are hit tested at the drawn place, and a style change on one raises `paint` with the shadow `<div>` in `changedElements`. |
| The `<slot>` itself with `drawable` | measured: throws "No cached paint record for element" | `display: contents`, no box. |
| A slotted child with no `drawable` attribute passed to `drawElementImage()` | measured: throws "Descendants passed to DrawElementImage must have the 'drawable' attribute" | With the attribute it draws (the `/slot/` route). |
| A custom element with its own shadow tree, slotted into the first one | measured: draws and takes taps | The star buttons were tapped through glass, wave, melt and blinds. It is form-associated, and `FormData` held its value. |
| `ctx.filter = 'url(#id)'` for a canvas in a shadow root | measured: resolves in that shadow root | A filter in the same shadow tree applied. A filter in the document was not found: the element drew unfiltered and nothing threw. |
| Changing the filter's `scale` attribute every frame (melt) | measured: the next draw uses it | Changed in `requestAnimationFrame`, not in the paint handler. |
| Typing in the slotted text field, submitting the slotted form | measured: works | |

## HTML in `<foreignObject>`

| Question | Result | Detail |
|---|---|---|
| Button in a foreignObject, SVG drawn at 0.75 of its viewBox and sheared | measured: found by `elementFromPoint()` at the drawn place | |
| Button, checkbox and range in the tilted diagram, by tap and touch drag | measured: work | |
| `<output>` in a foreignObject written by script | measured: raises `paint` | Written from a timer, not inside the paint handler. |
| The foreignObject, or the button in it, as the `drawable` element | measured: both throw "No cached paint record for element" | The SVG root is the smallest drawable unit. ELEMENTS.md already says this for the foreignObject. |
| `path.getPointAtLength()` for marks drawn by the canvas on the SVG's paths | measured: lines up under the same transform | |

## A script element

| Question | Result | Detail |
|---|---|---|
| Does a `<script>` that is a child of a canvas run? | measured: yes | From the parser and when added by script. |
| With `display: block`, does it draw its text? | measured: yes | 554 dark pixels in a 200 by 60 box in the check. `background-clip: text` with a gradient works on it. |
| Can it pass itself to `drawElementImage()`? | measured: yes | `document.currentScript` at run time, `this` in the function it defines. |
| `contenteditable="plaintext-only"` on it | measured: a tap puts the caret in it and typed letters go into its text | |
| Does editing its text run it again? | measured: no | A new script element with the edited text, put in its place with `replaceWith()`, runs during that call. |

## Things that bit

- An SVG element has no `offsetWidth`. A helper that called `drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight)` drew nothing for the SVG and threw nothing. Pass the size.
- A classic script that declares `const me` at the top level cannot be run a second time: "Identifier 'me' has already been declared". The shown script declares nothing at the top level.
- A syntax error in a replaced script is reported on `window` during `replaceWith()`. The page parses the text with `new Function()` first, so the error goes to the line under the demo and not to the crash reports.
- `kit.js` here is a copy of `/form-state/kit.js` with two additions: `put()` takes a size, and `mount()` takes the nodes to show as plain HTML after a lost context.
- The scene sends `contextlost` from an inner canvas on to the page's one handler, so a loss in any of the three canvases stops all demos and shows plain HTML.

## Not verified

- Everything on A159. Open `/nested-frames/` on the phone and run the live checks.
- Scroll momentum and overscroll inside the drawn iframe by a real finger. The line under the phone shows the scroll offset.
- The on-screen keyboard over the name field in `<effect-frame>` and over the editable script.
- The speed of the melt effect: an SVG turbulence and displacement filter on every frame.
- What a screen reader reads for the inner canvases, the iframe and the foreignObject controls.
- Whether a tap on "Run the edited script" can be lost straight after an edit. In the input tool, a tap on that button sent at once after the script's text was replaced did nothing in 3 of 6 runs. With a 0.7 s wait before the tap it worked in 4 of 4. The page had not scrolled and focus was in the script element in both cases. The cause was not found.
- A cross-origin iframe in the phone. `findings/transports-2.md` records that it draws as transparent pixels.

## Open ideas

- `<effect-frame>` with a WebGL effect through `lib/element-gl.js`, sharing the page's one context.
- A third level: an `<effect-frame>` inside the email, inside the phone.
- A node editor: dragging the diagram's nodes, with edges redrawn by the canvas.

## For the index

- The canvas, the attributes and the paint event: a drawable canvas can be a `drawable` child of a drawable canvas; a draw in the inner one raises `paint` on the outer one with the inner canvas in `changedElements` (measured, C157, `/nested-frames/`).
- The canvas, the attributes and the paint event: a scroll inside a drawn same-origin iframe raises `paint` with the iframe in `changedElements` (measured, C157, `/nested-frames/`).
- What is in an element's picture: an inner canvas that is a direct child of a canvas is recorded whole, beyond the outer canvas's box (measured, C157, `/nested-frames/`).
- What is in an element's picture: a drawable element in a shadow tree that contains a `<slot>` holds the picture of the slotted light-DOM children; the slot itself and a foreignObject cannot be the drawable element (measured, C157, `/nested-frames/`).
- Drawing elements: `ctx.filter = 'url(#id)'` resolves the id in the tree of the canvas, so a canvas in a shadow root finds filters in that shadow root and not in the document (measured, C157, `/nested-frames/`).
- Hit testing and geometry: input reaches a control through two nested canvas draws, through a drawn iframe, and through viewBox, foreignObject and a sheared transform (measured, C157, `/nested-frames/`).
- Element catalogue ideas built: "Widget with its own effect inside a scene", "Email preview on a drawn phone", "Custom element that packages an effect", "HTML button inside an SVG diagram", "Script that shows itself".

## API requests

- `ctx.filter = 'url(#missing)'` draws unfiltered with no error or warning. A console warning would have saved time.
