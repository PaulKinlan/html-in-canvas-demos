// Part of `npm run build` (tools/site/build.mjs calls build() below).
//
// For every page that has a page.json it writes one block of tags into the
// page's <head>, between "social:start" and "social:end" comments: description,
// canonical URL, Open Graph, Twitter card and schema.org JSON-LD. The text
// comes from the page.json (title, blurb, question, tags, api, added), so a new
// page gets its tags from the file it already has. The block is committed with
// the page: the build rewrites it only when page.json or the picture changed,
// and Workers Builds runs the build before every deploy, so a page whose
// block is stale or missing in the repository is still deployed with a current one.
//
// The picture is public/<name>/social.jpg, made by `node tools/social/capture.mjs /<name>/`.
// A page without one uses the site's picture, public/social.jpg.
//
// It also writes public/sitemap.xml (not committed). public/robots.txt names it.
//
//   node tools/social/validate.mjs    reads the tags back out of every page and checks them
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../site/pages.mjs';
import { SITE, describe, inject, hasOwnDescription, imageFileFor } from './meta.mjs';

const publicDir = path.join(repoRoot, 'public');
const exists = (f) => access(f).then(() => true, () => false);
export const fileFor = (href) => path.join(publicDir, href.endsWith('/') ? href + 'index.html' : href);

export async function build({ pages }) {
  let changed = 0, noImage = 0;
  const urls = [];
  for (const page of Object.values(pages).sort((a, b) => a.href.localeCompare(b.href))) {
    const file = fileFor(page.href);
    const html = await readFile(file, 'utf8');
    const hasImage = await exists(path.join(publicDir, imageFileFor(page.href)));
    if (!hasImage) noImage++;
    const d = describe(page, { hasImage, ownDescription: hasOwnDescription(html) });
    const next = inject(html, d.block);
    if (next !== html) { await writeFile(file, next); changed++; }
    urls.push(d.url);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(publicDir, 'sitemap.xml'), xml);
  return `social tags: ${urls.length} pages, ${changed} rewritten, ${noImage} without a picture of their own (${SITE.origin}/social.jpg is used); public/sitemap.xml: ${urls.length} URLs`;
}
