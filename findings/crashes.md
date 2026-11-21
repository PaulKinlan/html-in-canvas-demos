# Crashes and lost canvases recorded so far (`/crashes/`)

State on 2026-11-21. "Measured" entries are from C157 (headless, software rendering). "Reported" entries are from A159 (Chrome 159 on Android, the project owner's phone).

The page is the list. Its entries are data in `public/crashes/cases.js`, one object each, and a new crash is added there. This file does not repeat them.

| Question | Result |
|---|---|
| How many entries? | 13: 8 crashes of the tab or renderer (2 not related to HTML-in-canvas), 4 losses of canvas contexts, 1 blank canvas. |
| How many have a page that isolates them? | 3: `/canvas-loss/` (a `willReadFrequently` drawable canvas), `/view-transitions/crash.html`, `/transports/crash-adopt.html`. |
| Does the page count matching reports from devices? | Measured in C157 against the deployed log: each entry that names report types shows a count, with headless browsers left out (`real=1`). |

## Things that bit

- A report count must not include the test browser, which also sends reports. `/api/reports` takes `real=1`, which leaves out user agents that contain "Headless".

## Not verified

- Every "reported" entry on a second device.
- That any entry is a browser bug and not intended behaviour. None has been filed.
- That Chrome on Android sends `crash` reports for a dead tab to this site. None had arrived by 19:30 UTC on 2026-11-21.

## For the index

- Chromium bugs: the list of crashes and context losses, with steps and evidence, is `/crashes/` (`public/crashes/cases.js`). New entries there on 2026-11-21: a `willReadFrequently` drawable 2D canvas loses every 2D context on A159; a float16 `getImageData()` loses every float16 2D context on A159.
