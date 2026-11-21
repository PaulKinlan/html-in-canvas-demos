# Customisable select (`/select/`, `lib/select-picker.js`)

Measured in headless Chromium 157 with software rendering on 2026-11-21, driven by Playwright with a mouse, a keyboard and emulated touch. Not yet tried on a phone.

A select with `appearance: base-select` has a picker made of HTML in the top layer. Two combinations were tested: a canvas inside the select, and a select inside a canvas.

| Experiment | Result | Why |
|---|---|---|
| `<select><canvas content="drawable"><option drawable>` | works | The select collects options from all its descendants. `select.options`, the value, the form entry, arrow keys, typeahead, Enter and Escape are unchanged. |
| The picker canvas draws each option under its own 2D transform | works | `drawElementImage()` moves the option's hit box. Click, hover and `:checked` are the browser's. |
| Options as WebGL textures with a perspective matrix | works | `texElementSubImage2D()`, then `updateElementGeometry()` with the same matrix the shader uses. |
| Options as WebGPU textures | works off screen | `drawElementImageToTexture()` into a texture, read back. Not shown on a canvas here: the software adapter loses its device when it presents. |
| Two options overlap | the one drawn last gets the click | The last `drawElementImage()` or `updateElementGeometry()` wins. `z-index` on the options has no effect. |
| An option the canvas does not draw | keeps its last hit box | The library moves it far outside the canvas. It stays reachable by arrow key. |
| `toggle` or `beforetoggle` on the select when the picker opens | no event | The canvas's first `paint` event is the earliest signal. Before it the options have no paint record. |
| Close the picker from script | works, with a workaround | There is `showPicker()` and no `hidePicker()`. `blur()`, a synthetic Escape, `option.click()`, `disabled`, `inert` and `display: none` restored in the same task all leave it open. Showing an empty `popover="auto"` element closes it: the picker is in the popover stack. |
| Close the picker by setting `appearance: auto` for one style recalculation | closes it, then breaks the select | Chromium logs a console warning. If the mouse is over the picker at that moment, the select's computed `appearance` stays `auto` afterwards, whatever the stylesheet and inline style say, and it is the browser's own select until reload. |
| Open several pickers from one tap | fails | `showPicker()` needs user activation and uses it up. One tap opens one picker. Synthetic clicks and key events do not open one. |
| Mouse press on an option, drag, release over another option | chooses the second | The select chooses on mouseup. The library captures the pointer on the canvas once a drag passes 7 px. |
| `touch-action: none` on the picker canvas and on the options | does not stop the page panning | In touch emulation a vertical drag in the picker scrolled the page and cancelled the pointer. Cancelling `touchmove` stops it. |
| An animation when the picker closes | fails | The options stop painting in the frame the picker closes, so the canvas has nothing to draw. |
| A canvas inside an option draws its own drawable child | works while open | With the picker closed: "No cached paint record". A plain canvas in an option that is given pixels with `drawImage()` can be drawn at any time. |
| `<selectedcontent>` with a canvas in the chosen option | clones the element only | The clone has no pixels and no `paint` handler, and it is replaced on every change. Its cloned children are drawable in it. |
| `position-area: center` on `::picker(select)` | works | The radial picker opens centred on the button. |
| A select as a drawable child of a canvas, drawn rotated | works | The button is hit tested where it is drawn. |
| The picker of that select in the canvas's picture | fails | The picker is top-layer content. The browser paints it upright, anchored to the bounding box of the drawn button. |
| The outer canvas draws an option of the open picker | fails | "No cached paint record for element." |
| A canvas-drawn picker inside a select that is itself drawn by a canvas | works | Two nested drawable canvases. The inner one is in the top layer while the picker is open. |
| A canvas in the select's `<button>` with `<selectedcontent drawable>` inside it | works | The browser still fills `<selectedcontent>` on every change, and the canvas draws it. `rollSelected()` keeps the old value's pixels and rolls the new value in. |
| `display` set on `::picker(select)` without `:open` | renders the closed picker | A rule such as `::picker(select) { display: flex }` overrides the rule that hides the closed picker. Write it as `select:open::picker(select)`. |

What would help:

- `hidePicker()`, and `toggle` events on the select, as popovers have.
- A way for a picker's content to keep painting for a moment after the select closes, so a canvas can draw a closing animation or move the chosen option into the button.
- `<selectedcontent>` cloning a canvas with its bitmap, or an event when it replaces its clone.
- `touch-action` taking effect for elements drawn by a canvas in the top layer. This needs checking on a real phone before it is reported.
