# Crash and error reports

Written 2026-11-21. Canvases and tabs kept being lost on the test phone (Chrome 159, Android) with nothing to say why: the page was white, or the note was gone before it could be read. Every copy of the site now sends what happened to one endpoint, and a script prints it.

## Read the reports

```
npm run reports                          # the last 24 hours, grouped by origin, page and type
npm run reports -- --since 2h --list     # each report with its detail, newest first
npm run reports -- --origin preview      # every preview branch
npm run reports -- --origin project-thread-5xa7g6 --list   # one branch (any part of the host name)
npm run reports -- --origin production --page /hdr-glow/ --list
npm run reports -- --type crash --list   # tabs the browser itself reported dead
```

The options are in the comment at the top of `tools/reports/list.mjs`. The same data is JSON at `https://html-in-canvas.page/api/reports?since=2h&page=/hdr-glow/` and `/api/reports/summary`.

Rule: after the project owner has opened a page on the phone and said that something is wrong (or said nothing yet), run `npm run reports -- --since 2h --list` for the origin he used, before replying and before changing code. Quote the report in the reply. If there is no report for the page, say so: that is a result too (the page was not opened on that origin, or the report could not be sent).

## What is sent

| Type | Sent by | When |
|---|---|---|
| `crash` | The browser (Reporting API) | A tab died. The body has `reason`: `oom` or `unresponsive`, when the browser knows. Sent by the browser process some time later, so it survives the death of the page. |
| `tab-died` | The guard | A page load found that the page before it in the same tab never closed. Filed under the page that died. The body has that page's last summary (contexts, memory, readbacks, losses). |
| `context-lost` | The guard | A trusted `contextlost` or `webglcontextlost` event on any canvas. The body has the canvas size, the readbacks in the second before, and the summary. |
| `draw-stopped` | The guard | One canvas lost its context three times in 30 seconds and the guard stopped `paint` events. |
| `draw-anyway` | The guard | "Draw anyway" was pressed on a page whose drawing was held after a crash. |
| `error`, `unhandledrejection` | The guard | An uncaught exception or a rejected promise with no handler. The body has the file, line and the first lines of the stack. |
| `intervention`, `deprecation` | The browser, and the guard through `ReportingObserver` | The browser blocked or changed something the page did, or the page used a deprecated call. |
| `csp-violation` | The browser | A script or a frame was loaded from plain http. The policy is report-only and blocks nothing. |
| `over-budget`, `timed-readback`, `snapshots-open` | The guard | The page broke a measured graphics rule on the device. |
| `trial` | `/canvas-loss/` | The start and the outcome of each trial. A start with no outcome is a tab that died in that trial. |

Each row has the time, the origin and path of the page, the type, a message, a JSON body, the user agent, and a visit id that is the same for every report of one page load. A report from a frame has `(frame)` after its path. No address and no cookie is stored. Rows are deleted after 30 days.

The guard sends at most 80 reports for one page load and 3 with the same type and message. It sends nothing from `localhost`. A page can add its own with `window.__gfx.report(type, message, body)`.

## How it is built

- `public/_headers` gives every page `Reporting-Endpoints` and `Report-To` with one endpoint named `default`, and a report-only content security policy.
- `/shared/context-guard.js` sends its reports with `navigator.sendBeacon()` as `text/plain`, which needs no preflight.
- `src/reports.js` is the endpoint: `POST /api/reports`, `GET /api/reports`, `GET /api/reports/summary`. It stores rows in the D1 database `html-in-canvas-reports` (binding `REPORTS` in `wrangler.jsonc`) and makes the table itself on first use.
- A preview is a static copy with no Worker. So every copy of the site, previews included, posts to `https://html-in-canvas.page/api/reports`, and the origin of a row is taken from the page URL inside the report. The endpoint drops a report whose page is not on a host of this project.
- Reading is open to anyone. The rows describe pages of a public site.

To try it locally: `npm run dev`, then `npm run reports -- --from http://localhost:8787`. A page on localhost sends only if `window.__gfxReportTo = '/api/reports'` is set before the guard loads.

## The loop after a crash

Chrome on Android reloads a tab that died when it is shown again. A page that kills the tab on load then kills it on every reload. The guard now breaks that loop: a page loaded within ten minutes of the same page dying in the same tab starts with its `paint` events stopped. A bar at the bottom says that the page stopped without closing, how long ago and how many times in a row, with "Draw anyway", "Copy" and "Dismiss". `window.__gfx.held` is true while drawing is held.

This holds drawing that happens in `paint` handlers. A page that dies from a WebGL or WebGPU frame loop, or from script that is not drawing, is not stopped by it.

## Not verified, needs the phone

- That Chrome 159 on Android sends `crash` reports for this site. The test browser does not send them when a page is killed with `Page.crash`.
- That `sessionStorage` keeps the guard's last write when the renderer is killed on Android. `tab-died` and the hold depend on it.
- That holding `paint` events stops the reload loop that was seen. The loop itself was not reproduced in the test browser.
- The deployed endpoint. It was measured with `wrangler dev` and a local database on 2026-11-21.
