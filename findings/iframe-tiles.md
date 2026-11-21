# Iframes as tiles (`/iframe-tiles/`)

Demo 22 (`iframe-tiles`) of the Chrome APIs plan. Measured in C157 and C153 on 2026-11-21.

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

Consequences for a board:

- A cross-origin tile needs a placeholder drawn by the board, because the person can click a document they cannot see.
- A shader on another origin's content needs that origin to draw itself, as `/embed/` does.

## Things that bit

- The tab crashed at the end of a measurement. The measurement resolved inside the `paint` event's microtask and the runner then removed the fixture, which holds an iframe. The runner now waits for a timer before it removes a fixture.
- `check:jank --checks` reported two focus moves. The focus measurement moves focus by design, so an automatic run skips it and it runs when the button is pressed.

## Not verified

- `frame-sizing: content-height` and the focus policy on A159. "Run the measurements" on `/iframe-tiles/` on the phone would verify them.
- Whether cross-origin tiles load during prerender with `Supports-Loading-Mode: prerender-cross-origin-frames`. The test browsers refuse to prerender under automation (`PrerenderingDisabledByDevTools`). A person pressing "Prerender both pages" and opening each link would verify it.

## For the index

- Across workers, tabs, origins and devices: A cross-origin or sandboxed iframe is drawn as transparent pixels by `drawElementImage()` and `texElementSubImage2D()`, with no error, and still takes clicks where it was drawn. measured, C157, `/iframe-tiles/`.
- Across workers, tabs, origins and devices: `frame-sizing: content-height` parses and does not size an iframe. `window.requestResize()` throws `NotAllowedError`. measured, C157 and C153, `/iframe-tiles/`.
- Accessibility, focus and selection: `allow="focus-without-user-activation 'none'"` stops a tile taking focus in C153 and not in C157. measured, `/iframe-tiles/`.

## Chromium bugs

- Removing an iframe that is a canvas child from inside the `paint` event, or a microtask of it, crashes the tab. Calling `WEBGL_lose_context.loseContext()` there, with an iframe child in the canvas, crashed it as well. Leaving the event with `setTimeout(0)` first avoids both.
