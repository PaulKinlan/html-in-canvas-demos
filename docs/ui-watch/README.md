# UI watch: a weekly search for UI worth rebuilding with HTML-in-canvas

Once a week a scheduled run searches the web for new interface work and writes a report here. Paul asked for it on 2026-11-23. He wants to see every kind of modern UI and every proposed control, and to know whether each one can be rebuilt with native HTML elements drawn by a canvas.

This file is the runbook. A run starts by reading it. In the reports "I" is the run (Claude), and Paul is named.

## What a run produces

1. A report, `docs/ui-watch/YYYY-MM-DD.md`, named after the day of the run. One file per week. The report is useful by itself: Paul reads it even when nothing gets built.
2. New entries for the page of outside examples, `/elsewhere/` (`public/elsewhere/entries.json`, then `node tools/elsewhere/build.mjs`). Only work that is good enough to send a reader to.
3. When there is time left, one demo page built from the best find, as its own pull request.

Each of the three is a separate pull request. Paul reviews each new demo page by itself.

## Where to look

Read these every week. The list grows: add a source when a run finds a good one, and say so in the report.

| Source | What it has | How to read it |
|---|---|---|
| https://memorabl.es/explore/interface and https://memorabl.es/inspiration/best-ui-design-2026 | Hand-picked interface work, each credited and linked to the original | Plain fetch. A work page (`/work/<slug>`) has the description, the original link and `datePublished` in its JSON-LD |
| https://raw.githubusercontent.com/GoogleChromeLabs/css-web-ui-demos/main/html-in-canvas/awesome-html-in-canvas.md | Chrome's list of HTML-in-canvas demos by other people, and the frameworks that support the API | Plain fetch. Compare with last week's copy |
| https://html-in-canvas.dev/demos/ | En Dash's gallery of HTML-in-canvas demos with source | Plain fetch |
| https://canvasui.dev/components | CanvasUI, a component library built on the API. New components are marked | Plain fetch |
| https://chrome.dev/html-in-canvas/ | Chrome's own demos | Plain fetch |
| https://hn.algolia.com/api/v1/search_by_date?query=%22html-in-canvas%22&tags=story | Hacker News stories about the API, newest first | JSON. Parse with `strict=False` |
| https://open-ui.org/ and `https://www.w3.org/YYYY/MM/DD-openui-minutes.html` | Open UI proposals (each explainer has a "Last Updated" date) and the minutes of the Thursday call | Plain fetch. Try the last two Thursdays |
| `https://chromestatus.com/api/v0/features?milestone=N` | What ships in each Chrome milestone | JSON after the `)]}'` prefix |
| https://tympanus.net/codrops/ and https://tympanus.net/codrops/hub/all/codrops/ | Codrops articles and demos | Refuses a plain fetch (403). Load it in the headless browser |
| https://css-tricks.com/feed/, https://frontendmasters.com/blog/feed/, https://www.smashingmagazine.com/feed/, https://www.bram.us/feed/ | Articles on new CSS and HTML | RSS |
| https://dev.to/alvaromontoro | "10 Cool CodePen Demos", monthly | Headless browser |
| https://60fps.design/ | Mobile and web interaction clips | Plain fetch |
| https://detail.design/ | Annotated UI and motion details | Plain fetch |
| https://www.hoverstat.es/ | Experimental web interactions and shaders | Plain fetch |
| https://godly.website/ | Curated gallery of interactive web sites | Plain fetch |
| https://gl-transitions.com/ | Open-source GLSL transition shaders | Plain fetch |
| https://rive.app/community/ | State-machine UI and vector motion files | Plain fetch |
| https://www.interfaceingame.com/ | Game HUDs, menus and screen transitions | Plain fetch |
| https://rauno.me/craft | Rauno Freiberg's interaction prototypes | Plain fetch |
| https://emilkowal.ski/ | UI animation notes and components | Plain fetch |
| Web search | Anything else: "html-in-canvas", `drawElementImage`, new component libraries, CSS Working Group resolutions | Search for the current month by name |

Not covered here:

- https://ui-feed.dev/. The thread "Rebuild ui-feed demos in canvas" works through that site. Mention it only when it adds a kind of control it didn't have.
- X, Dribbble and Vimeo posts can't be opened from the cloud container. When the original is one of those, the report says the description comes from the site that featured it.
- https://www.designspells.com/, https://refs.gallery/, https://www.gameuidatabase.com/ and https://www.shadertoy.com/ block plain fetches (403 or 429). Check them in a normal browser when looking for micro-interactions, game UI or shaders.
- `github.com` pages for other people's repositories are refused in the container. `raw.githubusercontent.com` works.

## How a find is judged

For each find the report says:

- What it is, who made it, the link to the original and where it was found.
- The native element that would sit underneath (`<input type="range">`, `<select>`, `<details>`, `<dialog>`, `<button popover>` and so on). Paul's rule: native elements underneath, no React components. A web component is fine, with `ElementInternals` where no native element fits and slots only for data the page author supplies.
- The drawing route: 2D (`drawElementImage()` with clips, transforms and `ctx.filter`), a 2D mesh of clipped draws, or a shader through `ElementGL` or WebGPU.
- What happens to input. A draw that is one matrix keeps hit testing through `updateElementGeometry()`. A bend, a polar warp or a cloth does not, and the report says so.
- The nearest page already on this site, from `npm run pages`.
- A verdict: **build** (new and it suits the API), **built** (the site has it), **CSS** (CSS does it without a canvas, so a canvas adds nothing), **partial** (it can be drawn and something is lost) or **skip**.

Every verdict in a report is inferred from the description and from what `findings/` records, unless the report says a check measured it. Nothing in a report is "measured" until a page is built and its live checks run.

## Rules

- Credit every find with its maker's name and a link to the original. Write new code and new copy. Don't copy source, assets or branding.
- Don't repeat a find from an earlier report unless it changed. Read the last two reports first.
- Follow [AGENTS.md](../../AGENTS.md): the writing rules, "Files a pull request may edit", and one page per pull request.
- Run `node tools/writing/check.mjs --docs` before opening the report's pull request.
- Say which sources failed to load.

## Schedule

Mondays at 05:41, Europe/London. The run posts in the project thread "Track new UI demos weekly".
