#!/usr/bin/env node
// Reads the social tags back out of every page that has a page.json and checks
// them, the way a crawler that does not run script would see them.
//
//   node tools/social/validate.mjs            every page, problems only
//   node tools/social/validate.mjs /slot/     these pages, and print their tags
//
// It checks: one block per page, and the block is what the build would write
// now; one description, one canonical URL on the production host; og:title,
// og:description, og:url, og:image and twitter:card present; the JSON-LD parses
// and names the page's URL; the picture file exists, is a JPEG and is 1200 by
// 630. Run `npm run build` first if it reports a stale block.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { readPages, repoRoot } from '../site/pages.mjs';
import { SITE, START, END, describe, hasOwnDescription, imageFileFor } from './meta.mjs';

const publicDir = path.join(repoRoot, 'public');
const exists = (f) => access(f).then(() => true, () => false);
const only = process.argv.slice(2).filter((a) => a.startsWith('/'));

// Width and height from a JPEG's start-of-frame segment.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

const site = await readPages();
const problems = [];
let withImage = 0;
const pages = Object.values(site.pages).filter((p) => !only.length || only.includes(p.href));
for (const page of pages) {
  const bad = (m) => problems.push(`${page.href}: ${m}`);
  const file = path.join(publicDir, page.href.endsWith('/') ? page.href + 'index.html' : page.href);
  const html = await readFile(file, 'utf8');
  const head = html.slice(0, html.search(/<\/head>/i));
  if (html.split(START).length !== 2) { bad(`${html.split(START).length - 1} social blocks (run npm run build)`); continue; }
  const a = html.indexOf(START), b = html.indexOf(END, a);
  if (a > head.length || b === -1) { bad('the block is not inside <head>'); continue; }
  const block = html.slice(a, b + END.length);

  const imageFile = path.join(publicDir, imageFileFor(page.href));
  const hasImage = await exists(imageFile);
  if (hasImage) withImage++;
  const want = describe(page, { hasImage, ownDescription: hasOwnDescription(html) });
  if (block.replace(/\r\n/g, '\n') !== want.block) bad('the block is stale (run npm run build)');

  const meta = (key) => [...head.matchAll(new RegExp(`<meta\\s+(?:name|property)=["']${key}["']\\s+content="([^"]*)"`, 'gi'))].map((m) => m[1]);
  const one = (key) => { const v = meta(key); if (v.length !== 1) bad(`${v.length} ${key} tags, expected 1`); return v[0] ?? ''; };
  const description = one('description');
  if (description.length < 50) bad(`description is ${description.length} characters`);
  for (const key of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:image:alt', 'twitter:title', 'twitter:description']) if (!one(key)) bad(`${key} is empty`);
  if (one('twitter:card') !== 'summary_large_image') bad('twitter:card is not summary_large_image');
  const canon = [...head.matchAll(/<link\s+rel=["']canonical["']\s+href="([^"]*)"/gi)].map((m) => m[1]);
  if (canon.length !== 1 || canon[0] !== want.url) bad(`canonical is ${JSON.stringify(canon)}`);
  if (one('og:url') !== want.url) bad('og:url is not the canonical URL');
  const image = one('og:image');
  if (one('twitter:image') !== image) bad('twitter:image differs from og:image');
  if (!image.startsWith(SITE.origin + '/')) bad(`og:image is not an absolute URL on ${SITE.host}`);
  else {
    const local = path.join(publicDir, new URL(image).pathname);
    if (!(await exists(local))) bad(`og:image names ${new URL(image).pathname}, which does not exist`);
    else {
      const size = jpegSize(await readFile(local));
      if (!size) bad('the picture is not a JPEG');
      else if (size.width !== SITE.image.width || size.height !== SITE.image.height) bad(`the picture is ${size.width} by ${size.height}`);
    }
  }
  if (!/<title>[^<]+<\/title>/i.test(head)) bad('no <title>');

  const ld = [...block.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let data = null;
  try { data = JSON.parse(ld[0]); } catch (e) { bad(`JSON-LD does not parse: ${e.message}`); }
  if (data) {
    const main = data['@graph']?.find((n) => n['@id'] === want.url);
    if (data['@context'] !== 'https://schema.org' || !main) bad('JSON-LD has no node for this URL');
    else {
      for (const key of ['name', 'description', 'url']) if (!main[key]) bad(`JSON-LD ${main['@type']} has no ${key}`);
      if (main['@type'] === 'TechArticle') for (const key of ['headline', 'image', 'author']) if (!main[key]) bad(`JSON-LD TechArticle has no ${key}`);
    }
  }
  if (only.length) console.log(`\n${page.href}\n${block.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => '<script type="application/ld+json">\n' + JSON.stringify(data, null, 2) + '\n</script>')}`);
}

for (const p of problems) console.error(`error: ${p}`);
console.log(`${pages.length} pages read, ${withImage} with a picture of their own, ${problems.length} problem(s).`);
process.exit(problems.length ? 1 : 0);
