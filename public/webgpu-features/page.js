// The page script for /webgpu-features/: picks a route, runs the frame loop,
// fills the feature table and holds the live checks. The drawing is in stage.js.

import { banner, checkBench, nav, nextPaint, onBench, runTests, supported } from '/shared/support.js';
import { webgpu } from '/shared/backend.js';
import { routeSwitch } from '/shared/route-switch.js';
import { supportedGPU } from '/lib/gpu-util.js';
import { GLStage, GPUStage, layout, scene, watchFrame } from '/webgpu-features/stage.js';

nav('/webgpu-features/');
banner();
const $ = (id) => document.getElementById(id);
const wide = matchMedia('(min-width: 760px)');
const els = { card: $('card'), words: $('words') };
// What the "Drawn with" line reads.
const state = { backend: 'starting', gpuNote: '' };
let canvas = $('stage');
let contextKind = '';
let stage = null;
let L = null;
let px = 1;
let turn = 0;
let choice = '';

let presses = 0;
$('press').onclick = (e) => (e.target.textContent = `Pressed ${++presses}`);

// ---- Route ----------------------------------------------------------------

// A canvas keeps the first kind of context it gave out, so changing route means a new canvas with the same children.
function canvasFor(kind) {
  if (contextKind && contextKind !== kind) {
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    fresh.append(els.card, els.words);
    canvas = fresh;
    watchCanvas();
  }
  contextKind = kind;
  return canvas;
}

async function start(want = choice) {
  choice = want;
  const mine = ++turn;
  stage?.destroy();
  stage = null;
  firstFrames = 0;
  state.backend = 'starting';
  state.gpuNote = '';
  $('message').textContent = '';
  if (!supported) return plain('This browser does not have the HTML-in-canvas API, so the form and the text are shown as ordinary HTML.');
  const order = want === 'webgl' ? ['webgl'] : want ? [want, 'webgl'] : ['webgpu', 'webgpu-compat', 'webgl'];
  let problem = '';
  for (const route of order) {
    try {
      let made;
      if (route === 'webgl') made = await GLStage.create(canvasFor('webgl2'), els);
      else {
        // #region compat
        // 'webgpu' is the page's core device. 'webgpu-compat' takes a device from a
        // compatibility mode adapter: when asked for by name, or when there is no core adapter.
        const gpu = route === 'webgpu' ? await webgpu() : await webgpu({ compat: want ? 'only' : true });
        // #endregion compat
        if (!gpu) {
          state.gpuNote ||= route === 'webgpu' ? webgpu.reason : webgpu.compatReason || webgpu.reason;
          continue;
        }
        if (!supportedGPU) {
          state.gpuNote = 'this browser cannot put an element into a WebGPU texture';
          continue;
        }
        made = await GPUStage.create(canvasFor('webgpu'), gpu, els);
      }
      if (mine !== turn) return made.destroy();
      stage = made;
      state.backend = route === 'webgl' ? 'webgl' : stage.features.level === 'compatibility' ? 'webgpu-compat' : 'webgpu';
      break;
    } catch (err) {
      problem = err.message;
      if (route !== 'webgl') state.gpuNote = err.message;
    }
  }
  if (mine !== turn) return;
  if (!stage) return plain(`Neither WebGPU nor WebGL could draw this (${problem || state.gpuNote}), so the form and the text are shown as ordinary HTML.`);
  resize();
  describe();
  dirty = true;
  canvas.requestPaint?.();
  schedule();
}

// WebGPU started and then failed: say why and carry on with WebGL.
function fallBack(reason) {
  if (!stage || stage.route !== 'webgpu') return;
  const note = reason;
  start('webgl').then(() => {
    state.gpuNote = note;
    route?.show();
  });
}
addEventListener('webgpulost', () => fallBack(webgpu.reason || 'the WebGPU device was lost'));

function plain(text) {
  state.backend = 'plain';
  $('message').textContent = text;
  const box = document.createElement('div');
  box.id = 'plain';
  box.className = 'card';
  canvas.replaceWith(box);
  box.append(els.card, els.words);
  $('labels').hidden = true;
  describe();
}

function watchCanvas() {
  // #region frame
  canvas.addEventListener('paint', () => {
    dirty = true;
    schedule();
  });
  // #endregion frame
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    $('message').textContent = 'The WebGL context was lost. The picture comes back when the browser restores it.';
  });
  canvas.addEventListener('webglcontextrestored', () => start(choice));
  canvas.addEventListener('pointermove', (e) => {
    if (!L) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * px - L.tiles.trails.x;
    const y = (e.clientY - r.top) * px - L.tiles.trails.y;
    pointer = x >= 0 && y >= 0 && x < L.tiles.trails.w && y < L.tiles.trails.h ? { x, y, at: performance.now() } : null;
  });
  for (const type of ['pointerleave', 'pointercancel', 'pointerup']) canvas.addEventListener(type, (e) => { if (e.pointerType !== 'mouse' || type === 'pointerleave') pointer = null; });
  sizes.observe(canvas, { box: 'device-pixel-content-box' });
  seen.observe(canvas);
}

// ---- Size -----------------------------------------------------------------

// The canvas has exactly one pixel for each screen pixel. Subpixel text depends on it.
let deviceSize = null;
const sizes = new ResizeObserver((entries) => {
  const box = entries.at(-1).devicePixelContentBoxSize?.[0];
  deviceSize = box ? { w: box.inlineSize, h: box.blockSize } : null;
  resize();
  schedule();
});
function resize() {
  if (!canvas.isConnected || !canvas.clientWidth) return;
  // The observer's device pixel size is exact. Where it disagrees with devicePixelRatio (an emulated phone), the ratio is used.
  const exact = deviceSize && Math.abs(deviceSize.w / (canvas.clientWidth * devicePixelRatio) - 1) < 0.02;
  const w = Math.max(2, exact ? deviceSize.w : Math.round(canvas.clientWidth * devicePixelRatio));
  const h = Math.max(2, exact ? deviceSize.h : Math.round(canvas.clientHeight * devicePixelRatio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  px = w / canvas.clientWidth;
  L = layout(w, h, wide.matches ? 3 : 2);
  placed = '';
}

// #region words
// Lay the text element out so that its texture has three texels for each canvas pixel of the block it is shown in.
function sizeWords(target, words, texels, box, scale) {
  const perCSS = texels / words.offsetWidth; // texels for each CSS pixel of layout
  const shown = Math.floor(box.w / 2) - 2 * Math.round(8 * scale); // canvas pixels: half of the text tile
  const width = `${((3 * shown) / perCSS).toFixed(1)}px`;
  const k = ((3 * scale) / perCSS).toFixed(3);
  if (words.style.getPropertyValue('--w') === width && words.style.getPropertyValue('--k') === k) return false;
  words.style.setProperty('--w', width);
  words.style.setProperty('--k', k);
  target.requestPaint?.();
  return true;
}
// #endregion words

// ---- Frame ----------------------------------------------------------------

let dirty = true;
let raf = 0;
let visible = true;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let clock = 0;
let last = 0;
let pointer = null;
let firstFrames = 0;
let placed = '';
const seen = new IntersectionObserver((entries) => {
  visible = entries.at(-1).isIntersecting;
  schedule();
});
document.addEventListener('visibilitychange', schedule);
function schedule() {
  if (!raf && stage && visible && !document.hidden) raf = requestAnimationFrame(frame);
}

// #region frame
function frame(now) {
  raf = 0;
  if (!stage || !L) return;
  // The elements are uploaded again only after the canvas says they were repainted.
  if (dirty) {
    try {
      stage.upload();
      dirty = false;
      sizeWords(canvas, els.words, stage.sizes.words.w, L.tiles.text, px);
    } catch {
      canvas.requestPaint?.(); // "no cached paint record": nothing has been painted yet
      return;
    }
  }
  const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
  last = now;
  if (!paused) clock += dt;
  const live = pointer && now - pointer.at < 4000 ? pointer : null;
  const S = scene({ t: clock, L, size: stage.sizes, px, pointer: live, fade: paused ? 1 : 0.95 ** (dt * 60), stamp: !paused });
  if (stage.route === 'webgpu' && firstFrames < 2) {
    // The first frames are watched: a validation error or an empty canvas sends the page to WebGL.
    firstFrames++;
    watchFrame(stage.device, () => stage.draw(S, L), fallBack);
    stage.surface.shown(fallBack);
  } else stage.draw(S, L);
  place(S.geometry);
  if (!paused) schedule();
}

// The form and the text take clicks, focus and selection where they are drawn.
let unit = 1; // canvasTransform is in CSS pixels on some canvases and in canvas pixels on others: measured once
function place(g) {
  const key = JSON.stringify(g);
  if (key === placed) return;
  placed = key;
  for (const [name, r] of Object.entries(g)) {
    const el = els[name];
    const set = () => canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix().translate((r.x / px) * unit, (r.y / px) * unit).scale((r.w / px / el.offsetWidth) * unit) });
    set();
    const drawn = el.getBoundingClientRect().width;
    if (name === 'card' && drawn > 0 && Math.abs(drawn / (r.w / px) - 1) > 0.1) {
      unit *= r.w / px / drawn;
      set();
    }
  }
}
// #endregion frame

$('pause').onclick = () => {
  paused = !paused;
  $('pause').textContent = paused ? 'Play' : 'Pause';
  last = 0;
  schedule();
};
$('pause').textContent = paused ? 'Play' : 'Pause';
wide.addEventListener('change', () => { resize(); schedule(); });

// ---- The table ------------------------------------------------------------

const WITHOUT = {
  swizzle: 'The glow shader is compiled a second time to read .a.',
  immediates: 'One uniform buffer with a 256-byte slot for each draw, picked with a dynamic offset.',
  primitive: 'The vertex shader passes vertex_index / 3 down as a flat varying.',
  dual: 'The three coverages are averaged and blended as plain alpha.',
};
const WEBGL = {
  swizzle: 'The WebGL shader reads .a.',
  immediates: 'WebGL sets three vec4 uniforms before each draw.',
  primitive: 'The vertex shader passes gl_VertexID / 3 down as a flat varying.',
  dual: 'The three coverages are averaged and blended as plain alpha.',
};
const SHORT = { swizzle: ['swizzled view', 'shader reads .a'], immediates: ['setImmediates()', 'uniform buffer'], primitive: ['primitive_index', 'flat varying'], dual: ['dual-source blend', 'plain alpha'] };
function describe() {
  const cell = (row) => document.querySelector(`tr[data-row=${row}] .now`);
  const label = (tile) => document.querySelector(`#labels [data-tile=${tile}] span`);
  const tiles = { swizzle: 'mask', immediates: 'copies', primitive: 'shards', dual: 'text' };
  const f = stage?.features;
  const fill = (row, on, text) => (cell(row).innerHTML = `<span class="${on ? 'on' : ''}">${on ? 'In use.' : 'Not in use.'}</span> ${text}`);
  if (!stage) {
    for (const row of ['level', 'swizzle', 'immediates', 'float', 'primitive', 'dual']) cell(row).textContent = 'Nothing is drawn.';
    return;
  }
  if (!f) {
    cell('level').innerHTML = `WebGL 2. ${state.gpuNote ? `WebGPU is not in use: ${state.gpuNote.replace(/\.$/, '')}.` : ''}`;
    for (const key of Object.keys(tiles)) {
      fill(key, false, WEBGL[key]);
      label(tiles[key]).textContent = `WebGL: ${key === 'immediates' ? 'uniforms' : SHORT[key][1]}`;
    }
    fill('float', false, `The WebGL trail target is ${stage.accumFormat === 'rgba16float' ? 'RGBA16F (EXT_color_buffer_float)' : 'RGBA8, so trails leave a mark'}.`);
    label('trails').textContent = `WebGL: ${stage.accumFormat}`;
    return;
  }
  const info = stage.gpu.adapter.info ?? {};
  const asked = choice === 'webgpu-compat' && f.level === 'core' ? ' A compatibility mode adapter was asked for and this one gives core devices.' : '';
  cell('level').innerHTML = `<span class="on">${f.level === 'core' ? 'Core' : 'Compatibility mode'}.</span> ${[info.vendor, info.architecture].filter(Boolean).join(' ')}${stage.gpu.software ? ' (software)' : ''}${asked}`;
  for (const key of Object.keys(tiles)) {
    fill(key, f[key].on, f[key].on ? '' : `${cap(f[key].why)}. ${WITHOUT[key]}`);
    label(tiles[key]).textContent = SHORT[key][f[key].on ? 0 : 1];
  }
  const format = stage.accumFormat;
  fill('float', format === 'rgba32float', format === 'rgba32float' ? 'The trail target is rgba32float.' : `${cap(f.float32.why)}. The trail target is ${format}${format === 'rgba8unorm' ? ', so trails leave a mark' : ', which every core device can blend into'}.`);
  label('trails').textContent = format;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).replace(/\.$/, '') : '');

// ---- Start ----------------------------------------------------------------

watchCanvas();
const route = routeSwitch($('route'), {
  targets: () => [state],
  values: { webgpu: 'webgpu', 'webgpu-compat': 'webgpu-compat', webgl: 'webgl' },
  active: (s) => s.backend,
  note: (s) => (s.backend === 'webgpu-compat' ? '' : s.gpuNote),
  apply: (want) => start(want),
});
// routeSwitch has already called start() when the address names a route.
if (!turn) start('');

// ---- Live checks ----------------------------------------------------------

const bench = supported ? checkBench() : null;
const SIZE = { w: 360, h: 450 };

// A copy of the canvas on the bench, drawn off screen by a device that is never shown.
async function fixture({ gl = false, use = {}, compat = false } = {}) {
  bench.replaceChildren(); // one canvas at a time, so the bench never grows past what is on screen
  const c = document.createElement('canvas');
  c.setAttribute('content', 'drawable');
  c.setAttribute('layoutsubtree', '');
  c.width = SIZE.w;
  c.height = SIZE.h;
  c.style.cssText = `display:block;width:${SIZE.w}px;height:${SIZE.h}px`;
  const copy = { card: els.card.cloneNode(true), words: els.words.cloneNode(true) };
  for (const el of Object.values(copy)) { el.removeAttribute('id'); el.querySelector('[id]')?.removeAttribute('id'); el.removeAttribute('style'); }
  c.append(copy.card, copy.words);
  bench.append(c);
  let st;
  if (gl) st = await GLStage.create(c, copy);
  else {
    const gpu = await webgpu({ force: true, compat: compat ? 'only' : false });
    if (!gpu) throw new NotRun(`no WebGPU device (${compat ? webgpu.compatReason : webgpu.reason})`);
    st = await GPUStage.create(c, gpu, copy, { present: false, use });
  }
  made.push(st);
  const lay = layout(SIZE.w, SIZE.h, 2);
  await nextPaint(c);
  st.upload();
  if (sizeWords(c, copy.words, st.sizes.words.w, lay.tiles.text, 1)) {
    await nextPaint(c);
    st.upload();
  }
  const shot = async (options = {}) => {
    st.draw(scene({ t: 2.2, L: lay, size: st.sizes, px: 1, ...options }), lay, { clearTrail: options.clearTrail ?? true });
    return st.read();
  };
  return { stage: st, L: lay, shot, canvas: c };
}

/** Mean and largest difference per channel (out of 255) between two pictures, inside one tile, and how much of it has ink. */
function difference(a, b, r) {
  let sum = 0, max = 0, ink = 0, n = 0;
  const first = (r.y + 1) * a.width * 4 + (r.x + 1) * 4; // the tile's plain background
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a.data[i + c] - b.data[i + c]);
        sum += d;
        if (d > max) max = d;
      }
      if (Math.abs(a.data[i] - a.data[first]) + Math.abs(a.data[i + 1] - a.data[first + 1]) + Math.abs(a.data[i + 2] - a.data[first + 2]) + Math.abs(a.data[i + 3] - a.data[first + 3]) > 12) ink++;
      n++;
    }
  }
  return { mean: sum / (n * 4), max, ink: ink / n };
}
const at = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

// A check for something the device does not have is counted as an expected failure, with the reason.
class NotRun extends Error {
  constructor(why) {
    super(why);
    this.name = 'Not run on this device';
  }
}
const made = [];
function tidy() {
  for (const s of made.splice(0)) { try { s.destroy(); } catch {} }
}

// Draw with the feature and without it, and compare the tile. `need` is the feature the device must have.
function bothWays(key, tile, { tolerance = 2 } = {}) {
  return async () => {
    const on = await fixture();
    const f = on.stage.features[key];
    if (!f.on) throw new NotRun(f.why);
    const a = await on.shot();
    const off = await fixture({ use: { [key]: false } });
    const b = await off.shot();
    const d = difference(a, b, on.L.tiles[tile]);
    if (d.ink < 0.01) throw new Error('the tile is empty');
    if (d.max > tolerance) throw new Error(`the two pictures differ: mean ${d.mean.toFixed(3)}, largest ${d.max} of 255`);
    return `same picture both ways: largest difference ${d.max} of 255 over a ${on.L.tiles[tile].w} × ${on.L.tiles[tile].h} tile`;
  };
}

// Stamp the card in one place `stamps` times, then fade `fades` times with nothing added. Returns the middle pixel of the trails tile.
async function trailRun(use, stamps, fades) {
  const fx = await fixture({ use });
  const box = fx.L.tiles.trails;
  const pointer = { x: box.w / 2, y: box.h / 2 };
  let image;
  for (let i = 0; i < stamps; i++) image = await fx.shot({ t: 0, pointer, fade: 1, clearTrail: i === 0 });
  const peak = at(image, box.x + (box.w >> 1), box.y + (box.h >> 1) + 12);
  for (let i = 0; i < fades; i++) fx.stage.draw(scene({ t: 0, L: fx.L, size: fx.stage.sizes, px: 1, fade: 0.95, stamp: false }), fx.L);
  image = await fx.stage.read();
  const left = at(image, box.x + (box.w >> 1), box.y + (box.h >> 1) + 12);
  // The tile's background shows through where the trail is empty, so it is taken off.
  const base = at(image, box.x + 2, box.y + 2);
  const over = (pixel) => Math.max(0, ...pixel.slice(0, 3).map((v, i) => v - base[i]));
  return { peak: Math.max(...peak.slice(0, 3)), left: over(left), format: fx.stage.accumFormat };
}

const tests = [
  {
    name: 'A WebGPU device with the optional features the adapter has',
    why: 'backend.js asks the adapter for each feature in OPTIONAL_FEATURES that it lists. This row names what the device ended up with.',
    run: async () => {
      const gpu = await webgpu({ force: true });
      if (!gpu) throw new NotRun(`no WebGPU device (${webgpu.reason})`);
      const on = ['texture-component-swizzle', 'float32-blendable', 'primitive-index', 'dual-source-blending'].map((n) => `${n} ${gpu.device.features.has(n) ? 'yes' : 'no'}`);
      return `${gpu.level} device${gpu.software ? ' on a software adapter' : ''}; ${on.join(', ')}; immediates ${navigator.gpu.wgslLanguageFeatures.has('immediate_address_space') ? `yes, up to ${gpu.device.limits.maxImmediateSize} bytes` : 'no'}`;
    },
  },
  {
    name: 'A compatibility mode adapter can be asked for',
    why: 'requestAdapter({ featureLevel: "compatibility" }). A device from it is a compatibility device unless it asks for core-features-and-limits.',
    run: async () => {
      const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
      if (!adapter) throw new NotRun('no compatibility mode adapter');
      const core = adapter.features.has('core-features-and-limits');
      const device = await adapter.requestDevice();
      const level = device.features.has('core-features-and-limits') ? 'core' : 'compatibility';
      const limits = `maxTextureDimension2D ${device.limits.maxTextureDimension2D}, maxColorAttachments ${device.limits.maxColorAttachments}`;
      device.destroy();
      return `the adapter ${core ? 'can also give core devices' : 'is compatibility only'}; a device made with no features asked for is a ${level} device (${limits})`;
    },
  },
  { name: 'Swizzled view: the glow is the same as reading .a', why: 'createView({ swizzle: "aaa1" }) on the element texture, against the shader compiled to read alpha.', timeout: 15000, run: bothWays('swizzle', 'mask') },
  { name: 'Immediates: twelve draws are the same as with a uniform buffer', why: 'pass.setImmediates(0, floats) before each draw, against one uniform buffer with a dynamic offset.', timeout: 15000, run: bothWays('immediates', 'copies') },
  { name: 'primitive_index: the shards are the same as with a flat varying', why: '@builtin(primitive_index) in the fragment shader, against vertex_index / 3 passed down from the vertex shader. Drawn half way apart.', timeout: 15000, run: bothWays('primitive', 'shards') },
  {
    name: 'Dual-source blending: a different coverage in each colour channel',
    why: 'The text tile with dual-source blending has pixels whose red and blue differ at glyph edges. Averaged over the three channels it matches the plain alpha version.',
    timeout: 15000,
    async run() {
      const on = await fixture();
      const f = on.stage.features.dual;
      if (!f.on) throw new NotRun(f.why);
      const a = await on.shot();
      const off = await fixture({ use: { dual: false } });
      const b = await off.shot();
      const r = on.L.tiles.text;
      let coloured = 0, worst = 0;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = (y * a.width + x) * 4;
          if (Math.abs(a.data[i] - a.data[i + 2]) > 24) coloured++;
          worst = Math.max(worst, Math.abs((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3 - (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3));
        }
      }
      if (!coloured) throw new Error('no pixel has different red and blue');
      if (worst > 3) throw new Error(`the average of the channels is ${worst.toFixed(1)} of 255 away from the plain alpha picture`);
      return `${coloured} pixels have red and blue more than 24 apart; the channel average is within ${worst.toFixed(1)} of 255 of the plain alpha picture`;
    },
  },
  {
    name: 'Float trail target: sums above 1.0 are kept and the fade reaches zero',
    why: 'The card is added to the trail 8 times in one place, then the trail is faded 200 times. Compared across rgba32float, rgba16float and rgba8unorm.',
    timeout: 30000,
    async run() {
      const out = [];
      const seen = {};
      for (const use of [{}, { float32: false }, { float32: false, float16: false }]) {
        const r = await trailRun(use, 8, 200);
        if (seen[r.format]) continue;
        seen[r.format] = r;
        out.push(`${r.format}: ${r.peak} of 255 after 8 additions, ${r.left} above the background after 200 fades`);
      }
      const float = seen.rgba32float ?? seen.rgba16float;
      const eight = seen.rgba8unorm;
      if (!float) throw new Error(`no float target on this device. ${out.join('; ')}`);
      if (float.left > 2) throw new Error(`the float trail did not fade out. ${out.join('; ')}`);
      if (float.peak <= eight.peak) throw new Error(`the float target kept no more than the 8-bit one. ${out.join('; ')}`);
      if (seen.rgba32float && seen.rgba16float && Math.abs(seen.rgba32float.peak - seen.rgba16float.peak) > 2) throw new Error(`rgba32float and rgba16float differ. ${out.join('; ')}`);
      return out.join('; ');
    },
  },
  {
    name: 'A compatibility mode device draws the same picture as a core one',
    why: 'Every shader and pipeline on this page, built on a device from a compatibility mode adapter, against the core device. Each feature is used where both devices have it.',
    timeout: 20000,
    async run() {
      const core = await fixture();
      const a = await core.shot();
      const had = core.stage.features;
      const compat = await fixture({ compat: true });
      const f = compat.stage.features;
      if (f.level !== 'compatibility') return `the compatibility mode adapter gave a ${f.level} device, so there is nothing to compare`;
      const b = await compat.shot();
      const parts = [];
      for (const [tile, r] of Object.entries(compat.L.tiles)) {
        const d = difference(a, b, r);
        if (d.max > 2) throw new Error(`the ${tile} tile differs: mean ${d.mean.toFixed(3)}, largest ${d.max} of 255`);
        parts.push(tile);
      }
      const lost = ['swizzle', 'immediates', 'float32', 'primitive', 'dual'].filter((k) => had[k].on && !f[k].on);
      return `${parts.length} tiles match within 2 of 255; trail target ${compat.stage.accumFormat}; ${lost.length ? `not on the compatibility device: ${lost.join(', ')}` : 'the compatibility device has every feature the core one has'}`;
    },
  },
  {
    name: 'WebGL draws the same picture as WebGPU',
    why: 'The same frame through the WebGL 2 shaders and the WebGPU shaders with every feature switched off, tile by tile.',
    timeout: 20000,
    async run() {
      const off = { swizzle: false, immediates: false, float32: false, primitive: false, dual: false };
      const g = await fixture({ use: off });
      const a = await g.shot();
      const w = await fixture({ gl: true });
      const b = await w.shot();
      const parts = [];
      let worst = 0;
      for (const [tile, r] of Object.entries(w.L.tiles)) {
        const d = difference(a, b, r);
        parts.push(`${tile} mean ${d.mean.toFixed(2)}`);
        worst = Math.max(worst, d.mean);
        if (d.ink < 0.005) throw new Error(`the ${tile} tile is empty`);
      }
      if (worst > 1.5) throw new Error(`a tile differs by more than 1.5 of 255 on average: ${parts.join(', ')}`);
      return `difference per channel out of 255: ${parts.join(', ')}`;
    },
  },
  {
    name: 'The canvas above still has a picture',
    why: 'Run last, after the fixtures. The page must still be drawing.',
    run: async () => {
      if (state.backend === 'plain') throw new Error('the page is showing plain HTML');
      if (!stage) throw new Error('nothing is drawing');
      const probe = new OffscreenCanvas(48, 48).getContext('2d', { willReadFrequently: true });
      // A canvas can only be copied in the task that drew it, so draw a frame here.
      cancelAnimationFrame(raf);
      frame(performance.now());
      probe.drawImage(canvas, 0, 0, 48, 48);
      const d = probe.getImageData(0, 0, 48, 48).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
      if (!ink) throw new Error(`the ${state.backend} canvas is empty`);
      return `drawn with ${state.backend}, ${Math.round((ink / 2304) * 100)}% of sampled pixels have ink`;
    },
  },
];

if (supported) {
  for (const t of tests) {
    const run = t.run;
    t.run = async () => {
      try { return await run(); } catch (err) { if (err instanceof NotRun) t.expect = 'fail'; throw err; } finally { tidy(); }
    };
  }
  runTests($('results'), onBench(bench, tests)).then(() => bench.done());
} else {
  runTests($('results'), [{ name: 'HTML-in-canvas is available', why: 'The checks need canvas[layoutsubtree] and drawElementImageToTexture().', run: async () => { throw new Error('not in this browser'); } }]);
}
