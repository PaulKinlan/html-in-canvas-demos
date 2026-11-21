# Devices: fold, peripherals, app window (`/fold/`, `/hardware-out/`, `/window-chrome/`)

From the hardware tier of the Chrome APIs plan. Each page has an on-page control that stands in for the device. Tested in headless Chromium 157 with a mouse, emulated touch and DevTools device emulation. No real foldable was used.

## `/fold/`, `lib/fold-view.js`

| Experiment | Result | Why |
|---|---|---|
| Place two canvas children from `devicePosture.type` and `viewport.segments` | works | Each pane is resized with CSS to its segment and drawn there. A posture change relays the panes and the canvas draws the slide between the two places. |
| Draw a picture of a folded device on a flat screen with a 2D context | works | Each half is cut into 8 px strips beside the fold. A strip is one clipped `drawElementImage()` with its own scale. About 60 draws per frame for two panes. |
| Keep the controls still while the angle changes | works after a change | The first version drew both halves at half the fold angle and fitted the scale to each angle, so every control moved and changed size during a slider drag. Reported from a phone (2026-11-21). Now the half with the controls has one fixed tilt, only the other half turns, and one scale is chosen for all angles from 60° to 180°. |
| Hit testing on a half drawn at 90° to 100° | works | One half is a plane, so `updateElementGeometry()` gets a matrix with a perspective row. `elementFromPoint()` at the drawn centre of a button returns it, and the box centre is within 1.2 px. Taps, typing, a slider drag and checkboxes work there. |
| One element across both halves | works for one pointer | Two planes, one hit box. The box follows the pointer. A cold tap on the other half still clicks the right target, because a `pointerdown` listener moves the box before the click is aimed. The `pointerdown` itself goes to the old place. |
| Cut one element at a hinge and continue after it | works | The element is laid out shorter by the hinge width and drawn twice with a clip. CSS has no way to remove rows from the middle of an element. |
| Play the hinge opening when `devicePosture` changes | works, as a fixed swing | The API reports two words and no angle, so the opening cannot follow a hand. On `"continuous"` the canvas draws both halves as slabs that swing from 90° to flat in 1.1 s, with the panes live on them. Tested with emulated posture changes only. |
| `viewport.segments` and `devicePosture` through `Emulation.setDeviceMetricsOverride` | works | A display feature gives two segments and `"folded"`. `visualViewport.segments` does not exist in 157. |
| Playwright `page.screenshot()` during that emulation | resets it | Playwright sends its own metrics override, which drops the display feature. Use CDP `Page.captureScreenshot`. |

Not verified: any real foldable. Segment rectangles, the reported hinge width of a dual-screen device, the segments while the on-screen keyboard is open, and whether the shaded crease lines up with the physical one. The API reports no fold angle, so a real device cannot drive the angle of the picture.

## `/hardware-out/`, `lib/device-out.js`

Three canvases hold a shop till written as plain HTML: fifteen buttons, a receipt, a sign. Each is converted to the bytes of a device, and a simulated device on the page is drawn from those bytes by a reader that knows nothing about the DOM.

| Experiment | Result | Why |
|---|---|---|
| Fifteen `<button drawable>` grandchildren of one canvas, each drawn into its own 72 x 72 square | works | `drawElementImage(button, x, y, 72, 72)` per button. The buttons stay clickable in the canvas at the drawn size. |
| `event.changedElements` to choose which keys to refresh | works, over-reports | A frame of an animated key lists that button only. Setting text to the same value also lists the element, so the page hashes the pixels of listed keys before sending. |
| Key picture to JPEG to 1,024-byte HID reports and back | works | `OffscreenCanvas.convertToBlob()` per key, about 1.2 KB and 2 reports. The reader returns the same bytes. Report layout is that of the 15-key JPEG Stream Decks. |
| A key press from the device | synthetic only | The input report leads to `button.click()`. Handlers run. The event is not trusted and there is no `:active`. |
| An element as ESC/POS raster (`GS v 0`) | works | 384 dots wide, about 15 KB for a 330 row receipt. Error diffusion, an ordered pattern or a threshold. The reader gets the same dots back. |
| A focused `<input>` in the printed element | caret is printed | The caret and the placeholder are part of the picture. |
| A CSS `@keyframes` ticker drawn into 64 x 32 pixels | works | `paint` fires about 60 times a second with no script, also while the canvas is scrolled out of view. Frames are RGB565, 4,100 bytes. |

Not verified: any device. WebHID and Web Serial exist in the test browser, Web Bluetooth does not. The Stream Deck report layout comes from open-source drivers. The LED matrix frame format is this page's own and needs firmware written for it.

## `/window-chrome/`, `app.html`, `app.webmanifest`

An installable app whose window is one canvas. The title bar is a `<header>` child of the canvas with `app-region: drag`. The page runs the app in a frame with a simulated window around it. Tested in headless Chromium 157 with a mouse and emulated touch, 2026-11-21. No installed app window was used.

| Experiment | Result | Why |
|---|---|---|
| A title bar element drawn by the canvas, with tabs and a text field in it | works in the simulated window | The bar is sized to the title bar rectangle and drawn there. A tab takes a click and the field takes typing at the drawn position, by mouse and by emulated touch. |
| Canvas drawing around the bar | works | The gradient behind the bar, a glow under the pointer and the grey of an inactive window are drawn by the canvas around the picture of the element. |
| Read `app-region` at a drawn position | works | `elementFromPoint()` at the picture of an element drawn 150 px from its layout box returns the element, and its computed `app-region` is `drag`. At the layout box it returns what is drawn there. A simulated window built on those two calls drags from the picture. |
| `window-drag` | not in Chromium 153 or 157 | `CSS.supports('window-drag: drag')` is false. `app-region: drag` is supported. |
| `window.minimize()`, `maximize()`, `restore()`, `setResizable()`, `setShape()`, `navigator.install()` | undefined in a tab | The app's buttons report what exists where it runs. |

Not verified: everything about a real window. Whether the window controls overlay hands the canvas the strip beside the system buttons as expected, whether a real drag region is at the picture of the element or at its layout box (the app's "Test 1" and "Test 2" measure it from `screenX` and `screenY` once installed), whether `updateElementGeometry()` changes that, and the windowing calls in an installed window. Window Shape needs an allowlisted Isolated Web App on ChromeOS and was not tried.
