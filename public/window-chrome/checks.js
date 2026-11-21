// Live checks for /window-chrome/. They load a second copy of the app in a
// small simulated window in a panel at the bottom of the page. Nothing here
// touches the window in the page, and nothing scrolls or takes focus there.
import { runTests, checkBench, stillDrawn, inkFraction, supported } from '/shared/support.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bench, rig;

/** A simulated window with the app in it, once. */
function fixture() {
  rig ??= (async () => {
    bench.innerHTML = `<div class="fakewin" style="position:relative;left:0;top:0;width:354px;height:440px">
      <div class="os-bar">Canvas window</div><iframe title="test copy of the app"></iframe>
      <div class="os-buttons"><span>–</span><span>□</span><span>×</span></div></div>`;
    const fake = bench.firstElementChild, frame = fake.querySelector('iframe');
    const host = window.simulateWindow(fake, frame);
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; frame.src = '/window-chrome/app.html?sim=1'; });
    for (let i = 0; i < 40 && !frame.contentWindow.app; i++) await wait(50);
    await wait(250); // the first paint
    return { fake, frame, host, win: frame.contentWindow, doc: frame.contentDocument };
  })();
  return rig;
}

async function set(patch) {
  const r = await fixture();
  r.host.set({ overlay: true, side: 'right', height: 38, active: true, ...patch });
  await wait(120);
  return r;
}
const mid = (el) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
const name = (el) => (el ? `<${el.localName}${el.id ? '#' + el.id : ''}>` : 'nothing');
const press = (doc, type, x, y, sx = x, sy = y) => doc.elementFromPoint(x, y)?.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, screenX: sx, screenY: sy, bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }));

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. The app shows its bar and body as plain HTML.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'What this browser has for app windows',
    why: 'A list, not a requirement. Most of these only exist, or only act, in an installed app window.',
    run: () => {
      const has = (v) => (v ? 'yes' : 'no');
      return [
        `windowControlsOverlay ${has(navigator.windowControlsOverlay)}`,
        `overlay visible now ${has(navigator.windowControlsOverlay?.visible)}`,
        `app-region ${has(CSS.supports('app-region: drag'))}`,
        `window-drag ${has(CSS.supports('window-drag: drag'))}`,
        `window.minimize ${has(window.minimize)}`, `window.maximize ${has(window.maximize)}`, `window.setShape ${has(window.setShape)}`,
        `navigator.install ${has(navigator.install)}`,
        `display-mode standalone ${has(matchMedia('(display-mode: standalone)').matches)}`,
      ].join(', ');
    },
  },
  {
    name: 'The manifest asks for the window controls overlay',
    run: async () => {
      const m = await (await fetch('/window-chrome/app.webmanifest')).json();
      if (!m.display_override?.includes('window-controls-overlay')) throw new Error(`display_override is ${JSON.stringify(m.display_override)}`);
      return `display_override ${JSON.stringify(m.display_override)}, display "${m.display}", scope ${m.scope}, ${m.icons.length} icons`;
    },
  },
  {
    name: 'The bar element is drawn in the free part of the title bar',
    why: 'System buttons on the left, title bar 44px high. The bar must start after the buttons and be 44px high.',
    run: async () => {
      const { doc, frame } = await set({ side: 'left', height: 44 });
      const b = doc.getElementById('bar').getBoundingClientRect();
      const want = { x: 132, w: frame.clientWidth - 132, h: 44 };
      if (Math.abs(b.left - want.x) > 1 || Math.abs(b.width - want.w) > 1 || Math.abs(b.height - want.h) > 1) throw new Error(`bar is at x ${b.left.toFixed(0)}, ${b.width.toFixed(0)} x ${b.height.toFixed(0)}, expected x ${want.x}, ${want.w} x ${want.h}`);
      return `bar at x ${b.left.toFixed(0)}, ${b.width.toFixed(0)} x ${b.height.toFixed(0)}`;
    },
  },
  {
    name: 'The title is a drag region and the tab inside it is not',
    why: 'elementFromPoint() in the app at the drawn title and the drawn tab, then the computed app-region.',
    run: async () => {
      const { doc } = await set({});
      const title = mid(doc.getElementById('title')), tab = mid(doc.getElementById('tabB'));
      const a = window.__win.regionAt(doc, ...title), b = window.__win.regionAt(doc, ...tab);
      const found = doc.elementFromPoint(...tab);
      if (a !== 'drag' || b !== 'no-drag' || found?.id !== 'tabB') throw new Error(`title: ${a}, tab: ${b}, element at the tab: ${name(found)}`);
      return 'title: drag. Tab: no-drag, and the tab is the element found there';
    },
  },
  {
    name: 'A press on the title drags the simulated window, a press on a tab clicks the tab',
    run: async () => {
      const { doc, host } = await set({});
      const from = host.position();
      const [x, y] = mid(doc.getElementById('title'));
      press(doc, 'pointerdown', x, y, 100, 100); press(doc, 'pointermove', x, y, 130, 112); press(doc, 'pointerup', x, y, 130, 112);
      const to = host.position();
      const tab = doc.getElementById('tabB'), [tx, ty] = mid(tab);
      press(doc, 'pointerdown', tx, ty, 100, 100); press(doc, 'pointermove', tx, ty, 150, 100); press(doc, 'pointerup', tx, ty, 150, 100);
      doc.elementFromPoint(tx, ty).click();
      const after = host.position();
      if (to.x - from.x !== 30 || to.y - from.y !== 12) throw new Error(`the window moved by ${to.x - from.x}, ${to.y - from.y}, expected 30, 12`);
      if (after.x !== to.x) throw new Error('a press on the tab moved the window');
      if (tab.getAttribute('aria-pressed') !== 'true') throw new Error('the tab was not selected by the click');
      return 'the window moved by 30, 12 from the title. The tab press did not move it and selected the tab';
    },
  },
  {
    name: 'A drag region drawn 150px from its layout box is found at the picture',
    why: 'The orange block. In the simulated window the region comes from elementFromPoint(), which follows the picture. A real window has not been measured.',
    run: async () => {
      const { doc, win } = await set({});
      const at = win.app.probeAt(), probe = doc.getElementById('probe');
      const w = probe.offsetWidth, h = probe.offsetHeight;
      const drawn = [at.x + at.shift + w / 2, at.y + h / 2], box = [at.x + w / 2, at.y + h / 2];
      const a = doc.elementFromPoint(...drawn), b = doc.elementFromPoint(...box);
      const ra = window.__win.regionAt(doc, ...drawn), rb = window.__win.regionAt(doc, ...box);
      if (a !== probe || ra !== 'drag') throw new Error(`at the picture: ${name(a)}, region ${ra}`);
      if (b === probe || rb === 'drag') throw new Error(`at the layout box: ${name(b)}, region ${rb}`);
      return `at the picture: the block, region drag. At the layout box: ${name(b)}, region ${rb}`;
    },
  },
  {
    name: 'An inactive window gets a grey title bar from the canvas',
    why: 'Reads one pixel of the title bar strip while the simulated window is active and while it is not.',
    run: async () => {
      const read = async (active) => {
        const { doc } = await set({ active });
        await wait(120);
        const c = doc.getElementById('win'), dpr = c.width / c.clientWidth;
        return Array.from(c.getContext('2d').getImageData(Math.round(8 * dpr), Math.round(4 * dpr), 1, 1).data.slice(0, 3));
      };
      const on = await read(true), off = await read(false);
      await set({ active: true });
      const spread = (p) => Math.max(...p) - Math.min(...p);
      if (spread(on) < 60) throw new Error(`active: rgb(${on}) has no colour`);
      if (spread(off) > 12) throw new Error(`inactive: rgb(${off}) is not grey`);
      return `active rgb(${on}), inactive rgb(${off})`;
    },
  },
];

if (supported) {
  tests.push(stillDrawn(() => [{
    name: 'the window',
    ink: () => { const c = $('appFrame').contentDocument?.getElementById('win'); return c?.getContext ? inkFraction(c.getContext('2d')) : null; },
  }]));
}

bench = checkBench();
runTests($('results'), tests).then(() => bench.done());
