# Sliders that bend, dip and swell (`/elastic-range/`, `lib/slice-draw.js`)

Measured in C157 (headless shell, 412 px and 1280 px wide, device scale 1, 2 and 2.625, mouse, touch emulation and keyboard) on 2026-11-23. Not yet run on A159.

The page comes from the weekly search for interface work (`docs/ui-watch/2026-11-23.md`). The ideas are Gabriel Obholz's Elastic Volume Slider, Shiv's Wave Slider and Nitish Khagwal's Ruler Picker, and the page links to all three. The code and the copy are mine: I didn't read their source.

| Question | Result | Notes |
|---|---|---|
| A range input styled with `::-webkit-slider-runnable-track` and `::-webkit-slider-thumb`, drawn by a canvas | works | Live check: the thumb is rgb(255,0,0) and the track rgb(34,68,102), as styled. |
| Bend a picture in a 2D context | works, as strips | `drawSlices()` draws the whole input once for each strip, clipped to the strip, under its own transform. Strips 2 or 3 px wide with 0.6 px of overlap show no steps or seams at device scale 2 and 2.625. |
| A strip raised and sheared | works | Live check: 100% ink 30 px above the layout place and 0% in the lower part of it. |
| A strip drawn at twice its width | works | Live check: 100 px of input covers 200 px, and the thumb's leading edge is at the far end. |
| Native dragging while the picture is bent | works | Each frame ends with one draw at `globalAlpha` 0 at the layout place. Live check: before it the input was hit 40 px up, after it only on the straight line. |
| A change of `value` raises `paint` | works | Live check: 1 paint event after `input.value = 80`, and the thumb is drawn at 80%. |
| Speed | 60 paints a second | 100 strips (string), 38 strips (bars) and 150 strips (ruler) of a 300 px input, software rendering. The page prints the number for the device after each movement. |
| Pull the string by touch | works in emulation | Touch moved 64 px right and 40 px up: value 30 to 54, bend 40 px, page scroll 0. The input has `touch-action: none`. |
| Keyboard | works | Arrow keys change the value and pluck the string. The bars dip and the ruler swells on `:focus-visible`. |
| Reduced motion | no movement | The string follows a pull while held and returns at once. Pluck does nothing. |
| No API | plain HTML | Three styled range inputs. |
| `<rangegroup>` | not in C157 | `document.createElement('rangegroup')` is an `HTMLUnknownElement`. The check is on the page and will pass where the element exists. |
| `npm run check:jank` | passes | cls 0, no flashes, 0 reads, 7.9 MB in canvases. |

## Things that bit

- With one slope on each side of the thumb, the thumb's picture was cut down the middle and each half was sheared a different way. The strips within 14 px of the thumb's centre are now raised and not sheared.
- The bars first dipped 16 px. The thumb is drawn once more, whole, on top, and pieces of the dipped thumb showed below it. The dip is now 10 px with the bars scaled to 45%, which keeps the dipped pieces behind the whole thumb.
- A spring with damping 5 took 6.4 s to come to rest. It is 8 now and the twang lasts about 2.3 s.

## Not verified

- A finger on a real phone: pulling the string up and down while the browser drags the thumb, and the paint rate there.
- What 150 draws of one element a frame cost on Android. Each strip is a clipped draw of the same picture.
- What a screen reader says. The inputs are native with `aria-label`, and the reading is an `<output for>`.
- Firefox and Safari, which don't have the API and use other pseudo-elements for the track. They get the plain inputs with default styling.

## Open ideas

- Two thumbs on one bent track when `<rangegroup>` ships.
- Digits that roll in the ruler's `<output>`.
- The same strips across the other axis, for a vertical slider or a page that sags.
- A WebGL version with a mesh, to compare cost with 150 clipped draws.

## For the index

- 2D drawing: a picture can be bent in a 2D context by drawing the element once for each 2 or 3 px strip, clipped, with a translate, scale and shear. 150 strips a frame drew at 60 paints a second in software. measured, C157, `/elastic-range/`.
- Input: after many clipped and transformed draws of an element, one whole draw at `globalAlpha` 0 at its layout place puts the hit box there, so a native range drag works under a bent picture. measured, C157, `/elastic-range/`.
- Elements: `::-webkit-slider-runnable-track` and `::-webkit-slider-thumb` styles are in a range input's picture, and a change of `value` raises `paint`. measured, C157, `/elastic-range/`.
- Elements: C157 has no `<rangegroup>`. measured, C157, `/elastic-range/`.
