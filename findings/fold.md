# DOM drawn across a fold (`/fold/`, `lib/fold-view.js`)

Measured in Chromium 157 (headless shell) on 2026-11-21 with a mouse, emulated touch and DevTools device emulation. From the hardware tier of the Chrome APIs plan. An on-page control stands in for the device.

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

## Things that bit

- Playwright `page.screenshot()` sends its own metrics override, which drops the emulated display feature. Screenshots of the device mode need CDP `Page.captureScreenshot`.
- The first version drew both halves at half the fold angle and fitted the scale to each angle. On a phone the controls moved and changed size under the finger while the angle slider was dragged (reported, A159). The half with the controls now has a fixed tilt and one scale.

## Not verified

any real foldable. Segment rectangles, the reported hinge width of a dual-screen device, the segments while the on-screen keyboard is open, and whether the shaded crease lines up with the physical one. The API reports no fold angle, so a real device cannot drive the angle of the picture. To verify: open `/fold/` on a foldable and press "Use this device's fold". The table on the page shows the posture and the segments.

## For the index

- Hit testing and updateElementGeometry(): a folded surface drawn as two tilted planes keeps hit testing through one perspective matrix per half. measured, C157, `/fold/`.
- Hit testing and updateElementGeometry(): an element across two planes has one hit box, which the page moves to the half under the pointer. measured, C157, `/fold/`.
- Phones and lost contexts: a real foldable. not verified, `/fold/`.

For PLAN.md: demo 23 `foldable` is built as `/fold/`. "Not verified" row: Foldables, as above.
