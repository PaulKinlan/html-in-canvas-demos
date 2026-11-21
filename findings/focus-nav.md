# Controller, keyboard and haptic navigation (`/focus-nav/`)

Measured in headless Chromium 157 on 2026-11-21. Key presses were real key events from a test script. No game controller was available.

| What | Result | Detail |
|---|---|---|
| `focusgroup="toolbar wrap"` on buttons drawn through a shader, ArrowRight | works | Focus went Tides, Knots, Lights, Charts: DOM order, past the end of the drawn row. Home and End work. One tab stop per group, and the group remembers its last button. |
| The same, ArrowDown and ArrowUp | no move | The toolbar behaviour moves on one axis. A grid needs the page's own function. |
| Rows reversed with `order`, `reading-flow: grid-rows` | arrows and Tab follow the drawn order | Right from Tides went to Journal, then Berths. With `reading-flow: normal` it went Knots, Lights (DOM order). |
| Nearest button in a direction, from `offsetLeft` and `offsetTop` | works | Six cases on a fixture, including "nothing that way". Unaffected by the lean, which changes `getBoundingClientRect()`. |
| `focus({ focusVisible: true })` from script | matches `:focus-visible` | 793 outline pixels in the read-back picture; 0 with `focusVisible: false`. |
| The focus position given to a shader as four CSS custom properties | works | Colour spread far from the focus fell from 53.6 to 8.7. Transitions on the properties move the lit area. |
| `elementFromPoint()` on the panel while it leans | works | Three tiles hit at their drawn centres. |
| A controller state read by one function | works with scripted states | Plain objects with the standard mapping: right, held repeat, stick down, button 0. |
| `rawgamepadinputchange`, `navigator.haptics` | missing | Chromium 157. The page polls `getGamepads()` once per frame while a controller is connected. |
| `navigator.vibrate()` after a tap | returns true | Headless. Whether a phone vibrates is not verified. |
| Removing the `focusgroup` attribute | logs a console error | "focusgroup requires a recognized behavior token". `focusgroup="none"` turns it off without the error. |

Not verified: a real controller and its vibration, the gamepad event origin trial, vibration on the phone, a screen reader on each move, and WebGPU on screen.

What would verify it, on the test phone: use the direction pad and the A button and feel for the vibration, then connect a controller and read the line under the demo.

## Things that bit

- A live check cannot send trusted key events, so `focusgroup` and `reading-flow` were measured with real keys from a test script. The page logs what each arrow key and Tab did, so the same can be read on a device.
- Removing the `focusgroup` attribute logs "focusgroup requires a recognized behavior token". The page sets `focusgroup="none"` instead.
