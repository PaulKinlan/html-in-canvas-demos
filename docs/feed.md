# The RSS feed

`https://html-in-canvas.page/feed.xml` is an RSS 2.0 feed with one item for each page of the site. `npm run build` writes it from the same files the menu comes from, so a new page is in the feed after the next deploy with no other step. The file is `public/feed.xml`, and it isn't committed.

The code is in `tools/feed/`: `site-build.mjs` is the build step and `content.mjs` cuts the text out of a page and converts the findings files.

## What an item holds

An item is meant to be read in a feed reader without opening the page.

| Part of the item | Where it comes from |
|---|---|
| `title`, `link`, `guid` | The `title` in `page.json` and the page's address. The address is the id, and it doesn't change |
| `pubDate` | The `added` date in `page.json`, at 00:00 UTC |
| `category` | Each entry of `tags` |
| `description` | The `blurb` as plain text |
| `content:encoded`: the picture | `public/<name>/social.jpg`, if the page has one |
| `content:encoded`: "Question" and "Short answer" | `question` and `result` in `page.json` |
| `content:encoded`: the first paragraph | The `<p class="lede">` of the page, or the `blurb` if there isn't one |
| `content:encoded`: "How it works" and "Findings" | The sections of the page under those two `<h2>` headings |
| `content:encoded`: "Results table" | The parts of the files in `findings/` that are about the page |

The home page isn't an item. It is the channel.

The text from a page is cut down to paragraphs, lists, tables, code and links. Canvases, scripts, form controls, the "Show the code" listing and the "Live checks" table are left out, because a feed reader can't run them. Links are made absolute.

A findings file is matched to a page in two ways. `findings/<name>.md` belongs to `/<name>/`. A file that covers several pages has a `##` section for each one with the page's path in the heading, for example ``## `/fold/`, `lib/fold-view.js` ``, and a page gets the sections that name it. The sections "For the index", "Chromium bugs" and "API requests" are left out.

## Dates

A feed reader decides that an item is new from its id, and sorts by its date. Both have to be the same on every build, or every page would come up as new after each deploy.

The date is the `added` field of the page's `page.json`. I chose it over the date of the commit that added the page for two reasons. Workers Builds may check out a shallow copy of the repository, where the first commit of a file can't be found. A branch that is squashed or rebased also gets a new commit date. A date written in the file has neither problem.

So give a new page `"added": "YYYY-MM-DD"` in its `page.json`. A page without one is still in the feed, at the end and with no date, and the build prints its path. The 43 pages that had no date got the date of the commit that added them (2026-11-20 or 2026-11-21), read from the full history on 2026-11-23.

The channel's `lastBuildDate` is the newest `added` date, so the file is the same on every build until a page changes.

Changing a page doesn't make it new in a reader. Its item gets the new text and keeps its id and date.

## Size

On 2026-11-23 the feed had 157 items and was 1.6 MB, 418 KB compressed. Most of that is the results tables. If the file gets too large for readers, the first thing to cut is those tables for pages older than a few months, in `item()` in `tools/feed/site-build.mjs`.

## Where it is linked

- Every page that has a `page.json` has `<link rel="alternate" type="application/rss+xml">` in its generated `<head>` block, so a browser or reader finds the feed from any page. See [social-metadata.md](social-metadata.md).
- The home page links it above the list of experiments and in the line of links at the bottom. `/about/` links it under "Project links".

## Checking it

```
node tools/feed/site-build.mjs            # writes the feed, prints the number of items and the size
node tools/feed/site-build.mjs /fold/     # prints the item for one page
node tools/feed/check.mjs                 # builds the feed and checks it (see the top of the file)
```

## Not verified

- No feed reader has subscribed to the live feed yet. The file was parsed as XML and each item's HTML was parsed in headless Chromium (2026-11-23).
- The feed is served as `application/xml`, the type Workers static assets give an `.xml` file. Readers accept that. `application/rss+xml` would need a rule in `public/_headers`, and I haven't tried one.
