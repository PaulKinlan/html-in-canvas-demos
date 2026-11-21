# Instructions for tools and people working in this repository

This repository is a set of experiments with the HTML-in-canvas API, served as a static site from `public/` by a Cloudflare Worker. Read this file first. It says which document holds what, and the rules that apply to every change.

## Which file to read

| You need | Read |
|---|---|
| The goals, what is built, what is planned, who is building it, and what still needs real hardware | [PLAN.md](PLAN.md) |
| What the API does and does not do, with the browser and page for each result; Chromium bugs; API requests | [FINDINGS.md](FINDINGS.md) for the index, [findings/](findings/) for the tables of each page or strand |
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
- `public/shared/pages.js` is generated by `npm run build` from the `page.json` files and is not committed. Run the build once before serving `public/` yourself. `npm run check:jank`, `npm run dev`, `npm run deploy` and Workers Builds run it themselves.
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
- Shared code: `public/shared/support.js`, `nav.js`, `style.css`, `learn.js`, `show-code.js`, `public/lib/surface.js`, `tools/site/`, `tools/jank/`. If a page needs a change there, make it in a separate small pull request that does only that, and open the page's pull request after it merges. A helper that one page needs goes in a new file.
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
