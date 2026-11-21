# Transport lab 2: newer transport APIs (`/transports-2/`, `lib/freeze-log.js`)

Demo 18 (`transport-2`) of the Chrome APIs plan.

Page `/transports-2/`, Chromium 157 headless, 2026-11-21. Rows run when a button is pressed and each row removes its canvas before the next starts.

| Route | Result | Detail |
|---|---|---|
| WebRTC at 40 kbit/s, default `degradationPreference` | works, shrunk | A 960×540 element arrives as 320×180; `qualityLimitationReason` is `bandwidth`. |
| WebRTC at 40 kbit/s, `maintain-framerate-and-resolution` | works | Arrives as 960×540. The page has to lower the frame rate itself. |
| `encodings[0].scaleResolutionDownTo = { maxWidth: 320, maxHeight: 180 }` | works | The canvas stays 960×540 and the far end decodes 320×180. |
| `VideoFrame.metadata().rtpTimestamp` on received frames | works | Read through `MediaStreamTrackProcessor`; 90 kHz clock. |
| `track.stats` on a `canvas.captureStream()` track | fails | `undefined`. The frame counters exist only on camera and screen tracks. |
| `RTCDataChannel` transferred to a worker | works | Transfer it inside the `datachannel` event, before anything is sent. |
| `SharedArrayBuffer` on a normal page | fails | Expected: not cross-origin isolated. |
| `SharedArrayBuffer` in a frame served with `Document-Isolation-Policy: isolate-and-credentialless` | works | A worker reads the pixels in place after `Atomics.notify`. The embedding page stays non-isolated, a frame from the other origin still loads inside the isolated frame, and an `ImageBitmap` posted out of it arrives intact. |
| `Uint8Array.prototype.toBase64()` / `fromBase64()` | works | PNG bytes as text over a BroadcastChannel. |
| WebTransport datagrams | fails | No server: the Cloudflare Workers documentation lists no WebTransport endpoint. `?wt=<url>` points the row at another server; the row has never run against one. |

Not run:
- **Element Capture.** `getDisplayMedia({ preferCurrentTab: true })` is accepted with `--auto-accept-this-tab-capture` but fails with `NotReadableError: Could not start video source` in both test browsers, headless and under Xvfb. The three rows (a plain element, a drawable canvas, an element that is a child of a drawable canvas) need a desktop Chrome and a person.
- **Freezing.** `Page.setWebLifecycleState({ state: 'frozen' })` changes nothing in either test browser: timers keep running, frames keep arriving at a viewer, and no `freeze` event fires. The page has a freeze test (timer, `paint` events, dedicated worker, SharedWorker, WebSocket: longest stop for each) that needs a phone hidden for 90 seconds. `lib/freeze-log.js` records `freeze`, `resume` and timer gaps, and `/remote/` and `/cross-tab/` show how long they were stopped.

## Not verified

- Element Capture of a plain element, a drawable canvas and a child of a drawable canvas. Tab capture fails to start in C157 and C153 (`NotReadableError`), headless and under Xvfb. The Element Capture button on `/transports-2/` in desktop Chrome would verify it.
- What stops while a tab is frozen. The DevTools lifecycle command does not freeze a tab in either test browser. The freeze test on `/transports-2/` on a phone, with the tab hidden for 90 seconds, would verify it.
- WebTransport against a real server. `?wt=<url>` points the row at one.

## For the index

- Across workers, tabs, origins and devices: At 40 kbit/s WebRTC shrinks a 960×540 element to 320×180. `degradationPreference: 'maintain-framerate-and-resolution'` keeps it at 960×540. measured, C157, `/transports-2/`.
- Across workers, tabs, origins and devices: A frame sent with `Document-Isolation-Policy` gets `SharedArrayBuffer` while the page around it stays non-isolated. measured, C157, `/transports-2/`.
