# Protected content in a drawable canvas (`/protected/`)

Measured in headless Chromium 157 and Chromium 153 on 2026-11-21 with real mouse clicks (`npm run record:protected`, results in `public/protected/recorded.json`).

| Content as a canvas child | In the picture | Notes |
|---|---|---|
| `<iframe>` from another origin | no | 0 of 44,800 pixels. The same page from this origin draws all of them. |
| `<img>`, `<video>` and CSS `background-image` from another origin, no CORS | no | 0 pixels each. An `<img crossorigin>` from a server that allows it is drawn. |
| The same cross-origin frame through `texElementSubImage2D()` | no | `readPixels()` returns 0 non-transparent pixels. |
| `<geolocation>`, `<camera>`, `<microphone>`, `<usermedia>` | yes | Drawn and readable. `<geolocation>` reports `isValid` false, reason `intersection_occluded_or_distorted`, even drawn over its own box with no transform. A real click reaches the element and opens no prompt; the same click on the element outside a canvas opens it. |
| A visited link with a `:visited` colour | as unvisited | 153 with history: 1,099 visited-colour pixels in a screenshot, 0 in the picture. |
| System colours, default accent colour on a checkbox | yes | The same values `getComputedStyle()` reports. |
| Password field | dots | Two passwords of the same length give identical pixels. |
| Open popover, modal `<dialog>` | no | Drawn by the browser in the top layer, where they take the hit test. |

Things that bit:

- No case taints the canvas. `getImageData()` and `toDataURL()` never throw; the browser leaves the content out.
- `WEBGL_lose_context.loseContext()` on a drawable canvas that is then removed crashes the tab in 157: at once when both happen in one task, and after a 150 ms wait too when the canvas has an `<iframe>` child.
- An open popover is positioned against the viewport, not the canvas. A hit test at canvas coordinates misses it unless the popover is placed over the canvas.
- A link to the current page is only `:visited` if the page was reached by a link from the same site. A typed address does not count.
- Not measurable in the test browsers: spelling markers (no dictionary), the autofill preview, a custom system accent colour, `<install>` (not present). The page has a canvas of live fixtures for these.
