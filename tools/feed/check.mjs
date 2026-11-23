#!/usr/bin/env node
// node tools/feed/check.mjs
//
// Builds the RSS feed in memory (the same code as `npm run build`) and checks it
// in headless Chromium:
//   - the file parses as XML
//   - there is one item for every page.json except the home page, and no id is used twice
//   - every item has a title, a link and some text
//   - an item's HTML has no script, canvas, form control or relative address, and
//     it nests: parsing it and writing it out again gives the same tags
//   - building twice gives the same bytes
//
//   node tools/feed/check.mjs --shot out.png /fold/   also saves a picture of one item as a reader would lay it out
import { createRequire } from 'node:module';
import { readPages } from '../site/pages.mjs';
import { feed } from './site-build.mjs';

const args = process.argv.slice(2);
const shot = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
const shotPage = args.find((a) => a.startsWith('/') && a !== shot) ?? null;

const site = await readPages();
const { xml, undated } = await feed(site);
const problems = [];
if ((await feed(site)).xml !== xml) problems.push('two builds gave different files');

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
const found = await page.evaluate((text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) return { error: error.textContent.slice(0, 300) };
  const CONTENT = 'http://purl.org/rss/1.0/modules/content/';
  return {
    self: doc.querySelector('channel > link[rel="self"], channel > *|link[rel="self"]')?.getAttribute('href'),
    items: [...doc.querySelectorAll('item')].map((item) => {
      const html = item.getElementsByTagNameNS(CONTENT, 'encoded')[0]?.textContent ?? '';
      const body = new DOMParser().parseFromString(html, 'text/html').body;
      const tags = (s) => (s.match(/<\/?[a-z0-9]+/gi) ?? []).join(' ').toLowerCase();
      return {
        title: item.querySelector('title')?.textContent, link: item.querySelector('link')?.textContent, guid: item.querySelector('guid')?.textContent,
        date: item.querySelector('pubDate')?.textContent ?? null, html,
        text: body.textContent.replace(/\s+/g, ' ').trim().length,
        banned: [...body.querySelectorAll('script,style,canvas,iframe,button,input,select,textarea,form,video,audio,svg')].map((e) => e.localName),
        relative: [...body.querySelectorAll('[href],[src]')].map((e) => e.getAttribute('href') ?? e.getAttribute('src')).filter((u) => !/^https?:\/\//.test(u)),
        nests: tags(body.innerHTML) === tags(html),
      };
    }),
  };
}, xml);

if (found.error) problems.push(`the feed does not parse as XML: ${found.error}`);
else {
  const want = new Set(Object.values(site.pages).filter((p) => p.href !== '/' && p.title).map((p) => 'https://html-in-canvas.page' + p.href.replace(/\.html$/, '')));
  const seen = new Set();
  for (const i of found.items) {
    const bad = (m) => problems.push(`${i.guid}: ${m}`);
    if (seen.has(i.guid)) bad('the id is used twice');
    seen.add(i.guid);
    if (!want.has(i.guid)) bad('no page.json describes this address');
    if (!i.title) bad('no title');
    if (i.link !== i.guid) bad('link and guid differ');
    if (i.date && Number.isNaN(Date.parse(i.date))) bad(`the date does not parse: ${i.date}`);
    if (i.text < 200) bad(`only ${i.text} characters of text`);
    if (i.banned.length) bad(`has ${[...new Set(i.banned)].join(', ')}`);
    if (i.relative.length) bad(`relative address ${i.relative[0]}`);
    if (!i.nests) bad('the HTML does not nest: a parser changed its tags');
  }
  for (const u of want) if (!seen.has(u)) problems.push(`${u}: not in the feed`);
  if (shot) {
    const item = found.items.find((i) => !shotPage || new URL(i.guid).pathname === shotPage.replace(/\.html$/, ''));
    await page.setContent(`<body style="font: 16px/1.5 system-ui; max-width: 640px; margin: 24px auto; padding: 0 16px"><style>img{max-width:100%;height:auto}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:4px 6px;vertical-align:top;text-align:left}code{background:#f2f2f2}</style><h1>${item.title}</h1><p>${item.date}</p>${item.html}`);
    await page.screenshot({ path: shot, fullPage: true });
  }
}
await browser.close();

for (const p of problems) console.error(`error: ${p}`);
console.log(`${found.items?.length ?? 0} items, ${Math.round(Buffer.byteLength(xml) / 1024)} KB, ${undated.length} with no date, ${problems.length} problem(s).`);
process.exit(problems.length ? 1 : 0);
