# Cross-context: tear-off, remote, embed, support

Verified in headless Chromium 157 on 2026-11-20, with two local Workers as two origins. Pages: `/tear-off/`, `/remote/`, `/embed/`, `/support/`. Not yet run in a real browser, on a real phone, or in Safari and Firefox (the viewer pages are written not to need the API).

The building block is `live-surface.js`: any element gets a shadow root holding `<canvas content="drawable"><div drawable><slot></slot></div></canvas>`, so its children stay in the light DOM and are painted through the canvas.

| Experiment | Result | Why |
|---|---|---|
| Convert an existing element in place (`attachSurface(el)`) | works | Children do not move in the DOM or on screen. Grid and flex hosts need their layout properties copied to the inner box. |
| Children of a drawable canvas fill its width like blocks | fails | They are shrink-to-fit. The inner box needs `width: 100%`. |
| Canvas backing store at 2x on a 1x screen | works | The DOM is re-rasterised sharp, not scaled. `drawElementImage()` then needs an explicit width and height, because the default is the snapshot's pixel size. |
| Two renderings of one element in one `paint` | works | Draw 1:1, `drawImage()` the canvas to a second canvas, `reset()`, draw the effect. The copy is the clean, shareable frame. |
| Redaction by selector | works | Rects of `[data-private]` and password inputs are filled on the copy only. The local canvas is untouched. |
| `captureStream()` on the copy (a canvas not in the document) | works | Feeds `<video>`, video Picture-in-Picture and WebRTC. |
| First `paint` always has a snapshot | fails | It can arrive before the element has a paint record, and nothing triggers another. Ask again until one succeeds. |
| A frame scrolled out of view keeps painting | fails | No `paint`, so nothing to send. Same for a hidden tab. |

Tear-off (`/tear-off/`, 11 routes, each clicked through with a real popup):

| Route | Result | Notes |
|---|---|---|
| `window.open` + MessagePort, pixels out and input back | works | Same origin and cross-origin. |
| `about:blank` popup scripted by the opener | works | No messages: direct calls, ImageBitmaps passed by reference. |
| Move the real element into the popup (`popup.document.body.append(el)`) | works | Listeners, timers and input values survive. Closing the popup brings it home. Needs a window reference and the same origin. |
| A moved element painted by a canvas in its new document | works | So the destination can stream it onward. |
| Document Picture-in-Picture, streamed or with the real DOM | works | `requestWindow()` works in headless. |
| Video Picture-in-Picture | works | View only. Media Session actions are mapped to the widget's buttons; not checked visually. |
| `noopener` tab over BroadcastChannel | works | ImageBitmaps are cloned. Input comes back on the same channel. |
| `noopener` tab over a SharedWorker-brokered MessagePort | works | |
| `noopener` tab, same or other origin, over the Worker relay and WebRTC | works | The only route that crosses browsers and devices. |
| `localStorage` events carrying a JPEG data URL | works | Not recommended. |
| Other origin, no link, bridge frame from the source origin using BroadcastChannel | works here | Also worked with `localhost` and `127.0.0.1` as the two sites. Chrome's storage partitioning is expected to block the cross-site case; check in a real browser. |
| Adopt a whole painted `<live-region>` into another document | works | Did not reproduce the earlier `adoptNode()` crash in this shape. Kept behind a button. |

Remote (`/remote/`): WebRTC video plus a data channel for input, signalled through a Durable Object room, works between two browser contexts including an emulated phone. Relayed JPEGs through the room work when WebRTC is refused. Phone keyboards send `input` events rather than keys, and a `<select>` popup cannot be streamed, so the viewer raises its own keyboard and its own native picker. Both are tested with synthetic events, not a real phone. No TURN server is configured.

Embed (`/embed/`):

| Experiment | Result | Why |
|---|---|---|
| Host draws a cross-origin card through a WebGL shader and clicks land | works | The shader's screen-to-source function is repeated in JS for the pointer. |
| Host restyles the card | works, by contract | The card accepts five custom properties and ignores everything else. |
| Host resizes the card | works | The card reflows in its own document. |
| Fallback content of the host canvas as an accessible proxy | works | Buttons and fields rebuilt from the card's element map. Not tested with a screen reader. |
| Card lends its canvas; host draws; the card's real button is clicked natively | works | Hit testing follows the host's last `drawElementImage()`. That is a clickjacking surface the embed opts into. |

Support (`/support/`): a region picked by the user reaches an agent console as video, with the agent's pointer drawn on the user's canvas and control refused until the user allows it. The model variant sends a JPEG and the element list to Workers AI. Checked once by hand against the API with a real 260 px frame: Mistral Small 3.1 answered correctly in about 1 s, Llama 4 Scout in about 12 s, and Gemma 4 returned an empty answer. The Worker endpoint itself has not run with the AI binding yet (local dev has none).

## Portable widgets (`/slot-view/`, `lib/slot-view.js`, `lib/slot-provider.js`)

`<slot-view src name>` shows a named piece of another site's page with no iframe box, and the providing site asks the person before anything leaves. The protocol is written down in `public/slot-view/PROTOCOL.md`.

| Experiment | Result | Notes |
| --- | --- | --- |
| A cross-origin piece sized by its content, on the text baseline of a sentence | works | The provider reports its size and the distance from its first baseline to its bottom edge; the element sets `vertical-align` to match. |
| Text wrapping round the piece's outline | works | `shape-outside: url(…)` built from the alpha of the frames. The browser lays a shape image out at its own pixel size, so it must be made exactly as many pixels as the element has CSS pixels. |
| Canvas shrinking to its content | fails, worked around | A drawable canvas has no intrinsic width, so `width: max-content` on its host gives nothing useful. The provider measures the region's one child and sets the width in pixels. |
| No pixel or element map before consent | works | Every protocol message before the grant is refused. |
| Consent that the embedder cannot fake | works | The question is drawn in the provider's real frame, never in the pictures, and only a trusted click answers it. `IntersectionObserver` v2 (`trackVisibility`) turns Allow off when the embedder fades, filters or covers the frame. |
| Consent in a window on the provider's origin (for inline or small embeds) | works | The window has to find the waiting frame by itself. `opener.frames` does not list it, because frames inside a shadow root are left out of `window.frames`. `window.open('', name)` with the frame's window name does find it, and same-origin access then works even though the frame's storage is partitioned. A BroadcastChannel is the third try; not needed in Chromium 157. |
| Consent window opened by the frame itself | works | When Allow is switched off, the prompt offers this. The click in the frame gives it the activation to open a window. |
| View and input granted separately; public view-only slots | works | A slot marked `slot-consent="none"` arrives with no prompt and refuses input. |
| A guarded button (`data-trusted`) pressed by forwarded input | refused, as designed | The provider asks the person to confirm in its frame or window. The embedder can dismiss the question but cannot answer yes. |
| Grant remembered per embedding site | works | Kept in the frame's `localStorage`, which the browser already partitions by top-level site. |
| Theme contract | works | Custom properties on the provider's list are applied; the rest are reported back as ignored. |
| Provider without HTML-in-canvas | falls back | The element shows the frame as it is. |

Found on the way: `serve()` dropped a frame that arrived while the previous one was being packed, so a viewer could be left with a blank default-sized first picture until the next change. It now sends once more when that happens, and never sends before the first paint.

Not tested: real cross-site storage partitioning (headless Chromium on two localhost ports is same-site), so the window-name route needs a look on the two deployed Workers. Android opens the consent window as a tab; untested on a real phone.

## Picture-in-picture for any element (`/pip/`, `lib/element-pip.js`)

`pipElement(el, { mode })` floats any element. The tear-off demo had these routes for its own widgets; this is the same thing as one call.

| Mode | Result | Notes |
| --- | --- | --- |
| `move`: Document PiP, the real element adopted by the floating window | works | Needs no HTML-in-canvas. Stylesheets are copied across. While the element is away, `document.getElementById()` in the page no longer finds it, so page code must hold references. |
| `stream`: Document PiP showing a live picture, input sent back | works | The element stays in the page. Stops updating while the tab is hidden, because `paint` stops. |
| `video`: `captureStream()` into classic video PiP | works, view only | Media Session actions can be mapped to buttons inside the element. A fresh surface must paint once before the stream has a size. |
| Elements that cannot take a shadow root (`button`, `table`, `form`, `svg`) | works by wrapping | They get a `<live-region>` wrapper. An inline-block holding a canvas sits on the line by its bottom edge, not the text baseline, so the wrapper is lowered by how far the element hung below the baseline. Layout then moves by less than 0.1 px. Table parts (`tr`, `td`) cannot be wrapped. |
| Opening without a click | refused | `NotAllowedError`, as it should be. |

Device pixels: every `drawElementImage()` call in these pages passes a width and height. Checked at a real `--force-device-scale-factor=1.5`: all live checks pass and a click on a streamed picture lands on the right button.

## Live checks and lost pictures on a real phone

Reported on Chrome for Android: `/embed/` drew correctly, then the page jumped about, and it ended as a white box. Not reproducible in emulation, so these are the causes found by reading and what was done about each.

- **The checks drove the visible demo.** They changed its effect, restyled it, shrank it to 62% (the page reflowed), scrolled to the second demo and scrolled back. If the last check timed out, the scroll back never ran. Checks that press, type, restyle, resize or scroll now run in a hidden second copy of the page (`apart: true` in `runTests`, an invisible frame of the same URL plus `?bench`, removed when done). Applied to `/embed/`, `/tear-off/`, `/remote/`, `/support/`, `/pip/` and `/slot-view/`. Measured in Chromium: no scroll, focus or DOM change on the visible page while the checks run.
- **Nothing handled a lost graphics context.** `<live-card>` had no `webglcontextlost` handler, so a dropped context left a transparent canvas, which on the pale backdrop is a white box. It now says so over the card, restores itself on `webglcontextrestored`, and has a Try again button. Simulated with `WEBGL_lose_context`: message shown, picture back after restore.
- **A blank picture looked like a working one.** `LiveSurface` now repaints on `contextrestored` and when the page becomes visible again, checks once a second whether the outgoing picture is one flat colour, and tells viewers (`{ t: 'trouble' }`). `<live-view>` and `<live-card>` show a message instead of the dead picture. Each page has a check that fails on a blank result.
- **One failed draw in the lent-canvas demo stopped it for good.** It now asks the frame for a new snapshot and keeps going.
- Found while moving the checks: a remembered `<slot-view>` grant never sent the provider's `app` messages (an early return skipped the line that set it up).

Not confirmed without the phone: which of these Paul actually hit, and whether a 2D drawable canvas on Android fires `contextlost` at all when its pixels are dropped. The hidden copy doubles the page's canvases for the few seconds the checks run, which on a small GPU could itself cause a context loss; the visible demo now recovers from one.
