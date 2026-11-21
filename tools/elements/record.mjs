#!/usr/bin/env node
// Records what every HTML element does inside a drawable canvas, for /elements/.
//
//   npm run record:elements            writes public/elements/recorded.json and ELEMENTS.md
//   npm run record:elements -- input   only entries whose name contains "input" (prints, writes nothing)
//
// It opens public/elements/lab.html in Chromium and, for each entry in public/elements/data.js:
//   1. runs the same probe the page runs (draw, ink, hit test, repaints), see public/elements/probe.js
//   2. takes a screenshot of the element in the canvas and of the same markup as plain DOM, and compares them
//   3. clicks the middle of the drawn element with a real mouse click and notes which element got it
//   4. runs the element's own test from TESTS below (typing, dragging, opening), also with real input
//
// Serves public/ on ports 8001 and 8002 (two origins), so stop other servers on those ports first.
// Needs Playwright with Chromium.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../public');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' };
const servers = [8001, 8002].map((port) => createServer(async (req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (file.endsWith(path.sep)) file += 'index.html';
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
let crashed = false;
page.on('crash', () => { crashed = true; });
let choosers = 0;
page.on('filechooser', () => choosers++);
await page.goto('http://localhost:8001/elements/lab.html');
await page.waitForFunction('window.labReady', null, { polling: 100 });

const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const at = (sel) => ev((s) => { const el = s ? lab.W.querySelector(s) : lab.T; return lab.at(el); }, sel);
// Move the pointer away and back first. With the pointer left where the last fixture was, a click on a
// new fixture at the same spot did not focus it (the second and later textarea tests typed into nothing).
const click = async (pt) => { await page.mouse.move(2, 2); await page.mouse.move(pt.x, pt.y, { steps: 2 }); await page.mouse.click(pt.x, pt.y); await wait(150); };
const yes = (ok, detail) => ({ ok: !!ok, detail });

// ---------------------------------------------------------------- element tests, with real input
// Each returns a list of { name, ok, detail }. `r` is where the element was drawn.
const typeInto = async (r, read = () => lab.T.value) => {
  await click(r);
  await page.keyboard.type('ab');
  const value = await ev(read);
  return { name: 'Click it, type "ab"', ...yes(String(value).includes('ab'), `value is "${value}"`) };
};
const stepUp = async (r) => {
  const before = await ev(() => lab.T.value);
  await click({ x: r.left + 14, y: r.y });
  await page.keyboard.press('ArrowUp');
  const after = await ev(() => lab.T.value);
  return { name: 'Click a field, press ArrowUp', ...yes(after !== before, `"${before}" became "${after}"`) };
};
const TEXT = ['input', 'input type=text', 'input type=search', 'input type=tel', 'input type=url', 'input type=email', 'input type=password'];
const DATES = ['input type=date', 'input type=time', 'input type=datetime-local', 'input type=month', 'input type=week'];

const TESTS = {
  ...Object.fromEntries(TEXT.map((t) => [t, async (r) => [await typeInto(r)]])),
  ...Object.fromEntries(DATES.map((t) => [t, async (r) => [await stepUp(r)]])),
  input: async (r) => {
    const typed = await typeInto(r);
    const paints = await ev(() => lab.paintsFor(1300));
    return [typed, { name: 'Caret blink repaints the canvas while it has focus', ...yes(paints > 0, `${paints} paint events in 1.3 s`) }];
  },
  'input type=number': async (r) => [await stepUp(r)],
  'input type=range': async (r) => {
    const before = await ev(() => lab.T.value);
    await page.mouse.move(r.left + r.w * 0.3, r.y); await page.mouse.down(); await page.mouse.move(r.left + r.w * 0.8, r.y, { steps: 5 }); await page.mouse.up();
    const after = await ev(() => lab.T.value);
    return [{ name: 'Drag the thumb', ...yes(after !== before, `value ${before} became ${after}`) }];
  },
  'input type=checkbox': async (r) => { await click(r); const c = await ev(() => lab.T.checked); return [{ name: 'Click toggles it', ...yes(c === false, `checked is ${c}`) }]; },
  'input type=radio': async (r) => { await ev(() => { lab.T.checked = false; }); await click(r); const c = await ev(() => lab.T.checked); return [{ name: 'Click checks it', ...yes(c === true, `checked is ${c}`) }]; },
  'input type=file': async (r) => { const n = choosers; await click({ x: r.left + 30, y: r.y }); await wait(300); return [{ name: 'Click opens the file chooser', ...yes(choosers > n, choosers > n ? 'filechooser fired' : 'no file chooser') }]; },
  'input type=color': async () => [{ name: 'Colour picker', ok: null, detail: 'the picker is a separate native window, which headless Chromium does not show' }],
  textarea: async (r) => {
    const typed = await typeInto(r);
    const w0 = await ev(() => lab.T.offsetWidth);
    await page.mouse.move(r.left + r.w - 4, r.top + r.h - 4); await page.mouse.down(); await page.mouse.move(r.left + r.w + 30, r.top + r.h + 20, { steps: 5 }); await page.mouse.up();
    const w1 = await ev(() => lab.T.offsetWidth);
    return [typed, { name: 'Drag the resize handle', ...yes(w1 > w0, `width ${w0}px became ${w1}px`) }];
  },
  '[contenteditable]': async (r) => [await typeInto(r, () => lab.T.textContent)],
  form: async () => { await click(await at('button')); const n = await ev(() => lab.submits); return [{ name: 'Click the submit button', ...yes(n === 1, `${n} submit event`) }]; },
  label: async (r) => { await click({ x: r.left + 12, y: r.y }); const c = await ev(() => lab.T.control.checked); return [{ name: 'Click the label text', ...yes(c, `the checkbox is ${c ? 'checked' : 'not checked'}`) }]; },
  button: async (r) => {
    await page.mouse.move(2, 2); await wait(100);
    const count = ev(() => lab.paintsFor(600));
    await wait(100);
    await page.mouse.move(r.x, r.y, { steps: 3 });
    const paints = await count;
    return [{ name: 'Hover repaints the canvas', ...yes(paints > 0, `${paints} paint events after the pointer moved over it`) }];
  },
  select: async (r) => {
    await click(r);
    const open = await ev(() => lab.T.matches(':open'));
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await wait(150);
    const v = await ev(() => lab.T.value);
    return [
      { name: 'Click, ArrowDown, Enter', ...yes(v === 'Two', `value is "${v}"`) },
      { name: 'The native list popup', ok: null, detail: `:open was ${open} after the click. The popup is a separate native window that headless Chromium does not show, so its position is not measured here.` },
    ];
  },
  'select multiple': async () => {
    await click(await at('option:nth-child(3)'));
    const v = await ev(() => [...lab.T.selectedOptions].map((o) => o.value).join(', '));
    const r = await at();
    await page.mouse.move(r.x, r.y); await page.mouse.wheel(0, 40); await wait(250);
    const top = await ev(() => lab.T.scrollTop);
    return [{ name: 'Click the third option', ...yes(v === 'Three', `selected: ${v}`) }, { name: 'Mouse wheel scrolls the list', ...yes(top > 0, `scrollTop is ${top}`) }];
  },
  option: async () => { await click(await at('option:nth-child(2)')); const v = await ev(() => lab.W.querySelector('select').value); return [{ name: 'Click the second option', ...yes(v === 'Option two', `value is "${v}"`) }]; },
  'select (base-select)': async (r) => {
    const ink0 = await ev(() => lab.ink());
    await click(r); await wait(400);
    const open = await ev(() => lab.T.matches(':open'));
    const ink1 = await ev(() => lab.ink());
    const shot = await page.screenshot({ clip: { x: r.left, y: r.top + r.h + 2, width: 60, height: 60 } });
    const pagePixels = await ev(async (u) => { const b = await createImageBitmap(await (await fetch(u)).blob()); const c = new OffscreenCanvas(b.width, b.height), g = c.getContext('2d'); g.drawImage(b, 0, 0); const d = g.getImageData(0, 0, b.width, b.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) n++; return n; }, 'data:image/png;base64,' + shot.toString('base64'));
    const under = await ev((q) => { const e = lab.C.getRootNode().elementFromPoint(q.left + 12, q.top + q.h + 39); return e ? `<${e.localName}>` : 'nothing'; }, r);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await wait(200);
    const v = await ev(() => lab.T.value);
    // The same keys on the same select as plain DOM, for comparison.
    const plainValue = await (async () => {
      await ev(() => { document.body.insertAdjacentHTML('beforeend', '<select id="el-plain-select" style="appearance:base-select;position:fixed;left:20px;top:300px"><button><selectedcontent></selectedcontent></button><option>One</option><option>Two</option><option>Three</option></select>'); });
      await click(await ev(() => lab.at(document.getElementById('el-plain-select')))); await wait(300);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await wait(200);
      return ev(() => { const el = document.getElementById('el-plain-select'); const out = el.value; el.remove(); return out; });
    })();
    return [
      { name: 'Click opens the picker', ...yes(open, `:open is ${open}`) },
      { name: 'The picker is drawn into the canvas', ...yes(ink1 > ink0 * 1.5, `canvas ink ${ink0} px before, ${ink1} px while open. The picker belongs to the top layer, which the page paints. In this run the page showed ${pagePixels} non-white pixels in the 60 by 60 px under the drawn select (in other runs the list was painted there).`) },
      { name: 'The options in the picker can be hit', ...yes(under === '<option>', `elementFromPoint where the second option would be returns ${under}`) },
      { name: 'ArrowDown then Enter picks the second option', ...yes(v === 'Two', `value is "${v}" (the same keys on the same select as plain DOM give "${plainValue}")`) },
    ];
  },
  details: async () => {
    const ink0 = await ev(() => lab.ink());
    await click(await at('summary'));
    const [open, ink1] = await ev(() => [lab.T.open, lab.ink()]);
    return [{ name: 'Click the summary', ...yes(open && ink1 > ink0, `open is ${open}; canvas ink ${ink0} px became ${ink1} px`) }];
  },
  summary: async (r) => { await click({ x: r.left + 20, y: r.y }); const open = await ev(() => lab.W.querySelector('details').open); return [{ name: 'Click closes the open details', ...yes(!open, `open is ${open}`) }]; },
  dialog: async () => {
    const shown = await ev(async () => { lab.T.show(); await new Promise((r) => setTimeout(r, 250)); const ink = lab.ink(); lab.T.close(); return ink; });
    const abs = await ev(async () => { lab.T.style.cssText = 'margin:0;padding:8px;left:20px;top:40px'; lab.T.show(); await new Promise((r) => setTimeout(r, 250)); const ink = lab.ink(); lab.T.close(); return ink; });
    const modal = await ev(async () => {
      lab.T.style.cssText = ''; lab.T.showModal(); await new Promise((r) => setTimeout(r, 250));
      const r = lab.T.getBoundingClientRect(), c = lab.C.getBoundingClientRect();
      const out = { ink: lab.ink(), top: lab.C.getRootNode().elementFromPoint(r.left + 4, r.top + 4) === lab.T, centred: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2, insideCanvas: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom };
      let direct; try { lab.T.setAttribute('drawable', ''); lab.C.getContext('2d').drawElementImage(lab.T, 0, 0); direct = 'drew'; } catch (err) { direct = err.message.replace(/^.*?: /, ''); }
      lab.T.close();
      return { ...out, direct };
    });
    return [
      { name: 'show() with position: static', ...yes(shown > 0, `${shown} px of ink in the canvas`) },
      { name: 'show() with the default position: absolute', ...yes(abs > 0, `${abs} px of ink in the canvas. The dialog is positioned outside its drawable ancestor's box, and the image is clipped to that box.`) },
      { name: 'showModal() is drawn into the canvas', ...yes(modal.ink > 0, `${modal.ink} px of ink in the canvas. The dialog is in the top layer, ${modal.centred ? 'centred in the viewport' : 'not centred'}, ${modal.top ? 'painted by the page and hit-testable there' : 'not hit-testable'}. drawElementImage(dialog): ${modal.direct}`) },
    ];
  },
  '[popover]': async () => {
    const ink0 = await ev(() => lab.ink());
    await click(await at('button'));
    const a = await ev(() => { const r = lab.T.getBoundingClientRect(); return { open: lab.T.matches(':popover-open'), ink: lab.ink(), x: Math.round(r.left), y: Math.round(r.top) }; });
    const b = await ev(async () => {
      lab.T.hidePopover();
      const btn = lab.W.querySelector('button'); btn.style.anchorName = '--el-anchor';
      lab.T.style.cssText = 'position-anchor:--el-anchor;position-area:bottom span-right;margin:0;padding:6px';
      lab.T.showPopover(); await new Promise((r) => setTimeout(r, 250));
      const p = lab.T.getBoundingClientRect(), q = btn.getBoundingClientRect();
      // Draw the wrapper 40 px further right and see whether the open popover follows its anchor.
      const g = lab.C.getContext('2d');
      lab.C.addEventListener('paint', () => { g.reset(); g.drawElementImage(lab.W, lab.P.DX + 40, lab.P.DY); });
      lab.C.requestPaint(); await new Promise((r) => setTimeout(r, 300));
      const p2 = lab.T.getBoundingClientRect(), q2 = btn.getBoundingClientRect();
      return { dx: Math.round(p.left - q.left), dy: Math.round(p.top - q.bottom), anchorMoved: Math.round(q2.left - q.left), popoverMoved: Math.round(p2.left - p.left) };
    });
    return [
      { name: 'Click the invoker button', ...yes(a.open, `:popover-open is ${a.open}`) },
      { name: 'The popover is drawn into the canvas', ...yes(a.ink > ink0 * 1.3, `canvas ink ${ink0} px before, ${a.ink} px while open. The popover is in the top layer at viewport (${a.x}, ${a.y}), painted by the page.`) },
      { name: 'CSS anchor positioning follows the drawn position of the anchor', ...yes(b.dx === 0 && b.dy === 0, `popover is ${b.dx}px, ${b.dy}px from the drawn button's bottom-left corner`) },
      { name: 'The open popover follows when the anchor is drawn somewhere else', ...yes(b.anchorMoved === 40 && b.popoverMoved === 40, `the button was drawn 40px to the right: its rect moved ${b.anchorMoved}px and the popover moved ${b.popoverMoved}px`) },
    ];
  },
  a: async (r) => { await click(r); const h = await ev(() => location.hash); return [{ name: 'Click follows the link', ...yes(h === '#el-a', `location.hash is "${h}"`) }]; },
  area: async () => { const i = await at('img'); await click({ x: i.left + 12, y: i.y }); const h = await ev(() => location.hash); return [{ name: 'Click the mapped half of the image', ...yes(h === '#el-area', `location.hash is "${h}"`) }]; },
  '[tabindex]': async (r) => { await click(r); const f = await ev(() => lab.C.getRootNode().activeElement === lab.T); return [{ name: 'Click focuses it', ...yes(f, f ? 'document.activeElement is the element' : 'focus went elsewhere') }]; },
  '[draggable]': async (r) => {
    await ev(() => { lab.drag = []; for (const t of ['dragstart', 'drag', 'dragend']) lab.T.addEventListener(t, () => lab.drag.push(t)); });
    await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.move(r.x + 40, r.y + 20, { steps: 6 }); await page.mouse.up(); await wait(200);
    const seen = await ev(() => [...new Set(lab.drag)].join(', '));
    return [{ name: 'Drag it with the mouse', ...yes(seen.includes('dragstart'), `events: ${seen || 'none'}`) }];
  },
  '[inert]': async () => { await click(await at('button')); const t = await ev(() => { const c = lab.clicks.at(-1); return !c ? 'nothing' : lab.T.contains(c.target) ? `<${c.target.localName}> inside the inert subtree` : `<${c.target.localName}> behind it`; }); return [{ name: 'A click on the drawn button skips the inert subtree', ...yes(!t.includes('inside'), `the click went to ${t}`) }]; },
  '[hidden=until-found]': async () => [{ name: 'Find in page reveals it', ok: null, detail: 'find-in-page cannot be driven from script: window.find() does not reveal hidden=until-found content in plain DOM either' }],
  p: async (r) => {
    await page.mouse.move(r.left + 2, r.y); await page.mouse.down(); await page.mouse.move(r.left + r.w - 2, r.y, { steps: 5 }); await page.mouse.up(); await wait(150);
    const s = await ev(() => getSelection().toString());
    return [{ name: 'Drag across the text to select it', ...yes(s.length > 3, `selection is "${s}"`) }];
  },
  video: async () => { await wait(400); const o = await ev(() => ({ paused: lab.T.paused, t: lab.T.currentTime })); return [{ name: 'Autoplay (muted) runs', ...yes(!o.paused, `paused is ${o.paused}, currentTime ${o.t.toFixed(2)} s`) }]; },
  'video controls': async (r) => {
    await click({ x: r.left + 22, y: r.top + r.h - 48 }); await wait(300);
    const p1 = await ev(() => lab.T.paused);
    return [{ name: 'Click the play button in the native controls', ...yes(p1 === false, `paused is ${p1}`) }];
  },
  'audio controls': async (r) => { await click({ x: r.left + 26, y: r.y }); await wait(200); const p1 = await ev(() => lab.T.paused); return [{ name: 'Click the play button', ...yes(p1 === false, `paused is ${p1}`) }]; },
  track: async () => {
    await wait(500);
    const o = await ev(() => {
      const v = lab.W.querySelector('video'), r = v.getBoundingClientRect(), c = lab.C.getBoundingClientRect();
      const d = lab.C.getContext('2d').getImageData(Math.round(r.left - c.left), Math.round(r.bottom - c.top - 24), Math.round(r.width), 22).data;
      let white = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 30) white++; // the cue's black background box
      return { cues: v.textTracks[0]?.activeCues?.length ?? 0, white };
    });
    return [{ name: 'The caption cue is drawn with the video', ...yes(o.cues > 0 && o.white > 20, `${o.cues} active cue, ${o.white} black pixels (the cue's background box) at the bottom of the drawn video`) }];
  },
  'iframe (srcdoc)': async (r) => frameClick(r),
  'iframe (same origin)': async (r) => frameClick(r),
  'iframe (other origin)': async (r) => {
    await click({ x: r.left + 120, y: r.top + 18 }); await wait(300);
    const got = await ev(() => lab.messages.includes('frame-clicked'));
    return [{ name: 'Click the button inside the frame', ...yes(got, got ? 'the frame reported the click by postMessage' : 'no message from the frame') }];
  },
  'canvas (drawable, nested)': async () => { await click(await at('button')); const t = await ev(() => lab.clicks.at(-1)?.target.localName ?? 'nothing'); return [{ name: 'Click the button in the inner canvas', ...yes(t === 'button', `click reached ${t}`) }]; },
  'svg foreignObject': async () => { await click(await at('button')); const t = await ev(() => lab.clicks.at(-1)?.target.localName ?? 'nothing'); return [{ name: 'Click the HTML button inside', ...yes(t === 'button', `click reached ${t}`) }]; },
  'custom element': async (r) => { await click({ x: r.left + 40, y: r.y }); const o = await ev(() => { const c = lab.clicks.at(-1); return c ? `${c.path.localName} in the shadow tree, retargeted to ${c.target.localName}` : null; }); return [{ name: 'Click the button in its shadow tree', ...yes(o?.startsWith('button'), o ?? 'no click') }]; },
  geolocation: async () => {
    await wait(700);
    await ev(() => { lab.plainGeo = document.createElement('geolocation'); lab.plainGeo.style.cssText = 'position:fixed;left:20px;top:320px'; document.body.append(lab.plainGeo); });
    await wait(700);
    const o = await ev(() => { const out = { c: [lab.T.isValid, lab.T.invalidReason], p: [lab.plainGeo.isValid, lab.plainGeo.invalidReason] }; lab.plainGeo.remove(); return out; });
    return [{ name: 'The permission element accepts clicks (isValid)', ...yes(o.c[0], `in the canvas: isValid ${o.c[0]}, invalidReason "${o.c[1]}". As plain DOM: isValid ${o.p[0]}, invalidReason "${o.p[1]}".`) }];
  },
  marquee: async () => { await wait(1200); const ink = await ev(() => lab.ink()); return [{ name: 'The scrolling text is drawn', ...yes(ink > 0, `${ink} px of ink after 1.2 s`) }]; },
  'style (display: block, contenteditable)': async (r) => {
    const before = await ev(() => getComputedStyle(lab.W.querySelector('.el-live')).color);
    await ev(() => { const t = lab.T.firstChild; getSelection().setBaseAndExtent(t, t.data.indexOf('#b3261e'), t, t.data.indexOf('#b3261e') + 7); lab.T.focus(); });
    await page.keyboard.type('green');
    await wait(200);
    const after = await ev(() => getComputedStyle(lab.W.querySelector('.el-live')).color);
    return [{ name: 'Type a new colour into the drawn stylesheet', ...yes(after !== before, `the span's colour went from ${before} to ${after}`) }];
  },
};

async function frameClick() {
  const pt = await ev(() => { const f = lab.T.getBoundingClientRect(), b = lab.T.contentDocument.querySelector('button').getBoundingClientRect(); return { x: f.left + lab.T.clientLeft + b.left + b.width / 2, y: f.top + lab.T.clientTop + b.top + b.height / 2 }; });
  await click(pt); await wait(200);
  const ok = await ev(() => { const d = lab.T.contentDocument; return d.activeElement?.localName === 'button' || d.querySelector('button').textContent === 'clicked'; });
  return [{ name: 'Click the button inside the frame', ...yes(ok, ok ? 'the button in the frame took the click' : 'the click did not reach the button') }];
}

// ---------------------------------------------------------------- run
const info = await ev(async () => { lab.A = await (await import('/elements/media.js')).assets(); return { ua: navigator.userAgent, tags: lab.ELEMENTS.map((e) => e.tag), A: lab.A }; });
const tags = info.tags.filter((t) => !only.length || only.some((o) => t.includes(o)));
console.error(`${info.ua}\n${tags.length} entries, video asset: ${info.A.video ? 'yes' : 'no'}, second origin: ${info.A.other}`);

// 1. the same probe the page runs
const probed = await ev(async (list) => lab.P.probeAll(lab.ELEMENTS.filter((e) => list.includes(e.tag)), lab.A), tags);

const results = {};
for (const tag of tags) {
  const out = { ...probed[tag] };
  results[tag] = out;
  if (out.skipped || out.crashed) continue;
  try {
    const r = await ev((t) => lab.hold(t), tag);
    if (!r) continue;
    await wait(120);
    // 2. picture in the canvas against the same markup as plain DOM
    await page.mouse.move(2, 2); await wait(60); // not hovering, so both copies are in the same state
    const [a, b] = [await page.screenshot({ clip: { x: 8, y: 60, width: 300, height: 150 } }), await page.screenshot({ clip: { x: 330, y: 60, width: 300, height: 150 } })];
    out.picture = await ev(([x, y]) => lab.compare(x, y), [a, b].map((s) => 'data:image/png;base64,' + s.toString('base64')));
    if (process.env.SHOTS) { await writeFile(`${process.env.SHOTS}/${tag.replace(/[^\w]+/g, '_')}-plain.png`, a); await writeFile(`${process.env.SHOTS}/${tag.replace(/[^\w]+/g, '_')}-canvas.png`, b); }
    // 3. a real click in the middle of the drawn element
    if (r.w >= 1 && r.h >= 1 && !r.error) {
      await ev(() => { lab.plainTarget?.closest('div')?.replaceChildren(); });
      await page.mouse.move(2, 2); await page.mouse.move(r.x, r.y, { steps: 2 }); await page.mouse.click(r.x, r.y); await wait(80);
      out.click = await ev(() => { const c = lab.clicks.at(-1); return !c ? 'none' : c.target === lab.T ? 'self' : lab.T.contains(c.target) ? 'descendant' : `<${c.target.localName}>`; });
      await page.keyboard.press('Escape');
    }
    // 4. the element's own test
    if (TESTS[tag]) {
      const again = await ev((t) => lab.hold(t, { withPlain: false }), tag);
      await wait(120);
      out.tests = await TESTS[tag](again);
      await page.keyboard.press('Escape');
    }
  } catch (err) {
    out.recorderError = String(err.message).split('\n')[0];
  }
  if (crashed) { out.recorderError = 'the tab crashed'; break; }
  const t = out.tests?.map((x) => `${x.ok === null ? '?' : x.ok ? 'Y' : 'N'} ${x.name}: ${x.detail}`).join(' | ') ?? '';
  console.error(`${tag.padEnd(30)} match ${String(out.picture?.match).padEnd(6)} click ${String(out.click).padEnd(11)} ${out.recorderError ?? ''} ${t}`.slice(0, 400));
}

await browser.close();
servers.forEach((s) => s.close());

if (!only.length) {
  const version = info.ua.match(/Chrome\/[\d.]+/)?.[0] ?? info.ua;
  const data = { browser: `Headless ${version.replace('/', ' ')}, Linux, software rendering`, date: new Date().toISOString().slice(0, 10), results };
  await writeFile(path.join(root, 'elements/recorded.json'), JSON.stringify(data, null, 1) + '\n');
  console.error('wrote public/elements/recorded.json');

  // The same catalogue as a Markdown file in the repository.
  const { GROUPS, ELEMENTS } = await import(path.join(root, 'elements/data.js'));
  const { noteFor, RULES } = await import(path.join(root, 'elements/notes.js'));
  const { verdict, LABEL } = await import(path.join(root, 'elements/verdict.js'));
  const { IDEAS, evaluate } = await import(path.join(root, 'elements/ideas.js'));
  const cell = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/\n/g, ' ');
  const name = (tag) => (tag.startsWith('[') || tag.startsWith('custom') ? tag : `<${tag.replace(/ \(.*\)$/, '')}>${tag.match(/ \(.*\)$/)?.[0] ?? ''}`);
  const md = [
    '# Every HTML element inside a drawable canvas', '',
    `Generated by \`npm run record:elements\` from \`public/elements/data.js\`, \`notes.js\` and the recording. Do not edit by hand. The live page is [/elements/](https://html-in-canvas.page/elements/): it has the full measurements for each row and can re-run them in your browser.`, '',
    `Recorded ${data.date} in ${data.browser}. ${ELEMENTS.length} entries.`, '',
    '"Found" is measured. "Not measured" is an expectation that needs a person with a real browser, mostly about native popups, which headless Chromium does not show.', '',
    '## Findings', '', ...RULES.map(([t, x]) => `- **${t}.** ${x}`), '',
    '## Ideas', '', 'Ranked 1 (build next) to 3 (small, speculative or blocked). Status is from the recording: an idea is blocked when an element it needs is blank or has no box, and partly possible when one failed an input check.', '',
    ...[1, 2, 3].flatMap((rank) => [`### Rank ${rank}`, '', ...IDEAS.filter((x) => x.rank === rank).map((x) => { const ev = evaluate(x, (tag) => verdict(results[tag], tag)); return `- **${x.title}** (${ev.status}${ev.why.length ? ': ' + ev.why.map(name).join(', ') : ''}). ${x.text} Needs ${x.needs.map((t) => '`' + name(t.replace(/^\?/, '')) + '`').join(', ')}.`; }), '']),
  ];
  for (const [key, title] of GROUPS) {
    md.push(`## ${title}`, '', '| Element | Result | Found | Not measured | Idea |', '|---|---|---|---|---|');
    for (const e of ELEMENTS.filter((x) => x.group === key)) {
      const n = noteFor(e), r = results[e.tag];
      const failed = (r.tests ?? []).filter((t) => t.ok === false).length, total = (r.tests ?? []).filter((t) => t.ok !== null).length;
      md.push(`| \`${name(e.tag)}\` | ${LABEL[verdict(r, e.tag)]}${total ? ` (${total - failed}/${total} input checks)` : ''} | ${cell(n.found)} | ${cell(n.inferred)} | ${cell(n.idea)} |`);
    }
    md.push('');
  }
  await writeFile(path.resolve(here, '../../ELEMENTS.md'), md.join('\n'));
  console.error('wrote ELEMENTS.md');
}
