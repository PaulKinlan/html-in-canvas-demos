# Capture additions: clipboard, print margins, folders (`/capture/`, `lib/element-capture.js`)

Measured in headless Chromium 157 on 2026-11-21. Three rows in the page's element tests repeat them.

| Experiment | Result | Why |
|---|---|---|
| `copyElement(el, { html: true })`: PNG, HTML and text in one `ClipboardItem` | works | `navigator.clipboard.read()` returns all three types. The PNG is passed as a promise so the write starts inside the tap. |
| `printElement(el, { header, footer })` with `@page` margin boxes | kept | The print document's `CSSPageRule` holds all three boxes, with `counter(page)` and `counter(pages)`. Not checked on paper. |
| `saveToFolder()` into a folder handle, `watchFolder()` with `FileSystemObserver` | works | Run on the origin private file system, which has the same handle API. A change is reported 1 to 5 ms after the write; the tile for a changed HTML file was redrawn 23 ms after the write. |
| A folder of HTML files as tiles in a canvas, each saved back as a PNG | works | Each file is the `srcdoc` of an `<iframe sandbox="allow-same-origin">`. |

- Read `outerHTML` before the capture starts. During a capture the element carries a `drawable` attribute and inline size overrides, and they end up in the copied markup otherwise.
- An `<iframe sandbox>` with no `allow-same-origin` has an opaque origin and is left out of the canvas picture, like any cross-origin frame.
- `FileSystemObserver` reports one record per write step and names the temporary `.crswap` file too; `watchFolder()` filters those.
- The test browser's `MediaRecorder` writes VP8, VP9, AV1 and H.264 and has no HEVC encoder. `recordFormats()` lists what a browser can record.
- Not verified: `showDirectoryPicker()` and `FileSystemObserver` on Android, and a printed page.
