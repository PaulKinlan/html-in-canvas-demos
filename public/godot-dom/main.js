// The page script for /godot-dom/. bridge.js starts the engine; app/src/main.gd is the scene.
import { banner, runTests } from '/shared/support.js';
import { startGodot } from '/godot-dom/bridge.js';

banner();
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUTE_NAMES = { gl: 'GL.textures', hook: 'createTexture hook', pixels: 'read back to an Image' };

// ---------------------------------------------------------------- the visible demo
// #region load
const msg = $('msg');
const routeButtons = [...document.querySelectorAll('[data-route]')];
let app = null;

async function load() {
  msg.textContent = '';
  const text = document.createElement('span');
  const bar = document.createElement('progress');
  text.textContent = 'Downloading Godot…';
  msg.append(text, bar);
  try {
    app = await startGodot({
      canvas: $('godot'),
      form: $('form'),
      route: 'gl',
      onProgress: (loaded, total) => {
        if (total) { bar.max = total; bar.value = loaded; }
        text.textContent = `Downloading Godot: ${(loaded / 1e6).toFixed(1)} MB${loaded === total ? ', starting…' : ''}`;
      },
      onLost: () => show('The WebGL context was lost, so Godot has stopped drawing. Reload the page to start it again.'),
    });
  } catch (err) {
    show(`Godot did not start: ${err?.message ?? err}. It needs WebAssembly and WebGL2.`);
    return;
  }
  msg.hidden = true;
  for (const b of routeButtons) b.disabled = false;
  watch();
}
$('load').addEventListener('click', load, { once: true });
// #endregion load

function show(textContent, corner = false) {
  msg.hidden = false;
  msg.classList.toggle('corner', corner);
  msg.textContent = textContent;
}

for (const b of routeButtons) {
  b.addEventListener('click', () => {
    if (!app) return;
    app.setRoute(b.dataset.route);
    for (const other of routeButtons) other.setAttribute('aria-pressed', String(other === b));
  });
}

// A status line under the stage, and a message on it if the form never reaches the quad.
function watch() {
  const started = Date.now();
  const hud = $('hud');
  let last = '';
  setInterval(() => {
    const s = app.stats;
    const line = s.uploads
      ? `${s.size[0]}×${s.size[1]} texels, ${s.uploads} uploads, last took ${s.uploadMs.toFixed(1)} ms`
      : (s.lastError || 'waiting for the first paint');
    if (line !== last) hud.textContent = last = line;
    if (!s.uploads && Date.now() - started > 6000 && msg.hidden) {
      show(`Godot is running, but the form was not drawn on the quad. ${s.lastError || 'HTML-in-canvas may be off in this browser.'}`, true);
    } else if (s.uploads && !msg.hidden && msg.classList.contains('corner')) {
      msg.hidden = true;
    }
  }, 500);
}

// ---------------------------------------------------------------- live checks
// All checks share one framed copy of the app, fixed to the corner of the window.
let frame = null;
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:360px;height:560px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:360px;height:560px';
  f.tabIndex = -1;
  f.src = '/godot-dom/fixture.html?route=gl';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  for (let i = 0; i < 1200 && !win.__failed && !win.__godot?.stats.uploads; i++) {
    await sleep(100);
    if (win.__godot && i % 10 === 0 && !win.__godot.stats.uploads && win.__godot.stats.lastError && i > 100) break;
  }
  if (win.__failed) throw new Error(`the app did not start: ${win.__failed}`);
  if (!win.__godot) throw new Error('the app did not start in time');
  frame = { holder, win, doc: f.contentDocument, app: win.__godot };
  return frame;
}

// Read one pixel of what Godot drew, at a point given in the frame's client coordinates.
// A requestAnimationFrame callback registered here runs after Godot's own, in the same frame,
// so the default framebuffer still holds the picture.
function drawnPixel(fx, x, y) {
  const { win, app: a } = fx;
  const canvas = win.document.getElementById('godot');
  return new Promise((resolve) => win.requestAnimationFrame(() => {
    const gl = a.gl;
    const r = canvas.getBoundingClientRect();
    const px = Math.round((x - r.x) * canvas.width / r.width);
    const py = canvas.height - 1 - Math.floor((y - r.y) * canvas.height / r.height);
    const was = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8Array(4);
    // gfx-allow: timed-readback one pixel, once per live check after a tap; Godot's framebuffer is cleared after the frame, so it can only be read in the frame callback
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, was);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    resolve([out[0], out[1], out[2]]);
  }));
}
const near = (a, b, tol = 28) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const BLUE = [31, 79, 191];    // .band background
const PINK = [208, 16, 154];   // .check .band background

// The band's colour as Godot drew it, at the place the browser says the band is. An orbiting
// object can be in front for a moment, so look a few times.
async function bandColour(fx, want, ms = 6000) {
  const band = fx.doc.querySelector('.band');
  let got = null;
  for (const t0 = performance.now(); performance.now() - t0 < ms;) {
    const r = band.getBoundingClientRect();
    got = await drawnPixel(fx, r.x + r.width * 0.72, r.y + r.height / 2);
    if (near(got, want)) return got;
    await sleep(120);
  }
  throw new Error(`Godot drew rgb(${got}) where the band is; expected about rgb(${want})`);
}

async function useRoute(fx, route) {
  fx.app.setRoute(route);
  for (let i = 0; i < 80 && !(fx.app.stats.route === route && fx.app.stats.uploads); i++) await sleep(100);
  if (!fx.app.stats.uploads) throw new Error(`no upload on this route. ${fx.app.stats.lastError}`);
}

async function routeCheck(route) {
  const fx = await fixture();
  await useRoute(fx, route);
  fx.doc.getElementById('form').classList.remove('check');
  const blue = await bandColour(fx, BLUE);
  const before = fx.app.stats.uploads;
  fx.doc.getElementById('form').classList.add('check');
  const pink = await bandColour(fx, PINK);
  fx.doc.getElementById('form').classList.remove('check');
  const s = fx.app.stats;
  return { blue, pink, uploads: s.uploads - before, ms: s.uploadMs, s };
}

const tests = [
  {
    name: 'Godot starts from the gzip-compressed wasm file',
    why: 'index.wasm.gz is fetched, inflated with DecompressionStream and given to the engine in place of its own fetch of index.wasm.',
    timeout: 150000,
    run: async () => {
      const { app: a } = await fixture();
      const s = a.stats;
      return `${a.probes.godot}, ${a.probes.renderer}. ${(s.wasmBytes / 1e6).toFixed(1)} MB fetched${s.gzipped ? ' as gzip' : ', already inflated by the browser'}; running after ${(s.startMs / 1000).toFixed(1)} s`;
    },
  },
  {
    name: 'Which ways reach Emscripten\'s GL object',
    why: 'GL.textures maps Godot\'s GL texture names to WebGLTexture objects. GDScript tried four ways and the page one.',
    timeout: 150000,
    run: async () => {
      const { app: a } = await fixture();
      const p = a.probes;
      const yes = (v) => (v ? 'yes' : 'no');
      if (!p.eval_local) throw new Error('eval() inside the module did not see GL either');
      return `eval(code, false): ${yes(p.eval_local)}. eval(code, true): ${yes(p.eval_global)}. get_interface("GL"): ${yes(p.interface_GL)}. get_interface("Module"): ${yes(p.interface_Module)}. engine.rtenv.GL from the page: ${yes(p.engine_rtenv_GL)}`;
    },
  },
  {
    name: 'Route 1: texElementSubImage2D() into the texture found through GL.textures',
    why: 'Reads back a pixel Godot drew where the browser says the form\'s blue band is, then restyles the band and reads again.',
    timeout: 150000,
    run: async () => {
      const r = await routeCheck('gl');
      return `GL texture name ${r.s.textureName}, ${r.s.size.join('×')} texels. Drawn rgb(${r.blue}), then rgb(${r.pink}) after ${r.uploads} more upload(s). Last upload call ${r.ms.toFixed(1)} ms`;
    },
  },
  {
    name: 'The browser hit tests a field where Godot drew it',
    why: 'updateElementGeometry() with a perspective matrix made from the four corners Godot projected.',
    timeout: 20000,
    run: async () => {
      const fx = await fixture();
      const canvas = fx.doc.getElementById('godot');
      const form = fx.doc.getElementById('form');
      const email = form.elements.email;
      const e = email.getBoundingClientRect();
      const hit = fx.doc.elementFromPoint(e.x + e.width / 2, e.y + e.height / 2);
      if (hit !== email) throw new Error(`elementFromPoint gave <${hit?.localName}> at the email field`);
      // Compare the browser's box for the form with the bounds of Godot's corners.
      const c = fx.app.stats.corners;
      const o = canvas.getBoundingClientRect();
      const xs = [c[0], c[2], c[4], c[6]], ys = [c[1], c[3], c[5], c[7]];
      const f = form.getBoundingClientRect();
      const err = Math.max(
        Math.abs(f.left - o.x - Math.min(...xs)), Math.abs(f.right - o.x - Math.max(...xs)),
        Math.abs(f.top - o.y - Math.min(...ys)), Math.abs(f.bottom - o.y - Math.max(...ys)),
      );
      // The panel moves between Godot's frame and this read, so allow a few pixels.
      if (err > 6) throw new Error(`the form's box is ${err.toFixed(1)} px from Godot's corners`);
      const outside = fx.doc.elementFromPoint(o.x + 3, o.y + 3);
      return `<input> found at ${Math.round(e.x + e.width / 2)}, ${Math.round(e.y + e.height / 2)}. The form's box is within ${err.toFixed(1)} px of Godot's corners. The canvas corner hits <${outside?.localName}>. Geometry unit ${fx.app.stats.unit.toFixed(2)}`;
    },
  },
  {
    name: 'A press on a field does not reach Godot, a press beside the form does',
    why: 'Godot listens for mousedown on the canvas. The form stops the event. Godot counts the presses it gets and reports the count.',
    timeout: 20000,
    run: async () => {
      const fx = await fixture();
      const { win, doc, app: a } = fx;
      const canvas = doc.getElementById('godot');
      const email = doc.getElementById('form').elements.email;
      const count = () => Number(a.probes.godot_presses ?? 0);
      const press = (target, x, y) => {
        target.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
        target.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
      };
      const start = count();
      const e = email.getBoundingClientRect();
      press(email, e.x + 10, e.y + 10);
      await sleep(600);
      const afterField = count();
      if (afterField !== start) throw new Error('Godot also handled the press on the field');
      press(canvas, 4, 4);
      for (let i = 0; i < 30 && count() === afterField; i++) await sleep(100);
      if (count() === afterField) throw new Error('Godot did not get the press on the canvas');
      return `press on the <input>: Godot's count stayed at ${start}. Press on the canvas corner: ${count()}`;
    },
  },
  {
    name: 'Submitting the form changes text that Godot draws',
    why: 'The submit handler calls a GDScript function made with JavaScriptBridge.create_callback(). It sets a Label3D and reports the label text.',
    timeout: 20000,
    run: async () => {
      const fx = await fixture();
      const form = fx.doc.getElementById('form');
      form.elements.email.value = 'check@example.com';
      form.requestSubmit();
      for (let i = 0; i < 30 && !String(fx.app.probes.label ?? '').includes('check@example.com'); i++) await sleep(100);
      const label = String(fx.app.probes.label ?? '');
      if (!label.includes('check@example.com')) throw new Error(`the label is "${label}"`);
      return `Label3D text: "${label}"`;
    },
  },
  {
    name: 'Route 2: the texture found by wrapping gl.createTexture',
    why: 'No Emscripten internals. The page records the textures Godot creates while ImageTexture.create_from_image() runs.',
    timeout: 30000,
    run: async () => {
      const r = await routeCheck('hook');
      return `${r.s.hooked} texture created during the call. Drawn rgb(${r.blue}), then rgb(${r.pink}). Last upload call ${r.ms.toFixed(1)} ms`;
    },
  },
  {
    name: 'Route 3: read back with readPixels() and pass the bytes to Godot as an Image',
    why: 'The page uploads into its own texture, reads it back, and GDScript calls js_buffer_to_packed_byte_array() and ImageTexture.update().',
    timeout: 30000,
    run: async () => {
      const r = await routeCheck('pixels');
      const fx = await fixture();
      await useRoute(fx, 'gl');
      return `Drawn rgb(${r.blue}), then rgb(${r.pink}). Last upload and read-back ${r.ms.toFixed(1)} ms for ${r.s.size.join('×')} texels, before Godot's own copy`;
    },
  },
  {
    name: 'The fields have roles and names in the accessibility tree',
    why: 'They are ordinary elements in the canvas subtree. Godot\'s web export has no accessibility tree of its own.',
    timeout: 20000,
    run: async () => {
      const fx = await fixture();
      const form = fx.doc.getElementById('form');
      const parts = [form.elements.email, form.elements.password, form.elements.chat, form.querySelector('button[type=submit]')];
      const out = parts.map((el) => {
        const name = el.computedName ?? el.labels?.[0]?.textContent.trim() ?? el.textContent.trim();
        if (!name) throw new Error(`<${el.localName}> has no accessible name`);
        return `${el.computedRole ?? el.localName} "${name}"`;
      });
      return out.join(', ');
    },
  },
];

// Remove the copy from a task of its own, never from inside one of its paint events.
runTests($('results'), tests).then(() => setTimeout(() => { frame?.holder.remove(); frame = null; }, 0));
