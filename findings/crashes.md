# Crashes and lost canvases recorded so far (`/crashes/`)

State on 2026-11-21. "Measured" entries are from C157 (headless, software rendering). "Reported" entries are from A159 (Chrome 159 on Android, the project owner's phone).

The page is the list. Its entries are data in `public/crashes/cases.js`, one object each, and a new crash is added there. This file does not repeat them.

| Question | Result |
|---|---|
| How many entries? | 13: 8 crashes of the tab or renderer (2 not related to HTML-in-canvas), 4 losses of canvas contexts, 1 blank canvas. |
| Which entries have a standalone page (`/crashes/repro/<id>.html`, one file, no libraries, no site scripts)? | Ten. Run in C157 on 2026-11-21 by pressing each button in a new browser: |
| `view-transition-drawable-child` | A crashes the renderer, B (child without the attribute) does not. |
| `iframe-in-paint` | B (remove an iframe child inside `paint`) crashes. A (insert) and C (after a timer) do not. |
| `adopt-painted-canvas` | A (painted first) crashes, B does not. |
| `opacity-in-drawn-iframe` | A (`opacity: .02`) crashes, B (`visibility: hidden`) does not. |
| `speech-available` | Crashes on the call. |
| `lose-context-drawable` | No crash with any button. The fuller pages that crashed have something this page lacks. |
| `h264-software-encoder` | 30 chunks, no crash. |
| `ninth-webgl-context` | Context 1 is lost when context 17 is made (desktop limit). |
| `frequent-read-drawable`, `float-readback` | No loss in C157, as on every page there. Not opened on A159 yet. |
| Does the page count matching reports from devices? | Measured in C157 against the deployed log: each entry that names report types shows a count, with headless browsers left out (`real=1`). |

## Things that bit

- A report count must not include the test browser, which also sends reports. `/api/reports` takes `real=1`, which leaves out user agents that contain "Headless".

## Not verified

- Every "reported" entry on a second device.
- The standalone pages for `frequent-read-drawable` and `float-readback` on A159. They run without the guard, so they show what the browser does with nothing removed.
- That any entry is a browser bug and not intended behaviour. None has been filed.
- That Chrome on Android sends `crash` reports for a dead tab to this site. None had arrived by 19:30 UTC on 2026-11-21.

## For the index

- Chromium bugs: the list of crashes and context losses, with steps and evidence, is `/crashes/` (`public/crashes/cases.js`). New entries there on 2026-11-21: a `willReadFrequently` drawable 2D canvas loses every 2D context on A159; a float16 `getImageData()` loses every float16 2D context on A159.
