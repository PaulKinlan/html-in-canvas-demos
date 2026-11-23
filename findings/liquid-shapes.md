# Controls that join and split like drops (`/liquid-shapes/`, `lib/liquid-field.js`)

Measured in C157 (headless shell, 412 px wide, device scale 2 and 2.625, mouse and touch emulation) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`, "Liquid shapes"). The ideas are Kopp's Liquid Arrow Button and Liquid UI Components, Matt Ölschlegel's Reshaping Dock and Manoela Ilic's Gooey Sticky Menu. The page links to each. The code and the copy are mine: I didn't read their source.

| Question | Result | Notes |
|---|---|---|
| A threshold on alpha in a 2D canvas with no shader and no pixel read | works | `ctx.filter = 'url(#id)'` with one `feColorMatrix` (alpha times 24, minus 11.5) applies to `drawImage()`. A blurred edge that read 72 at 5 px outside and 194 at 5 px inside reads 0 and 255 after it. |
| Copy the drawable canvas inside its own `paint` handler | works | `drawImage(canvas)` into a plain canvas, straight after `drawElementImage()`, holds the element pictures. The plain canvas is never read. |
| Two elements 8 px apart join through blur 8 and the threshold. One 32 px away stays apart | works | Live check: 0% ink in the near gap with no field, 100% with it, 0% in the far gap. |
| Draw the elements a second time inside the joined outline | works | `globalCompositeOperation = 'source-atop'` clips `drawElementImage()` to what is already on the canvas. |
| The label in the joined shape is the element's own picture | yes | Mean pixel difference from a plain draw of the label: 0.00 with the second draw, 19.12 for the field alone (out of 255). |
| Hit testing after the field | follows the last draw | A button drawn 60 px from its layout place is returned by `elementFromPoint()` there and not at its layout place. A link that rose 72 px out of the dock takes a tap where it is drawn. |
| `<summary drawable>` and `<button drawable>` elements inside one `<details>` | draw one by one while it is open | Each can be drawn at a place and scale of the page's choosing. |
| A button inside a closed `<details>` | throws | `InvalidStateError`: "No cached paint record for element". Same as `/accordion/`. The page cancels the click that would close the menu, runs the items back and then sets `open = false`. |
| Keyboard | works | Enter on the summary opens and closes, Tab reaches the items while they are open, Enter on an item chooses it, Escape closes and returns focus to the summary. Enter on a dock link makes it current. Space presses the button. |
| Reduced motion | shapes join, nothing animates | The springs jump to their targets. |
| No API | plain HTML | `mount()` from `lib/stage-2d.js` shows the three controls as ordinary elements. The menu opens and closes as a plain `<details>`. |
| The blurred copy at one pixel per CSS pixel, threshold at full size | no soft edge seen at scale 2.625 | The copy is a seventh of the pixels of the canvas at that scale. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 14.6 MB in canvases. |
| Paints during an animation in the test browser | 60 a second | Software rendering on a desktop CPU. It says nothing about a phone. |

## Things that bit

- I gave the canvases the class `stage`. `shared/style.css` has a `.stage` rule with 12 px of padding. `mount()` takes the scale from `canvas.width / canvas.clientWidth`, and `clientWidth` includes padding while the drawing buffer doesn't, so everything was drawn 6% small and the hit boxes were 12 px away from the pictures. Taps on the dock went to the wrong link. A drawable canvas that uses `mount()` must have no padding.
- The threshold removes thin things. A focus ring outside an element's box, 2 px wide, is gone after the cut, and `source-atop` then clips the second draw of it. The rings on this page are inside the pills (`outline-offset: -5px`).
- A check that sampled a 20 px column between two round-ended pills found 63% ink: the neck between two round ends is narrower than the pills. The check now samples 6 px at the centre line.
- Later menu items pass the earlier ones on their way out. Drawn in document order they covered the items already in place, so they are drawn last item first.
- A spring with 16% overshoot sent the last menu item past the bottom of the canvas. The menu uses more damping than the button and the dock.

## Not verified

- Frame rate on a phone. Each frame is the element draws twice, one blurred `drawImage()` into a canvas of CSS-pixel size and one filtered `drawImage()` back at full size. The page prints the paints per second of the last animation under the Draw menu, so opening it on the phone and tapping each control gives the number.
- Whether `ctx.filter` with an SVG filter is as fast on Android as in the test browser, and whether it holds the canvas on the phone. No read is made, and no canvas has `willReadFrequently`.
- What a screen reader says. The button, links (`aria-current`, `aria-label`) and `<details>` are native. The disc, the arrow and the bar are drawn by the canvas and have no element.
- Hover on the dock with a real mouse or pen. Touch has no hover, so on a phone the dock shows only the current link leaving the bar.

## Open ideas

- The shader route: the same field in `ElementGL`, where the threshold could also give a rim light and a refraction, as the liquid glass finds do.
- A real `popover` for the menu. An open popover that is a child of a canvas can't be drawn (`/blocked/`), so it would have to be an ordinary element until the pour ends, as `/top-layer/` does.
- The metaball loader (Sasha Birukoff) on a native `<progress>`.
- The punch-out dropdown from the same report: `destination-out` of the trigger's rectangle in the picker of `/select/`.

## For the index

- 2D drawing: `ctx.filter = 'url(#id)'` with an SVG `feColorMatrix` applies to `drawImage()` and gives an alpha threshold with no shader and no read. measured, C157, `/liquid-shapes/`.
- 2D drawing: `drawImage()` of a drawable canvas inside its own `paint` handler copies the element pictures drawn earlier in the handler. measured, C157, `/liquid-shapes/`.
- 2D drawing: `source-atop` clips `drawElementImage()` to what is on the canvas, and the hit box is still the element's whole box at the place of that draw. measured, C157, `/liquid-shapes/`.
- Drawing elements: a `<summary drawable>` and drawable buttons inside the same `<details>` draw separately while it is open. measured, C157, `/liquid-shapes/`.
- Layout: a drawable canvas with padding gets a drawing buffer for its content box, so a scale taken from `clientWidth` is wrong and hit boxes miss the pictures. measured, C157, `/liquid-shapes/`.
