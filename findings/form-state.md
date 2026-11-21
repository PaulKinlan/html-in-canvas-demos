# Form effects driven by the paint event (`/form-state/`)

Five ideas from the element catalogue (group 12 of the backlog in PLAN.md). Measured in headless Chromium 157 (C157) on 2026-11-21 with a mouse, a keyboard and emulated touch at 412 px wide. The page's eight live checks pass there, and `node tools/form-state/check.mjs` drives the five demos with real input (30 steps, all pass). Nothing here has been run on a phone.

The question: can an effect on a form control be driven by the `paint` event alone, with the handler reading the control's state, and no input, pointer or focus listener on the control?

| Experiment | Result | Why |
|---|---|---|
| Ink per keystroke: a `<textarea drawable>` with no listener. The paint handler compares `value.length` with the last length it saw | works | Each typed character raised `paint`. Three typed letters were counted as three. Backspace is not counted because the length fell. |
| Where the typed letter is | `createValueRange(i, i + 1).getBoundingClientRect()` | The box is at the drawn place of the textarea (live check: 19.8 px and 74.0 px into the field for the 2nd and 7th characters of a monospace line). |
| Wet ink: the textarea drawn a second time in a clipped circle with `ctx.filter = 'blur()'` and a larger scale | works | `ctx.filter` applies to `drawElementImage()` (live check: alpha 42 at 5 px outside the edge of a box drawn through `blur(6px)`). |
| Putting input back after the extra draws | a draw inside an empty clip | It adds no pixels and moves the hit region (live check). After the ink, a tap near the start of the first line put the caret at index 1. |
| Idle cost of the ink | 2 paint events in 0.7 s | The caret blink repaints the textarea. The handler draws one flat picture for each. |
| Dent: the paint handler reads `panel.querySelector('button:active')`. Mouse | works | The `:active` style changes the picture, `paint` is raised, and the handler finds the button. |
| The same with Space held on a focused key | works | The button matches `:active` while the key is down. |
| The same with a touch press (CDP touch events, held 0.45 s) | fails: no button matches `:active` | Polled every 16 ms during and after the press. The tap still raised `pointerdown`, `pointerup` and `click` on the button. A button outside the canvas matched `:active` for about 20 ms after the same touch. Whether Chrome 159 on Android behaves the same is not verified. |
| Second route for touch | `pointerdown` listener | The listener remembers the key and calls `requestPaint()`. The handler uses it only when no button matches `:active`. The line under the demo counts the two routes separately, so the page reports the answer on the device that opens it. |
| Bending a panel of buttons in a 2D context | triangle mesh | An 8 by 9 grid of moved corners, 144 triangles, each a clipped `drawElementImage()` of the whole panel with the affine transform of its triangle. A clip 0.6 px larger than the triangle hides most seams. Faint diagonal lines remain on the dark panel. The first version scaled 99 square tiles, and its seams were plain to see. |
| Colour input as a lamp: the handler reads `input.value`; buttons only write `value` | works | Writing `value` raised 1 paint event and `changedElements` held the input (live check, swatch pixel 200,0,0 then 0,200,0). Wall pixel 194,71,97 under #ff3b6b and 96,182,128 under #62f0a0. 0 paint events in 0.8 s once the colour settled. |
| Light on a scene | `multiply` then `screen` | The card is drawn in its own colours, the whole canvas is multiplied by a gradient of the colour, and a glow is added. The input is drawn last so it shows the chosen colour. |
| Liquid: the handler reads `progress.position` | works | Writing `value` raised 1 paint event. Removing `value` raised 1 with `appearance: none` and 4 in 0.5 s with the browser's look, and `position` is -1 (live checks). |
| The tank's outline | `source-atop` | The element is drawn first on an empty canvas. Fills made with `source-atop` stay inside its pixels: alpha 0 in the rounded corner (live check). |
| Search field: the handler reads `field.matches(':focus')` and `value` | works | Focus changes the border, which raises `paint`. Typing "se" left 2 of 6 links sharp. Blur was seen after `blur()`. |
| A link drawn through a blur filter with lower alpha | still a link | `elementFromPoint()` at its drawn place returned the link. |
| A state that changes no pixel | no `paint` | A hidden input's value and an unstyled attribute changed with 0 paint events (live check). Each demo keeps its state in the picture: a pressed style, a focus border, a faint `::-webkit-progress-value`. |
| A lost context | plain controls | One `contextlost` event on one canvas stops all five and shows the controls as plain HTML (5 boxes). Tested by dispatching the event. |

## Things that bit

- Scaling square tiles about their own centres leaves gaps and overlaps wherever neighbours have different scales. Moving the shared corners and mapping triangles has no gaps.
- `:active` under touch could not be seen by reading it once during the press: it had to be polled, inside and outside a canvas, to tell "never set" from "set for one frame".
- The shading of the dent is drawn with `source-atop` after the mesh, so it stays inside the panel's rounded outline with no clip path.
- The `<output>` under a demo is rewritten by the paint handler. It has a fixed minimum height so the page below does not move.

## Not verified

- Chrome 159 on Android: all five by touch. Open `/form-state/` and try each.
- Whether a touch press sets `:active` on a drawn button on the phone. Press a key on the keypad and read the line under it: it counts presses seen through `:active` and presses only the listener saw.
- The on-screen keyboard over the ink and the search field, and whether the canvas stays in view.
- The Android colour dialog opened by a tap on the drawn lamp.
- The speed of 144 clipped draws per frame (the dent) and of blurred draws (ink, search) on a phone GPU.
- A screen reader on any of the five.

## For the index

- Paint event: a change of `value` (textarea, colour, progress), `:active` (mouse, keyboard) and `:focus` raises `paint`, and the handler can read the state with no listener on the control. A state that changes no pixel raises no `paint`. C157, `/form-state/`.
- Hit testing and input: a touch press does not set `:active` on a button drawn in a canvas (emulated touch, C157). Not verified on A159.
- 2D drawing: `ctx.filter` applies to `drawElementImage()`; `source-atop` after an element draw keeps fills inside its picture; a triangle mesh of clipped draws bends an element.
- Hit testing: a `drawElementImage()` inside an empty clip moves the hit region and adds no pixels.
- Backlog: ideas 12.1 to 12.5 (per-keystroke ink, button press that dents the surface, colour input that recolours its own scene, liquid progress bar, search field that focuses the scene) are built on `/form-state/`.

## Chromium bugs

- Candidate: `:active` is not applied to a `drawable` descendant of a canvas for a touch press, while it is for a mouse press. Needs a reduction and a check on a real touch screen before filing.
