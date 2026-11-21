# Datalist and other inputs (`/datalist/`, `/inputs/`)

Measured in headless Chromium 157 with Playwright, mouse and emulated touch at 412 px. The shared part is `public/lib/placed-popover.js`: a `popover="manual"` element positioned with CSS anchor positioning that holds a drawable canvas.

The built-in popups of `<input list>`, `type="date"`, `type="time"` and `type="color"` are not elements. They have no pseudo-element, `appearance: base-select` does nothing for them, and nothing can be put inside an `<input>`. A canvas can draw the control and can replace the popup, but cannot draw the built-in popup.

| Test | Result | Detail |
| --- | --- | --- |
| `<canvas><datalist style="display:block"><option drawable>`, `drawElementImage(option)` | works | The option is a grandchild of the canvas. Without `drawable` on the option the call throws "Descendants passed to DrawElementImage must have the 'drawable' attribute". |
| Hit testing, `:hover` and click on a datalist option drawn that way | works | `elementFromPoint()` returns the `<option>`. |
| An element inside a datalist option, such as `<option>Leeds <small>LDS</small></option>` | not rendered | It parses and stays in the DOM, but the option renders its label as plain text. The child has no box and `checkVisibility()` is false. Computed `display` of the option stays `block`. `::before` and `::after` on the option do render. |
| CSS Custom Highlight API range in an option's text node | paints nothing | The text shown is in the browser's internal tree, not the option's text node. |
| Keep the built-in datalist keyboard handling and replace only the popup | not possible | Removing `list` is the only way to stop the popup, and it removes the keyboard handling too. |
| Range input with a datalist, drawn in a canvas | works | The tick marks are part of the input's picture. Option labels are never shown by the browser. `RangeLabels` draws the options themselves under the ticks. |
| date, time, datetime-local, month, week, number, color, range, file, checkbox, radio, progress, meter drawn rotated by one `drawElementImage()` | works | Date segments take focus and typing where they are drawn. A click on the rotated range track sets the value at that point. |
| Built-in colour chooser of a rotated input | outside the canvas | It opens upright next to the bounding box of the drawn swatch. |
| Built-in date and time pickers, and the datalist popup, of a rotated input | not observed | The test browser has no window and never shows them. |
| A picker made of `<button>` children of a popover canvas (clock, calendar, swatches) | works | Focus, `:focus-visible`, `aria-pressed`, hover and click follow the drawing. Buttons that are not drawn are moved away with `updateElementGeometry()`. |
| Stopping the Android date and time dialogs by making the input `readonly` while the replacement is open | not verified | Needs a phone. |

What would help:

- A picker pseudo-element for `<input list>`, `type="date"`, `type="time"` and `type="color"`, as `::picker(select)` is for select, so a canvas could go inside the real picker.
- Options in a datalist rendering their children, as options in a customisable select do.
- A way to stop a built-in picker opening without removing the feature that provides it (`list`) or making the input read-only.
