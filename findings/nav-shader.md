# Navigations drawn by a shader (`/nav-shader/`)

Measured in headless Chromium 157 on 2026-11-21. A four-view site is the children of one `<live-transition>`; a `navigate` listener turns each same-page navigation into a shader transition.

| What | Result | Detail |
|---|---|---|
| `NavigationPrecommitController`, `controller.addHandler()`, `NavigateEvent.sourceElement` | present | All three in Chromium 157. |
| Fetch the new view and append it as a canvas child in `precommitHandler` | works | The view loaded in 45 to 91 ms while `location.search` was still the old query. The URL changed after the promise resolved. |
| The transition origin from `sourceElement` | works | The link's `getBoundingClientRect()` centre, minus the element's rect, was within 2 px of the card centre. A GET form gives its submit button. A traversal has no source element. |
| Both views live while the shader blends them | works | At 41% of a 4 s transition the old view's clock had counted from 0 to 2 s and a text field in the new view took a value. |
| Back intercepted and drawn | works | One `traverse` navigation ran the shader. The view was already a child, so its precommit step took 0 ms. |
| `drawElementImage()` of a snapshot after its element was removed | works | `captureElementImage()` in a paint handler, `remove()`, then the snapshot drew rgba(192,20,60,255). |
| Navigating checks in a hidden same-origin iframe | share the tab's history | `history.length` went from 2 to 4. After the iframe was removed, one Back from the top page skipped its entries. While it was attached, its `history.back()` undid a navigation made by the top page. |
| The ink shader in WGSL | not verified | No WebGPU adapter. The page compares the WebGPU and WebGL pictures on a device that has one. |

Not verified: WebGPU on screen, the phone's Back gesture and its preview animation, cross-document navigations, and what a screen reader announces when the view changes.

What would verify it, on the test phone: tick "Slow", tap a card, tap inside both views while the shader runs, then go Back. Run the live checks for the WebGPU comparison.

## Things that bit

- The live checks that navigate run in a hidden same-origin iframe. Its navigations are in the tab's joint history, so its `history.back()` undid a navigation the reader had made in the top page while the checks ran on load. The page's checks now wait for a tap.
