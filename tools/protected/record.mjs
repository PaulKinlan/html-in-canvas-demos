#!/usr/bin/env node
// Runs /protected/ in the two installed Chromium builds with real clicks and
// screenshots, and writes public/protected/recorded.json.
//
//   node tools/protected/record.mjs
//   node tools/protected/record.mjs --only geolocation,visited   (prints, does not write)
//
// It serves public/ on ports 8001 and 8002 (two origins), so stop other
// servers on those ports first.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../public');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : null;

const MIME = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webm: 'video/webm', vtt: 'text/vtt' };
// The same CORS rules as public/_headers.
const CORS = (p) => p.startsWith('/lib/') || p === '/capture/swatch.svg' || p.startsWith('/media/');
const serve = (port) => new Promise((resolve, reject) => {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const cors = CORS(p);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root)) throw new Error('outside root');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream', 'cache-control': 'no-store', ...(cors ? { 'access-control-allow-origin': '*' } : {}) });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server));
});
const servers = [await serve(8001), await serve(8002)];
const base = 'http://localhost:8001';

// Two builds are installed beside Playwright. The headless shell is the newer
// one. The full browser is older, needs the flag, and keeps history, which the
// :visited row needs.
const CONFIGS = [
  { key: 'shell', label: 'headless shell', options: {} },
  { key: 'full', label: 'full browser with the canvas-draw-element flag', options: { channel: 'chromium', args: ['--enable-features=CanvasDrawElement', '--enable-blink-features=CanvasDrawElement'] } },
];

const runs = [];
for (const config of CONFIGS) {
  const profile = await mkdtemp(path.join(tmpdir(), 'protected-'));
  const context = await chromium.launchPersistentContext(profile, { ...config.options, viewport: { width: 900, height: 800 } });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('crash', () => console.error('the tab crashed'));

  await page.exposeFunction('__autoClick', (x, y) => page.mouse.click(x, y));
  // Count red and blue pixels of a viewport rectangle in a real screenshot.
  await page.exposeFunction('__autoShot', async (x, y, width, height) => {
    const png = await page.screenshot({ clip: { x, y, width, height } });
    const helper = await context.newPage();
    const counts = await helper.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let red = 0, blue = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] < 70) red++;
        if (d[i + 2] > 200 && d[i] < 70 && d[i + 1] < 70) blue++;
      }
      return { red, blue };
    }, png.toString('base64'));
    await helper.close();
    await page.bringToFront();
    return counts;
  });

  // Follow a real link to the page, so its address is in this profile's history
  // for links on this site.
  await page.goto(`${base}/protected/frame.html`);
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/protected/'; a.id = 'go'; a.textContent = 'go'; document.body.append(a); });
  await page.click('#go');
  await page.waitForFunction(() => window.__run, null, { timeout: 15000 });
  await page.waitForTimeout(800);

  const results = await page.evaluate(async (ids) => {
    window.__auto = { click: window.__autoClick, shot: window.__autoShot };
    window.__only = ids;
    return window.__run();
  }, only);
  const version = context.browser()?.version() ?? await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]);

  console.log(`\n== Chromium ${version}, ${config.label}`);
  for (const r of results) console.log(`${r.id.padEnd(18)} drawn ${String(r.drawn).padEnd(11)} read ${String(r.read).padEnd(11)} works ${String(r.works).padEnd(11)} ${r.detail}`);
  runs.push({ key: config.key, browser: `Chromium ${version.split('.')[0]}, ${config.label}`, results });
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
if (!only) {
  await writeFile(path.join(root, 'protected/recorded.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), note: 'Headless, software rendering, real mouse clicks.', runs }, null, 1) + '\n');
  console.log('\nWrote public/protected/recorded.json');
}
for (const s of servers) s.close();
