# Known links and resources

Every external source this project has used or cited, the live site and preview URLs, and related work. Collected 2026-11-21 from the pages, the documents and the pull requests in this repository.

Each link has a status:

- **cited**: the link is in a page or document in this repository, and the text next to it was written from the page it points to.
- **search**: found by a web search on 2026-11-21 while writing this file. The page was not opened. The note beside it comes from the search result and may be wrong.
- **general**: a well-known documentation root added for convenience. Not cited in the repository and not opened.

Related files: [FINDINGS.md](FINDINGS.md), [PLAN.md](PLAN.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## Contents

- [This project](#this-project)
- [The HTML-in-canvas API](#the-html-in-canvas-api)
- [How to turn the API on](#how-to-turn-the-api-on)
- [API surface used here](#api-surface-used-here)
- [View transitions](#view-transitions)
- [Chrome Status data](#chrome-status-data)
- [Shaders, 3D and XR](#shaders-3d-and-xr)
- [Native UI frameworks](#native-ui-frameworks)
- [Hosting: Cloudflare](#hosting-cloudflare)
- [Related work by the project owner](#related-work-by-the-project-owner)
- [Test browsers and tools](#test-browsers-and-tools)
- [Links that are missing](#links-that-are-missing)

## This project

| What | URL |
|---|---|
| Repository | https://github.com/PaulKinlan/html-in-canvas-demos |
| Live site, custom domain | https://html-in-canvas.page/ |
| Live site, workers.dev name | https://html-in-canvas-demos.kinlan-test.workers.dev/ |
| Second origin for the cross-origin demos | https://html-in-canvas-remote.kinlan-test.workers.dev/ |
| Branch previews | `https://<alias>-html-in-canvas-preview.kinlan-test.workers.dev/`. The alias is the branch name in lower case, non-alphanumerics turned into `-`, a leading `claude-` removed, cut to 36 characters. Static files only. |
| Tutorial | https://html-in-canvas.page/start/ |
| Findings on GitHub | https://github.com/PaulKinlan/html-in-canvas-demos/blob/main/FINDINGS.md |
| The `fx` library for other sites | https://html-in-canvas.page/lib/fx.js |
| `<canvas-slot>` as a module | https://html-in-canvas.page/lib/canvas-slot.js (every file under `/lib/` is served with `Access-Control-Allow-Origin: *`) |
| Stand-alone `fx` example | https://html-in-canvas.page/shader-css/standalone.html |
| Native frameworks survey | https://github.com/PaulKinlan/html-in-canvas-demos/blob/main/docs/native-frameworks.md |
| `<slot-view>` protocol | `public/slot-view/PROTOCOL.md` in this repository |

Every page is at `https://html-in-canvas.page/<name>/`. The list of pages is in `public/shared/demos.js` and in the table in [ARCHITECTURE.md](ARCHITECTURE.md).

## The HTML-in-canvas API

| What | URL | Status |
|---|---|---|
| WICG explainer and specification work. The source for "read-back-allowed rendering" and for what is left out of an element's picture. | https://github.com/WICG/html-in-canvas | cited |
| "HTML-in-Canvas: technical concepts", Chrome for Developers | https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts | cited |
| Chrome for Developers blog post on the origin trial | https://developer.chrome.com/blog/html-in-canvas-origin-trial | search. The result describes the trial as Chrome 148 to 150. |
| "HTML-in-Canvas updates: Iterating toward a better Web API", Chrome for Developers blog | https://developer.chrome.com/blog/html-in-canvas-ot-changes | search. The result says Chrome 150 and 155 changed the API, that from Chrome 155 `drawElementImage()` returns nothing, that a 2D context syncs hit testing by itself and that WebGL and WebGPU need explicit geometry updates. That matches what was measured here in Chromium 157. It also says the trial runs through Chrome 160. |
| Chrome Platform Status entry | https://chromestatus.com/feature/5172548013916160 | search. The feature id comes from a search result. Check it before citing it. |
| blink-dev: "Ready for Developer Testing: HTML in Canvas: drawElement" | https://groups.google.com/a/chromium.org/g/blink-dev/c/LYJyOdLbOfY | search |
| blink-dev: "Intent to Experiment: HTML-in-canvas" | https://groups.google.com/a/chromium.org/g/Blink-dev/c/t_nGEmJ_v4s | search |
| blink-dev: "Intent to Extend Experiment: HTML-in-canvas" | https://groups.google.com/a/chromium.org/g/blink-dev/c/BpWbzJ9P22s | search |
| Microsoft Edge origin trial registration for html-in-canvas | https://developer.microsoft.com/en-us/microsoft-edge/origin-trials/trials/a297467e-0030-4c4c-8739-48e130026c03 | search |
| "15 updates from Google I/O 2026", Chrome for Developers blog | https://developer.chrome.com/blog/chrome-at-io26 | search. Expected to mention the API's announcement. |

## How to turn the API on

- Chrome 148 or later, desktop or Android: set `chrome://flags/#canvas-draw-element` to Enabled.
- A site can enable it for its visitors with the origin trial named `html-in-canvas`.
- Chromium command line: `--enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement`. To turn it off: `--disable-blink-features=CanvasDrawElement`.
- The floor of Chrome 148 is what the pages state. Nothing older than Chromium 153 was tested in this project.
- The site's own instructions: https://html-in-canvas.page/start/#enable

## API surface used here

The names below are the ones that work in Chromium 157. Earlier builds and some libraries use older names.

| Name | Kind | Note |
|---|---|---|
| `<canvas content="drawable">` | attribute | Required. `layoutsubtree` is the older name and is not enough by itself in 157. Pages here write both. |
| `drawable` | attribute on each element to draw | Without it `drawElementImage()` throws. |
| `paint` event, `canvas.onpaint`, `event.changedElements` | event | Fires when a drawn element's rendering changes. |
| `canvas.requestPaint()` | method | Ask for a `paint` event. |
| `ctx.drawElementImage(el, x, y, w, h)` and the nine-argument form | 2D method | Returns `undefined`. Moves the element's hit box. |
| `canvas.captureElementImage(el)`, `ElementImage`, `ElementImage.close()` | snapshot | Transferable, not cloneable. Draws only into its source canvas. |
| `canvas.getElementImageDefaultSize(el)` | method | The size a texture must have. |
| `canvas.updateElementGeometry(el, { canvasTransform, canvasClip })`, `clearElementGeometry()`, `elementgeometryupdate` event | hit testing | Needed after WebGL and WebGPU draws. |
| `gl.texElementSubImage2D()` | WebGL | three.js r187 calls the older name `texElementImage2D`. |
| `GPUQueue.drawElementImageToTexture({ source }, { texture })` | WebGPU | three.js r187 calls the older name `copyElementImageToTexture`. |
| `preserveElementGeometry` | option | Draw without moving the hit box. Used by `element-capture.js`. |

`installThreeShims()` in `public/lib/html3d.js` maps the names three.js r187 calls to the names Chromium 157 has.

## View transitions

Cited on `/view-transitions/` and in FINDINGS.md.

| What | URL |
|---|---|
| Element-scoped view transitions, Chrome for Developers | https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions |
| Element-scoped view transitions, Chrome for Developers blog | https://developer.chrome.com/blog/element-scoped-view-transitions |
| Cross-document view transitions, Chrome for Developers | https://developer.chrome.com/docs/web-platform/view-transitions/cross-document |
| Using element-scoped view transitions, MDN | https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using_element-scoped |
| `Element.startViewTransition()`, MDN | https://developer.mozilla.org/en-US/docs/Web/API/Element/startViewTransition |
| CSS View Transitions Module Level 2, editor's draft | https://drafts.csswg.org/css-view-transitions-2/ |
| Element-scoped view transitions explainer, CSS Working Group | https://github.com/w3c/csswg-drafts/blob/main/css-view-transitions-2/element-scoped-view-transitions.md |
| Sample: "My Patagonia trip" | https://view-transitions.chrome.dev/my-patagonia-trip/ |

Element-scoped view transitions shipped in Chrome 147, with developer testing from 140. No Chrome Platform Status entry for them was found by search when the page was written.

## Chrome Status data

| What | URL |
|---|---|
| Features by milestone, the source of the Chrome APIs plan (PR #50). The JSON response starts with `)]}'`, which must be removed before parsing. | `https://chromestatus.com/api/v0/features?milestone=N` for N = 130 to 160 |
| One feature | `https://chromestatus.com/feature/<id>` |
| The plan built from it | https://html-in-canvas.page/chrome-apis/ and `docs/chrome-apis-plan.md` (both arrive with PR #50) |
| The probes | https://html-in-canvas.page/chrome-apis/probes.html (PR #50) |

The plan document links the Chrome Platform Status entry of each of the 678 features it lists. On the fetch date, 2026-11-21, Chrome 159 was stable and 160 was beta.

## Shaders, 3D and XR

| What | URL or location | Status |
|---|---|---|
| gl-transitions: the convention `<live-transition>` shaders follow (`vec4 transition(vec2 uv)`, `getFromColor`, `getToColor`, `progress`, `ratio`). Shaders from the site paste in unchanged. | https://gl-transitions.com/ | cited by name in FINDINGS.md and README.md |
| three.js r187, vendored | `public/vendor/three/` with its LICENSE | in the repository |
| IWER, Meta's Immersive Web Emulation Runtime, vendored. Used by `/xr/?emulate=1`. | `public/vendor/iwer/` with its LICENSE | in the repository |
| QR code generator, vendored. Used by `/remote/`. | `public/lib/vendor/qrcode.js` | in the repository |
| EditContext API, MDN | https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API | cited |

## Native UI frameworks

The 30 sources of `docs/native-frameworks.md`, fetched 2026-11-21. The numbers match the reference numbers in that document.

1. Qt for WebAssembly, Qt 6.12 documentation. https://doc.qt.io/qt-6/wasm.html
2. `qwasmwindow.cpp`, qtbase. https://code.qt.io/cgit/qt/qtbase.git/plain/src/plugins/platforms/wasm/qwasmwindow.cpp
3. `qwasminputcontext.cpp`, qtbase. https://code.qt.io/cgit/qt/qtbase.git/plain/src/plugins/platforms/wasm/qwasminputcontext.cpp
4. Qt for WebAssembly on mobile devices, Qt blog, 2022. https://www.qt.io/blog/qt-for-webassembly-on-mobile-devices
5. `qwasmaccessibility.cpp`, qtbase. https://code.qt.io/cgit/qt/qtbase.git/plain/src/plugins/platforms/wasm/qwasmaccessibility.cpp
6. Web renderers, Flutter documentation. https://docs.flutter.dev/platform-integration/web/renderers
7. Using HTML slots to render platform views in the web, Flutter documentation. https://docs.flutter.dev/release/breaking-changes/platform-views-using-html-slots-web
8. Accessibility in Flutter on the Web, Flutter blog. https://flutter.dev/blog/accessibility-in-flutter-on-the-web and Web accessibility. https://docs.flutter.dev/ui/accessibility/web-accessibility
9. `text_editing.dart`, Flutter web engine. https://raw.githubusercontent.com/flutter/flutter/master/engine/src/flutter/lib/web_ui/lib/src/engine/text_editing/text_editing.dart
10. `HtmlElementView` class, Flutter API. https://api.flutter.dev/flutter/widgets/HtmlElementView-class.html
11. Embedding web content into a Flutter web app. https://docs.flutter.dev/platform-integration/web/web-content-in-flutter
12. What's new in Compose Multiplatform 1.9.0. https://kotlinlang.org/docs/multiplatform/whats-new-compose-190.html
13. Kotlin Slack archive, a thread on HTML-in-canvas. Not fetched (HTTP 429); known from a search summary only. https://slack-chats.kotlinlang.org/t/33262003/has-anyone-experimented-with-html-in-canvas-yet-it-seems-lik
14. egui README. https://raw.githubusercontent.com/emilk/egui/main/README.md
15. egui accessibility guide. https://raw.githubusercontent.com/emilk/egui/main/docs/accessibility.md
16. `text_agent.rs`, eframe. https://raw.githubusercontent.com/emilk/egui/main/crates/eframe/src/web/text_agent.rs
17. `screen_reader.rs`, eframe. https://raw.githubusercontent.com/emilk/egui/main/crates/eframe/src/web/screen_reader.rs
18. Dear ImGui FAQ (first two thirds read). https://raw.githubusercontent.com/ocornut/imgui/master/docs/FAQ.md
19. Slint on the web. https://docs.slint.dev/latest/docs/slint/guide/platforms/web/
20. Uno Platform: Skia rendering. https://platform.uno/docs/articles/features/using-skia-rendering.html and hosting native controls. https://platform.uno/docs/articles/features/using-skia-hosting-native-controls.html
21. "Web breaking change: deprecating and removing the HTML renderer", flutter-announce. Title only, from search. https://groups.google.com/g/flutter-announce/c/JqkMe7cPkQo
22. `createImageFromTextureSource`, `dart:ui_web`. https://api.flutter.dev/flutter/dart-ui_web/createImageFromTextureSource.html
23. Avalonia for WebAssembly. https://avaloniaui.net/platforms/wasm
24. HTML-in-Canvas: technical concepts, Chrome for Developers. https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts
25. WICG html-in-canvas explainer, "Read-back-allowed rendering". https://github.com/WICG/html-in-canvas
26. Input in Web, Unity manual. https://docs.unity3d.com/Manual/webgl-input.html
27. Unity issue tracker. Title only. https://issuetracker.unity3d.com/issues/ime-languages-are-not-recognized-when-entering-input-in-mobile-and-webgl-builds
28. Godot Web progress report 7, April 2021. https://godotengine.org/article/godot-web-progress-report-7
29. Exporting for the Web, Godot documentation. https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
30. EditContext API, MDN. https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API

Toolchain downloads used to build `/native-ui/` in a cloud container (from the project notes):

- Rust: `rustup target add wasm32-unknown-unknown`, `cargo install wasm-bindgen-cli --version 0.2.130 --locked`, optional `cargo install wasm-opt`. crates.io was reachable.
- Qt: `pip install aqtinstall`, then `aqt install-qt linux desktop 6.10.3 linux_gcc_64` and `aqt install-qt all_os wasm 6.10.3 wasm_singlethread`. download.qt.io was reachable. The `bin` and `libexec` folders needed `chmod +x` afterwards.
- Emscripten 4.0.7: the emsdk repository on GitHub was blocked, so the binaries came from `https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/<sha>/wasm-binaries.tar.xz`, with the sha read from `emscripten-releases-tags.json` in the emsdk repository on raw.githubusercontent.com, plus the node tarball from the `deps/` folder of the same bucket. Lay it out as `$EMSDK/upstream` with a `$EMSDK/.emscripten` that sets `EMSCRIPTEN_ROOT = emsdk_path + '/upstream/emscripten'`. Qt's CMake reads that file.

## Hosting: Cloudflare

| What | URL or name | Status |
|---|---|---|
| Workers documentation | https://developers.cloudflare.com/workers/ | general |
| Static assets on Workers (`assets` in `wrangler.jsonc`, `_headers`) | https://developers.cloudflare.com/workers/static-assets/ | general |
| Workers Builds (deploys `main`, builds the branch previews) | https://developers.cloudflare.com/workers/ci-cd/builds/ | general |
| Durable Objects (the `Room` class) | https://developers.cloudflare.com/durable-objects/ | general |
| Workers AI (the `/api/x/vision` endpoint) | https://developers.cloudflare.com/workers-ai/ | general |
| Cloudflare Realtime TURN: the endpoint the Worker calls for credentials | `https://rtc.live.cloudflare.com/v1/turn/keys/<key id>/credentials/generate-ice-servers` | in `src/cross-context.js` |
| STUN servers offered | `stun:stun.cloudflare.com:3478`, `stun:stun.l.google.com:19302` | in `src/cross-context.js` |
| Vision models tried | `@cf/mistralai/mistral-small-3.1-24b-instruct` (about 1 s, correct), `@cf/meta/llama-4-scout-17b-16e-instruct` (about 12 s, correct), `@cf/google/gemma-4-26b-a4b-it` (empty answer, not used) | checked once by hand on 2026-11-20 |

Workers on the account: `html-in-canvas-demos`, `html-in-canvas-remote`, `html-in-canvas-preview`. Deploy details are in [ARCHITECTURE.md](ARCHITECTURE.md), "Deploy and preview".

## Related work by the project owner

| What | URL | Note |
|---|---|---|
| ExtensibleWebApps | https://github.com/PaulKinlan/ExtensibleWebApps | Its page slots (`<slot name="main">` in the light DOM used as mount points, no shadow root) were studied at commit 78dfeff on 2026-11-20. The pattern works with a drawable canvas and is on `/slot/mount.html`. Site: extensibleweb.app. |
| A 3D demo shown at Google I/O 2026 | no URL recorded | The project brief names it as earlier work to look at for the 3D strand. No link is in the repository or the project notes, and a web search on 2026-11-21 did not find a page for it. |

## Test browsers and tools

| What | Note |
|---|---|
| Playwright with Chromium | Needed by `npm run check:jank` and the recording scripts. `npm i -D playwright` if it is not installed. |
| Chromium 157, headless shell | The browser most results were measured in. The API is on by default and it behaves as if experimental web platform features were on. Software rendering. |
| Chromium 153, full browser | Needs the two flags above. Used for the second column of the Chrome APIs probes. |
| Chrome 159 on Android | The project owner's phone. The source of every "reported from the phone" result. |
| ffmpeg | Needed by `tools/media/make.sh`. |
| wrangler | `npx wrangler dev`, `npx wrangler deploy`. |

## Links that are missing

These were looked for and not found, or never looked for. Add them here when known.

- MDN reference pages for the HTML-in-canvas API itself.
- A samples or demos page for the API maintained by the Chrome team.
- The Chromium bug tracker component for the API, and the tracking bug. Search results say the origin trial blog post links it.
- A Chrome Platform Status entry for element-scoped view transitions.
- The URL of the Google I/O 2026 3D demo.
- The three.js issue or pull request for the renamed methods (`texElementSubImage2D`, `drawElementImageToTexture`).
