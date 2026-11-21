// The page script for /imgui-dom/.
import { banner, runTests } from '/shared/support.js';
import { startImgui } from '/imgui-dom/start.js';

banner();
const $ = (id) => document.getElementById(id);
const canvas = $('imgui-app'), msg = $('msg');
const say = (text) => { msg.textContent = text; msg.hidden = !text; };

startImgui(canvas).then(({ dom }) => {
  const started = performance.now();
  const timer = setInterval(() => {
    const s = dom.stats;
    if (s.uploads) say('');
    else if (performance.now() - started > 8000) say(`The app started but no element was drawn. ${s.error || 'HTML-in-canvas may be off in this browser.'}`);
    $('state').textContent = `ImGui has drawn ${s.frames} frames. The browser fired ${s.paints} paint events and the app uploaded ${s.uploads} element textures.`;
    if (!document.body.contains(canvas)) clearInterval(timer);
  }, 500);
}, (err) => say(`The app did not start: ${err.message}`));
// A lost WebGL context leaves the canvas blank. The app does not rebuild its textures.
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  say('The canvas lost its WebGL context. Reload the page to start the app again.');
});

// ---------------------------------------------------------------- live checks
let frame = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (test()) return true; await sleep(50); } return false; };
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:360px;height:560px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:360px;height:560px';
  f.src = '/imgui-dom/fixture.html';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  await until(() => win.__app || win.__error, 8000);
  if (!win.__app) throw new Error(win.__error ?? 'the app did not start');
  await until(() => win.__imguiDom.stats.uploads >= 5, 5000);
  await sleep(300);
  frame = { holder, win, doc: f.contentDocument, dom: win.__imguiDom, module: win.__app.module };
  return frame;
}
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };

const tests = [
  {
    name: 'The app starts and uploads its DOM elements as textures',
    why: 'texElementSubImage2D() into a texture made with glGenTextures() in C++, then one ImGui::ImageWithBg() call.',
    run: async () => {
      const { dom } = await fixture();
      const s = dom.stats;
      if (!s.uploads) throw new Error(`no uploads. ${s.error}`);
      return `${s.uploads} uploads of ${Object.keys(dom.items).length} elements after ${s.paints} paint events, ${s.frames} ImGui frames`;
    },
  },
  {
    name: 'The browser hit tests a field where ImGui drew it',
    why: 'updateElementGeometry() with the item rectangle and the window\'s clip rectangle.',
    run: async () => {
      const { doc, dom } = await fixture();
      const el = dom.element('email'), c = centre(el);
      if (c.r.x < 0) throw new Error('the element has no on-canvas geometry');
      const hit = doc.elementFromPoint(c.x, c.y);
      if (hit !== el) throw new Error(`elementFromPoint gave <${hit?.localName}>`);
      return `the email input is hit at ${Math.round(c.x)}, ${Math.round(c.y)}; its box is ${Math.round(c.r.width)}×${Math.round(c.r.height)} CSS px`;
    },
  },
  {
    name: 'ImGui sets the width, the browser answers with the height',
    why: 'The paragraph of DOM text wraps to the content width of the ImGui window.',
    run: async () => {
      const { dom } = await fixture();
      const el = dom.element('terms');
      if (!el.style.width) throw new Error('no width was set');
      return `width ${el.style.width} from ImGui, height ${el.offsetHeight}px from the browser`;
    },
  },
  {
    name: 'Changing a field repaints its texture',
    why: 'The browser fires paint on the canvas, the element is marked, and the next ImGui frame uploads it.',
    run: async () => {
      const { dom } = await fixture();
      const before = dom.stats.uploads;
      dom.element('about').value = 'changed by the check';
      if (!await until(() => dom.stats.uploads > before)) throw new Error('no upload followed the change');
      return `${dom.stats.uploads - before} upload(s) after the value changed`;
    },
  },
  {
    name: 'With nothing happening ImGui draws no frames',
    why: 'The frame function returns early unless an event or a paint asked for frames.',
    run: async () => {
      const { win, dom } = await fixture();
      await sleep(500);
      const before = dom.stats.frames;
      for (let i = 0; i < 30; i++) await new Promise((r) => win.requestAnimationFrame(r));
      const drawn = dom.stats.frames - before;
      if (drawn) throw new Error(`${drawn} frames were drawn`);
      return '0 ImGui frames during 30 animation frames';
    },
  },
  {
    name: 'A field scrolled out of the ImGui window loses its hit box',
    why: 'The window is scrolled with the wheel. The clip rectangle goes to updateElementGeometry(), and an item outside it is moved off the canvas.',
    run: async () => {
      const { doc, dom, module } = await fixture();
      const el = dom.element('email'), c = centre(el);
      module._ui_pointer(c.x, c.y + 150, -1);
      module._ui_wheel(-30);
      if (!await until(() => el.getBoundingClientRect().x < -1000 || doc.elementFromPoint(c.x, c.y) !== el)) throw new Error('the field is still hit at its old place');
      const hit = doc.elementFromPoint(c.x, c.y);
      module._ui_wheel(30);
      await until(() => doc.elementFromPoint(c.x, c.y) === el);
      if (doc.elementFromPoint(c.x, c.y) !== el) throw new Error('the field did not come back after scrolling back');
      return `scrolled away: the point hits <${hit?.localName}${hit?.dataset?.imgui ? ` ${hit.dataset.imgui}` : ''}>; scrolled back: it hits the email input again`;
    },
  },
  {
    name: 'A field under another ImGui window does not take the pointer',
    why: 'The second window is moved over the email field. The browser alone would still hit the input.',
    run: async () => {
      const { win, doc, dom, module } = await fixture();
      const el = dom.element('email'), c = centre(el);
      const x = c.r.x + 40, y = c.r.y + 18;
      module._ui_cover();
      if (!await until(() => !dom.visibleAt('email', x, y))) throw new Error('ImGui says the field is on top at that point');
      const first = doc.elementFromPoint(x, y);
      if (first === el) {
        el.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
        await sleep(150);
        if (doc.elementFromPoint(x, y) === el) throw new Error('the element kept its hit box under the window');
        return 'the browser hit the input first; the page asked ImGui, gave it the event and moved the hit box off the canvas';
      }
      return `elementFromPoint gave <${first?.localName}>, not the input`;
    },
  },
  {
    name: 'A real field has a role and a name in the accessibility tree',
    why: 'It is an ordinary element in the canvas subtree. ImGui\'s own widgets have no DOM nodes.',
    run: async () => {
      const { dom } = await fixture();
      const el = dom.element('country');
      const name = el.computedName ?? el.getAttribute('aria-label');
      if (!name) throw new Error('no accessible name');
      return `${el.computedRole ? `role ${el.computedRole}, ` : ''}name "${name}"`;
    },
  },
];

runTests($('results'), tests).then(() => { frame?.holder.remove(); frame = null; });
