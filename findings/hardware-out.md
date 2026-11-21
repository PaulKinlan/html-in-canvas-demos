# Live DOM on physical devices (`/hardware-out/`, `lib/device-out.js`)

Measured in Chromium 157 (headless shell) on 2026-11-21 with a mouse, emulated touch and DevTools device emulation. From the hardware tier of the Chrome APIs plan. A simulated device is drawn from the bytes each real device would receive.

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

## Not verified

any device. WebHID and Web Serial exist in the test browser, Web Bluetooth does not. The Stream Deck report layout comes from open-source drivers. The LED matrix frame format is this page's own and needs firmware written for it. To verify: desktop Chrome with the device, and the "Connect" button of each panel. The status line beside it reports the result.

## For the index

- What is in an element's picture: canvas children convert to Stream Deck HID reports, ESC/POS raster and RGB565 frames, and simulated devices are drawn from the bytes. measured with no device, C157, `/hardware-out/`.
- The canvas, the attributes and the paint event: `changedElements` lists drawable grandchildren one by one, and also lists an element whose text was set to the same value. measured, C157, `/hardware-out/`.
- The canvas, the attributes and the paint event: a CSS animation in a canvas child fires `paint` about 60 times a second with no script, also while the canvas is scrolled out of view. measured, C157, `/hardware-out/`.

For PLAN.md: demo 25 `hardware-out` is built as `/hardware-out/`. "Not verified" row: Peripherals, as above.
