# HTML-in-canvas experiments

Pushing on the experimental [HTML-in-canvas](https://github.com/WICG/html-in-canvas) API: reprojecting real, interactive DOM through slots, workers, tabs and origins.

Live: https://html-in-canvas-demos.kinlan-test.workers.dev (second origin for the cross-origin demo: https://html-in-canvas-remote.kinlan-test.workers.dev)

Needs Chrome 148+ with `chrome://flags/#canvas-draw-element`, or the `html-in-canvas` origin trial. Without it the site is plain HTML.

| Demo | What it explores |
|---|---|
| `/slot/` | `<canvas-slot>`: light-DOM children slotted into a shadow canvas |
| `/slot-bare/` | Just `<slot>` in `<canvas>` with declarative shadow DOM; a shadow root on `<body>` |
| `/offscreen/` | `ElementImage` snapshots rendered in a worker; magnifier; pixel mirrors |
| `/cross-tab/` | Slots streamed to another tab over MessagePorts, with input sent back |
| `/cross-origin/` | Borrowing and lending DOM across origins |
| `/transports/` | Transport lab: ~50 routes for moving DOM out of its canvas, each tested live |
| `/portal/` | `<dom-portal for="id">`: one live element drawn twice, interactive in both places |
| `/lens/` | `<dom-lens>`: magnifier, fisheye and x-ray over live DOM, sharp at any zoom |
| `/shader-css/` | `fx="ripple"`: any element through a WebGL shader, driven by CSS custom properties |
| `/physical/` | `<physical-ui material="cloth">`: working forms on jelly, cloth and paper |

What works and what doesn't is in [FINDINGS.md](FINDINGS.md).

## Library

- `public/lib/canvas-slot.js`: the `<canvas-slot>` element. `onrender = ({ ctx, draw, elements, time }) => …`; `worker="url"` for OffscreenCanvas mode.
- `public/lib/slot-share.js`: `publish(canvasSlot)` and `<slot-view name>` to share slots over a MessagePort; `connectBroker()` introduces same-origin tabs through a SharedWorker (`broker.js`).

- `public/lib/dom-portal.js`: `<dom-portal for="id" scale="0.5">` mirrors any element; `<dom-portal-source layer="top">` for sources inside clipping ancestors.
- `public/lib/dom-lens.js`: `<dom-lens mode="magnify|fisheye|xray" zoom radius>` around any markup.
- `public/lib/shader-fx.js`: the `fx` attribute (`ripple`, `glass`, `haze`, `crt`, `dissolve`, `curl`) and `defineEffect(name, { glsl })`.
- `public/lib/physical-ui.js`: `<physical-ui material="jelly|cloth|paper" wind pin>`.
- `public/lib/surface.js`: the shared base that slots any markup into a canvas; `SurfaceElement.adopt(el)` wraps an element in place.

## Develop and deploy

Static files in `public/`, served by Workers static assets.

```
npx wrangler dev
npm run deploy   # deploys html-in-canvas-demos and html-in-canvas-remote
```

Pushes to `main` deploy both Workers through Workers Builds.
