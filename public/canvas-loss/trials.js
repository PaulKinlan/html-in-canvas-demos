// The trials for /canvas-loss/. Each does one thing for about four seconds in
// its own canvases, inside `box`. `seen` is called with every canvas it makes,
// so that the page can listen for a loss on it.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const RUN_MS = 4000;

// #region drawable
// A drawable canvas with one drawable child, sized once in device pixels.
export function drawable(box, seen, { w = 300, h = 110, options, raw = false, html = '<b>Trial</b> <span data-n>0</span> <button type="button">A button</button>' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  // The guard removes willReadFrequently from a drawable canvas. data-gfx-raw keeps it, for the trials that measure it.
  if (raw) canvas.setAttribute('data-gfx-raw', '');
  const dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.style.cssText = `display:block;width:${w}px;height:${h}px;max-width:100%`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const el = document.createElement('div');
  el.setAttribute('drawable', '');
  el.style.cssText = `box-sizing:border-box;width:${w - 20}px;padding:10px 12px;border-radius:10px;background:#fff7e6;color:#2a2116;font:15px/1.4 system-ui`;
  el.innerHTML = html;
  canvas.append(el);
  box.append(canvas);
  const ctx = canvas.getContext('2d', options);
  seen(canvas);
  return { canvas, ctx, el, dpr, w, h };
}
// #endregion drawable

// #region loop
// Ask for a paint on every frame for RUN_MS, changing the element each time.
async function loop(d, draw, ms = RUN_MS, each = null) {
  let paints = 0;
  d.canvas.onpaint = () => { paints++; draw(d); };
  const counter = d.el.querySelector('[data-n]');
  const end = performance.now() + ms;
  let n = 0;
  while (performance.now() < end) {
    if (counter) counter.textContent = ++n;
    if (each) each(n);
    d.canvas.requestPaint();
    await frame();
  }
  d.canvas.onpaint = null;
  return `${paints} paints in ${(ms / 1000).toFixed(0)} s`;
}
const plain = ({ ctx, el, dpr, canvas }) => {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawElementImage(el, 10, 10, el.offsetWidth, el.offsetHeight);
};
// #endregion loop

async function once(d, draw = plain) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    d.canvas.onpaint = () => { draw(d); clearTimeout(timer); resolve(); };
    d.canvas.requestPaint();
  });
  d.canvas.onpaint = null;
}

async function fixtures(box, seen, count, retire, raw = true) {
  let read = 0;
  for (let i = 0; i < count; i++) {
    const d = drawable(box, seen, { options: { willReadFrequently: true }, raw, w: 240, h: 90 });
    await once(d, (x) => { plain(x); read += x.ctx.getImageData(Math.round(24 * x.dpr), Math.round(24 * x.dpr), 1, 1).data[3] ? 1 : 0; });
    await sleep(120);
    d.canvas.remove();
    if (retire) window.__gfx?.retire(d.canvas);
    await sleep(120);
  }
  return `${count} canvases made, drawn, read and removed; ${read} had a drawn pixel`;
}

// #region trials
export const TRIALS = [
  { id: 'once', name: 'One drawable canvas, drawn once',
    what: 'The base case: a 2D drawable canvas, one drawElementImage() in one paint event, then four seconds with nothing running.',
    run: async (box, seen) => { const d = drawable(box, seen); await once(d); await sleep(RUN_MS); return 'drawn once'; } },
  { id: 'loop', name: 'A paint on every frame',
    what: 'requestPaint() in requestAnimationFrame() for four seconds. The paint handler clears and draws the element once.',
    run: (box, seen) => loop(drawable(box, seen), plain) },
  { id: 'reset', name: 'ctx.reset() in every paint',
    what: 'The same loop, with ctx.reset() and ctx.scale() at the start of each paint, as /start/, lib/text-canvas.js and /instruments/ do.',
    run: (box, seen) => loop(drawable(box, seen), ({ ctx, el, dpr }) => { ctx.reset(); ctx.scale(dpr, dpr); ctx.drawElementImage(el, 10, 10, el.offsetWidth, el.offsetHeight); }) },
  { id: 'alpha0', name: 'A draw with globalAlpha 0 in every paint',
    what: 'The same loop, with a second drawElementImage() at globalAlpha 0, which pages use to place a hit box without a picture.',
    run: (box, seen) => loop(drawable(box, seen), (d) => { plain(d); d.ctx.globalAlpha = 0; d.ctx.drawElementImage(d.el, 10, 10, d.el.offsetWidth, d.el.offsetHeight); d.ctx.globalAlpha = 1; }) },
  { id: 'shadow', name: 'shadowBlur around the element in every paint',
    what: 'The same loop, with shadowBlur 24 set before drawElementImage().',
    run: (box, seen) => loop(drawable(box, seen), (d) => { d.ctx.save(); d.ctx.shadowColor = '#0006'; d.ctx.shadowBlur = 24; d.ctx.shadowOffsetY = 8; plain(d); d.ctx.restore(); }) },
  { id: 'filter', name: 'ctx.filter blur around the element in every paint',
    what: 'The same loop, with ctx.filter = "blur(3px)" set before drawElementImage().',
    run: (box, seen) => loop(drawable(box, seen), (d) => { plain(d); d.ctx.filter = 'blur(3px)'; d.ctx.drawElementImage(d.el, 10, 10, d.el.offsetWidth, d.el.offsetHeight); d.ctx.filter = 'none'; }) },
  { id: 'pieces', name: 'Forty source-rectangle draws in every paint',
    what: 'The same loop, with the element drawn as 40 strips through the nine-argument drawElementImage(), as the split-flap and keycap pages do.',
    run: (box, seen) => loop(drawable(box, seen), ({ ctx, el, dpr, canvas }) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = el.offsetWidth, h = el.offsetHeight, step = w / 40;
      for (let i = 0; i < 40; i++) ctx.drawElementImage(el, i * step, 0, step, h, 10 + i * step, 10 + Math.sin(i) * 3, step, h);
    }) },
  { id: 'resize', name: 'canvas.width assigned on every frame',
    what: 'The same loop, with canvas.width changed by one pixel before each requestPaint(). Each assignment makes a new backing store.',
    run: (box, seen) => { const d = drawable(box, seen); const base = d.canvas.width; return loop(d, plain, RUN_MS, (n) => { d.canvas.width = base + (n % 2); }); } },
  { id: 'twelve', name: 'Twelve drawable canvases, each painting on every frame',
    what: 'Twelve canvases of 150 by 60 CSS pixels alive at once, each in its own loop.',
    run: async (box, seen) => { const all = []; for (let i = 0; i < 12; i++) all.push(loop(drawable(box, seen, { w: 150, h: 60, html: '<span data-n>0</span>' }), plain)); return (await Promise.all(all))[0] + ' on each of 12 canvases'; } },
  { id: 'nested', name: 'A drawable canvas inside a drawable element',
    what: 'The drawn element holds a second drawable canvas with its own child. Both paint on every frame.',
    run: async (box, seen) => {
      const outer = drawable(box, seen, { h: 150, html: '<b>Outer</b> <span data-n>0</span><div data-inner></div>' });
      const inner = drawable(outer.el.querySelector('[data-inner]'), seen, { w: 200, h: 60, html: 'Inner <span data-n>0</span>' });
      const [a] = await Promise.all([loop(outer, plain), loop(inner, plain)]);
      return a + ' on the outer canvas';
    } },
  { id: 'gpu-read', name: 'getImageData() from an accelerated drawable canvas, twelve times',
    what: 'A drawable canvas made without willReadFrequently, in a paint loop. One pixel is read every 300 ms, straight from the canvas (the canvas is marked so that the guard does not send the read through a copy). Chrome 159 on Android 10, 2026-11-21: every 2D canvas on the page was lost a few milliseconds after the second read, and after every second read from then on.',
    run: async (box, seen) => {
      const d = drawable(box, seen, { raw: true }); let reads = 0, stop = false;
      const reading = (async () => { while (!stop) { await sleep(300); d.ctx.getImageData(20, 20, 1, 1); reads++; } })();
      const out = await loop(d, plain, 3600); stop = true; await reading;
      return `${out}, ${reads} readbacks`;
    } },
  { id: 'gpu-read-guarded', name: 'The same twelve getImageData() calls, sent through a copy by the guard',
    what: 'The same loop and the same calls as the trial above, without the mark. /shared/context-guard.js answers getImageData() on a drawable canvas from a drawImage() copy in a plain canvas, so the drawable canvas is never read. This row says whether that fix holds on this device.',
    run: async (box, seen) => {
      const d = drawable(box, seen); let reads = 0, stop = false, lit = 0;
      const before = window.__gfx?.copyReads ?? 0;
      const reading = (async () => { while (!stop) { await sleep(300); lit += d.ctx.getImageData(Math.round(24 * d.dpr), Math.round(24 * d.dpr), 1, 1).data[3] ? 1 : 0; reads++; } })();
      const out = await loop(d, plain, 3600); stop = true; await reading;
      return `${out}, ${reads} readbacks, ${lit} had a drawn pixel, ${(window.__gfx?.copyReads ?? 0) - before} answered from a copy`;
    } },
  { id: 'copy-read', name: 'Pixels read from a drawImage() copy, twelve times',
    what: 'The drawable canvas is never read. Every 300 ms it is copied with drawImage() into a plain canvas made with willReadFrequently, and one pixel is read from the copy. This is the route the graphics rules give for pixels that are needed often.',
    run: async (box, seen) => {
      const d = drawable(box, seen); let reads = 0, stop = false, lit = 0;
      const copy = document.createElement('canvas'); copy.width = 32; copy.height = 32;
      const cc = copy.getContext('2d', { willReadFrequently: true }); seen(copy);
      const reading = (async () => { while (!stop) { await sleep(300); cc.clearRect(0, 0, 32, 32); cc.drawImage(d.canvas, Math.round(24 * d.dpr), Math.round(24 * d.dpr), 32, 32, 0, 0, 32, 32); lit += cc.getImageData(4, 4, 1, 1).data[3] ? 1 : 0; reads++; } })();
      const out = await loop(d, plain, 3600); stop = true; await reading;
      return `${out}, ${reads} copies read, ${lit} had a drawn pixel`;
    } },
  { id: 'snapshots', name: 'Sixty captureElementImage() pictures, never closed',
    what: 'A paint loop in which a picture of the element is taken every fourth frame and kept in an array with no close(). /flip-clock/ and /split-flap/ did this once a second or on every change.',
    run: async (box, seen) => {
      const d = drawable(box, seen); const kept = []; let failed = '';
      const out = await loop(d, plain, RUN_MS, (n) => { if (n % 4 || kept.length >= 60 || failed) return; try { kept.push(d.canvas.captureElementImage(d.el)); } catch (e) { failed = e.name; } });
      const text = `${out}, ${kept.length} pictures kept open${failed ? `, then captureElementImage() threw ${failed}` : ''}`;
      await sleep(600);
      for (const k of kept) k?.close?.();
      return text;
    } },
  { id: 'wrf-guarded', name: 'willReadFrequently asked for on a drawable canvas, removed by the guard',
    what: 'The same call as the "read once" trial below, without the mark that tells the guard to leave it alone. /shared/context-guard.js removes the option, so the canvas stays on the GPU. This row says whether that fix holds on this device.',
    run: async (box, seen) => { const d = drawable(box, seen, { options: { willReadFrequently: true } }); let px = null; await once(d, (x) => { plain(x); px = x.ctx.getImageData(Math.round(24 * x.dpr), Math.round(24 * x.dpr), 1, 1).data; }); await sleep(RUN_MS / 2); return `pixel read: ${px ? [...px].join(',') : 'no paint event'}; the context reports willReadFrequently ${d.ctx.getContextAttributes?.().willReadFrequently}`; } },
  { id: 'fixtures-guarded', name: 'Twelve check fixtures in a row, with the guard\'s fix',
    what: 'Twelve drawable canvases that ask for willReadFrequently, made, drawn, read, removed and retired one after another. The guard removes the option from each. This is what a page running twelve live checks does now.',
    run: (box, seen) => fixtures(box, seen, 12, true, false) },
  { id: 'float-copy', name: 'A float16 canvas copied to a willReadFrequently float16 canvas, and the copy read',
    what: 'The float canvas is never read. drawImage() copies it into a second float16 canvas made with willReadFrequently: true, and getImageData() with "rgba-float16" reads the copy. In Chromium 157 the copy is clamped to 1.0, so this row only says whether the loss follows the readback or the float canvas.',
    run: async (box, seen) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.style.cssText = 'display:block;width:64px;height:64px'; box.append(c);
      const ctx = c.getContext('2d', { colorType: 'float16', colorSpace: 'display-p3' }); seen(c);
      ctx.fillStyle = 'color(display-p3 1 0.2 0.1)'; ctx.fillRect(0, 0, 64, 64);
      await sleep(300);
      const copy = document.createElement('canvas'); copy.width = 8; copy.height = 8;
      const cc = copy.getContext('2d', { colorType: 'float16', colorSpace: 'display-p3', willReadFrequently: true }); seen(copy);
      let text;
      try {
        cc.drawImage(c, 0, 0, 8, 8, 0, 0, 8, 8);
        // gfx-allow: float-readback read from a willReadFrequently copy, once on a press, to find out if that is safe
        const d = cc.getImageData(0, 0, 1, 1, { pixelFormat: 'rgba-float16' }); text = `read ${[...d.data].map((v) => v.toFixed(2)).join(',')} from the copy`;
      } catch (e) { text = `threw ${e.name}`; }
      await sleep(RUN_MS - 300);
      return text;
    } },
  { id: 'float', name: 'One float16 getImageData()',
    what: 'A 2D canvas with colorType "float16", and one getImageData() with pixelFormat "rgba-float16". On /hdr-glow/ every 2D canvas on the page was lost at the times this ran.',
    run: async (box, seen) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.style.cssText = 'display:block;width:64px;height:64px'; box.append(c);
      const ctx = c.getContext('2d', { colorType: 'float16', colorSpace: 'display-p3' }); seen(c);
      ctx.fillStyle = 'color(display-p3 1 0.2 0.1)'; ctx.fillRect(0, 0, 64, 64);
      await sleep(300);
      let text;
      // gfx-allow: float-readback this trial exists to find out if the call loses the canvases, and it runs once on a press
      try { const d = ctx.getImageData(0, 0, 1, 1, { pixelFormat: 'rgba-float16' }); text = `read ${d.data.constructor.name} ${[...d.data].map((v) => v.toFixed(2)).join(',')}`; }
      catch (e) { text = `getImageData threw ${e.name}`; }
      await sleep(RUN_MS - 300);
      return text;
    } },
  { id: 'wrf', manual: true, name: 'A willReadFrequently drawable canvas, read once',
    what: 'A drawable canvas made with willReadFrequently: true. One drawElementImage(), then one getImageData() of one pixel in the paint handler. This is what a live check fixture was. Chrome 159 on Android 10, 2026-11-21: every 2D canvas on the page was lost, and lost again about every half second after each restore.',
    run: async (box, seen) => { const d = drawable(box, seen, { options: { willReadFrequently: true }, raw: true }); let px = null; await once(d, (x) => { plain(x); px = x.ctx.getImageData(Math.round(24 * x.dpr), Math.round(24 * x.dpr), 1, 1).data; }); await sleep(RUN_MS / 2); return `pixel read: ${px ? [...px].join(',') : 'no paint event'}`; } },
  { id: 'fixtures', manual: true, name: 'Twelve check fixtures in a row, freed',
    what: 'Twelve willReadFrequently drawable canvases made, drawn, read, removed and given to window.__gfx.retire(), one after another. This is a page running twelve live checks.',
    run: (box, seen) => fixtures(box, seen, 12, true) },
  { id: 'fixtures-kept', manual: true, name: 'Twelve check fixtures in a row, not freed',
    what: 'The same, without retire(). The removed canvases keep their size until they are collected.',
    run: (box, seen) => fixtures(box, seen, 12, false) },
];
// #endregion trials
