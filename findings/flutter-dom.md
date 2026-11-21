# A DOM form inside a Flutter web app (`/flutter-dom/`)

Measured in headless C157 on 2026-11-21, software rendering, at 1× (412 px and 1100 px wide) and at a 2.625 device scale with touch (`--force-device-scale-factor=2.625`, no emulation). Flutter 3.50.1 stable, Dart 3.14.0, `flutter build web --release`, dart2js, CanvasKit (Chromium variant) served from the site. Sources in `native/flutter-dom/`, build output in `public/flutter-dom/app/` (8.2 MB, largest file `canvaskit.wasm` 5.2 MiB). The page's live checks produce the rows marked "check". Rows marked "script" came from Playwright runs with a real mouse, touch and keyboard against `/flutter-dom/fixture.html`.

This is follow-up experiment 1 of `docs/native-frameworks.md`.

## What Flutter is on the page

| Question | Result | Detail |
| --- | --- | --- |
| Renderer | CanvasKit (check) | Chosen in `flutter_bootstrap.js` with `renderer: 'canvaskit'` and `canvasKitVariant: 'chromium'`. A dart2wasm build with `renderer: 'skwasm'` was also run (script), not shipped. |
| Where Flutter's canvas is | In the shadow root of `flt-glass-pane`, inside `flutter-view` (check) | `flutter-view > flt-glass-pane #shadow-root > flt-scene-host > flt-scene > flt-canvas-container > canvas`. One canvas for this app. The shadow root is open. |
| What that canvas is, default rasterizer | A `bitmaprenderer` canvas (check) | CanvasKit renders into an `OffscreenCanvas` and transfers bitmaps to it. `getContext('webgl2')` on it returns null. Same with Skwasm (script). |
| What that canvas is, `canvasKitForceMultiSurfaceRasterizer: true` | A WebGL2 canvas (check) | CanvasKit renders straight into the canvas on the page. In the engine source this rasterizer is chosen for Safari and Firefox. The option must be in the object passed to `initializeEngine()`; in the loader's `config` alone it had no effect when `onEntrypointLoaded` was used. |
| `content="drawable"` on Flutter's canvas | Can be set in both modes (check) | Set after Flutter made its context. A child gets `paint` events and `getElementImageDefaultSize()` answers. |

## Route 1: the element, or an `ElementImage`, as the texture source

| Experiment | Result | Detail |
| --- | --- | --- |
| `createImageFromTextureSource(form, transferOwnership: false)` | fails (check) | The engine calls `createImageBitmap(source)`: "TypeError: Failed to execute 'createImageBitmap' on 'Window': The provided value is not of type '(Blob or HTMLCanvasElement or …)'". |
| `createImageFromTextureSource(form, transferOwnership: true)` | fails when the image is used (check) | The call returns a `ui.Image` with the width and height it was given. `toByteData()` then fails with "Failed to execute 'drawImage' on 'CanvasRenderingContext2D'". Both renderers make the texture lazily. |
| The same two calls with `canvas.captureElementImage(form)` | fail the same way (check) | `createImageBitmap(ElementImage)` also throws when called from the page (script). |
| Same on Skwasm, single-threaded | fail the same way (script) | |

## Route 2: a 2D canvas that drew the element

| Experiment | Result | Detail |
| --- | --- | --- |
| Hidden `<canvas content="drawable" layoutsubtree>` with the form as a `drawable` child, `drawElementImage()` on each `paint`, canvas passed to `createImageFromTextureSource()` | works (check) | `toByteData()` on the image gives the canvas's centre pixel, rgba(16, 17, 20, 255). |
| Flutter shows the image in a `RawImage` | works (check) | The form is painted magenta and rgba(255, 0, 255, 255) is read from Flutter's canvas at the widget's position. |
| Flutter `Transform` with perspective, `Opacity`, `ImageFiltered` blur, and a Flutter widget drawn over the form | work (script, screenshots) | The form is an ordinary widget in the tree. |
| Flutter sets the width, the browser answers with the height | works (script) | `LayoutBuilder` calls `bridge.layout(width)`, which sets `form.style.width` and returns `offsetHeight`. |
| `paint` events on a canvas with `opacity: 0` | fire (check) | The canvas over the view is invisible and still painted. |
| Passing an `ImageBitmap` made by the page | works (check) | `transferOwnership: true`. |
| Passing the canvas with `transferOwnership: true` | works (check) | The engine skips `createImageBitmap()` and CanvasKit reads the canvas when it first draws the image. |
| Skwasm, single-threaded (dart2wasm, page not cross-origin isolated) | works (script) | Route 2 and the input test below gave the same results at 1×. |

Cost of one update. Means over 12 changes to the textarea, from the "cost" checks. Software renderer, so the absolute numbers say little about a phone.

| Source | Image size | `drawElementImage()` | `createImageBitmap()` by the page | `createImageFromTextureSource()` | Flutter raster per frame |
| --- | --- | --- | --- | --- | --- |
| canvas, `transferOwnership: false` | 924×572 (2.625×) | 0.10 ms | | 4.0 to 5.1 ms | 39 to 41 ms |
| canvas, `transferOwnership: true` | 924×572 | 0.07 ms | | 0.2 ms | 37 to 38 ms |
| `ImageBitmap` from the page | 924×572 | 0.09 ms | 3.7 to 4.1 ms | 0.2 ms | 39 to 40 ms |
| canvas, `transferOwnership: false` | 352×219 (1×) | 0.07 ms | | 0.9 to 1.1 ms | 9 to 10 ms |
| canvas, `transferOwnership: true` | 352×219 | 0.09 ms | | 0.2 ms | 9 to 11 ms |
| `ImageBitmap` from the page | 352×219 | 0.06 ms | 0.8 to 0.9 ms | 0.2 ms | 10 to 14 ms |
| the form itself, in-canvas design | 924×574 | none | none | 0.2 ms | 8 ms |
| the form itself, in-canvas design | 352×220 | none | none | 0.2 ms | 2 ms |

The copy that can be measured is the `createImageBitmap()` call, 4 to 5 ms for a 924×572 image. The texture upload happens inside Flutter's raster and was not separated. The in-canvas rows use a different rasterizer (direct to the on-screen canvas instead of an `OffscreenCanvas` and a bitmap transfer), so the lower raster time is not the saving from the copy alone.

## Route 3: input

| Experiment | Result | Detail |
| --- | --- | --- |
| The source canvas laid over the Flutter view, `opacity: 0`, Flutter's `Matrix4` as CSS `matrix3d()` | works (check, script) | `RenderBox.getTransformTo(null)` after each frame. The 16 numbers are in the same order as `matrix3d()`. `elementFromPoint()` at the centre of each field returns that field with the form rotated 24° and tilted 32°. |
| Typing, caret, `<select>` by keyboard with the form rotated 38° and tilted 35° | works (script) | With a mouse at 1×. With touch taps at 2.625× the same was run at 18° and 28°, on the page itself, in both designs. Each keystroke gives a `paint` event and a new `ui.Image`. |
| Drag selection in the textarea, Tab between the three DOM fields | works (script) | At the starting angle of -4°. |
| Click from Flutter's `TextField` to a DOM field and back | works (script) | The canvas is outside `flutter-view`, so pointer events on it do not reach Flutter. |
| An element inside Flutter's `bitmaprenderer` canvas (default rasterizer): `paint` event, `updateElementGeometry()`, hit testing | works (check) | An `<input>` appended to Flutter's canvas, placed at 40, 20, is returned by `elementFromPoint()` there. It needs `pointer-events: auto`. |
| Getting that element's pixels to Flutter | fails (check) | A `bitmaprenderer` context has no element draw call. `captureElementImage()` returns an `ElementImage`, and `drawElementImage()` on a 2D canvas, on an `OffscreenCanvas` and `texElementSubImage2D()` on an `OffscreenCanvas` all throw "The source was captured from a different canvas". |
| A Flutter widget drawn over the form | does not block it (check, expected failure) | `elementFromPoint()` on Flutter's yellow badge returns the form. Neither design guards against this. |

## The form inside Flutter's own canvas (the engine change, emulated)

Open `/flutter-dom/?design=in-canvas`. The engine runs with `canvasKitForceMultiSurfaceRasterizer: true`.

| Experiment | Result | Detail |
| --- | --- | --- |
| Move the form into Flutter's WebGL2 canvas and set `content="drawable"` on it | works (check) | The form needs `pointer-events: auto` (Flutter's scene has `pointer-events: none`) and a stylesheet inside the shadow root. |
| `createImageFromTextureSource(form, transferOwnership: true)` with `gl.texImage2D(…, form)` replaced by an allocation and `gl.texElementSubImage2D(…, form)` | works (check) | CanvasKit's lazy upload calls `texImage2D(TEXTURE_2D, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, source)` on the context object, so an instance property replaces it. Magenta read back from Flutter's canvas. No 2D canvas, no `createImageBitmap()`. |
| `updateElementGeometry(form, { canvasTransform })` with Flutter's 4×4 perspective matrix | works (check) | All three fields are hit tested correctly rotated 24° and tilted 32°. `canvasTransform` was in CSS px at 1× and at 2.625×. |
| Typing, `<select>` by keyboard, rotated and tilted | works (script) | |
| Click on a DOM field after typing in Flutter's `TextField` | fails without a workaround (script) | The engine's blur handler refocuses its hidden input when focus moves to an element in the same `flutter-view`. The bridge blurs the input on `pointerdown` first. |
| Tab in a DOM field | goes to Flutter without a workaround (script) | Flutter listens for `keydown` on `window` in the capture phase and moved its own focus to the `TextField`. A capture listener added before the engine starts stops key events that come from the form. After that Tab walks the DOM fields. |
| Skwasm | not tried | The patch is specific to CanvasKit's JavaScript. |

## Things that bit

- `flutter build web` as root prints a warning and refuses to run git in the SDK folder until the folder is owned by the user that runs it (`chown -R`).
- The engine fetches Roboto from `fonts.gstatic.com` unless the app bundles a family named Roboto. The app bundles two weights (344 KB).
- Engine options given only to `_flutter.loader.load({ config })` did not reach the engine when `onEntrypointLoaded` called `initializeEngine({ hostElement })` with its own object. The same options have to be spread into that object.
- Flutter makes its canvas during the first frame, after `runApp()` resolves. Code that looks for the canvas has to wait for it.
- Material is a separate package (`material_ui`) in Flutter 3.50.
- CanvasKit makes textures lazily. `createImageFromTextureSource()` returning an image proves nothing about the source. The checks read the image back with `toByteData()`.
- A WebGL canvas with `preserveDrawingBuffer` off can be read with `drawImage()` only in the animation frame in which it was drawn. The check asks Flutter for a frame (it nudges the opacity control) and reads in a `requestAnimationFrame` callback registered after Flutter's.
- In the in-canvas fixture the unused source canvas was still over the view and took the hit tests. It is set to `display: none` on adoption.
- A canvas is blank between a resize and the next `paint` event. A readback taken in that gap gave rgba(0, 0, 0, 0).
- The site serves at most 25 MiB per file. The build script keeps only `main.dart.js`, `flutter_bootstrap.js`, the Chromium CanvasKit, the fonts and the shader assets, and deletes the service worker, the full CanvasKit, Skwasm, the symbol files and `NOTICES`. The output is 8.2 MB.

## Not verified

- A real phone: frame rate with the copy on a GPU, the on-screen keyboard, IME composition, autofill, where the native `<select>` picker opens for a rotated form, touch selection handles. The page shows its timings live under the demo; open it on the phone and read them.
- Screen readers: whether the form's fields are announced at the place Flutter drew them, in either design.
- Multi-threaded Skwasm (needs a cross-origin isolated page, which this site is not). It renders in a worker, where an element cannot be touched; `docs/native-frameworks.md` item 5 describes the route to try.
- The in-canvas design with Skwasm, and with more than one Flutter surface (platform views make Flutter split the scene over several canvases, and an element can be drawn only into its own).
- WebGL context loss. The page listens for `webglcontextlost` and shows a message, and the listener was not exercised (`loseContext()` on an attached drawable WebGL canvas crashes the renderer in C157).
- Firefox and Safari: the build ships only the Chromium variant of CanvasKit.
- The separate cost of the texture upload inside Flutter's raster.

## For the index

- Native frameworks: Flutter web shows a live DOM form through `createImageFromTextureSource()` from a 2D drawable canvas, with input through the same canvas laid over the view (`/flutter-dom/`).
- Native frameworks: with `canvasKitForceMultiSurfaceRasterizer` and `texImage2D()` replaced by `texElementSubImage2D()`, Flutter takes the element itself as a texture source and the element lives in Flutter's canvas (`/flutter-dom/?design=in-canvas`).
- `captureElementImage()`: an `ElementImage` is refused by every canvas other than the one it was captured from, including an `OffscreenCanvas` ("The source was captured from a different canvas"). `createImageBitmap()` does not accept an `ElementImage` or an element.
- `updateElementGeometry()`: `canvasTransform` accepts a 4×4 matrix with perspective, and hit testing follows it.
- Drawable canvas: `content="drawable"` works on a canvas with a `bitmaprenderer` context for `paint` events and geometry, with no way to draw the element.
- Drawable canvas: a canvas with `opacity: 0` still gets `paint` events and its children are hit tested.

## API requests

- A way to use an `ElementImage` outside its canvas, for example `createImageBitmap(elementImage)` or drawing it into an `OffscreenCanvas`. Flutter's default rasterizer, and any framework that renders off screen and presents bitmaps, cannot use element images without it.
- The same request as `/native-ui/`: a way to tell the browser what the framework draws over an element.

## Requests for Flutter

- `createImageFromTextureSource()` (or a new call) that takes an element in the view's canvas and uploads it with `texElementSubImage2D()`. The patch in `public/flutter-dom/bridge.js` shows the one call that has to change in CanvasKit.
- A place in the view for such elements. Today the engine takes focus back from any element inside `flutter-view` and handles keys typed into it.
