#!/usr/bin/env node
// Finds pages that scroll by themselves because scroll anchoring took a drawable child of a canvas as its anchor.
//
//   npm run build
//   node tools/scroll-anchor/audit.mjs [--no-guard] [/page/ ...]
//
// With no page it measures every page that has a page.json. For each drawable canvas of a page (the first 8, shadow
// roots included) it puts the top of the canvas 60 px above the top of the screen, then half the canvas above it,
// touches nothing, and counts the page's scroll events for 2 s. It prints one line per page and exits 1 if a page
// scrolled. --no-guard removes the rule that /shared/context-guard.js adds (point 15 there), to show what the pages
// do without it. Only movement that starts by itself is found: a page that moves hit boxes only while it is dragged
// or after a button is pressed is not exercised. Needs Playwright with Chromium, like check:jank.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';
import { stat, open } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const ROOT = fileURLToPath(new URL('../../public', import.meta.url));
const args = process.argv.slice(2), NO_GUARD = args.includes('--no-guard');
let pages = args.filter((a) => a.startsWith('/'));
if (!pages.length) pages = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'page.json'))).map((d) => `/${d}/`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let file = join(ROOT, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    let st = await stat(file);
    if (st.isDirectory()) { file = join(file, 'index.html'); st = await stat(file); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': st.size });
    (await open(file)).createReadStream().pipe(res);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;
const b = await chromium.launch({ args: ['--force-device-scale-factor=2.625'] });
const results = [];
const CONC = 4;
let next = 0;
async function worker() {
  while (next < pages.length) {
    const page = pages[next++];
    const ctx = await b.newContext({ viewport: { width: 412, height: 760 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const rec = { page, canvases: [] };
    try {
      await p.goto(BASE + page + '?autochecks=0', { timeout: 20000, waitUntil: 'load' });
      await p.waitForTimeout(1500);
      if (NO_GUARD) await p.evaluate(() => {
        const walk = (root) => { root.adoptedStyleSheets = [...root.adoptedStyleSheets].filter((s) => ![...s.cssRules].some((r) => r.style?.overflowAnchor === 'none' && /layoutsubtree/.test(r.selectorText))); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); };
        walk(document);
      });
      const n = await p.evaluate(() => {
        const out = [];
        const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.localName === 'canvas' && el.hasAttribute('layoutsubtree') && el.offsetHeight > 0 && !el.closest('#test-stage,[data-test-stage]')) out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
        walk(document);
        window.__cv = out.slice(0, 8);
        return window.__cv.length;
      });
      for (let i = 0; i < n; i++) {
        const r = await p.evaluate(async (i) => {
          const c = window.__cv[i], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const label = (c.id ? '#' + c.id : '') || c.className || (c.getRootNode().host?.localName ?? 'canvas') + '[' + i + ']';
          for (const off of [60, Math.min(200, c.offsetHeight / 2)]) {
            window.scrollTo(0, Math.max(0, Math.round(c.getBoundingClientRect().top + scrollY + off)));
            await sleep(700);
            const y0 = scrollY; let min = y0, max = y0, ev = 0;
            const on = () => { ev++; min = Math.min(min, scrollY); max = Math.max(max, scrollY); };
            addEventListener('scroll', on);
            await sleep(2000);
            removeEventListener('scroll', on);
            if (ev) return { label, off, ev, range: Math.round(max - min), kids: c.children.length };
          }
          return { label, ev: 0, kids: c.children.length };
        }, i);
        rec.canvases.push(r);
      }
    } catch (e) { rec.error = String(e.message).slice(0, 120); }
    results.push(rec);
    const hits = rec.canvases.filter((c) => c.ev);
    console.log(`${hits.length ? 'HIT ' : 'ok  '}${page} ${rec.canvases.length} canvases${rec.error ? ' ERROR ' + rec.error : ''} ${hits.map((h) => `${h.label} ${h.ev}ev ${h.range}px`).join('; ')}`);
    await ctx.close();
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
await b.close();
server.close();
const hit = results.filter((r) => r.canvases.some((c) => c.ev)), errors = results.filter((r) => r.error);
console.log(`\n${results.length - hit.length} of ${results.length} pages held still${NO_GUARD ? ' without the guard rule' : ''}.${errors.length ? ` ${errors.length} did not load.` : ''}`);
process.exit(hit.length ? 1 : 0);
