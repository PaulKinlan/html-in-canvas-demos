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
| `/transitions/` | `<live-transition>`: shatter, fold, burn and morph between two states that both stay live and clickable |
| `/time-scrubber/` | `<dom-rewind>`: a ring buffer of DOM frames to scrub back through, with motion trails and restore |
| `/particles/` | `<glyph-field>`: text as glyph particles that stays selectable, searchable and editable |

What works and what doesn't is in [FINDINGS.md](FINDINGS.md).

## Library

- `public/lib/canvas-slot.js`: the `<canvas-slot>` element. `onrender = ({ ctx, draw, elements, time }) => …`; `worker="url"` for OffscreenCanvas mode.
- `public/lib/slot-share.js`: `publish(canvasSlot)` and `<slot-view name>` to share slots over a MessagePort; `connectBroker()` introduces same-origin tabs through a SharedWorker (`broker.js`).
- `public/lib/live-transition.js`: `<live-transition>`. Children are states; `show(i, { effect, origin })`, or `begin(i)` then set `progress` to hold part way. Effects are functions in `LiveTransition.effects`.
- `public/lib/dom-rewind.js`: `<dom-rewind seconds trails>`. `place(el, { x, y, rotate })`, `seek(secondsAgo)`, `replay()`, `restore()`, `oncapture` / `onrestore` for app state.
- `public/lib/glyph-field.js`: `<glyph-field pointer="repel">`. `explode()`, `rain()`, `vortex()`, `scatter()`, `assemble()`, `highlight(text)`.

## Develop and deploy

Static files in `public/`, served by Workers static assets.

```
npx wrangler dev
npm run deploy   # deploys html-in-canvas-demos and html-in-canvas-remote
```

Pushes to `main` deploy both Workers through Workers Builds.
