# Qt Widgets with DOM elements (`/qt-widgets-dom/`)

Measured in C157 (headless, 2.625 device scale, touch) on 2026-11-21. Qt 6.10.3 for WebAssembly (single thread), Fusion style, Emscripten 4.0.7. Source in `native/qt-widgets-dom/`. The build is 14.1 MB of WebAssembly and 230 KB of JavaScript, loaded after a tap.

| Experiment | Result | Detail |
| --- | --- | --- |
| Draw DOM elements into a Qt Widgets window after Qt's flush | works | Qt copies its raster buffer with `putImageData()` on a 2D context. The page wraps that method on Qt's context and calls `drawElementImage()` after it. Text pixels of the textarea are read back from Qt's canvas. |
| Make Qt's own canvas drawable after Qt created it | works | `canvas.qt-window-canvas` is in the shadow root of `#qt-shadow-container`. Setting `layoutsubtree` and `content="drawable"` and appending the elements later is enough. |
| Hit testing where Qt laid out the widget | works | No `updateElementGeometry()`: the 2D draw sets the hit box. `elementFromPoint()` on the shadow root returns the input. |
| Layout both ways | works | `resizeEvent()` sets the element width, `heightForWidth()` returns `offsetHeight`. |
| A change in an element repaints the widget | works | 1 paint event, 2 flushes, 8 element draws for one changed textarea value. |
| Drawing after a flush causes no paint events | works | 0 paint events in 60 idle animation frames. In the check fixture Qt flushed twice in those frames; on the page it flushed 0 times in 3 s. The cause of the two was not identified (a blinking `QLineEdit` caret is the likely one). |
| A field scrolled out of the `QScrollArea` | works | `visibleRegion()` is empty, the element is not drawn and is `inert`. It returns when scrolled back. |
| A `QComboBox` popup over the fields | works, no guard | The popup is a second Qt window canvas above the first. The point over the email field hits that canvas. |
| Opacity from a `QSlider` | works | `globalAlpha` for the draw. Touch drag on the slider set 0.52. |
| Touch: tap a field and type, drag the slider, open the combo, scroll by dragging on Qt content | works | Scrolling needs `QScroller::grabGesture(viewport, TouchGesture)`. |
| Touch drag that starts on a DOM element scrolls the Qt area | does not | The element stops pointer events before Qt's listeners, so Qt never sees the drag. |

## Things that bit

- The canvas is not in `container.shadowRoot`. Qt adds a child `#qt-shadow-container` and attaches the shadow root to that.
- Page styles do not reach elements moved into Qt's shadow root. `start.js` copies computed styles inline before the move.
- A `sizeHint()` that laid the element out at a default width alternated with the real width and made a paint and flush loop at frame rate. The width is set only in `resizeEvent()`.
- Scrolling a `QScrollArea` moves the content widget, not its children, so no `moveEvent()` reaches the DomWidget. The scroll bar's `valueChanged` is connected to `DomWidget::sync()`.
- With no context of its own the page holds no WebGL context: Qt Widgets uses 2D canvases only.

## Not verified

- A real phone (A159): the keyboard, the native select picker over Qt's canvas, IME, and the time to compile 14 MB.
- The hit box of a field that is half scrolled out. The draw is clipped to the visible part; whether the hit box is clipped too was not measured.
- A mouse drag on the `QSlider` in a browser context with touch emulation did not move it in one scripted run. Not investigated.
- Screen readers. The DOM fields have names; Qt's widgets have no DOM nodes unless Qt's accessibility is switched on, which this page does not do.
- A lost 2D context. The page shows a message on `contextlost`; the event was not forced.
- Qt's threaded build and Qt Widgets with an OpenGL window.

## For the index

- `/qt-widgets-dom/`: a Qt Widgets (raster, 2D canvas) window with DOM fields drawn after each `putImageData()` flush. Backlog group 11.
