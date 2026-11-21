# A DOM form in a Godot 4 web export (`/godot-dom/`)

Measured in headless Chromium 157 (C157, HeadlessChrome/157.0.8103.78, software WebGL2) on 2026-11-21, at 1× and at a 2.625 device scale in a 412 px wide window with touch. Godot 4.7.2-stable, official web export template `web_nothreads_release` (Emscripten 4.0.20, single-threaded, no GDExtension), Compatibility renderer. Sources in `native/godot-dom/`, bridge in `public/godot-dom/bridge.js`. "Live check" means a row of the page's Live checks table, which runs on a framed copy of the app. "Script" means a Playwright script run against `fixture.html` or the page.

## Drawing the form

| Experiment | Result | Detail |
| --- | --- | --- |
| A stock Godot 4.7.2 web export draws a live `<form>` on a `MeshInstance3D` quad | works (measured, live check) | The form is a `drawable` child of the canvas Godot is given. A pixel read back from Godot's frame at the place the browser reports for the form's blue band is rgb(29,79,191) for CSS `#1f4fbf`, and rgb(208,12,154) after the band is restyled to `#d0109a`. |
| Route 1: `RenderingServer.texture_get_native_handle()` gives the GL name, `GL.textures[name]` gives the `WebGLTexture`, `gl.texElementSubImage2D()` writes into it | works (measured, live check) | Name 1012 in every run. Godot allocated the texture itself (RGBA8, with a mip chain). Upload call 1.5 ms at 300×397 texels, 10 to 21 ms at 788×1037 (software GL). |
| `JavaScriptBridge.eval(code, false)` sees Emscripten's `GL` | yes (measured, live check) | The engine runs a direct `eval` inside its module function, where `GL` is a local variable. |
| `JavaScriptBridge.eval(code, true)` sees `GL` | no (measured, live check) | Global scope. |
| `JavaScriptBridge.get_interface("GL")`, `get_interface("Module")` | null (measured, live check) | `get_interface()` reads a property of the global object. Each failed call also prints an engine error to the console. |
| `engine.rtenv.GL` from page script, with the engine's `Engine` loader and no HTML shell | not there (measured, live check) | `GL` is not exported from the module, so a custom shell that captures the module would not find it either (inferred from the same measurement). |
| Route 2: wrap `gl.createTexture` while `ImageTexture.create_from_image()` runs and keep the texture created | works (measured, live check) | Exactly 1 texture is created during the call. No Emscripten internals. Upload call 4 to 10 ms. Depends on Godot creating the GL texture during the call, which the single-threaded build does. |
| Route 3: upload into a texture the page owns, `readPixels()` through a framebuffer, `js_buffer_to_packed_byte_array()`, `Image.create_from_data()`, `ImageTexture.update()` | works (measured, live check) | Upload and read-back 1.7 ms at 300×397 and 15 to 25 ms at 788×1037, before Godot's own copy of the bytes into its heap and back to GL, which was not timed. No mip chain on this route. |
| A second 2D drawable canvas that holds the form, with pixels passed to Godot | not built | Route 3 gets the same pixels from the one canvas, and the form has to stay in Godot's canvas for `updateElementGeometry()` to place it there. |
| Row order | no flip (measured, screenshots) | Row 0 of the element image is the top of the form, and Godot's UV origin is the top left. |
| Mipmaps | works (measured, screenshots) | The `Image` is created with mipmaps so Godot uses a mipmap filter; the bridge calls `gl.generateMipmap()` after each upload. Text is legible on the tilted quad at 1× and 2.625×. |
| `content="drawable"` and `layoutsubtree` on the canvas before Godot creates its WebGL2 context | works (measured) | Godot's `getContext()` on that canvas succeeded. |
| GL state after the bridge's calls | no visible damage (measured, screenshots) | The bridge saves and restores `ACTIVE_TEXTURE`, `TEXTURE_BINDING_2D` and the framebuffer binding. Not tested without the restore. |

## Input

| Experiment | Result | Detail |
| --- | --- | --- |
| Hit box on the swaying quad from one perspective matrix | works (measured, live check) | `Camera3D.unproject_position()` for the four corners, a homography in a `DOMMatrix`, `updateElementGeometry()`. The browser's box for the form is within 0.2 to 0.3 px of the bounds of Godot's corners. `elementFromPoint()` at the email field returns the `<input>`. Unit of `canvasTransform`: CSS px (1.00) at both scales. |
| Click a field, type, Tab, Enter | works (measured, script, 1×) | Click on email focuses `input[email]`. Tab moves to the password field. Enter submits the form. Typing shows on the quad (screenshot). A click 14 px from the left edge of a filled field put the caret before the first character. |
| Touch at 2.625× | works (measured, script, CDP touch events) | A tap on the password field and on the textarea focuses each. A tap on Send posts the chat line. The page did not scroll. |
| Form to Godot | works (measured, live check) | The submit handler calls a GDScript function made with `JavaScriptBridge.create_callback()`. A `Label3D` shows the email or the chat line. |
| A press on a field with the event guard | Godot gets nothing (measured, live check and script) | The form calls `stopPropagation()` for mouse, pointer, touch, key, wheel and paste events. Godot's press count stays at 0. |
| A press on a field without the guard (`fixture.html?focus=1&bubble=1`) | the field loses focus (measured, script) | Godot's `mousedown` listener on the canvas calls `canvas.focus()`. After the click `document.activeElement` is the canvas, Godot counted 1 press, and typing "abc" left the field empty. |
| A press on the canvas beside the form | goes to Godot (measured, live check and script) | Godot counts it and focuses the canvas, so the field blurs. |
| Occlusion by Godot's own objects | not handled, not measured | An orbiting object drawn in front of a field is not known to the browser. Hit testing uses the geometry only, as on `/native-ui/` and `/three-form/`. |

## Packaging

| Experiment | Result | Detail |
| --- | --- | --- |
| Size of the export | measured | `index.wasm` 39,514,754 bytes, `index.js` 279,815, `index.pck` 13,168, two audio worklets 10,271. |
| `index.wasm` as a static asset on Cloudflare Workers | too large | The limit is 25 MiB per file. |
| Commit `index.wasm.gz` (gzip -9, 10,084,286 bytes), inflate with `DecompressionStream('gzip')`, answer the engine's `fetch()` of `index.wasm` with a `Response` of type `application/wasm` | works (measured, live check, localhost) | The engine's `WebAssembly.instantiateStreaming()` accepted the stream. Running 2.1 to 3.2 s after the start of the download. It is one file under the limit, so the file was not split into parts. Committed build output 10.4 MB in total. |
| Godot's `Engine` loader without its HTML shell | works (measured) | `new Engine({ canvas, executable, mainPack, canvasResizePolicy: 0, focusCanvas: false })`, then `startGame()`. The page sizes the canvas buffer and Godot follows it. |
| `npm run check:jank -- /godot-dom/` and with `--checks` | pass (measured) | With `--checks` at 4× CPU throttle the checks finish in 18 s, with 14.7 s of long tasks while the engine compiles and starts in the fixture frame. The page keeps `<meta name="checks" content="tap">` because the checks download 10.4 MB. |

## Things that bit

- Godot's `mousedown` listener focuses the canvas. Without the guard a click on a field left focus on the canvas.
- Inside the check fixture's frame, that same `canvas.focus()` could move focus out of the page that runs the checks. The fixture replaces `focus` on its canvas with a function that does nothing.
- `JavaScriptBridge.eval()` gave GDScript 1 and 0 for JavaScript booleans. The script wraps the result in `bool()`.
- `get_interface()` on a missing global prints `at: get_interface (platform/web/javascript_bridge_singleton.cpp:305)` through the engine's error printer. The bridge keeps engine errors apart from its own upload errors.
- The engine's loader has no option that takes a `Response` or bytes for the wasm. The bridge replaces `window.fetch` until `startGame()` resolves and puts it back.
- To check what Godot drew, the checks call `gl.readPixels()` on the default framebuffer from a `requestAnimationFrame` callback, which runs after Godot's own callback in the same frame. The drawing buffer is not preserved after that.
- A torus placed near the panel swung through it. Objects that must stay behind the form are placed well behind it.

## Not verified

- A real phone. The on-screen keyboard, IME composition, autofill and password managers on the fields, touch selection handles and the magnifier were not run. Open `/godot-dom/` on the phone, load the app, tap each field and type.
- Chrome 159 on Android, which the project owner's phone runs.
- Frame rate and upload cost on a real GPU. The page prints the last upload time under the stage, and the live checks print it for each route.
- The deployed site. `index.wasm.gz` was served by `python3 -m http.server` and the jank guard's server, which send no `Content-Encoding`. If a host sends `Content-Encoding: gzip` the browser inflates the file first. The bridge checks the first two bytes and skips its own inflate in that case. That branch was not run.
- Loss of the WebGL context. The page shows a message on `webglcontextlost`. The event was not forced, because `WEBGL_lose_context.loseContext()` on a drawable WebGL canvas crashes the renderer in C157.
- Screen readers. The check only reads `computedName` or the label text.
- Godot's threaded build, the `dlink` templates and the debug template. Route 2 assumes the GL texture is created during the `create_from_image()` call, which a threaded rendering server may not do.
- Occlusion: turning a press away from a field that is under an orbiting object, for example with a ray cast in GDScript before the event is delivered.
- Transparent forms. The quad's shader ignores alpha and the upload is not premultiplied.

## For the index

- WebGL, native toolkits: a stock Godot 4.7.2 web export takes a DOM element as a texture through `texture_get_native_handle()` and Emscripten's `GL.textures`, reached with `JavaScriptBridge.eval(code, false)` (`/godot-dom/`, C157).
- WebGL: a foreign engine's texture can be identified without engine internals by wrapping `gl.createTexture` for the length of the engine call that creates it (`/godot-dom/`, C157).
- Input: an engine that listens on the canvas needs events stopped at the element. Godot's `mousedown` handler calls `canvas.focus()` (`/godot-dom/`, C157).
- Deploy: a wasm file over 25 MiB can be committed gzip-compressed and inflated with `DecompressionStream` into a streaming `Response` (`/godot-dom/`, C157, localhost only).

## API requests

- As on `/native-ui/`: `updateElementGeometry()` has no way to say what covers an element. Bindings generated from IDL (here Emscripten's GL layer) have no entry for `texElementSubImage2D`, so the call goes through page JavaScript.
