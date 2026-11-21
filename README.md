# HTML-in-canvas experiments

Pushing on the experimental [HTML-in-canvas](https://github.com/WICG/html-in-canvas) API: reprojecting real, interactive DOM through slots, workers, tabs and origins.

Live: https://html-in-canvas-demos.kinlan-test.workers.dev (second origin for the cross-origin demo: https://html-in-canvas-remote.kinlan-test.workers.dev)

Needs Chrome 148+ (desktop or Android) with `chrome://flags/#canvas-draw-element` set to Enabled, or the `html-in-canvas` origin trial. Without it the site is plain HTML. The demos are tested in Chromium 157 and in Chrome 159 on Android.

## Project documents

| File | What it holds |
|---|---|
| [AGENTS.md](AGENTS.md) | Start here if you are a coding agent or a new contributor: which file to read for what, and the rules for every change. |
| [PLAN.md](PLAN.md) | Goals, strands of work and their status, every open idea and planned demo, and what still needs real hardware. |
| [FINDINGS.md](FINDINGS.md) | Every measured result, indexed by API area with the browser and page for each, Chromium bugs worth filing and API requests. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Repository layout, the Worker and its routes, shared modules, the check harness, scripts, local testing, deploy and previews, how to add a page. |
| [DESIGN.md](DESIGN.md) | The visual style as built (colours, type, spacing, components), section order, phone rules and writing rules. |
| [KNOWN-LINKS-AND-RESOURCES.md](KNOWN-LINKS-AND-RESOURCES.md) | The explainer, Chrome documentation, every external source cited here, and the live and preview URLs. |

## Learn the API

[`/start/`](https://html-in-canvas-demos.kinlan-test.workers.dev/start/) is a tutorial: how to enable the API, a 60-line page that draws one element ([`public/start/hello.html`](public/start/hello.html)), common errors with their fixes, and a glossary.

The minimum code:

```html
<canvas id="canvas" content="drawable" layoutsubtree>   <!-- 1. mark the canvas -->
  <form id="card" drawable> … </form>                   <!--    and each element to draw -->
</canvas>
<script>
  canvas.onpaint = () => {                               // 2. fires when the element's rendering changes
    const ctx = canvas.getContext('2d');
    ctx.reset();
    ctx.rotate(-0.04);                                   // 3. any canvas transform, clip, shadow or filter
    ctx.drawElementImage(card, 20, 20, card.offsetWidth, card.offsetHeight);   // 4. draw; also sets hit testing
  };
</script>
```

## Two kinds of page

[`/start/`](public/start/) is a tutorial for the API: how to enable it, a 60-line page that draws one element, common errors and a glossary. It is the only page written as a lesson.

Every other page is an experiment. Each one asks a question about the API (for example, whether a `<slot>` works inside a canvas, or whether one element can be drawn in two places) and reports what worked and what did not. The slot pages, `<canvas-slot>` and `<dom-portal>` are experiments, not recommended patterns. Experiments have no reading order.

Every experiment page has an "About this experiment" box with the question it asks, the pages it builds on and the API calls it uses. The text for the boxes is in [`public/shared/learn.js`](public/shared/learn.js), with a table of which experiments use each API call.

## The demos

| Demo | What it explores |
|---|---|
| `/start/` | Tutorial: enable the API, draw one element, common errors, where each API call is used, glossary |
| `/slot/` | `<canvas-slot>`: light-DOM children slotted into a shadow canvas |
| `/slot-bare/` | Just `<slot>` in `<canvas>` with declarative shadow DOM; a shadow root on `<body>` |
| `/offscreen/` | `ElementImage` snapshots rendered in a worker; magnifier; pixel mirrors |
| `/cross-tab/` | Slots streamed to another tab over MessagePorts, with input sent back |
| `/cross-origin/` | Borrowing and lending DOM across origins |
| `/transports/` | Transport lab: ~50 routes for moving DOM out of its canvas, each tested live |
| `/portal/` | `<dom-portal for="id">`: one live element drawn twice, interactive in both places |
| `/lens/` | `<dom-lens>`: fifteen lenses over live DOM (magnifier, ray-traced glass, fisheye, water drop, x-ray, black hole…), sharp at any zoom, one draw and one shader each |
| `/shader-css/` | `fx="ripple"`: any element through a WebGL shader, driven by CSS custom properties |
| `/slot-effects/` | `<canvas-slot effect="tilt">`: named effects with no render loop, and `effect="#shader"` to point a slot at your own fragment shader |
| `/physical/` | `<physical-ui material="cloth">`: working forms on jelly, cloth and paper |
| `/select/` | `<select picker="wheel">`: a customisable select whose options are drawn by a canvas inside the picker (wheel, fisheye list, radial, 3D carousel, hand of cards, colour grid, helix); a canvas in the button; a canvas inside each option; a select drawn in a canvas |
| `/datalist/` | `<input list picker="list">`: datalist suggestions drawn one option at a time by a canvas in a popover; datalist options as tick labels of a range input |
| `/inputs/` | `<input type="time" picker="clock">`, `type="date" picker="calendar"`, `type="color" picker="swatches"`: pickers made of buttons in a canvas; every built-in form control drawn rotated in a canvas |
| `/a11y/` | Accessibility audit: API probes, a pattern-by-pattern table (tree, focus order, find, selection, zoom), the same audit run over every demo, and a by-hand checklist |
| `/capture/` | Any element or a whole page to PNG (up to print quality), video (MediaRecorder or frame-exact WebCodecs) or print with one call |
| `/perf/` | Performance wall: how many live elements before frames drop; DOM vs 2D canvas vs worker |
| `/elements/` | Every HTML element, input type and a few attributes inside a drawable canvas: drawn or not, hit testing, real clicks and keys, and one idea per element. `ELEMENTS.md` is the same table as Markdown; `npm run record:elements` re-records it |
| `/element-ideas/` | 17 ideas from the element catalogue built with the real elements: picker wheel, mixing desk, step sequencer, CRT textarea, in-canvas dialog, anchored popovers, inert, find and camera, MathML, video, image map, cover flow, radial menu, table bar chart, ins and del, editable style, marquee ticker. `npm run check:ideas` drives each with real input |
| `/transitions/` | `<live-transition>`: shatter, fold, burn, morph or your own fragment shader between two states that both stay live and clickable |
| `/view-transitions/` | The View Transitions API with a canvas that draws HTML: names on the canvas and on its children, a shader in place of the cross-fade, scoped transitions, and two documents |
| `/time-scrubber/` | `<dom-rewind>`: a ring buffer of DOM frames to scrub back through, with motion trails and restore |
| `/particles/` | `<glyph-field>`: text as glyph particles that stays selectable, searchable and editable |
| `/selection/` | `<selection-fx>`: the canvas draws the highlight of selected text (2D and shader effects), plus measurements of what the browser paints for a selection in a canvas |
| `/caret/` | An editable block in a canvas: CSS caret shape and animation in the picture, a caret streak and wavy typo lines drawn by the canvas, `highlightsFromPoint()` |
| `/scroll-fx/` | Scroll-driven animations, a `scroll-state()` query and a timeline trigger as shader inputs: blocks burn in, unroll and melt with the scroll and blur by its speed, with no scroll listener |
| `/tear-off/` | Widgets torn off into popups, Picture-in-Picture, unlinked tabs and other origins, with input sent back |
| `/remote/` | One element streamed to a phone over WebRTC, with taps and typing sent back |
| `/embed/` | Cross-origin cards the host distorts and restyles without DOM access |
| `/support/` | Share one region of a page with a support agent or a vision model |
| `/three-form/` | A live form on a laptop screen, a billboard and a curved wall in three.js (WebGL or `?renderer=webgpu`), via `lib/html3d.js` |
| `/board/` | An infinite zoomable board whose tiles are live notes and iframes |
| `/xr/` | WebXR panels made of HTML, with controller rays, an on-panel keyboard and a built-in headset emulator (`?emulate=1`) |
| `/slot-view/` | `<slot-view src name>`: a live piece of another site with no iframe box, consent on the providing side, input forwarded ([protocol](public/slot-view/PROTOCOL.md)) |
| `/pip/` | `pipElement(el)`: picture-in-picture for any element, moved for real, as a live picture, or as a video |
| `/video/` | A `<video controls>` with captions as a canvas child under a shader. What is drawn (frames, controls, `::cue`), and what is left out (cross-origin, encrypted) |
| `/overlay/` | HTML over video in one canvas: recorded with sound, exported frame by frame with WebCodecs, sent over WebRTC |
| `/audio/` | Web Audio band levels as CSS custom properties that drive a shader over a working `<audio>` card |
| `/player-parts/` | Parts of the native media player: restyled through `::-webkit-media-controls-*`, player state driving a shader through `:has()`, and the controls drawn as a layer apart from the picture |
| `/player-fx/` | One WebGL shader over the native controls and the video frame as two textures from one `<video>`: the play button grows into a lens, the controls refract, melt into and light the picture. Finds the box of each control without script access |
| `/native-ui/` | Real DOM inputs as widgets inside an egui (Rust) app and a Qt Quick (C++) app, both compiled to WebAssembly. Research on other frameworks: [docs/native-frameworks.md](docs/native-frameworks.md) |
| `/component-kit/` | One drawable custom element written with a scoped registry, manual slot assignment, Reference Target, `using`, Observable and `moveBefore()`, and again without them, with the lines each feature removes |
| `/shape-ui/` | Buttons outlined with `corner-shape`, `border-shape` and `clip-path: shape()`, lit by a shader that reads alpha as height. The light follows the pointer or the phone's tilt (`lib/tilt-light.js`) |
| `/tilt-card/` | A payment card, a ticket and a two-faced badge in HTML under foil, hologram and lenticular shaders. The phone's tilt (or the pointer) leans them, and hit testing follows the lean |
| `/text-labels/` | A sign, book spines and a ticker sized by `text-fit` and `text-box-trim`, and an `<input>` in the canvas whose characters animate one by one from `createValueRange()` boxes (`lib/char-rects.js`) |

What works and what doesn't is in [FINDINGS.md](FINDINGS.md).

## Library

- `public/lib/canvas-slot.js`: the `<canvas-slot>` element. `onrender = ({ ctx, draw, elements, time }) => …`; `worker="url"` for OffscreenCanvas mode.
- `public/lib/video-export.js`: for a canvas that draws a `<video>` and HTML together. `recordCanvas(canvas, { ms, audioFrom })` (MediaRecorder with the video's sound), `exportFrames(canvas, { video, root, from, seconds, fps, audio })` (seeks the video and steps CSS animations one frame at a time, WebCodecs, WebM with Opus), `decodeSound(url)`, `loopback(stream)` (what a WebRTC peer receives). Test media is rebuilt with `tools/media/make.sh`.
- `public/lib/slot-share.js`: `publish(canvasSlot)` and `<slot-mirror name>` to share slots over a MessagePort; `connectBroker()` introduces same-origin tabs through a SharedWorker (`broker.js`).
- `public/lib/element-capture.js`: `captureElement(el, { scale })`, `capturePage({ full })`, `recordElement(el)`, `exportVideo(el, { fps })` (WebCodecs, frame by frame), `encodeFrames(frames)`, `printElement(el)`, `copyElement(el)`; `{ dpi: 300 }` for print-quality PNG. Works on elements that were never written for canvas.
- `public/lib/a11y-audit.js`: `auditDocument(doc)` runs the accessibility checks from `/a11y/` on any same-origin document. Demos registered in `shared/demos.js` are audited automatically; `/a11y/?url=/path/` adds another page. `auditPattern(doc)` measures one pattern fixture; add a pattern in `public/a11y/patterns.js` and `pattern.html`.
- `public/lib/live-transition.js`: `<live-transition>`. Children are states; `show(i, { effect, origin })`, or `begin(i)` then set `progress` to hold part way. Effects are functions in `LiveTransition.effects`. Or write your own blend: `LiveTransition.shaders.name = { glsl, pick? }`, where `glsl` is a `vec4 transition(vec2 uv)` in the gl-transitions convention (`getFromColor`, `getToColor`, `progress`, `ratio`), then `show(i, { effect: 'name' })`. Both states stay live inside the shader; `pick(x, y, p)` says which state the pointer reaches at a point. `backend="webgpu|webgl"` names a route (WebGPU when usable otherwise); a shader with a `wgsl` string beside `glsl` runs on both.
- `public/lib/dom-rewind.js`: `<dom-rewind seconds trails>`. `place(el, { x, y, rotate })`, `seek(secondsAgo)`, `replay()`, `restore()`, `oncapture` / `onrestore` for app state. `for await (const { time, bitmap } of rw.frames({ seconds, fps }))` hands the recorded history back as ImageBitmaps for a video encoder. If the canvas context is lost, `<live-transition>` and `<dom-rewind>` show their children as plain HTML until it returns (`fallbackReason`, `showPlain(reason)`, `showCanvas()`, events `livefallback` / `rewindfallback`), as `<glyph-field>` already did.
- `public/lib/glyph-field.js`: `<glyph-field pointer="repel" engine="2d|webgl|webgpu|auto">`. `explode()`, `rain()`, `vortex()`, `scatter()`, `assemble()`, `highlight(text)`. While letters are in flight the hit box follows the pointer, so a flying letter of a link can be hovered, clicked or tapped (`particleAt(x, y)` says which letter is under a point).
- `public/lib/dom-portal.js`: `<dom-portal for="id" scale="0.5">` mirrors any element; `<dom-portal-source layer="top">` for sources inside clipping ancestors.
- `public/lib/dom-lens.js`: `<dom-lens mode="magnify|glass|fisheye|…" zoom radius>` around any markup. The lenses are fragment shaders: GLSL in `public/lib/lens-gl.js` (`LENSES`) and WGSL in `public/lib/lens-gpu.js` (`WGSL`); add an entry to both to add a lens. WebGPU is used when it works, then WebGL, then 2D.
- `public/shared/backend.js`: `pickBackend()` and `webgpu()` choose between WebGPU, WebGL and 2D for a page, and share one WebGPU device. WebGPU is only chosen with a real adapter that passes a self-test.
- `public/shared/route-switch.js`: `routeSwitch(mount, { targets, attr, values, active, note })` is the "Drawn with" menu on the shader pages. It writes the route attribute, shows what is drawing and why WebGPU is not, and reads `?route=webgl`.
- `public/lib/gpu-util.js`: WebGPU helpers the elements share: `GPUElementTexture` (an element as a `GPUTexture`), `GPUCanvas` (show, or draw off-screen and `read()`), `watchFrame()` (first-frame error scope), `blankWatch()` and `pictureDifference()` for checks.
- `public/lib/fx.js`: the `fx` attribute as one file for other sites: `<script type="module" src="https://html-in-canvas.page/lib/fx.js"></script>`, then `fx="ripple"` on any element. It exports `defineEffect`, `effects` and `FxSurface`. It is generated from `shader-fx.js` and the modules it imports: run `npm run build:fx` after changing any of them, and `npm run check:fx` to confirm the file is current. `/shader-css/` has the instructions for adding an effect, and `/shader-css/standalone.html` is a complete page that loads only this file.
- `public/lib/shader-fx.js`: the `fx` attribute (`ripple`, `glass`, `haze`, `crt`, `dissolve`, `curl`) and `defineEffect(name, { glsl, wgsl })`. WebGPU when it is usable and the effect has WGSL, else WebGL; `fx-backend="webgpu|gl|direct|shared"` names a route and `surface.gpuNote` says why WebGPU is not in use.
- `public/lib/effects.js`: the effect registry shared by `fx` and `<canvas-slot effect>`. `defineEffect(name, { glsl, wgsl, animated, bleed, geometry })`, or two `<script data-effect="name">` elements (one `type="text/glsl"`, one `type="text/wgsl"`) with no script call; CSS properties `--fx-progress`, `--fx-amount`, `--fx-x`, `--fx-y`.
- `public/lib/slot-effects.js`: the shader renderer `<canvas-slot effect>` loads on demand. WebGPU when usable, else WebGL; `backend="webgpu|gl|webgl|shared"` names a route.
- `public/lib/physical-ui.js`: `<physical-ui material="jelly|cloth|paper" wind pin>`. `backend="webgpu|webgl"` names a route; without it WebGPU is used when usable.
- `public/lib/tilt-light.js`: `tiltLight(el)` writes a direction to `--fx-x` and `--fx-y` on an element, from the pointer, from `deviceorientation` after `light.useSensor()` is called in a tap, or from a slow circle when idle.
- `public/shared/fx-route.js`: `loadFx({ targets, mount })` loads the fx library with one graphics context for the page: the shared WebGPU device, else one shared WebGL context.
- `public/lib/char-rects.js`: `charRects(input)` returns one box per character of an `<input>` or `<textarea>`, from `createValueRange()` where it exists and from `measureText()` otherwise.
- `public/lib/surface.js`: the shared base that slots any markup into a canvas; `SurfaceElement.adopt(el)` wraps an element in place.

- `public/lib/live-surface.js`: `<live-region>` and `attachSurface(el)` turn any element into a shareable surface (frames, redaction, element map, replayed input). `serve(surface, link)` speaks the protocol.
- `public/lib/live-view.js`: `<live-view>`, the receiving end. Needs no HTML-in-canvas.
- `public/lib/live-link.js`: `shareInRoom()` / `watchRoom()` over a relay room, WebRTC with a relayed-JPEG fallback. Both emit `log` lines; `public/lib/live-log.js` (`connectionLog(el)`) shows them on the page.
- `public/lib/live-card.js`: `<live-card src effect>` embeds a cross-origin card through a WebGL shader.
- `public/lib/slot-view.js` and `public/lib/slot-provider.js`: the cross-site `<slot-view src name>` element and `provideSlots()` for the site being embedded.
- `public/lib/element-pip.js`: `pipElement(el, { mode })` and `surfaceFor(el)`.
- `public/lib/select-picker.js`: `<select picker="wheel|fisheye|radial|carousel|fan|grid|helix">`. Moves the options into a drawable canvas inside the select; the select keeps the value, keyboard and form entry. `new SelectPicker(select, { layout, backend, canvas })`, `choose(i)`, `close()`, `refresh()`; add a layout with `layouts.name = { size, place }`. The carousel and helix use WebGPU, WebGL 2, then 2D. `rollSelected(select)` draws `<selectedcontent>` with a canvas in the button.
- `public/lib/placed-popover.js`: `new PlacedPopover({ anchor, items, size, place })`. A popover next to an element, holding a canvas that draws each item where `place(i)` says and eases it there when the answer changes. `under(ctx)` draws below the items. The base of the two libraries below.
- `public/lib/datalist-picker.js`: `<input list picker="list|chips">`. Moves the `<datalist>` into a popover canvas and draws its options as the suggestions. `RangeLabels(input)` draws a range input's datalist options as tick labels.
- `public/lib/input-pickers.js`: `<input type="time" picker="clock">`, `<input type="date" picker="calendar">`, `<input type="color" picker="swatches" list>`. Each picker is real buttons in a popover canvas.

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
- Add one line for it in `public/shared/demos.js` (menu and homepage) and one entry in `public/shared/learn.js` (the question the experiment asks, the pages it builds on, the calls it uses). The menu script puts the "About this experiment" box under the page's `<p class="lede">`, so write one. Write the page as an experiment: state the question, and put what worked, what did not and what is still open under "Findings".
- In the first paragraph, say what the demo does and how to use it. Put the demo above the test tables.
- Use the same section names as the other pages: "How it works" for the explanation, "Live checks" for the results table and "Findings" for the conclusions, in that order after the demo.
- `runTests()` puts its results table in a `<details>` with the pass count in the summary line. It is closed on screens narrower than 700 px.
- Live checks run on their own fixtures, out of flow (fixed or absolute, or a hidden copy of the page with `lib/check-fixture.js`). They never call `scrollIntoView()`, `scrollTo()` or `focus()` on the page the reader is looking at, and never insert or remove anything in the flow above the results.
- Do not size a canvas stage with `dvh`: it changes every time a phone's URL bar moves. Use `svh`.
- Only assign `canvas.width` and `canvas.height` when the size really changed. Assigning clears the canvas.
- A page whose checks cannot meet this yet goes in `CHECKS_WAIT_FOR_TAP` in `public/shared/support.js`; its checks then wait for a button. Known exceptions with their reasons are in `tools/jank/allow.json`.

## Show the code

Every demo has a "Show the code" listing under it: numbered steps, each with the code that does it, a Copy button and a link to the lines on GitHub. The listings are cut from the files the page is running when someone opens one, so they cannot drift. `public/shared/show-code.js` does it (loaded by `nav.js`, styles in `shared/style.css`).

Mark the code with region comments, in whichever comment style the file uses there:

```
<!-- #region markup -->        // #region draw           /* #region styles */
<canvas-slot>…</canvas-slot>   ctx.drawElementImage(…);  .card { … }
<!-- #endregion markup -->     // #endregion draw        /* #endregion styles */
```

Then list the steps in the page:

```html
<details class="show-code">
  <summary>Show the code <small>what this listing covers</small></summary>
  <ol>
    <li data-code="#markup"><b>What this step does.</b> One line of why.</li>
    <li data-code="/lib/canvas-slot.js#worker"><b>A region of another file.</b></li>
    <li data-code="/offscreen/renderer.js"><b>A whole file.</b></li>
  </ol>
</details>
```

`data-code` is `file#region`: no file means this page, no region means the whole file. Using a name more than once in a file shows the pieces together, which is how a listing skips over test scaffolding. Regions may nest. Keep the `<details>` in the page's HTML and closed, so it takes its one line of space from the first paint. `data-lang="glsl"` overrides the language, and `data-code-full` shows a long block without the "Show all lines" cut.

For rows of a results table that each run their own function, `window.showCode.block(fn, 'js', label)` returns a listing of that function's own text (see `rowCode` in `/transports/` and `/a11y/`).

The slot pages use `shared/source-view.js` instead, which shows whole stand-alone example files.

## Native UI proofs

`/native-ui/` runs two WebAssembly apps whose sources are outside `public/`:

- `native/egui-dom/` (Rust, egui 0.37). Build with `native/egui-dom/build.sh`. Needs the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130; `wasm-opt` is used if installed.
- `native/qt-dom/` (C++, Qt Quick 6.10.3). Build with `QT=… EMSDK=… native/qt-dom/build.sh`. Needs Qt for WebAssembly (single-threaded), the matching desktop Qt and Emscripten 4.0.7.

The build output is committed in `public/native-ui/egui/` and `public/native-ui/qt/`, because the deploy does not have these toolchains. Each build script also copies the sources next to the output for the page's code listings, so edit the files in `native/` and rebuild. The Qt binary is statically linked against the open-source edition of Qt (LGPL-3.0 and GPL-3.0); its complete source is `native/qt-dom/` plus Qt 6.10.3 from download.qt.io.

## Develop and deploy

Static files in `public/`, served by Workers static assets.

```
npx wrangler dev   # needs a Cloudflare login because of the Workers AI binding
npm run deploy   # deploys html-in-canvas-demos and html-in-canvas-remote
```

Pushes to `main` deploy both Workers through Workers Builds.
