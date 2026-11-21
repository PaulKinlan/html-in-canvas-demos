import { banner, runTests, supported, testStage } from '/shared/support.js';
banner();

// #region start
// A demo's script is loaded and started the first time its section comes near the screen.
const started = new Set();
const watch = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting || started.has(e.target.id)) continue;
    started.add(e.target.id);
    watch.unobserve(e.target);
    import(`./${e.target.id}.js`).then((m) => m.default()).catch((err) => console.error(e.target.id, err));
  }
}, { rootMargin: '100px 0px' });
if (supported) document.querySelectorAll('section.idea').forEach((s) => watch.observe(s));
// #endregion start

// A browser without the API does not render a canvas's children. Show them as plain HTML.
if (!supported) {
  Promise.all([import('./kit.js'), import('./mail.js')]).then(([kit, mail]) => {
    document.getElementById('mailFrame').srcdoc = mail.MESSAGES.order;
    for (const canvas of document.querySelectorAll('canvas.idea-canvas')) {
      const cards = canvas.id === 'widgetCanvas' ? () => [document.getElementById('dialCard'), document.getElementById('padCard')] : undefined;
      kit.plain(canvas, 'cannot draw its children in this browser', cards, false);
    }
  });
}

// ---------------------------------------------------------------- live checks
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = () => { if (!supported) throw new Error('this browser has no HTML-in-canvas API'); };

// A drawable canvas with a paint counter. paint(ctx, canvas, event) runs on every paint event.
function watchCanvas(canvas, paint) {
  const ctx = canvas.getContext('2d');
  const state = { canvas, ctx, paints: 0, error: null, changed: [] };
  canvas.addEventListener('paint', (event) => {
    state.paints++;
    state.changed.push([...(event.changedElements ?? [])]);
    ctx.reset();
    try { paint(ctx, canvas, event); state.error = null; } catch (e) { state.error = e; }
  });
  state.frame = async () => { const n = state.paints; canvas.requestPaint(); for (let i = 0; i < 80 && state.paints === n; i++) await sleep(25); await sleep(40); };
  // Draw until one paint ran without an error (an element has no picture before its first paint).
  state.settle = async () => {
    for (let i = 0; i < 12; i++) { await state.frame(); if (state.paints && !state.error) break; }
    await sleep(120);
    return state;
  };
  return state;
}
function makeCanvas(html, w, h) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable'); canvas.setAttribute('layoutsubtree', '');
  canvas.width = w; canvas.height = h;
  canvas.style.cssText = `display:block;flex:none;width:${w}px;height:${h}px`;
  canvas.innerHTML = html;
  return canvas;
}
// A fixture canvas on the test stage. setup(canvas) may prepare its children before the first paint.
async function rig(html, paint, { w = 240, h = 140, setup } = {}) {
  need();
  const canvas = makeCanvas(html, w, h);
  testStage().append(canvas);
  await setup?.(canvas);
  const state = await watchCanvas(canvas, paint).settle();
  if (state.error) throw state.error;
  return state;
}
// A fixture whose canvas is in a shadow root: host > #shadow > (shadowHTML with one canvas).
async function shadowRig(lightHTML, shadowHTML, paint) {
  need();
  const host = document.createElement('div');
  host.style.cssText = 'display:block;flex:none;width:240px;height:140px';
  host.innerHTML = lightHTML;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = shadowHTML;
  testStage().append(host);
  const canvas = root.querySelector('canvas');
  const state = watchCanvas(canvas, (ctx, c, e) => paint(ctx, root, host, e));
  state.host = host; state.root = root;
  await state.settle();
  return state;
}
// Pixels are read from a small copy made with drawImage(), never from the drawable canvas itself.
const copy = document.createElement('canvas');
const read = (canvas, x, y, w = 1, h = 1) => {
  copy.width = w; copy.height = h;
  const c2 = copy.getContext('2d', { willReadFrequently: true });   // a plain canvas, kept in ordinary memory
  c2.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c2.getImageData(0, 0, w, h).data;
};
const rgba = (canvas, x, y) => [...read(canvas, x, y)].join(',');
const draw = (ctx, el, x = 0, y = 0) => ctx.drawElementImage(el, x, y, el.offsetWidth, el.offsetHeight);
// Change something, wait, and report the paint events that followed with no requestPaint() on that canvas.
const after = async (state, change, ms = 400) => {
  const n = state.paints;
  await change();
  await sleep(ms);
  return { count: state.paints - n, changed: state.changed.slice(n).flat() };
};
const names = (list) => [...new Set(list.map((el) => `<${el.localName}>`))].join(', ') || 'none';
const at = (canvas, x, y) => { const r = canvas.getBoundingClientRect(); return document.elementFromPoint(r.left + x, r.top + y); };
const label = (el) => (el ? `<${el.localName}${el.id ? ` id="${el.id}"` : ''}>` : 'nothing');

// An outer canvas that draws one inner drawable canvas, sheared and enlarged. The inner canvas draws a card.
const INNER = '<canvas id="in" drawable content="drawable" layoutsubtree width="120" height="80" style="display:block;width:120px;height:80px"><div id="card" drawable style="width:80px;height:40px;background:#00aa55"><button id="go" type="button" style="display:block;width:60px;height:30px;margin:0;position:relative;left:5px;top:5px;padding:0">Go</button></div></canvas>';
async function nest() {
  let inner;
  const outer = await rig(INNER, (ctx, c) => {
    ctx.translate(40, 20); ctx.transform(1, 0.2, 0, 1, 0, 0); ctx.scale(1.25, 1.25);
    draw(ctx, c.querySelector('#in'));
  }, {
    setup: async (c) => {
      const el = c.querySelector('#in');
      inner = watchCanvas(el, (ctx) => { ctx.fillStyle = '#ffcc00'; ctx.fillRect(0, 0, 120, 80); draw(ctx, el.querySelector('#card'), 20, 20); });
      await inner.settle();
    },
  });
  await inner.settle(); await outer.frame();
  return { outer, inner };
}
const frameDoc = (extra = '') => `<!doctype html><style>html,body{margin:0}${extra}</style><div style="height:60px;background:#00aa00"></div><a id="l" href="#x" style="display:block;height:40px;background:#ff00ff">link</a><div style="height:500px;background:#0000ff"></div>`;
const loaded = (frame) => new Promise((r) => frame.addEventListener('load', r, { once: true }));

runTests(document.getElementById('tests'), [
  {
    name: 'A draw in an inner canvas raises paint on the outer canvas, with the inner canvas in changedElements',
    why: 'The room has no listener on its widgets. It depends on the browser raising paint on the outer canvas when an inner canvas has drawn. The check asks only the inner canvas for a paint.',
    run: async () => {
      const { outer, inner } = await nest();
      const r = await after(outer, () => inner.canvas.requestPaint());
      if (!r.count) throw new Error('no paint on the outer canvas after the inner canvas drew');
      if (!r.changed.includes(inner.canvas)) throw new Error(`changedElements held ${names(r.changed)}`);
      const yellow = rgba(outer.canvas, 46, 26 + 2);
      return `${r.count} paint event${r.count === 1 ? '' : 's'} on the outer canvas, changedElements: ${names(r.changed)}. A pixel of the inner canvas's own fill, read in the outer canvas: ${yellow}.`;
    },
  },
  {
    name: 'A change to an element inside the inner canvas raises paint on both canvases',
    why: 'Pressing a widget button changes the card, two canvases down. The check changes the card\'s background with no requestPaint() anywhere.',
    run: async () => {
      const { outer, inner } = await nest();
      const n = inner.paints;
      const r = await after(outer, () => { inner.canvas.querySelector('#card').style.background = '#cc0000'; });
      if (inner.paints === n) throw new Error('the inner canvas got no paint event');
      if (!r.count) throw new Error('the outer canvas got no paint event');
      // The card is at 20,20 in the inner canvas. Its pixel 70,2 is at (40 + 90 * 1.25, 20 + 0.2 * 112.5 + 22 * 1.25).
      const px = rgba(outer.canvas, 152, 70);
      if (px !== '204,0,0,255') throw new Error(`the outer canvas shows ${px} where the card is`);
      return `Inner canvas: ${inner.paints - n} paint event${inner.paints - n === 1 ? '' : 's'}. Outer canvas: ${r.count}. The outer canvas shows the new colour (${px}).`;
    },
  },
  {
    name: 'A button two canvases down is found where it is drawn',
    why: 'The button is moved by the inner canvas\'s draw and then sheared and enlarged by the outer canvas\'s draw. elementFromPoint() is asked at the place where both transforms put its middle.',
    run: async () => {
      const { outer } = await nest();
      // Button middle in the card: 35, 20. In the inner canvas: 55, 40. Enlarged: 68.75, 50. Sheared: y + 0.2 x. Moved: + 40, 20.
      const hit = at(outer.canvas, 108.75, 83.75), miss = at(outer.canvas, 35 + 40, 20 + 20);
      if (hit?.id !== 'go') throw new Error(`found ${label(hit)} at the drawn place`);
      const r = hit.getBoundingClientRect(), c = outer.canvas.getBoundingClientRect();
      return `elementFromPoint() at the drawn place: ${label(hit)}. At the place it would have with no transforms: ${label(miss)}. getBoundingClientRect() of the button: ${Math.round(r.left - c.left)}, ${Math.round(r.top - c.top)}, ${Math.round(r.width)} by ${Math.round(r.height)} in the outer canvas.`;
    },
  },
  {
    name: 'An inner canvas wider than the outer canvas is drawn whole',
    why: 'A drawable element nested in another drawable element is recorded clipped to the window (see /keycaps/). An inner canvas is a direct child of the outer canvas, so it should be whole. The inner canvas is 400 px wide in a 240 px outer canvas and is drawn 300 px to the left.',
    run: async () => {
      let inner;
      const outer = await rig('<canvas id="in" drawable content="drawable" layoutsubtree width="400" height="40" style="display:block;width:400px;height:40px"><div id="bar" drawable style="width:400px;height:20px;background:linear-gradient(90deg,#ff0000 0 50%,#0000ff 50% 100%)"></div></canvas>', (ctx, c) => draw(ctx, c.querySelector('#in'), -300, 10), {
        setup: async (c) => { const el = c.querySelector('#in'); inner = watchCanvas(el, (ctx) => draw(ctx, el.querySelector('#bar'), 0, 0)); await inner.settle(); },
      });
      await inner.settle(); await outer.frame();
      const px = rgba(outer.canvas, 60, 20);   // inner x = 360, in the blue half
      if (px !== '0,0,255,255') throw new Error(`the part of the inner canvas beyond the outer canvas's box drew ${px}`);
      return `The pixel at 360 px of the inner canvas is ${px} in the outer canvas.`;
    },
  },
  {
    name: 'A scroll inside a srcdoc iframe raises paint, with the iframe in changedElements',
    why: 'The phone demo has no scroll listener. The check scrolls the iframe\'s window from script and reads a pixel of the outer canvas before and after.',
    run: async () => {
      const s = await rig('<iframe id="f" drawable style="display:block;border:0;width:160px;height:100px"></iframe>', (ctx, c) => draw(ctx, c.querySelector('#f'), 20, 10), {
        setup: async (c) => { const f = c.querySelector('#f'); const done = loaded(f); f.srcdoc = frameDoc(); await done; },
      });
      const f = s.canvas.querySelector('#f');
      const before = rgba(s.canvas, 60, 30);
      const r = await after(s, () => f.contentWindow.scrollTo(0, 60));
      const then = rgba(s.canvas, 60, 30);
      if (!r.count) throw new Error('no paint event after the scroll');
      if (before !== '0,170,0,255' || then !== '255,0,255,255') throw new Error(`pixel was ${before}, then ${then}`);
      return `${r.count} paint event${r.count === 1 ? '' : 's'}, changedElements: ${names(r.changed)}. The pixel went from ${before} to ${then}.`;
    },
  },
  {
    name: 'A link in a rotated iframe is found through the iframe at the drawn place',
    why: 'A tap on the phone has to reach a link inside another document through the canvas transform. The outer document can only see the iframe. The check asks the outer document, then asks the iframe\'s document at the point the rotation maps back to.',
    run: async () => {
      const turn = 0.3;
      const s = await rig('<iframe id="f" drawable style="display:block;border:0;width:160px;height:100px"></iframe>', (ctx, c) => { ctx.translate(60, 10); ctx.rotate(turn); draw(ctx, c.querySelector('#f')); }, {
        setup: async (c) => { const f = c.querySelector('#f'); const done = loaded(f); f.srcdoc = frameDoc(); await done; },
      });
      const f = s.canvas.querySelector('#f');
      // The link's middle is at 80, 80 in the iframe.
      const x = 60 + 80 * Math.cos(turn) - 80 * Math.sin(turn), y = 10 + 80 * Math.sin(turn) + 80 * Math.cos(turn);
      const outer = at(s.canvas, x, y), inner = f.contentDocument.elementFromPoint(80, 80);
      if (outer !== f) throw new Error(`the outer document found ${label(outer)}`);
      const r = f.getBoundingClientRect(), c = s.canvas.getBoundingClientRect();
      return `Outer document at the drawn place: ${label(outer)}. The iframe's document at 80, 80: ${label(inner)}. getBoundingClientRect() of the iframe is the box round the rotated drawing: ${Math.round(r.left - c.left)}, ${Math.round(r.top - c.top)}, ${Math.round(r.width)} by ${Math.round(r.height)}. A real tap is tried by tools/nested-frames/check.mjs.`;
    },
  },
  {
    name: 'Resizing the iframe applies the message\'s media query and raises paint',
    why: 'Turning the phone sets the iframe\'s width from 236 to 420 px. The message changes layout through its own media query, and the canvas has to hear about it.',
    run: async () => {
      const s = await rig('<iframe id="f" drawable style="display:block;border:0;width:120px;height:80px"></iframe>', (ctx, c) => { const f = c.querySelector('#f'); ctx.drawElementImage(f, 10, 10, f.offsetWidth, f.offsetHeight); }, {
        setup: async (c) => { const f = c.querySelector('#f'); const done = loaded(f); f.srcdoc = '<!doctype html><style>html,body{margin:0;height:100%}body{background:#00aa00}@media (min-width:180px){body{background:#0000ff}}</style>'; await done; },
      });
      const f = s.canvas.querySelector('#f');
      const before = rgba(s.canvas, 40, 40);
      const r = await after(s, () => { f.style.width = '200px'; });
      const then = rgba(s.canvas, 40, 40), wide = rgba(s.canvas, 190, 40);
      if (!r.count) throw new Error('no paint event after the resize');
      if (then !== '0,0,255,255') throw new Error(`pixel is ${then} after the resize (was ${before})`);
      return `${r.count} paint event${r.count === 1 ? '' : 's'}. The message went from ${before} to ${then}, and the new part of the iframe at 190 px draws ${wide}.`;
    },
  },
  {
    name: 'A drawable div round a slot holds the picture of the slotted children',
    why: 'This is how <effect-frame> draws markup it does not own. The light-DOM child has no drawable attribute. The drawable element is a div in the shadow tree with the slot inside it.',
    run: async () => {
      const s = await shadowRig('<div id="light" style="width:100px;height:50px;background:#0066cc"><button id="lb" type="button" style="display:block;width:60px;height:30px;margin:0;padding:0">In</button></div>',
        '<canvas content="drawable" layoutsubtree width="240" height="140" style="display:block;width:240px;height:140px"><div id="wrap" drawable style="width:200px"><slot></slot></div></canvas>',
        (ctx, root) => { ctx.translate(30, 20); ctx.rotate(0.1); draw(ctx, root.getElementById('wrap')); });
      if (s.error) throw s.error;
      const px = rgba(s.canvas, 30 + 90, 20 + 40);
      if (px !== '0,102,204,255') throw new Error(`the slotted child's pixel is ${px}`);
      const x = 30 + 30 * Math.cos(0.1) - 15 * Math.sin(0.1), y = 20 + 30 * Math.sin(0.1) + 15 * Math.cos(0.1);
      const hit = at(s.canvas, x, y);
      if (hit?.id !== 'lb') throw new Error(`elementFromPoint() found ${label(hit)}`);
      const r = await after(s, () => { s.host.querySelector('#light').style.background = '#cc6600'; });
      return `The light-DOM child drew (${px}) with no drawable attribute, its button is found at the drawn place, and changing its style raised ${r.count} paint event${r.count === 1 ? '' : 's'} with ${names(r.changed)} in changedElements.`;
    },
  },
  {
    name: 'The slot itself, and a slotted child with no attribute, cannot be passed to drawElementImage()',
    why: 'The two shorter routes. A slot has display: contents, so it has no box. A light-DOM child is a descendant of the canvas in the flat tree only.',
    run: async () => {
      const tried = {};
      const s = await shadowRig('<div id="light" style="width:100px;height:50px;background:#0066cc"></div>',
        '<canvas content="drawable" layoutsubtree width="240" height="140" style="display:block;width:240px;height:140px"><slot drawable></slot></canvas>',
        (ctx, root, host) => {
          for (const [key, el] of [['slot', root.querySelector('slot')], ['child', host.querySelector('#light')]]) {
            try { ctx.drawElementImage(el, 10, 10, 100, 50); tried[key] = 'drew'; } catch (e) { tried[key] = e.message.replace(/^.*?: /, ''); tried[key + 'First'] ??= tried[key]; }
          }
        });
      const light = s.host.querySelector('#light');
      light.setAttribute('drawable', '');
      await sleep(150); await s.frame(); await s.frame();
      const px = rgba(s.canvas, 50, 30);
      if (tried.child !== 'drew' || px !== '0,102,204,255') throw new Error(`with a drawable attribute the slotted child gave: ${tried.child}, pixel ${px}`);
      return `Slot with a drawable attribute: "${tried.slot}" Slotted child with no attribute: "${tried.childFirst ?? 'drew'}" The same child after the attribute was added: drew (${px}), which is the route /slot/ uses.`;
    },
  },
  {
    name: 'ctx.filter = "url(#id)" finds the filter in the canvas\'s own tree',
    why: 'The melt effect keeps its SVG filter inside the element\'s shadow tree. The check has one filter in the shadow tree (keeps green) and one in the document with a different id (keeps red), and draws a white box through each.',
    run: async () => {
      const matrix = (r, g) => `<feColorMatrix type="matrix" values="${r} 0 0 0 0  0 ${g} 0 0 0  0 0 0 0 0  0 0 0 1 0"/>`;
      const docSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      docSvg.setAttribute('width', '0'); docSvg.setAttribute('height', '0'); docSvg.style.position = 'absolute';
      docSvg.innerHTML = `<filter id="nfCheckDoc" color-interpolation-filters="sRGB">${matrix(1, 0)}</filter>`;
      testStage().append(docSvg);
      let filter = 'none';
      const s = await shadowRig('',
        `<svg width="0" height="0" style="position:absolute"><filter id="nfCheckShadow" color-interpolation-filters="sRGB">${matrix(0, 1)}</filter></svg>
         <canvas content="drawable" layoutsubtree width="240" height="140" style="display:block;width:240px;height:140px"><div id="box" drawable style="width:60px;height:40px;background:#ffffff"></div></canvas>`,
        (ctx, root) => { ctx.filter = filter; draw(ctx, root.getElementById('box'), 10, 10); });
      if (s.error) throw s.error;
      const plain = rgba(s.canvas, 30, 30);
      filter = 'url(#nfCheckShadow)'; await s.frame(); const inShadow = rgba(s.canvas, 30, 30);
      filter = 'url(#nfCheckDoc)'; await s.frame(); const inDoc = rgba(s.canvas, 30, 30);
      if (inShadow !== '0,255,0,255') throw new Error(`the shadow tree's filter gave ${inShadow}`);
      return `No filter: ${plain}. Filter in the shadow tree: ${inShadow}. Filter in the document: ${inDoc}${inDoc === plain ? ' (not found, drawn unfiltered)' : inDoc === '255,0,0,255' ? ' (found too)' : ''}.`;
    },
  },
  {
    name: '<effect-frame>: the children draw, take input and keep their markup',
    why: 'The library as a page would use it: a button inside the tag, the glass effect, and a hit test at the button\'s plain position after the effect has drawn the content in 30 enlarged tiles.',
    run: async () => {
      need();
      await import('/lib/effect-frame.js');
      const el = document.createElement('effect-frame');
      el.setAttribute('effect', 'glass');
      el.style.cssText = 'flex:none;width:240px;height:140px';
      el.innerHTML = '<div style="width:200px;height:100px;background:#0066cc"><button id="eb" type="button" style="display:block;width:120px;height:44px;margin:0;position:relative;left:20px;top:20px">Press</button></div>';
      testStage().append(el);
      for (let i = 0; i < 40 && el.paints < 3; i++) await sleep(50);
      if (!el.paints) throw new Error('the element\'s canvas got no paint event');
      const hit = at(el, 80, 42);
      if (hit?.id !== 'eb') throw new Error(`elementFromPoint() found ${label(hit)} at the button`);
      const canvas = el.shadowRoot.querySelector('canvas');
      const k = canvas.width / canvas.clientWidth, px = rgba(canvas, Math.round(190 * k), Math.round(80 * k));
      const marked = el.querySelectorAll('[drawable]').length;
      if (marked) throw new Error(`${marked} light-DOM elements were given a drawable attribute`);
      return `${el.paints} paint events, the button is found at its plain position, a pixel of the content is ${px}, and the light DOM has no drawable attribute.`;
    },
  },
  {
    name: 'A button in a foreignObject is found through the viewBox and a sheared draw',
    why: 'Three mappings are stacked: the SVG\'s viewBox (200 units drawn 150 px wide), the foreignObject\'s position and the canvas transform.',
    run: async () => {
      const s = await rig('<svg id="sv" drawable viewBox="0 0 200 100" width="150" height="75" style="display:block"><rect width="200" height="100" fill="#eeeeee"/><foreignObject x="60" y="30" width="80" height="40"><button id="fb" type="button" style="display:block;width:80px;height:40px;margin:0;padding:0">Node</button></foreignObject></svg>',
        (ctx, c) => { ctx.setTransform(1, 0.2, -0.2, 1, 60, 10); ctx.drawElementImage(c.querySelector('#sv'), 0, 0, 150, 75); });
      // Button middle: 100, 50 in SVG units, 75, 37.5 in CSS pixels. x' = x - 0.2 y + 60, y' = 0.2 x + y + 10.
      const hit = at(s.canvas, 75 - 0.2 * 37.5 + 60, 0.2 * 75 + 37.5 + 10);
      if (hit?.id !== 'fb') throw new Error(`found ${label(hit)}`);
      const r = hit.getBoundingClientRect(), c = s.canvas.getBoundingClientRect();
      return `Found ${label(hit)}. Its getBoundingClientRect() is ${Math.round(r.left - c.left)}, ${Math.round(r.top - c.top)}, ${Math.round(r.width)} by ${Math.round(r.height)} in the canvas: the box round the sheared button, at 0.75 scale.`;
    },
  },
  {
    name: 'A foreignObject, or the button in it, as the drawable element',
    why: 'Drawing one node of a diagram on its own would need the foreignObject or its content to be the drawable element. The check gives each the attribute and reports what drawElementImage() does.',
    run: async () => {
      const tried = {};
      const s = await rig('<svg id="sv" viewBox="0 0 200 100" width="200" height="100" style="display:block"><foreignObject id="fo" drawable x="0" y="0" width="80" height="40"><button id="fb" drawable type="button" style="display:block;width:80px;height:40px;margin:0;padding:0;background:#00aa55;border:0">Node</button></foreignObject></svg>',
        (ctx, c) => {
          for (const id of ['fo', 'fb']) {
            const el = c.querySelector('#' + id);
            try { ctx.drawElementImage(el, id === 'fo' ? 10 : 120, 10, 80, 40); tried[id] = 'drew'; } catch (e) { tried[id] = 'threw: ' + e.message.replace(/^.*?: /, ''); }
          }
        });
      await s.frame();
      return `foreignObject: ${tried.fo}, pixel ${rgba(s.canvas, 50, 30)}. Button inside it: ${tried.fb}, pixel ${rgba(s.canvas, 160, 30)}.`;
    },
  },
  {
    name: 'A script element added to a canvas runs, and with display: block it draws its text',
    why: 'The last demo is a script that is a child of the canvas. The check adds one from script, looks for dark text pixels in its box, then replaces it with a second element and reads what each one left behind.',
    run: async () => {
      const make = (n) => { const el = document.createElement('script'); el.id = 'sc'; el.setAttribute('drawable', ''); el.style.cssText = 'display:block;width:200px;height:60px;margin:0;white-space:pre;font:14px/1.4 monospace;color:#000000;background:#ffffff'; el.textContent = `document.currentScript.ran = ${n};\n// drawn as text`; return el; };
      const s = await rig('', (ctx, c) => draw(ctx, c.querySelector('#sc'), 10, 10), { setup: (c) => { c.append(make(1)); } });
      const first = s.canvas.querySelector('#sc');
      const d = read(s.canvas, 10, 10, 200, 60);
      let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && d[i] < 90) dark++;
      if (first.ran !== 1) throw new Error('the script did not run');
      if (dark < 40) throw new Error(`${dark} dark pixels in the script's box`);
      first.textContent = first.textContent.replace('= 1', '= 5');
      await sleep(60);
      const edited = first.ran;
      const second = make(2);
      first.replaceWith(second);
      await s.frame();
      if (second.ran !== 2) throw new Error('the replacement script did not run');
      return `The script ran and drew ${dark} dark text pixels. Changing its text afterwards did not run it again (ran is still ${edited}). A new script element put in its place ran. Hit test in its box: ${label(at(s.canvas, 40, 30))}.`;
    },
  },
]);
