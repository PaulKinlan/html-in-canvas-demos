# Demos and interface work by other people (`/elsewhere/`, `tools/elsewhere/build.mjs`)

Measured on 2026-11-23 from the cloud container, with curl and with the test browser (C157). The page is a list of links and draws nothing in a canvas, so it has no live checks.

| Question | Result | Notes |
|---|---|---|
| Do the outside links on the page load? | measured: 102 of 122 answered 200 | 91 answered a plain request. 11 more (`*.vercel.app`, `tympanus.net`, `ui-feed.dev`, `html-in-canvas.vittoretrivi.dev`) answered 403 to a plain request and 200 in the test browser. |
| The other 20 | not verified | All are `github.com` pages, which the cloud container refuses. |
| The 33 links to posts on X | not verified | X answers 200 to any request, so the count above says nothing about them. They come from the work pages on Memorables. |
| Does the page hold still while it loads? | measured: yes | `npm run check:jank -- /elsewhere/`: layout shift 0, no canvas. The list is static HTML written by `node tools/elsewhere/build.mjs`. |
| Does it fit a phone? | measured: yes | 412 px wide: `scrollWidth` 412, 75 cards in one column. |

## Things that bit

- A description field that holds `<input type="range">` as text is read as a tag by anything that treats the field as HTML (the feed does). The fields `title`, `what` and `note` are HTML: element names are written `&lt;input&gt;`, and `<code>` is the only tag the build accepts.
- `/elsewhere/feed.xml` is written by `tools/feed/site-build.mjs` (pull request 133) from the same `entries.json`. The guid of a feed item is the page address plus `#id`, so an entry's `id` must not change once it is published.

## Not verified

- The "how it could be drawn" line on each entry under "Interface work I'd like to rebuild". Each is a plan made from a description. A page that builds one records its own results.
- That each X post still exists and shows what Memorables describes.

## For the index

- Site: `/elsewhere/` lists other people's HTML-in-canvas demos, libraries, interface work to rebuild and proposed controls. Data: `public/elsewhere/entries.json`. Build: `node tools/elsewhere/build.mjs` (`--check`, `--links`). The weekly search that adds to it is described in `docs/ui-watch/README.md`.
- AGENTS.md "Which file to read" could gain two rows: outside examples (`public/elsewhere/entries.json`) and the weekly reports (`docs/ui-watch/`).
- Generated and vendored files: the block between `elsewhere:start` and `elsewhere:end` in `public/elsewhere/index.html` is written by `node tools/elsewhere/build.mjs`.
