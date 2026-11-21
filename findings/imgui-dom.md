# Dear ImGui with DOM elements (`/imgui-dom/`)

Measured in C157 (headless, 2.625 device scale, touch) on 2026-11-21. Dear ImGui 1.92.5, Emscripten 4.0.7, WebGL2, no GLFW or SDL. Source in `native/imgui-dom/`. The build is 425 KB of WebAssembly and 93 KB of JavaScript.

| Experiment | Result | Detail |
| --- | --- | --- |
| A DOM element shown with one `ImGui::ImageWithBg()` call | works | `texElementSubImage2D()` into a texture made with `glGenTextures()` in C++. `GL.textures` is not needed: the texture is bound by C++ before the JavaScript upload. |
| Hit testing where ImGui drew the element | works | `updateElementGeometry()` with the item rectangle. The unit of `canvasTransform` is measured at run time. |
| The ImGui window's clip rectangle as `canvasClip` | works | A field scrolled out of the window is not hit at its old place and is hit again after scrolling back. |
| Occlusion by another ImGui window or popup | works with a guard | `ImGui::FindHoveredWindowEx()` answers which window is on top at a point. The page asks in a capture-phase listener and each frame. |
| Straight alpha texture | required | The OpenGL3 backend uses `glBlendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ...)`, so `UNPACK_PREMULTIPLY_ALPHA_WEBGL` is false. |
| Tint alpha on the element | works | The fourth colour of `ImageWithBg()`. |
| Frames only on demand | works | 0 ImGui frames during 30 idle animation frames. A paint event asks for 4 frames. |
| Touch: tap a field and type, drag the slider, pick from the combo popup over a field, scroll the window by dragging | works | Touch scrolling is added by the page as wheel input. |
| `ImGui::InputText()` on a phone | not verified, expected to fail | It takes characters from key events on the canvas. Nothing in the app raises a virtual keyboard. |

## Things that bit

- `emscripten_webgl_create_context("#canvas", ...)` did not find `Module.canvas` in a `MODULARIZE` build. The app uses the canvas id as the selector.
- Two `SetNextWindowPos()` calls before one `Begin()`: the second replaces the first, even when its condition does not apply.
- `ImGui::IsAnyItemActive()` is true after a press on a window body, because ImGui activates the window's move id. Touch scrolling tests `g.MovingWindow` and compares the active id with `MoveId` instead.
- An open combo popup stayed open when the reader tapped a DOM field, because ImGui never saw the press. Presses on visible elements are now forwarded as well.

## Not verified

- A real phone (A159): the keyboard over the canvas, where the native select and date pickers open, IME, and frame rate.
- Screen readers. The DOM fields have roles and names; ImGui's widgets have no DOM nodes.
- Recovery from a lost WebGL context. The page shows a message.
- Desktop keyboard input into `ImGui::InputText()` was wired but only characters, Backspace, Delete, arrows, Home, End, Enter and Tab are sent.

## For the index

- Native toolkits: Dear ImGui shows a DOM element with one `ImGui::ImageWithBg()` call; `FindHoveredWindowEx()` gives occlusion. (`/imgui-dom/`)
- Textures: ImGui's OpenGL backend needs straight alpha, egui and Qt Quick need premultiplied. (`/imgui-dom/`, `/native-ui/`)
