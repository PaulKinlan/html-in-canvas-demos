# Origami boarding pass and tear-off stub (`/origami-ticket/`)

Not verified in a live browser as of 2026-11-22. Built and checked statically (`npm run check:gfx` and `tools/writing/check.mjs --strict`), waiting for a run in C157 and on A159.

Direct inspirations: `/accordion/` (sheared-strip `<details>` folding on a 2D canvas), `/view-source/` (paper-peel interaction), and physical boarding-pass tear-off stubs in mobile wallet UIs.

| Question | Result | Notes |
|---|---|---|
| Four sheared nine-argument `drawElementImage()` strips folding a boarding pass across creases | not verified | Drawn with alternating affine shear and cosine foreshortening (`drawFoldedPass()`). Check 1 tests ink inside the foreshortened half vs the vacated area on a plain `drawImage()` copy. |
| Two sibling `drawable` halves (`#pass-main` and `#pass-stub`) keeping independent hit targets after tearing apart | not verified | Both halves stay live `drawable` elements inside one `<canvas content="drawable" layoutsubtree>`. Check 2 draws `#fm` and a displaced, rotated `#fs`, toggles `data-hit`, and runs `elementFromPoint()` on buttons in both. |
| Restoring a full hit box after a nine-argument slice using an empty-clip five-argument draw | not verified | Follows the empty-clip pattern from `/lib/text-canvas.js` (`home()`). Check 3 draws a 70 px slice of a 220 px element, restores its hit box with an empty clip, and hit-tests a button at `x = 175`. |
| Jagged sawtooth polygon clip over nine-argument `drawElementImage()` | not verified | `clipSerrated()` clips complementary teeth along the perforation seam. Check 4 samples ink left and right of the teeth via a plain `drawImage()` copy. |
| Brief `captureElementImage()` motion trail closed immediately when the spring settles | not verified | The fling animation captures one snapshot of `#pass-stub`, fades it out, and calls `close()` as soon as the spring settles (or on rejoin, `contextlost`, or `pagehide`). Check 5 verifies drawing before `close()` and throwing after `close()`, with cleanup in `try/finally`. |
| Unclipped five-argument draws at rest (`fold <= 0.01`, untorn) | not verified | Avoids any hit-box shrink while editing the `<input>`, changing `<select>`, ticking the checkbox, or pressing buttons. |

## Design tradeoffs

- **Two sibling `drawable` children vs one wrapper.** If the whole boarding pass were one `drawable` node, tearing the stub away into a second rotated position would leave only whichever draw ran last with a live hit box. Splitting into `#pass-main` and `#pass-stub` lets both halves stay clickable and editable at separate transforms after the tear, while drawing side by side with zero gap when untorn.
- **Perforation touch drag vs form controls.** Putting `touch-action: none` on the dedicated `#seam-handle` pill and keeping `touch-action: pan-y` on `#stage-canvas` avoids blocking page scroll on a 412 px phone, while ignoring `pointerdown` events that start on `input`, `select`, `button`, or `label` leaves native typing and taps alone.
- **No `getImageData()` on drawable canvases.** Every pixel check in the live checks copies the fixture canvas into a plain 2D canvas with `willReadFrequently: true` via `drawImage()`, reads from the copy, and calls `window.__gfx?.retire(copy)` before zeroing it.

## Not verified

- Running the six live checks in C157 (headless Chromium) and confirming all six pass with zero layout shift (`npm run check:jank -- /origami-ticket/`) and zero draw-size mismatches (`node tools/draw-size/audit.mjs /origami-ticket/`).
- Real-device frame rate and touch feel on A159 (Chrome 159 on Android, 412 px wide, device pixel ratio 2.625), including vertical perforation tearing on narrow screens and hit accuracy on the rotated detached stub.
- Native `<select>` popup placement while folded or torn, and TalkBack / VoiceOver focus order between `#pass-main` and `#pass-stub`. Open the page on an Android phone with TalkBack on, fold and tear the ticket, and step through the controls to verify.

## For the index

- Transitions and motion: Four-panel sheared origami folding and serrated tear-off splitting of two sibling `drawable` boarding-pass halves on one 2D canvas. not verified, `/origami-ticket/`.
