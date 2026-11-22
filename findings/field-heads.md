# Fields and headings: datalist, password, selectedcontent, title and hgroup (`/field-heads/`)

Backlog group 28 in PLAN.md, ideas 28.1, 28.2, 28.3, 28.15 and 28.18. These are the last five of group 28. Measured in headless Chromium 157 (C157) on 2026-11-22 at 412 px wide. The page's five live checks pass there, and `node tools/field-heads/check.mjs` drives the five demos by touch (27 steps, all pass). Nothing here has been run on a phone.

The question: what can a canvas take from a form field or a heading beyond its picture?

| Experiment | Result | Why |
|---|---|---|
| `input.list.options` for a drawable field whose `<datalist>` is inside the canvas | Oban, Mallaig, Portree; the datalist is 0 by 0 px | Datalist as a ring of chips (28.1) reads eight options, removes the `list` attribute and draws the chips itself. |
| `input.list` after `removeAttribute('list')` | null | The browser then opens no list of its own over the canvas. The attribute is put back when the canvas stops drawing. |
| Typing "ta" in the drawn field; a touch tap on the canvas where the first chip is drawn | 1 of 8 chips match; the field's value became Oban | The chips are not elements. The tap is a `click` whose target is the canvas, compared with the chip shapes. |
| Dark pixels in the picture of two password fields with different values of 13 characters, one of 12, and a text field | 247 and 247, identical pixels; 228; the text field differs | Password field in a shared view (28.2): the picture of a password field gives away its length only. |
| The same field after `type = 'text'` | the picture holds the characters | The demo's second copy of the form draws that field through `blur(7px)` with a red frame while its type is not `password`. |
| `<selectedcontent>` in a base-select `<select>` drawn in a canvas | holds `<b>Red</b> buoy` in a box of 72 by 20 px; after `select.value = "b"` it holds `<i>Green</i> buoy` | Hero picture from selectedcontent (28.3) draws the select clipped to that box, 3.4 times as large (box 101 by 32 px for Starboard, 81 by 32 for Danger). |
| A touch tap on the drawn select, then on an option | the picker opened (`:open`), the value changed to danger | The picker is in the top layer, over the canvas. |
| A `<title>` with `display: block` inside a canvas | 200 by 29 px, `HTMLTitleElement`, 84 of 200 pixels in a row across it drawn | Title element as a heading (28.15) moves the page's own title into the canvas (340 by 150 px there). |
| `document.title` with the title element inside the canvas, after typing | "Tide table for Oban", and the drawn heading reads the same | It is still the first title element in the document. |
| A `Range` over each character of a paragraph in an `<hgroup>` | 34 of 34 characters have a rectangle, on 2 lines; 61 of 61 on 3 lines in the demo | Subtitle typed under its heading (28.18): the paragraph is revealed by clips made from those rectangles, 38 ms a character. |
| A lost context | plain HTML | One `contextlost` event stops the five canvases and shows the elements as plain HTML (5 boxes), and `input.list` is the datalist again. Tested by dispatching the event. |

## Things that bit

- The first shadow under the title heading was a skewed second draw. It crossed the heading's own lines and made them hard to read. It is now a blurred draw offset by 5 and 8 px.
- `selectedcontent.textContent` includes the option's `<small>` note, which the page's style sheet hides in the button, so the text in the line under the demo is longer than what the box shows.

## Not verified

- Chrome 159 on Android: the five demos by touch.
- The on-screen keyboard over the ring: whether the chips stay in view while typing.
- A password manager or autofill in the drawn password field, and whether a real screen share shows the same pixels as the canvas copy.
- The picker of a customisable select on a phone, which may be a native sheet.
- What the tab strip and the task switcher show for a title element that is inside a canvas.

## For the index

- Forms: `input.list.options` works for a field in a canvas; a datalist has no box; removing `list` stops the browser's own list. C157, `/field-heads/`.
- Forms: the picture of a password field is the same for two values of one length.
- Select: `<selectedcontent>` has a box inside the select's picture and can be drawn alone with a clip.
- Document: a `<title>` moved into a canvas with `display: block` is drawn and still sets `document.title`.
