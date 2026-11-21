# Shader uniforms from CSS (`/css-uniforms/`, `lib/css-uniforms.js`)

Measured in Chromium 157 (headless shell, no experimental flags), 2026-11-21, at 412 pixels wide with synthetic touch and keyboard input. Not yet run on the test phone.

`lib/css-uniforms.js` finds the `float` and `vec4` uniforms in a fragment shader's source, registers a custom property for each (`uRgbSplit` reads `--u-rgb-split`), reads them with `getComputedStyle()` and sets them on the program. The page draws twelve `drawable` cards with one WebGL context (`lib/element-gl.js`) and one shader.

| Question | Result | Notes |
|---|---|---|
| A registered `<number>` property read in the middle of a transition | interpolated | `--u-wave` from 0 to 10 over 600 ms read 6.11 at about 300 ms. |
| A registered `<color>` property in a transition | interpolated, returned as `rgb()` | Red to blue read `rgb(99, 0, 156)` part way. With alpha it is `rgba()`. A `color-mix()` result is returned as `color(srgb r g b / a)`; the library parses both forms and sends any other form through a 2D canvas. |
| Typed `attr()`: `attr(data-split type(<number>), 0)` | the number | |
| `sibling-index()` and `sibling-count()` in a registered property | per element | 0.33, 0.67, 1.00 on three siblings. In `animation-delay` it staggers one animation across the cards. |
| `random(0, 1)` | one value per element, the same on every read, new on reload | So a seed uniform does not flicker. |
| `if(style(--mode: crt): 1; else: 0)` | picks the value | The result can be transitioned because the property is registered. |
| `@container style(--level >= 2)` | applies | The container has to be an ancestor of the card. The demo sets `--level` on `main` with `:has(#hot:checked)`. |
| `progress(100cqi, 100px, 500px)` in a 300 pixel container | 0.5 | Also inside `color-mix()` as a percentage. |
| `@function --ease(--t <number>) returns <number>` called with `var(--u-phase)` | computed, and follows `--u-phase` while it animates | |
| `animation-timeline: view()` on a card in the canvas | runs from the card's layout position in the page | The last card forms as it scrolls into the window. Seen in screenshots; no live check. |
| A change to a custom property alone (set from script, or a transition of a registered property) | no `paint` event | 0 events after the set and 0 during the transition. The canvas has to poll or listen for transition and animation events. |
| Cost of polling: 12 elements, 12 properties, one value changed per read | 0.094 ms | With animations running on all twelve cards the page's own counter shows 0.8 to 0.9 ms per frame, which includes resolving the animated values. Software rendering, so only the order of magnitude counts. |
| A `<style>` element with `display: block` inside a drawn card | drawn as text, editable with `contenteditable="plaintext-only"`, and its rules apply while it is edited | Typing 14 over 5 in `--u-wave: 5` on the card changed the uniform on the next frame. |
| Uploads while only uniforms change | none | `changedElements` named each card twice during load (first paint and font load) and not again while the animations ran. |

## Things that bit

- `&lt;number&gt;` inside a `<style>` element is not decoded, because `<style>` is raw text. The rule on the card has to contain a literal `<number>`.
- A rule that sets `animation` on `.card` (the shared band of light) comes later in the document than some cards' own rules, so those cards use `.card.wave` to win on specificity.
- A dissolve of 0.7 removed the card's own rule from view. The animation stops at 0.42.
- The rules had to be reformatted to 25 characters a line to fit a card that is half of a 412 pixel screen.

## Not verified

- Chrome 159 on the test phone: every card, editing a rule with the on-screen keyboard, and the per-frame read cost. The status line under the canvas reports the cost.
- Chromium 153: `random()`, typed `attr()`, `if()`, `sibling-index()` and `@function` are missing or partial there. The cards would draw with those uniforms at 0. Not run.
- `:hover` on touch. In the emulated touch run a tap did not leave `:hover` set, so the "Hover and press" card only bulges while pressed.
- The canvas is 1448 CSS pixels tall on a phone. At a device pixel ratio of 2.625 that is a 3801 pixel buffer, under the common 4096 limit. A phone with a ratio above 2.8 would exceed it. To verify: open the page on such a phone.

## Open ideas

- Move the binding into `shader-fx.js` so that `fx="…"` effects take their uniforms the same way. That file belongs to the UI primitives strand, so it is not changed here.
- Replace the per-frame poll with `transitionrun`, `animationstart` and a MutationObserver, and poll only while one of them is active.
- A registered `<custom-ident>` property that selects the effect, so that the shader itself cascades.

## For the index

- Shaders and CSS: registered custom properties, including values from `attr()`, `if()`, `sibling-index()`, `random()`, `progress()`, `@function`, transitions and view timelines, can be read each frame and set as uniforms (measured, C157, `/css-uniforms/`).
- Paint events: a change to a custom property alone raises no `paint` event (measured, C157, `/css-uniforms/`).
- Elements: a displayed, editable `<style>` element inside a drawn element is drawn and stays live (measured, C157, `/css-uniforms/`).
