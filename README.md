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
| `/a11y/` | Accessibility audit: API probes, the same audit run over every demo, and a by-hand checklist |
| `/capture/` | Any element or a whole page to PNG, video or print with one call |
| `/perf/` | Performance wall: how many live elements before frames drop; DOM vs 2D canvas vs worker |
| `/transitions/` | `<live-transition>`: shatter, fold, burn and morph between two states that both stay live and clickable |
| `/time-scrubber/` | `<dom-rewind>`: a ring buffer of DOM frames to scrub back through, with motion trails and restore |
| `/particles/` | `<glyph-field>`: text as glyph particles that stays selectable, searchable and editable |
| `/tear-off/` | Widgets torn off into popups, Picture-in-Picture, unlinked tabs and other origins, with input sent back |
| `/remote/` | One element streamed to a phone over WebRTC, with taps and typing sent back |
| `/embed/` | Cross-origin cards the host distorts and restyles without DOM access |
| `/support/` | Share one region of a page with a support agent or a vision model |

What works and what doesn't is in [FINDINGS.md](FINDINGS.md).

## Library

- `public/lib/canvas-slot.js`: the `<canvas-slot>` element. `onrender = ({ ctx, draw, elements, time }) => …`; `worker="url"` for OffscreenCanvas mode.
- `public/lib/slot-share.js`: `publish(canvasSlot)` and `<slot-view name>` to share slots over a MessagePort; `connectBroker()` introduces same-origin tabs through a SharedWorker (`broker.js`).
- `public/lib/element-capture.js`: `captureElement(el, { scale })`, `capturePage({ full })`, `recordElement(el)`, `printElement(el)`, `copyElement(el)`. Works on elements that were never written for canvas.
- `public/lib/a11y-audit.js`: `auditDocument(doc)` runs the accessibility checks from `/a11y/` on any same-origin document. Demos registered in `shared/demos.js` are audited automatically; `/a11y/?url=/path/` adds another page.
- `public/lib/live-transition.js`: `<live-transition>`. Children are states; `show(i, { effect, origin })`, or `begin(i)` then set `progress` to hold part way. Effects are functions in `LiveTransition.effects`.
- `public/lib/dom-rewind.js`: `<dom-rewind seconds trails>`. `place(el, { x, y, rotate })`, `seek(secondsAgo)`, `replay()`, `restore()`, `oncapture` / `onrestore` for app state.
- `public/lib/glyph-field.js`: `<glyph-field pointer="repel">`. `explode()`, `rain()`, `vortex()`, `scatter()`, `assemble()`, `highlight(text)`.
- `public/lib/dom-portal.js`: `<dom-portal for="id" scale="0.5">` mirrors any element; `<dom-portal-source layer="top">` for sources inside clipping ancestors.
- `public/lib/dom-lens.js`: `<dom-lens mode="magnify|fisheye|xray" zoom radius>` around any markup.
- `public/lib/shader-fx.js`: the `fx` attribute (`ripple`, `glass`, `haze`, `crt`, `dissolve`, `curl`) and `defineEffect(name, { glsl })`.
- `public/lib/physical-ui.js`: `<physical-ui material="jelly|cloth|paper" wind pin>`.
- `public/lib/surface.js`: the shared base that slots any markup into a canvas; `SurfaceElement.adopt(el)` wraps an element in place.

- `public/lib/live-surface.js`: `<live-region>` and `attachSurface(el)` turn any element into a shareable surface (frames, redaction, element map, replayed input). `serve(surface, link)` speaks the protocol.
- `public/lib/live-view.js`: `<live-view>`, the receiving end. Needs no HTML-in-canvas.
- `public/lib/live-link.js`: `shareInRoom()` / `watchRoom()` over a relay room, WebRTC with a relayed-JPEG fallback.
- `public/lib/live-card.js`: `<live-card src effect>` embeds a cross-origin card through a WebGL shader.

## Worker

`src/index.js` routes `/api/*`; everything else is static. `src/cross-context.js` serves `/api/x/room/<id>` (WebSocket relay rooms in a Durable Object), `/api/x/ice` and `/api/x/vision` (Workers AI). Bindings are in `wrangler.jsonc`. Optional secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` (a Cloudflare Realtime TURN key) add TURN servers for networks where WebRTC can't connect directly; without them the demos fall back to relayed frames.

## Develop and deploy

Static files in `public/`, served by Workers static assets.

```
npx wrangler dev   # needs a Cloudflare login because of the Workers AI binding
npm run deploy   # deploys html-in-canvas-demos and html-in-canvas-remote
```

Pushes to `main` deploy both Workers through Workers Builds.
