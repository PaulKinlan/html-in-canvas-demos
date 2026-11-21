# A Qt Quick `TextField` backed by an `<input>` (`/qt-textfield/`)

Measured in C157 (headless Chromium 157.0.8103.78, 2.625 device scale, 412 px wide, touch) on 2026-11-21, by Playwright scripts and by the page's live checks. Qt Quick 6.10.3 for WebAssembly (single thread, Basic style, WebGL2), Emscripten 4.0.7. Source in `native/qt-textfield/`. The build is 23.4 MB of WebAssembly (22.3 MiB) and 264 KB of JavaScript, loaded after a tap. PLAN.md backlog item 27.1.

The app has three pairs of fields: email, password and a code from a text message. In each pair the first is Qt's `TextField` and the second is `DomTextField.qml`, which is the Basic style's background with a `DomItem` holding a real `<input>`. Nothing on this page was run on a phone. The page writes its event log and its tables from real events so that the same measurements can be read on the phone.

## What the browser is given

| Question | Qt `TextField` | `DomTextField` |
| --- | --- | --- |
| Element that has focus | One `<input class="qt-window-input-element" contenteditable="true" type="text">` for all three fields, in Qt's shadow root, a child of `div.qt-window` | The field's own `<input>`, a child of `canvas.qt-window-canvas` in the same shadow root |
| `document.activeElement` | `div#qt-shadow-container` (the shadow host). `shadowRoot.activeElement` is the hidden input | The same host. `shadowRoot.activeElement` is the field's input |
| `type` | `text`. `password` when `echoMode` is `TextInput.Password` | `email`, `password`, `text` |
| `inputmode` | `email` for `Qt.ImhEmailCharactersOnly`, `numeric` for `Qt.ImhDigitsOnly`, `text` for the password field | not set, not set, `numeric` |
| `autocomplete`, `name`, `id`, label | none of them. QML's `TextField` has no property for them | `email`, `current-password`, `one-time-code`; `name` and `aria-label` set |
| `autocapitalize`, `enterkeyhint` | not set | as written in the markup (`autocapitalize="none"` on email, `enterkeyhint="done"` on the code field) |
| `<form>` | none | none |
| Box of the focused element | 9 by 7 px at the top left corner of the Qt window, for every field | 352 by 36 px, the field |
| Distance from that box to where Qt drew the caret or the field | 62 px (email), 207 px (password), 354 px (code) | 0 px |
| A point on the field hits | the canvas | the input |
| `value` of the focused element | empty after "abcd" was typed. During a composition it holds the composition string only | the field's text |

## Typing, composition, selection, focus

Composition was sent through the DevTools protocol: `Input.imeSetComposition` with "に", "にほ" and "にほん", then `Input.insertText` with "日本". This goes through the browser's input method path and fires composition events. It is not a real IME.

| Experiment | Qt `TextField` | `DomTextField` |
| --- | --- | --- |
| Key presses "ab" | `keydown` on the hidden input, no `beforeinput` or `input` logged. `TextField.text` is "ab" | `keydown`, `beforeinput` and `input` (`insertText`) per key. `DomTextField.text` is "ab" |
| Events during the composition | `compositionstart`, then `compositionupdate`, `beforeinput` and `input` (`insertCompositionText`, `isComposing` true) for each update, then `compositionend` | the same events |
| Composition in an empty field | `preeditText` is "にほん", `text` stays empty until the commit, then "日本" | `value` and `DomTextField.text` are "に", "にほ", "にほん", then "日本" |
| Composition in a field that holds "abcd" | **text is lost.** After each update `text` was "bcd", "d", then empty. Final text "日本". With one update and a commit of "日" the field ended as "cd日". The same on a fresh page load and in the code field ("1234" became "34日") | "abcdに", "abcdにほ", "abcdにほん", final "abcd日本" |
| Uncommitted text in Qt's pixels | drawn, underlined, as three empty boxes: Qt's bundled DejaVu Sans has no Japanese glyphs | drawn with the browser's fallback font. No composition underline in the picture (seen in a screenshot) |
| A QML binding on `text` during composition | does not change until the commit | changes on every update: the label read "Hello, にほん" |
| `page.keyboard.insertText("xy")` | `beforeinput` and `input` (`insertText`), text "xy" | the same |
| Arrow keys, Backspace, Shift+Arrow selection, typing over a selection | works | works |
| Control+A | selects all, drawn in the highlight colour | selects all, drawn with the `::selection` rule from the stylesheet in the shadow root |
| Tap inside the text places the caret | yes ("hel\|lo world") | yes ("hel\|lo world") |
| Two taps on a word | no selection. The next key was inserted at the caret | the word is selected. The next key replaced it |
| Tap past the end of the text while everything is selected, then type "Z" | selection cleared, "Z" appended | selection kept, "Z" replaced everything. A plain `<input type="email">` outside a canvas, same steps, cleared the selection. Cause not identified |
| Caret drawn | by Qt | by the browser, in the element's picture. It blinks in Qt's pixels |
| Tab through the six fields, and Shift+Tab back | Qt's own focus chain | needs the bridge: `DomItem` handles the Tab `keydown`, calls `nextItemInFocusChain()`, and focuses the element when Qt's Tab reaches the item. With it, 9 Tab presses and 6 Shift+Tab presses visited the fields in layout order, wrapping at the end |
| Tap on an empty part of the Qt window while a field has focus | the hidden input keeps focus | the input keeps focus |
| QML reads and writes `text` | `Label` and `Button` bindings work | the same bindings work. `domCode.text = ""` in a button handler emptied the input |
| The focus border | `activeFocus` | `DomItem.domFocus`, set from the element's `focus` and `blur` events |

## Live checks on the page

10 checks, on a second copy of the app in a frame opened with `?nofocus`, where `HTMLElement.prototype.focus` records the call and does not run it. 8 pass. 2 fail and are marked as expected: "Qt's hidden input has an autocomplete or a name attribute" and "Qt's hidden input is at the caret of the focused TextField" (354 px away in the frame).

`npm run check:jank -- /qt-textfield/`: cls 0, scroll 0, focus 0, 0 WebGL contexts before the tap. With `--checks`: the same, focus 0.

## Things that bit

- Qt 6.10.3 calls `focus()` on a hidden `div.qt-window-focus-helper` whenever a Qt item that takes no text gets Qt's active focus. The `DomItem` takes Qt's active focus when its element is focused (so that a Qt `TextField` drops its caret), and Qt then blurred the element at once. `DomItem` replaces `focus` on that one element with a function that does nothing while a `DomItem` has Qt's active focus. In the measured session it stopped 16 calls.
- `focusin` and `focusout` between two elements of one shadow root do not leave the shadow root. A listener on `window` saw none of them. The log listens on the shadow root.
- `<input type="email">` has no `selectionStart`. The caret measurements type a marker character and read the value.
- Playwright hides the caret in screenshots by default. `caret: 'initial'` shows that the browser's caret is in the element's picture.
- Page styles do not reach Qt's shadow root. Instead of copying computed styles inline, `start.js` appends a `<link rel="stylesheet">` to the shadow root, so `::placeholder`, `::selection` and `:autofill` rules apply.
- The `??=` operator inside `EM_JS` is read as a trigraph by the C preprocessor and gives a warning.

## Not verified

All of these need Chrome on an Android phone. Open `/qt-textfield/`, tap "Load the Qt app", do the step, then tap "Copy the log" and send the text.

- **Autofill.** Headless Chromium has no saved data, so no field was ever autofilled and `:autofill` never matched. On the phone, with a saved email address and a saved password for the site: tap the DOM email field, then the DOM password field, and note whether Chrome shows a suggestion above the keyboard or the password manager's sheet. Do the same for the two Qt fields. The log writes "now matches :autofill" when a value is filled in. Also not known: whether Chrome's autofill considers an input that is a child of a canvas inside a shadow root with no `<form>`, and whether its popup is placed at the box set by `updateElementGeometry()`.
- **One-time codes.** Tap the DOM code field after a text message with a code arrives and note whether the keyboard offers it. `autocomplete="one-time-code"` is on the DOM field only.
- **The keyboard that opens.** Note for each field which keyboard appears (email layout, digits). The table above gives the attributes; the keyboard itself was not seen. The `visualViewport` lines in the log show the height change.
- **A real IME.** With a Japanese, Chinese or Korean keyboard: type a few Latin letters in the Qt email field, then compose a word, and see whether the letters survive. Do the same in the DOM field. The scripted composition deleted them in the Qt field. Note where the candidate window appears for each field: Qt's hidden input is at the top left corner of the Qt window, the DOM input is at the field.
- **Scroll into view.** Tap the lowest Qt field and the lowest DOM field with the keyboard closed and note whether the field stays visible above the keyboard. Chrome scrolls the focused element's box, which for Qt's fields is the window corner.
- **Touch selection.** Long-press a word in each field. Selection handles, the cut and paste menu and the magnifier were not seen in headless Chromium. Two scripted taps selected a word in the DOM field only.
- **Fonts.** The stylesheet asks for "DejaVu Sans", which is installed on the test machine and is Qt's bundled font, so the two fields matched there. Android has no DejaVu Sans, so the DOM field will fall back to the system font and the two fields will differ. Not seen.
- **The "next" key of the keyboard.** Whether it moves from a DOM field to the Qt field after it. The Tab bridge handles a `Tab` key event only.
- **A lost WebGL context.** The page shows a message on `webglcontextlost`. The event was not forced.
- **A screen reader.** The DOM inputs have `aria-label`, but Qt sets `aria-hidden="true"` on its canvas, which is their parent. Whether a screen reader reaches them was not tested.
- The tap that does not clear a full selection in the DOM field: whether it happens with a finger, and why.

## Open ideas

- Give Qt's own hidden input an `autocomplete` and a `name` from the page when a given `TextField` has focus, and move its box to the caret with CSS, to see how much of the gap closes without replacing the field.
- Wrap the DOM fields in a `<form>` inside the canvas with a submit button, for password managers that save on submit.
- Report the composition result to the Qt project if a real IME shows the same loss of text.

## For the index

- Native toolkits: `/qt-textfield/`: a QML text field whose text is a real `<input>` drawn with `texElementSubImage2D()`, two-way bound to a QML property, compared with Qt's `TextField` for keyboard hints, autofill attributes, composition and focus. Backlog item 27.1.
- Input and focus: `focusin` between elements of one shadow root is not seen on `window` (C157, measured).
- Input and focus: a tap past the end of the text in a canvas-drawn `<input>` keeps a full selection; a plain input clears it (C157, measured, cause not identified).
