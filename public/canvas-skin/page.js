import { banner, runTests, supported, testStage, inkFraction, stillDrawn } from '/shared/support.js';
import { CanvasSkin } from '/lib/canvas-skin.js';
banner();

const stage = document.getElementById('stage');
const nestStage = document.getElementById('nestStage');
const bar = document.getElementById('skinBar');
const status = document.getElementById('status');

// #region wrap
// Every heading, paragraph, image, field, control, table and button gets a <canvas-skin> round it.
CanvasSkin.wrap(stage);
for (const tile of document.querySelectorAll('#tiles > div')) CanvasSkin.wrap(tile);

// One button per registered skin. The tap position is where the change starts.
for (const [name, skin] of Object.entries(CanvasSkin.skins)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = skin.label;
  button.dataset.skin = name;
  button.setAttribute('aria-pressed', String(stage.getAttribute('skin') === name));
  button.addEventListener('click', (event) => {
    // A click from the keyboard has no position: start from the button.
    const box = button.getBoundingClientRect();
    const x = event.clientX || box.left + box.width / 2, y = event.clientY || box.top;
    CanvasSkin.apply(stage, name, { x, y });
    CanvasSkin.apply(nestStage, name, { x, y });
    for (const b of bar.children) b.setAttribute('aria-pressed', String(b === button));
    showSettings(name);
    report();
  });
  bar.append(button);
}
// #endregion wrap

// The glass settings are on the page only while the form is in the glass skin.
function showSettings(name) {
  document.getElementById('glassSet').hidden = name !== 'glass';
  document.getElementById('glassNote').hidden = name !== 'glass';
}
showSettings(stage.getAttribute('skin'));

// #region glass-controls
// The glass shader's inputs. Every glass element reads the same settings object when it paints.
const glassSettings = CanvasSkin.skins.glass.settings, glassDefaults = { ...glassSettings };
const glassUnits = { light: '°', rim: ' px', thickness: ' px', frost: ' px' };
function showGlass() {
  for (const input of document.querySelectorAll('#glassSet input')) {
    const key = input.dataset.key;
    input.value = glassSettings[key];
    input.nextElementSibling.textContent = `${glassSettings[key]}${glassUnits[key] ?? ''}`;
  }
}
document.getElementById('glassSet').addEventListener('input', (event) => {
  const key = event.target.dataset.key;
  if (!key) return;
  glassSettings[key] = Number(event.target.value);
  showGlass();
  CanvasSkin.redraw();
});
// A mode is a set of values for the same settings.
const glassModes = {
  regular: {},
  clear: { frost: 0, tint: 0.35, specular: 0.8 },
  frosted: { frost: 6, tint: 1.3, thickness: 14, dispersion: 0.02 },
  lens: { rim: 26, thickness: 52, ior: 1.7, frost: 0.4, tint: 0.5 },
  prism: { rim: 20, thickness: 40, ior: 1.6, dispersion: 0.28, frost: 0.3, tint: 0.4, specular: 1.4 },
};
function glassMode(name) {
  Object.assign(glassSettings, glassDefaults, glassModes[name]);
  for (const b of document.querySelectorAll('#glassModes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === name));
  showGlass();
  CanvasSkin.redraw();
}
document.getElementById('glassModes').addEventListener('click', (event) => { const mode = event.target.dataset?.mode; if (mode) glassMode(mode); });
document.getElementById('glassReset').addEventListener('click', () => glassMode('regular'));
showGlass();
// #endregion glass-controls

// The form does something, to show that the controls are the page's own.
const people = document.getElementById('fPeople'), peopleOut = document.getElementById('fPeopleOut'), result = document.getElementById('fResult');
people.addEventListener('input', () => { peopleOut.textContent = people.value; });
document.getElementById('fBook').addEventListener('click', () => {
  const seat = stage.querySelector('input[name="seat"]:checked')?.labels?.[0]?.textContent ?? 'Deck';
  result.textContent = `Booked: ${document.getElementById('fName').value || 'no name'}, ${people.value} on the ${document.getElementById('fSail').value.slice(0, 5)}, ${seat.toLowerCase()}${document.getElementById('fReturn').checked ? ', return' : ''}.`;
});
document.getElementById('fSave').addEventListener('click', () => { result.textContent = 'Saved for later.'; });
let shown = 0;
document.getElementById('nestButton').addEventListener('click', () => { document.getElementById('nestOut').textContent = `Shown ${++shown} time${shown === 1 ? '' : 's'}.`; });

// The line under the form: what is on the page now, and anything that fell back to plain HTML.
const fallen = [];
function report() {
  const all = [...document.querySelectorAll('canvas-skin')];
  if (!supported) { status.textContent = `This browser has no HTML-in-canvas API. The ${all.length} wrapped elements are shown as plain HTML with each skin's font and colours.`; return; }
  const sized = all.filter((w) => w.canvas?.width > 0).length, plain = all.filter((w) => w.plain).length;
  const memory = window.__gfx?.memory?.(), route = CanvasSkin.glassRoute;
  status.textContent = `Skin: ${CanvasSkin.skins[stage.getAttribute('skin')]?.label}. ${all.length} wrapped elements, ${sized} canvases with pixels now (the rest are off screen), ${memory ? `${(memory.bytes / 1048576).toFixed(1)} MB of canvas memory by the page's estimate` : 'no memory estimate'}. ${route === 'webgl' ? 'The shader skins (glass, metal, sea, space) run in one shared WebGL context' : route === 'not started' ? 'No shader skin has painted yet, so there is no WebGL context' : `The shader skins are drawn in 2D: ${route}`}.`
    + (plain ? ` ${plain} shown as plain HTML: ${fallen.at(-1) ?? ''}` : '');
}
document.addEventListener('canvas-skin-plain', (e) => { fallen.push(e.detail.why); report(); });
document.addEventListener('canvas-skin-route', report);
setTimeout(report, 600);
let scrollTimer = 0;
addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(report, 400); }, { passive: true });

// ---------------------------------------------------------------- live checks
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = () => { if (!supported) throw new Error('this browser has no HTML-in-canvas API'); };
const B = CanvasSkin.bleed;

// A skin root on the test stage, with wrappers made from `html`.
async function mount(html, skin = 'gel', width = 300) {
  need();
  const root = document.createElement('div');
  root.setAttribute('skin', skin);
  root.style.cssText = `flex:none;width:${width}px;padding:16px;font:16px/2.2 system-ui,sans-serif`;
  root.innerHTML = html;
  testStage().append(root);
  CanvasSkin.wrap(root);
  const wrappers = [...root.querySelectorAll('canvas-skin')];
  await drawn(wrappers);
  return { root, wrappers, first: wrappers[0] };
}
async function drawn(wrappers) {
  for (let i = 0; i < 80 && wrappers.some((w) => !w.paints); i++) await sleep(25);
  await sleep(160);
  const never = wrappers.filter((w) => !w.paints);
  if (never.length) throw new Error(`${never.length} of ${wrappers.length} wrappers got no paint event`);
}
// A copy of a wrapper's canvas in a plain canvas, which is the one that is read.
function copyOf(wrapper) {
  const copy = document.createElement('canvas');
  copy.width = wrapper.canvas.width; copy.height = wrapper.canvas.height;
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(wrapper.canvas, 0, 0);
  return ctx;
}
// The pixel at x, y in CSS pixels from the element's top left corner.
function at(wrapper, x, y) {
  const k = wrapper.canvas.width / (wrapper.offsetWidth + 2 * B);
  return [...copyOf(wrapper).getImageData(Math.round((x + B) * k), Math.round((y + B) * k), 1, 1).data];
}
const sum = (wrapper) => { const d = copyOf(wrapper).getImageData(0, 0, wrapper.canvas.width, wrapper.canvas.height).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3]; return s; };
const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

const tests = [
  {
    name: 'A wrapped button is drawn by its own canvas',
    why: 'The button is slotted into a drawable <div> inside a canvas in the wrapper\'s shadow root. The gel skin draws a body and then the button\'s own picture.',
    run: async () => {
      const { first } = await mount('<button class="primary">Save</button>');
      const ink = inkFraction(copyOf(first));
      if (ink < 0.2) throw new Error(`only ${(ink * 100).toFixed(1)}% of the canvas has pixels`);
      return `${(ink * 100).toFixed(0)}% of a ${first.canvas.width} by ${first.canvas.height} canvas has pixels, after ${first.paints} paint events`;
    },
  },
  {
    name: 'The wrapper takes the same room as the element',
    why: 'The canvas is larger than the element, but it is positioned outside the wrapper\'s box. The wrapper\'s box and the element\'s box should be the same rectangle, for an inline button and for a block field.',
    run: async () => {
      const { wrappers } = await mount('<button>Save for later</button><input value="Ada">');
      const out = [];
      for (const w of wrappers) {
        const a = w.getBoundingClientRect(), b = w.target.getBoundingClientRect();
        const off = Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
        if (off > 1) throw new Error(`${w.target.localName}: wrapper ${a.width.toFixed(1)} by ${a.height.toFixed(1)} at ${a.left.toFixed(1)}, ${a.top.toFixed(1)}; element ${b.width.toFixed(1)} by ${b.height.toFixed(1)} at ${b.left.toFixed(1)}, ${b.top.toFixed(1)}`);
        out.push(`${w.target.localName} ${Math.round(b.width)} by ${Math.round(b.height)}, canvas ${w.canvas.clientWidth} by ${w.canvas.clientHeight}`);
      }
      return out.join('; ');
    },
  },
  {
    name: 'A point on the element finds the element, and a point in the canvas\'s margin does not find the canvas',
    why: 'The canvas has pointer-events: none and the slotted element has pointer-events: auto. If the canvas took hits, its 14 px margin would cover the edge of whatever is next to it.',
    run: async () => {
      const { first, root } = await mount('<button>Save</button>');
      const button = first.target, [x, y] = centre(button), box = button.getBoundingClientRect();
      const on = document.elementFromPoint(x, y), beside = document.elementFromPoint(box.right + 6, y);
      if (on !== button) throw new Error(`the centre of the button found <${on?.localName}>`);
      if (beside !== root) throw new Error(`6 px to the right of the button found <${beside?.localName}>, not the element under the canvas`);
      return 'the centre found the <button>; 6 px outside it, over the canvas, found the <div> under the canvas';
    },
  },
  {
    name: 'The glass shader bends the background, and a refractive index of 1 does not',
    why: 'The check draws a glass button with the index at 1 (air) and at 1.5, and compares the pixels of the rim. It fails if the shared WebGL context is not in use.',
    timeout: 8000,
    run: async () => {
      const keep = { ...glassSettings };
      try {
        Object.assign(glassSettings, { ior: 1, dispersion: 0, frost: 0, specular: 0 });
        const { first } = await mount('<button>Save for later</button>', 'glass');
        if (CanvasSkin.glassRoute !== 'webgl') throw new Error(`glass is drawn in 2D: ${CanvasSkin.glassRoute}`);
        const flat = sum(first);
        glassSettings.ior = 1.5; CanvasSkin.redraw(); await sleep(250);
        const bent = sum(first);
        glassSettings.dispersion = 0.2; CanvasSkin.redraw(); await sleep(250);
        const split = sum(first);
        if (flat === bent) throw new Error('the pixels are the same at index 1 and 1.5');
        if (bent === split) throw new Error('dispersion changed nothing');
        return 'drawn by the shader in the shared WebGL context; the pixels differ between index 1, index 1.5, and index 1.5 with dispersion 0.2';
      } finally { Object.assign(glassSettings, keep); CanvasSkin.redraw(); }
    },
  },
  {
    name: 'Changing the skin attribute on an ancestor redraws the wrapper',
    why: 'A wrapper follows the nearest ancestor with a skin attribute. One observer on the document sees the change.',
    timeout: 8000,
    run: async () => {
      const { first, root } = await mount('<button>Save</button>');
      const before = sum(first);
      root.setAttribute('skin', 'terminal');
      await sleep(1100);
      if (first.getAttribute('now') !== 'terminal') throw new Error(`the wrapper is still drawing "${first.getAttribute('now')}"`);
      const after = sum(first);
      if (after === before) throw new Error('the canvas has the same pixels after the change');
      return 'now="terminal" and the pixels changed';
    },
  },
  {
    name: 'CanvasSkin.apply() changes the nearest wrapper first',
    why: 'Each wrapper is given a delay in proportion to its distance from the point passed to apply().',
    timeout: 8000,
    run: async () => {
      const { wrappers, root } = await mount('<button>One</button><button>Two</button><button>Three</button>');
      const times = new Map(), t0 = performance.now();
      const seen = new MutationObserver((records) => { for (const r of records) if (!times.has(r.target)) times.set(r.target, performance.now() - t0); });
      for (const w of wrappers) seen.observe(w, { attributes: true, attributeFilter: ['now'] });
      const [x, y] = centre(wrappers[0]);
      CanvasSkin.apply(root, 'pencil', { x, y, speed: 0.3 });
      await sleep(900);
      seen.disconnect();
      const ms = wrappers.map((w) => times.get(w));
      if (ms.some((t) => t === undefined)) throw new Error(`not every wrapper changed: ${ms.join(', ')}`);
      if (!(ms[0] <= ms[1] && ms[1] < ms[2])) throw new Error(`order was ${ms.map((t) => t.toFixed(0)).join(', ')} ms`);
      return `changed at ${ms.map((t) => t.toFixed(0)).join(', ')} ms, at 0.3 px per ms`;
    },
  },
  {
    name: 'A checkbox that the skin draws from its state toggles and is redrawn',
    why: 'The gel skin never draws the checkbox\'s own picture. It draws a box from `checked`. The native checkbox is drawn only inside an empty clip, to put its hit region in place.',
    run: async () => {
      const { first } = await mount('<input type="checkbox" aria-label="Return">');
      const box = first.target, [x, y] = centre(box);
      if (document.elementFromPoint(x, y) !== box) throw new Error('the checkbox is not found at its place');
      const off = at(first, 5, 13);
      box.click();
      await sleep(500);
      const on = at(first, 5, 13);
      if (!box.checked) throw new Error('click() did not check it');
      if (Math.abs(on[0] - off[0]) + Math.abs(on[2] - off[2]) < 40) throw new Error(`the body is rgb ${off.slice(0, 3)} unchecked and ${on.slice(0, 3)} checked`);
      return `unchecked rgb ${off.slice(0, 3).join(' ')}, checked rgb ${on.slice(0, 3).join(' ')}`;
    },
  },
  {
    name: 'A range drawn by the skin shows its value',
    why: 'The terminal skin draws a block at the value. The check sets the value, sends an input event as a drag would, and looks for the block.',
    run: async () => {
      const { first } = await mount('<input type="range" value="90" aria-label="Level">', 'terminal');
      const range = first.target, w = first.offsetWidth;
      const x90 = 6 + 0.9 * (w - 12), x10 = 6 + 0.1 * (w - 12);
      const before = at(first, x10, 5)[3];
      range.value = 10; range.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      const after = at(first, x10, 5)[3], left = at(first, x90, 5)[3];
      if (!(after > 150 && before < 100 && left < 100)) throw new Error(`alpha at the 10% place went ${before} to ${after}; at the 90% place it is now ${left}`);
      return `alpha at the 10% place went ${before} to ${after}, and the 90% place is ${left}`;
    },
  },
  {
    name: 'The wrapped controls keep their form, label, role and name',
    why: 'The elements are slotted, not moved into a shadow tree, so the page\'s own form and labels still reach them.',
    run: async () => {
      const { root } = await mount('<form><label for="ckName">Name</label><input id="ckName" name="who" value="Ada"><input type="checkbox" id="ckBox" name="ok"><label for="ckBox">Agree</label><button class="primary">Send</button></form>');
      const form = root.querySelector('form'), box = root.querySelector('#ckBox'), button = root.querySelector('button');
      if (form.elements.length !== 3) throw new Error(`the form has ${form.elements.length} controls, expected 3`);
      root.querySelector('label[for="ckBox"]').click();
      if (!box.checked) throw new Error('a click on the label did not check the box');
      const data = [...new FormData(form).entries()].map(([k, v]) => `${k}=${v}`).join('&');
      const role = 'computedRole' in button ? `, role "${button.computedRole}", name "${button.computedName}"` : ', computedRole is not available';
      if ('computedRole' in button && (button.computedRole !== 'button' || button.computedName !== 'Send')) throw new Error(`the button has role "${button.computedRole}" and name "${button.computedName}"`);
      return `form data ${data}; the label checks the box${role}`;
    },
  },
  {
    name: 'After a lost context the element is plain HTML',
    why: 'The check sends the wrapper\'s canvas a contextlost event. The wrapper should move the element out of the canvas, set the plain attribute and stop drawing.',
    run: async () => {
      const { first } = await mount('<button>Save</button>', 'pencil');
      let why = '';
      first.addEventListener('canvas-skin-plain', (e) => { why = e.detail.why; });
      first.canvas.dispatchEvent(new Event('contextlost'));
      await sleep(250);
      const button = first.target, [x, y] = centre(button), box = button.getBoundingClientRect();
      if (!first.plain || !first.hasAttribute('plain')) throw new Error('the wrapper did not switch to plain HTML');
      if (!box.width || document.elementFromPoint(x, y) !== button) throw new Error('the button is not in the page at its place');
      if (getComputedStyle(first.canvas).display !== 'none') throw new Error('the canvas is still shown');
      return `"${why}" The button is ${Math.round(box.width)} by ${Math.round(box.height)} in the page, with a CSS border in the skin's colour`;
    },
  },
  {
    name: 'A wrapper far from the screen has a canvas of 0 by 0',
    why: 'Canvases are kept only for the elements within one screen of the window. The check puts a wrapper 5,000 px above the window, then on the test stage.',
    timeout: 8000,
    run: async () => {
      need();
      const far = document.createElement('div');
      far.setAttribute('skin', 'gel');
      far.style.cssText = 'position:fixed;left:8px;top:-5000px;width:200px';
      far.innerHTML = '<canvas-skin><button>Far away</button></canvas-skin>';
      document.body.append(far);
      try {
        const w = far.firstElementChild;
        await sleep(500);
        const away = `${w.canvas.width} by ${w.canvas.height}`;
        if (w.canvas.width !== 0) throw new Error(`the canvas is ${away} while 5,000 px away`);
        testStage().append(far); far.style.position = 'static';
        await sleep(500);
        if (!w.canvas.width || !w.paints) throw new Error(`back on screen the canvas is ${w.canvas.width} wide after ${w.paints} paint events`);
        return `${away} while away, ${w.canvas.width} by ${w.canvas.height} on screen`;
      } finally { far.remove(); }
    },
  },
  {
    name: 'Thirty wrappers: memory by the page\'s estimate',
    why: 'Each wrapper has one 2D context and no WebGL context. The number is the guard\'s estimate (width by height by 4 bytes), not a measurement of the GPU.',
    timeout: 10000,
    run: async () => {
      const before = window.__gfx?.memory?.().bytes ?? 0;
      const { wrappers } = await mount('<div style="display:flex;flex-wrap:wrap;gap:4px">' + '<button>Go</button>'.repeat(30) + '</div>', 'gel', 340);
      const after = window.__gfx?.memory?.().bytes;
      if (after === undefined) return `${wrappers.length} wrappers drew; this page has no memory estimate`;
      const each = (after - before) / wrappers.length;
      return `${wrappers.length} wrappers drew, ${((after - before) / 1048576).toFixed(2)} MB together, ${(each / 1024).toFixed(0)} KB each at device scale ${devicePixelRatio}`;
    },
  },
  {
    name: 'A wrapper inside a wrapper: the inner button is in the outer picture and takes a hit',
    why: 'The inner wrapper\'s canvas is part of the outer wrapper\'s slotted content, so the outer canvas draws a canvas that draws a button.',
    run: async () => {
      need();
      const root = document.createElement('div');
      root.setAttribute('skin', 'gel');
      root.style.cssText = 'flex:none;width:260px;padding:16px;font:16px/1.4 system-ui,sans-serif';
      root.innerHTML = '<canvas-skin kind="card"><div><canvas-skin><button class="primary">Inner</button></canvas-skin></div></canvas-skin>';
      testStage().append(root);
      const outer = root.firstElementChild, inner = outer.querySelector('canvas-skin'), button = inner.target;
      await drawn([outer, inner]);
      const [x, y] = centre(button);
      if (document.elementFromPoint(x, y) !== button) throw new Error(`the centre of the inner button found <${document.elementFromPoint(x, y)?.localName}>`);
      const o = outer.getBoundingClientRect(), b = button.getBoundingClientRect();
      // The gel button's blue body, 8 px in from the button's left edge at mid height, read from the OUTER canvas.
      const p = at(outer, b.left - o.left + 8, b.top - o.top + b.height / 2);
      if (!(p[2] > 150 && p[2] > p[0] + 40)) throw new Error(`the outer canvas has rgba ${p.join(' ')} where the inner button is, not the blue body`);
      return `the outer canvas has rgb ${p.slice(0, 3).join(' ')} where the inner button's body is, and the point finds the <button>`;
    },
  },
  stillDrawn(() => {
    // The wrappers on the page that are near the screen now. The others have no pixels by design.
    const near = [...document.querySelectorAll('main canvas-skin')].filter((w) => w.plain || w.canvas?.width > 0).slice(0, 4);
    if (!near.length) return [{ name: 'page wrappers', ink: async () => null, note: 'none is within one screen of the window' }];
    return near.map((w) => ({ name: `<${w.target.localName}>`, ink: async () => (w.plain ? null : inkFraction(copyOf(w))), note: 'shown as plain HTML' }));
  }),
];

runTests(document.getElementById('tests'), tests);
