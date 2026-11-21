// The page script for /toolkit-aria/.
import { banner, runTests } from '/shared/support.js';
import { startToolkitAria } from '/toolkit-aria/start.js';

banner();
const $ = (id) => document.getElementById(id);
const canvas = $('aria-app'), msg = $('msg'), outline = $('outline');
const say = (text) => { msg.textContent = text; msg.hidden = !text; };

// #region outline
// Draw each node's getBoundingClientRect() over the canvas. The boxes are plain divs in an
// overlay with pointer-events: none, so they show what the browser believes without changing it.
const boxes = new Map();
function drawOutline(aria) {
  const stage = outline.getBoundingClientRect();
  const seen = new Set();
  for (const item of aria.items.values()) {
    let box = boxes.get(item.id);
    if (!box) { box = document.createElement('div'); box.append(document.createElement('span')); outline.append(box); boxes.set(item.id, box); }
    const r = item.el.getBoundingClientRect();
    box.style.cssText = `left:${r.left - stage.left}px;top:${r.top - stage.top}px;width:${r.width}px;height:${r.height}px`;
    // The tag goes to the right of the box, or inside it when there is no room.
    const inside = r.right - stage.left + 130 > stage.width;
    box.className = `${item.el === document.activeElement ? 'focus' : ''}${inside ? ' inside' : ''}`;
    const label = `${item.role === 'disclosure' ? 'button' : item.role} ${item.label}`;
    if (box.firstChild.textContent !== label) box.firstChild.textContent = label;
    seen.add(item.id);
  }
  for (const [id, box] of boxes) if (!seen.has(id)) { box.remove(); boxes.delete(id); }
}
// #endregion outline

startToolkitAria(canvas).then(({ module, aria }) => {
  say('');
  // The app calls this after every ImGui frame. There is no timer and no animation loop here.
  aria.onframe = () => {
    const s = aria.stats;
    $('state').textContent = `ImGui has drawn ${s.frames} frames. The canvas holds ${aria.items.size} nodes, placed ${s.places} times with updateElementGeometry(). Node textures uploaded: ${s.uploads}.${canvas.updateElementGeometry ? (s.error && !s.places ? ` ${s.error}` : '') : ' This browser has no updateElementGeometry(), so the nodes are fallback content of the canvas: they have roles and names and take focus, but they have no boxes and the text field cannot be typed in.'}`;
    if (!outline.hidden) drawOutline(aria);
  };
  $('show-outline').addEventListener('change', (event) => {
    outline.hidden = !event.target.checked;
    if (!outline.hidden) drawOutline(aria);
  });
  $('draw-focused').addEventListener('change', (event) => module._aria_draw_focused(event.target.checked ? 1 : 0));
  canvas.addEventListener('focusin', () => module._ui_wake());
  canvas.addEventListener('focusout', () => module._ui_wake());
  module._ui_wake();
}, (err) => say(`The app did not start: ${err.message}`));
// A lost WebGL context leaves the canvas blank. The app does not rebuild its font texture.
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  say('The canvas lost its WebGL context. Reload the page to start the app again.');
});

// ---------------------------------------------------------------- live checks
// The checks load a second copy of the app in a frame. Focus is only ever moved inside that frame.
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
  f.tabIndex = -1;
  f.src = '/toolkit-aria/fixture.html';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  await until(() => win.__app || win.__error, 8000);
  if (!win.__app) throw new Error(win.__error ?? 'the app did not start');
  const aria = win.__toolkitAria;
  await until(() => aria.stats.places >= aria.items.size && aria.items.size >= 14, 5000);
  await sleep(300);
  frame = { holder, win, doc: f.contentDocument, aria, module: win.__app.module };
  return frame;
}
const round = (v) => Math.round(v * 10) / 10;
const labels = (aria) => [...aria.canvas.children].map((el) => [...aria.items.values()].find((i) => i.el === el)?.label ?? `<${el.localName}>`);
// The node's box relative to its canvas, as the browser reports it.
const boxOf = (aria, el) => { const c = aria.canvas.getBoundingClientRect(), r = el.getBoundingClientRect(); return [r.x - c.x, r.y - c.y, r.width, r.height]; };
const need = (aria, name) => { const item = aria.item(name); if (!item) throw new Error(`no node named "${name}"`); return item; };

const tests = [
  {
    name: 'Each ImGui widget gets a DOM node in the canvas, in the order ImGui submitted it',
    why: 'A11y() runs after each widget and calls the page. No node is ever drawn: there are no texture uploads.',
    run: async () => {
      const { aria } = await fixture();
      const order = labels(aria);
      const want = ['Title', 'Autosave', 'Volume', 'Save', 'Status', 'Advanced'];
      if (want.some((name, i) => order[i] !== name)) throw new Error(`order is ${order.join(', ')}`);
      if (aria.stats.uploads) throw new Error(`${aria.stats.uploads} texture uploads happened`);
      return `${order.length} nodes: ${order.slice(0, 7).join(', ')}, … 0 texture uploads, ${aria.stats.places} updateElementGeometry() calls, transform unit ${round(aria.unit.value)}`;
    },
  },
  {
    name: 'getBoundingClientRect() of each node is the rectangle ImGui drew',
    why: 'updateElementGeometry(node, { canvasTransform, canvasClip }) on a node that is laid out at the canvas origin and never painted into the canvas.',
    run: async () => {
      const { aria } = await fixture();
      let worst = 0, count = 0;
      for (const item of aria.items.values()) {
        const box = boxOf(aria, item.el);
        box.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - item.rect[i])); });
        count++;
      }
      if (worst > 1) throw new Error(`largest difference is ${round(worst)} px`);
      const save = need(aria, 'Save');
      return `${count} nodes, largest difference ${round(worst)} CSS px. Save: ImGui ${save.rect.map(round).join(', ')}; browser ${boxOf(aria, save.el).map(round).join(', ')}`;
    },
  },
  {
    name: 'elementFromPoint() at the centre of each widget returns its node',
    why: 'The browser hit tests the undrawn nodes at the places ImGui reported.',
    run: async () => {
      const { doc, aria } = await fixture();
      const c = aria.canvas.getBoundingClientRect();
      let hit = 0; const missed = [];
      for (const item of aria.items.values()) {
        if (!item.visible) continue;
        const x = c.x + item.rect[0] + item.rect[2] / 2, y = c.y + item.rect[1] + Math.min(item.rect[3] / 2, 8);
        if (y >= c.bottom) continue;
        if (doc.elementFromPoint(x, y) === item.el) hit++; else missed.push(item.label);
      }
      if (missed.length) throw new Error(`not hit: ${missed.join(', ')}`);
      return `${hit} of ${hit} visible widgets`;
    },
  },
  {
    name: 'Each node has the role, name and state of its widget',
    why: 'The element type gives the role. computedRole and computedName are read where the browser has them.',
    run: async () => {
      const { aria } = await fixture();
      const out = [];
      for (const name of ['Title', 'Autosave', 'Volume', 'Save', 'Status', 'Advanced']) {
        const { el } = need(aria, name);
        const role = el.computedRole, label = el.computedName;
        const tag = `<${el.localName}${el.type && el.localName === 'input' ? ` type=${el.type}` : ''}${el.getAttribute('role') ? ` role=${el.getAttribute('role')}` : ''}>`;
        const state = el.type === 'checkbox' ? ` checked=${el.checked}` : el.type === 'range' ? ` value=${el.value} valuetext="${el.getAttribute('aria-valuetext')}"` : el.hasAttribute('aria-expanded') ? ` expanded=${el.getAttribute('aria-expanded')}` : '';
        if (role !== undefined) out.push(`${role} "${label}"${state}`);
        else out.push(`${tag} "${el.getAttribute('aria-label') ?? el.textContent}"${state}`);
        if (!(el.getAttribute('aria-label') ?? el.textContent)) throw new Error(`${name} has no name`);
      }
      return `${out.join('; ')}${need(aria, 'Save').el.computedRole === undefined ? '. computedRole is not exposed in this browser, so the element types are listed' : ''}`;
    },
  },
  {
    name: 'click() on the button node makes ImGui::Button() return true',
    why: 'A click with an empty pointerType is what Enter, Space and assistive technology produce. The page sets ImGui\'s nav activation id for one frame.',
    run: async () => {
      const { aria } = await fixture();
      const status = need(aria, 'Status').el, before = status.textContent;
      need(aria, 'Save').el.click();
      if (!await until(() => status.textContent !== before)) throw new Error('the status text did not change');
      return `the role="status" node changed from "${before}" to "${status.textContent}"`;
    },
  },
  {
    name: 'click() on the checkbox node toggles the ImGui checkbox',
    why: 'The node\'s checked state is written to the bool that ImGui::Checkbox() draws.',
    run: async () => {
      const { aria } = await fixture();
      const item = need(aria, 'Autosave'), before = item.checked;
      item.el.click();
      if (!await until(() => item.checked !== before)) throw new Error('ImGui still reports the old value');
      return `ImGui reported checked=${before}, then checked=${item.checked}; the node has checked=${item.el.checked}`;
    },
  },
  {
    name: 'An input event on the range node sets the ImGui slider',
    why: 'Arrow keys on the focused node, and a screen reader\'s increment, change the node and fire input.',
    run: async () => {
      const { win, aria } = await fixture();
      const item = need(aria, 'Volume');
      item.el.value = '73';
      item.el.dispatchEvent(new win.Event('input', { bubbles: true }));
      if (!await until(() => item.value === 73)) throw new Error(`ImGui reports ${item.value}`);
      return `ImGui reports ${item.value} and formatted it as "${item.text}", which is the node's aria-valuetext "${item.el.getAttribute('aria-valuetext')}"`;
    },
  },
  {
    name: 'A press on the ImGui slider and checkbox updates their nodes',
    why: 'ImGui to DOM: the pointer goes to ImGui only, and A11y() reports the new state on the next frame.',
    run: async () => {
      const { aria, module } = await fixture();
      const slider = need(aria, 'Volume'), box = need(aria, 'Autosave');
      const press = async (x, y) => { module._ui_pointer(x, y, -1); await sleep(60); module._ui_pointer(x, y, 1); await sleep(60); module._ui_pointer(x, y, 0); await sleep(60); module._ui_pointer(-1e4, -1e4, -1); };
      const was = box.el.checked;
      await press(slider.rect[0] + slider.rect[2] * 0.25, slider.rect[1] + slider.rect[3] / 2);
      if (!await until(() => Number(slider.el.value) < 40)) throw new Error(`the node's value is ${slider.el.value}`);
      await press(box.rect[0] + 12, box.rect[1] + box.rect[3] / 2);
      if (!await until(() => box.el.checked !== was)) throw new Error('the node\'s checked did not change');
      return `a press at a quarter of the slider: node value ${slider.el.value}, aria-valuetext "${slider.el.getAttribute('aria-valuetext')}"; a press on the checkbox: node checked ${was} to ${box.el.checked}`;
    },
  },
  {
    name: 'Text typed in the text node goes into the ImGui::InputText() buffer',
    why: 'The node takes the typing. ImGui draws the buffer, and the caret at the node\'s selection.',
    run: async () => {
      const { win, aria } = await fixture();
      const item = need(aria, 'Title');
      item.el.value = 'Budget é 東京';
      item.el.dispatchEvent(new win.Event('input', { bubbles: true }));
      if (!await until(() => item.text === 'Budget é 東京')) throw new Error(`ImGui's buffer holds "${item.text}"`);
      item.el.value = 'Budget 2027';
      item.el.dispatchEvent(new win.Event('input', { bubbles: true }));
      await until(() => item.text === 'Budget 2027' && item.spaced === 'Budget 2027');
      return `ImGui's buffer held "Budget é 東京", then "${item.text}". ImGui measures that text ${round(item.value)} px wide; the node's letter spacing was set to ${round(item.spacing)} px so its text is as wide`;
    },
  },
  {
    name: 'DOM focus on a node becomes ImGui\'s focused item',
    why: 'focus() inside the fixture frame. ImGui draws its ring when the browser matches :focus-visible on the node.',
    run: async () => {
      const { doc, aria, module } = await fixture();
      const item = need(aria, 'Save');
      item.el.focus({ preventScroll: true });
      if (doc.activeElement !== item.el) throw new Error('the node did not take focus');
      if (!await until(() => module._ui_nav_id() === item.id)) throw new Error('ImGui\'s NavId is another item');
      await sleep(100);
      const visible = item.el.matches(':focus-visible'), ring = !!module._ui_nav_ring();
      if (visible !== ring) throw new Error(`:focus-visible is ${visible} and ImGui's ring is ${ring ? 'on' : 'off'}`);
      item.el.blur();
      await until(() => !module._ui_nav_ring());
      return `ImGui's NavId is the Save button. :focus-visible ${visible}, ImGui ring ${ring ? 'drawn' : 'not drawn'}; after blur the ring is ${module._ui_nav_ring() ? 'still drawn' : 'off'}`;
    },
  },
  {
    name: 'Focusing a node whose widget is scrolled out makes ImGui scroll to it',
    why: 'A widget outside the window\'s clip rectangle keeps its node, so Tab and a screen reader can reach it.',
    run: async () => {
      const { doc, aria } = await fixture();
      const item = need(aria, 'Surveys');
      const c = aria.canvas.getBoundingClientRect();
      const before = item.rect.map(round), wasVisible = item.visible;
      const inClip = () => item.rect[1] >= item.clip[1] - 1 && item.rect[1] + item.rect[3] <= item.clip[1] + item.clip[3] + 1;
      item.el.focus({ preventScroll: true });
      if (!await until(inClip)) throw new Error(`the widget is at y ${round(item.rect[1])}, outside the window`);
      await sleep(150);
      const hit = doc.elementFromPoint(c.x + item.rect[0] + 10, c.y + item.rect[1] + 10) === item.el;
      const title = need(aria, 'Title');
      const detail = `Surveys was at y ${before[1]} (${wasVisible ? 'partly in view' : 'out of view'}) and is at y ${round(item.rect[1])}, ${hit ? 'hit by elementFromPoint()' : 'not hit'}. Title is now at y ${round(title.rect[1])} and getBoundingClientRect() says ${round(boxOf(aria, title.el)[1])}`;
      title.el.focus({ preventScroll: true });
      await until(() => title.visible && title.rect[1] > 0);
      title.el.blur();
      if (!hit) throw new Error(detail);
      return detail;
    },
  },
  {
    name: 'The window\'s clip rectangle cuts the hit box of a widget that is half scrolled out',
    why: 'canvasClip is the ImGui window\'s clip rectangle. The part of the row under the title bar must not be hit.',
    run: async () => {
      const { doc, aria, module } = await fixture();
      const c = aria.canvas.getBoundingClientRect();
      const mid = need(aria, 'Volume');
      module._ui_pointer(mid.rect[0] + 300, mid.rect[1] + 10, -1);
      let found = null, scrolled = 0;
      const straddles = (item) => item.rect[1] < item.clip[1] - 6 && item.rect[1] + item.rect[3] > item.clip[1] + 6 && item.rect[1] > 2;
      for (let i = 0; i < 40 && !found; i++) {
        found = [...aria.items.values()].find(straddles);
        if (found) break;
        module._ui_wheel(-0.1); scrolled += 0.1;
        await sleep(120);
      }
      let detail;
      if (found) {
        const x = c.x + found.rect[0] + 10;
        const above = doc.elementFromPoint(x, c.y + found.rect[1] + 3), below = doc.elementFromPoint(x, c.y + found.clip[1] + 3);
        const box = boxOf(aria, found.el);
        detail = `${found.label}: row at y ${round(found.rect[1])} to ${round(found.rect[1] + found.rect[3])}, clip starts at ${round(found.clip[1])}. Above the clip edge the point hits ${above === found.el ? 'the node' : `<${above?.localName}>`}; below it hits ${below === found.el ? 'the node' : `<${below?.localName}>`}. getBoundingClientRect() still reports the whole row (y ${round(box[1])}, height ${round(box[3])})`;
        module._ui_wheel(scrolled + 2);
        module._ui_pointer(-1e4, -1e4, -1);
        await sleep(300);
        if (above === found.el) throw new Error(detail);
        if (below !== found.el) throw new Error(detail);
        return detail;
      }
      module._ui_wheel(scrolled + 2);
      module._ui_pointer(-1e4, -1e4, -1);
      throw new Error('no row could be scrolled half under the title bar');
    },
  },
  {
    name: 'A widget that ImGui stops submitting loses its node',
    why: 'The "Advanced" header is opened and closed. Its two widgets get nodes in order, then lose them.',
    run: async () => {
      const { aria } = await fixture();
      const header = need(aria, 'Advanced');
      const closed = labels(aria).length;
      header.el.click();
      if (!await until(() => aria.item('Reset'))) throw new Error('no node for the Reset button appeared');
      const order = labels(aria), at = order.indexOf('Advanced');
      const expanded = header.el.getAttribute('aria-expanded');
      if (order[at + 1] !== 'Spell check' || order[at + 2] !== 'Reset') throw new Error(`order is ${order.join(', ')}`);
      header.el.click();
      if (!await until(() => !aria.item('Reset'))) throw new Error('the Reset node stayed');
      return `closed: ${closed} nodes. Open: ${order.length} nodes, aria-expanded="${expanded}", with Spell check and Reset after Advanced in DOM order. Closed again: ${labels(aria).length} nodes, aria-expanded="${header.el.getAttribute('aria-expanded')}"`;
    },
  },
  {
    name: 'With nothing happening ImGui draws no frames and moves no node',
    why: 'The frame function returns early unless an event, a change from the DOM or a paint asked for frames.',
    run: async () => {
      const { win, aria } = await fixture();
      await sleep(600);
      const frames = aria.stats.frames, places = aria.stats.places;
      for (let i = 0; i < 30; i++) await new Promise((r) => win.requestAnimationFrame(r));
      if (aria.stats.frames !== frames) throw new Error(`${aria.stats.frames - frames} frames were drawn`);
      return `0 ImGui frames and ${aria.stats.places - places} geometry calls during 30 animation frames`;
    },
  },
  {
    name: 'Comparison: the same nodes as fallback content of a plain canvas have no geometry',
    why: 'A canvas without layoutsubtree. Its children are in the accessibility tree and can take focus, but have no boxes.',
    run: async () => {
      const { doc } = await fixture();
      const plain = doc.createElement('canvas');
      plain.width = 200; plain.height = 60;
      plain.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:60px;opacity:0';
      plain.innerHTML = '<button type="button">Save</button><input type="checkbox" aria-label="Autosave" checked><input type="range" aria-label="Volume" value="40"><input type="text" aria-label="Title" value="x">';
      doc.body.append(plain);
      try {
        await sleep(100);
        const button = plain.firstChild, r = button.getBoundingClientRect();
        const hit = doc.elementFromPoint(20, 20);
        button.focus({ preventScroll: true });
        const focused = doc.activeElement === button;
        button.blur();
        const role = button.computedRole;
        return `button box ${r.width}×${r.height} at ${r.x}, ${r.y}; getClientRects() has ${button.getClientRects().length} entries; elementFromPoint() over the canvas gives <${hit?.localName}>; focus() ${focused ? 'works' : 'does nothing'}${role !== undefined ? `; computedRole "${role}", computedName "${button.computedName}"` : ''}`;
      } finally { plain.remove(); }
    },
  },
  {
    name: 'The focused text node can be drawn into the ImGui frame with texElementSubImage2D()',
    why: 'Route (c). Only while the node has focus, so the browser\'s own caret, selection and IME marks are the pixels.',
    run: async () => {
      const { aria, module } = await fixture();
      const item = need(aria, 'Title');
      const before = aria.stats.uploads;
      module._aria_draw_focused(1);
      item.el.focus({ preventScroll: true });
      const ok = await until(() => aria.stats.uploads > before, 3000);
      const during = aria.stats.uploads - before;
      item.el.blur();
      await sleep(300);
      const after = aria.stats.uploads;
      item.el.value = 'changed after blur';
      await sleep(300);
      module._aria_draw_focused(0);
      if (!ok) throw new Error(`no upload happened. ${aria.stats.error}`);
      if (aria.stats.uploads !== after) throw new Error('uploads went on after blur');
      return `${before} uploads before focus, ${during} while focused, 0 after blur`;
    },
  },
];

runTests($('results'), tests).then(() => { frame?.holder.remove(); frame = null; });
