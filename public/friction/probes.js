// The probes of /friction/. Each one re-runs one entry of the log in the browser that opens the page,
// on a fixture of its own, and answers { happens, detail }:
//
//   happens: true    the browser still does what the entry describes
//   happens: false   it does not: the entry is out of date for this browser
//   happens: null    this browser or screen cannot decide it (the detail says why)
//
// Every fixture is a 2D drawable canvas on the shared test stage. No fixture is made with
// willReadFrequently: pixels are read from a drawImage() copy in a plain canvas that is not drawable.
import { testStage } from '/shared/support.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// #region fixture
// A drawable canvas with the given children, after its first paint event (an element has no picture
// before the browser has painted it once).
export async function fixture(html, w = 300, h = 100, { root = testStage(), backing = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.style.cssText = `display:block;flex:none;width:${w}px;height:${h}px;background:#000`;
  canvas.width = Math.round(w * backing);
  canvas.height = Math.round(h * backing);
  canvas.innerHTML = html;
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  const painted = () => new Promise((resolve) => { canvas.addEventListener('paint', resolve, { once: true }); canvas.requestPaint(); });
  await painted();
  const copy = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
  const c2 = copy.getContext('2d', { willReadFrequently: true });
  return {
    canvas, ctx, painted,
    el: canvas.firstElementChild,
    els: [...canvas.children],
    clear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); },
    // One pixel of what the canvas holds, [r, g, b, a], read from a copy.
    read(x, y) { c2.clearRect(0, 0, copy.width, copy.height); c2.drawImage(canvas, 0, 0); return [...c2.getImageData(Math.round(x), Math.round(y), 1, 1).data]; },
    // The box of pixels that match, in canvas pixels, or null.
    extent(match) {
      c2.clearRect(0, 0, copy.width, copy.height); c2.drawImage(canvas, 0, 0);
      const d = c2.getImageData(0, 0, copy.width, copy.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < copy.height; y++) for (let x = 0; x < copy.width; x++) { const i = (y * copy.width + x) * 4; if (match(d[i], d[i + 1], d[i + 2], d[i + 3])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },
    at(x, y) { const r = canvas.getBoundingClientRect(); return document.elementFromPoint(r.x + x, r.y + y); },
  };
}
// #endregion fixture

const BOX = (color, w = 100, h = 40, more = '') => `<div drawable style="width:${w}px;height:${h}px;background:${color};${more}"></div>`;
const red = (r, g, b, a) => r > 200 && g < 60 && b < 60 && a > 200;
const say = (err) => `${err.name}: ${String(err.message).replace(/^Failed to execute '\w+' on '\w+': /, '').replace(/\.+$/, '')}`;
const thrown = (fn) => { try { fn(); return null; } catch (err) { return say(err); } };

// #region probes
export const PROBES = {
  'no-size-device-pixels': async () => {
    const dpr = devicePixelRatio;
    if (Math.abs(dpr - 1) < 0.05) return { happens: null, detail: 'devicePixelRatio is 1 here, so CSS pixels and device pixels are the same size. Open the page on a HiDPI screen.' };
    const f = await fixture(BOX('#f00'), 300, 120, { backing: dpr });
    f.ctx.scale(dpr, dpr);
    f.canvas.setAttribute('data-gfx-any-size', ''); // the wrong size is the thing measured: the guard does not report it
    // gfx-allow: draw-size no size on purpose, the default size under a scaled context is what this probe measures
    f.ctx.drawElementImage(f.el, 0, 0);
    const got = f.extent(red);
    const cssWidth = got ? got.w / dpr : 0;
    return { happens: cssWidth > 100 * (1 + (dpr - 1) / 2), detail: `A 100 px wide box drawn with no size under ctx.scale(${dpr.toFixed(3)}) covers ${cssWidth.toFixed(0)} CSS px of the canvas.` };
  },

  'stale-hit-test': async () => {
    const f = await fixture(BOX('#f00', 60, 30), 300, 80);
    f.ctx.drawElementImage(f.el, 0, 0, 60, 30);
    await sleep(60);
    const before = f.at(30, 15) === f.el;
    f.clear();
    f.ctx.drawElementImage(f.el, 200, 40, 60, 30);
    await sleep(60);
    const stale = f.at(30, 15) === f.el;
    const fresh = f.at(32, 17) === f.el;
    f.el.toggleAttribute('data-moved');
    const afterToggle = f.at(30, 15) === f.el;
    if (!before) return { happens: null, detail: 'elementFromPoint() did not find the element at its first drawn place, so nothing could be compared.' };
    return { happens: stale, detail: `The element was drawn at 0,0, asked for at 30,15, then drawn at 200,40. The same point then ${stale ? 'still answers the element' : 'no longer answers the element'}. A point 2 px away ${fresh ? 'answers the element' : 'does not'}. After an attribute is toggled the first point ${afterToggle ? 'still answers it' : 'does not'}.` };
  },

  'source-rect-hit-region': async () => {
    const f = await fixture(BOX('#f00', 120, 30), 300, 100);
    const hits = (shift) => { let n = 0; for (let y = 5; y < 30; y += 10) for (let x = 5; x < 120; x += 10) if (f.at(x + shift, y + shift) === f.el) n++; return n; };
    f.ctx.drawElementImage(f.el, 0, 0, 120, 30);
    await sleep(60);
    const whole = hits(0);
    f.ctx.drawElementImage(f.el, 0, 0, 12, 30, 200, 60, 12, 30);
    await sleep(60);
    f.canvas.updateElementGeometry?.(f.el, { canvasTransform: new DOMMatrix() });
    await sleep(60);
    const afterGeometry = hits(1);
    f.ctx.save(); f.ctx.beginPath(); f.ctx.rect(0, 0, 0, 0); f.ctx.clip();
    f.ctx.drawElementImage(f.el, 0, 0, 120, 30);
    f.ctx.restore();
    await sleep(60);
    const afterClipped = hits(2);
    return { happens: afterGeometry < whole, detail: `Points of the element's box that answer it, of 36: ${whole} after a whole draw, ${afterGeometry} after a 12 px piece was drawn elsewhere and updateElementGeometry() was called with the identity, ${afterClipped} after a whole draw inside an empty clip.` };
  },

  'invisible-draw-moves-hit-region': async () => {
    const f = await fixture(BOX('#f00', 60, 30), 300, 100);
    f.ctx.drawElementImage(f.el, 0, 0, 60, 30);
    await sleep(60);
    f.ctx.globalAlpha = 0;
    f.ctx.drawElementImage(f.el, 200, 50, 60, 30);
    f.ctx.globalAlpha = 1;
    await sleep(60);
    const moved = f.at(230, 65) === f.el, left = f.at(31, 16) === f.el, ink = f.read(230, 65);
    return { happens: moved, detail: `After a second draw at 200,50 with globalAlpha 0: the pixel there has alpha ${ink[3]}, elementFromPoint() there ${moved ? 'answers the element' : 'does not answer the element'}, and at the visible picture it ${left ? 'answers the element' : 'does not'}.` };
  },

  'client-rects-follow-draw': async () => {
    const f = await fixture(BOX('#f00', 100, 40), 300, 100);
    f.ctx.drawElementImage(f.el, 50, 20, 50, 20);
    await sleep(60);
    const r = f.el.getBoundingClientRect(), c = f.canvas.getBoundingClientRect();
    return { happens: Math.abs(r.width - 100) > 1, detail: `A 100 by 40 px element drawn at 50,20 as 50 by 20: getBoundingClientRect() is ${r.width.toFixed(0)} by ${r.height.toFixed(0)} at ${(r.x - c.x).toFixed(0)},${(r.y - c.y).toFixed(0)} in the canvas. offsetWidth is ${f.el.offsetWidth}.` };
  },

  'children-at-origin': async () => {
    const f = await fixture('<div drawable style="height:40px;background:#f00">First</div><div drawable style="height:40px;background:#00f">Second</div>', 300, 120);
    const [a, b] = f.els;
    return { happens: b.offsetTop === a.offsetTop, detail: `Two block children, each 40 px tall with no width set, in a canvas 300 px wide. offsetTop: ${a.offsetTop} and ${b.offsetTop}. offsetLeft: ${a.offsetLeft} and ${b.offsetLeft}. offsetWidth: ${a.offsetWidth} and ${b.offsetWidth}.` };
  },

  'needs-drawable-attribute': async () => {
    const f = await fixture('<div style="width:100px;height:40px;background:#f00"></div>', 300, 80);
    const err = thrown(() => f.ctx.drawElementImage(f.el, 0, 0, 100, 40));
    return { happens: !!err, detail: err ? `Drawing a canvas child that has no drawable attribute throws ${err}` : 'A canvas child with no drawable attribute was drawn.' };
  },

  'no-picture-before-first-paint': async () => {
    const f = await fixture(BOX('#f00'), 300, 80);
    const late = document.createElement('div');
    late.setAttribute('drawable', '');
    late.style.cssText = 'width:80px;height:30px;background:#0f0';
    f.canvas.append(late);
    const err = thrown(() => f.ctx.drawElementImage(late, 0, 0, 80, 30));
    await f.painted();
    const after = thrown(() => f.ctx.drawElementImage(late, 0, 0, 80, 30));
    return { happens: !!err, detail: `An element drawn in the task that inserted it: ${err ? `throws ${err}` : 'draws'}. After the next paint event: ${after ? `throws ${after}` : 'draws'}.` };
  },

  'slot-not-drawable': async () => {
    const host = document.createElement('div');
    host.innerHTML = '<p style="margin:0;width:100px;height:30px;background:#f00">Slotted</p>';
    host.attachShadow({ mode: 'open' });
    testStage().append(host);
    const f = await fixture('<slot drawable></slot>', 300, 80, { root: host.shadowRoot });
    const slot = thrown(() => f.ctx.drawElementImage(f.el, 0, 0, 100, 30));
    const child = thrown(() => f.ctx.drawElementImage(host.firstElementChild, 0, 0, 100, 30));
    return { happens: !!slot, detail: `A slot with the drawable attribute: ${slot ? `throws ${slot}` : 'draws'}. The slotted paragraph, which has no drawable attribute of its own: ${child ? `throws ${child}` : 'draws'}.` };
  },

  'svg-no-offset-width': async () => {
    const f = await fixture('<svg drawable width="100" height="40" style="display:block"><rect width="100" height="40" fill="#f00"/></svg>', 300, 80);
    const err = thrown(() => f.ctx.drawElementImage(f.el, 0, 0, f.el.offsetWidth, f.el.offsetHeight));
    const drawn = f.extent(red);
    return { happens: f.el.offsetWidth === undefined && !drawn, detail: `svg.offsetWidth is ${f.el.offsetWidth}. drawElementImage(svg, 0, 0, svg.offsetWidth, svg.offsetHeight) ${err ? `throws ${err}` : 'throws nothing'} and draws ${drawn ? `${drawn.w} by ${drawn.h} px` : 'nothing'}.` };
  },

  'missing-filter-silent': async () => {
    const f = await fixture(BOX('#f00'), 300, 80);
    f.ctx.filter = 'url(#friction-no-such-filter)';
    const err = thrown(() => f.ctx.drawElementImage(f.el, 0, 0, 100, 40));
    const set = f.ctx.filter;
    f.ctx.filter = 'none';
    const drawn = f.extent(red);
    return { happens: !err && !!drawn, detail: `ctx.filter reads back "${set}". The draw ${err ? `throws ${err}` : 'throws nothing'} and the element is ${drawn ? 'drawn unfiltered' : 'not drawn'}.` };
  },

  'inner-canvas-shifted': async () => {
    const inner = (more) => `<div drawable style="width:120px;height:80px;padding:20px;box-sizing:border-box;background:#222"><canvas width="80" height="40" style="display:block;width:80px;height:40px;${more}"></canvas></div>`;
    const run = async (more) => {
      const f = await fixture(inner(more), 300, 100);
      const c = f.el.firstElementChild.getContext('2d');
      c.fillStyle = '#f00'; c.fillRect(0, 0, 80, 40);
      await f.painted(); await sleep(80); await f.painted();
      f.clear();
      f.ctx.drawElementImage(f.el, 0, 0, 120, 80);
      const box = f.extent(red);
      f.canvas.remove();
      return box;
    };
    const plain = await run(''), contained = await run('contain:paint;');
    const text = (b) => (b ? `${b.w} by ${b.h} px at ${b.x},${b.y}` : 'not drawn');
    const right = (b) => b && Math.abs(b.x - 20) <= 1 && Math.abs(b.y - 20) <= 1 && Math.abs(b.w - 80) <= 2;
    return { happens: !right(plain), detail: `An 80 by 40 px red canvas inside a drawable box with 20 px of padding should be drawn 80 by 40 at 20,20. Drawn: ${text(plain)}. With contain: paint on the inner canvas: ${text(contained)}.` };
  },

  'border-box-cut': async () => {
    const f = await fixture('<div drawable style="width:60px;height:30px;background:#00f;box-shadow:0 0 0 10px #f00;outline:4px solid #f00;outline-offset:10px"></div>', 300, 120);
    f.ctx.drawElementImage(f.el, 40, 40, 60, 30);
    const outside = f.extent(red), inside = f.read(70, 55);
    return { happens: !outside, detail: `A 60 by 30 px box with a 10 px red spread shadow and a red outline, drawn at 40,40. Red pixels in the canvas: ${outside ? `${outside.w} by ${outside.h} px` : 'none'}. The pixel inside the box is rgb(${inside.slice(0, 3).join(', ')}).` };
  },

  'custom-property-no-paint': async () => {
    const f = await fixture(BOX('#f00', 100, 40, '--friction-x:1;'), 300, 80);
    f.ctx.drawElementImage(f.el, 0, 0, 100, 40);
    await sleep(250);
    let custom = 0, real = 0, counting = 'custom';
    f.canvas.addEventListener('paint', () => { if (counting === 'custom') custom++; else real++; });
    f.el.style.setProperty('--friction-x', '2');
    await sleep(300);
    counting = 'real';
    f.el.style.background = '#e00';
    await sleep(300);
    return { happens: custom === 0 && real > 0, detail: `paint events in 300 ms after a change of a custom property that no rule uses: ${custom}. After a change of background: ${real}.` };
  },

  'element-image-one-canvas': async () => {
    const f = await fixture(BOX('#f00'), 300, 80);
    if (!f.canvas.captureElementImage) return { happens: null, detail: 'canvas.captureElementImage() is missing in this browser.' };
    const image = f.canvas.captureElementImage(f.el);
    const other = Object.assign(document.createElement('canvas'), { width: 200, height: 80 });
    const draw = thrown(() => other.getContext('2d').drawElementImage(image, 0, 0, 100, 40));
    const drawImage = thrown(() => other.getContext('2d').drawImage(image, 0, 0));
    const bitmap = await createImageBitmap(image).then((b) => { b.close(); return null; }, say);
    const dispose = typeof Symbol.dispose === 'symbol' && Symbol.dispose in image;
    image.close();
    const closed = thrown(() => f.ctx.drawElementImage(image, 0, 0, 100, 40));
    return { happens: !!draw && !!drawImage && !!bitmap, detail: `An ElementImage in a second canvas: drawElementImage() ${draw ? `throws ${draw}` : 'draws'}; drawImage() ${drawImage ? `throws ${drawImage}` : 'draws'}; createImageBitmap() ${bitmap ? `rejects with ${bitmap}` : 'resolves'}. It has ${dispose ? 'a' : 'no'} [Symbol.dispose]. After close(), a draw into its own canvas ${closed ? `throws ${closed}` : 'still draws'}.` };
  },

  'three-method-names': async () => {
    const gl = globalThis.WebGL2RenderingContext?.prototype ?? {}, q = globalThis.GPUQueue?.prototype;
    const has = (o, n) => (o ? (n in o ? 'present' : 'missing') : 'no WebGPU here');
    const old = 'texElementImage2D' in gl, now = 'texElementSubImage2D' in gl;
    if (!old && !now) return { happens: null, detail: 'This browser has neither WebGL method.' };
    return { happens: !old, detail: `WebGL: texElementImage2D (the name three.js r187 calls) is ${has(gl, 'texElementImage2D')}, texElementSubImage2D is ${has(gl, 'texElementSubImage2D')}. WebGPU: copyElementImageToTexture is ${has(q, 'copyElementImageToTexture')}, drawElementImageToTexture is ${has(q, 'drawElementImageToTexture')}.` };
  },

  'posture-no-angle': async () => {
    const p = navigator.devicePosture;
    if (!p) return { happens: null, detail: 'navigator.devicePosture is missing in this browser.' };
    const members = []; for (const k in p) if (!(k in EventTarget.prototype)) members.push(k);
    return { happens: !('angle' in p), detail: `navigator.devicePosture.type is "${p.type}". Its members: ${members.join(', ')}.` };
  },

  'no-box-quads': async () => ({
    happens: !('getBoxQuads' in Element.prototype),
    detail: `Element.prototype.getBoxQuads is ${'getBoxQuads' in Element.prototype ? 'present' : 'missing'}. Range.prototype.getBoxQuads is ${'getBoxQuads' in Range.prototype ? 'present' : 'missing'}.`,
  }),

  'select-no-hide-picker': async () => {
    const s = HTMLSelectElement.prototype;
    return { happens: !('hidePicker' in s), detail: `HTMLSelectElement: showPicker is ${'showPicker' in s ? 'present' : 'missing'}, hidePicker is ${'hidePicker' in s ? 'present' : 'missing'}, ontoggle is ${'ontoggle' in s ? 'present (inherited from HTMLElement)' : 'missing'}.` };
  },
};
// #endregion probes
