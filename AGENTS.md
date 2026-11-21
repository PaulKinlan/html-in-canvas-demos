# Instructions for tools and people working in this repository

This repository is a set of experiments with the HTML-in-canvas API, served as a static site from `public/` by a Cloudflare Worker. Read this file first. It says which document holds what, and the rules that apply to every change.

## Which file to read

| You need | Read |
|---|---|
| The goals, what is built, what is planned, who is building it, and what still needs real hardware | [PLAN.md](PLAN.md) |
| What the API does and does not do, with the browser and page for each result; Chromium bugs; API requests | [FINDINGS.md](FINDINGS.md) |
| The repository layout, the Worker, shared modules, the check harness, scripts, local testing, deploy, how to add a page | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Colours, type, components, section order, phone rules, writing rules | [DESIGN.md](DESIGN.md) |
| The explainer, Chrome documentation, every cited source, live and preview URLs | [KNOWN-LINKS-AND-RESOURCES.md](KNOWN-LINKS-AND-RESOURCES.md) |
| The list of pages with one line each, the library call signatures, the show-code markup | [README.md](README.md) |
| Native UI frameworks on the web (Qt, Flutter, Compose, egui and others) | [docs/native-frameworks.md](docs/native-frameworks.md) |
| The `<slot-view>` wire protocol | [public/slot-view/PROTOCOL.md](public/slot-view/PROTOCOL.md) |
| One row per HTML element drawn in a canvas, and 121 ideas | `ELEMENTS.md` (arrives with PR #48) |
| 678 Chrome features with ideas, and 28 planned demos | `docs/chrome-apis-plan.md` (arrives with PR #50) |
| The raw API in 60 lines | [public/start/hello.html](public/start/hello.html) |

The five top-level documents (PLAN, FINDINGS, ARCHITECTURE, DESIGN, KNOWN-LINKS-AND-RESOURCES) are the source of truth for the project. Keep them current in the same pull request as the change that makes them stale.

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

## Rules for every change

Writing:

- Plain, literal technical prose. No slogans, taglines, paired phrases written for rhythm, rhetorical questions or marketing tone. No em-dashes. The full rules are in [DESIGN.md](DESIGN.md), "Writing rules".
- Do not rename existing demo titles.

Pages:

- `<script src="/shared/nav.js"></script>` is the first thing in `<body>`.
- Register a page with one line at the end of its group in `public/shared/demos.js` and one entry in `public/shared/learn.js`. One entry per line, so parallel branches merge.
- Section names after the demo: "How it works", "Live checks", "Findings".
- Give the page a closed `details.show-code` listing. Do not delete or move `#region` comments without checking the listings that use them.
- The full steps are in [ARCHITECTURE.md](ARCHITECTURE.md), "How to add a page".

Stability:

- A page must not shift, scroll itself, move focus, flash or blank a canvas while it loads or while its checks run. Run `npm run check:jank -- /your-page/` for every page you change.
- Live checks run on their own fixtures. They never call `scrollIntoView()`, `scrollTo()` or `focus()` on the visible page and never touch the visible demo.
- No `dvh` on a canvas stage. Assign `canvas.width` only when the size changed.

API use:

- Always pass a width and height to `drawElementImage()`.
- After a WebGL or WebGPU draw, call `updateElementGeometry()`. After moving a hit box, toggle an attribute on the element to clear Chromium's hit-test cache.
- Pick WebGPU only through `public/shared/backend.js`. Order: WebGPU, then WebGL, then 2D.
- Start a page on its lightest drawing route. Open one graphics context per page where possible. Show a message or plain HTML when a canvas is blank or its context is lost.
- Method names in Chromium 157: `gl.texElementSubImage2D()` and `GPUQueue.drawElementImageToTexture()`. three.js r187 needs `installThreeShims()` from `public/lib/html3d.js`.

Things that crash the renderer in Chromium 157. Do not do them outside an isolated reproduction page:

- `element.startViewTransition()` on a `drawable` child of a drawable canvas.
- Inserting, moving or removing an iframe inside a `paint` handler or its microtasks.
- `adoptNode()` of a painted drawable canvas into an iframe.
- An opacity effect around a drawable canvas inside an iframe that is drawn into a canvas.
- `WEBGL_lose_context.loseContext()` on an attached drawable WebGL canvas.

Generated and vendored files:

- `public/lib/fx.js` is generated. Edit `shader-fx.js`, `effects.js`, `surface.js`, `gpu-util.js` or `shared/backend.js`, then run `npm run build:fx`. `npm run check:fx` must pass.
- `public/native-ui/egui/` and `public/native-ui/qt/` are build output. Edit the sources in `native/` and run the build scripts.
- `ELEMENTS.md` and `docs/chrome-apis-plan.md` are generated by `npm run record:elements` and `npm run build:plan` once their pull requests have merged.
- Do not edit `public/vendor/`.

Secrets:

- `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are Worker secrets. Never put them, or any other credential, in the repository.

## What you cannot verify in a headless browser

Headless Chromium has software rendering, no sound, no native popup windows, no immersive WebXR and (in the cloud containers this project was built in) no outbound UDP. So WebGPU on screen, real frame rates, hardware video decoding, native pickers, screen readers, IME, touch selection and connections between real networks cannot be confirmed there. Build the page so that it reports the answer on the device that opens it (a live check, a "Measure on this device" button, a connection log), and list the item in [PLAN.md](PLAN.md) under "Not verified".

Verify WGSL off screen by rendering to a texture and reading it back. Test HiDPI with `--force-device-scale-factor` and no viewport emulation. The details are in [ARCHITECTURE.md](ARCHITECTURE.md), "Testing locally".

## Pull requests

- Many branches are open at once and pull requests are merged within seconds or minutes of opening. Finish the branch before opening the pull request: a push made after opening can miss the merge.
- Merge `main` into the branch immediately before opening the pull request. `FINDINGS.md`, `README.md`, `public/shared/demos.js`, `public/shared/learn.js` and `public/shared/support.js` are edited by every branch and conflict often. Append to them. Do not reorder or reformat them.
- Put the preview link, with the page path, in the pull request description. The preview URL is `https://<alias>-html-in-canvas-preview.kinlan-test.workers.dev/`, where the alias is the branch name in lower case, non-alphanumerics turned into `-`, a leading `claude-` removed, cut to 36 characters. Previews are static: `/api/*` does not work in them.
- A push to `main` deploys the site.
- Append results to `FINDINGS.md` (a section at the end, a line in Contents, rows in the index) and update `PLAN.md` in the same pull request.
- If the pull request is opened through an integration that makes the repository owner its author, a review request to the owner fails. Assign the owner.
