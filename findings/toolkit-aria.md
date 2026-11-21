# An accessibility tree for a Dear ImGui app (`/toolkit-aria/`)

Measured in C157 (headless shell 157.0.8103.78, 2.625 device scale, 412 px wide, touch) on 2026-11-21. Dear ImGui 1.92.5, Emscripten 4.0.7, WebGL2, no GLFW or SDL. Source in `native/toolkit-aria/`. The build is 420 KB of WebAssembly and 96 KB of JavaScript. The page has 16 live checks; all 16 pass in C157. The accessibility tree was read with CDP `Accessibility.getFullAXTree` and Playwright `ariaSnapshot()`.

The question: ImGui draws its own button, checkbox, slider and text field as pixels. Can each widget have a real DOM node inside the canvas that is never drawn, placed with `updateElementGeometry()`, so that the accessibility tree, hit testing, Tab order and focus describe ImGui's widgets?

## Route (a): nodes in a `layoutsubtree` canvas that are never drawn

| Experiment | Result | Detail |
| --- | --- | --- |
| `updateElementGeometry(el, { canvasTransform, canvasClip })` on an element that is never drawn | works | 14 nodes, 0 texture uploads, 0 draw calls for any node. The node's CSS width and height give the box size. |
| `getBoundingClientRect()` | the rectangle ImGui drew | Largest difference over 14 nodes: 0 CSS px. The unit of `canvasTransform` measured 1 (CSS px) on this canvas at 2.625 device scale. |
| `elementFromPoint()` | the node | 9 of 9 widgets that were in view. |
| Accessibility tree (CDP) | role, name and state are right | `group "Document settings, drawn by Dear ImGui"` with `textbox "Title"` (value "Quarterly report"), `checkbox "Autosave"` (checked true), `slider "Volume"` (value 41, valuemin 0, valuemax 100), `button "Save"`, `status` (live polite) with the text, `button "Advanced"` (expanded false), 8 more checkboxes, in ImGui's order. |
| Boxes of those accessibility nodes | match, read from the DOM | CDP `DOM.getContentQuads` for each accessibility node's DOM node gives the ImGui rectangle (for example Save 48 by 33 at the button). CDP does not return bounds in accessibility nodes, so the bounds sent to a platform accessibility API were not read. |
| `computedRole`, `computedName` | not exposed | Both are `undefined` in this build. The live check prints them where a browser has them. |
| `aria-valuetext` on the range node | set, not confirmed in the tree | The attribute is "41 %". CDP reports the `valuetext` property as empty. It reports the same for a `role="slider"` element outside any canvas, so this says nothing about the canvas. |
| `canvasClip` = the ImGui window's clip rectangle | cuts the hit box only | A row scrolled 8 px under the title bar: the point above the clip edge hits `<canvas>`, the point below hits the node. `getBoundingClientRect()` still reports the whole row. |
| A widget scrolled out of the window | keeps its node and its true rectangle | For example Title at y -182 and Surveys at y 605 on a 420 px canvas. ImGui still submits a scrolled-out widget, so it has a rectangle. |
| Focus on a scrolled-out node | ImGui scrolls to it | `focus` event, then `SetFocusID()` and `ScrollToItem()`. Surveys went from y 605 to y 379 and was hit by `elementFromPoint()`. |
| A widget that is no longer submitted | node removed that frame | Closing the "Advanced" header: 16 nodes to 14. A removed node that had focus leaves focus on `<body>`. |
| DOM order = ImGui submission order | works | New nodes are inserted at the position ImGui submitted them. Opening the header puts Spell check and Reset after Advanced. |
| Tab order (real Tab key, Playwright) | ImGui's order | From the page heading: Title, Autosave, Volume, Save, Advanced, the 8 checkboxes, then the two controls under the canvas. The status node is skipped. ImGui gets no key events. |
| `click()` on the button node | `ImGui::Button()` returns true | The page sets `g.NavActivateId`, `NavActivateDownId` and `NavActivatePressedId` to the id before the widget is submitted. The same call toggles `CollapsingHeader()`. |
| Enter on the focused button node, Space on the checkbox node, arrows on the range node | work | Enter saved, Space toggled Autosave in ImGui, two ArrowRight presses moved the ImGui slider from 73 to 75. |
| `input` on the range node | sets the ImGui slider | ImGui formats the value and the page writes it back as `aria-valuetext`. |
| Pointer in ImGui to DOM state | works | A touch tap on the ImGui checkbox changed the node's `checked`; a tap at 80% of the slider set the node's value to 83 and `aria-valuetext` to "83 %". |
| A press lands on a node, ImGui still handles it | works | Capture listener on the canvas forwards pointer events. The `click` that follows has a `pointerType` and is ignored, so nothing is pressed twice. Touch drag on the slider and touch scrolling of the window work. |
| DOM focus to ImGui focus | works | `ui_nav_id()` equals the widget id. ImGui's ring is drawn when the node matches `:focus-visible` and is off after `blur`. After a touch tap on Save the ring is off. |
| Text typed in the text node | reaches the `InputText()` buffer | Including "é" and "東京" (ImGui's default font has no glyph for the last two). ImGui's `InputText()` is never active; ImGui draws the buffer, and a caret and selection from `selectionStart` and `selectionEnd`. |
| Click to place the caret | exact after matching text widths | ImGui: "Quarterly report" is 128 px. Node (15 px monospace): 144.5 px. With `letter-spacing` set to (128 - 144.5) / 16 the same click gives the same letter: a mouse drag from x 40 to x 120 selected 3 to 13. Before the fix it selected 2 to 11. |
| Idle | 0 frames | 0 ImGui frames and 0 `updateElementGeometry()` calls during 30 animation frames. |
| Page stability | passes | `check:jank` with and without `--checks`: cls 0, scroll 0 px, focus moves 0, 1 WebGL context, 0 lost. |

## Route (b): the same nodes as fallback content of a canvas without `layoutsubtree`

Measured two ways: a plain canvas made by the live check, and the whole page run with `--disable-blink-features=CanvasDrawElement`.

| Experiment | Result | Detail |
| --- | --- | --- |
| Accessibility tree | same roles and names | group, textbox "Title", checkbox "Autosave", slider "Volume", button "Save", status, button "Advanced". |
| `getBoundingClientRect()` | 0 by 0 at 0, 0 | `getClientRects()` is empty, `offsetWidth` is 0. |
| `elementFromPoint()` over the canvas | `<canvas>` | No node can be hit. |
| `focus()` and Tab | work | Same Tab order. ImGui still scrolls to the focused widget and draws the ring. |
| Space on the checkbox, arrow on the slider, Enter on the button | work | ImGui state changed each time. |
| Typing in the focused text input | does nothing | Focus was on the input, End and two letters were typed, the value did not change. The text field cannot be edited as fallback content. |
| Pointer | ImGui only | Taps reach ImGui through the canvas. DOM focus does not follow a tap, except that the page focuses the text node itself. |

## Route (c): draw the focused text node with `texElementSubImage2D()`

| Experiment | Result | Detail |
| --- | --- | --- |
| Upload the text node only while it has focus and draw it as an ImGui image in the frame | works | 0 uploads before focus, 2 while focused, 0 after blur. ImGui draws its own text with a clear colour while the image is shown. The caret, selection and glyphs are then the browser's, so the font matching of route (a) is not needed. Off by default on the page. |
| Draw only the node's focus ring | not tried | ImGui's own ring was enough. |

## Things that bit

- ImGui cleared `NavCursorVisible` every frame until `ImGuiConfigFlags_NavEnableKeyboard` was set. The page still sends ImGui no keys.
- `GetItemRectMin()` and `GetItemRectMax()` include the label of a slider or text field. `g.LastItemData.NavRect` is the frame alone.
- An `ImGuiID` above 2^31 arrives in JavaScript as a negative number. It is used as a map key and passed back unchanged.
- Calling an exported function with `stringToUTF8OnStack()` from JavaScript needs `stackSave()` and `stackRestore()` around it, or the stack grows by the string on every call.
- A touch tap on the text field after its text had been selected and the field blurred restored the old selection (0 to 16) in headless Chromium. A plain `<input>` outside a canvas did the same in the same run, so it is not caused by the canvas.
- Hiding ImGui's text with a clear `ImGuiCol_Text` for route (c) also hid the widget's label. The label is drawn again by hand.
- The outlines show `getBoundingClientRect()`, which ignores `canvasClip`, so the outline of a half scrolled row is drawn over ImGui's title bar.

## Not verified

- Screen readers: TalkBack (A159), VoiceOver, NVDA, JAWS. To verify: open the page with TalkBack on, swipe through the canvas and listen for "Title, edit box", "Autosave, checkbox, checked", "Volume, slider, 40 percent", "Save, button"; check that the focus rectangle TalkBack draws sits on the ImGui widget; double tap Save and read the status line.
- The bounds a platform accessibility API receives. CDP gives none. `chrome://accessibility` on a desktop build, or the Android accessibility node info, would show them.
- Whether a screen reader's activate gesture arrives as a `click` with an empty `pointerType`. If it arrives as a pointer sequence instead, ImGui handles it as a pointer press, which also works.
- Whether a screen reader's slider increment fires `input` on the range node.
- Whether `aria-valuetext` and the `role="status"` change are announced.
- Touch exploration (finding a node by moving a finger over the canvas).
- A real phone: the on-screen keyboard over the canvas when the text node is tapped, IME composition (route (c) should show the composition marks, route (a) shows only committed text), touch selection handles.
- Recovery from a lost WebGL context. The page shows a message.
- C153 and A159.

## For the index

- Accessibility: an element in a `layoutsubtree` canvas that is never drawn gets its box from `updateElementGeometry()` alone; role, name, state, hit testing, Tab order and focus then work for a toolkit's own widgets. (`/toolkit-aria/`)
- `updateElementGeometry()`: `canvasClip` cuts the hit box; `getBoundingClientRect()` ignores it. (`/toolkit-aria/`)
- Fallback content: canvas children without `layoutsubtree` are in the accessibility tree and focusable, have no boxes, and a text input among them cannot be typed in. (`/toolkit-aria/`)
- Native toolkits: Dear ImGui takes a press from outside through `NavActivateId`; `LastItemData.NavRect` gives the widget frame. (`/toolkit-aria/`)

## Open ideas

- The same helper for a second toolkit (egui has AccessKit output; Qt has QAccessible) to compare how much of the tree a toolkit can report by itself.
- Combo boxes and popups: a `<select>` node, or `role="listbox"` nodes for the popup's rows, with ImGui's window order deciding which nodes are hit.
- Headings and landmarks from `SeparatorText()` and window titles.
