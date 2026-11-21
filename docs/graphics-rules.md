# Graphics rules: what a page must not do to the GPU

Written 2026-11-21, after canvases were lost and tabs went white on the test phone (Chrome 159, Android) on `/hdr-glow/`, `/instruments/` and `/scoped-transitions/`. The test browser (headless Chromium 157, software rendering) does not lose a context in any of these cases. So the rules are not checked by waiting for a loss. They are checked in the source, and by counting what a page does.

Three things check them:

| Check | What it is | When it runs |
|---|---|---|
| `npm run check:gfx` | `tools/gfx/check.mjs` reads the source of every page and library for the calls in the first table below. | In `npm run build`, through `tools/gfx/site-build.mjs`. The build is the install step of Workers Builds, so a page that breaks a rule gets no preview and no deploy. |
| `npm run check:jank` | Opens each page as a phone, touches nothing, and reads the counts that `/shared/context-guard.js` keeps. | By hand, for every page you change. |
| `/shared/context-guard.js` | Runs on every page for every visitor. It frees canvases, warns in the console, stops a loop of losses and keeps a record for the next page load. | Always. |

`node tools/gfx/test-guard.mjs` tests the guard itself.

## What was seen on the phone

| Page | Report | What the record shows |
|---|---|---|
| `/hdr-glow/` | White canvas with the guard's note. | Seven 2D contexts lost together at 1.4 to 1.6 s, 3.1 s, 4.6 s, 6.1 s and 7.6 s. The page read four float pixels back with `getImageData()` every 1.5 s. In the test browser those readbacks happen at 1.56 s, 3.10 s, 4.63 s and 6.16 s after load. The times agree to within 0.1 s. All accelerated 2D canvases being lost at once means the GPU process, or its connection to the page, was lost each time. |
| `/instruments/` (pull request 72) | Broken-picture icon in the first canvas, then a white tab, then an empty canvas after a reload. | No record: the page was white before a note could be read. The page has no WebGL. It ran its live checks on load, with fixtures that draw elements into `willReadFrequently` canvases. Cause not identified. |
| `/scoped-transitions/` (pull request 70) | Broken-picture icon in a 2D canvas. | No record. Cause not identified. |

Reported from the phone on 2026-11-21, after pull request 75 removed the timer: the canvas stayed until "Map of values above 1.0" was chosen, which reads the whole float canvas once, and the page's message then said the context was lost right after that readback, 5.3 s after load. So a float readback made by a tap also loses the canvas there. One occurrence. The `float` and `float-copy` trials on `/canvas-loss/` repeat it alone.

Not verified: what loses the canvases on `/instruments/` and `/scoped-transitions/`. The guard now writes a record that survives a white tab (see "The record" below). The text of that record from the phone is what will identify the cause.

## The cause found on the phone: `willReadFrequently` on a drawable canvas

Reported from the phone on 2026-11-21 (Chrome 159, Android 10) by `/canvas-loss/`, which runs one operation at a time:

| Trial | Result on the phone |
|---|---|
| A drawable canvas drawn once; a paint on every frame; `ctx.reset()` per paint; a draw at `globalAlpha` 0; `shadowBlur`; `ctx.filter`; 40 source-rectangle draws per paint; `canvas.width` assigned per frame; twelve canvases at once; a nested drawable | No loss, 240 paints in 4 s each |
| One drawable canvas made with `willReadFrequently: true`, one `drawElementImage()`, one `getImageData()` of one pixel | 10 losses: the trial's canvas and the plain canvas that stays on the page, 35 ms after the draw, then again at 548 ms and 1,075 ms and so on. The guard's log: two 2D contexts lost every 0.5 s, six times, until it stopped drawing. Only the first loss had a readback before it. |
| Twelve such canvases made, drawn, read and removed in a row | Not a valid result: it ran after the guard had stopped `paint` events, so nothing was drawn ("0 had a drawn pixel"). The tab did not stop. The copied text said "tab stopped" because it was copied while the next trial was running. |

The trial draws and reads once and then removes its paint handler, so the later losses came with no draw and no readback by the page: the canvas existing, with its drawn child, was enough. Separated at 19:52 UTC the same day by `/crashes/repro/readback-matrix.html`, which has none of the site's scripts and runs each case in a page load of its own: the loss needs only `willReadFrequently` and `drawElementImage()`. With no read at all, both canvases were lost 8 ms after the draw and again about every 510 ms. The ten cases without the option lost nothing, and those include `getImageData()` on the drawn canvas straight away and 1 s later, a read from a `drawImage()` copy in a plain and in a `willReadFrequently` canvas, `toDataURL()`, `createImageBitmap()` and `captureElementImage()`. So a single read of an accelerated drawable canvas is not a cause, and the copy route is safe on that phone. Live check fixtures were made this way in `lib/stage-2d.js` (`fixtureCanvas()`), in `lib/text-canvas.js` of pull request 80, in `/instruments/`, and in the check code of about twenty pages, which fits pages that ran their checks on load losing their canvases, and the losses coming in a loop. `/hardware-out/` drew its key pad and its sign that way after pull request 81, by the advice this document gave then.

A second trigger was reported from the same phone at 20:03 UTC on 2026-11-21 (`/canvas-loss/`, trial `gpu-read`): a drawable canvas made with no options, painted on every frame, with `getImageData()` of one pixel every 300 ms. The first read lost nothing. 7 ms after the second read the trial's canvas and the plain canvas that stays were both lost, and again after every second read (12 losses, about 600 ms apart). So one direct read of a drawable canvas is safe there and a second is not. The guard now answers `getImageData()` on a canvas that has its drawable attributes from a `drawImage()` copy in a plain `willReadFrequently` canvas (`__gfx.copyReads` counts them; `data-gfx-raw` on the canvas keeps the direct read; float16 and non-sRGB reads are left alone). A guess that is not measured: Chrome moves a 2D canvas off the GPU after repeated reads, and `drawElementImage()` into a canvas that is not accelerated is the single fault behind both triggers. Seven cases on `/crashes/repro/readback-matrix.html` test that. Not verified on the phone: that the copy route loses nothing (trials `gpu-read-guarded` and `copy-read`).

The fix is in the guard: `getContext('2d', { willReadFrequently: true })` on a canvas that has `layoutsubtree` or `content="drawable"` is made without the option, with a console warning and a `frequent-read-drawable` report. A canvas given its drawable attributes after `getContext()` cannot be changed; the guard warns and reports at its first `drawElementImage()`. Not covered: an `OffscreenCanvas` in a worker (`/transports/worker.js`), where the guard does not run.

Not verified on the phone: that the guard's removal holds on a page of the site (trials `wrf-guarded` and `fixtures-guarded` on `/canvas-loss/`), repeated reads (`gpu-read`, 12 in 4 s), 60 open snapshots, and the float trials.

## Rules checked in the source (`npm run check:gfx`)

| Rule | A page must not | Do this |
|---|---|---|
| `lose-context` | Call `WEBGL_lose_context.loseContext()`. On a drawable canvas in the page, on one removed in the same task, and on one with an iframe child, it has crashed the renderer in Chromium 157. | Remove the canvas, then call `window.__gfx?.retire(canvas)`. The guard gives the context back a moment after the canvas has left the page. To test a fallback, dispatch a `webglcontextlost` or `contextlost` event on the canvas. |
| `own-device` | Call `adapter.requestDevice()`. Every call makes another WebGPU device. | `webgpu()` from `/shared/backend.js` for the page. `checkDevice()` from the same file for a live check. |
| `webgl-context` | Call `getContext('webgl')` or `getContext('webgl2')`. Chrome on Android keeps 8 WebGL contexts per tab and takes the oldest away when a ninth is made. | `new ElementGL(canvas, …)` from `/lib/element-gl.js`: one canvas and one context for the page, which draws every element. |
| `float-readback` | Call `getImageData()` with `pixelFormat: 'rgba-float16'`. | Not on a canvas that is shown. On the test phone one call on a tap lost the canvas. A page whose evidence is the float values may read once on a tap, with the exception comment below, if it replaces the canvas after a loss and does not read again on that device (`/hdr-glow/` does this from pull request 82). Copying with `drawImage()` into a second float16 canvas clamps to 1.0 in Chromium 157 (`findings/hdr-glow.md`), so a copy cannot carry values above 1.0. |
| `timed-readback` | Call `getImageData()`, `readPixels()` or `mapAsync()` in the callback of `setInterval()` or `requestAnimationFrame()`. | Read back on a tap. For pixels that are needed often, copy the canvas with `drawImage()` into a second, plain 2D canvas (not a drawable one) made with `willReadFrequently: true`, and read from the copy. That canvas is kept in ordinary memory. |
| `draw-size` | Call `drawElementImage(el, x, y)` with no width and height. Under `ctx.scale(devicePixelRatio)` the element and its hit region are that many times too large on a phone and right at a ratio of 1. This rule is about a wrong picture, not a lost canvas; it is here because this check is the one that reads the source. | Pass the size in the units of the context. [draw-size.md](draw-size.md) has the measurements, the exceptions and the run-time check. |
| (run time, in the guard) | Make a drawable canvas with `willReadFrequently: true`. | Leave the option out. Read pixels from a `drawImage()` copy in a plain canvas. See the section above. |

An exception is a comment at the call, on the same line or the line above, with the reason:

```js
// gfx-allow: own-device a compatibility device is made to read its limits and destroyed below
const device = await adapter.requestDevice();
```

`tools/gfx/known.json` lists the files that broke a rule before 2026-11-21, each with a reason. It is a list of work to do, not a place for new pages. The check fails when an entry is no longer needed.

The check for `timed-readback` only sees a readback written inside the callback. A loop that reaches a readback through a function call or a flag (as `/hdr-glow/` did) is found by the measured check below.

## Rules that are measured (`npm run check:jank`)

The page is opened at 412 CSS pixels wide with a device scale factor of 2.625, and nothing touches it. The limits:

| Metric | Limit | What it counts |
|---|---|---|
| `glContexts` | 3 | Most WebGL contexts alive at once: the page's own, one check fixture, one probe. |
| `gpuDevices` | 1 | WebGPU devices alive at once. |
| `canvasMB` | 96 | Most memory in all canvases at once, as the guard estimates it. |
| `canvasMP` | 4 | Megapixels of the largest canvas. A canvas 412 CSS pixels wide reaches this at 1,410 CSS pixels tall. |
| `removedMB` | 8 | Memory, at the end, in canvases that were taken out of the page and not freed. |
| `timedReadbacks` | 2 | Different seconds in which pixels were read back from a GPU canvas with no tap and no live check running. One measurement at load and one after a resize make 2. A timer or a frame loop makes more. |
| `unaskedReadbackMP` | 0.5 | Megapixels of the largest such readback. |
| `openSnapshots` | 8 | `captureElementImage()` pictures still open at the end: made, not closed and not collected. Each holds a picture on the GPU. Added after `/flip-clock/` and `/split-flap/` (pull request 80) were found to take one every second or on every change and never close it. Not verified: that this is what lost their canvases on the phone. |
| `lostContexts` | 0 | Contexts of any kind that were lost. |
| `lostCanvases` | 0 | Visible canvases that showed the guard's note. |

The memory estimate is width times height times bytes per pixel times buffers. A 2D canvas has one buffer of 4 bytes per pixel, or 8 for `colorType: 'float16'`. A WebGL or WebGPU canvas has two buffers, or four with antialiasing. The numbers 96 MB and 4 megapixels are a choice that every page on main met on 2026-11-21 after the homepage was changed. They are not limits read from Chrome. On a real device the guard scales them by the screen: one canvas may hold 1.25 screens of pixels (at least 4 megapixels) and all canvases 24 screens of bytes (at least 96 MB).

A known exception goes in the `jank` field of the page's `page.json`, with a `max` and a `why`.

Measured on main on 2026-11-21 (Chromium 157, headless), before and after this change:

| Page | Before | After |
|---|---|---|
| `/` (homepage) | 222 MB in 9 canvases, the largest 9.2 megapixels (1,081 by 8,490 device pixels) | 17 MB, the largest 2.8 megapixels. Each group is drawn by canvases of at most four cards, and a canvas more than one screen away is 0 by 0. |
| `/hdr-glow/` | Readbacks in 3 of the 4 seconds after its checks | The same on main. Pull request 75 removes the timer. |
| `/shader-css/`, `/slot-effects/` | 7 and 8 WebGL contexts | The same, recorded as exceptions. Each effect element still has its own context when WebGPU is not used. |
| `/embed/` | `readPixels()` once a second for as long as the page was open (`LiveCard.isBlank()`) | The look stops when a picture has been seen, or after nine looks. |
| `/hardware-out/` | `getImageData()` from a GPU canvas on every frame (the LED matrix) and for every changed key | The canvases that are read are made with `willReadFrequently`. |
| `/select/` and other pages that call `webgl2()` | One lost WebGL context each: the probe in `shared/backend.js` gave its context back with `loseContext()` and the guard counted it | The probe is released through the guard and is not a loss. |
| Every other page | At most 60 MB, 3.8 megapixels, 3 WebGL contexts | The same. |

After the change, 75 of 76 pages pass. `/hdr-glow/` fails `timedReadbacks` until pull request 75 merges.

Open pull requests, measured the same day with the new guard copied into each branch:

| Pull request | Pages | Result |
|---|---|---|
| 69 | `/select-ideas/`, `/input-ideas/` | Pass. |
| 70 (merged) | `/scoped-transitions/` | Passes: 1 WebGL context, 17 MB. |
| 71 | `/imgui-dom/`, `/flutter-dom/`, `/godot-dom/`, `/qt-widgets-dom/` | The measured limits pass. `check:gfx` fails on `flutter-dom/bridge.js`, `flutter-dom/main.js`, `godot-dom/bridge.js` and `godot-dom/main.js`: they ask for the WebGL context that the framework made, and two live checks read a pixel inside `requestAnimationFrame()`. Each needs a `gfx-allow` comment with the reason, or the readback moved out of the frame callback. |
| 72 | `/instruments/` | Passes: no WebGL, 3.2 MB, checks wait for a tap. |
| 73 | `/selection-peers/`, `/selection-glyphs/`, `/redact/`, `/selection-heat/`, `/share-card/` | Pass. `/selection-heat/` has a 3.6 megapixel canvas, close to the limit of 4. |
| 75 | `/hdr-glow/` | Passes: no readback until a button is pressed. |

Every branch from before this change also fails `check:gfx` in the files this change fixed, until it merges main.

## What the guard does at run time

- Counts WebGL contexts and frees those of removed canvases before the limit is reached (from pull request 63).
- `window.__gfx.retire(canvasOrElement)` marks canvases as finished with. Once such a canvas has been out of the page for 0.2 s, a WebGL context is given back and any other canvas is set to 0 by 0. `runTests()` in `/shared/support.js` retires every check fixture, and `swapCanvas()` in `/lib/surface.js` retires the canvas it replaces.
- Over the budget, it frees every canvas that was removed from the page 2 s ago or more, and warns in the console if the page is still over.
- Logs readbacks. A readback from a GPU canvas with no tap in the last 5 s (`navigator.userActivation.isActive`) and no live check running (`window.__checkState === 'running'`) is unasked. Unasked readbacks in four different seconds give a console warning.
- A canvas that loses its context three times in 30 s is being lost by what the page draws. The guard stops `paint` events on the page with a capture listener on the window, and puts a note over the canvas. Without this, the page redrew after every restore and lost the context again, about every 1.5 s on `/hdr-glow/`.
- The note over a lost canvas now also gives the memory estimate, the readback counts, and for each loss the readbacks in the second before it. Losses at the same moment are one entry ("7 2D at 3.1 s").

### The record

The guard writes one line to `sessionStorage` under `gfx-visit` while a page is showing: the path, the time, and the summary above. `pagehide` and a hidden tab mark it closed. A page that loads in the same tab and finds an open record, or a record with losses, shows it in a bar at the bottom of the window with Copy and Dismiss buttons. A tab that went white and was reloaded shows what the page before held and lost. Tested with `Page.crash` in the test browser. Not verified on the phone: whether `sessionStorage` keeps the last write when the renderer is killed there.

### Reports and the hold after a crash

The guard sends each loss, each stopped loop, script errors and a tab that died to `/api/reports`, filed by origin and page. `npm run reports` prints them. A page loaded within ten minutes of the same page dying in the same tab starts with its `paint` events held and a bar with "Draw anyway". Both are described in [crash-reports.md](crash-reports.md).

`/canvas-loss/` runs twenty 2D operations one at a time (a paint on every frame, `ctx.reset()`, a draw at alpha 0, shadow, filter, source-rectangle draws, resizing, twelve canvases, a nested drawable, `willReadFrequently` fixtures, GPU readbacks, snapshots never closed, a float readback) and reports which one loses a canvas or the tab. It is the way to identify the cause on the phone for the pages with only 2D canvases. Results are in `findings/canvas-loss.md`.

## Not verified, needs the phone

- That a float readback from a `willReadFrequently` copy does not lose the canvas (`/canvas-loss/`, trial `float-copy`).
- The cause on `/instruments/` and `/scoped-transitions/`. Send the text of the note or of the bar.
- That 96 MB and 4 megapixels are low enough. They were chosen from what the pages use, not from a measured loss.
- That stopping `paint` events after three losses keeps the tab alive.
- That setting a removed 2D canvas to 0 by 0 frees its GPU memory at once on Android.

## Open work

- `/time-scrubber/` keeps more than 100 `captureElementImage()` pictures open as its rewind buffer (116 measured at the test size, recorded as an exception). Not verified on the phone: how much GPU memory that is and whether it loses the canvas. `/offscreen/` and `/transports/` were found by the same count: `/offscreen/` transfers its pictures to a worker, which the guard now counts as handed over, and `/transports/` now closes the 15 it left open.

- `tools/gfx/known.json`: ten libraries make one WebGL context per element. Moving them to one shared context would take `/shader-css/` and `/slot-effects/` from 7 and 8 contexts to 1.
- `/hdr-glow/` still has its own WebGPU device in one live check. `checkDevice()` replaces it.
