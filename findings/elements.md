# Every HTML element (`/elements/`)

180 entries (each element in the HTML standard, each input type, a few attributes, some obsolete elements) put in a drawable canvas and measured in headless Chromium 157: drawn or not, share of the box with ink, what `elementsFromPoint()` returns at the drawn position, paint events with nothing touching the element, a screenshot compared with the same markup as plain DOM, and checks with real mouse and keyboard input. `ELEMENTS.md` has one row per element; `npm run record:elements` rewrites it and `public/elements/recorded.json`. 150 work, 4 work partly, 3 are blank, 22 have no box, 1 could not be measured (PDF).

| Experiment | Result | Why |
|---|---|---|
| Any element that lays out a box: draw it, hit test it, click it | works | All sectioning, grouping, text-level, table and form elements, including `select multiple`, `details`, `iframe` (same origin), `svg`, `math`, `video` with native controls, a nested drawable canvas and custom elements with shadow trees. |
| Inline element or table part as the drawable child itself | draws as a block | The computed `display` of the drawable child is `block`. A `td` or `tr` drawn alone loses the table layout. |
| Content that overflows the drawn element (`dialog.show()` with the default `position: absolute`, overflowing `nobr` text, inline padding) | clipped | The picture is the element's box. |
| `dialog.showModal()`, `[popover]`, the picker of `select` with `appearance: base-select` | not in the canvas | They are in the top layer and the page paints them. `drawElementImage(dialog)` throws "No cached paint record". |
| CSS anchor positioning from a popover to an anchor drawn in a canvas | works | The popover sits against the drawn position of the anchor, and moves when the anchor is drawn 40 px away. |
| Base-select picker inside a canvas: click an option, or ArrowDown then Enter | fails | `elementFromPoint()` at the option returns the canvas, and the keys leave the value unchanged (they work on the same select outside a canvas). The picker was painted under the drawn select in some runs and not in others. |
| Cross-origin `iframe`, cross-origin `img` without CORS, `object` with a `data:` document | blank | Excluded by read-back-allowed rendering. |
| Click the place where a blank cross-origin `iframe` is drawn | reaches the frame | The frame's button reported the click by `postMessage`. The frame is invisible and live. |
| `geolocation` (permission element) | draws, refuses clicks | `isValid` is false with `invalidReason` "intersection_occluded_or_distorted". Outside a canvas it is true. |
| `video`, animated `img`, `marquee`, indeterminate `progress`, a focused `input` | fire `paint` on their own | Each new frame or caret blink changes the element's picture. No `requestAnimationFrame` loop is needed while one of them is drawn. |
| Captions from `track` | drawn with the video | The active cue is part of the video's picture. |
| `area` in an image map | works | A click on the mapped part of the drawn image follows the link. |
| `[inert]` | works | A click on a drawn inert subtree goes to what is behind it. This is a fix for "undrawn children are still focusable". |
| `[draggable]`, text selection by dragging, `textarea` resize handle, `input type=range` thumb, `input type=file` chooser | work | All at the drawn position. |
| `script`, `style`, `title`, `head` with `display: block` | draw their text | A `style` element with `contenteditable` can be edited in the canvas and its rules apply as you type. |
| Elements with no box (`datalist`, `template`, `slot`, `br`, `wbr`, `source`, `track`, `map`, `audio` without controls, metadata) | nothing to draw | `drawElementImage()` throws "No cached paint record for element". |

Not measured, because headless Chromium does not show native popup windows: where the list of a plain `select`, the date, time and colour pickers, `datalist` suggestions and `title` tooltips appear when the element is drawn transformed. The PDF viewer is also missing there. `hidden=until-found` needs find-in-page driven by a person.

Two things the measurements had to work around. The page's stylesheet restyles test markup, so fixtures live in a shadow root. And a click on a new canvas at the spot where the pointer already rested did not focus the element under it until the pointer moved.

## 17 ideas from the catalogue, built (`/element-ideas/`)

Each demo keeps the real element and draws it with a 2D canvas. Tested in headless Chromium 157 with mouse, keyboard and emulated touch (`npm run check:ideas`).

| Experiment | Result | Detail |
| --- | --- | --- |
| `drawable` on `<option>` in `<select multiple>`, `<li>` in `<ul>` and `<menu>`, `<th>` and `<td>` in a table | works | Each one is drawn on its own and has its own hit region. The parent is not drawn and keeps its job: the select owns the selection, the table lays out the cells. |
| `drawElementImage(el, x, y)` with no size, under `ctx.scale(devicePixelRatio)` | too large on a phone | With no size the picture is drawn at the element's size in device pixels, so the scale is applied twice: 3 times too large at a pixel ratio of 3, and the hit region with it. Correct at a ratio of 1, which is why the first tests passed. Pass the size in CSS pixels: `drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight)`. Playwright's `deviceScaleFactor` does not show this, `--force-device-scale-factor` does. |
| A draw with `globalAlpha = 0`, or clipped away completely | moves the hit region | Used to say where input goes after the element was drawn in distorted pieces (CRT bulge, raised room). |
| `<input type="range">` drawn rotated 90 degrees, mouse drag | works | Up raises the value. |
| The same, touch drag | fails | A tap on the track is mapped through the rotation, a drag is not followed. A slider drawn at 17 degrees drags by touch. Chrome appears to test the drag's direction in screen space for a horizontal slider. The page sets the value from the pointer. Also needs `touch-action: none`. |
| `<area>` on an image drawn rotated 45 degrees and scaled to half height | works | The click target is the area. Tab moves between areas. |
| `<dialog>` opened with `show()`, drawn with a blurred page behind it | works | Needs `position: static`. The page adds `inert` on the content behind, Escape and focus return. |
| `popover` anchored to a `popovertarget` button that the canvas moves each frame | works | The popover follows with no script. `showPopover()` from script needs `{ source: button }` or there is no anchor. |
| Hide an element by moving its hit region far away with `updateElementGeometry()`, then focus it | scrolls the page | The page scrolls towards the far place. Shrinking the region to a point inside the canvas does not. |
| `ctx.filter` (blur, grayscale, brightness) and `globalCompositeOperation` (`lighter`, `destination-in`) on element pictures | work | Glow, dialog backdrop, LED dot mask. |
| `getClientRects()` on `<ins>`, `<del>` and MathML tokens inside a drawn element | works | Boxes are in the drawn position, so differences between two boxes of one element are layout offsets. |
| A scroll container in the canvas, scrolled by script, then scrolled back and replayed as an animation | works | `window.find()` in headless Chromium does not scroll a container, in or out of a canvas, so the page's own search form is what was tested. |
| `<video controls>` drawn three times (blurred, mirrored, sheared) | works | Controls and captions are in every copy. The controls take clicks on the last copy drawn. |
| `<marquee>` enlarged and masked | works | 60 `paint` events a second with no timer. The link inside is hit on the enlarged picture. |

Not verified: the browser's find-in-page on `/element-ideas/#find`, whether Chrome on Android has a list box for `<select multiple>` (the wheel shows a message if the options have no boxes), and the touch-drag result on a real phone.
