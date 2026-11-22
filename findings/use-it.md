# Use it: the smallest working markup for nine drop-in elements (`/use-it/`)

Backlog item 30.2 in PLAN.md ("A Use it block for every library"). Measured in headless Chromium 157 (C157) on 2026-11-22 at 412 px wide. The page's four live checks pass there, and `node tools/use-it/check.mjs` drives the nine elements by touch (20 steps, all pass). Nothing here has been run on a phone.

The question: what is the least a page on another site has to write to use each drop-in element from this site's libraries?

The page is one place for all the blocks, not a block added to each library's own page. Each box runs markup that is in the page source between two region comments, and the listing under it is that text with the script tag of the library put first. A live check fetches the page and compares the two.

| Element | Library | Result at 412 px by touch |
|---|---|---|
| `<effect-frame effect="glass">` | `effect-frame.js` | upgraded, 1 canvas; typing in the field inside it worked |
| `<selection-fx effect="marker">` | `selection-fx.js` | upgraded; a double click selected a word and the marker was drawn |
| `<glyph-field pointer="repel">` | `glyph-field.js` | upgraded; the link inside is found by a hit test; `explode()` from a button |
| `<select picker="wheel">` | `select-picker.js` | a tap opened the wheel; the value stayed 06:45 after the fix below |
| `<canvas-slot>` with `onrender` | `canvas-slot.js` | a tap unticked the checkbox of the card drawn turned by -0.08 rad |
| `<dom-portal for scale="0.7">` | `dom-portal.js` | typing in the copy changed the one input (C14 to C147) |
| `<dom-lens pipeline="2d">` | `dom-lens.js` | upgraded, 1 canvas, the lens follows the pointer |
| `<input list picker="chips">` | `datalist-picker.js` | `input.list` is null; typing "t" opened a popover with three pills |
| `<input type="time" picker="clock">` | `input-pickers.js` | a tap opened the clock |

## A fault this found

`select-picker.js` moved the options of a select into its canvas one at a time and then put the canvas in the select. While the options were outside, none was the select's option, and when they came back the select chose the last one. Markup with `<option selected>06:45</option>` showed 09:05. `/select/` did not show this because its options are added by script and the value is set afterwards. The library now reads `selectedIndex` before the move and sets it again after. This pull request changes that one function in `public/lib/select-picker.js`.

## Things that bit

- `el.onrender = …` set on a `<canvas-slot>` before its library has loaded becomes an own property that hides the class field. The listing waits for `customElements.whenDefined('canvas-slot')` first.
- `effect="glass"` on a small form with 14 px text reads as broken. The box now holds a heading and a line of text at `amount="0.7"`.

## Not verified

- Chrome 159 on Android: all nine by touch.
- The snippets pasted into a page on another origin. Both live hosts send `Access-Control-Allow-Origin: *` for `/lib/` (checked for a static file on 2026-11-22), and module scripts need it. Each library imports its helpers by relative path.
- A browser with no HTML-in-canvas API. Each library says it leaves its children as plain HTML there.

## For the index

- Libraries: `/use-it/` is the copy-and-paste block for nine drop-in elements, each on a 2D canvas.
- Select: `select-picker.js` kept the wrong option when the markup had `selected`. Fixed 2026-11-22.

## Open ideas

- The same page for the shader elements (`fx`, `<physical-ui>`, `<live-transition>`), one WebGL context at a time, started by a tap.
- A check that loads each snippet in an iframe on the second origin.
