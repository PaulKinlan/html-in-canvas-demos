# `EditContext` and inline widgets (`/edit-context/`)

Built 2026-11-26. Live browser checks are not yet verified in C157 (headless Chromium) or A159 (Chrome on Android); static syntax, graphics rules, page metadata and writing checks are run below.

| Question | Result | Notes |
|---|---|---|
| `typeof EditContext === 'function'` available | not verified | Checked by live check 1 on `/edit-context/` when tapped. |
| `canvas.editContext = new EditContext(...)` on a `content="drawable" layoutsubtree` canvas | not verified | Checked by live check 2 on `/edit-context/` when tapped. |
| `updateText()`, `updateSelection()`, `updateControlBounds()`, `updateSelectionBounds()` and `updateCharacterBounds()` alongside `drawElementImage()` | not verified | Checked by live check 3 on `/edit-context/` when tapped, with pixel verification via a plain `willReadFrequently` copy canvas. |
| Focus transition `canvas` (`EditContext`) -> drawable `<input>` child -> `canvas` without dropping `paint` events | not verified | Checked by live check 4 on `/edit-context/` when tapped. |
| Typing into an inline drawable `<input>` does not fire `textupdate` on the parent canvas's `EditContext` | not verified | Checked by live check 5 on `/edit-context/` when tapped. |
| Comparison: drawable `contenteditable` child inside a canvas | not verified | Checked by live check 6 and the side-by-side comparison section on `/edit-context/`. |

## Things that bit

- `keydown` and `pointerdown` bubble from drawable child controls (`<input>`, `<select>`, `<button>`) up to the parent `<canvas>`. Without an early `if (e.target !== canvas) return;` guard, clicking a widget steals focus back to the canvas and arrow keys or Enter inside a widget mutate the canvas buffer instead of the control.
- Moving an inline widget when typing changes line length or line count can leave Chromium's hit-test cache at the old position unless an attribute on the widget is toggled once when `(x, y)` changes.
- A drawable child that scrolls out of the visible code area stays in the Tab order unless `el.inert = true` is set when `onpaint` skips drawing it.
- Reading pixels back for the `stillDrawn()` check must copy the drawable canvas into a plain off-DOM 2D canvas with `willReadFrequently: true` rather than calling `getImageData()` on the drawable canvas directly.

## Not verified

- Running the 7 live checks on `/edit-context/` in headless Chromium 157 and on Android Chrome 159 (press "Run these 7 checks" on `/edit-context/`).
- Real OS IME composition and candidate window alignment (Japanese, Chinese or Korean desktop IME and Android Gboard) against `updateControlBounds()`, `updateSelectionBounds()` and `updateCharacterBounds()`.
- Native popup placement for inline `<input type="color">` and `<select>` drawn inside the canvas on desktop and Android Chrome 159.
- Real Tab / Shift+Tab navigation and virtual keyboard bring-up on Android Chrome 159 when tapping between canvas text and inline drawable widgets.
- Screen reader announcements for `<canvas role="textbox">` alongside native drawable child controls.

## For the index

- Text input and IME: `EditContext` attached to a drawable `<canvas content="drawable" layoutsubtree tabindex="0">` with inline drawable `<input>`, `<select>` and `<button>` controls and a side-by-side `contenteditable` comparison. not verified, `/edit-context/`.
