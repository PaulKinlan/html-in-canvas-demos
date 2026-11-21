// bridge.js: the page's side of /flutter-dom/. The Dart code in app/src/main.dart calls the
// object this module puts at window.flutterDom.
//
// The form is a child of a 2D canvas with content="drawable". On every paint event the form
// is drawn into that canvas. Flutter takes the canvas as a texture source and draws the
// pixels in its own scene. The same canvas is laid over the Flutter view with opacity 0 and
// the matrix Flutter reports, so the browser delivers pointer and keyboard input to the real
// form where Flutter drew its picture.

/** How the pixels are handed to createImageFromTextureSource(). */
export const ROUTES = {
  'canvas-copy': 'The canvas, transferOwnership false. The engine calls createImageBitmap() on it.',
  'canvas-direct': 'The canvas, transferOwnership true. CanvasKit reads the canvas when it first draws the image.',
  'bitmap': 'The page calls createImageBitmap() and passes the ImageBitmap, transferOwnership true.',
  'element': 'The form itself, transferOwnership true, with the form moved into Flutter\'s own WebGL canvas. Needs the multi-surface rasterizer and a patched texImage2D().',
};

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

export function createBridge({ source, form, route = 'canvas-copy', onStats = () => {} }) {
  const ctx = source.getContext('2d');
  const stats = {
    route, paints: 0, draws: 0, images: 0, places: 0, fails: 0, lastError: '',
    drawMs: [], imageMs: [], bitmapMs: [], image: null, matrix: null,
    uploads: 0, adopted: false, unit: 1, buildMs: [], rasterMs: [], frames: 0,
  };
  let host = null; // Flutter's canvas, once the form has been moved into it
  const keep = (list, value) => { list.push(value); if (list.length > 60) list.shift(); };
  let painted = false;
  let bitmap = null;
  let wake = null;
  let dpr = 1;

  // #region layout
  // Flutter gives the form a width. The browser lays it out and answers with the height.
  // The canvas takes the form's size, in device pixels, so the form fills it.
  function layout(width) {
    const px = `${Math.round(width)}px`;
    if (form.style.width !== px) form.style.width = px;
    fit();
    return form.offsetHeight;
  }
  function fit() {
    dpr = window.devicePixelRatio || 1;
    const w = form.offsetWidth, h = form.offsetHeight;
    if (!w || !h || host) return;
    if (source.style.width !== `${w}px`) source.style.width = `${w}px`;
    if (source.style.height !== `${h}px`) source.style.height = `${h}px`;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (source.width !== bw || source.height !== bh) {
      source.width = bw;
      source.height = bh;
      painted = false;
      source.requestPaint?.();
    }
  }
  // #endregion layout

  // #region paint
  // The browser painted the form (typing, the caret, hover, a focus ring). Copy it into the
  // canvas, then wake Flutter. drawElementImage() also sets the form's hit box inside the canvas.
  source.addEventListener('paint', () => {
    if (host) return; // the form has moved into Flutter's canvas
    stats.paints++;
    const t0 = performance.now();
    try {
      ctx.reset();
      ctx.scale(source.width / form.offsetWidth, source.height / form.offsetHeight);
      ctx.drawElementImage(form, 0, 0, form.offsetWidth, form.offsetHeight);
    } catch (err) {
      stats.lastError = `${err.name}: ${err.message}`;
      return;
    }
    keep(stats.drawMs, performance.now() - t0);
    stats.draws++;
    painted = true;
    if (stats.route === 'bitmap') {
      const t1 = performance.now();
      createImageBitmap(source).then((made) => {
        keep(stats.bitmapMs, performance.now() - t1);
        bitmap?.close();
        bitmap = made;
        wake?.();
      });
    } else {
      wake?.();
    }
  });
  // #endregion paint

  // #region take
  // Called from Dart. What it returns goes straight into createImageFromTextureSource().
  function take() {
    if (stats.route === 'element') return takeElement();
    if (!painted) return null;
    if (stats.route === 'bitmap') {
      if (!bitmap) return null;
      const made = bitmap;
      bitmap = null; // the engine owns it now
      return { source: made, width: made.width, height: made.height, transfer: true };
    }
    return { source, width: source.width, height: source.height, transfer: stats.route === 'canvas-direct' };
  }
  // #endregion take

  // #region place
  // Called from Dart after each Flutter frame in which the widget moved. The 16 numbers are
  // Flutter's Matrix4 from the widget to the view, column-major, which is the order of CSS
  // matrix3d(). The canvas is invisible (opacity 0) and still takes input.
  function place(matrix) {
    stats.matrix = Array.from(matrix);
    stats.places++;
    if (host) return placeInCanvas();
    source.style.transform = `matrix3d(${stats.matrix.map((v) => +v.toFixed(6)).join(',')})`;
    source.dataset.placed = '1';
  }
  // #endregion place

  // #region adopt
  // The other design: no second canvas. The form becomes a child of the canvas that Flutter
  // renders into, and Flutter is handed the form itself as its texture source. CanvasKit
  // uploads a source with gl.texImage2D(..., source), which does not take an element, so that
  // one call is replaced by texElementSubImage2D(). This stands in for an engine change.
  function adopt(canvas) {
    const gl = canvas.getContext('webgl2'); // the context CanvasKit made, if it is on this canvas
    if (!gl) throw new Error('Flutter\'s canvas on the page has no WebGL context. It is a bitmaprenderer canvas fed from an OffscreenCanvas, and an element cannot be a child of an OffscreenCanvas.');
    if (!gl.texElementSubImage2D) throw new Error('texElementSubImage2D() is missing');
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    const root = canvas.getRootNode();
    if (root instanceof ShadowRoot) { // page stylesheets do not reach Flutter's shadow root
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/flutter-dom/ui.css';
      root.append(link);
    }
    // Flutter sets pointer-events: none on its scene, and the form would inherit it.
    Object.assign(form.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'auto' });
    canvas.append(form);
    source.style.display = 'none'; // the second canvas is not used in this design
    const texImage2D = gl.texImage2D.bind(gl);
    gl.texImage2D = (...args) => {
      if (args[args.length - 1] !== form) return texImage2D(...args);
      const [target, level, internal, width, height, border, format, type] = args;
      texImage2D(target, level, internal, width, height, border, format, type, null);
      gl.texElementSubImage2D(target, level, 0, 0, form);
      stats.uploads++;
    };
    canvas.addEventListener('paint', () => {
      stats.paints++;
      painted = true;
      wake?.();
    });
    // Flutter listens on its view. An event the browser gave to the form stops at the form.
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'touchstart', 'wheel', 'keydown', 'keyup', 'contextmenu']) {
      form.addEventListener(type, (event) => event.stopPropagation());
    }
    // When focus moves from Flutter's hidden text input to another element in the same view,
    // the engine takes focus back. Blurring the input first closes Flutter's text connection.
    form.addEventListener('pointerdown', () => {
      const active = document.activeElement; // the input is in the view's light DOM
      if (active?.closest?.('flutter-view') && !form.contains(active)) active.blur();
    }, true);
    host = canvas;
    stats.adopted = true;
    painted = false;
    if (stats.matrix) placeInCanvas();
    canvas.requestPaint?.();
  }
  function takeElement() {
    if (!host || !painted) return null;
    try {
      const size = host.getElementImageDefaultSize(form);
      return { source: form, width: Math.max(1, Math.ceil(size.width)), height: Math.max(1, Math.ceil(size.height)), transfer: true };
    } catch (err) {
      stats.lastError = `${err.name}: ${err.message}`;
      host.requestPaint?.();
      return null;
    }
  }
  // Tell the browser where Flutter drew the form inside Flutter's canvas.
  function placeInCanvas() {
    const m = new DOMMatrix(stats.matrix);
    // canvasTransform has been seen in CSS px and in buffer px. Measure which this canvas uses.
    host.updateElementGeometry(form, { canvasTransform: new DOMMatrix() });
    const measured = form.getBoundingClientRect().width;
    stats.unit = measured > 0 ? form.offsetWidth / measured : 1;
    const u = stats.unit;
    const scaled = new DOMMatrix().scale(u, u).multiply(m).scale(1 / u, 1 / u);
    host.updateElementGeometry(form, { canvasTransform: scaled });
    host.toggleAttribute('data-geometry-tick'); // Chromium 157 keeps a stale hit-test cache
  }
  // #endregion adopt

  // #region keys
  // Flutter listens for keydown and keyup on window in the capture phase, so it sees every key
  // typed into the form. With the form inside its view it also acts on them: Tab moved focus
  // to a Flutter widget. This listener is added before the engine starts, so it runs first.
  for (const type of ['keydown', 'keyup']) {
    window.addEventListener(type, (event) => {
      if (event.composedPath().includes(form)) event.stopImmediatePropagation();
    }, true);
  }
  // #endregion keys

  const bridge = {
    layout, take, place, adopt,
    report(ms, width, height) {
      stats.images++;
      keep(stats.imageMs, ms);
      stats.image = { width, height };
      onStats(stats);
    },
    frame(buildMs, rasterMs) {
      stats.frames++;
      keep(stats.buildMs, buildMs);
      keep(stats.rasterMs, rasterMs);
    },
    fail(message) {
      stats.fails++;
      stats.lastError = message;
      onStats(stats);
    },
    set wake(fn) { wake = fn; },
    get wake() { return wake; },
    // Filled in by Dart: tryRoute(source, width, height, transfer) and control(name, value).
    tryRoute: null,
    control: null,
    // For the page and the checks.
    form,
    stats,
    mean,
    setRoute(name) {
      stats.route = name;
      stats.imageMs.length = stats.drawMs.length = stats.bitmapMs.length = stats.rasterMs.length = stats.buildMs.length = 0;
      source.requestPaint?.();
    },
    repaint() { source.requestPaint?.(); },
  };
  new ResizeObserver(() => { fit(); wake?.(); }).observe(form);
  return bridge;
}

/** What Flutter built inside its host element. */
export function describeFlutter(host) {
  const view = host.querySelector('flutter-view') ?? (host.localName === 'flutter-view' ? host : null);
  const roots = [];
  const walk = (node, depth, inShadow) => {
    for (const el of node.querySelectorAll('*')) {
      if (el.localName === 'canvas') roots.push({ el, inShadow });
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1, true);
    }
  };
  walk(host, 0, false);
  if (host.shadowRoot) walk(host.shadowRoot, 1, true);
  const renderer = window.flutterCanvasKit ? 'CanvasKit' : window._flutter_skwasmInstance ? 'Skwasm' : 'unknown';
  return { view, canvases: roots, renderer };
}

// #region lost
/**
 * Call `onLost` when a WebGL context made after this point is lost. With Flutter's default
 * rasterizer the context belongs to an OffscreenCanvas that the page cannot reach, so the
 * hook is on getContext().
 */
export function watchContextLoss(onLost) {
  for (const type of [window.OffscreenCanvas, window.HTMLCanvasElement]) {
    if (!type) continue;
    const getContext = type.prototype.getContext;
    type.prototype.getContext = function (kind, ...rest) {
      const context = getContext.call(this, kind, ...rest);
      if (context && /^webgl/.test(kind) && !this.__lossWatched) {
        this.__lossWatched = true;
        this.addEventListener('webglcontextlost', () => onLost(this));
      }
      return context;
    };
  }
}
// #endregion lost
