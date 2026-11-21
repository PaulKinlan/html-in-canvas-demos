# Native UI frameworks and HTML-in-canvas

Written 2026-11-21. Companion to the experiment at [`/native-ui/`](https://html-in-canvas.page/native-ui/) (`public/native-ui/`, sources in `native/`).

Native UI toolkits and game engines that compile to WebAssembly draw their whole interface into a `<canvas>`. The browser sees one element. Each framework then rebuilds, by hand, the parts of the platform it lost: text input, accessibility, and a way to show real HTML. This note records how ten frameworks do that today, what HTML-in-canvas could replace, what two working proofs showed, and what would have to change in the frameworks and in the API.

Statements about frameworks are sourced; the numbers in brackets refer to [Sources](#sources). Where a framework's own pages did not answer a question the note says so. Statements about HTML-in-canvas behaviour come from this repository's tests in Chromium 157 unless a source is given.

## Contents

- [Summary](#summary)
- [The two proofs](#the-two-proofs)
- [What each framework does today](#what-each-framework-does-today)
- [What HTML-in-canvas could replace](#what-html-in-canvas-could-replace)
- [What has to change in the frameworks](#what-has-to-change-in-the-frameworks)
- [What has to change in the API](#what-has-to-change-in-the-api)
- [Ideas for further experiments](#ideas-for-further-experiments)
- [Sources](#sources)

## Summary

- Every framework surveyed uses the same three workarounds: a hidden or transparent `<input>` for text entry, a parallel tree of invisible ARIA elements for accessibility, and HTML laid over or under the canvas for embedded content. Qt, Flutter and egui all do the first [1][3][9][16]; Qt and Flutter do the second, both off by default [1][2][8]; Flutter, Compose and Uno do the third [6][7][12][20].
- HTML-in-canvas lets the framework keep its own renderer and still use a real element. The element is a child of the framework's canvas, the browser paints it into a texture (`texElementSubImage2D`, or `drawElementImageToTexture` on WebGPU), and `updateElementGeometry()` tells the browser where the framework drew it [24].
- Two proofs work in Chromium 157 without changing the toolkit: an egui app and a Qt Quick 6.10 app, each with real `<input>`, `<select>` and `<textarea>` elements laid out by the toolkit, drawn in its scene, and typed into through the browser. Each bridge is about 200 lines.
- The largest gain is for embedded HTML. Today an embedded element is above or below the whole canvas, so frameworks split the scene into several canvases (Flutter) or accept that the element cannot be blended (Uno) [7][20]. Drawn as a texture, the element is in the framework's z-order and can be clipped, faded and transformed.
- The largest gaps are: the browser does not know what the framework draws on top of an element; focus order cannot be shared between DOM and framework widgets; cross-origin frames are not painted, which rules out the most common platform views (maps, video embeds, ads) [25]; and IME composition formatting and spelling markers are left out of element images [25].

## The two proofs

Both are on `/native-ui/`. Sources: `native/egui-dom/` and `native/qt-dom/`.

| | egui 0.37 (Rust, eframe, glow) | Qt Quick 6.10.3 (C++, QML, Emscripten 4.0.7) |
|---|---|---|
| Size | 3.3 MB of WebAssembly | 23 MB of WebAssembly |
| Where the element lives | Child of the canvas given to `eframe::WebRunner` | Moved into Qt's own `canvas.qt-window-canvas`, which is inside a shadow root |
| How the toolkit draws it | `egui::PaintCallback` with `egui_glow::CallbackFn`: one textured quad inside egui's WebGL pass | `QQuickItem` whose `QSGSimpleTextureNode` wraps a GL texture made with `QNativeInterface::QSGOpenGLTexture::fromNative()` |
| Upload | `gl.texElementSubImage2D(TEXTURE_2D, 0, 0, 0, element)` from a JS snippet, into the texture Rust has bound | The same call from `EM_JS`, on `QQuickWindow::beforeRendering` |
| Layout | egui gives a width; the bridge sets `style.width` and returns `offsetHeight`; egui allocates that rectangle | QML layout gives a width; `implicitHeight` is set from `offsetHeight` |
| Hit testing | `updateElementGeometry()` with a translate and scale, plus `canvasClip` for egui scroll areas | `updateElementGeometry()` with the matrix from `QQuickItem::itemTransform()`, so a rotated item is hit tested rotated |
| Tested | Typing, Tab between DOM fields, click hand-over between egui and DOM fields, an egui window covering fields, touch at 2.625 device scale | Typing, click hand-over between a Qt `TextField` and DOM fields, `<select>` by keyboard, rotation and opacity from Qt sliders, touch at 2.625 device scale |

What the proofs showed:

1. **No toolkit changes were needed.** Both toolkits already have a hook for drawing a foreign GL texture inside their scene. On the web, eframe does not offer `register_native_glow_texture()` (it is compiled out for `wasm32`), so the egui bridge uses a paint callback.
2. **The element is part of the scene.** An egui window covers the DOM fields and an egui scroll area clips them. Qt Quick rotates and fades them. An overlaid element can do none of this.
3. **Layout works in both directions.** A DOM paragraph wraps to the width egui gives it and egui reserves the height the browser reports.
4. **Events reach both parties.** egui listens on the canvas and Qt on its window element, and events on a child bubble to them. The bridges stop propagation at the element. egui already ignores pointer moves when `elementFromPoint()` is not its canvas.
5. **Occlusion is the bridge's job.** The browser hit tests the element wherever its geometry is. The egui bridge asks `egui::Context::layer_id_at()` in a capture-phase listener and turns the event away if an egui window is on top. The Qt proof does not handle this.
6. **Focus is split.** Tab walks the DOM fields in DOM order. The toolkit's own focus order does not include them.
7. **Textures must be premultiplied.** Set `UNPACK_PREMULTIPLY_ALPHA_WEBGL` for the upload. Both toolkits blend premultiplied alpha.
8. **Chromium 157 keeps cached hit-test results across `updateElementGeometry()`.** `elementFromPoint()` at a point queried just before the call returns the old element. A DOM mutation clears it.
9. **Not checked:** real Android hardware, IME composition, where the native `<select>` and date pickers open, screen readers, and Qt Widgets (see below).

## What each framework does today

### Qt for WebAssembly

- **Rendering.** Each container element is a `QScreen` [1]. Each `QWindow` gets its own `div.qt-window` and its own `<canvas>` [2]. Windows that are not OpenGL surfaces use a 2D context and `putImageData`; OpenGL windows (Qt Quick) use WebGL, "typically WebGL 2" [1][2]. The proof confirmed the DOM structure: the canvas sits in a shadow root next to a `div.qt-window-a11y-container` and an `input.qt-window-input-element`.
- **Text input.** A hidden `<input>` per window, 1px, `opacity: 0`, with listeners for `input`, `beforeinput` and the composition events. `QWasmInputContext` copies the Qt field's value and selection into it and sets `type="password"` and `inputMode` from the Qt hints [2][3]. Qt's 2022 mobile post describes the hidden input as the way to open the on-screen keyboard [4].
- **Accessibility.** A parallel tree: each Qt accessible object becomes a `button`, `input`, `dialog` or `div` with an ARIA role, absolutely positioned at `z-index: -1` [5]. "This functionality is disabled by default"; a visually hidden "Enable Screen Reader" button or `QT_WASM_ENABLE_ACCESSIBILITY=1` turns it on. Simple controls work and "table or tree views may have missing support" [1][5].
- **HTML content.** The platform plugin has code for wrapping an existing HTML element as a foreign window [2]. The documentation does not mention it, and does not list QtWebView or QtWebEngine for WebAssembly [1].
- **Text rendering.** Qt ships three embedded fonts with "a limited character set" [1].
- **Size and version.** Each Qt minor version is tied to one Emscripten version (4.0.7 for 6.10 and 6.11, 5.0.5 for 6.12) [1].

### Flutter web

- **Rendering.** Two renderers, CanvasKit and Skwasm, both drawing with "WebGL and WebGPU" into canvases [6]. The DOM-based HTML renderer has been deprecated and removed [21].
- **Text input.** A real `<input>`, `<textarea>` or `contenteditable` span, made transparent (`color: transparent`, `caretColor: transparent`, no border or outline) and placed exactly over the Flutter-drawn field. Flutter draws the text and caret itself and reads edits from the element [9][8].
- **Accessibility.** "Flutter's accessibility is opt-in by default" for performance. A hidden `flt-semantics-placeholder` button labelled "Enable accessibility", or `SemanticsBinding.instance.ensureSemantics()`, builds a tree of absolutely positioned `flt-semantics` elements with ARIA roles over the canvas [8].
- **HTML content.** `HtmlElementView` platform views. The element is a child of `flt-glass-pane` and is projected through a `<slot>` in Flutter's shadow root [7]. Because it is a DOM element between canvases, Flutter content above it needs another canvas ("overlay"). "Each overlay present in a scene has implications both in memory and execution performance", browsers "support a limited number of overlays", and the view can take pointer events "resulting in Flutter missing some events" [10]. `PointerInterceptor` exists to work around that and is itself another platform view [11].
- **Texture sources.** `dart:ui_web` has `createImageFromTextureSource()`, which makes a `ui.Image` from an `HTMLImageElement`, `HTMLVideoElement` or `HTMLCanvasElement` [22].

### Compose Multiplatform for web

- **Rendering.** Skia (Skiko) into a canvas, Kotlin/Wasm or Kotlin/JS; the web target is Beta as of 1.9 [12].
- **Text input.** The 1.9 notes list "Addressing issues related to the `TextField` component" as roadmap work and say nothing more [12].
- **Accessibility.** "Initial accessibility support" in 1.9: screen readers read labels and can click buttons. Interop views, scrolling containers, sliders and traversal order are not supported yet [12].
- **HTML content.** `WebElementView()`: "The embedded HTML element overlays the canvas area" and "intercepts input events within that area" [12].
- A Kotlin Slack thread asks whether HTML-in-canvas could serve Compose. It could not be fetched; a search summary of it says participants noted that Compose already generates a DOM next to the canvas for accessibility [13]. Treat that as unverified.

### egui

- **Rendering.** `egui_glow` (WebGL) or `egui-wgpu` (WebGPU) [14]. The proof uses glow.
- **Text input.** A hidden `<input>`, the "text agent", "used to capture IME and mobile keyboard input events". It is invisible, sits next to the canvas and is moved to the caret for IME [16].
- **Accessibility.** AccessKit covers native platforms. For the web there is "an experimental built-in screen reader", which speaks through `speechSynthesis` [14][15][17]. egui widgets have no DOM nodes.
- **HTML content.** None.

### Dear ImGui

- The FAQ covers on-screen keyboards in general terms ("When `io.WantTextInput` is set, you can notify your OS/engine to popup an on-screen keyboard") and has nothing on accessibility or on web builds specifically [18]. Dear ImGui draws from texture ids supplied by the application, so a DOM texture would be passed to `ImGui::Image()` the same way the egui proof passes one to a paint callback. Not built here.

### Slint

- Renders "into a HTML `<canvas>` element using WebGL, without using the DOM or CSS". Its page states the limits: "Slint renders text directly, instead of benefiting from the browser's text rendering", "Accessibility features (such as screen readers) are not available", and with the Emscripten backend "Copy and paste and input method editors (IME) aren't supported yet" [19].

### Avalonia

- "Skia through CanvasKit", "Drawn to a WebGL canvas, so there's no DOM to fight". Accessibility: "Screen readers, partially, through ARIA attributes". The page says nothing on text input [23].

### Uno Platform (Skia renderer)

- "There are no native views; all visuals are composed in Skia". IME and screen reader support are each "a work in progress" [20].
- HTML content: `BrowserHtmlElement` native element hosting. The docs say native elements respect z-order, and list the limits: they "cannot be styled by Uno Platform styles" and "native elements don't alpha-blend" [20].

### Unity Web

- Text fields raise the mobile keyboard, and "HideMobileInput… has no effect on the Web platform" because a real text field is required. By default Unity takes all keyboard input on the page; `WebGLInput.captureAllKeyboardInput = false` is needed for HTML fields on the same page to work [26]. Unity's issue tracker has an entry titled "IME languages are not recognized when entering input in mobile and WebGL builds" [27]; its text could not be fetched.

### Godot web export

- A 2021 progress report explains the constraint all of these share: "Web browsers pretty much only show this virtual keyboard when the user selects an `<input>` or `<textarea>` HTML element." Godot's virtual keyboard support is experimental and its `TextEdit` should hold little text [28]. The current export documentation lists no accessibility support for the web and says Godot 4 targets WebGL 2 only [29].

## What HTML-in-canvas could replace

| Today | With HTML-in-canvas | Who gains |
|---|---|---|
| Hidden or transparent input, with the framework drawing its own text and caret and copying state both ways | The field is a real element drawn as a texture. The browser draws the text, caret and selection and owns the value. | Every framework. Slint and Unity gain IME at all. |
| Embedded HTML above or below the canvas; extra canvases to draw over it; no blending | The element is a texture in the scene: any z-order, clip, opacity, transform or shader | Flutter (`HtmlElementView` without overlays), Compose (`WebElementView`), Uno (alpha blending), Qt (a documented way to show HTML) |
| The framework ships fonts, shaping and line breaking | A label or paragraph can be a DOM element: system fonts, fallback for every script, emoji, selection, find-in-page, translation | Qt (three embedded fonts), Slint, egui |
| A parallel ARIA tree positioned over the canvas, built on request | Real elements are already in the accessibility tree, with the role, name and state the browser gives them. The framework still needs its tree for widgets it draws itself; it can live in the canvas subtree and be positioned with `updateElementGeometry()` instead of CSS. | Partial for all. Largest for frameworks with no web accessibility (egui, Slint, Godot). |
| Game UI: chat boxes, login forms and settings rebuilt in engine UI | The same forms as DOM textures on a quad or a mesh | Unity, Godot. `/three-form/` and `/xr/` already show the technique in three.js. |

The gain is not uniform. A framework cannot swap all of its widgets for DOM elements without ceasing to be itself: the reason to use Flutter or Qt on the web is that the same widget code runs on every platform. The realistic use is the set of things the framework cannot do well alone: text entry, embedded web content, long selectable text, and platform pickers (date, colour, file, `<select>` on a phone).

## What has to change in the frameworks

1. **A way to put an element in the framework's own canvas.** The element must be a descendant of the canvas it is drawn into. Qt and Flutter create their canvases themselves and keep them in shadow roots. Flutter's platform views are deliberately outside the shadow root and slotted in [7]; an in-canvas view needs a different home. Qt needed inline styles because page stylesheets do not reach its shadow root.
2. **A texture-source entry point that takes an element.** Flutter's `createImageFromTextureSource()` accepts images, video and canvases [22]. An element (or an `ElementImage`) would be one more source, uploaded with `texElementSubImage2D` into the Skia backend texture. eframe needs `register_native_glow_texture()` on the web or a documented callback path. Qt needs nothing new for Qt Quick.
3. **One canvas per element.** An element can be drawn only into its nearest canvas, and an `ElementImage` only into the canvas it came from. Flutter's overlay canvases and Qt's canvas per window both mean the framework must decide which canvas owns each element. A Qt popup window over a DOM item is a second canvas above the first, so it covers the item correctly, but the item cannot move between windows without being re-parented.
4. **Raster back ends.** Qt Widgets windows paint with `putImageData` into a 2D canvas [2]. The texture route does not apply. `ctx.drawElementImage()` after each flush should work and has not been tried.
5. **Rendering in a worker.** A framework that renders on a worker with a transferred `OffscreenCanvas` cannot touch elements there. The route that works in this repository's tests is `captureElementImage()` on the main thread, transfer the `ElementImage` to the worker, and upload it there; snapshots are only made by the main thread's rendering update. Whether Flutter's Skwasm renders on a worker was not confirmed from Flutter's documentation for this note.
6. **Event routing.** The framework's listeners must ignore events whose target is an embedded element, and must be consulted before an occluded element receives one.
7. **Focus.** The framework's focus traversal has to treat a DOM widget as a stop: move DOM focus into it, and take focus back when Tab leaves it.
8. **Start-up behaviour.** eframe focuses its hidden text input on start, which is wrong for an app embedded in a page with other content.

## What has to change in the API

These are observations from the proofs, added to the ones already in `FINDINGS.md`.

1. **Occlusion.** `updateElementGeometry()` describes where an element is, not what covers it. A framework knows its own z-order. Either the geometry call needs a way to subtract regions, or the browser needs to ask (a hit-test callback). The same request came out of the portal, lens and 3D experiments.
2. **Cross-origin content.** The explainer excludes cross-origin frames from element images: "same-origin iframes would still paint, but cross-origin content in them would not" [25]. Most platform views in real apps are cross-origin (maps, video players, payment forms, ads). They have to stay as overlays.
3. **What is left out of the image.** The explainer also excludes spelling and grammar markers, pending autofill previews, IME pop-ups and "distinctive IME formatting", video controls and captions [25]. For a text field in a canvas this means composition underlines and spelling marks may be missing. This needs testing with a real IME.
4. **Focus order.** There is no way to interleave canvas-drawn widgets with real elements in the tab order short of giving every framework widget a DOM node.
5. **Hit-test cache.** `updateElementGeometry()` should invalidate cached hit-test results (Chromium 157, see proof finding 8).
6. **Geometry units.** `canvasTransform` has been seen in CSS pixels and in buffer pixels on different canvases. Both bridges measure the unit at run time, as the libraries in `public/lib/` do.
7. **Method names.** Chromium 157 has `texElementSubImage2D` and `GPUQueue.drawElementImageToTexture`; three.js r187 still calls older names. Framework bindings generated from IDL (web-sys, Emscripten's WebGL layer, Dart's `web` package) have none of them yet, so every bridge calls through untyped JavaScript.

## Ideas for further experiments

1. **Flutter.** Build a Flutter web app that shows a DOM element through `createImageFromTextureSource()`: a hidden drawable canvas holds the element, its pixels go to Flutter as a canvas source each paint, and a transparent copy of that canvas over the Flutter view takes the input. It would show the gain without an engine change and measure the cost of the copy. The engine change itself (an element as a texture source) is the real proposal.
2. **Qt Widgets.** Try `drawElementImage()` on a raster window's 2D canvas after Qt's flush, for a `QWidget` that hosts an element.
3. **Qt Quick `TextField` backed by an `<input>`.** Replace Qt's hidden-input machinery for one control and compare IME and autofill behaviour on Android.
4. **Dear ImGui with Emscripten.** The smallest possible bridge: one `ImGui::Image()` call. Useful as a reference for C and C++ engines.
5. **Unity or Godot.** A DOM chat box and login form on a quad in a 3D scene, with the browser's keyboard on a phone.
6. **Accessibility tree in the canvas.** Put a framework's ARIA tree inside the canvas and position it with `updateElementGeometry()`, then compare screen reader behaviour with Flutter's and Qt's overlay trees.
7. **Occlusion without a guard.** Test whether `canvasClip` with several calls, or a stack of covering elements, can express "this window covers that field" so that touch works without the capture-phase check.
8. **Real-device checks.** IME composition in a DOM field inside egui, where the native `<select>` and date pickers open when the field is rotated in Qt Quick, and TalkBack over both apps.

## Sources

Fetched 2026-11-21. Quotations are from these pages.

1. Qt for WebAssembly, Qt 6.12 documentation. https://doc.qt.io/qt-6/wasm.html
2. `qwasmwindow.cpp`, qtbase. https://code.qt.io/cgit/qt/qtbase.git/plain/src/plugins/platforms/wasm/qwasmwindow.cpp
3. `qwasminputcontext.cpp`, qtbase. https://code.qt.io/cgit/qt/qtbase.git/plain/src/plugins/platforms/wasm/qwasminputcontext.cpp
4. Qt for WebAssembly on mobile devices, Qt blog, 2022. https://www.qt.io/blog/qt-for-webassembly-on-mobile-devices
5. `qwasmaccessibility.cpp`, qtbase. https://code.qt.io/cgit/qt/qtbase.git/plain/src/plugins/platforms/wasm/qwasmaccessibility.cpp
6. Web renderers, Flutter documentation. https://docs.flutter.dev/platform-integration/web/renderers
7. Using HTML slots to render platform views in the web, Flutter documentation. https://docs.flutter.dev/release/breaking-changes/platform-views-using-html-slots-web
8. Accessibility in Flutter on the Web, Flutter blog. https://flutter.dev/blog/accessibility-in-flutter-on-the-web and Web accessibility, https://docs.flutter.dev/ui/accessibility/web-accessibility
9. `text_editing.dart`, Flutter web engine. https://raw.githubusercontent.com/flutter/flutter/master/engine/src/flutter/lib/web_ui/lib/src/engine/text_editing/text_editing.dart
10. `HtmlElementView` class, Flutter API. https://api.flutter.dev/flutter/widgets/HtmlElementView-class.html
11. Embedding web content into a Flutter web app. https://docs.flutter.dev/platform-integration/web/web-content-in-flutter
12. What's new in Compose Multiplatform 1.9.0. https://kotlinlang.org/docs/multiplatform/whats-new-compose-190.html
13. Kotlin Slack archive, thread on HTML-in-canvas (not fetched, HTTP 429; search summary only). https://slack-chats.kotlinlang.org/t/33262003/has-anyone-experimented-with-html-in-canvas-yet-it-seems-lik
14. egui README. https://raw.githubusercontent.com/emilk/egui/main/README.md
15. egui accessibility guide. https://raw.githubusercontent.com/emilk/egui/main/docs/accessibility.md
16. `text_agent.rs`, eframe. https://raw.githubusercontent.com/emilk/egui/main/crates/eframe/src/web/text_agent.rs
17. `screen_reader.rs`, eframe. https://raw.githubusercontent.com/emilk/egui/main/crates/eframe/src/web/screen_reader.rs
18. Dear ImGui FAQ (first two thirds read). https://raw.githubusercontent.com/ocornut/imgui/master/docs/FAQ.md
19. Slint on the web. https://docs.slint.dev/latest/docs/slint/guide/platforms/web/
20. Uno Platform: Skia rendering, https://platform.uno/docs/articles/features/using-skia-rendering.html and hosting native controls, https://platform.uno/docs/articles/features/using-skia-hosting-native-controls.html
21. Web breaking change: deprecating and removing the HTML renderer, flutter-announce (title only, from search). https://groups.google.com/g/flutter-announce/c/JqkMe7cPkQo
22. `createImageFromTextureSource`, `dart:ui_web`. https://api.flutter.dev/flutter/dart-ui_web/createImageFromTextureSource.html
23. Avalonia for WebAssembly. https://avaloniaui.net/platforms/wasm
24. HTML-in-Canvas: technical concepts, Chrome for Developers. https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts
25. WICG html-in-canvas explainer, "Read-back-allowed rendering". https://github.com/WICG/html-in-canvas
26. Input in Web, Unity manual. https://docs.unity3d.com/Manual/webgl-input.html
27. Unity issue tracker (title only). https://issuetracker.unity3d.com/issues/ime-languages-are-not-recognized-when-entering-input-in-mobile-and-webgl-builds
28. Godot Web progress report 7, April 2021. https://godotengine.org/article/godot-web-progress-report-7
29. Exporting for the Web, Godot documentation. https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
30. EditContext API, MDN. An alternative for text input in canvas editors: it gives IME events without a hidden element, but the page still draws the text and "Screen readers can't read the text in a `<canvas>` element". https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API
