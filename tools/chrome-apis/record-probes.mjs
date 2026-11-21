#!/usr/bin/env node
// Runs /chrome-apis/probes.html in Chromium with real input and a profile that
// keeps history, and writes the results to public/chrome-apis/probes-recorded.json.
//
//   npm run record:probes
//   npm run record:probes -- --only carousel,visited   (prints, does not write)
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
const only = onlyArg > 0 ? process.argv[onlyArg + 1] : null;

const MIME = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg' };
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Two builds are installed beside Playwright. The headless shell is the newer
// one and is what the other tools in this repository use; it has the canvas
// API and experimental web platform features on. The full browser is older,
// needs the flag, and keeps history, which the :visited probe needs.
const CONFIGS = [
  { key: 'shell', label: 'headless shell', options: {} },
  { key: 'full', label: 'full browser with the canvas-draw-element flag', options: { channel: 'chromium', args: ['--enable-features=CanvasDrawElement', '--enable-blink-features=CanvasDrawElement', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] } },
];

const runs = [];
for (const config of CONFIGS) {
  const profile = await mkdtemp(path.join(tmpdir(), 'probes-'));
  const context = await chromium.launchPersistentContext(profile, { ...config.options, viewport: { width: 900, height: 800 } });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));

  await page.exposeFunction('__autoClick', (x, y) => page.mouse.click(x, y));
  await page.exposeFunction('__autoMove', (x, y) => page.mouse.move(x, y, { steps: 4 }));
  await page.exposeFunction('__autoPress', (key) => page.keyboard.press(key));
  // Count red pixels of a viewport rectangle in a real screenshot.
  await page.exposeFunction('__autoShot', async (x, y, width, height) => {
    const png = await page.screenshot({ clip: { x, y, width, height } });
    const helper = await context.newPage();
    const red = await helper.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++;
      return n;
    }, png.toString('base64'));
    await helper.close();
    await page.bringToFront();
    return { red };
  });

  const url = `${base}/chrome-apis/probes.html`;
  // Follow a real link to /start/ and come back, so that link is :visited for this site.
  await page.goto(url);
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/start/'; a.id = 'visit'; a.textContent = 'visit'; document.querySelector('main').prepend(a); });
  await page.click('#visit');
  await page.waitForTimeout(800);
  await page.goBack();
  await page.waitForTimeout(500);
  if (only) await page.evaluate((ids) => { window.__only = ids; }, only.split(','));
  await page.evaluate(async () => {
    const { runProbes } = await import('./probes.js');
    const auto = { click: window.__autoClick, move: window.__autoMove, press: window.__autoPress, shot: window.__autoShot };
    document.getElementById('rig-box').hidden = false;
    window.__probeResults = await runProbes(document.getElementById('rig'), { auto, only: window.__only ?? null });
  });
  const results = await page.evaluate(() => window.__probeResults);
  const detect = await page.evaluate(() => window.__detect);
  const version = context.browser()?.version() ?? await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]);

  console.log(`\n== Chromium ${version}, ${config.label}`);
  for (const r of results) console.log(`${r.status.padEnd(12)} ${r.id.padEnd(16)} ${r.detail}`);
  runs.push({ key: config.key, browser: `Chromium ${version.split('.')[0]}, ${config.label}`, results, detect });
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
if (!only) {
  await writeFile(path.join(root, 'chrome-apis/probes-recorded.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), note: 'Headless, software rendering.', runs }, null, 1) + '\n');
  console.log(`\nWrote public/chrome-apis/probes-recorded.json`);
}
server.close();
