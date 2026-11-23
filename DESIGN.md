# Design

The visual style of the site as it is built, the writing rules, and the conventions every page follows. The source of truth for values is `public/shared/style.css` and the inline styles in `public/shared/nav.js`. This file describes them so a tool can make a new page that matches without reading every existing one.

Related files: [ARCHITECTURE.md](ARCHITECTURE.md) (how a page is built and checked), [AGENTS.md](AGENTS.md) (working rules).

## Contents

- [Principles](#principles)
- [Colour](#colour)
- [Type](#type)
- [Layout and spacing](#layout-and-spacing)
- [Components](#components)
- [The menu bar](#the-menu-bar)
- [The homepage](#the-homepage)
- [Section order on a page](#section-order-on-a-page)
- [Phone rules](#phone-rules)
- [Motion and stability](#motion-and-stability)
- [Canvases](#canvases)
- [Accessibility conventions](#accessibility-conventions)
- [Writing rules](#writing-rules)
- [Page conventions checklist](#page-conventions-checklist)

## Principles

These are read from the code and from the project owner's feedback. They are not a brand guide.

1. **The demo is the page.** Site chrome is one 48 px bar. Each page has a short introduction, then the demo, then the evidence.
2. **Plain HTML first.** Without the API every page is readable HTML. The homepage is a CSS grid of links that a script upgrades. `/?plain` shows it without the upgrade.
3. **Nothing moves by itself.** A page must not shift, scroll, take focus or flash while it loads or while its checks run. `npm run check:jank` enforces this.
4. **It works on a phone.** The project owner tests every page on Chrome on an Android phone. 412 px wide, touch, no hover.
5. **Every page shows its code and its evidence.** A "Show the code" listing sits under each demo and a results table of live checks sits under "Live checks".
6. **Failure is visible.** A blank or lost canvas shows a message or falls back to plain HTML. A check that fails shows as a failing row.
7. **System fonts, no web fonts, no images in the chrome.** The only pictures are demo content and the homepage thumbnails.

## Colour

Tokens are custom properties on `:root` in `shared/style.css`. `color-scheme: light dark` is set, and the dark values apply under `prefers-color-scheme: dark`. There is no theme switch.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f6f4ef` | `#161514` | Page background. Also the background of code blocks inside show-code listings. |
| `--fg` | `#1d1c1a` | `#eeebe5` | Text. Border colour of a hovered button or card. |
| `--muted` | `#6b6760` | `#a19c93` | Lede, notes, captions, pending rows, comment colour in code. |
| `--card` | `#ffffff` | `#211f1d` | Cards, stages, `pre`, buttons, folded boxes. |
| `--line` | `#ddd8cf` | `#3a3733` | Every border and table rule. |
| `--accent` | `#d2491f` | `#ff7a4d` | Links, focus outlines, list markers in code listings, the `</>` badge, keywords in code. |
| `--ok` | `#1f7a3a` | `#5fcf7f` | Passing rows, the "API is available" banner, strings in code. |
| `--bad` | `#b3261e` | `#ff8a80` | Failing rows, the "API is not available" banner. |
| `--warn` | `#8a6100` | `#f0c060` | Numbers and attribute names in code. |

Rules:

- Use the tokens. Do not write hex colours in page styles for chrome, text or borders.
- Tinted backgrounds are made with `color-mix(in srgb, var(--ok) 14%, transparent)` (the support banner does this).
- The menu bar in `nav.js` repeats the light and dark values as literals, because it must work when `style.css` is missing. Its background is the page background at 0.92 (light) or 0.9 (dark) alpha with `backdrop-filter: blur(10px)`. If a token changes, change `nav.js` too.
- Demo content may use its own colours. The widgets in `shared/live-widgets.css` use fixed colours on purpose: a widget must look the same wherever its pixels are shown (another tab, another origin, a video).
- A transparent area in a fixture picture is shown on a 12 px checkerboard (`img.fixture-shot`).

## Type

| Element | Rule |
|---|---|
| Body | `16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--mono` | `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |
| `h1` | `clamp(28px, 5vw, 40px)`, line height 1.1, letter spacing -0.02em, margin `0 0 8px` |
| `h2` | 22 px, letter spacing -0.01em, margin-top 48 px |
| `p.lede` | 18 px, `--muted`, max width 70ch |
| `code` | `--mono` at 0.9em |
| `pre` | `13px/1.5 var(--mono)` |
| Code in a show-code listing | `12.5px/1.55 var(--mono)`, tab size 2 |
| `.note` | 14 px, `--muted` |
| `table.results` | 14 px |
| Small caps labels (menu group titles, homepage group titles) | `600 11px` or `12px` `--mono`, letter spacing 0.08em, upper case, `--muted` |
| Homepage hero `h1` | `clamp(34px, 7vw, 64px)`, letter spacing -0.035em, line height 1, `text-wrap: balance` |
| Homepage section titles | `clamp(24px, 4vw, 32px)`, letter spacing -0.02em |

Headings use sentence case. Element and API names in headings and prose are written as code: `<dom-portal>`, `drawElementImage()`.

## Layout and spacing

- `* { box-sizing: border-box }`. `body { margin: 0 }`.
- `main` is `max-width: 960px`, centred, padding `28px 16px 80px`, with `overflow-x: clip` so nothing makes the page scroll sideways.
- `html { scroll-padding-top: 64px }` so anchors and `scrollIntoView()` clear the sticky menu.
- The menu's inner width is 1100 px.
- Spacing steps in use: 4, 6, 8, 12, 14, 16, 24, 28, 48 px. Gaps in rows and grids are 12 or 16 px. A new section starts 48 px below the last.
- Radii: 6 px (buttons), 8 px (`pre`, the support banner, code blocks), 10 px (folded boxes: show-code, checks-fold), 12 px (`.card`, `.stage`), 14 px (homepage cards), 99 px (tag chips).
- Borders are `1px solid var(--line)`. There are no drop shadows on page content. The open menu panel is the one element with a shadow.
- `.row` is `display: flex; gap: 12px; flex-wrap: wrap; align-items: center` for a line of controls.
- Grids of cards use `repeat(auto-fill, minmax(270px, 1fr))` with a 16 px gap.

## Components

All of these are in `shared/style.css` unless noted.

| Component | Markup | Notes |
|---|---|---|
| Support banner | `<div id="support"></div>` first in `main` | `banner()` from `support.js` fills it. Class `ok` or `bad` gives a 14% tint. 14 px text, padding `10px 14px`, margin-bottom 24 px. |
| Card | `.card` | `--card` background, 1 px line, 12 px radius, 16 px padding. |
| Stage | `.stage` | The box a demo canvas sits in. Same as a card with 12 px padding. |
| Button | `button` | Inherits the font, padding `6px 12px`, 6 px radius, `--card` background. Hover darkens the border to `--fg`. |
| Checks gate | `.checks-gate` with a button | The "Run these N checks" button on pages whose checks wait for a tap. Padding `10px 16px`, weight 600. |
| Results table | `<table class="results"><tbody>` | Rows from `runTests()`. `td.status` is bold and does not wrap. Classes `pass`, `fail`, `pending`, `idle` colour the status. Cells wrap anywhere. |
| Folded checks | `details.checks-fold` | Made by `runTests()` around the table. The summary shows the pass count. Minimum height 46 px. Closed below 700 px wide. |
| Show the code | `details.show-code` with an `<ol>` of `<li data-code="file#region">` | Closed in the HTML, one line of 46 px. The summary has a `</>` badge and a `<small>` that says what the listing covers. Each step gets a code block (`.sc-block`) with the file name linked to GitHub, a Copy button and a Wrap button (at least 34 px high). Long blocks are cut at 26em with a fade and a "Show all lines" button. |
| Row code | `details.row-code` | The function behind one row of a results table (`window.showCode.block(fn)`). |
| Source view | `<details class="source" data-src>` | Whole example files on the slot pages (`shared/source-view.js`). Fixed height, scrolls inside itself. |
| About this experiment | inserted by `nav.js` and `learn.js` under `main p.lede`, from the page's `page.json` | The question, "Builds on" links, the API calls used, and a link to the page's Findings. Closed on a phone, as one line. |
| "Drawn with" switch | `routeSwitch()` from `shared/route-switch.js` | A menu of WebGPU, WebGL and 2D with a line that says what is drawing and, when it is not WebGPU, why. |
| Note | `.note` | Muted 14 px text for caveats under a demo. |
| Findings list | `ul.findings` | 6 px between items. |
| Fixture picture | `img.fixture-shot` | A picture of what a check's fixture drew, in its result row. |
| Connection log | `connectionLog(el)` from `lib/live-log.js` | Plain lines with a Copy button, for pages where a phone has no console. |

Code colouring in listings has five classes: `.sc-c` comments (muted, italic), `.sc-s` strings (`--ok`), `.sc-k` keywords (`--accent`), `.sc-n` numbers and `.sc-a` attributes (`--warn`).

## The menu bar

Built by `shared/nav.js`, which carries its own CSS.

- Sticky at the top, 48 px high, `z-index: 2147483000`, blurred translucent background, 1 px bottom border.
- Left: a Home link reading "HTML-in-canvas experiments". Below 520 px wide it reads "experiments".
- Right: a previous arrow, a `<details>` whose summary is the current page's title (or "Browse (N)"), and a next arrow. The arrows are 40×40 px.
- The open panel has a live search filter, quick links (`Home`, `Examples`, `Libraries`, `Learn the API`, `About`), and collapsible `<details>` groups from `DEMO_GROUPS` (the current page's group opens automatically; typing a filter opens matching groups). Links are at least 40 px high. The current page is inverted (`aria-current="page"`).
- The panel closes on a click outside it and on Escape.
- Group order puts visual and interactive experiments first across 15 focused groups (Shaders, lenses and visual UI; Custom form controls and pickers; Transitions, text and motion; 3D, spatial and WebXR; Maps and geospatial; Video and sound; Windows, tabs and cross-origin; Native UI toolkits in the browser; Slots (where this started); AI, voice and controllers; Foldables, peripherals and app windows; Developer tools in a canvas; HTML elements in a canvas; Benchmarks, audits and limits; Learn, libraries and about).
- Do not use a class named `.bar` in a page. The menu uses it.

## The homepage

`public/index.html` with `public/home.js`. Section order:

1. A hero heading and lede with quick jump links (`Examples`, `Libraries`, `All experiments`, `Learn the API`, `Limits`, `About`).
2. "Examples": 31 visual highlights with a 3:2 picture each, from `public/shared/thumbs/*.jpg` (720×480), leading with per-element themes, peel-to-view-source, conveyor belt virtualised list, translate lens, shaders, lenses, physical meshes and form instruments.
3. "Drop-in libraries": cards for the standalone ES modules and custom elements under `/lib/` (plus links to `/use-it/` and GitHub).
4. "All experiments": filter bar (search input, group chips with counts, Expand/Collapse all) and 14 `<details class="group-fold" open>` sections (all open by default) generated from `shared/pages.js`. With the API available, `home.js` slots the links into a canvas in a shadow root and draws them with a hover effect. Without it the cards are a plain grid.
5. "Learn the API": a link to `/start/` and the table of which experiments use each API call (`LEARN.uses`).
6. "The building block" and "Limits of the API".

## Section order on a page

An experiment page, top to bottom:

1. Support banner.
2. `h1`: the element, call or task the page is about.
3. `p.lede`: what the demo does and how to use it. One short paragraph. The "About this experiment" box is inserted after it.
4. The demo, in a `.stage` or `.card`. Controls sit next to it in a `.row`.
5. `details.show-code`.
6. Further demos on the same page, each with its own `h2` and listing.
7. `h2` "How it works": the explanation.
8. `h2` "Live checks": the results table.
9. `h2` "Findings": what worked, what did not, what is still open.

Use exactly the names "How it works", "Live checks" and "Findings" (PR #38). Anything placed above the demo pushes it down the first screen of a phone, so keep additions above the demo to one line.

`/start/` is the one tutorial and has its own order: Enable the API, A minimal page, Four steps, What keeps working and what does not, WebGL, hit testing and workers, Common errors, Where each call is used, Glossary. Other pages link to `/start/#enable`, `#gotchas`, `#path` and `#glossary` and do not repeat them.

## Phone rules

- Test at 412 px wide with touch and a device scale factor of 2.625.
- Nothing may be wider than the screen. Lay drawn elements out from `canvas.clientWidth`, not from a fixed width.
- Below 620 px, `table.results` and `table.lab` rows stack as blocks and the header row is hidden. Write cells that still read when stacked.
- Below 700 px, the checks table and the "About this experiment" box start closed.
- Touch targets are at least 40 px high (menu links, arrows) and buttons inside code blocks at least 34 px.
- A finger does not hover. A demo that follows the pointer must work from `pointerdown` and forget the pointer after the touch ends.
- Set `touch-action: none` on an element the reader drags (a lens, a material). Set `touch-action: pinch-zoom` on content inside a top-layer canvas so the page does not pan under the finger. Inside a select picker, cancel `touchmove`: `touch-action` did not stop panning there.
- Do not size a canvas stage with `dvh`. It changes each time the URL bar moves. Use `svh`.
- Start anything heavy from a button on touch devices. `(hover: hover) and (pointer: fine)` tells a desktop from a phone.
- A field that a script focuses gets `inputmode="none"` so the keyboard stays down.
- A phone has few hardware video decoders and a small GPU budget. Load a video only when it is near the screen, pause it when it leaves, and do not open several WebGL contexts and a WebGPU device on load.
- A phone has no console. Errors that matter are written on the page.

## Motion and stability

- The first paint is held by `nav.js` until the page has stopped changing height, so a page does not build itself in front of the reader.
- Folded boxes (`details.show-code`, `details.checks-fold`) have a fixed closed height of 46 px, so opening the page never moves it.
- Results rows are listed up front and filled in, so the table does not grow under the reader.
- Animation in a demo is the subject of the demo. The site chrome has no transitions.
- Open item from the accessibility audit: `/slot/`, `/transitions/` and `/particles/` animate continuously with no `prefers-reduced-motion` handling.

## Canvases

- Size the backing store in device pixels with a `device-pixel-content-box` ResizeObserver, and multiply by `element.currentCSSZoom` where CSS `zoom` may apply.
- Assign `canvas.width` and `canvas.height` only when the value changed. Assigning clears the canvas.
- A canvas with a fixed `width` attribute goes soft at 150% zoom. The audit lists the pages that still do this.
- A pixel-only canvas (a mirror in another tab, another origin or a video) has no role, name, focus or text. Give it a label and a way back to the live element.
- A drawable child that the paint handler does not draw is still a Tab stop. Set `inert` on it.
- When a canvas is blank, lost or one flat colour, show a message over it or show the content as plain HTML. Never leave a white box.

## Accessibility conventions

- Focus outlines are `2px` or `3px solid var(--accent)` with a 1 or 2 px offset. Do not remove them.
- Every test input and control has a name (PR #20 added names to the motion pages).
- Tables that stack on a phone keep their reading order.
- `/a11y/` runs the same audit over every page that has a `page.json`. A new page is audited automatically.
- Not verified by a person: screen reader output, IME candidate windows, the find bar. `/a11y/` section C is the list to try by hand.

## Writing rules

The project owner asked for plain technical writing after reading the heading "One element, two places" on a pull request and saying it read as generated. The rules below are the working reading of that request. They apply to page copy, headings, the README, these documents, pull request text and reports.

The long form is [docs/writing.md](docs/writing.md): the habits that make text read as generated, and a description of how the project owner writes, with examples. The site's copy is written in his voice (first person, contractions, British spelling). `npm run check:writing` flags the habits a script can find.

- A title or heading names the thing: the element, the API call or the task. Example: "`<dom-portal>`: draw one element in two places".
- No slogans, no taglines, no paired or parallel phrases written for rhythm, no rhetorical questions.
- Say what the code does, with the call names and the numbers. Cut sentences that only sell.
- One fact per sentence. Prefer imperative instructions and plain declaratives.
- No lists of three written for rhythm. No "not X, but Y" contrasts written for effect. No closing line that restates the page as a moral.
- No em-dashes.
- Words to avoid: "delight", "the trick", "sharp edge", "story", "sells", "headline", "lands", "on steroids", "seamless", "powerful", "magic".
- State the browser and the date for a measurement. Say "not verified" when something was not run, and say what would verify it.
- Do not rename the project owner's existing demo titles into catchier ones.
- Do not write "what you will learn" copy for an experiment. State the question it asks.

Some existing headings and blurbs predate these rules (for example the homepage hero and the `/portal/` title). Leave the project owner's titles alone unless asked.

### Words used on the site

| Term | Meaning here |
|---|---|
| experiment | Any page except `/start/`. It asks a question about the API. |
| tutorial | `/start/` only. |
| live checks | The pass or fail rows a page runs in the visitor's browser. Older pages say "live tests". |
| findings | What an experiment concluded. The section name on every page and the name of `FINDINGS.md`. |
| drawn | Painted into a canvas by `drawElementImage()` or a texture upload. |
| picture | The pixels of an element as the canvas receives them (its paint record, rendered). |
| hit box, geometry | Where the browser thinks an element is for clicks, hover and focus. |
| route, backend | Which API draws: WebGPU, WebGL or 2D. |
| fixture | Markup a check builds for itself, apart from the visible demo. |
| plain HTML | The page or element shown without a canvas. |

## Page conventions checklist

- [ ] `<script src="/shared/nav.js"></script>` is the first thing in `<body>`.
- [ ] `<link rel="stylesheet" href="/shared/style.css">` and the viewport meta tag are in `<head>`.
- [ ] A `page.json` beside the page. No edits to shared lists.
- [ ] `<div id="support"></div>`, `h1`, `p.lede`, then the demo.
- [ ] A closed `details.show-code` under the demo, with `#region` comments in the source.
- [ ] Sections "How it works", "Live checks", "Findings".
- [ ] Checks run on fixtures, never on the visible demo.
- [ ] Colours come from the tokens. Light and dark both readable.
- [ ] No sideways scroll at 412 px. Dragging and scrolling work by touch.
- [ ] A lost or blank canvas shows a message or plain HTML.
- [ ] `npm run check:jank -- /page/` passes.
- [ ] Copy follows the writing rules.
