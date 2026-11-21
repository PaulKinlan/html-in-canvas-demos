// Compares three of the developer tool pages with the browser itself, which a page cannot do from script.
//
//   node tools/devtools-pages/verify.mjs [base URL]
//
// The base URL defaults to http://localhost:8001 (run `npm run build`, then
// `python3 -m http.server 8001` in public/).
//
// 1. /focus-path/: presses the real Tab key through the canvas in several
//    arrangements and compares each focused element with the order the page drew.
// 2. /landmark-map/: reads the role of every element of the drawn page from the
//    accessibility tree (DevTools protocol) and compares it with the page's rule table.
// 3. /hit-regions/: moves the mouse to a point, moves the element away with no
//    document change and clicks, to see whether the click uses a remembered hit test.
//
// Needs Playwright with Chromium. Exits with 1 if a comparison fails.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const base = process.argv[2] ?? 'http://localhost:8001';
const browser = await chromium.launch();
let failed = 0;
const say = (ok, text) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); };
const open = async (path) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  page.on('pageerror', (e) => say(false, `${path}: ${e.message}`));
  await page.goto(`${base}${path}?autochecks=0`);
  await page.waitForTimeout(1200);
  return page;
};
{
  const page = await browser.newPage();
  console.log(`${await page.evaluate(() => navigator.userAgent)}\n`);
  await page.close();
}

// ---- 1. the Tab key against the drawn path
{
  const arrangements = [
    ['as in the document', {}],
    ['last group drawn first', { layout: 'swapped' }],
    ['turned and scaled, tabindex="1" on Sign up', { layout: 'tilted', positive: true }],
    ['last group not drawn', { last: 'undrawn' }],
    ['last group inert, Email disabled', { last: 'inert', disable: true }],
    ['details open', { open: true }],
  ];
  for (const [name, options] of arrangements) {
    const page = await open('/focus-path/');
    await page.evaluate((o) => {
      const set = (id, value) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event('change')); };
      if (o.layout) set('layout', o.layout);
      if (o.last) set('last', o.last);
      if (o.positive) set('positive', true);
      if (o.disable) set('disable', true);
      if (o.open) document.getElementById('more').open = true;
    }, options);
    await page.waitForTimeout(400);
    const predicted = await page.evaluate(() => window.__focusPath.order);
    const real = [];
    // A stop with a positive tabindex is visited first in the whole document: press Tab from the top of the page.
    const positive = await page.evaluate(() => window.__focusPath.order.filter((id) => document.getElementById(id).tabIndex > 0).length);
    for (let i = 0; i < positive; i++) { await page.keyboard.press('Tab'); real.push(await page.evaluate(() => document.activeElement?.id)); }
    // Put focus just before the canvas, then press Tab once for each of the other stops.
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'before-scene'; document.getElementById('scene').before(b); b.focus(); });
    for (let i = positive; i < predicted.length; i++) { await page.keyboard.press('Tab'); real.push(await page.evaluate(() => document.activeElement?.id)); }
    await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() => document.getElementById('scene').contains(document.activeElement));
    await page.waitForTimeout(100);
    const seen = await page.evaluate(() => [window.__focusPath.presses, window.__focusPath.matched]);
    const same = real.join(' ') === predicted.join(' ');
    say(same && !stillInside, `/focus-path/ ${name}: ${predicted.length} stops. Tab visited ${real.join(' ')}${same ? '' : `. The page drew ${predicted.join(' ')}`}${stillInside ? '. One more Tab stayed inside the canvas' : ''}. The page's own count: ${seen[1]} of ${seen[0]} presses matched`);
    await page.close();
  }
}

// ---- 2. the accessibility tree against the landmark rule table
{
  const LANDMARKS = new Set(['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search']);
  for (const faults of [false, true]) {
    const page = await open('/landmark-map/');
    if (faults) { await page.evaluate(() => document.getElementById('faults').click()); await page.waitForTimeout(300); }
    const cdp = await page.context().newCDPSession(page);
    // Mark each element, then find its node in the full accessibility tree through the DOM node it belongs to.
    await page.evaluate(() => document.querySelectorAll('#page *').forEach((e, i) => e.setAttribute('data-ax', String(i))));
    await page.waitForTimeout(300);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byMark = new Map();
    for (const node of nodes) {
      if (!node.backendDOMNodeId || node.ignored) continue;
      const { node: dom } = await cdp.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId }).catch(() => ({ node: null }));
      const at = dom?.attributes?.indexOf('data-ax') ?? -1;
      if (at >= 0 && !byMark.has(dom.attributes[at + 1])) byMark.set(dom.attributes[at + 1], node);
    }
    const ours = await page.evaluate(() => [...document.querySelectorAll('#page *')].map((e, i) => ({ tag: e.localName, hidden: !e.checkVisibility(), found: window.__landmarks.found.find((l) => l.index === i) ?? null })));
    const wrong = [];
    let landmarks = 0, compared = 0;
    ours.forEach((el, i) => {
      if (el.hidden) return;
      compared++;
      const node = byMark.get(String(i));
      const role = node?.role?.value ?? 'none', name = node?.name?.value ?? '';
      const theirs = LANDMARKS.has(role) ? role : null, mine = el.found?.role ?? null;
      if (theirs) landmarks++;
      if (theirs !== mine) wrong.push(`<${el.tag}>: table ${mine}, browser ${role}`);
      else if (theirs && el.found.name !== name) wrong.push(`<${el.tag}> ${role}: table name "${el.found.name}", browser name "${name}"`);
    });
    say(!wrong.length, `/landmark-map/ ${faults ? 'with the three faults' : 'as loaded'}: ${compared} elements compared, ${landmarks} landmarks in the accessibility tree${wrong.length ? `. Differences: ${wrong.join('; ')}` : ', roles and names agree'}`);
    await page.close();
  }
}

// ---- 3. a real click at a point whose hit test is remembered
{
  const page = await open('/start/hello.html');
  await page.setContent(`<body style="margin:0"><canvas id="c" content="drawable" layoutsubtree width="400" height="400" style="display:block;width:400px;height:400px">
    <button id="b" drawable style="position:absolute;left:0;top:0;width:100px;height:40px">b</button></canvas>`);
  await page.evaluate(() => new Promise((done) => {
    const c = document.getElementById('c'), g = c.getContext('2d');
    window.clicks = [];
    addEventListener('click', (e) => window.clicks.push(e.target.id), true);
    c.addEventListener('paint', () => { g.drawElementImage(document.getElementById('b'), 250, 300, 100, 40); done(); }, { once: true });
    c.requestPaint();
  }));
  await page.mouse.move(300, 320);
  await page.waitForTimeout(100);
  const report = await page.evaluate(() => {
    const c = document.getElementById('c'), g = c.getContext('2d'), at = () => document.elementFromPoint(300, 320).id;
    const before = at();
    g.reset();
    g.drawElementImage(document.getElementById('b'), 10, 100, 100, 40); // moved away, no document change
    return { before, remembered: at() };
  });
  await page.mouse.down();
  await page.mouse.up();
  const clicks = await page.evaluate(() => window.clicks);
  console.log(`note /hit-regions/: elementFromPoint() before the move: ${report.before}; after the move, same point: ${report.remembered}; a real click there went to: ${clicks.join(', ') || 'nothing'}`);
  await page.close();
}

await browser.close();
console.log(failed ? `\n${failed} comparison(s) failed` : '\nAll comparisons agree');
process.exit(failed ? 1 : 0);
