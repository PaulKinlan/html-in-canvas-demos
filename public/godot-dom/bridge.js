// bridge.js: the browser side of godot-dom. It starts the Godot engine on a canvas that has a
// DOM form as its child, and gives the GDScript in app/src/main.gd an object, window.godotDom,
// that holds the HTML-in-canvas calls: getElementImageDefaultSize(), texElementSubImage2D()
// and updateElementGeometry().

const APP = '/godot-dom/app/index';
export const ROUTES = ['gl', 'hook', 'pixels'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

// #region wasm
/**
 * The engine's index.wasm is 39.5 MB and one static asset on Cloudflare Workers may be at
 * most 25 MiB, so the file is stored gzip-compressed (10.1 MB). Fetch it, inflate it with
 * DecompressionStream, and answer the engine's own fetch('…/index.wasm') with the result.
 */
async function fetchWasm(onProgress) {
  const response = await fetch(`${APP}.wasm.gz`);
  if (!response.ok) throw new Error(`index.wasm.gz: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const blob = new Blob(chunks);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  // A server that sends Content-Encoding: gzip has the browser inflate the file already.
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const body = gzipped ? blob.stream().pipeThrough(new DecompressionStream('gzip')) : blob.stream();
  return { body, bytes: loaded, gzipped };
}

/** While `run` is pending, the engine's request for index.wasm gets `body`. */
async function withWasm(body, run) {
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    if (!url.endsWith('.wasm')) return realFetch.call(window, input, init);
    // application/wasm lets WebAssembly.instantiateStreaming() compile while it inflates.
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/wasm' } }));
  };
  try {
    return await run();
  } finally {
    window.fetch = realFetch;
  }
}
// #endregion wasm

// #region matrix
/**
 * The matrix that takes the form's own box (0,0)-(w,h) to four points on screen, in the order
 * top left, top right, bottom right, bottom left. A flat quad seen in perspective is a
 * homography, which fits in a 4×4 DOMMatrix with the perspective terms in m14 and m24.
 */
function quadMatrix(w, h, [x0, y0, x1, y1, x2, y2, x3, y3]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const k = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  return new DOMMatrix([a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1]);
}
// #endregion matrix

/**
 * Start Godot on `canvas`. `form` is the drawable child the scene shows.
 * stopEvents false leaves out the event guard, to measure what Godot does without it.
 * Resolves with { stats, probes, setRoute, gl, engine } once the engine's main loop runs.
 */
export async function startGodot({ canvas, form, route = 'gl', stopEvents = true, onProgress, onLost, onError } = {}) {
  const stats = {
    route, paints: 0, uploads: 0, places: 0, uploadMs: 0, lastError: '', engineError: '', textureName: 0,
    hooked: 0, size: [0, 0], corners: null, unit: 1, wasmBytes: 0, gzipped: false, startMs: 0,
  };
  const probes = {};
  let gl = null;
  let texture = null;   // the WebGLTexture Godot samples (routes gl and hook)
  let own = null;       // { texture, framebuffer, bytes } for the pixels route
  let dirty = false;
  let listener = null;
  let unit = { key: '', value: 1 };
  let created = null;
  let realCreateTexture = null;

  // ------------------------------------------------------------ the element's image
  function measure() {
    try {
      const size = canvas.getElementImageDefaultSize(form);
      stats.size = [Math.max(1, Math.ceil(size.width)), Math.max(1, Math.ceil(size.height))];
    } catch {
      stats.size = [0, 0]; // no paint record yet, or no HTML-in-canvas
    }
  }

  // #region upload
  // Copy the form's pixels into the texture Godot samples. Godot keeps its own idea of the
  // GL state, so the binding is put back afterwards.
  function upload() {
    if (!gl || !texture) return false;
    const t0 = performance.now();
    const unitWas = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const boundWas = gl.getParameter(gl.TEXTURE_BINDING_2D);
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // The form is opaque and Godot's shader ignores alpha, so no premultiplication.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, form); // row 0 is the top of the form
      gl.generateMipmap(gl.TEXTURE_2D); // Godot was told the texture has mipmaps
      dirty = false;
      stats.uploads++;
      stats.uploadMs = performance.now() - t0;
      return true;
    } catch (err) {
      stats.lastError = `${err.name}: ${err.message}`;
      canvas.requestPaint?.();
      return false;
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, boundWas);
      gl.activeTexture(unitWas);
    }
  }
  // #endregion upload

  // #region read-pixels
  // The pixels route: upload into a texture this page made, read it back through a
  // framebuffer and hand the bytes to GDScript, which builds an Image from them.
  function ownTexture(w, h) {
    if (own) { gl.deleteTexture(own.texture); gl.deleteFramebuffer(own.framebuffer); }
    const boundWas = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    own = { texture: gl.createTexture(), framebuffer: gl.createFramebuffer(), bytes: new Uint8Array(w * h * 4), w, h };
    gl.bindTexture(gl.TEXTURE_2D, own.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, own.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, own.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
    gl.bindTexture(gl.TEXTURE_2D, boundWas);
    texture = null;
    dirty = true;
  }

  function readPixels() {
    if (!gl || !own) return null;
    const t0 = performance.now();
    const unitWas = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const boundWas = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    try {
      gl.bindTexture(gl.TEXTURE_2D, own.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, form);
      gl.bindFramebuffer(gl.FRAMEBUFFER, own.framebuffer);
      gl.readPixels(0, 0, own.w, own.h, gl.RGBA, gl.UNSIGNED_BYTE, own.bytes);
      dirty = false;
      stats.uploads++;
      stats.uploadMs = performance.now() - t0;
      return own.bytes;
    } catch (err) {
      stats.lastError = `${err.name}: ${err.message}`;
      canvas.requestPaint?.();
      return null;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
      gl.bindTexture(gl.TEXTURE_2D, boundWas);
      gl.activeTexture(unitWas);
    }
  }
  // #endregion read-pixels

  // ------------------------------------------------------------ geometry
  // updateElementGeometry()'s canvasTransform has been seen in CSS px on some canvases and in
  // buffer px on others. Measure which one this canvas uses (same method as lib/surface.js).
  function geometryUnit() {
    const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${form.offsetWidth}`;
    if (unit.key === key) return unit.value;
    canvas.updateElementGeometry(form, { canvasTransform: new DOMMatrix() });
    const measured = form.getBoundingClientRect().width;
    const zoom = form.currentCSSZoom || 1;
    if (measured > 0 && form.offsetWidth > 0) unit = { key, value: (form.offsetWidth * zoom) / measured };
    stats.unit = unit.value;
    return unit.value;
  }

  // #region place
  // Godot projected the quad's corners and passes them as fractions of the canvas. Tell the
  // browser, so that hit testing, focus rings, the caret and accessibility bounds are there.
  function place(...fractions) {
    if (!canvas.updateElementGeometry || !form.offsetWidth) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const corners = fractions.map((f, i) => f * (i % 2 ? ch : cw)); // CSS px in the canvas
    try {
      const u = geometryUnit();
      const m = quadMatrix(form.offsetWidth, form.offsetHeight, corners);
      canvas.updateElementGeometry(form, { canvasTransform: new DOMMatrix().scale(u).multiply(m) });
      // Chromium 157 keeps hit-test results cached from before the move. A DOM mutation drops them.
      canvas.toggleAttribute('data-geometry-tick');
      stats.corners = corners;
      stats.places++;
    } catch (err) {
      stats.lastError = `${err.name}: ${err.message}`;
    }
  }
  // #endregion place

  // #region interface
  // What GDScript sees as JavaScriptBridge.get_interface("godotDom").
  window.godotDom = {
    route: () => stats.route,
    imageWidth: () => stats.size[0],
    imageHeight: () => stats.size[1],
    dirty: () => dirty,
    busy: () => form.contains(document.activeElement),
    // Route "gl": GDScript looked the texture up in Emscripten's GL.textures and passes it here.
    adopt(webglTexture, w, h, name) {
      texture = webglTexture ?? null;
      stats.textureName = name;
      dirty = true;
      if (!texture) stats.lastError = `GL.textures[${name}] is empty`;
    },
    // Route "hook": record the textures Godot creates while it builds its ImageTexture.
    hookBegin() {
      created = [];
      realCreateTexture = gl.createTexture;
      gl.createTexture = function () {
        const t = realCreateTexture.call(gl);
        created.push(t);
        return t;
      };
    },
    hookEnd() {
      delete gl.createTexture; // back to the prototype's method
      stats.hooked = created.length;
      texture = created.at(-1) ?? null;
      dirty = true;
      if (!texture) stats.lastError = 'Godot created no texture between hookBegin() and hookEnd()';
    },
    ownTexture,
    readPixels,
    upload,
    place,
    probe: (key, value) => { probes[key] = value; },
    listen: (callback) => { listener = callback; },
  };
  // #endregion interface

  // #region events
  // Godot listens on the canvas (mouse, touch, keys, wheel) and on the window (mouseup, paste).
  // An event that the browser delivered to the form stops at the form. Without this Godot's
  // mousedown handler calls canvas.focus() and the field loses focus as soon as it gets it.
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel', 'keydown', 'keyup', 'paste']) {
    if (stopEvents) form.addEventListener(type, (event) => event.stopPropagation());
  }
  // #endregion events
  wireForm(form, (kind, text) => listener?.(kind, text));

  // ------------------------------------------------------------ canvas size
  // Godot runs with canvasResizePolicy 0: it draws at whatever size the canvas buffer has.
  const resize = (w, h) => {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
  new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    if (box) resize(box.inlineSize, box.blockSize);
    else resize(entry.contentRect.width * dpr, entry.contentRect.height * dpr);
  }).observe(canvas);

  // #region start
  const t0 = performance.now();
  if (!window.Engine) await loadScript(`${APP}.js`); // the engine's loader, 280 kB
  const wasm = await fetchWasm(onProgress);
  stats.wasmBytes = wasm.bytes;
  stats.gzipped = wasm.gzipped;
  const engine = new window.Engine({
    canvas,                       // Godot draws into the canvas that holds the form
    executable: APP,
    mainPack: `${APP}.pck`,
    canvasResizePolicy: 0,        // the page sizes the canvas
    focusCanvas: false,           // do not take focus from the reader
    args: [],
    onPrintError: (...args) => { stats.engineError = args.join(' '); },
    onExit: (code) => onError?.(`Godot exited with code ${code}`),
  });
  await withWasm(wasm.body, () => engine.startGame());
  // The same context object Godot made: getContext() returns the existing one.
  gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('Godot started without a WebGL2 context');
  // #endregion start
  stats.startMs = Math.round(performance.now() - t0);
  probes.engine_rtenv_GL = typeof engine.rtenv?.GL === 'object';

  // #region paint
  // The browser painted the form. Note it, and let GDScript upload on its next frame.
  canvas.addEventListener('paint', () => {
    stats.paints++;
    measure();
    dirty = true;
  });
  canvas.requestPaint?.();
  // #endregion paint

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    onLost?.();
  });

  const api = {
    stats, probes, gl, engine,
    setRoute(next) {
      if (!ROUTES.includes(next) || next === stats.route) return;
      stats.route = next; // GDScript reads this each frame and makes a new texture
      stats.uploads = 0;
      stats.lastError = '';
      dirty = true;
    },
  };
  return api;
}

// The form's own behaviour: plain DOM, nothing to do with Godot except the two notices.
function wireForm(form, notify) {
  const log = form.querySelector('[data-log]');
  const chat = form.querySelector('textarea');
  const say = (who, text) => {
    const line = document.createElement('div');
    line.textContent = `${who}: ${text}`;
    log.append(line);
    while (log.children.length > 3) log.firstChild.remove();
  };
  const send = () => {
    const text = chat.value.trim();
    if (!text) return;
    say('you', text);
    chat.value = '';
    notify('chat', text);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = form.elements.email.value.trim();
    if (!email || !form.elements.email.checkValidity()) {
      say('form', 'enter an email address first');
      return;
    }
    form.dataset.signedIn = '';
    say('form', `signed in as ${email}`);
    notify('signin', email);
  });
  form.querySelector('[data-send]').addEventListener('click', send);
  chat.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
  });
}

export { sleep };
