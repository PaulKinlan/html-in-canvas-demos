# Small controls drawn over radios, toggle buttons, a password field and checkboxes (`/small-controls/`, `lib/ui-feed/small.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-26, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [scene-controls.md](scene-controls.md) and the files it lists. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<type-styles>` | type styles (carousel), o-67 | a radio group, one radio per typeface, drawn as the dots; an inert row of cards drawn as slices; an empty `<div>` that takes drags |
| `<format-bar>` | text formatting (tooltip), o-83 | three `<button aria-pressed>` in a `role="toolbar"` with `aria-keyshortcuts`, one `<div role="tooltip">`, and a sample line that takes the marks |
| `<presence-avatar>` | back online (avatar), o-91 | a `<button aria-pressed>` (pressed is online), an inert bold copy of the initials, an `<output role="status">` |
| `<password-reveal>` | show and hide (password), o-43 | an `<input type="password" minlength>` with transparent text, a `<button aria-pressed>` that switches its type, a hint the field names in `aria-describedby` |
| `<topic-list>` | newsletter topics (listbox), o-44 | an `<ol>` of `<label>`s round checkboxes, and an inert italic copy of the list |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a radio group be the value of a carousel whose cards are squeezed slices of one row? | measured: yes | A drag of 130 units to the left moved from `style=b` to `style=c` and settled there. The first dot took the pointer as the first radio, and a click on it gave `style=a`. |
| Do toggle buttons with shortcuts and a tooltip work in a drawn toolbar? | measured: yes | A click on I gave `f=bold f=italic` and the sample went italic; Ctrl+U added underline. ArrowRight moved focus from B to I and the tooltip read "Italic Ctrl+I". Escape hid it. |
| Can an avatar's fill spread out of its status badge? | measured: yes | A click gave `s=online`, `aria-pressed="true"` and the status "Ada Byron is back online". The fill was a quarter grown at 80 ms and whole at rest. |
| Can the canvas draw the dots of a password field? | measured: yes | Three characters gave 3 dots one character apart, the newest still popping, while the field's own text is transparent. The form was invalid (`tooShort`) until eight characters. The eye made the field `type="text"` and its label "Hide password". |
| Can a chosen row be drawn from an italic copy of the list? | measured: yes | A click on the second row gave `t=a t=b`; the row was 27% italic 40 ms later and all italic at rest. The copy is inert, hidden and has no checkboxes. |
| Do touches work? | measured: yes (emulated Pixel 7, CDP touch events) | A drag on the cards moved to the next style and a tap at the side to the one after. Taps on I and U toggled them, a tap on the avatar put it online, typing gave 7 dots, a tap on the eye showed the text, a tap on a row checked it. Vertical swipes on the cards and the list scrolled the page by 185 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the list was plain HTML with its checkboxes, and a click on the second checked it. |
| Do the controls stop painting? | measured: yes | 0 paint events in 500 ms at rest for each of the five. |

## Things that bit

- A press on the cards sent focus to the first radio through `delegatesFocus`. `preventDefault()` on `pointerdown` stopped it, and a drag moves focus to the chosen radio only when a radio already had it.
- `elementFromPoint()` over the avatar returned the span inside the button, not the button.
- `ElementInternals.setFormValue()` sends nothing if the element has no `name`.
- The checkboxes in the topic list were placed against the `<ol>` until each `<li>` was `position: relative`.
- The typefaces of the originals aren't in the test browser, so each card's "Aa" is styled with transforms and weights from its `data-style` and the cards still differ.
- A shortcut lookup that returned `false` passed a `>= 0` test.

## Not verified

- Everything on a phone.
- What a screen reader says for each: the radio group under the cards, the tooltip named by three buttons, the status line, the password hint.
- The fonts. The originals use a display face, a serif italic and a terminal font.
- The on-screen keyboard over the password field, and whether its caret lines up with the drawn dots there.

## For the index

- `/small-controls/`: five ui-feed.dev demos rebuilt on native elements (type styles, text formatting, back online, show and hide, newsletter topics).
- A transparent password field and a hidden copy of its value in the same font are enough to draw the dots anywhere.
- An inert, hidden copy of a list in another style can be crossfaded with the real one, row by row.
