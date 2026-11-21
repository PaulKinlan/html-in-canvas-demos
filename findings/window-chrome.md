# An app window drawn by a canvas (`/window-chrome/`, `app.html`, `app.webmanifest`)

Measured in Chromium 157 (headless shell) on 2026-11-21 with a mouse and emulated touch, in a simulated window. No installed app window was used.

An installable app whose window is one canvas. The title bar is a `<header>` child of the canvas with `app-region: drag`. The page runs the app in a frame with a simulated window around it. Tested in headless Chromium 157 with a mouse and emulated touch, 2026-11-21. No installed app window was used.

| Experiment | Result | Why |
|---|---|---|
| A title bar element drawn by the canvas, with tabs and a text field in it | works in the simulated window | The bar is sized to the title bar rectangle and drawn there. A tab takes a click and the field takes typing at the drawn position, by mouse and by emulated touch. |
| Canvas drawing around the bar | works | The gradient behind the bar, a glow under the pointer and the grey of an inactive window are drawn by the canvas around the picture of the element. |
| Read `app-region` at a drawn position | works | `elementFromPoint()` at the picture of an element drawn 150 px from its layout box returns the element, and its computed `app-region` is `drag`. At the layout box it returns what is drawn there. A simulated window built on those two calls drags from the picture. |
| `window-drag` | not in Chromium 153 or 157 | `CSS.supports('window-drag: drag')` is false. `app-region: drag` is supported. |
| `window.minimize()`, `maximize()`, `restore()`, `setResizable()`, `setShape()`, `navigator.install()` | undefined in a tab | The app's buttons report what exists where it runs. |

## Not verified

everything about a real window. Whether the window controls overlay hands the canvas the strip beside the system buttons as expected, whether a real drag region is at the picture of the element or at its layout box (the app's "Test 1" and "Test 2" measure it from `screenX` and `screenY` once installed), whether `updateElementGeometry()` changes that, and the windowing calls in an installed window. Window Shape needs an allowlisted Isolated Web App on ChromeOS and was not tried. To verify: install the app from `/window-chrome/` on desktop Chrome, turn on the overlay and run "Test 1" and "Test 2" in the app.

## For the index

- Hit testing and updateElementGeometry(): a title bar element drawn by a canvas works in a simulated window, and the computed `app-region` is found at the drawn position with `elementFromPoint()`. measured in a simulated window, C157, `/window-chrome/`.
- Hit testing and updateElementGeometry(): where a real window's drag region is, at the picture or at the layout box. not verified, `/window-chrome/`.

For PLAN.md: demo 27 `window-chrome` is built as `/window-chrome/`. "Not verified" row: App window, as above. The three device pages are in the menu group `primitives` because a page pull request does not edit `tools/site/groups.json`. A group of their own ("Experiments: foldables, peripherals and app windows", key `devices`) needs a separate change there.
