// The page script for /flutter-dom/. The Flutter app is not loaded until the reader asks.
import { banner, runTests, supported } from '/shared/support.js';
import { createBridge, describeFlutter, watchContextLoss, ROUTES } from '/flutter-dom/bridge.js';

banner();
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1));

// ---------------------------------------------------------------- the visible demo
const params = new URLSearchParams(location.search);
const inCanvas = params.get('design') === 'in-canvas';
const design = $('design');
const routeSelect = $('route');
const msg = $('fd-msg');
let loaded = false;
design.value = inCanvas ? 'in-canvas' : 'overlay';
design.addEventListener('change', () => {
  // The engine reads its configuration once, so the other design needs a fresh page.
  const url = new URL(location.href);
  if (design.value === 'in-canvas') url.searchParams.set('design', 'in-canvas');
  else url.searchParams.delete('design');
  if (loaded) location.href = url.href;
  else history.replaceState(null, '', url.href);
});
for (const [name, text] of Object.entries(ROUTES)) {
  if (name === 'element') continue;
  routeSelect.append(new Option(`${name}: ${text}`, name));
}

function showStats(bridge) {
  const s = bridge.stats, mean = bridge.mean;
  const parts = [`${s.images} images from ${s.paints} paint events`];
  if (s.route === 'element') parts.push(`${s.uploads} texElementSubImage2D() uploads`);
  else parts.push(`drawElementImage() ${ms(mean(s.drawMs))} ms`);
  if (s.route === 'bitmap') parts.push(`createImageBitmap() ${ms(mean(s.bitmapMs))} ms`);
  parts.push(`createImageFromTextureSource() ${ms(mean(s.imageMs))} ms`);
  if (s.rasterMs.length) parts.push(`Flutter raster ${ms(mean(s.rasterMs))} ms per frame`);
  if (s.image) parts.push(`${s.image.width}×${s.image.height} px`);
  if (s.lastError) parts.push(`last error: ${s.lastError}`);
  $('stats').textContent = parts.join(' · ');
}

// #region load
const script = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

async function loadFlutter() {
  const host = $('fd-host');
  const useCanvas = design.value === 'in-canvas';
  msg.textContent = 'Loading Flutter (8 MB)…';
  try {
    // The Dart code looks for window.flutterDom when it starts.
    const bridge = createBridge({
      source: $('fd-source'), form: $('fd-form'),
      route: useCanvas ? 'element' : routeSelect.value,
      onStats: () => showStats(bridge),
    });
    window.flutterDom = bridge;
    watchContextLoss(() => {
      msg.hidden = false;
      msg.textContent = 'Flutter lost its WebGL context. Reload the page to start it again.';
    });
    await script('/flutter-dom/app/flutter_bootstrap.js');
    await window.startFlutterDom(host, useCanvas ? { canvasKitForceMultiSurfaceRasterizer: true } : {});
    loaded = true;
    if (useCanvas) {
      // Flutter makes its canvas during the first frame.
      for (let i = 0; i < 100 && !describeFlutter(host).canvases.length; i++) await sleep(50);
      bridge.adopt(describeFlutter(host).canvases[0].el);
    }
    msg.hidden = true;
    routeSelect.disabled = useCanvas;
    $('debug').disabled = useCanvas;
    routeSelect.onchange = () => bridge.setRoute(routeSelect.value);
    setTimeout(() => {
      if (bridge.stats.images) return;
      msg.hidden = false;
      msg.textContent = `Flutter started but drew no image of the form. ${bridge.stats.lastError || (supported ? '' : 'HTML-in-canvas is off in this browser.')}`;
    }, 8000);
  } catch (err) {
    msg.hidden = false;
    msg.textContent = `Flutter did not start: ${err?.message ?? err}`;
  }
}
// #endregion load
$('fd-load').addEventListener('click', loadFlutter, { once: true });
$('debug').addEventListener('change', (e) => $('fd-stage').classList.toggle('fd-debug', e.target.checked));

// ---------------------------------------------------------------- live checks
// Two framed copies of the app, fixed to the corner of the window: one for each design.
// The checks never touch the copy above.
const frames = {};
let holder = null;
async function fixture(key) {
  if (frames[key]) return frames[key];
  if (!holder) {
    holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:380px;height:600px;overflow:hidden;pointer-events:none';
    document.body.append(holder);
  }
  const f = document.createElement('iframe');
  f.tabIndex = -1;
  f.style.cssText = 'position:absolute;left:0;top:0;border:0;width:380px;height:600px';
  f.src = key === 'in-canvas' ? '/flutter-dom/fixture.html?surface=multi&route=element' : '/flutter-dom/fixture.html';
  holder.append(f);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  for (let i = 0; i < 400 && !(win.__started || win.__failed); i++) await sleep(100);
  if (win.__failed) throw new Error(`Flutter did not start: ${win.__failed}`);
  if (!win.__started) throw new Error('Flutter did not start in 40 s');
  if (win.__adoptError) throw new Error(win.__adoptError);
  for (let i = 0; i < 100 && !win.flutterDom.stats.images; i++) await sleep(100);
  const fd = win.flutterDom;
  // Flutter makes its canvas during its first frame.
  for (let i = 0; i < 100 && !win.describeFlutter().canvases.length; i++) await sleep(50);
  const canvas = win.describeFlutter().canvases[0]?.el;
  frames[key] = { win, doc: f.contentDocument, fd, canvas, form: win.__form };
  return frames[key];
}
const tryRoute = async (fd, ...args) => JSON.parse(await fd.tryRoute(...args));
// elementFromPoint() stops at a shadow host. Flutter's canvas is in a shadow root.
function deepHit(doc, x, y) {
  let el = doc.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
async function until(test, timeout = 3000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) { if (test()) return true; await sleep(50); }
  return false;
}
// What Flutter has on its canvas. A WebGL canvas keeps its pixels only until the frame is
// presented, so ask Flutter for a frame and read in the same animation frame, after Flutter.
let nudge = 0;
async function flutterPixel(win, fd, canvas, x, y) {
  fd.control('opacity', (nudge ^= 1) ? 0.999 : 1);
  // The copy of one pixel is made in the frame callback, while Flutter's canvas holds the picture.
  // The readback is from the plain 1 by 1 canvas, after the callback.
  const ctx = await new Promise((resolve) => win.requestAnimationFrame(() => {
    const c = win.document.createElement('canvas');
    c.width = c.height = 1;
    const copy = c.getContext('2d', { willReadFrequently: true });
    const r = canvas.getBoundingClientRect();
    const sx = (x - r.x) * canvas.width / r.width, sy = (y - r.y) * canvas.height / r.height;
    copy.drawImage(canvas, sx, sy, 1, 1, 0, 0, 1, 1);
    resolve(copy);
  }));
  return [...ctx.getImageData(0, 0, 1, 1).data];
}
// Paint the form magenta, wait for Flutter, and look for magenta on Flutter's canvas.
async function seesForm({ win, fd, canvas, form }) {
  for (const [name, value] of [['rotate', 0], ['tilt', 0], ['opacity', 1], ['blur', 0]]) fd.control(name, value);
  const before = fd.stats.images;
  form.style.background = 'rgb(255, 0, 255)';
  await until(() => fd.stats.images > before);
  await sleep(250);
  const r = form.getBoundingClientRect();
  const at = { x: r.x + 6, y: r.y + r.height / 2 };
  let px = await flutterPixel(win, fd, canvas, at.x, at.y);
  for (let i = 0; i < 20 && !(px[0] > 200 && px[1] < 80 && px[2] > 200); i++) { await sleep(100); px = await flutterPixel(win, fd, canvas, at.x, at.y); }
  form.style.background = '';
  if (!(px[0] > 200 && px[1] < 80 && px[2] > 200)) throw new Error(`Flutter's canvas has rgba(${px.join(', ')}) where the form should be magenta`);
  return px;
}
async function hitRotated({ doc, fd, form }) {
  const places = fd.stats.places;
  fd.control('rotate', 24);
  fd.control('tilt', 32);
  await until(() => fd.stats.places > places);
  await sleep(150);
  const out = [];
  for (const name of ['email', 'plan', 'notes']) {
    const el = form.elements[name];
    const c = centre(el);
    const hit = deepHit(doc, c.x, c.y);
    if (hit !== el) throw new Error(`at the centre of ${name}, elementFromPoint gave <${hit?.localName}>`);
    out.push(`${name} at ${Math.round(c.x)}, ${Math.round(c.y)}`);
  }
  fd.control('rotate', 0);
  fd.control('tilt', 0);
  return out.join('; ');
}
// Change the textarea `count` times and wait for Flutter's image each time.
async function updates({ win, fd, form }, count = 12) {
  const area = form.elements.notes;
  let done = 0;
  for (let i = 0; i < count; i++) {
    const before = fd.stats.images;
    area.value = `update ${i} ${'x'.repeat(i % 5)}`;
    area.dispatchEvent(new win.Event('input', { bubbles: true }));
    if (await until(() => fd.stats.images > before, 1500)) done++;
    await sleep(40);
  }
  return done;
}

const TIME = 60000;
const tests = [
  {
    name: 'The Flutter app starts inside a host element',
    why: 'Flutter 3.50.1, dart2js, CanvasKit served from this site. Embedded mode: initializeEngine({ hostElement }).',
    timeout: TIME,
    run: async () => {
      const { win, canvas } = await fixture('overlay');
      const d = win.describeFlutter();
      if (!canvas) throw new Error('Flutter made no canvas');
      const root = canvas.getRootNode();
      // gfx-allow: webgl-context asks which context Flutter's canvas already has, it makes none on a canvas that has one
      const context = canvas.getContext('bitmaprenderer') ? 'a bitmaprenderer context' : canvas.getContext('webgl2') ? 'a WebGL2 context' : 'an unknown context';
      return `renderer ${d.renderer}; ${d.canvases.length} canvas, ${root instanceof win.ShadowRoot ? `in the shadow root of <${root.host.localName}>` : 'in the light DOM'}, with ${context}`;
    },
  },
  {
    name: 'Route 1: createImageFromTextureSource() takes the form element itself',
    why: 'The element is passed as the texture source, with and without transferOwnership.',
    expect: 'fail',
    timeout: TIME,
    run: async () => {
      const { fd, form } = await fixture('overlay');
      const copy = await tryRoute(fd, form, 300, 200, false);
      const direct = await tryRoute(fd, form, 300, 200, true);
      if (copy.ok || direct.ok) return `it worked: copy ${copy.ok}, transfer ${direct.ok}`;
      throw new Error(`transferOwnership false: ${copy.error} (in ${copy.stage}). transferOwnership true: ${direct.error} (in ${direct.stage})`);
    },
  },
  {
    name: 'Route 1: createImageFromTextureSource() takes an ElementImage',
    why: 'canvas.captureElementImage(form) gives an ElementImage, which is passed as the texture source.',
    expect: 'fail',
    timeout: TIME,
    run: async () => {
      const { fd, form, doc } = await fixture('overlay');
      const source = doc.getElementById('source');
      if (!source.captureElementImage) throw new Error('captureElementImage() is missing');
      const copy = await tryRoute(fd, source.captureElementImage(form), source.width, source.height, false);
      const direct = await tryRoute(fd, source.captureElementImage(form), source.width, source.height, true);
      if (copy.ok || direct.ok) return `it worked: copy ${copy.ok}, transfer ${direct.ok}`;
      throw new Error(`transferOwnership false: ${copy.error} (in ${copy.stage}). transferOwnership true: ${direct.error} (in ${direct.stage})`);
    },
  },
  {
    name: 'Route 2: a canvas that drew the form with drawElementImage() is a texture source',
    why: 'The pixels are read back from the ui.Image with toByteData() and compared with the canvas.',
    timeout: TIME,
    run: async () => {
      const { fd, doc } = await fixture('overlay');
      const source = doc.getElementById('source');
      const read = () => [...source.getContext('2d').getImageData(source.width >> 1, source.height >> 1, 1, 1).data];
      const draws = fd.stats.draws;
      source.requestPaint(); // the canvas is blank between a resize and the next paint event
      await until(() => fd.stats.draws > draws);
      const r = await tryRoute(fd, source, source.width, source.height, false);
      if (!r.ok) throw new Error(`${r.error} (in ${r.stage})`);
      const px = read();
      if (!px[3]) throw new Error('the canvas is blank');
      if (px.some((v, i) => Math.abs(v - r.centre[i]) > 3)) throw new Error(`centre pixel ${r.centre} in the image, ${px} in the canvas`);
      return `ui.Image ${r.width}×${r.height}, centre pixel rgba(${r.centre.join(', ')}) matches the canvas`;
    },
  },
  {
    name: 'Route 2: Flutter draws the form in its own scene',
    why: 'The form is painted magenta. The check reads Flutter\'s canvas where Flutter laid the widget out.',
    timeout: TIME,
    run: async () => {
      const f = await fixture('overlay');
      const px = await seesForm(f);
      return `rgba(${px.join(', ')}) on Flutter's canvas; ${f.fd.stats.images} images from ${f.fd.stats.paints} paint events`;
    },
  },
  {
    name: 'Route 2: cost of one update for each way of handing over the canvas',
    why: 'The textarea is changed 12 times per source. Times are means. CanvasKit uploads the texture when it draws, so the upload is inside Flutter\'s raster time.',
    timeout: TIME,
    run: async () => {
      const f = await fixture('overlay');
      const { fd } = f;
      const out = [];
      for (const route of ['canvas-copy', 'canvas-direct', 'bitmap']) {
        fd.setRoute(route);
        await sleep(200);
        fd.stats.imageMs.length = fd.stats.drawMs.length = fd.stats.bitmapMs.length = fd.stats.rasterMs.length = 0;
        const done = await updates(f);
        if (!done) throw new Error(`${route}: no image followed a change. ${fd.stats.lastError}`);
        const s = fd.stats, mean = fd.mean;
        out.push(`${route}: drawElementImage ${ms(mean(s.drawMs))}${route === 'bitmap' ? ` + createImageBitmap ${ms(mean(s.bitmapMs))}` : ''} + createImageFromTextureSource ${ms(mean(s.imageMs))} ms, raster ${ms(mean(s.rasterMs))} ms (${done} updates)`);
      }
      fd.setRoute('canvas-copy');
      return `${fd.stats.image.width}×${fd.stats.image.height} px. ${out.join('. ')}`;
    },
  },
  {
    name: 'Route 3: the real fields are hit tested where Flutter drew them, rotated and tilted',
    why: 'The canvas that holds the form lies over the Flutter view with opacity 0 and Flutter\'s matrix as a CSS matrix3d().',
    timeout: TIME,
    run: async () => {
      const f = await fixture('overlay');
      const source = f.doc.getElementById('source');
      const opacity = f.win.getComputedStyle(source).opacity;
      return `canvas opacity ${opacity}; ${await hitRotated(f)}`;
    },
  },
  {
    name: 'Route 3: an element inside Flutter\'s own canvas is painted and hit tested (default rasterizer)',
    why: 'content="drawable" is set on Flutter\'s canvas and an <input> is appended to it, then placed at 40, 20 with updateElementGeometry().',
    timeout: TIME,
    run: async () => {
      const { win, canvas } = await fixture('overlay');
      const p = await probeInFlutterCanvas(win, canvas);
      if (!p.paints) throw new Error('no paint event');
      if (p.hit !== p.input) throw new Error(`elementFromPoint gave <${p.hit?.localName}>`);
      return `${p.paints} paint event, image size ${p.size}, hit box at ${p.rect.join(', ')} after updateElementGeometry()`;
    },
  },
  {
    name: 'Route 3: that element\'s pixels can be given to Flutter (default rasterizer)',
    why: 'Flutter\'s canvas has a bitmaprenderer context, which cannot draw an element. Its ElementImage is tried on a 2D canvas, an OffscreenCanvas and a WebGL texture.',
    expect: 'fail',
    timeout: TIME,
    run: async () => {
      const { win, canvas } = await fixture('overlay');
      const p = await probeInFlutterCanvas(win, canvas);
      if (p.drew.some((d) => d.ok)) return p.drew.map((d) => `${d.where}: ${d.ok ? 'drew' : d.error}`).join('; ');
      throw new Error(p.drew.map((d) => `${d.where}: ${d.error}`).join('; '));
    },
  },
  {
    name: 'Route 3: a Flutter widget drawn over the form takes the pointer there',
    why: 'Flutter draws a yellow badge over the top right corner of the form. The check hit tests a point on the badge.',
    expect: 'fail',
    timeout: TIME,
    run: async () => {
      const { win, doc, fd, canvas, form } = await fixture('overlay');
      for (const [name, value] of [['rotate', 0], ['tilt', 0], ['blur', 0]]) fd.control(name, value);
      await sleep(300);
      const r = form.getBoundingClientRect();
      const at = { x: r.right - 70, y: r.top + 3 };
      const px = await flutterPixel(win, fd, canvas, at.x, at.y);
      // The badge is yellow and the form is grey.
      if (!(px[0] > 120 && px[0] > px[1] && px[0] - px[2] > 80)) return `no badge at that point: rgba(${px.join(', ')})`;
      const hit = deepHit(doc, at.x, at.y);
      if (!form.contains(hit) && hit !== doc.getElementById('source')) return `elementFromPoint gave <${hit?.localName}>`;
      throw new Error(`Flutter drew its badge at ${Math.round(at.x)}, ${Math.round(at.y)} (rgba(${px.join(', ')})) and elementFromPoint there gave <${hit.localName}> of the DOM form. The browser does not know what Flutter draws on top.`);
    },
  },
  {
    name: 'In-canvas: with the multi-surface rasterizer the form is a child of Flutter\'s WebGL canvas',
    why: 'canvasKitForceMultiSurfaceRasterizer makes CanvasKit draw into a canvas on the page. The form is moved into it.',
    timeout: TIME,
    run: async () => {
      const { win, fd, canvas, form } = await fixture('in-canvas');
      // gfx-allow: webgl-context returns the context Flutter already made on its canvas
      if (!canvas.getContext('webgl2')) throw new Error('Flutter\'s canvas has no WebGL2 context');
      if (form.parentNode !== canvas) throw new Error('the form is not in Flutter\'s canvas');
      return `<${form.localName}> is a child of Flutter's canvas (${canvas.width}×${canvas.height}, WebGL2, content="${canvas.getAttribute('content')}") in the shadow root of <${canvas.getRootNode().host?.localName}>`;
    },
  },
  {
    name: 'In-canvas: createImageFromTextureSource() takes the form itself when texImage2D() is patched',
    why: 'CanvasKit calls gl.texImage2D(…, source). The patch answers that call with texElementSubImage2D(). The form is painted magenta and read from Flutter\'s canvas.',
    timeout: TIME,
    run: async () => {
      const f = await fixture('in-canvas');
      const px = await seesForm(f);
      if (!f.fd.stats.uploads) throw new Error('no upload went through the patch');
      return `rgba(${px.join(', ')}) on Flutter's canvas; ${f.fd.stats.uploads} texElementSubImage2D() uploads, no 2D canvas and no copy`;
    },
  },
  {
    name: 'In-canvas: updateElementGeometry() takes Flutter\'s perspective matrix',
    why: 'The form is rotated and tilted by Flutter. The 4×4 matrix goes to updateElementGeometry() as canvasTransform.',
    timeout: TIME,
    run: async () => {
      const f = await fixture('in-canvas');
      return `${await hitRotated(f)}; canvasTransform unit ${f.fd.stats.unit.toFixed(3)} CSS px`;
    },
  },
  {
    name: 'In-canvas: cost of one update',
    why: 'The same 12 changes. There is no drawElementImage() and no createImageBitmap(): the upload happens inside Flutter\'s raster.',
    timeout: TIME,
    run: async () => {
      const f = await fixture('in-canvas');
      const { fd } = f;
      fd.stats.imageMs.length = fd.stats.rasterMs.length = 0;
      const done = await updates(f);
      if (!done) throw new Error(`no image followed a change. ${fd.stats.lastError}`);
      return `${fd.stats.image.width}×${fd.stats.image.height} px. createImageFromTextureSource ${ms(fd.mean(fd.stats.imageMs))} ms, raster ${ms(fd.mean(fd.stats.rasterMs))} ms (${done} updates)`;
    },
  },
];

// Put an <input> into Flutter's canvas (default rasterizer) and see what the browser does with it.
let probed = null;
function probeInFlutterCanvas(win, canvas) {
  probed ??= (async () => {
    const doc = win.document;
    const root = canvas.getRootNode();
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    const input = doc.createElement('input');
    input.setAttribute('drawable', '');
    input.value = 'probe';
    input.style.cssText = 'position:absolute;left:0;top:0;pointer-events:auto;width:120px;height:30px;box-sizing:border-box';
    let paints = 0;
    canvas.addEventListener('paint', () => paints++);
    canvas.append(input);
    canvas.requestPaint?.();
    await until(() => paints > 0, 2000);
    const out = { input, paints, drew: [] };
    if (!paints) return out;
    const size = canvas.getElementImageDefaultSize(input);
    out.size = `${Math.round(size.width)}×${Math.round(size.height)}`;
    canvas.updateElementGeometry(input, { canvasTransform: new win.DOMMatrix().translate(40, 20) });
    canvas.toggleAttribute('data-geometry-tick');
    const r = input.getBoundingClientRect();
    out.rect = [r.x, r.y, r.width, r.height].map(Math.round);
    out.hit = root.elementFromPoint(r.x + 10, r.y + 10);
    const image = canvas.captureElementImage(input);
    const attempt = (where, fn) => { try { fn(); out.drew.push({ where, ok: true }); } catch (err) { out.drew.push({ where, ok: false, error: err.message.replace(/^Failed to execute '\w+' on '\w+': /, '') }); } };
    attempt('2D canvas', () => { const c = doc.createElement('canvas'); c.getContext('2d').drawElementImage(image, 0, 0, 120, 30); });
    attempt('OffscreenCanvas 2D', () => new win.OffscreenCanvas(120, 30).getContext('2d').drawElementImage(image, 0, 0, 120, 30));
    attempt('OffscreenCanvas WebGL2', () => {
      // gfx-allow: webgl-context one 120 by 30 context in a live check fixture, to record that an ElementImage is refused by another context
      const gl = new win.OffscreenCanvas(120, 30).getContext('webgl2');
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 120, 30);
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, image);
    });
    input.remove();
    return out;
  })();
  return probed;
}

runTests($('results'), tests).then(() => {
  holder?.remove();
  holder = null;
  for (const key of Object.keys(frames)) delete frames[key];
});
