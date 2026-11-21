# Which 2D operation loses the canvas (`/canvas-loss/`), crash reports (`/api/reports`) and the guard's hold

Measured in C157 (headless, software rendering) on 2026-11-21, unless a row says otherwise. Nothing here has been run on A159.

## Why the page exists

Pages with only 2D canvases lost their canvases or the tab on the test phone: `/instruments/`, `/scoped-transitions/`, and the five text pages of pull request 80. Their sizes are small (at most 9.7 MB and 1.7 megapixels, measured with `check:jank`), so the size budget does not explain it. The cause is not identified. `/canvas-loss/` runs one suspect at a time on the device that has the problem.

| Trial | What it isolates | C157 |
|---|---|---|
| `once` | A drawable 2D canvas drawn once | no loss |
| `loop` | `requestPaint()` on every frame | no loss |
| `reset` | `ctx.reset()` in every paint | no loss |
| `alpha0` | `drawElementImage()` at `globalAlpha` 0 | no loss |
| `shadow` | `shadowBlur` around the element | no loss |
| `filter` | `ctx.filter` blur around the element | no loss |
| `pieces` | 40 source-rectangle draws per paint | no loss |
| `resize` | `canvas.width` assigned on every frame | no loss |
| `twelve` | 12 drawable canvases painting at once | no loss |
| `nested` | A drawable canvas inside a drawable element | no loss |
| `wrf` | A `willReadFrequently` drawable canvas, read once | no loss |
| `fixtures` | 12 check fixtures in a row, retired | no loss |
| `fixtures-kept` | 12 check fixtures in a row, not retired | no loss |
| `gpu-read` | `getImageData()` from an accelerated drawable canvas, 12 times | no loss |
| `snapshots` | 60 `captureElementImage()` pictures never closed | no loss |
| `float` | One `getImageData()` with `pixelFormat: 'rgba-float16'` | no loss |
| `copy-read` | Pixels read from a `drawImage()` copy in a plain `willReadFrequently` canvas, 12 times | no loss |
| `wrf-guarded` | `willReadFrequently` asked for on a drawable canvas and removed by the guard | no loss |
| `fixtures-guarded` | 12 check fixtures in a row with the guard's fix | no loss |
| `float-copy` | The float canvas copied with `drawImage()` to a `willReadFrequently` float16 canvas, and the copy read | no loss |

## Reported from the phone

| Page | Report (A159, 2026-11-21) |
|---|---|
| `/hdr-glow/` on production, after pull request 75 removed the timed readback | The page's own message: "The float16 canvas lost its context on this device (right after a float readback with getImageData(), 5.3 s after load)". The "Map of values above 1.0" option was selected, which reads the whole canvas as float pixels. So one float readback made by a tap is followed by the loss, as the timed ones were. Reported, one occurrence. |

| `/canvas-loss/` on production, "Run every trial", Chrome 159, Android 10 | `once`, `loop`, `reset`, `alpha0`, `shadow`, `filter`, `pieces`, `resize`, `twelve`, `nested`: no loss, 240 to 242 paints in 4 s each. `wrf`: "10 lost: the canvas that stays, a canvas of the trial at 35 ms, at 548 ms, at 1075 ms", pixel read 255,247,230,255. Guard log: "2 2D at 58.2 s after getImageData 1 px 9 ms before; 2 2D at 58.7 s; 2 2D at 59.2 s; 59.8 s; 60.3 s; 60.8 s. Drawing stopped by the guard." `fixtures`: "no loss, 0 had a drawn pixel" in the report log, which is not valid because the guard had stopped `paint` events. The pasted text said "TAB STOPPED" for it because it was copied while a trial was running; the tab did not stop. The rest are not valid for the same reason. The same rows arrived at `/api/reports` as type `trial`. |

Conclusion: a drawable 2D canvas made with `willReadFrequently: true`, after one `drawElementImage()` and one `getImageData()`, loses every 2D context on the page on that phone, and they are lost again every half second while it exists, with no further call from the page. Separated later by `/crashes/repro/readback-matrix.html` (A159, reported, 19:52 UTC, a page load for each case, no site scripts): `willReadFrequently` with `drawElementImage()` loses both canvases with or without a read (first loss 8 ms and 22 ms after the call, then about every 510 ms). Ten cases without the option lost nothing: draw only, `getImageData()` after `fillRect()` on a drawable and on a plain canvas, `getImageData()` right after `drawElementImage()` and 1 s later, a read from a `drawImage()` copy in a plain and in a `willReadFrequently` canvas, `toDataURL()`, `createImageBitmap()`, `captureElementImage()`. The guard now removes the option from drawable canvases. Trials added after this result: `copy-read`, `wrf-guarded`, `fixtures-guarded`. The three raw trials are left out of "Run every trial" and keep the option with `data-gfx-raw`.

### Second run on production, 20:03 UTC on 2026-11-21 (Chrome 159, Android 10)

Reported through `/api/reports`, visit `0e3owys7mwqu4054`, with the guard of pull request 84. Ten trials (`once` to `nested`) ended with "no loss". `gpu-read` (a drawable canvas with no options in a paint loop, `getImageData()` of one pixel every 300 ms) ended "lost": 12 `contextlost` events, on the trial's canvas and on the canvas that stays, 7 ms after the second read, 3 ms after the fourth and 4 ms after the sixth, about 600 ms apart. 110 paints in 4 s where the other trials had 240. The guard stopped `paint` events after the third loss and the run ended there, so `copy-read`, `snapshots`, `wrf-guarded`, `fixtures-guarded` and the float trials have still not run on the phone.

Changes that follow from it: the guard answers `getImageData()` on a drawable canvas from a `drawImage()` copy; "Run every trial" loads the page once for each trial so that a loss cannot end the run; `gpu-read` keeps its direct read with `data-gfx-raw`, and `gpu-read-guarded` makes the same calls through the guard. In headless Chromium 157 all 21 trials end "no loss" in a chained run (measured 2026-11-21).

The run before it, at 20:01 UTC, was the page from before pull request 84 deployed: `wrf` lost 10 contexts, the first 6 ms after the read.

### Third run on production, 20:20 UTC on 2026-11-21 (Chrome 159, Android 10), a page load for each trial

Reported through `/api/reports` with the guard of pull request 93. All 21 trials ran.

| Trial | Result |
|---|---|
| `once`, `loop`, `reset`, `alpha0`, `shadow`, `filter`, `pieces`, `resize`, `twelve`, `nested` | no loss, 240 to 242 paints in 4 s |
| `gpu-read` (direct reads, guard bypassed) | lost: 12 events, first 5 ms after the second read, 109 paints |
| `gpu-read-guarded` (the same calls through the guard) | no loss, 12 of 12 reads answered from a copy, 216 paints |
| `copy-read` | no loss, 12 copies read |
| `snapshots` | no loss, 60 pictures kept open |
| `wrf-guarded`, `fixtures-guarded` | no loss; the context reports `willReadFrequently` false; 12 of 12 fixtures had a drawn pixel |
| `float-copy`, `float` | no loss; read 1.00, 0.20, 0.10, 1.00 |
| `wrf` (guard bypassed) | lost: 10 events, first 9 ms after the read |
| `fixtures` (guard bypassed, freed) | lost: 11 events, 6 of 12 fixtures had a drawn pixel |
| `fixtures-kept` (guard bypassed, not freed) | lost: 86 events, 5 of 12 fixtures had a drawn pixel |

So both guard fixes hold on the phone, and one float16 read of a canvas that drew no element loses nothing there. The tab did not die in any trial. No `crash` or `tab-died` report arrived.

## Reports

| Question | Result |
|---|---|
| Does `POST /api/reports` store a Reporting API batch (`application/reports+json`) and a guard beacon (`text/plain`)? | Measured with `wrangler dev` 4.166 and local D1: both answer 204 and the rows are returned by `GET /api/reports`. A report whose `url` is not a host of this project is dropped. |
| Are origins kept apart? | Measured locally: a report about a preview host and one about the production host are listed under separate origins by `npm run reports`. |
| Does the guard send a lost context, a script error, a rejected promise and a tab that died? | Measured in `tools/gfx/test-guard.mjs` against a local collector. |
| Does a page that died hold its drawing on the next load? | Measured with `Page.crash` in `tools/gfx/test-guard.mjs`: after the reload no `paint` event reaches the page until "Draw anyway" is pressed. |

## Things that bit

- A preview is a static copy with no Worker, so `/api/reports` does not exist there. Every copy of the site posts to `https://html-in-canvas.page/api/reports`, and the row's origin comes from the report's own `url`.
- `navigator.sendBeacon()` with a `text/plain` Blob needs no CORS preflight. `application/json` does.
- A report sent from a script in a page loaded by Playwright counts every `evaluate()` as a tap. The trials do not depend on that.

## Not verified

- On A159: the trials after `wrf` in the first run (`gpu-read`, `copy-read`, `snapshots`, `wrf-guarded`, `fixtures-guarded`, `float-copy`, `float`). Open `/canvas-loss/` on the phone and press "Run every trial". The results arrive at `/api/reports` as type `trial`.
- That Chrome on Android sends a `crash` report (`reason: "oom"` or `"unresponsive"`) to `Reporting-Endpoints` for a tab that dies. To verify: after a white tab on the phone, `npm run reports -- --type crash --list`.
- That `sessionStorage` and `localStorage` keep the last write when the renderer is killed on Android. The `tab-died` report and the "tab stopped" row depend on it.
- That holding `paint` events after a crash keeps a crashing page alive on the phone. A page that dies from a WebGL or WebGPU frame loop is not stopped by it.
- The live endpoint. It exists only after this change is deployed from `main`.

## For the index

- Canvas loss: `/canvas-loss/` isolates twenty 2D operations. A159 (reported): a `willReadFrequently` drawable canvas that is drawn into and read once loses every 2D context, repeatedly; ten other operations do not. C157: no loss.
- Tooling: `npm run reports` lists crash and error reports by origin and page.
