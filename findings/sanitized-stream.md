# Sanitised HTML, cross-shadow selection and Temporal snapshots (`/sanitized-stream/`)

Created on 2026-11-22. Live browser results are not verified yet in headless Chromium 157 (C157) or on the test phone (A159); the page ships six isolated live checks that measure each API in the visitor's browser.

| Question | Status | Notes |
| --- | --- | --- |
| `Element.setHTML()` into a `drawable` 2D canvas child | not verified | Inserts untrusted markup (mixing `<script>`, `<img onerror>`, `<iframe src="javascript:...">`, inline `onclick`, and safe headings/links/buttons) via `el.setHTML()` and checks that zero payloads run while the sanitised DOM paints and stays interactive. |
| Custom `Sanitizer` options (`removeElement` / `removeElements`) | not verified | Toggles `<b>`, `<a>` and `<button>` removal through `new Sanitizer()` (with a `SanitizerConfig.removeElements` fallback) and computes a live removed vs kept diff against an inert `DOMParser` parse. |
| `getSelection().getComposedRanges({ shadowRoots })` across a shadow-root drawable canvas | not verified | Compares `getRangeAt(0)` against `getComposedRanges({ shadowRoots: [shadow] })` on a passage that crosses into `<shadow-sel-box>`'s open shadow root and paints a glowing ribbon across the shadow text lines. |
| `selection.direction` across a shadow boundary | not verified | Checks `forward`, `backward` and `none` when extending a selection into or out of the shadow root. |
| `Temporal.Now.instant()` and `Temporal.Now.zonedDateTimeISO()` on `captureElementImage()` snapshots | not verified | Stamps up to 4 frozen `ElementImage` frames in a filmstrip drawn before the live editable note card, measures inter-frame deltas with `instant.since(prev)`, and calls `close()` on every evicted snapshot and on `pagehide`. |

## Things that bit

- `getComposedRanges()` returns `StaticRange` objects, which have no `getClientRects()` method, and a single live `Range` cannot span a shadow boundary. Projecting the composed start and end onto per-text-node `Range` instances inside the shadow root gives accurate line boxes for the canvas ribbon.
- Drawing `ElementImage` filmstrip frames after the live note card moves the hit box away from the live controls. Drawing the frozen thumbnails first and the live card last keeps typing and button presses aligned on a single 2D canvas.
- Computing the removed vs kept diff on untrusted input cannot use a live element without risking script execution or image fetches. Parsing the raw string through `new DOMParser().parseFromString(raw, 'text/html')` keeps the diff inert.

## Not verified

- Running the six live checks in headless Chromium 157 (`npm run check:jank -- --checks /sanitized-stream/` and `node tools/draw-size/audit.mjs /sanitized-stream/`) to record measured pass/fail results, `openSnapshots`, draw-size accuracy at 2.625x scale, and zero layout shift.
- Touch selection handles across the shadow boundary and 2D canvas context retention on Chrome 159 for Android at 412 px wide.

## For the index

- Primitives (`/sanitized-stream/`): tests `Element.setHTML()`, `getSelection().getComposedRanges()`, `selection.direction`, and `Temporal.Now` timestamps on `captureElementImage()` snapshots (not verified yet in C157 / A159).
