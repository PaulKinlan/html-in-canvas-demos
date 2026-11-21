#!/usr/bin/env node
// node tools/draw-size/audit.mjs
//
// Finds elements that a page draws at the wrong size on a high-density screen.
//
// drawElementImage(el, x, y) with no size draws the element at its layout size
// times the canvas's backing scale, and the context's transform is applied on
// top. Under ctx.scale(devicePixelRatio) the picture and its hit region are
// devicePixelRatio times too large. A browser at a ratio of 1 does not show it,
// and neither does Playwright's deviceScaleFactor. This script opens each page
// with --force-device-scale-factor=2.625 (the test phone) at 412 px wide,
// scrolls through it so that every demo starts, presses the "Run these checks"
// button if the page has one, and prints what /shared/context-guard.js counted
// in window.__gfx.draws, for the page and for each frame in it.
//
//   node tools/draw-size/audit.mjs                   every page with a page.json
//   node tools/draw-size/audit.mjs /slot/ /lens/     these pages
//   node tools/draw-size/audit.mjs --scale 1.5       another device scale factor
//   node tools/draw-size/audit.mjs --no-checks       do not press the checks button
//
// Exit code 1 if any page drew at the wrong size. Serves public/ on port 8021.
// Needs Playwright with Chromium, like check:jank. docs/draw-size.md has the rule.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../public');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const argv = process.argv.slice(2);
const opt = { pages: [], scale: 2.625, checks: true, jobs: 4 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--scale') opt.scale = +argv[++i];
  else if (argv[i] === '--no-checks') opt.checks = false;
  else if (argv[i] === '--jobs') opt.jobs = +argv[++i];
  else if (argv[i].startsWith('/')) opt.pages.push(argv[i]);
  else { console.error(`Unknown option ${argv[i]}`); process.exit(2); }
}

execFileSync(process.execPath, [path.resolve(here, '../site/build.mjs')], { stdio: ['ignore', 'ignore', 'inherit'] });
const { readPages } = await import(pathToFileURL(path.resolve(here, '../site/pages.mjs')));
const pages = opt.pages.length ? opt.pages : ['/', ...(await readPages(root)).menu.map((p) => p.href)];

const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', wasm: 'application/wasm', webm: 'video/webm', mp4: 'video/mp4', woff2: 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) throw new Error('outside root');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(8021, '127.0.0.1', r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function audit(href) {
  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${opt.scale}`, '--window-size=412,800', '--enable-unsafe-swiftshader'] });
  const out = { href, draws: [], error: null };
  try {
    const page = await (await browser.newContext({ viewport: null })).newPage();
    await page.goto('http://127.0.0.1:8021' + href, { waitUntil: 'load', timeout: 30000 });
    await sleep(1500);
    // Scroll through the page: demos start when their section comes near the screen.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(height, 40000); y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await sleep(120); }
    if (opt.checks) {
      await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/^Run these \d+ checks$/.test(b.textContent.trim())) b.click(); });
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const pending = await page.evaluate(() => document.querySelectorAll('td.status.pending').length).catch(() => 0);
        if (!pending) break;
      }
    }
    await sleep(800);
    for (const frame of page.frames()) {
      const d = await frame.evaluate(() => (window.__gfx?.draws ? { ...window.__gfx.draws, dpr: devicePixelRatio, url: location.pathname } : null)).catch(() => null);
      if (d) out.draws.push(d);
    }
  } catch (err) { out.error = String(err.message).split('\n')[0]; }
  await Promise.race([browser.close(), sleep(4000)]);
  return out;
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: opt.jobs }, async () => {
  while (next < pages.length) {
    const r = await audit(pages[next++]);
    results.push(r);
    const wrong = r.draws.filter((d) => d.wrong);
    const noSize = r.draws.reduce((n, d) => n + d.noSize, 0);
    console.log(`${r.error ? 'ERR ' : wrong.length ? 'FAIL' : 'ok  '} ${r.href.padEnd(24)} ${r.error ?? `${noSize} calls with no size`}`);
    for (const d of wrong) console.log(`       ${d.url}: ${d.wrong} wrong. ${d.first.why} (${d.first.element}${d.first.canvas ? ' in canvas#' + d.first.canvas : ''}, context scale ${d.first.scale}, backing scale ${d.first.backing})`);
  }
}));
server.close();
const bad = results.filter((r) => r.draws.some((d) => d.wrong)), errors = results.filter((r) => r.error);
console.log(`\ndraw-size at device scale ${opt.scale}: ${results.length} pages, ${bad.length} drew an element at the wrong size, ${errors.length} could not be opened.`);
process.exit(bad.length ? 1 : 0);
