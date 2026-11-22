# Social sharing tags, schema.org data and pictures

Every page that has a `page.json` carries the tags that a shared link and a search engine read. They are written by the build from the `page.json`, so a new page gets them from the file it already has.

## What a page carries

`npm run build` (the hook is `tools/social/site-build.mjs`) writes one block into the page's `<head>`, after `<title>`, between `<!-- social:start ... -->` and `<!-- social:end -->`:

| Tag | Value |
|---|---|
| `<meta name="description">` | The `blurb` as plain text, in whole sentences up to about 200 characters. Left out when the page has its own description outside the block |
| `<link rel="canonical">`, `og:url` | `https://html-in-canvas.page` and the page's path. A page `/<name>/<file>.html` is named without `.html`, because the Worker's asset handling redirects to that address |
| `og:type` | `website` for `/`, `article` for every other page |
| `og:title`, `twitter:title` | The `title` |
| `og:description`, `twitter:description` | The same text as the description |
| `og:image`, `twitter:image`, with width, height, type and alt text | `public/<name>/social.jpg` if it exists, otherwise `public/social.jpg` |
| `twitter:card` | `summary_large_image` |
| `article:published_time` | The `added` date, when the page has one |
| `<script type="application/ld+json">` | For `/`: `WebSite`, `Person` (the author) and `CollectionPage`. For every other page: `TechArticle` (name, description, the `question` as `abstract`, `tags` and `api` as `keywords`, image, author, `isPartOf` the site) and a `BreadcrumbList` |

The site's name, address, description and author are in `SITE` at the top of `tools/social/meta.mjs`.

The block is committed with the page. The build rewrites it only when the `page.json` or the picture changed. Workers Builds runs the build before each deploy, so a page whose block is missing or stale in the repository is deployed with a current one.

The build also writes `public/sitemap.xml` (not committed), one URL for each page file. `public/robots.txt` names it.

## Pictures

`node tools/social/capture.mjs /<name>/` writes `public/<name>/social.jpg`: 1200 by 630 pixels, JPEG, about 40 to 120 KB. It opens the page in headless Chromium 1000 CSS pixels wide at scale 1.2, hides the menu bar, scrolls to the first large visible canvas, waits, takes a screenshot, and puts the page title and the site's address on a band along the bottom.

- A page with no large canvas is shown from its top.
- If the canvas is one flat colour (less than 2% of its pixels differ from the commonest colour), the picture is a card with the page's `question` instead. This happens where the test browser, which renders in software, does not draw what a phone or desktop draws.
- `--top` takes the top of the page. `--card` makes the question card. Use them when the screenshot shows the wrong thing.
- With no page named, the tool makes pictures only for pages that have none. `--all` replaces every picture.

Look at each new picture before committing it. The tool cannot tell a correct drawing from a wrong one that has many colours.

## Checking

`node tools/social/validate.mjs` reads the tags back from every page as a crawler that runs no script would, and checks that there is one block, that it matches what the build would write, that the description, canonical URL, Open Graph and Twitter tags are present once, that the JSON-LD parses and names the page, and that the picture exists and is a 1200 by 630 JPEG. With a page path it also prints that page's tags.

## Two rules that come from other tools

- The JSON-LD is written one value per line. `tools/gfx/check.mjs` does not read a file that has a line over 2,000 characters, so one long line switched the graphics rules off for the page.
- In the JSON-LD, `(`, `'` and `` ` `` are written as `\u` escapes. The same tool reads every `<script>` as code, and an API name in the text, such as `getImageData({ pixelFormat: 'rgba-float16' })` in a page's `api` list, was taken for a call.

## Not verified

- No crawler or card validator has fetched the pages: the cloud container cannot reach the deployed site. After a deploy, check a few pages in the Rich Results Test, the Schema Markup Validator, and by pasting a link into the apps that matter (Slack, LinkedIn, Bluesky, Mastodon, X, iMessage, WhatsApp).
- The pictures were made in headless Chromium with software rendering. Pages whose demo needs WebGPU on screen, a camera, a headset or a second origin show their fallback, the top of the page, or the question card.
