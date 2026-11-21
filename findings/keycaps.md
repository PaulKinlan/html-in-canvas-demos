# Keycaps drawn from kbd (`/keycaps/`)

Measured in Chromium 157 (headless shell), 2026-11-21, at 412 px wide with a device scale factor of 2 and at 1100 px wide, with Playwright key and mouse input. Not yet run on the test phone (Chrome 159 for Android).

Idea built: "Keycaps from kbd" from `public/elements/ideas.js` (rank 1, text).

## Two routes for drawing a key

| Route | Result | Notes |
|---|---|---|
| Every `<kbd>` has `drawable`, inside a `drawable` section, and is drawn with its own `drawElementImage()` call | measured: works in a small canvas, fails on the page | The nested kbd is left out of the section's picture (0 pixels in its box) and draws alone (183 pixels). On the page, the 12 keys that were below the bottom edge of an 860 px window at load had empty pictures. Scrolling them into the window did not paint them, and `drawElementImage()` did not throw. |
| The section is the only drawable. Each legend is the kbd's box copied from the section's picture with the nine-argument `drawElementImage()` | measured: works, used by the page | 43 keys, one section draw plus 43 piece draws per frame. A final draw at alpha 0 puts the section's hit region back. |

## The picture of a nested drawable

| Question | Result | Notes |
|---|---|---|
| A line of 700 letters (about 6700 px wide) with `drawable`, nested in a drawable section. Letter 3 and letter 690 copied to the canvas | measured: letter 3 draws, letter 690 draws 0 pixels | Live check on the page, expected to fail. Same at 412 px and 1100 px window widths. |
| The same line as a direct child of the canvas | measured: both letters draw | A direct child is recorded whole. |
| Which part of a nested drawable is recorded? | measured: the part inside the window at the place the element was last drawn | On `/split-flap/` a nested drum 822 px wide had letters A to U at rest. While flaps drew its digits (which moves the element's drawn position left), the digits had pictures and the letters did not. |
| What makes the browser record a nested drawable again? | measured: a style change that affects its paint, made while it is inside the window | `text-shadow: 0 0 0 transparent` worked. `outline-color`, `background-position`, `text-decoration-color`, `opacity: .999`, `will-change`, an attribute, the same `color`, rewriting the text node with the same text and `requestPaint()` did not. |
| Is it tied to the site's load hold (`opacity: 0` until the page is stable)? | measured: partly | With `?nohold`, and for a key added after load, the keys below the window had pictures. The cause is not isolated. |

## Input

| Question | Result | Notes |
|---|---|---|
| `keydown` and `keyup` drive the caps | measured: yes | A dispatched `keydown` for "k" moved the legend from 12.5 px to 17.5 px, `keyup` returned it. |
| Does a point on a cap hit test to its `<kbd>` when only the section is drawn? | measured: yes | `elementFromPoint()` returns the kbd, up and held. `pointerdown` has the kbd as its target. |
| Does changing a legend fire `paint`? | measured: yes | `changedElements` holds the section. With nested drawables it held the kbd and the section. |
| `navigator.keyboard.getLayoutMap()` | measured: resolves with 0 keys in the headless browser | Not verified on a desktop with a keyboard. Not defined on Chrome for Android (reported, not run). |

## Things that bit

- Playwright with an emulated viewport and `--force-device-scale-factor` reports `devicePixelRatio` 1 while `devicePixelContentBoxSize` is doubled. Fixtures now read the scale from `canvas.width / clientWidth` at the time of use. Runs use `viewport: null` with `--window-size`.
- Several `<kbd>` elements stand for the same key (two Ctrl keys in the list and one in the block). A key is held by a set of reasons (keyboard, a pointer id, a timer), so releasing one does not release another.
- The page calls `preventDefault()` for Space and the arrow keys only while the keyboard picture has focus, so the page still scrolls normally.

## Not verified

- Chrome 159 for Android: what the on-screen keyboard reports in `keydown` (expected `key: "Unidentified"`, keyCode 229) and in `beforeinput`. The line under the text field prints both.
- A finger held on a cap: whether `pointercancel` arrives when the page starts to scroll and releases the key.
- A hardware keyboard paired with the phone, and `getLayoutMap()` on a desktop with a non-QWERTY layout. To verify: open the page there and read the status line.
- Lost `keyup` on macOS while Command is held. The release-all on Meta up is written from documentation, not run.

## Open ideas

- Read a page's real shortcuts from `accesskey` and `aria-keyshortcuts` attributes and build the sheet from them.
- Gamepad and MIDI keys drawn the same way.
- Keyboard Lock (`navigator.keyboard.lock()`) in fullscreen, so that Esc and browser shortcuts reach the page.

## For the index

- drawElementImage() in a 2D context: the nine-argument form copies a source rectangle (CSS pixels of the element) and can move one part of an element's picture, such as a key legend (measured, C157, `/keycaps/`).
- What is in an element's picture: the picture of a drawable nested in another drawable holds only the part inside the window; a direct child of the canvas is recorded whole (measured, C157, `/keycaps/`, `/split-flap/`).
- Ideas built from `public/elements/ideas.js`: "Keycaps from kbd" is `/keycaps/`.

## Chromium bugs

- A `drawable` element nested in another `drawable` element is recorded clipped to the window (at its last drawn position), and is not recorded again when it scrolls into the window. Reproduction: the last live check on `/keycaps/`. Chromium 157.0.8103.78.

## API requests

- A way to ask for the whole picture of a nested drawable, or documentation of when it is clipped.
