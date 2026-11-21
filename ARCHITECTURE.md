# Architecture

How the repository is laid out, how a page is built, which shared modules exist, how the site is checked and deployed, and how to add a page. Written 2026-11-21 from the code on `main`, the pull requests and the project notes.

Related files: [PLAN.md](PLAN.md) (goals and open work), [FINDINGS.md](FINDINGS.md) (measured results), [DESIGN.md](DESIGN.md) (visual style, writing rules, page conventions), [KNOWN-LINKS-AND-RESOURCES.md](KNOWN-LINKS-AND-RESOURCES.md) (specs, docs, URLs), [AGENTS.md](AGENTS.md) (rules for a tool working in this repository).

## Contents

- [What the site is](#what-the-site-is)
- [Repository layout](#repository-layout)
- [The Worker and its routes](#the-worker-and-its-routes)
- [How a page is built](#how-a-page-is-built)
- [Shared modules in public/shared/](#shared-modules-in-publicshared)
- [Libraries in public/lib/](#libraries-in-publiclib)
- [Patterns the libraries share](#patterns-the-libraries-share)
- [Live checks](#live-checks)
- [Scripts and tools](#scripts-and-tools)
- [Testing locally](#testing-locally)
- [Deploy and preview](#deploy-and-preview)
- [How to add a page](#how-to-add-a-page)
- [How to add other things](#how-to-add-other-things)

## What the site is

A static site of experiments with the HTML-in-canvas API (`<canvas content="drawable">`, `drawElementImage()`, `texElementSubImage2D()`, `GPUQueue.drawElementImageToTexture()`, `captureElementImage()`, `updateElementGeometry()`, the `paint` event). There is no build step for the pages and no framework. Every page is hand-written HTML with ES modules, served from `public/`. A small Cloudflare Worker serves `/api/x/*` for the demos that need a server.

One page, `/start/`, is a tutorial. Every other page is an experiment: it asks one question about the API, runs live checks in the visitor's browser, and reports what worked and what did not.

The site needs Chrome 148 or later with `chrome://flags/#canvas-draw-element` enabled, or the `html-in-canvas` origin trial. Without the API every page is plain HTML and its live checks report failures.

## Repository layout

```
/
├── AGENTS.md, PLAN.md, FINDINGS.md, ARCHITECTURE.md, DESIGN.md, KNOWN-LINKS-AND-RESOURCES.md, README.md
├── package.json          npm scripts only, no dependencies are declared
├── wrangler.jsonc        Worker config: assets, Durable Object, Workers AI binding
├── src/
│   ├── index.js          Worker entry. Routes /api/x/* and falls through to static assets
│   └── cross-context.js  Rooms (Durable Object), ICE servers, vision endpoint, status
├── public/               Everything that is served
│   ├── index.html, home.js        Homepage and its canvas enhancement
│   ├── _headers                   CORS headers for /lib/*, /media/*, /capture/swatch.svg
│   ├── shared/                    Site chrome and the check harness (see below)
│   ├── lib/                       Drop-in elements and helpers (see below)
│   ├── vendor/three/, vendor/iwer/, lib/vendor/qrcode.js   Vendored third-party code
│   ├── media/                     Generated test clips (clip.webm, clip.vtt, alpha.webm, protected.webm)
│   ├── <page>/index.html          One folder per experiment
│   └── native-ui/egui/, native-ui/qt/   Committed WebAssembly build output
├── native/
│   ├── egui-dom/         Rust source of the egui app on /native-ui/
│   └── qt-dom/           C++ and QML source of the Qt Quick app on /native-ui/
├── docs/
│   └── native-frameworks.md   Survey of ten native UI frameworks
└── tools/
    ├── jank/             npm run check:jank
    ├── bundle/fx.mjs     npm run build:fx
    └── media/            make.sh and encrypt-webm.mjs for public/media/
```

Open pull requests on 2026-11-21 add more (see [PLAN.md](PLAN.md) for their status): `public/elements/`, `ELEMENTS.md` and `tools/elements/` (PR #48), `public/selection/` and `public/lib/selection-fx.js` (PR #49), `public/chrome-apis/`, `docs/chrome-apis-plan.md` and `tools/chrome-apis/` (PR #50), `public/player-fx/` (PR #51).

### Pages on main

| Group (key in `demos.js`) | Pages |
|---|---|
| `contexts`: workers, tabs and origins | `/offscreen/`, `/cross-tab/`, `/cross-origin/`, `/transports/`, `/tear-off/`, `/remote/`, `/embed/`, `/support/`, `/slot-view/`, `/pip/` |
| `slots` | `/slot/`, `/slot-bare/`, `/slot-bare/plain.html` |
| `primitives`: UI primitives | `/portal/`, `/lens/`, `/shader-css/`, `/slot-effects/`, `/physical/`, `/select/`, `/datalist/`, `/inputs/` |
| `motion` | `/transitions/`, `/view-transitions/`, `/time-scrubber/`, `/particles/` |
| `media`: video and sound | `/video/`, `/overlay/`, `/audio/`, `/player-parts/` |
| `3d`: 3D and shaders | `/three-form/`, `/board/`, `/xr/`, `/native-ui/` |
| `audit`: measurements | `/a11y/`, `/capture/`, `/perf/` |
| `start`: tutorial | `/start/` |

Several folders hold extra files that are not in the menu: stand-alone examples (`/slot/hello.html`, `mount.html`, `outside.html`, `reslot.html`, `wrapper.html`, `/slot-bare/attach-shadow.html`, `body.html`, `declarative.html`, `/start/hello.html`, `/shader-css/standalone.html`), second-context pages (`/cross-tab/viewer.html`, `/cross-origin/frame.html`, `/remote/view.html`, `/tear-off/window.html`, `dock.html`, `bridge.html`, `/embed/card.html`, `lend.html`, `/slot-view/provider.html`, `/support/agent.html`), fixtures and reproductions (`/transports/crash-adopt.html`, `/view-transitions/crash.html`, `/capture/fixture.html`, `/a11y/pattern.html`), and workers (`/offscreen/renderer.js`, `/perf/worker.js`, `/transports/worker.js`, `/a11y/pattern-worker.js`).

## The Worker and its routes

`wrangler.jsonc` declares `main: src/index.js`, static assets from `./public` with `html_handling: auto-trailing-slash`, a Durable Object binding `ROOMS` (class `Room`, SQLite-backed, migration tag `v1`) and a Workers AI binding `AI`. Static files are served first. `src/index.js` only sees requests that are not files.

| Route | Module | What it does |
|---|---|---|
| `GET /api/x/room/<id>` | `src/cross-context.js` | WebSocket. One Durable Object per room relays messages between the peers in it. Used for WebRTC signalling and as the fallback that relays JPEG frames. The handshake is accepted only from a page the same Worker served (same host), on any host name. |
| `GET /api/x/ice` | same | ICE servers for `RTCPeerConnection`. STUN always (`stun.cloudflare.com:3478`, `stun.l.google.com:19302`). When the secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are set it also asks Cloudflare Realtime for TURN servers with one-hour credentials. Port 53 addresses are removed. |
| `POST /api/x/vision` | same | A frame of shared DOM plus a question, answered by Workers AI. Models tried in order: `@cf/mistralai/mistral-small-3.1-24b-instruct`, `@cf/meta/llama-4-scout-17b-16e-instruct`. A per-IP daily quota is kept in a Durable Object named `quota:<ip>`. |
| `GET /api/x/status` | same | Which of the above this deployment can do: `{ rooms, ai, turn, models }`. Pages use it to explain a fallback. |
| everything else | `env.ASSETS.fetch()` | Static files. |

Rule for new server code: add a module beside `cross-context.js` and one route line in `src/index.js`. Keep `index.js` a thin router.

`public/_headers` sets `Access-Control-Allow-Origin: *` on `/lib/*` (so other sites can import the elements as modules), on `/media/*` and on `/capture/swatch.svg` (so tests can load them with CORS from the second origin).

## How a page is built

A page is one HTML file. A typical experiment page has this skeleton:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>…</title>
<link rel="stylesheet" href="/shared/style.css">
<style>/* page styles */</style>
</head>
<body>
<script src="/shared/nav.js"></script>          <!-- first thing in body -->
<main>
  <div id="support"></div>                       <!-- filled by banner() -->
  <h1>…</h1>
  <p class="lede">What the demo does and how to use it.</p>
  <!-- the demo -->
  <details class="show-code">…</details>         <!-- closed, in the HTML -->
  <h2>How it works</h2>
  <h2>Live checks</h2>
  <table class="results"><tbody id="tests"></tbody></table>
  <h2>Findings</h2>
</main>
<script type="module">
  import { banner, runTests } from '/shared/support.js';
  banner();
  // build the demo, then: runTests(document.getElementById('tests'), [ … ]);
</script>
</body>
</html>
```

What happens on load:

1. `nav.js` (a classic script, not a module) runs as soon as the parser reaches it. It inserts the menu bar at its final height (48 px plus a border), and on a top-level page adds the class `page-loading` to `<html>`, which holds everything below the menu at `opacity: 0`.
2. `nav.js` loads `demos.js` (fills the menu and the previous and next arrows), `learn.js` (inserts the "About this experiment" box under `main p.lede`) and `show-code.js` (fills a `details.show-code` listing when someone opens it).
3. The page's module script runs after parsing and builds the demo.
4. `nav.js` removes `page-loading` after `DOMContentLoaded` once the page height has been the same for three frames and the learn box is placed. It gives up after 0.8 s of waiting, or 3 s in total.
5. `runTests()` runs the live checks, or waits for a tap or for the checks section to scroll into view, depending on the page (see [Live checks](#live-checks)).

The hold uses `opacity`, not `visibility`, because a hidden canvas gets no `paint` events and `elementFromPoint()` skips it. A framed page is not held: an opacity effect around a drawable canvas inside an iframe that is itself drawn into a canvas crashes the tab in Chromium 157.

Query parameters the shared code understands:

| Parameter | Effect |
|---|---|
| `?autochecks=1`, `?autochecks=0` | Force live checks to start on load, or not to. |
| `?checks` | Start the checks at once on the pages that wait for their section to be on screen (`/transitions/`, `/time-scrubber/`, `/particles/`, `/view-transitions/`). |
| `?bench` | The hidden copy of a page that runs its `apart` checks. Also skips the learn box. |
| `?fixture=1` | The hidden copy used by `lib/check-fixture.js` on the 3D pages. |
| `?nohold` | Do not hold the first paint. |
| `?embed`, `?nolearn` | Skip the learn box. |
| `?route=webgl` | Preset the "Drawn with" menu on the shader pages. |
| `?plain` (homepage) | Show the homepage as plain links with no canvas. |
| `?run=quick|full` (`/perf/`), `?run=all` (`/a11y/`, `/capture/`) | Start the measurement without a tap. |
| `?url=/path/` (`/a11y/`) | Audit one page. |
| `?renderer=webgpu` (`/three-form/`), `?emulate=1` (`/xr/`) | Force the three.js WebGPU build, or start the built-in headset emulator. |

## Shared modules in public/shared/

| File | Kind | What it does |
|---|---|---|
| `style.css` | stylesheet | Colour tokens, type, `main` width, cards, results tables, show-code and checks-fold boxes, phone rules. Described in [DESIGN.md](DESIGN.md). |
| `nav.js` | classic script | The sticky menu bar with its own inline styles, the first-paint hold, and the loader for `demos.js`, `learn.js` and `show-code.js`. Works when the page's own scripts fail. |
| `demos.js` | classic script | `window.DEMO_GROUPS` and `window.DEMOS`: the one list of pages. The menu, the homepage, the previous and next arrows, the `/a11y/` audit matrix and `npm run check:jank` all read it. One line per page, added at the end of its group. |
| `learn.js` | classic script | `window.LEARN.pages`: for each page href, the `question` the experiment asks, an optional `result`, `first` (pages it builds on) and `api` (calls it uses). `LEARN.uses` maps API calls to pages that show them. `LEARN.mount()` builds the "About this experiment" box. |
| `support.js` | module | `supported`, `banner()`, the check harness `runTests()`, fixtures `testStage()`, `stageFrame()`, `checkBench()`, `onBench()`, the list `CHECKS_WAIT_FOR_TAP`, `checksAutoRun()`, `foldChecks()`, `apart()`, `isBench`, and helpers `withTimeout()`, `nextPaint()`, `pixel()`, `inkFraction()`, `stillDrawn()`. Every thread edits this file, so it is a frequent source of merge conflicts. New helpers go in new files. |
| `on-screen.js` | module | `onScreen`: start a page's checks only while its own checks section is on screen. Used by the motion pages. |
| `backend.js` | module | `pickBackend()` returns `'webgpu'`, `'webgl'` or `'2d'`. `webgpu()` returns the page's one shared `{ device, adapter, format }` or `null`, with `webgpu.reason` saying why. It refuses software adapters and runs a self-test (clear a WebGPU canvas, `drawImage()` it to 2D, read the pixel). `webgpu({ force: true })` skips both rules for off-screen tests. A lost device dispatches a `webgpulost` event on `window`. |
| `route-switch.js` | module | `routeSwitch(mount, { targets, attr, values, active, note })`: the "Drawn with" menu on the shader pages and the line that says what is drawing and why WebGPU is not. |
| `show-code.js` | classic script | Fills `details.show-code` listings from `#region` comments in the running source. `window.showCode.block(fn, lang, label)` lists one function. |
| `source-view.js` | module | `sourceViews()`: shows a whole stand-alone example file with a Copy button at a fixed height (`<details class="source" data-src>`). Used by the slot pages. |
| `live-widgets.css`, `live-widgets.js` | stylesheet, module | The timer, notes and mixer widgets used by the cross-context demos. Colours are fixed so a widget looks the same wherever its pixels are shown. |
| `thumbs/*.jpg` | images | 720×480 pictures for the "Examples" cards on the homepage. |

## Libraries in public/lib/

Each file starts with a comment that documents its attributes and methods. `README.md` has one line per library with the call signatures.

| File | What it provides |
|---|---|
| `canvas-slot.js` | `<canvas-slot>`: light-DOM children slotted into a canvas in a shadow root. `onrender = ({ ctx, draw, elements, time }) => …`, `worker="url"` for OffscreenCanvas, `from="selector"`, `adopt()`, `release()`, `effect="name"`. |
| `light-slots.js` | Makes `<slot name>` inside a plain light-DOM `<canvas>` work by moving the canvas into a shadow root on its parent. |
| `slot-effects.js` | The shader renderer that `<canvas-slot effect>` loads on demand. Backends WebGPU, WebGL, shared WebGL context. |
| `effects.js` | The effect registry shared by the `fx` attribute and `<canvas-slot effect>`: `defineEffect(name, { glsl, wgsl, animated, bleed, geometry })`, `<script data-effect>` definitions, and the CSS properties `--fx-progress`, `--fx-amount`, `--fx-x`, `--fx-y`. |
| `shader-fx.js` | The `fx` attribute: wraps any element and draws it through a fragment shader. |
| `fx.js` | Generated. `shader-fx.js`, `effects.js`, `surface.js`, `gpu-util.js` and `shared/backend.js` joined into one module for other sites. Never edit it by hand. |
| `surface.js` | `SurfaceElement`: the base class that wraps an element in place (shadow root, canvas, one `<div drawable><slot>`). `SurfaceElement.adopt(el)`. It listens for `contextlost` only; a subclass that uses WebGL or WebGPU must also listen for `webglcontextlost` and `webgpulost`. |
| `gpu-util.js` | WebGPU helpers: `GPUElementTexture`, `GPUCanvas`, `watchFrame()`, `blankWatch()`, `pictureDifference()`. |
| `dom-portal.js` | `<dom-portal for="id">` and `<dom-portal-source layer="top">`. |
| `dom-lens.js`, `lens-gl.js`, `lens-gpu.js` | `<dom-lens mode zoom radius>`. The lenses are fragment shaders: GLSL in `lens-gl.js` (`LENSES`), WGSL in `lens-gpu.js` (`WGSL`). A new lens needs an entry in both. |
| `physical-ui.js` | `<physical-ui material="jelly|cloth|paper">`. |
| `select-picker.js`, `placed-popover.js`, `datalist-picker.js`, `input-pickers.js` | Canvas-drawn pickers for `<select>`, `<input list>`, and time, date and colour inputs. |
| `live-transition.js` | `<live-transition>`: transitions between states that stay live. |
| `dom-rewind.js` | `<dom-rewind>`: a ring buffer of `ElementImage` frames. |
| `glyph-field.js` | `<glyph-field>`: text as glyph particles. |
| `html3d.js` | Live HTML on three.js meshes: `installThreeShims()`, hit testing through `updateElementGeometry()`, `RayPointer` for XR controllers. |
| `element-capture.js`, `webm-mux.js` | `captureElement()`, `capturePage()`, `recordElement()`, `exportVideo()`, `encodeFrames()`, `printElement()`, `copyElement()`; a WebM muxer with `addAudio()`. |
| `video-export.js` | `recordCanvas()`, `exportFrames()`, `decodeSound()`, `loopback()` for a canvas that draws video and HTML. |
| `a11y-audit.js` | `auditDocument(doc)`, `auditPattern(doc)`, `canvasState(canvas)`. |
| `live-surface.js`, `live-view.js`, `live-link.js`, `live-log.js`, `live-card.js`, `live-origins.js` | The cross-context stack: a surface that sends frames and replays input, the viewer, rooms over WebRTC with a relay fallback, the on-page connection log, the cross-origin card, and `otherOrigin()`. |
| `slot-share.js`, `broker.js` | `publish(canvasSlot)` and `<slot-mirror name>` over a MessagePort; a SharedWorker that introduces same-origin tabs. |
| `slot-view.js`, `slot-provider.js` | `<slot-view src name>` and `provideSlots()`. The protocol is `public/slot-view/PROTOCOL.md`. |
| `element-pip.js` | `pipElement(el, { mode })`, `surfaceFor(el)`. |
| `check-fixture.js` | Runs a page's checks in a hidden copy of itself (`?fixture=1`) and mirrors the results. Used by `/three-form/`, `/board/`, `/xr/`. |

Vendored code: three.js r187 in `public/vendor/three/` (`three.module.js`, `three.core.js`, `three.webgpu.js`, `three.tsl.js`), IWER (the WebXR emulator) in `public/vendor/iwer/`, and a QR code generator in `public/lib/vendor/qrcode.js`.

## Patterns the libraries share

These are the techniques that recur. [FINDINGS.md](FINDINGS.md) has the measurements behind each one.

**The wrapper.** To draw markup that was not written for a canvas, give its host a shadow root that holds `<canvas content="drawable"><div drawable><slot></slot></div></canvas>`. The children stay in the light DOM with their listeners and state. `surface.js`, `live-surface.js` and `canvas-slot.js` all do this. Children of a drawable canvas are shrink-to-fit, so the inner box needs `width: 100%`. Grid and flex hosts need their layout properties copied to the inner box.

**One canvas, one hit box per element.** An element can be drawn only into its nearest ancestor canvas and has one hit-test geometry. To show an element in two places, one canvas is stretched over both places and the geometry is pointed at the copy under the pointer (`dom-portal.js`). To show it in pieces (shards, glyphs, a mesh), the geometry is set each frame to the piece under the pointer.

**2D draws move the hit box. WebGL and WebGPU draws do not.** After `texElementSubImage2D()` or `drawElementImageToTexture()` the code must call `updateElementGeometry(el, { canvasTransform })` with the matrix the shader uses. A perspective `DOMMatrix` is accepted. The last draw or geometry update wins, so the interactive copy is drawn last.

**Always pass a size.** `drawElementImage(el, x, y)` with no size draws in device pixels. Every call in this repository passes `el.offsetWidth, el.offsetHeight` (or the buffer size for a fixed-size buffer).

**Measure before drawing.** Every `drawElementImage()` call moves the element's geometry at once, so `getBoundingClientRect()` read after a transformed draw returns transformed boxes.

**Calibrate geometry units.** `canvasTransform` behaved as CSS pixels on some canvases and buffer pixels on others, and under CSS `zoom` it is in unzoomed layout pixels. The libraries measure the unit at run time (`geometryUnit()` in `surface.js`) and read `element.currentCSSZoom`.

**Clear the hit-test cache.** In Chromium 157 `updateElementGeometry()` does not clear the remembered hit-test answer for a point. The libraries toggle an attribute (`data-moved`) on the element or canvas after moving a hit box.

**Backend order.** WebGPU when `shared/backend.js` says it is usable, then WebGL, then 2D. A canvas keeps its first context type, so switching route means swapping in a new canvas and moving the children across. Past six to eight shaded elements, elements share one WebGL context (draw to 2D, copy into the shared context, copy back) because a page gets about 16 WebGL contexts.

**Fall back to plain HTML.** A canvas with a lost context is an empty box with live, invisible controls. The elements move their children out of the canvas and show them as plain HTML with a short note, or replace the canvas. Losing a WebGPU device also loses every WebGL context and large 2D canvas on the page, so elements replace their canvas and do not wait for `contextrestored`.

**Leave the paint event before touching iframes.** Inserting, moving or removing an iframe inside a `paint` handler or one of its microtasks crashes the tab in Chromium 157. Code that must do it posts a MessageChannel task first.

**Cross-document sharing is pixels plus input.** An `ElementImage` can be transferred but only draws into its source canvas, so `live-surface.js` sends frames (ImageBitmap, video track or JPEG) and replays pointer and keyboard input on the real element.

## Live checks

Every experiment page runs checks in the visitor's browser and shows pass or fail rows. The table in the page is the evidence for the page's findings.

`runTests(tbody, tests, { when })` in `shared/support.js` takes a list of `{ name, expect: 'pass' | 'fail', why, run: async () => detailString, apart? }`. A test passes if `run()` resolves and fails if it throws. `expect: 'fail'` marks a row that documents something the API refuses. The results table is wrapped in `<details class="checks-fold">` with the pass count in its summary, closed on screens narrower than 700 px. When the run ends the harness sets `window.__results`. `window.__checkState` is `'waiting'`, `'running'` or `'done'`.

Where fixtures go, from most to least preferred:

| Mechanism | Where | Use it when |
|---|---|---|
| `testStage()`, `stageFrame(url)` | `shared/support.js` | A fixed-size box in the corner of the viewport, nearly invisible. Fixtures there are always on screen, so they paint and hit test. The harness puts a picture of what the fixture drew into the result row. |
| `checkBench()`, `onBench()` | `shared/support.js` | A small panel fixed to the bottom of the window, emptied between checks so canvases and GPU contexts are given back. Used by the UI primitives pages. |
| `apart: true`, or `apart([...])` | `shared/support.js` | The check presses, types, resizes or scrolls. It runs in an invisible frame of the same URL plus `?bench`, removed when done. An apart test cannot rely on earlier non-apart tests having run. |
| `lib/check-fixture.js` | 3D pages | The whole check list runs in a hidden copy of the page (`?fixture=1`). |
| `onScreen` | `shared/on-screen.js` | The checks use a rig inside the page's own checks section and start when it scrolls into view. |

When checks start:

- By default on load.
- On the pages in `CHECKS_WAIT_FOR_TAP` they wait for a "Run these N checks" button. On 2026-11-21 the list is `/cross-origin/`, `/remote/`, `/portal/`, `/lens/`, `/shader-css/`, `/slot-effects/`, `/physical/`, `/video/`, `/overlay/`, `/audio/`, `/player-parts/`, `/native-ui/`, `/select/`, `/datalist/`, `/inputs/`. A page comes off the list when `npm run check:jank -- --checks /page/` passes.
- `/a11y/` and `/capture/` wait for a tap on touch devices.
- A page loaded in a frame runs its checks at once, unless the URL has `?autochecks=0` (the board loads its page tiles that way).

Rules for a check (the reasons are in FINDINGS.md, "Pages that hold still"):

- Never call `scrollIntoView()`, `scrollTo()` or `focus()` on the page the reader is looking at, and never insert or remove anything in the flow above the results.
- Fixtures are out of flow (fixed or absolute) or in a hidden copy. A fixture clipped by `overflow: hidden` or far off screen is not painted.
- A field that a check focuses gets `inputmode="none"` so a phone keyboard does not open.
- Do not call `getImageData()` on a visible demo canvas. Read a small `drawImage()` copy.
- Do not call `WEBGL_lose_context.loseContext()` on an attached drawable canvas, and do not call `element.startViewTransition()` on a drawable canvas child. Both crash the renderer in Chromium 157.
- A check fixture counts against the phone's limits: WebGL contexts, a WebGPU device, hardware video decoders. Start from the lightest route and release what the check made.

## Scripts and tools

| Command | Tool | What it does |
|---|---|---|
| `npm run dev` | `npx wrangler dev` | Local Worker. Needs a Cloudflare login because of the Workers AI binding. |
| `npm run deploy` | `npx wrangler deploy` twice | Deploys `html-in-canvas-demos` and `html-in-canvas-remote`. Normally not run by hand: pushes to `main` deploy. |
| `npm run check:jank` | `tools/jank/check.mjs`, `instrument.js`, `allow.json` | Opens every page in `demos.js` as a phone (412 px wide, device scale factor 2.625, touch, CPU slowed 4x), touches nothing, and fails a page that shifts its layout, scrolls itself, moves focus, covers itself, blanks a canvas, flashes or crashes, from navigation until `window.__results` is set and through a viewport height change. Arguments: page paths to limit the run, `--checks` (adds `?autochecks=1`), `--root <dir>` (measure another checkout), `--json out.json`, `--shots frames/`. It serves `public/` itself on ports 8001 and 8002, so stop other servers on those ports first. Needs Playwright with Chromium. Known exceptions and their reasons are in `tools/jank/allow.json`. |
| `npm run build:fx` | `tools/bundle/fx.mjs` | Regenerates `public/lib/fx.js`. Run it after changing `lib/shader-fx.js`, `lib/effects.js`, `lib/surface.js`, `lib/gpu-util.js` or `shared/backend.js`. The joiner is hand-written and handles only named relative imports and plain `export` declarations. |
| `npm run check:fx` | same, `--check` | Fails when `public/lib/fx.js` is stale. |
| `tools/media/make.sh` | ffmpeg and node | Rebuilds `public/media/`. `clip.webm` is 10 s, 640×360, 30 fps, VP9 and Opus, with its frame number as 16 stripes in the top right corner. `tools/media/encrypt-webm.mjs` makes the Clear Key clip. |
| `native/egui-dom/build.sh` | Rust | Rebuilds `public/native-ui/egui/`. Needs the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130. `wasm-opt` is used if installed. |
| `QT=… EMSDK=… native/qt-dom/build.sh` | Qt and Emscripten | Rebuilds `public/native-ui/qt/`. Needs Qt 6.10.3 for WebAssembly (single-threaded), the matching desktop Qt and Emscripten 4.0.7. The output is 23.3 MB. Workers static assets allow 25 MiB per file. |

Added by open pull requests: `npm run record:elements` (PR #48, re-records `/elements/` and `ELEMENTS.md`, about 4 minutes), `npm run build:plan` and `npm run record:probes` (PR #50, rebuild the Chrome APIs plan and re-run its probes).

There is no CI configuration in the repository. The checks are run by hand before a pull request is opened.

## Testing locally

The notes below come from the threads that built the pages. They describe the cloud container the work was done in, which has no GPU and cannot reach the deployed site.

Serving:

- `python3 -m http.server 8001` in `public/`, and a second one on 8002, give two origins for the cross-origin pages. `lib/live-origins.js` maps 8001 to 8002. Two localhost ports are same-site, so they do not exercise cross-site storage partitioning. The two deployed Workers are also same-site with each other (both are under `kinlan-test.workers.dev`, and `workers.dev` is a public suffix).
- The Python server and the jank guard's server have no Range support. A page that seeks a video should load the clip as a blob URL.
- For `/api/x/*`, run wrangler with a scratch config that has the same `main`, assets and Durable Object and no `ai` binding, twice (`--port 8001`, and `--port 8002 --inspector-port 9230` with a separate `--persist-to`).

Browsers:

- Two Chromium builds are installed beside Playwright and they are different versions. The headless shell is Chromium 157: the API is on, and it behaves as if experimental web platform features were on. The full browser (`channel: 'chromium'`) is Chromium 153 and needs `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement`. Neither is Chrome 159, which is what the project owner's phone runs.
- `--disable-blink-features=CanvasDrawElement` turns the API off to test fallbacks.
- Real HiDPI: launch with `--force-device-scale-factor=1.5` (or 2.625) and a context with `viewport: null`. Playwright's `deviceScaleFactor` and DevTools emulation change `devicePixelRatio` but `devicePixelContentBoxSize` keeps reporting CSS pixels, which hides size bugs.
- Phone runs: a 412 px wide context with `hasTouch: true` plus CDP `Input.dispatchTouchEvent`. Do not pass `--touch-events=enabled`: it made a CDP touch test scroll the page.
- `page.waitForFunction()` with the default `requestAnimationFrame` polling crashed the tab on these pages under mobile emulation. Poll with `waitForTimeout()` and `evaluate()`.
- Playwright `evaluate()` counts as a user gesture, so limits on user activation (one `showPicker()` per tap) only show with a real tap.
- A click on a new canvas at the spot where the pointer already rested did not focus the element until the pointer moved. Move the mouse first.
- A long press through CDP touch events selects nothing in headless, inside or outside a canvas.
- Camera and microphone: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.
- The user-agent shadow tree of a `<video>` can be read with CDP `DOM.getDocument({ pierce: true })`.

WebGPU:

- A default headless launch has `navigator.gpu` and no adapter. With `--enable-unsafe-webgpu --enable-unsafe-swiftshader` (some threads also used `--enable-features=Vulkan --use-angle=swiftshader`) there is a software adapter. Render passes into textures work. Submitting a pass into any canvas texture destroys the device, and a lost device takes every WebGL context and large 2D canvas on the page with it.
- So WGSL is verified off screen: render to a texture, read it back, and compare with the WebGL picture (`offscreen` and `fx-offscreen` attributes, `GPUCanvas.read()`, `pictureDifference()`). When comparing, premultiply the WebGL side, and read a WebGL canvas inside its own frame.

What the container cannot verify: WebGPU on screen, real GPU frame rates, immersive WebXR, hardware video decoding, sound output, native popup windows (date, time, colour, datalist, plain select), the PDF viewer, find-in-page marks, screen readers, IME candidate windows, the on-screen keyboard, touch selection handles, connections between two real networks (the container has no outbound UDP), and the deployed Workers. [PLAN.md](PLAN.md) lists each item that waits on real hardware.

## Deploy and preview

Hosting is Cloudflare Workers on the project owner's account (workers.dev subdomain `kinlan-test`).

| Worker | What it is | URL |
|---|---|---|
| `html-in-canvas-demos` | The site, with the Durable Object, the AI binding and the TURN secrets. | `https://html-in-canvas.page/` (custom domain) and `https://html-in-canvas-demos.kinlan-test.workers.dev/` |
| `html-in-canvas-remote` | The same code under a second name, as a second origin for the cross-origin demos. It has no custom domain and no TURN secrets. | `https://html-in-canvas-remote.kinlan-test.workers.dev/` |
| `html-in-canvas-preview` | Branch previews. Static files only. | `https://<alias>-html-in-canvas-preview.kinlan-test.workers.dev/` |

- **Production.** A push to `main` deploys both production Workers through Workers Builds (one trigger per Worker, deploy command `npx wrangler deploy`). A branch can be deployed by posting `{ branch }` to `/builds/triggers/{uuid}/builds` through the Cloudflare API.
- **Previews.** A Workers Builds trigger named "Branch previews" runs on every branch except `main`. Each push uploads the branch's `public/` as a version with an alias. The alias is the branch name in lower case, with every character that is not a letter or digit turned into `-`, a leading `claude-` removed, cut to 36 characters. Branch `claude/slot-phone-fixtures` gives `https://slot-phone-fixtures-html-in-canvas-preview.kinlan-test.workers.dev`. A preview is ready about a minute after a push. Previews have no `/api/*` (no rooms, no Workers AI), and the cross-origin demos in a preview load the live second origin. The first build of the trigger once failed with a "build token" error and passed on retry.
- **Secrets.** `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are set on `html-in-canvas-demos` (a Cloudflare Realtime TURN key named "html-in-canvas-demos remote", set 2026-11-20). They are never in the repository.
- **Host names.** Code must not assume `workers.dev`. The site is also on `html-in-canvas.page`, and `otherOrigin()` returns `null` there because the second Worker has no custom domain.
- **Other sites** load the libraries from `https://html-in-canvas.page/lib/…`, for example `<script type="module" src="https://html-in-canvas.page/lib/fx.js"></script>`.

## How to add a page

1. Create `public/<name>/index.html` from the skeleton above. Put `<script src="/shared/nav.js"></script>` first in `<body>`.
2. Add one line for it at the end of its group in `public/shared/demos.js` (`group`, `href`, `title`, `blurb`, `tags`). Keep the entry on one line so parallel branches merge.
3. Add one entry in `public/shared/learn.js` keyed by the same href: `question`, optional `result`, `first`, `api`.
4. Write the page as an experiment. The first paragraph (`<p class="lede">`) says what the demo does and how to use it. The demo comes before the tables. Use the section names "How it works", "Live checks" and "Findings", in that order after the demo.
5. Add a closed `<details class="show-code">` listing under the demo and mark the code with `#region` comments (README, "Show the code").
6. Write the live checks with `runTests()`. Fixtures go in `testStage()`, a bench or a hidden copy. If the checks cannot hold the page still yet, add the page to `CHECKS_WAIT_FOR_TAP`.
7. Make it work on a phone: 412 px wide with touch, no sideways scroll, canvas layout taken from `canvas.clientWidth`, `svh` and not `dvh` for a canvas stage, `canvas.width` assigned only when the size changed, `touch-action` set where the demo is dragged.
8. Start on the lightest drawing route. Open one GPU context per page where possible, pick WebGPU only through `shared/backend.js`, and show a message or plain HTML when a context is lost.
9. Run `npm run check:jank -- /<name>/`. Run `npm run check:fx` if you touched a file that `fx.js` is built from.
10. Append the results to [FINDINGS.md](FINDINGS.md): a new section at the end, one line in its Contents, and a row in the index for each main result. Update [PLAN.md](PLAN.md) if the page closes an open idea or leaves new ones. Add the page to the table in `README.md`.
11. Add a 720×480 picture to `public/shared/thumbs/` if the page should have an "Examples" card on the homepage.
12. Merge `main` into the branch immediately before opening the pull request. See [AGENTS.md](AGENTS.md).

## How to add other things

| To add | Do this |
|---|---|
| An `fx` effect | `defineEffect(name, { glsl, wgsl, animated, bleed, geometry })` in `lib/effects.js`, or two `<script data-effect="name">` elements on a page. Then `npm run build:fx`. Instructions for site visitors are on `/shader-css/`. |
| A lens | One entry in `LENSES` in `lib/lens-gl.js` (`glsl`, `reach(z)`, `density(z)`, optional `mip`, `animated`, `params`) and the same lens in WGSL in `lib/lens-gpu.js`. The picker on `/lens/` and the "every lens compiles" check pick it up. |
| A transition | `LiveTransition.shaders.name = { glsl, wgsl?, pick? }`, where `glsl` is a `vec4 transition(vec2 uv)` in the gl-transitions convention. |
| A select layout | `layouts.name = { size, place(i, s) → { m: DOMMatrix, alpha, order } }` in `lib/select-picker.js`. |
| An accessibility pattern | One entry in `public/a11y/patterns.js` and a case in `public/a11y/pattern.html`. |
| A transport route | One row in the route table of `public/transports/index.html`. |
| A server route | A module in `src/` and one line in `src/index.js`. |
| A page that the board shows as a tile | Nothing: the board loads demo pages with `?autochecks=0`. |
