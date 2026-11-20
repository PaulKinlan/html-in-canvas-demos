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
| `/slot-effects/` | `<canvas-slot effect="tilt">`: named effects with no render loop, and `effect="#shader"` to point a slot at your own fragment shader |
| `/physical/` | `<physical-ui material="cloth">`: working forms on jelly, cloth and paper |
| `/a11y/` | Accessibility audit: API probes, a pattern-by-pattern table (tree, focus order, find, selection, zoom), the same audit run over every demo, and a by-hand checklist |
| `/capture/` | Any element or a whole page to PNG (up to print quality), video (MediaRecorder or frame-exact WebCodecs) or print with one call |
| `/perf/` | Performance wall: how many live elements before frames drop; DOM vs 2D canvas vs worker |
| `/transitions/` | `<live-transition>`: shatter, fold, burn, morph or your own fragment shader between two states that both stay live and clickable |
| `/time-scrubber/` | `<dom-rewind>`: a ring buffer of DOM frames to scrub back through, with motion trails and restore |
| `/particles/` | `<glyph-field>`: text as glyph particles that stays selectable, searchable and editable |
| `/tear-off/` | Widgets torn off into popups, Picture-in-Picture, unlinked tabs and other origins, with input sent back |
| `/remote/` | One element streamed to a phone over WebRTC, with taps and typing sent back |
| `/embed/` | Cross-origin cards the host distorts and restyles without DOM access |
| `/support/` | Share one region of a page with a support agent or a vision model |
| `/three-form/` | A live form on a laptop screen, a billboard and a curved wall in three.js (WebGL or `?renderer=webgpu`), via `lib/html3d.js` |
| `/board/` | An infinite zoomable board whose tiles are live notes and iframes |
| `/xr/` | WebXR panels made of HTML, with controller rays, an on-panel keyboard and a built-in headset emulator (`?emulate=1`) |
| `/slot-view/` | `<slot-view src name>`: a live piece of another site with no iframe box, consent on the providing side, input forwarded ([protocol](public/slot-view/PROTOCOL.md)) |
| `/pip/` | `pipElement(el)`: picture-in-picture for any element, moved for real, as a live picture, or as a video |

What works and what doesn't is in [FINDINGS.md](FINDINGS.md).

## Library

- `public/lib/canvas-slot.js`: the `<canvas-slot>` element. `onrender = ({ ctx, draw, elements, time }) => …`; `worker="url"` for OffscreenCanvas mode.
- `public/lib/slot-share.js`: `publish(canvasSlot)` and `<slot-mirror name>` to share slots over a MessagePort; `connectBroker()` introduces same-origin tabs through a SharedWorker (`broker.js`).
- `public/lib/element-capture.js`: `captureElement(el, { scale })`, `capturePage({ full })`, `recordElement(el)`, `exportVideo(el, { fps })` (WebCodecs, frame by frame), `encodeFrames(frames)`, `printElement(el)`, `copyElement(el)`; `{ dpi: 300 }` for print-quality PNG. Works on elements that were never written for canvas.
- `public/lib/a11y-audit.js`: `auditDocument(doc)` runs the accessibility checks from `/a11y/` on any same-origin document. Demos registered in `shared/demos.js` are audited automatically; `/a11y/?url=/path/` adds another page. `auditPattern(doc)` measures one pattern fixture; add a pattern in `public/a11y/patterns.js` and `pattern.html`.
- `public/lib/live-transition.js`: `<live-transition>`. Children are states; `show(i, { effect, origin })`, or `begin(i)` then set `progress` to hold part way. Effects are functions in `LiveTransition.effects`. Or write your own blend: `LiveTransition.shaders.name = { glsl, pick? }`, where `glsl` is a `vec4 transition(vec2 uv)` in the gl-transitions convention (`getFromColor`, `getToColor`, `progress`, `ratio`), then `show(i, { effect: 'name' })`. Both states stay live inside the shader; `pick(x, y, p)` says which state the pointer reaches at a point.
- `public/lib/dom-rewind.js`: `<dom-rewind seconds trails>`. `place(el, { x, y, rotate })`, `seek(secondsAgo)`, `replay()`, `restore()`, `oncapture` / `onrestore` for app state. `for await (const { time, bitmap } of rw.frames({ seconds, fps }))` hands the recorded history back as ImageBitmaps for a video encoder. If the canvas context is lost, `<live-transition>` and `<dom-rewind>` show their children as plain HTML until it returns (`fallbackReason`, `showPlain(reason)`, `showCanvas()`, events `livefallback` / `rewindfallback`), as `<glyph-field>` already did.
- `public/lib/glyph-field.js`: `<glyph-field pointer="repel">`. `explode()`, `rain()`, `vortex()`, `scatter()`, `assemble()`, `highlight(text)`.
- `public/lib/dom-portal.js`: `<dom-portal for="id" scale="0.5">` mirrors any element; `<dom-portal-source layer="top">` for sources inside clipping ancestors.
- `public/lib/dom-lens.js`: `<dom-lens mode="magnify|fisheye|xray" zoom radius>` around any markup.
- `public/lib/shader-fx.js`: the `fx` attribute (`ripple`, `glass`, `haze`, `crt`, `dissolve`, `curl`) and `defineEffect(name, { glsl })`.
- `public/lib/effects.js`: the effect registry shared by `fx` and `<canvas-slot effect>`. `defineEffect(name, { glsl, wgsl, geometry })`; CSS properties `--fx-progress`, `--fx-amount`, `--fx-x`, `--fx-y`.
- `public/lib/slot-effects.js`: the shader renderer `<canvas-slot effect>` loads on demand (`backend="webgl|shared|webgpu"`).
- `public/lib/physical-ui.js`: `<physical-ui material="jelly|cloth|paper" wind pin>`.
- `public/lib/surface.js`: the shared base that slots any markup into a canvas; `SurfaceElement.adopt(el)` wraps an element in place.

- `public/lib/live-surface.js`: `<live-region>` and `attachSurface(el)` turn any element into a shareable surface (frames, redaction, element map, replayed input). `serve(surface, link)` speaks the protocol.
- `public/lib/live-view.js`: `<live-view>`, the receiving end. Needs no HTML-in-canvas.
- `public/lib/live-link.js`: `shareInRoom()` / `watchRoom()` over a relay room, WebRTC with a relayed-JPEG fallback.
- `public/lib/live-card.js`: `<live-card src effect>` embeds a cross-origin card through a WebGL shader.
- `public/lib/slot-view.js` and `public/lib/slot-provider.js`: the cross-site `<slot-view src name>` element and `provideSlots()` for the site being embedded.
- `public/lib/element-pip.js`: `pipElement(el, { mode })` and `surfaceFor(el)`.

## Worker

`src/index.js` routes `/api/*`; everything else is static. `src/cross-context.js` serves `/api/x/room/<id>` (WebSocket relay rooms in a Durable Object), `/api/x/ice` and `/api/x/vision` (Workers AI). Bindings are in `wrangler.jsonc`. Optional secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` (a Cloudflare Realtime TURN key) add TURN servers for networks where WebRTC can't connect directly; without them the demos fall back to relayed frames.

## Pages must hold still

Opening a demo must not move it. `npm run check:jank` opens every page in `public/shared/demos.js` as a phone (412 px wide, device scale factor 2.625, touch, CPU slowed 4x), touches nothing, and fails if the page shifts its layout, scrolls itself, moves focus, covers itself, blanks a canvas or flashes, from navigation until its live checks finish and through a change of viewport height like the URL bar hiding. It needs Playwright with Chromium (`npm i -D playwright`).

```
npm run check:jank                      # every page
npm run check:jank -- /board/ /slot/    # some pages
npm run check:jank -- --checks /lens/   # make checks that wait for a tap run on load
npm run check:jank -- --json out.json --shots frames/   # full numbers and every frame
```

For a new demo page:

- Put `<script src="/shared/nav.js"></script>` first in `<body>`. It reserves the menu's space and holds the first paint until your module scripts have built the page.
- Live checks run on their own fixtures, out of flow (fixed or absolute, or a hidden copy of the page with `lib/check-fixture.js`). They never call `scrollIntoView()`, `scrollTo()` or `focus()` on the page the reader is looking at, and never insert or remove anything in the flow above the results.
- Do not size a canvas stage with `dvh`: it changes every time a phone's URL bar moves. Use `svh`.
- Only assign `canvas.width` and `canvas.height` when the size really changed. Assigning clears the canvas.
- A page whose checks cannot meet this yet goes in `CHECKS_WAIT_FOR_TAP` in `public/shared/support.js`; its checks then wait for a button. Known exceptions with their reasons are in `tools/jank/allow.json`.

## Develop and deploy

Static files in `public/`, served by Workers static assets.

```
npx wrangler dev   # needs a Cloudflare login because of the Workers AI binding
npm run deploy   # deploys html-in-canvas-demos and html-in-canvas-remote
```

Pushes to `main` deploy both Workers through Workers Builds.
