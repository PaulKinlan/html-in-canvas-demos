# A select menu that wraps round its own button (`/punch-out/`, `lib/punch-out.js`)

Measured on 2026-11-24 in headless Chromium 157 (C157, 157.0.8103.78), driven by Playwright with a mouse, the keyboard and emulated touch at 412 px wide. Nothing here has been run on a phone. The idea is the [Punch-Out Dropdown by Fabio Azevedo](https://memorabl.es/work/punch-out-dropdown) ([his post](https://x.com/naso/status/2115214562077163725)), from item 9 of `docs/ui-watch/2026-11-23.md`. The original's source was not read.

`punchOut(select)` adds a sixth layout, `punch-out`, to `lib/select-picker.js` from its own file. The picker's canvas has a 2D context. The page makes no WebGL or WebGPU context. The only pixel reads are in one live check, from a 1 by 1 `drawImage()` copy.

## Placing the picker over the button

| Experiment | Result | Reason or detail |
|---|---|---|
| `left: calc(anchor(left) - 7px); top: calc(anchor(top) - 7px)` on `::picker(select)` with `position-area: none` | fails without `position-anchor: auto` | `left` and `top` computed to 0 and the picker opened at the top left of the window. `position-anchor` computed to `normal`. With `position-anchor: auto` the picker's corner is 7.0 px outside the button's (live check). |
| Three `@position-try` rules (right, up, up and right) in `position-try-fallbacks` on the picker | works | A select at the right edge got the right rule, a select 60 px from the bottom of an 800 px window got the up rule, and one in the bottom right got both. |
| The canvas as the picker's whole box, 18 px larger than the menu on each side for the shadow | the first fallback was taken for a button 16 px from the left edge | The shadow margin counted as overflow. Now the picker's box is the menu's box and the canvas has `margin: -18px`. |
| Moving the button to the other end of its row while the picker is open | the picker and the cut follow | The layout reads both rectangles on every frame (live check). |
| The canvas height | set one frame after opening | It depends on the options' widths, which are 0 while the picker is closed. `prepare()` asks for `picker.refresh()` in a microtask. The first frame is drawn at 300 px with the options at alpha 0. |

## A press on the button under the cut

Each row is a real press with Playwright's mouse on the first select of the page: one press to open, a second on the same point.

| Arrangement | `elementFromPoint()` at the button | The second press |
|---|---|---|
| Menu drawn as an L-shaped path, nothing else (the same for a rectangle with the corner erased by `destination-out`: the pixels are alpha 0 either way) | the canvas | does nothing, the menu stays open |
| `clip-path` on the canvas with the corner missing, picker box left alone | the select | does nothing, the menu stays open. `pointerdown`, `mousedown` and `click` all report the select as their target. The press is on `::picker(select)`, whose box covers the button and has no background. |
| `pointer-events: none` on `::picker(select)`, `auto` on the canvas, `clip-path` on the canvas (as built) | the select | closes the menu on `mousedown` |
| `pointer-events: none` on the canvas, `auto` on the options, no `clip-path` (live check) | the select | not pressed. A point in the menu between two options is on the page behind the menu, so a press there would go to the page. |
| `clip-path` on `::picker(select)` only | the select | closes the menu. The menu's shadow is cut off at the picker's box. |

| Experiment | Result | Reason or detail |
|---|---|---|
| `clip-path: path(…)` on a drawable canvas with `drawable` options | options are drawn and hit as before | 8 of 8 at their centres (live check). |
| The press that opens the menu | its `pointerup` has the canvas as target | The menu opens on `mousedown` and the `clip-path` is set by the first frame. The `click` goes to the select and nothing is chosen. |
| Emulated touch tap on the button with the menu open | closes the menu | And a tap on an option chooses it and fires `input` and `change`. |
| Enter, two arrow keys, Enter | opens, moves in DOM order, chooses | The canvas draws the focus ring. The option's own outline is turned off. |

## The option flow

| Experiment | Result | Reason or detail |
|---|---|---|
| Lines level with the cut shorter than the others | works | 8 test options made 3 lines: 2 options level with the button, 4 in line with it on the far side, none over it (live check). |
| The button at the bottom (menu opens upwards) | reading order kept | Lines are filled from the cut outwards, starting from the last option. A first version mirrored the layout and reversed the order. A second filled from the top and left the line beside the button empty when the last option did not fit there. |
| A button 200 px wide in a 340 px menu | one short option fits beside it | When none fits, the short line is skipped. |

## Things that bit

- `position-anchor` computes to `normal`, which only means the implicit anchor when `position-area` is set. I had set `position-area: none`.
- `elementFromPoint()` returns the select for a point on `::picker(select)`. It can't tell a press that reaches the button from one that the picker's box takes. Only a real press shows the difference.
- A polygon clip with a square corner left a square patch of the menu's shadow at the button's rounded corner. The clip is now a `path()` with the select's `border-radius`.
- The menu's inner corner is rounded by `arcTo()`, which adds fill inside the cut. The clip follows the button's box, 7 px in from the menu's edge, so it doesn't cut that fill.

## Not verified

- A finger press on the button through the cut on Android Chrome, and whether the opening tap leaves anything on the canvas. Opening `/punch-out/` on the phone and reading the list under the selects verifies it.
- The `@position-try` choice with the on-screen keyboard up, or in a window shorter than 220 px.
- A screen reader. The select and its options are the browser's own, so I expect no change from `/select/`, but I didn't run one.
- A select whose button has four different corner radii. The clip reads `border-bottom-right-radius` only.

## For the index

- Customisable select: `anchor()` on `::picker(select)` needs `position-anchor: auto` when `position-area` is `none`. `@position-try` works on the picker. (C157, `/punch-out/`)
- Hit testing: a drawable canvas takes the pointer where it has drawn nothing. `clip-path` on the canvas removes that part of its box and leaves the hit testing of its `drawable` children as it was. (C157, `/punch-out/`)
- Customisable select: a press on `::picker(select)` is reported with the select as its target, and `elementFromPoint()` returns the select, so a transparent picker box over the select's button swallows the press that should close it. `pointer-events: none` on the picker with `auto` on its content fixes it. (C157, `/punch-out/`)
- For `/friction/`: the two rows above (`position-anchor: auto`, and the picker box that `elementFromPoint()` can't see) are new entries of kind "as built". Not added in this pull request because `public/friction/` is another page's folder.
