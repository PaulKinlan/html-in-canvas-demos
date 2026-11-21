# Effects driven by CSS: scroll, outlines and tilt (`/scroll-fx/`, `/shape-ui/`)

Built from the Chrome APIs plan (`/chrome-apis/`, demos 6 and 7). Both pages use the `fx` attribute, with effects defined in the page. Chromium 157, software rendering.

| Experiment | Result | Why |
|---|---|---|
| `animation-timeline: view()` on an element that is a canvas child, animating `--fx-progress` | works | The element's view timeline follows the page's scroll position although the element is only drawn through its canvas. The fx library reads the property once per frame. |
| `animation-timeline: scroll(root)` on an ancestor, inherited by canvas children | works | Registered custom properties with `inherits: true` cross the shadow root and the canvas. |
| Scroll speed with no script: `--lag: var(--pos); transition: --lag 120ms linear`, speed = `--pos - --lag` | works | The transition has to be on a descendant of the element whose animation moves `--pos`. Peak difference 0.42 of the scroll range in the check. |
| `scroll-state(stuck: top)` container outside the canvas styling an element inside it | works | The sticky holder is the query container. The drawn bar gets `--fx-amount: 1` and a new background. |
| `timeline-trigger` with `animation-trigger: play-forwards reset` on a canvas child | works | The animation runs by the clock after the scroll stops. In the small check fixture the reset on leaving was not seen within 200 ms. On the page it resets. |
| A drawer on the overscroll area | not built | No `overscroll-area` property in Chromium 157. |
| `corner-shape`, `border-shape: circle()`, `clip-path: shape()` in the element's alpha | works | Corner pixel alpha 0, middle 255, for all three. |
| A normal from alpha: 16 samples in a 7 px disc, height = share inside, slope = alpha-weighted mean offset | works | One pass, no blur pass. Smooth between about 3 px and 14 px of bevel. |
| A shadow with the element's outline, drawn by the element's own shader | works | Alpha read 18 px towards the light, 8 jittered samples, inside 30 px of canvas bleed. It cannot darken a neighbouring canvas. |
| `elementFromPoint()` in a corner cut away by `corner-shape`, `border-shape` or `clip-path` | outline | Not the element, in a canvas and as plain DOM. Hit testing follows all three outlines. |
| Pressing: `:active` scales a key inside a shared picture | works | The alpha changes, so bevel and shadow follow with no code. |
| GLSL and WGSL versions of the eight new effects give the same picture | works | Mean difference under 0.4 of 255 per channel, WebGPU drawn into a texture on a software adapter. |

Not verified in the test browser: touch scrolling against main-thread property reads (the shader may trail the block by a frame or more), the tilt sensor, frame rate on a phone, and the WebGPU route on screen.

Both pages ask `/shared/backend.js` for WebGPU first and otherwise mark every element `fx-backend="shared"`, so a page opens one WebGPU device or one WebGL context (`/shared/fx-route.js`).
