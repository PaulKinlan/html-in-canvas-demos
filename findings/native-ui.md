# Native UI toolkits (`/native-ui/`)

Tested in headless Chromium 157 at 1× and at a 2.625 device scale with touch. egui 0.37 (eframe, glow, WebGL2) and Qt Quick 6.10.3 (Emscripten 4.0.7, WebGL2). Sources in `native/`. The survey of other frameworks and the list of what would have to change is `docs/native-frameworks.md`.

| Experiment | Result | Detail |
| --- | --- | --- |
| DOM element as an egui widget, drawn by an `egui_glow::CallbackFn` paint callback | works | `texElementSubImage2D` into a texture bound by Rust, inside egui's own WebGL pass. An egui window covers it and an egui scroll area clips it. |
| DOM element as a Qt Quick item | works | A `QQuickItem` with a `QSGSimpleTextureNode` over `QSGOpenGLTexture::fromNative()`. Uploaded on `QQuickWindow::beforeRendering`. Qt's `opacity` and `rotation` apply. |
| `content="drawable"` set on a canvas after the toolkit made its WebGL context | works | Both toolkits create the context before the bridge runs. |
| Element moved into Qt's canvas, which is in a shadow root | works | Page stylesheets do not apply there, so the page copies computed styles inline first. |
| Toolkit sets the width, browser reports the height | works | `style.width`, then `offsetHeight`. One frame late. |
| Typing, caret, Tab between DOM fields, click from a toolkit field to a DOM field and back | works | Events are stopped at the element so the toolkit does not also handle them. |
| Hit testing a field rotated by Qt Quick | works | `QQuickItem::itemTransform()` passed to `updateElementGeometry()`. |
| A toolkit window drawn over a DOM field | needs a guard | The browser still hits the field. The egui bridge asks `Context::layer_id_at()` before the event is delivered. |
| Tab from a DOM field to a toolkit widget | fails | The toolkit's widgets are not DOM nodes. |
| Upload without `UNPACK_PREMULTIPLY_ALPHA_WEBGL` | wrong | Text on a transparent background is too heavy, because both toolkits blend premultiplied alpha. |
| Spelling markers on a `spellcheck` textarea in the texture | not drawn | The explainer excludes them from element images. |
| `elementFromPoint()` at a point hit tested just before `updateElementGeometry()` moved the element away | stale (Chromium 157) | Returns the old element; a point 2px away is correct. A DOM mutation clears it, so the bridges toggle an attribute on the canvas after each geometry update. Possible browser bug. |
| eframe under DevTools device emulation | wrong scale | The canvas buffer stays at CSS size while egui uses the device pixel ratio. `--force-device-scale-factor` is correct. |
| eframe start-up | takes focus | It focuses its hidden text input. The page makes `focus()` a no-op while the app starts. |
| Raw GL in Qt Quick's frame | warnings | Five `texParameter: no texture bound` warnings per item at start-up. Textures draw correctly. |

Not verified: a real phone, IME composition, where native pickers open for a rotated field, screen readers, Qt Widgets (2D canvas, `putImageData`).
