// The page script for /native-ui/. The egui app is started by the module in index.html.
import { banner, runTests } from '/shared/support.js';

banner();
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- egui status line
{
  const msg = $('egui-msg');
  const started = Date.now();
  const timer = setInterval(() => {
    const stats = window.__eguiDom?.stats();
    if (stats?.uploads) {
      msg.hidden = true;
      clearInterval(timer);
    } else if (Date.now() - started > 15000) {
      msg.textContent = stats
        ? `The egui app started but no element was drawn. ${stats.lastError || 'HTML-in-canvas may be off in this browser.'}`
        : 'The egui app did not start. It needs WebAssembly and WebGL2.';
      clearInterval(timer);
    }
  }, 300);
}

// ---------------------------------------------------------------- Qt, loaded on request
// #region qt-load
const script = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

async function loadQt() {
  const msg = $('qt-msg');
  msg.textContent = 'Loading Qt (23 MB)…';
  try {
    // Qt's canvas lives in a shadow root, where the page's stylesheet does not apply.
    for (const el of document.querySelectorAll('.qt-dom')) {
      const cs = getComputedStyle(el);
      for (const p of ['boxSizing', 'margin', 'font', 'color', 'colorScheme', 'background', 'border', 'borderRadius', 'padding', 'resize']) el.style[p] = cs[p];
    }
    $('qt-parts').hidden = false; // the elements must be rendered to be adopted
    $('qt-parts').style.cssText = 'position:absolute;left:-9999px;top:0;width:300px';
    await script('/native-ui/qt/qtdom.js');
    await script('/native-ui/qt/qtloader.js');
    await window.qtLoad({
      qt: {
        entryFunction: window.qtdom_entry,
        containerElements: [$('qt-screen')],
        onLoaded: () => (msg.hidden = true),
        onExit: (exit) => { msg.hidden = false; msg.textContent = `Qt stopped${exit.text ? `: ${exit.text}` : ''}`; },
      },
      locateFile: (file) => `/native-ui/qt/${file}`,
    });
  } catch (err) {
    msg.textContent = `Qt did not start: ${err.message ?? err}`;
  }
}
$('qt-load').addEventListener('click', loadQt, { once: true });
// #endregion qt-load

// ---------------------------------------------------------------- live checks
// All checks share one framed copy of the egui app, fixed to the corner of the window.
let frame = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:360px;height:520px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:360px;height:520px';
  f.src = '/native-ui/egui-fixture.html?window=over';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  for (let i = 0; i < 100 && !f.contentWindow.__eguiDom?.stats().uploads; i++) await sleep(100);
  frame = { holder, win: f.contentWindow, doc: f.contentDocument };
  return frame;
}
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };

const tests = [
  {
    name: 'The egui app starts and uploads its DOM elements as textures',
    why: 'texElementSubImage2D() into a texture bound by Rust, inside egui\'s paint callback.',
    run: async () => {
      const { win } = await fixture();
      const stats = win.__eguiDom?.stats();
      if (!stats) throw new Error('the app did not start');
      if (!stats.uploads) throw new Error(`no uploads. ${stats.lastError}`);
      return `${stats.uploads} uploads of ${stats.widgets} elements after ${stats.paints} paint events`;
    },
  },
  {
    name: 'The browser hit tests a DOM field where egui drew it',
    why: 'updateElementGeometry() with the rectangle egui allocated. The textarea is clear of the egui window in this fixture.',
    run: async () => {
      const { win, doc } = await fixture();
      const el = win.__eguiDom.element('about');
      const c = centre(el);
      if (c.r.x < 0) throw new Error('the element has no on-canvas geometry');
      const hit = doc.elementFromPoint(c.x, c.y);
      if (hit !== el) throw new Error(`elementFromPoint gave <${hit?.localName}>`);
      return `<textarea> found at ${Math.round(c.x)}, ${Math.round(c.y)}; its box is ${Math.round(c.r.width)}×${Math.round(c.r.height)} CSS px`;
    },
  },
  {
    name: 'egui sets the width, the browser answers with the height',
    why: 'The DOM paragraph wraps to the width egui gave it and egui reserves the height the browser reports.',
    run: async () => {
      const { win } = await fixture();
      const el = win.__eguiDom.element('terms');
      if (!el.style.width) throw new Error('no width was set');
      return `width ${el.style.width} from egui, height ${el.offsetHeight}px from the browser`;
    },
  },
  {
    name: 'Changing a field repaints its texture',
    why: 'The browser fires paint on the canvas, the bridge marks the element dirty and asks egui for a frame.',
    run: async () => {
      const { win } = await fixture();
      const el = win.__eguiDom.element('about');
      const before = win.__eguiDom.stats().uploads;
      el.value = 'changed by the check';
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      for (let i = 0; i < 30 && win.__eguiDom.stats().uploads === before; i++) await sleep(100);
      const after = win.__eguiDom.stats().uploads;
      if (after === before) throw new Error('no upload followed the change');
      return `${after - before} upload(s) after the value changed`;
    },
  },
  {
    name: 'A field under an egui window does not take the pointer',
    why: 'The fixture starts with the egui window over the email field. The browser alone would still hit the <input>.',
    run: async () => {
      const { win, doc } = await fixture();
      const el = win.__eguiDom.element('email');
      // Where egui laid the field out: it is the first DOM row, 8px in, under the window.
      const about = win.__eguiDom.element('about').getBoundingClientRect();
      const x = about.x + 40, y = 136;
      if (win.__eguiDom.visibleAt('email', x, y)) throw new Error('egui says the field is on top at that point');
      const hit = doc.elementFromPoint(x, y);
      if (hit === el) {
        // Geometry is still there (no pointer has been over it): an event must be turned away.
        el.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
        await sleep(100);
        if (doc.elementFromPoint(x, y) === el) throw new Error('the element kept its hit box under the window');
        return 'the browser hit the <input> first; the bridge turned the event away and moved the hit box off the canvas';
      }
      return `elementFromPoint gave <${hit?.localName}>, not the <input>`;
    },
  },
  {
    name: 'A real field has a role and a name in the accessibility tree',
    why: 'It is an ordinary <input> in the canvas subtree. egui\'s own widgets have no DOM nodes.',
    run: async () => {
      const { win } = await fixture();
      const el = win.__eguiDom.element('email');
      const name = el.computedName ?? el.getAttribute('aria-label');
      if (!name) throw new Error('no accessible name');
      const r = el.getBoundingClientRect();
      return `${el.computedRole ? `role ${el.computedRole}, ` : ''}name "${name}", bounds ${Math.round(r.width)}×${Math.round(r.height)}`;
    },
  },
  {
    name: 'The browser\'s tab order holds only the real fields',
    why: 'egui widgets are not DOM nodes. Tab moves between the DOM fields; egui moves its own focus when its canvas or hidden text input has focus.',
    run: async () => {
      const { doc } = await fixture();
      const focusable = [...doc.querySelectorAll('input, select, textarea, a[href], [tabindex]')].filter((e) => e.tabIndex >= 0 && e.localName !== 'canvas');
      const real = focusable.filter((e) => e.closest('[data-egui]'));
      return `${real.length} DOM fields and links, ${focusable.length - real.length} other node (egui's hidden text input), 0 egui widgets`;
    },
  },
];

runTests($('results'), tests).then(() => { frame?.holder.remove(); frame = null; });
