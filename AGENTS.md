# Instructions for tools and people working in this repository

This repository is a set of experiments with the HTML-in-canvas API, served as a static site from `public/` by a Cloudflare Worker. Read this file first. It says which document holds what, and the rules that apply to every change.

## Which file to read

| You need | Read |
|---|---|
| The goals, what is built, what is planned, who is building it, and what still needs real hardware | [PLAN.md](PLAN.md) |
| What the API does and does not do, with the browser and page for each result; Chromium bugs; API requests | [FINDINGS.md](FINDINGS.md) for the index, [findings/](findings/) for the tables of each page or strand |
| Every kind of crash and lost canvas found so far, with steps and evidence for a bug report | `/crashes/` (`public/crashes/cases.js`). Add an entry there when a new one is found |
| What did not work as expected, by kind and area | `/friction/` (`public/friction/entries.js`). Add an entry there when a new one is found |
| What crashed, threw or lost a context on a real device, by origin and page | `npm run reports`, and [docs/crash-reports.md](docs/crash-reports.md) |
| Why canvases were lost on the phone, the graphics rules, their limits and exceptions | [docs/graphics-rules.md](docs/graphics-rules.md), and [docs/lost-contexts.md](docs/lost-contexts.md) for the measurements behind the first guard |
| The repository layout, the Worker, shared modules, the check harness, scripts, local testing, deploy, how to add a page | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Colours, type, components, section order, phone rules, writing rules | [DESIGN.md](DESIGN.md) |
| The explainer, Chrome documentation, every cited source, live and preview URLs | [KNOWN-LINKS-AND-RESOURCES.md](KNOWN-LINKS-AND-RESOURCES.md) |
| The list of pages | `npm run pages`. Each page's own `public/<name>/page.json` holds its title, question and API calls |
| Which files a pull request may edit, and why pull requests used to conflict | [ARCHITECTURE.md](ARCHITECTURE.md), "Files that parallel branches share" |
| The library call signatures, the show-code markup | [README.md](README.md) |
| Native UI frameworks on the web (Qt, Flutter, Compose, egui and others) | [docs/native-frameworks.md](docs/native-frameworks.md) |
| The `<slot-view>` wire protocol | [public/slot-view/PROTOCOL.md](public/slot-view/PROTOCOL.md) |
| One row per HTML element drawn in a canvas, and 121 ideas | [ELEMENTS.md](ELEMENTS.md) |
| 678 Chrome features with ideas, and 29 planned demos | `public/chrome-apis/plan.md` after `npm run build`, or https://html-in-canvas.page/chrome-apis/plan.md |
| The tags and the picture a shared link shows (description, Open Graph, Twitter card, schema.org, `social.jpg`), the sitemap | [docs/social-metadata.md](docs/social-metadata.md) |
| The raw API in 60 lines | [public/start/hello.html](public/start/hello.html) |

The five top-level documents (PLAN, FINDINGS, ARCHITECTURE, DESIGN, KNOWN-LINKS-AND-RESOURCES) and the files in `findings/` are the source of truth for the project. A pull request that adds or changes a page records its results in its own file in `findings/`. The top-level documents are brought up to date by a documentation pass on its own branch (see "Files a pull request may edit" below).

## What the site is

- `/start/` is the only tutorial. Every other page is an experiment at the edge of the API. An experiment states a question, runs live checks in the visitor's browser, and reports findings. Do not write an experiment as a lesson or a recommended pattern, and do not put experiments in a reading order.
- Every page shows its code (a "Show the code" listing cut from the running source) and its evidence (a "Live checks" table).
- The site must work on Chrome on an Android phone, by touch, at about 412 px wide.

## How to work

These come from the project owner.

1. Do not stop to ask clarifying questions. Make a sensible choice, say which one you made, and carry on. Come back only when truly blocked.
2. Push the limits of the API. Build the test even if you expect it to fail. Let it fail visibly, record the finding, then try the alternatives one after another. Try every route (for example every transport), not only the first that works.
3. When you have a plan, carry it out. Do not hand back a list of decisions.
4. Bring your own ideas as well as the listed ones.
5. Do not invent results. A result is "measured" only if a check or script produced it. State the browser version and the date. Say "not verified" for anything that was not run, and say what would verify it.
6. Effects should transform the page's own content and be visually strong. A demo that only moves things to a new position was judged underwhelming.
7. Read the reports before replying about a page the owner has opened. Every copy of the site sends crashes, lost contexts and script errors to one endpoint. After he demos or tests a page, and whenever he says a page is broken, run `npm run reports -- --since 2h --list` (add `--origin <branch name>` for a preview, `--page /name/` for one page), quote what it shows, and work from that. If nothing was reported for the page, say so. Details: [docs/crash-reports.md](docs/crash-reports.md).

## Rules for every change

Writing:

- Plain, literal technical prose. No slogans, taglines, paired phrases written for rhythm, rhetorical questions or marketing tone. No em-dashes. The full rules are in [DESIGN.md](DESIGN.md), "Writing rules".
- Do not rename existing demo titles.

Pages:

- `<script src="/shared/nav.js"></script>` is the first thing in `<body>`.
- Register a page by adding `public/<name>/page.json` beside it (menu group, title, blurb, tags, question, result, first, api). There is no shared list of pages to edit. Run `npm run build` to write the menu, which is a generated file.
- Section names after the demo: "How it works", "Live checks", "Findings".
- Give the page a closed `details.show-code` listing. Do not delete or move `#region` comments without checking the listings that use them.
- The full steps are in [ARCHITECTURE.md](ARCHITECTURE.md), "How to add a page".

Stability:

- A page must not shift, scroll itself, move focus, flash or blank a canvas while it loads or while its checks run. Run `npm run check:jank -- /your-page/` for every page you change.
- Live checks run on their own fixtures. They never call `scrollIntoView()`, `scrollTo()` or `focus()` on the visible page and never touch the visible demo.
- No `dvh` on a canvas stage. Assign `canvas.width` only when the size changed.

API use:

- Always pass a width and height to `drawElementImage()`, in the units of the context (`el.offsetWidth, el.offsetHeight` after `ctx.scale(dpr, dpr)`). With no size, a scaled context draws the element `devicePixelRatio` times too large on a phone and correctly in the test browser. `npm run build` fails on a three-argument call (`draw-size`), and `node tools/draw-size/audit.mjs /your-page/` measures the page at device scale 2.625. Details: [docs/draw-size.md](docs/draw-size.md).
- After a WebGL or WebGPU draw, call `updateElementGeometry()`. After moving a hit box, toggle an attribute on the element to clear Chromium's hit-test cache.
- Pick WebGPU only through `public/shared/backend.js`. Order: WebGPU, then WebGL, then 2D.
- Start a page on its lightest drawing route. Open one graphics context per page where possible. Show a message or plain HTML when a canvas is blank or its context is lost.
- Method names in Chromium 157: `gl.texElementSubImage2D()` and `GPUQueue.drawElementImageToTexture()`. three.js r187 needs `installThreeShims()` from `public/lib/html3d.js`.

Graphics, so that a phone does not lose the canvases or the tab. These are checked: `npm run build` fails on the first five (`npm run check:gfx`), and `npm run check:jank` measures the rest. The reasons, the limits and how to write an exception are in [docs/graphics-rules.md](docs/graphics-rules.md).

- Never call `loseContext()`. To give a canvas back, remove it and call `window.__gfx?.retire(canvas)`. To test a fallback, dispatch a `webglcontextlost` or `contextlost` event.
- One WebGL context for a page, made with `new ElementGL(canvas, …)` from `public/lib/element-gl.js`, on one canvas that draws every element. Do not call `getContext('webgl2')` in a page or a new library.
- One WebGPU device for a page, from `webgpu()` in `public/shared/backend.js`. A live check uses `checkDevice()` from the same file. Do not call `adapter.requestDevice()`.
- No readback on a timer or in a frame loop: `getImageData()`, `readPixels()`, `mapAsync()`, `toDataURL()`, `toBlob()`. Read back when the person taps, or inside a live check. For pixels that are needed often, copy the canvas with `drawImage()` into a second, plain 2D canvas (never a drawable one) made with `willReadFrequently: true`, and read from the copy. That canvas is kept in ordinary memory.
- Never make a drawable canvas with `willReadFrequently: true`, in a page or in a live check fixture. Measured on the test phone with `/canvas-loss/` on 2026-11-21 (Chrome 159, Android 10): one `drawElementImage()` into such a canvas, with no read, lost every 2D canvas on the page within 10 ms, and they were lost again every half second for as long as it existed. One read of an accelerated drawable canvas, and one read from a `drawImage()` copy, lost nothing there. A second `getImageData()` on a drawable canvas in a paint loop lost every 2D canvas, and so did every second read after it, so do not read a drawable canvas more than once: the guard answers `getImageData()` on a drawable canvas from a copy, and new code reads from its own `drawImage()` copy. The guard removes the option from a canvas that has its drawable attributes when `getContext()` is called, so set those attributes first. To read pixels, `drawImage()` the canvas into a plain canvas and read that.
- No `getImageData()` with `pixelFormat: 'rgba-float16'` on a canvas that is shown, not even on a tap. On the test phone it lost the canvas each time it ran, on a timer and on a tap. A page whose evidence is the float values (`/hdr-glow/`) may read once on a tap if it replaces the canvas after a loss and does not read again on that device. A `drawImage()` copy into a second float16 canvas does not help: it clamps to 1.0 (measured in Chromium 157).
- No canvas over 4 megapixels at the test size (412 CSS pixels wide, scale 2.625: 1,410 CSS pixels tall at full width), and no more than 96 MB in all canvases together, as `window.__gfx.memory()` estimates it. Split a tall canvas, and set a canvas that is far off screen to 0 by 0.
- Free a canvas when it is removed: `window.__gfx?.retire(canvasOrElement)`. `runTests()` does this for check fixtures on the test stage. A page with its own fixtures does it itself.
- Live checks that make a WebGL or WebGPU context, read pixels back from a GPU canvas, or run for more than a few seconds wait for a tap (`<meta name="checks" content="tap">`). The visible demo starts with nothing else running.
- Start a demo when its section comes near the screen, not all demos at load.
- Call `close()` on every picture from `captureElementImage()` when it has been drawn for the last time. A picture taken on a timer and never closed holds GPU memory. `npm run check:jank` fails a page that ends with more than 8 open (`openSnapshots`).
- Do not catch and hide an error that a reader would need: let it reach `window`, or send it with `window.__gfx.report(type, message, body)`. Do not reload the page or a frame from script when something fails. The guard holds drawing on a page that died, and a second loop defeats it.
- `/shared/context-guard.js` is the one place that counts contexts, estimates memory and handles a lost canvas. Do not add a second counter or a second rule in a page or a tool: change the guard, `tools/gfx/` or the limits in `tools/jank/check.mjs`, in a pull request that does only that.

Things that crash the renderer in Chromium 157. Do not do them outside an isolated reproduction page:

- `element.startViewTransition()` on a `drawable` child of a drawable canvas.
- Inserting, moving or removing an iframe inside a `paint` handler or its microtasks.
- `adoptNode()` of a painted drawable canvas into an iframe.
- An opacity effect around a drawable canvas inside an iframe that is drawn into a canvas.
- `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas. `npm run check:gfx` fails on any call to it.

Generated and vendored files:

- `public/lib/fx.js` is generated. Edit `shader-fx.js`, `effects.js`, `surface.js`, `gpu-util.js` or `shared/backend.js`, then run `npm run build:fx`. `npm run check:fx` must pass.
- `public/native-ui/egui/` and `public/native-ui/qt/` are build output. Edit the sources in `native/` and run the build scripts.
- `public/shared/pages.js` is generated by `npm run build` from the `page.json` files and is not committed. Run the build once before serving `public/` yourself. `npm run check:jank`, `npm run dev`, `npm run deploy` and Workers Builds run it themselves.
- The block between `<!-- social:start` and `<!-- social:end -->` in a page's `<head>` is written by `npm run build` from the page's `page.json` (`tools/social/`). Do not edit it by hand: change `page.json`, run the build and commit the page. `public/<name>/social.jpg` is made by `node tools/social/capture.mjs /<name>/` and is committed. `public/sitemap.xml` is generated and not committed.
- `public/chrome-apis/data.js` and `public/chrome-apis/plan.md` are generated by the same build from `tools/chrome-apis/` and are not committed. A page that builds a planned demo says so with `"plan": "<demo key>"` in its `page.json`. Do not add a `built` field to `tools/chrome-apis/demos.json`.
- `ELEMENTS.md` is generated by `npm run record:elements`.
- Do not edit `public/vendor/`.

Secrets:

- `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are Worker secrets. Never put them, or any other credential, in the repository.

## What you cannot verify in a headless browser

Headless Chromium has software rendering, no sound, no native popup windows, no immersive WebXR and (in the cloud containers this project was built in) no outbound UDP. So WebGPU on screen, real frame rates, hardware video decoding, native pickers, screen readers, IME, touch selection and connections between real networks cannot be confirmed there. Build the page so that it reports the answer on the device that opens it (a live check, a "Measure on this device" button, a connection log), and list the item under "Not verified" in the page's file in `findings/`. [PLAN.md](PLAN.md) collects those lists.

Verify WGSL off screen by rendering to a texture and reading it back. Test HiDPI with `--force-device-scale-factor` and no viewport emulation. The details are in [ARCHITECTURE.md](ARCHITECTURE.md), "Testing locally".

## Files a pull request may edit

Many branches are open at once. Until 2026-11-21 every page branch edited the same lists and 42 of 104 merges conflicted. The measurements and the reasons are in [ARCHITECTURE.md](ARCHITECTURE.md), "Files that parallel branches share". The rules:

A pull request that adds or changes a page edits only:

- The page's own folder, `public/<name>/`, including its `page.json`.
- Its own results file, `findings/<name>.md` (a strand that already has a file adds to that file).
- New files of its own: a library in `public/lib/`, a helper module, a tool in `tools/<name>/`, a document in `docs/`.

It does not edit:

- `FINDINGS.md`, `PLAN.md`, `README.md`, `ARCHITECTURE.md`, `DESIGN.md`, `KNOWN-LINKS-AND-RESOURCES.md`, `AGENTS.md`. Put what they will need in the findings file, under "For the index", "Not verified" and the open ideas. A documentation pass on its own branch copies it across.
- `package.json`. A new tool is run as `node tools/<name>/<script>.mjs` and described in the comment at the top of the script. `npm run tools` lists them.
- Shared code: `public/shared/support.js`, `nav.js`, `style.css`, `learn.js`, `show-code.js`, `context-guard.js`, `backend.js`, `public/lib/surface.js`, `tools/site/`, `tools/jank/`, `tools/gfx/` (a new page does not add itself to `tools/gfx/known.json`: it writes a `gfx-allow` comment at the call). If a page needs a change there, make it in a separate small pull request that does only that, and open the page's pull request after it merges. A helper that one page needs goes in a new file.
- Another page's folder or findings file, unless the change is the point of the pull request.

Do not commit generated files that are in `.gitignore` (`public/shared/pages.js`, `public/chrome-apis/data.js`, `public/chrome-apis/plan.md`). Do not create a file that lists every page, every finding or every tool: lists are generated or printed by a script.

A page whose checks must wait for a tap says so itself with `<meta name="checks" content="tap">` in its `<head>`. Known exceptions for the jank guard go in the `jank` field of its `page.json`.

## Pull requests

- Many branches are open at once and pull requests are merged within seconds or minutes of opening. Finish the branch before opening the pull request: a push made after opening can miss the merge.
- Start the branch from the current `main`. Do not build on another open pull request's branch: wait for it to merge.
- Run `npm run check:merge` and merge `main` into the branch immediately before opening the pull request. If a merge conflicts in a file both sides appended to, keep both sides with the text from `main` first. Do not reorder or reformat a shared file.
- Put the preview link, with the page path, in the pull request description. The preview URL is `https://<alias>-html-in-canvas-preview.kinlan-test.workers.dev/`, where the alias is the branch name in lower case, non-alphanumerics turned into `-`, a leading `claude-` removed, cut to 36 characters. Previews are static: `/api/*` does not work in them.
- A push to `main` deploys the site.
- Record results in `findings/<name>.md` in the same pull request. [findings/README.md](findings/README.md) says what the file holds.
- If the pull request is opened through an integration that makes the repository owner its author, a review request to the owner fails. Assign the owner.
