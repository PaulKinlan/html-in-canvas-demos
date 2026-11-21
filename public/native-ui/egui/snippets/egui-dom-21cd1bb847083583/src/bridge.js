// bridge.js: the browser side of egui-dom. The Rust code in lib.rs calls these functions.
// They hold the three HTML-in-canvas calls that web-sys has no bindings for yet
// (getElementImageDefaultSize, texElementSubImage2D, updateElementGeometry) and the DOM event
// plumbing that keeps egui and the real elements from both handling one event.

const widgets = new Map(); // name -> { el, dirty, parked, key }
let canvas = null;
let gl = null;
let repaint = () => {};
let visibleAt = () => true;
let pointer = null; // last pointer position in canvas CSS px, or null
let unit = { key: '', value: 1 };
const stats = { paints: 0, uploads: 0, places: 0, lastError: '' };

const OFFSTAGE = new DOMMatrix().translate(-100000, -100000);

// #region init
/**
 * Called once from Rust. `onChange` asks egui for a repaint. `isVisibleAt(name, x, y)` asks egui
 * whether the widget is the top thing at that point (no egui window or menu over it).
 */
export function init(canvasElement, onChange, isVisibleAt) {
  canvas = canvasElement;
  repaint = onChange;
  visibleAt = isVisibleAt;
  // The same context object eframe made: getContext returns the existing one.
  gl = canvas.getContext('webgl2');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.style.overflowAnchor = 'none';

  for (const el of canvas.querySelectorAll('[data-egui]')) {
    el.setAttribute('drawable', '');
    widgets.set(el.dataset.egui, { el, dirty: true, parked: false, key: '' });
    // egui listens on the canvas. Events that the browser delivered to a real element stop
    // here, so a click in an <input> is not also a click in the egui UI underneath.
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'keyup', 'contextmenu']) {
      el.addEventListener(type, (event) => {
        if (!event.eguiOwns) event.stopPropagation();
      });
    }
    el.addEventListener('input', () => repaint());
    el.addEventListener('change', () => repaint());
  }

  // The browser painted canvas children: note which ones changed and wake egui.
  canvas.addEventListener('paint', (event) => {
    stats.paints++;
    const changed = event.changedElements ? new Set(event.changedElements) : null;
    for (const w of widgets.values()) if (!changed || changed.has(w.el)) w.dirty = true;
    repaint();
  });
  canvas.addEventListener('focusin', () => repaint());
  canvas.addEventListener('focusout', () => repaint());

  // Occlusion. The browser hit tests the element wherever its geometry is, and does not know
  // that an egui window is drawn over it. Before the event reaches the element, ask egui.
  const guard = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const name = event.target?.closest?.('[data-egui]')?.dataset.egui;
    if (!name || visibleAt(name, pointer.x, pointer.y)) return;
    // egui has something on top: give the event to egui and move the element out of the way.
    event.eguiOwns = true;
    if (event.type === 'pointerdown') event.preventDefault(); // no focus, no native picker
    if (event.type === 'click') {
      event.preventDefault();
      event.stopPropagation();
    }
    park(widgets.get(name));
    repaint();
  };
  for (const type of ['pointermove', 'pointerdown', 'click']) canvas.addEventListener(type, guard, true);
  canvas.addEventListener('pointerleave', () => (pointer = null));
  canvas.requestPaint?.();
}
// #endregion init

function park(w) {
  if (!w || w.parked) return;
  w.parked = true;
  w.key = '';
  canvas.updateElementGeometry(w.el, { canvasTransform: OFFSTAGE });
  touch();
}

// Chromium 157 keeps a hit-test result it cached for a point before updateElementGeometry()
// moved the element. Any DOM mutation drops that cache.
function touch() {
  canvas.toggleAttribute('data-geometry-tick');
}

/** The last pointer position over the canvas, [x, y] in CSS px, or an empty array. */
export function pointer_pos() {
  return pointer ? [pointer.x, pointer.y] : [];
}

// #region layout
/**
 * egui gives the element a width; the browser lays it out and answers with the height.
 * Sizes are CSS px, which are egui points at zoom 1.
 */
export function layout(name, width) {
  const w = widgets.get(name);
  if (!w) return 0;
  const px = `${Math.round(width)}px`;
  if (w.el.style.width !== px) w.el.style.width = px;
  return w.el.offsetHeight;
}
// #endregion layout

// #region upload
/** Size of the element's image in texels, [width, height]. Empty until the first paint. */
export function image_size(name) {
  const w = widgets.get(name);
  if (!w) return [];
  try {
    const size = canvas.getElementImageDefaultSize(w.el);
    return [Math.max(1, Math.ceil(size.width)), Math.ceil(Math.max(1, size.height))];
  } catch {
    canvas.requestPaint?.(); // no paint record yet
    return [];
  }
}

/** True when the element was painted since its last upload. */
export function is_dirty(name) {
  return !!widgets.get(name)?.dirty;
}

/**
 * Copy the element's pixels into the texture that Rust has bound to TEXTURE_2D.
 * Row 0 of the image is the top of the element.
 */
export function upload(name) {
  const w = widgets.get(name);
  if (!w) return false;
  try {
    // egui blends with premultiplied alpha, so ask for premultiplied texels.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w.el);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    w.dirty = false;
    stats.uploads++;
    return true;
  } catch (err) {
    stats.lastError = `${err.name}: ${err.message}`;
    canvas.requestPaint?.();
    return false;
  }
}
// #endregion upload

// updateElementGeometry()'s canvasTransform has been seen in CSS px on some canvases and in
// buffer px on others. Measure which one this canvas uses (same method as lib/surface.js).
function geometryUnit(el) {
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${el.offsetWidth}`;
  if (unit.key === key) return unit.value;
  canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix() });
  const measured = el.getBoundingClientRect().width;
  const zoom = el.currentCSSZoom || 1;
  if (measured > 0 && el.offsetWidth > 0) unit = { key, value: (el.offsetWidth * zoom) / measured };
  return unit.value;
}

// #region place
/**
 * Tell the browser where egui drew the element, so hit testing, the caret, focus rings and
 * the accessibility tree use that position. x, y: top left in canvas CSS px. scale: egui zoom.
 * clip: the visible part in the element's own px (an egui scroll area may cut it).
 * shown false moves the element off the canvas (scrolled out of view, or under an egui window).
 */
export function place(name, x, y, scale, clipX, clipY, clipW, clipH, shown) {
  const w = widgets.get(name);
  if (!w) return;
  if (!shown) return park(w);
  const key = [x, y, scale, clipX, clipY, clipW, clipH].map((v) => Math.round(v * 100)).join();
  if (w.key === key && !w.parked) return;
  const u = geometryUnit(w.el);
  w.key = key;
  w.parked = false;
  const m = new DOMMatrix().scale(u).translate(x, y).scale(scale);
  canvas.updateElementGeometry(w.el, { canvasTransform: m, canvasClip: new DOMRect(clipX, clipY, clipW, clipH) });
  touch();
  stats.places++;
}
// #endregion place

/** The element's current value, for egui to show. */
export function value(name) {
  const el = widgets.get(name)?.el;
  if (!el) return '';
  const field = el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea');
  return field ? String(field.value) : '';
}

/** Set the element's value from egui. */
export function set_value(name, text) {
  const el = widgets.get(name)?.el;
  const field = el?.matches('input, select, textarea') ? el : el?.querySelector('input, select, textarea');
  if (field && field.value !== text) field.value = text;
}

/** True while keyboard focus is inside one of the real elements. */
export function dom_has_focus() {
  const active = document.activeElement;
  return !!active && active !== canvas && canvas.contains(active);
}

export function bridge_stats() {
  return { ...stats, widgets: widgets.size };
}
/** A query-string option, for the page's live checks. */
export function option(name) {
  return new URLSearchParams(location.search).get(name) ?? '';
}

// For the page's live checks.
globalThis.__eguiDom = {
  stats: bridge_stats,
  element: (name) => widgets.get(name)?.el,
  visibleAt: (name, x, y) => visibleAt(name, x, y),
};
