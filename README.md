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

Every experiment page has an "About this experiment" box with the question it asks, the pages it builds on and the API calls it uses. The text for each box is in the page's own `page.json`. [`public/shared/learn.js`](public/shared/learn.js) draws the box and holds a table of which experiments use each API call.

## The demos

Each page describes itself in a `page.json` file in its own folder (`public/<name>/page.json`): its menu group, title, one-line description, the question it asks and the calls it uses. No file lists every page. The homepage and the menu are built from the page files.

```
npm run build    # writes public/shared/pages.js from the page files (not committed)
npm run pages    # prints the list of pages by group
```

The results of each experiment are in [findings/](findings/), one file per page or strand, with the index in [FINDINGS.md](FINDINGS.md).

## Library

- `public/lib/canvas-slot.js`: the `<canvas-slot>` element. `onrender = ({ ctx, draw, elements, time }) => …`; `worker="url"` for OffscreenCanvas mode.
- `public/lib/video-export.js`: for a canvas that draws a `<video>` and HTML together. `recordCanvas(canvas, { ms, audioFrom })` (MediaRecorder with the video's sound), `exportFrames(canvas, { video, root, from, seconds, fps, audio })` (seeks the video and steps CSS animations one frame at a time, WebCodecs, WebM with Opus), `decodeSound(url)`, `loopback(stream)` (what a WebRTC peer receives). Test media is rebuilt with `tools/media/make.sh`.
- `public/lib/slot-share.js`: `publish(canvasSlot)` and `<slot-mirror name>` to share slots over a MessagePort; `connectBroker()` introduces same-origin tabs through a SharedWorker (`broker.js`).
- `public/lib/element-capture.js`: `captureElement(el, { scale })`, `capturePage({ full })`, `recordElement(el)`, `exportVideo(el, { fps })` (WebCodecs, frame by frame), `encodeFrames(frames)`, `printElement(el)`, `copyElement(el)`; `{ dpi: 300 }` for print-quality PNG. Works on elements that were never written for canvas.
- `public/lib/a11y-audit.js`: `auditDocument(doc)` runs the accessibility checks from `/a11y/` on any same-origin document. Every page with a `page.json` is audited automatically; `/a11y/?url=/path/` adds another page. `auditPattern(doc)` measures one pattern fixture; add a pattern in `public/a11y/patterns.js` and `pattern.html`.
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

## Plan for new platform features

`/chrome-apis/` is a plan, not a demo: every feature that chromestatus.com lists for Chrome 130 to 160, an idea for combining it with a drawable canvas, and a ranked list of demos to build. `npm run build` generates the page data and the one-document version, `public/chrome-apis/plan.md`, from `tools/chrome-apis/ideas.json` and `demos.json`. Neither output is committed. `npm run build:plan -- --fetch` downloads the feature lists again. When a planned demo is built, put `"plan": "<demo key>"` in the `page.json` of the page that builds it. `npm run record:probes` runs `/chrome-apis/probes.html` in Chromium and records the results that the plan cites.

## Pages must hold still

Opening a demo must not move it. `npm run check:jank` opens every page that has a `page.json` as a phone (412 px wide, device scale factor 2.625, touch, CPU slowed 4x), touches nothing, and fails if the page shifts its layout, scrolls itself, moves focus, covers itself, blanks a canvas or flashes, from navigation until its live checks finish and through a change of viewport height like the URL bar hiding. It needs Playwright with Chromium (`npm i -D playwright`).

```
npm run check:jank                      # every page
npm run check:jank -- /board/ /slot/    # some pages
npm run check:jank -- --checks /lens/   # make checks that wait for a tap run on load
npm run check:jank -- --json out.json --shots frames/   # full numbers and every frame
```

For a new demo page:

- Put `<script src="/shared/nav.js"></script>` first in `<body>`. It reserves the menu's space and holds the first paint until your module scripts have built the page.
- Add `public/<name>/page.json` beside it: `group`, `title`, `blurb` and `tags` for the menu and the homepage, and `question`, `result`, `first` and `api` for the "About this experiment" box. The fields are documented at the top of `tools/site/pages.mjs`. Do not add the page to any shared list. The menu script puts the "About this experiment" box under the page's `<p class="lede">`, so write one. Write the page as an experiment: state the question, and put what worked, what did not and what is still open under "Findings".
- In the first paragraph, say what the demo does and how to use it. Put the demo above the test tables.
- Use the same section names as the other pages: "How it works" for the explanation, "Live checks" for the results table and "Findings" for the conclusions, in that order after the demo.
- `runTests()` puts its results table in a `<details>` with the pass count in the summary line. It is closed on screens narrower than 700 px.
- Live checks run on their own fixtures, out of flow (fixed or absolute, or a hidden copy of the page with `lib/check-fixture.js`). They never call `scrollIntoView()`, `scrollTo()` or `focus()` on the page the reader is looking at, and never insert or remove anything in the flow above the results.
- Do not size a canvas stage with `dvh`: it changes every time a phone's URL bar moves. Use `svh`.
- Only assign `canvas.width` and `canvas.height` when the size really changed. Assigning clears the canvas.
- A page whose checks cannot meet this yet has `<meta name="checks" content="tap">` in its `<head>`; its checks then wait for a button. Known exceptions with their reasons are in the `jank` field of the page's `page.json`.

## A canvas must not stay lost

A browser can take a canvas's context away: the GPU process restarts, memory is short, a WebGPU device is lost, or the page holds too many WebGL contexts. Chrome on Android keeps 8 WebGL contexts alive per tab, frames included (16 on desktop). Making a ninth takes the oldest away, which is usually the demo at the top of the page.

`public/shared/context-guard.js` handles this on every page. `nav.js` loads it before any page script, so a page does nothing to get it. It:

- counts every context a page makes (`window.__gfx.summary()` prints the counts and every loss);
- when one more WebGL context would reach the limit, takes the context of canvases that were removed from the page earlier (finished check fixtures), so the browser does not take one from a canvas on screen;
- calls `requestPaint()` on a 2D canvas when its context is restored;
- puts a note with a Reload button and the context counts over any visible canvas that is still lost 1.5 seconds after the loss. If the page shows its own `role="alert"` message over the canvas, the guard adds nothing.

`public/shared/backend.js` remembers a lost WebGPU device for ten minutes in `sessionStorage`. In that time `webgpu()` answers null and pages use WebGL, because a device that was lost once on a phone is usually lost again on the next page. `?webgpu=retry` forgets the loss.

For a new page or library:

- Keep at most 8 WebGL contexts alive, counting the visible demo and one check fixture. `npm run check:jank` fails a page above that (`glContexts`) and a page that shows the guard's note (`lostCanvases`).
- Do not make a WebGL context to test for support. Use `webgl2()` from `shared/backend.js`, which asks once and gives the context back.
- A canvas made for a check is removed from the page when the check ends. The guard frees its context if the limit is near. Do not call `WEBGL_lose_context.loseContext()` yourself to free a context: threads have seen it crash the renderer in Chromium 157 on a drawable canvas still in the page, on one removed in the same task, and on one with an iframe child.
- Handle the loss in the library when a better answer than the note exists: listen for `webglcontextlost` (WebGL), `contextlost` (2D) and the window event `webgpulost` (WebGPU, sent by `shared/backend.js`), then move the content to a new canvas or show it as plain HTML. `SurfaceElement` in `lib/surface.js` shows plain HTML for both canvas events when its subclass does nothing.
- To see what a page does on a loss, call `getExtension('WEBGL_lose_context').loseContext()` on a canvas in the console, or make 16 more WebGL contexts.

The measurements behind these rules, and what still needs a real phone, are in [docs/lost-contexts.md](docs/lost-contexts.md).

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
npm run build      # once, and after changing a page.json: writes the generated menu
npm run dev        # build, then wrangler dev. Needs a Cloudflare login because of the Workers AI binding
npm run deploy     # build, then deploy html-in-canvas-demos and html-in-canvas-remote
npm run tools      # lists the scripts under tools/
npm run check:merge   # does this branch merge with main and with the other open branches
```

Pushes to `main` deploy both Workers through Workers Builds. Its install step runs the `postinstall` script, which is the build. [ARCHITECTURE.md](ARCHITECTURE.md), "Files that parallel branches share", says which files a pull request should and should not edit.
