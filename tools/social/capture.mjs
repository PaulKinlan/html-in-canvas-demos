#!/usr/bin/env node
// Makes the 1200 by 630 picture that a link to a page shows when it is shared
// (og:image, twitter:image). One JPEG per page, committed beside the page:
//
//   public/<name>/social.jpg          for /<name>/
//   public/<name>/<file>.social.jpg   for /<name>/<file>.html
//   public/social.jpg                 for /, and for a page with no picture of its own
//
// The picture is a screenshot of the page in headless Chromium, scrolled to its
// first large canvas (the home page: its top), with the page title and the site name on a band along the
// bottom. If that canvas is one flat colour in the test browser (software
// rendering, no WebGPU on screen), the picture is a card with the title and the
// page's question instead. The build (tools/social/site-build.mjs) points
// og:image at the file when it exists.
//
//   node tools/social/capture.mjs                 every page that has no picture yet
//   node tools/social/capture.mjs /slot/ /lens/   these pages, replacing their pictures
//   node tools/social/capture.mjs --all           every page, replacing every picture
//   node tools/social/capture.mjs --card /xr/     the title card, without a screenshot
//   node tools/social/capture.mjs --top /perf/    a screenshot of the top of the page, not of a canvas
//   node tools/social/capture.mjs --out dir       write to dir instead of public/ (to look first)
//
// Needs Playwright with Chromium, like tools/jank/check.mjs.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildSite } from '../site/build.mjs';
import { repoRoot } from '../site/pages.mjs';
import { SITE, plainText, imageFileFor } from './meta.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const root = path.join(repoRoot, 'public');
const argv = process.argv.slice(2);
const opt = { pages: [], all: false, card: false, out: null, jobs: 4, wait: 3500 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--all') opt.all = true;
  else if (a === '--card') opt.card = true;
  else if (a === '--top') opt.top = true;
  else if (a === '--out') opt.out = path.resolve(argv[++i]);
  else if (a === '--jobs') opt.jobs = +argv[++i];
  else if (a === '--wait') opt.wait = +argv[++i];
  else if (a.startsWith('/')) opt.pages.push(a);
  else { console.error(`Unknown option ${a}`); process.exit(2); }
}

// The page is laid out 1000 CSS pixels wide and captured at scale 1.2, so text
// in the picture is a fifth larger than on a desktop screen.
const W = 1200, H = 630, SCALE = 1.2, BAND = 104;
const VIEW = { width: W / SCALE, height: H / SCALE };

const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', wasm: 'application/wasm', webm: 'video/webm', mp4: 'video/mp4', woff2: 'font/woff2' };
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(root, p);
        if (!file.startsWith(root)) throw new Error('outside root');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The card page: the screenshot (or the question) above a band with the title.
function cardHtml({ title, question, shot }) {
  const body = shot
    ? `<img id="shot" src="data:image/png;base64,${shot}">`
    : `<div class="q"><p class="label">${question ? 'Question' : 'Experiment'}</p><p class="text">${esc(question || title)}</p></div>`;
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #f6f4ef; font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  #shot { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: cover; object-position: top; }
  .q { position: absolute; left: 72px; right: 72px; top: 0; height: ${H - BAND}px; display: flex; flex-direction: column; justify-content: center; }
  .q .label { margin: 0 0 18px; font: 600 22px ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #d2491f; }
  .q .text { margin: 0; font-size: 46px; line-height: 1.22; letter-spacing: -0.02em; color: #1d1c1a; text-wrap: balance; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: ${BAND}px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center; gap: 32px; background: #161514; color: #eeebe5; border-top: 4px solid #ff7a4d; }
  .band .t { flex: 1; min-width: 0; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .band .s { flex: none; font: 22px ui-monospace, Menlo, Consolas, monospace; color: #a19c93; }
  </style>${body}<div class="band"><div class="t" style="font-size:${title.length <= 34 ? 40 : title.length <= 44 ? 32 : 27}px">${esc(title)}</div><div class="s">${SITE.host}</div></div>`;
}

// Runs in the page: the first large visible canvas, shadow roots included.
function findStage() {
  const found = [];
  const walk = (node) => {
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
      if (el.localName !== 'canvas') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 240 || r.height < 120) continue;
      // Live checks draw on fixtures kept off the side of the screen.
      if (r.right <= 0 || r.left >= innerWidth || r.top + scrollY < 0) continue;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      if (el.closest('#site-nav, details:not([open])')) continue;
      found.push({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
    }
  };
  walk(document);
  found.sort((a, b) => a.y - b.y);
  return found[0] ?? null;
}

// Runs in the card page: the share of the rectangle that is not its commonest colour.
async function variety(rect) {
  const img = document.getElementById('shot');
  await img.decode();
  const k = img.naturalWidth / 1200;
  const w = Math.max(1, Math.round(rect.w)), h = Math.max(1, Math.round(rect.h));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, rect.x * k, rect.y * k, rect.w * k, rect.h * k, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 16) {
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let top = 0, n = 0;
  for (const v of counts.values()) { n += v; if (v > top) top = v; }
  return 1 - top / n;
}

async function capture(browser, base, page) {
  const title = plainText(page.title || page.href);
  const question = plainText(page.question || page.blurb || '');
  let shot = null, note = 'title card';
  if (!opt.card) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'light', reducedMotion: 'no-preference' });
    const tab = await ctx.newPage();
    try {
      await tab.goto(base + page.href, { waitUntil: 'load', timeout: 45000 });
      // The band names the site and the page, so the menu bar is left out.
      await tab.addStyleTag({ content: '#site-nav { display: none !important; }' });
      await tab.waitForTimeout(1500);
      // The home page is shown from its top: its heading says what the site is.
      // Find the canvas, then wait until it has stopped moving down the page as the content above it loads.
      let stage = null;
      for (let i = 0; page.href !== '/' && !opt.top && i < 12; i++) {
        const now = await tab.evaluate(findStage);
        const still = now && stage && Math.abs(now.y - stage.y) < 1 && Math.abs(now.h - stage.h) < 1;
        stage = now;
        if (still) break;
        await tab.waitForTimeout(500);
      }
      // Keep the top of the canvas in the picture, and centre a short one in the part above the band.
      const room = VIEW.height - BAND / SCALE;
      const place = (st) => tab.evaluate((top) => window.scrollTo({ top: Math.max(0, top), behavior: 'instant' }), st.h >= room - 32 ? st.y - 16 : st.y - (room - st.h) / 2);
      if (stage) await place(stage);
      await tab.waitForTimeout(opt.wait);
      const moved = stage && await tab.evaluate(findStage);
      if (moved && Math.abs(moved.y - stage.y) > 8) { await place(moved); await tab.waitForTimeout(1200); }
      stage = moved;
      const scrollY = await tab.evaluate(() => scrollY);
      shot = (await tab.screenshot({ type: 'png' })).toString('base64');
      note = stage ? `screenshot of the first canvas (at ${Math.round(stage.x)},${Math.round(stage.y)}, ${Math.round(stage.w)} by ${Math.round(stage.h)})` : 'screenshot of the top of the page';
      if (stage) {
        const rect = { x: stage.x * SCALE, y: (stage.y - scrollY) * SCALE, w: stage.w * SCALE, h: stage.h * SCALE };
        rect.h = Math.min(rect.h, H - BAND - rect.y);
        const card = await ctx.newPage();
        await card.setContent(cardHtml({ title, question, shot }));
        const v = rect.h > 20 ? await card.evaluate(variety, rect) : 1;
        await card.close();
        if (v < 0.02) { shot = null; note = `title card (the canvas was one flat colour in this browser, variety ${v.toFixed(3)})`; }
      }
    } catch (e) { shot = null; note = `title card (${String(e.message).split('\n')[0]})`; }
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const card = await ctx.newPage();
  await card.setContent(cardHtml({ title, question, shot }));
  if (shot) await card.evaluate(() => document.getElementById('shot').decode());
  const jpg = await card.screenshot({ type: 'jpeg', quality: 84 });
  await ctx.close();
  const rel = imageFileFor(page.href);
  const file = path.join(opt.out ?? root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, jpg);
  return { href: page.href, note, kb: Math.round(jpg.length / 1024) };
}

const site = await buildSite({ quiet: true });
const exists = (f) => access(f).then(() => true, () => false);
let todo = Object.values(site.pages);
if (opt.pages.length) {
  const unknown = opt.pages.filter((p) => !site.pages[p]);
  if (unknown.length) { console.error(`No page file for ${unknown.join(', ')}`); process.exit(2); }
  todo = opt.pages.map((p) => site.pages[p]);
} else if (!opt.all) {
  const keep = [];
  for (const p of todo) if (!(await exists(path.join(root, imageFileFor(p.href))))) keep.push(p);
  todo = keep;
}
if (!todo.length) { console.log('Every page has a picture. Name a page, or pass --all, to replace one.'); process.exit(0); }

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(opt.jobs, queue.length) }, async () => {
  for (let p; (p = queue.shift());) {
    const r = await capture(browser, base, p);
    console.log(`${r.href.padEnd(30)} ${String(r.kb).padStart(4)} KB  ${r.note}`);
  }
}));
await browser.close();
server.close();
