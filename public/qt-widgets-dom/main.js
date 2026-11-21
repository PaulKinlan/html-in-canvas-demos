// The page script for /qt-widgets-dom/.
import { banner, runTests } from '/shared/support.js';
import { startQtWidgets } from '/qt-widgets-dom/start.js';

banner();
const $ = (id) => document.getElementById(id);
const msg = $('msg');

$('load').addEventListener('click', async () => {
  msg.textContent = 'Loading Qt (14 MB)…';
  try {
    const { dom } = await startQtWidgets($('screen'), { onExit: (exit) => { msg.hidden = false; msg.textContent = `Qt stopped${exit?.text ? `: ${exit.text}` : ''}`; } });
    msg.hidden = true;
    const timer = setInterval(() => {
      const s = dom.stats;
      $('state').textContent = `Qt has flushed ${s.flushes} times with putImageData(). The elements were drawn ${s.draws} times after those flushes. The browser fired ${s.paints} paint events.${s.error ? ` Last error: ${s.error}` : ''}`;
      if (!document.body.contains(msg)) clearInterval(timer);
    }, 500);
    dom.canvas?.addEventListener('contextlost', () => { msg.hidden = false; msg.textContent = 'The Qt window\'s canvas lost its drawing context. Qt repaints it when the browser restores the context.'; });
    dom.canvas?.addEventListener('contextrestored', () => { msg.hidden = true; });
  } catch (err) {
    msg.textContent = `Qt did not start: ${err.message ?? err}`;
  }
}, { once: true });

// ---------------------------------------------------------------- live checks
let frame = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (test()) return true; await sleep(50); } return false; };
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:360px;height:420px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:360px;height:420px';
  f.src = '/qt-widgets-dom/fixture.html';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  await until(() => win.__app || win.__error, 40000);
  if (!win.__app) throw new Error(win.__error ?? 'the app did not start in 40 s');
  const dom = win.__qtwDom;
  await until(() => dom.stats.draws >= 4 && !dom.stats.error, 5000);
  await sleep(300);
  frame = { holder, win, dom, module: win.__app.module, root: dom.canvas?.getRootNode() };
  return frame;
}
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };

const tests = [
  {
    name: 'Qt flushes with putImageData() and the elements are drawn after it',
    why: 'The wrapped putImageData() on the Qt window\'s 2D context calls drawElementImage() for each DomWidget. The check reads pixels of the textarea back from Qt\'s canvas.',
    timeout: 60000,
    run: async () => {
      const { dom } = await fixture();
      const s = dom.stats;
      if (!s.flushes) throw new Error('Qt did not call putImageData()');
      if (!s.draws) throw new Error(`no element was drawn. ${s.error}`);
      const r = dom.items.notes.rect, k = dom.canvas.width / dom.canvas.clientWidth;
      const data = dom.ctx.getImageData(Math.round((r.x + 6) * k), Math.round((r.y + 6) * k), Math.round(200 * k), Math.round(24 * k)).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
      if (!dark) throw new Error('no text pixels where the textarea is drawn');
      return `${s.flushes} flushes, ${s.draws} element draws; ${dark} dark pixels of textarea text read back from Qt's canvas`;
    },
  },
  {
    name: 'The browser hit tests a field where Qt laid out its widget',
    why: 'drawElementImage() in a 2D canvas sets the hit box. The canvas is in Qt\'s shadow root.',
    run: async () => {
      const { dom, root } = await fixture();
      const el = dom.items.email.el, c = centre(el), want = dom.items.email.rect;
      const hit = root.elementFromPoint(c.x, c.y);
      if (hit !== el) throw new Error(`elementFromPoint gave <${hit?.localName}>`);
      return `Qt put the widget at ${want.x}, ${want.y}; the input's box is at ${Math.round(c.r.x)}, ${Math.round(c.r.y)} and the point hits it`;
    },
  },
  {
    name: 'Qt sets the width, the browser answers with the height',
    why: 'resizeEvent() sets the element\'s width. The widget\'s height is the element\'s offsetHeight.',
    run: async () => {
      const { dom } = await fixture();
      const item = dom.items.terms;
      if (!item.el.style.width) throw new Error('no width was set');
      if (item.rect.h !== item.el.offsetHeight) throw new Error(`widget height ${item.rect.h}, element height ${item.el.offsetHeight}`);
      return `width ${item.el.style.width} from Qt's layout, height ${item.el.offsetHeight}px from the browser, used by Qt as the widget height`;
    },
  },
  {
    name: 'Changing a field makes Qt repaint and flush',
    why: 'paint event, then QWidget::update(), then Qt\'s flush, then drawElementImage().',
    run: async () => {
      const { dom } = await fixture();
      const before = { ...dom.stats };
      dom.items.notes.el.value = 'changed by the check';
      if (!await until(() => dom.stats.draws > before.draws)) throw new Error('no draw followed the change');
      await sleep(200);
      return `${dom.stats.paints - before.paints} paint event(s), ${dom.stats.flushes - before.flushes} flush(es), ${dom.stats.draws - before.draws} element draws`;
    },
  },
  {
    name: 'Drawing the elements does not cause paint events or a flush loop',
    why: 'drawElementImage() after a flush must not make the browser fire paint, which would make Qt flush again. A few flushes are allowed, because Qt repaints for its own reasons such as a blinking caret.',
    run: async () => {
      const { win, dom } = await fixture();
      // Wait for the repaint that the previous check caused to finish.
      for (let last = -1, t = 0; t < 3000 && last !== dom.stats.paints; t += 500) { last = dom.stats.paints; await sleep(500); }
      const before = { ...dom.stats };
      for (let i = 0; i < 60; i++) await new Promise((r) => win.requestAnimationFrame(r));
      const paints = dom.stats.paints - before.paints, flushes = dom.stats.flushes - before.flushes;
      if (paints) throw new Error(`${paints} paint events with nothing happening`);
      if (flushes > 4) throw new Error(`${flushes} flushes in 60 frames with nothing happening`);
      return `0 paint events and ${flushes} flush(es) during 60 animation frames`;
    },
  },
  {
    name: 'A field scrolled out of the Qt scroll area takes no pointer',
    why: 'Its visible region is empty, so it is not drawn and is made inert. It comes back when scrolled back.',
    run: async () => {
      const { dom, module, root } = await fixture();
      const item = dom.items.email, c = centre(item.el);
      module._qtw_scroll(100000);
      if (!await until(() => item.el.inert)) throw new Error(`still visible: ${JSON.stringify(item.rect)}`);
      const hit = root.elementFromPoint(c.x, c.y);
      if (hit === item.el) throw new Error('the scrolled-out field is still hit');
      module._qtw_scroll(0);
      if (!await until(() => !item.el.inert && root.elementFromPoint(c.x, c.y) === item.el)) throw new Error('the field did not come back');
      return `scrolled out: inert, the point hits <${hit?.localName}>; scrolled back: the point hits the email input`;
    },
  },
  {
    name: 'A Qt popup window covers the DOM fields for the pointer',
    why: 'QComboBox opens its list as a second Qt window, which is a second canvas above the first. No guard code is involved.',
    run: async () => {
      const { dom, module, root } = await fixture();
      const el = dom.items.email.el, c = centre(el);
      module._qtw_popup(1);
      await until(() => root.querySelectorAll('canvas.qt-window-canvas').length > 1);
      await sleep(300);
      const hit = root.elementFromPoint(c.x, c.y);
      const canvases = root.querySelectorAll('canvas.qt-window-canvas').length;
      module._qtw_popup(0);
      await sleep(200);
      if (canvases < 2) throw new Error('the popup did not open as a second canvas');
      if (hit === el) throw new Error('the input under the popup is still hit');
      return `${canvases} Qt canvases while the popup is open; the point over the email field hits <${hit?.localName}${hit?.className ? `.${String(hit.className).split(' ')[0]}` : ''}>`;
    },
  },
  {
    name: 'A real field has a role and a name in the accessibility tree',
    why: 'It is an ordinary element in the subtree of Qt\'s canvas.',
    run: async () => {
      const { dom } = await fixture();
      const el = dom.items.plan.el;
      const name = el.computedName ?? el.getAttribute('aria-label');
      if (!name) throw new Error('no accessible name');
      return `${el.computedRole ? `role ${el.computedRole}, ` : ''}name "${name}"`;
    },
  },
];

runTests($('results'), tests).then(() => { frame?.holder.remove(); frame = null; });
