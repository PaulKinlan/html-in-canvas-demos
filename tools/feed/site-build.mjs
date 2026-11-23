// Part of `npm run build` (tools/site/build.mjs calls build() below).
//
// Writes public/feed.xml, an RSS 2.0 feed with one item for each page that has
// a page.json. It is not committed. A new page is in the feed after the next
// build with no other step, because the build runs before every deploy.
//
// An item holds what the page says about itself, so it can be read in a feed
// reader without opening the page:
//   - the question and the short answer from page.json
//   - the lede and the "How it works" and "Findings" sections of the page's HTML
//   - the parts of the findings/ files that are about the page, as tables
//
// The date of an item is the "added" field of its page.json (YYYY-MM-DD), and
// its id is the page's address. Neither changes from one build to the next, so
// a reader shows a page once, on the day it was added. A page with no "added"
// is listed last with no date, and the build prints its path. The channel's
// lastBuildDate is the newest "added", so the file is the same on every build
// until a page changes.
//
//   node tools/feed/site-build.mjs            write the feed and print its size
//   node tools/feed/site-build.mjs /fold/     print the item for one page
import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPages, repoRoot } from '../site/pages.mjs';
import { SITE, describe, plainText, imageFileFor } from '../social/meta.mjs';
import { clean, esc, pageSections, findingsFor, markdown } from './content.mjs';

const publicDir = path.join(repoRoot, 'public');
const findingsDir = path.join(repoRoot, 'findings');
const exists = (f) => access(f).then(() => true, () => false);

// The address and the name in the <link rel="alternate"> of every page are SITE.feed in tools/social/meta.mjs.
export const FEED = {
  path: SITE.feed.path,
  title: SITE.name,
  description: 'Each new experiment with the HTML-in-canvas API on html-in-canvas.page: the question it asks, how it works and what I found.',
};

const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const rfc822 = (ymd) => new Date(`${ymd}T00:00:00Z`).toUTCString().replace('GMT', '+0000');

async function item(page, { files, known }) {
  const file = path.join(publicDir, page.href.endsWith('/') ? page.href + 'index.html' : page.href);
  const hasImage = await exists(path.join(publicDir, imageFileFor(page.href)));
  const d = describe(page, { hasImage });
  const { lede, sections } = pageSections(await readFile(file, 'utf8'));
  const parts = [];
  if (hasImage) parts.push(`<p><a href="${esc(d.url)}"><img src="${esc(d.image)}" width="${SITE.image.width}" height="${SITE.image.height}" alt="${esc(`The page "${d.title}"`).replace(/"/g, '&quot;')}"></a></p>`);
  if (page.question) parts.push(`<p><strong>Question:</strong> ${clean(page.question, d.url)}</p>`);
  if (page.result) parts.push(`<p><strong>Short answer:</strong> ${clean(page.result, d.url)}</p>`);
  const intro = clean(lede, d.url) || (page.blurb ? `<p>${clean(page.blurb, d.url)}</p>` : '');
  if (intro) parts.push(intro);
  for (const s of sections) {
    const body = clean(s.html, d.url);
    if (body) parts.push(`<h3>${esc(s.title)}</h3>`, body);
  }
  for (const f of findingsFor(page.href, files, known)) {
    const source = `${SITE.repo}/blob/main/findings/${f.name}`;
    parts.push(`<h3>Results table</h3>`, `<p>From <a href="${source}">findings/${esc(f.name)}</a> in the repository.</p>`, markdown(f.text, source));
  }
  parts.push(`<p><a href="${esc(d.url)}">Open ${esc(d.title)}</a>. The page draws live HTML in a canvas and runs its checks in your browser, so it needs a Chrome that has the HTML-in-canvas API.</p>`);
  const tags = [...new Set((page.tags ?? []).map(plainText))];
  return {
    page, url: d.url,
    xml: [
      '<item>',
      `<title>${esc(d.title)}</title>`,
      `<link>${esc(d.url)}</link>`,
      `<guid isPermaLink="true">${esc(d.url)}</guid>`,
      page.added ? `<pubDate>${rfc822(page.added)}</pubDate>` : null,
      `<dc:creator>${esc(SITE.author.name)}</dc:creator>`,
      ...tags.map((t) => `<category>${esc(t)}</category>`),
      `<description>${esc(plainText(page.blurb || page.question || d.description))}</description>`,
      `<content:encoded>${cdata(parts.join('\n'))}</content:encoded>`,
      '</item>',
    ].filter(Boolean).join('\n'),
  };
}

export async function feed({ pages }) {
  const files = await Promise.all((await readdir(findingsDir)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
    .map(async (name) => ({ name, text: await readFile(path.join(findingsDir, name), 'utf8') })));
  const known = new Set(Object.keys(pages));
  // The home page is the list of pages, so it is the channel and not an item.
  const list = Object.values(pages).filter((p) => p.href !== '/' && p.title)
    .sort((a, b) => (b.added ?? '').localeCompare(a.added ?? '') || a.href.localeCompare(b.href));
  const items = [];
  for (const p of list) items.push(await item(p, { files, known }));
  const newest = list.find((p) => p.added)?.added;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${esc(FEED.title)}</title>
<link>${SITE.origin}/</link>
<atom:link href="${SITE.origin}${FEED.path}" rel="self" type="application/rss+xml"/>
<description>${esc(FEED.description)}</description>
<language>en-gb</language>
${newest ? `<lastBuildDate>${rfc822(newest)}</lastBuildDate>\n` : ''}<image><url>${SITE.origin}/social.jpg</url><title>${esc(FEED.title)}</title><link>${SITE.origin}/</link></image>
${items.map((i) => i.xml).join('\n')}
</channel>
</rss>
`;
  return { xml, items, undated: list.filter((p) => !p.added).map((p) => p.href) };
}

export async function build(site) {
  const { xml, items, undated } = await feed(site);
  await writeFile(path.join(publicDir, FEED.path.slice(1)), xml);
  const note = undated.length ? `; ${undated.length} with no "added" date in page.json, listed last with no date: ${undated.join(' ')}` : '';
  return `public/feed.xml: ${items.length} items, ${Math.round(Buffer.byteLength(xml) / 1024)} KB${note}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = await readPages();
  const only = process.argv.slice(2).filter((a) => a.startsWith('/'));
  if (only.length) {
    const { items } = await feed(site);
    for (const i of items.filter((i) => only.includes(i.page.href))) console.log(i.xml);
  } else console.log(await build(site));
}
