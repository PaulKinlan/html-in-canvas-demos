# Iframes as tiles (plan demo 22)

Page: `/iframe-tiles/`. Chromium 157 (headless shell) and 153 (full browser with experimental features).

| Question | Result | Notes |
|---|---|---|
| `frame-sizing: content-height` on a same-origin iframe | does nothing | The property parses. The iframe stays 150 px tall around a 512 px document. |
| `window.requestResize()` in the embedded document | throws | `NotAllowedError`, "allowed only from HTML documents with responsive-embedded-sizing meta tags", in a document that has the tag. Same in 153. |
| Height sent by `postMessage` from a `ResizeObserver` | works | The board uses this, and records per tile which method set the height. |
| Same-origin iframe drawn with `drawElementImage()` | works | A change inside the iframe raises the canvas's `paint` event without `requestPaint()`. |
| Cross-origin iframe drawn with `drawElementImage()` | transparent | No exception. Every pixel reads 0,0,0,0. `elementFromPoint()` and a click at the drawn place still reach the iframe. |
| Sandboxed iframe (`sandbox="allow-scripts"`) | transparent | Same as cross-origin. |
| Cross-origin iframe with `texElementSubImage2D()` | transparent | No GL error. A shader receives an empty texture. |
| `allow="focus-without-user-activation 'none'"` | 153: enforced. 157 shell: not enforced | Where enforced, `focus()` on load inside the tile leaves `document.activeElement` on the page. |
| `Supports-Loading-Mode: prerender-cross-origin-frames` | not measured | The test browsers refuse to prerender under automation (`PrerenderingDisabledByDevTools`, also after `Page.setPrerenderingAllowed`). `/iframe-tiles/prerendered` and `/iframe-tiles/prerendered-plain` report which tiles loaded before activation when a person opens them. |

Not confirmed on a phone: which of the six features Chrome 159 on Android reports, and whether the three small canvases on the page keep their contexts there.
