// element-capture.js: export any element (or the whole page) to pixels with
// one call, using HTML-in-canvas. No dependencies.
//
//   import { captureElement, capturePage, recordElement, printElement,
//            copyElement, downloadElement } from '/lib/element-capture.js';
//
//   const blob  = await captureElement(el);                    // PNG at devicePixelRatio
//   const big   = await captureElement(el, { scale: 4 });      // re-rasterized, not upscaled
//   const page  = await capturePage({ full: true });           // an ordinary page, no canvas authored
//   const rec   = await recordElement(el, { fps: 30 });  …  const video = await rec.stop();
//   await printElement(el);                                    // paginated, print dialog
//
// How it gets an arbitrary element into a canvas (opts.strategy):
//   'move'    (default) a temporary <canvas content="drawable"> takes the element's place and the
//             element is moved inside it with moveBefore(), which keeps focus, form state, scroll
//             offsets, iframes and animations alive. It is moved back afterwards.
//   'inplace' the element already lives in a drawable 2D canvas: borrow that canvas for one
//             synchronous draw and put its pixels back. Chosen automatically.
//   'clone'   a deep clone is drawn in a hidden canvas. The page is never touched, but anything
//             that is state rather than markup (hover, focus, media, closed shadow roots) is lost.
//
// capturePage routes (opts.route):
//   'shadow'  a shadow root on <body> holding the canvas and a <slot>. Nothing in the light DOM
//             moves. The shadow root cannot be removed afterwards; it is left as a bare <slot>.
//   'move'    body's children are moved (moveBefore) into a canvas in <body> and back.
//   'overlay' as 'move', but the canvas is a fixed, viewport-sized overlay.
//   'auto'    'shadow' when body can take (or already has an open) shadow root, else 'move'.

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

const MAX_DIM = 16384;
const MAX_AREA = 16384 * 16384;
const PLACEMENT = [
  'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end',
  'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'justify-self', 'order',
  'z-index', 'vertical-align', 'transform', 'transform-origin',
];

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function need() {
  if (!supported) {
    throw new DOMException(
      'HTML-in-canvas is not available (Chrome 148+ with chrome://flags/#canvas-draw-element).',
      'NotSupportedError',
    );
  }
}

function drawableCanvas(cssW, cssH, scale) {
  const c = document.createElement('canvas');
  c.setAttribute('content', 'drawable');
  c.setAttribute('layoutsubtree', '');
  c.width = Math.max(1, Math.round(cssW * scale));
  c.height = Math.max(1, Math.round(cssH * scale));
  return c;
}

/** Largest scale ≤ wanted that keeps a w×h CSS-pixel box inside canvas limits. */
export function fitScale(w, h, wanted) {
  let s = wanted;
  s = Math.min(s, MAX_DIM / Math.max(1, w), MAX_DIM / Math.max(1, h));
  s = Math.min(s, Math.sqrt(MAX_AREA / Math.max(1, w * h)));
  return s;
}

/**
 * Call draw() from paint events until it stops throwing ("No cached paint
 * record"). draw() should also copy the pixels out. Resolves (in a new task) with the number of rendering updates that took: 1 means
 * the snapshot was there on the first frame after insertion.
 */
function untilDrawn(canvas, draw, maxFrames = 60) {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const onPaint = () => {
      frames++;
      try {
        draw();
      } catch (err) {
        if (frames >= maxFrames) {
          canvas.removeEventListener('paint', onPaint);
          reject(err);
        } else canvas.requestPaint();
        return;
      }
      canvas.removeEventListener('paint', onPaint);
      // Leave the paint event before anyone touches the DOM again: inserting,
      // moving or removing an iframe from inside a paint handler (or a
      // microtask of one) hits a CHECK in Chromium and takes the tab down.
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => { port1.close(); resolve(frames); };
      port2.postMessage(0);
    };
    canvas.addEventListener('paint', onPaint);
    canvas.requestPaint();
  });
}

function copyOut(source, sx, sy, sw, sh) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  out.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

async function finish(out, meta, { as = 'blob', type = 'image/png', quality, background } = {}) {
  if (background) {
    const ctx = out.getContext('2d');
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  let result;
  if (as === 'canvas') result = out;
  else if (as === 'bitmap') result = await createImageBitmap(out);
  else if (as === 'dataurl') result = out.toDataURL(type, quality);
  else {
    result = await new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob produced nothing'))), type, quality),
    );
  }
  // Blobs and bitmaps can't carry expandos reliably across structured clone, but
  // within the page this is a handy way to see what happened.
  try {
    Object.defineProperty(result, 'capture', { value: meta, enumerable: false });
  } catch {}
  lastCapture = meta;
  return result;
}

/** Details of the most recent capture: { strategy, frames, scale, width, height, ms, notes }. */
export let lastCapture = null;

function boxSize(el) {
  if (el.offsetWidth !== undefined && (el.offsetWidth || el.offsetHeight)) return [el.offsetWidth, el.offsetHeight];
  const r = el.getBoundingClientRect();
  return [r.width, r.height];
}

/** The drawable element + canvas that already own `el`, if any (flat tree aware). */
function owner(el) {
  let root = null;
  for (let n = el; n; n = n.assignedSlot ?? n.parentNode ?? n.host) {
    if (n.nodeType !== 1) continue;
    if (n.localName === 'canvas' && (n.getAttribute('content') === 'drawable' || n.hasAttribute('layoutsubtree'))) {
      return root ? { canvas: n, root } : null;
    }
    if (n.hasAttribute('drawable')) root = n;
  }
  return null;
}

function offsetWithin(el, root) {
  if (el === root) return [0, 0];
  // Layout offsets, so the answer does not depend on how the canvas has
  // transformed the element on screen.
  let x = 0, y = 0, n = el;
  while (n && n !== root) {
    x += n.offsetLeft; y += n.offsetTop;
    const p = n.offsetParent;
    if (!p || p === root) break;
    x += p.clientLeft; y += p.clientTop;
    n = p;
  }
  return [x, y];
}

// Becoming a canvas child restarts CSS animations even with moveBefore(), so
// note where each one was and seek the restarted ones back.
function animationTimes(el) {
  try {
    return el.getAnimations({ subtree: true }).map((a) => ({
      target: a.effect?.target, pseudo: a.effect?.pseudoElement, name: a.animationName ?? a.transitionProperty ?? a.id,
      time: a.currentTime, at: performance.now(), rate: a.playState === 'running' ? a.playbackRate : 0,
    }));
  } catch { return []; }
}
function restoreAnimations(el, saved, again = 2) {
  if (!saved.length) return;
  try {
    // The restart happens at a later style update; force one now, and look
    // again on the next frames in case the new animations appear then.
    void (el.offsetHeight ?? el.getBoundingClientRect());
    for (const a of el.getAnimations({ subtree: true })) {
      const m = saved.find((s) => s.target === a.effect?.target && s.pseudo === a.effect?.pseudoElement && s.name === (a.animationName ?? a.transitionProperty ?? a.id));
      if (!m || m.time == null) continue;
      const want = m.time + (performance.now() - m.at) * m.rate;
      if (Math.abs((a.currentTime ?? 0) - want) > 40) a.currentTime = want;
    }
  } catch {}
  if (again > 0) requestAnimationFrame(() => restoreAnimations(el, saved, again - 1));
}

// ---------------------------------------------------------------- elements

/**
 * Render one element to an image.
 * @param {Element} el
 * @param {object} [opts]
 * @param {number} [opts.scale=devicePixelRatio] output pixels per CSS pixel. The element is
 *   re-rasterized at this scale (text stays sharp), clamped to canvas size limits.
 * @param {'blob'|'canvas'|'bitmap'|'dataurl'} [opts.as='blob']
 * @param {string} [opts.type='image/png'] [opts.quality]
 * @param {string} [opts.background] CSS colour painted behind the element (default transparent).
 * @param {'auto'|'move'|'inplace'|'clone'} [opts.strategy='auto']
 */
export async function captureElement(el, opts = {}) {
  need();
  if (!(el instanceof Element) || !el.isConnected) throw new TypeError('captureElement needs a connected element');
  if (el === document.body || el === document.documentElement) return capturePage({ full: true, ...opts });
  const t0 = performance.now();
  const strategy = opts.strategy && opts.strategy !== 'auto' ? opts.strategy : owner(el) ? 'inplace' : 'move';
  let out, meta;
  if (strategy === 'inplace') {
    try {
      ({ out, meta } = captureInPlace(el, opts));
    } catch (err) {
      if (opts.strategy === 'inplace') throw err;
      ({ out, meta } = await captureClone(el, opts));
      meta.notes.push(`in-place capture failed (${err.message}); used a clone`);
    }
  } else if (strategy === 'clone') ({ out, meta } = await captureClone(el, opts));
  else if (strategy === 'move') ({ out, meta } = await captureMove(el, opts));
  else throw new TypeError(`unknown strategy "${strategy}"`);
  meta.ms = Math.round(performance.now() - t0);
  return finish(out, meta, opts);
}

/** Put `el` inside a temporary drawable canvas that takes its place. Returns a handle. */
function hold(el, scale) {
  const [w, h] = boxSize(el);
  const cs = getComputedStyle(el);
  const s = fitScale(w, h, scale);
  const canvas = drawableCanvas(w, h, s);
  const inline = cs.display.startsWith('inline');
  let css = `display:${inline ? 'inline-block' : 'block'};width:${w}px;height:${h}px;box-sizing:content-box;padding:0;border:0;background:none;max-width:none;max-height:none;min-width:0;min-height:0;`;
  for (const p of PLACEMENT) css += `${p}:${cs.getPropertyValue(p)};`;
  canvas.style.cssText = css;
  canvas.dataset.elementCapture = '';

  const savedStyle = el.getAttribute('style');
  const hadDrawable = el.hasAttribute('drawable');
  const parent = el.parentNode;
  const atomic = typeof canvas.moveBefore === 'function';
  const notes = [];
  // Inside the canvas the element is a block at the origin; pin the size it had.
  const pin = { margin: '0', transform: 'none' };
  if (cs.width.endsWith('px')) pin.width = cs.width;
  if (cs.height.endsWith('px')) pin.height = cs.height;

  const anims = animationTimes(el);
  parent.insertBefore(canvas, el);
  el.setAttribute('drawable', '');
  if (atomic) canvas.moveBefore(el, null);
  else {
    canvas.append(el);
    notes.push('no moveBefore(): the element was removed and re-inserted, so iframes reload and focus/animations reset');
  }
  for (const [k, v] of Object.entries(pin)) el.style.setProperty(k, v, 'important');
  restoreAnimations(el, anims);

  const ctx = canvas.getContext('2d');
  const draw = () => {
    ctx.reset();
    ctx.drawElementImage(el, 0, 0, canvas.width, canvas.height);
  };
  const release = () => {
    const now = animationTimes(el);
    if (savedStyle === null) el.removeAttribute('style');
    else el.setAttribute('style', savedStyle);
    if (canvas.parentNode) {
      if (atomic) canvas.parentNode.moveBefore(el, canvas);
      else canvas.parentNode.insertBefore(el, canvas);
      canvas.remove();
    }
    if (!hadDrawable) el.removeAttribute('drawable');
    restoreAnimations(el, now);
  };
  return { canvas, ctx, draw, release, notes, scale: s, width: w, height: h, atomic };
}

async function captureMove(el, { scale = devicePixelRatio } = {}) {
  const h = hold(el, scale);
  try {
    if (!h.atomic) await settleFrames(el);
    const frames = await untilDrawn(h.canvas, h.draw);
    const out = copyOut(h.canvas, 0, 0, h.canvas.width, h.canvas.height);
    if (!h.atomic) { await nextFrame(); await nextFrame(); }
    return { out, meta: meta('move', frames, h, out) };
  } finally {
    h.release();
  }
}

// Without moveBefore, iframes inside the element reload when it moves. Taking the
// element back out while one is still loading has crashed the tab in testing, so wait.
async function settleFrames(el) {
  const frames = [...el.querySelectorAll('iframe')];
  if (el.localName === 'iframe') frames.push(el);
  await Promise.all(frames.map((f) => new Promise((r) => {
    f.addEventListener('load', r, { once: true });
    setTimeout(r, 3000);
  })));
  if (frames.length) { await nextFrame(); await nextFrame(); }
}

function meta(strategy, frames, h, out, notes = []) {
  return { strategy, frames, scale: h.scale, cssWidth: h.width, cssHeight: h.height, width: out.width, height: out.height, notes: [...(h.notes ?? []), ...notes] };
}

function captureInPlace(el, { scale = devicePixelRatio } = {}) {
  const { canvas, root } = owner(el);
  let ctx;
  try {
    ctx = canvas.getContext('2d');
  } catch (err) {
    throw new Error('the owning canvas was transferred to a worker');
  }
  if (!ctx) throw new Error('the owning canvas is not a 2D canvas');
  const [w, h] = boxSize(el);
  const [ox, oy] = offsetWithin(el, root);
  const s = fitScale(w, h, scale);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * s));
  out.height = Math.max(1, Math.round(h * s));
  const octx = out.getContext('2d');

  // Everything from here to the restore is synchronous: the borrowed canvas is
  // never presented with our tiles on it.
  const backup = copyOut(canvas, 0, 0, canvas.width, canvas.height);
  const before = canvas.getElementTransform?.(root);
  const tw = canvas.width, th = canvas.height;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowColor = 'transparent';
    for (let ty = 0; ty < out.height; ty += th) {
      for (let tx = 0; tx < out.width; tx += tw) {
        const dw = Math.min(tw, out.width - tx), dh = Math.min(th, out.height - ty);
        ctx.clearRect(0, 0, tw, th);
        ctx.drawElementImage(root, ox + tx / s, oy + ty / s, dw / s, dh / s, 0, 0, dw, dh, { preserveElementGeometry: true });
        octx.drawImage(canvas, 0, 0, dw, dh, tx, ty, dw, dh);
      }
    }
  } finally {
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(backup, 0, 0);
    ctx.restore();
    // Older builds ignore preserveElementGeometry: put hit testing back by hand.
    const after = canvas.getElementTransform?.(root);
    if (before && after && before.toString() !== after.toString()) {
      canvas.updateElementGeometry(root, { canvasTransform: before });
    }
  }
  return { out, meta: meta('inplace', 0, { scale: s, width: w, height: h }, out) };
}

async function captureClone(el, { scale = devicePixelRatio } = {}) {
  const [w, h] = boxSize(el);
  const s = fitScale(w, h, scale);
  const canvas = drawableCanvas(w, h, s);
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none;z-index:-1;margin:0`;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.inert = true;
  const clone = el.cloneNode(true);
  syncState(el, clone);
  clone.removeAttribute('id');
  clone.setAttribute('drawable', '');
  clone.style.setProperty('margin', '0', 'important');
  clone.style.setProperty('transform', 'none', 'important');
  const cs = getComputedStyle(el);
  if (cs.width.endsWith('px')) clone.style.setProperty('width', cs.width, 'important');
  if (cs.height.endsWith('px')) clone.style.setProperty('height', cs.height, 'important');
  canvas.append(clone);
  // Next to the original, so ancestor selectors still match the clone.
  // (Unless the original sits in someone else's canvas, where a sibling would not render.)
  if (owner(el) || !el.parentNode) document.body.append(canvas);
  else el.parentNode.insertBefore(canvas, el.nextSibling);
  try {
    await Promise.all([...clone.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {})));
    await settleFrames(clone);
    const ctx = canvas.getContext('2d');
    const frames = await untilDrawn(canvas, () => {
      ctx.reset();
      ctx.drawElementImage(clone, 0, 0, canvas.width, canvas.height);
    });
    const out = copyOut(canvas, 0, 0, canvas.width, canvas.height);
    return { out, meta: meta('clone', frames, { scale: s, width: w, height: h }, out, ['drawn from a clone: hover, focus, media and iframe state are not carried over']) };
  } finally {
    // Removing a canvas in the frame an iframe inside it was drawn crashes the tab.
    if (clone.querySelector('iframe') || clone.localName === 'iframe') { await nextFrame(); await nextFrame(); }
    canvas.remove();
  }
}

function syncState(from, to) {
  const a = [from, ...from.querySelectorAll('*')];
  const b = [to, ...to.querySelectorAll('*')];
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = a[i], y = b[i];
    if (x instanceof HTMLInputElement) {
      if (x.type === 'checkbox' || x.type === 'radio') { y.checked = x.checked; y.indeterminate = x.indeterminate; }
      else if (x.type !== 'file') y.value = x.value;
    } else if (x instanceof HTMLTextAreaElement) y.value = x.value;
    else if (x instanceof HTMLSelectElement) y.selectedIndex = x.selectedIndex;
    else if (x instanceof HTMLCanvasElement && x.width && x.height) {
      try { y.getContext('2d').drawImage(x, 0, 0); } catch {}
    } else if (x instanceof HTMLDetailsElement) y.open = x.open;
    if (x.scrollTop || x.scrollLeft) queueMicrotask(() => { y.scrollTop = x.scrollTop; y.scrollLeft = x.scrollLeft; });
  }
}

// -------------------------------------------------------------------- page

/**
 * Capture an ordinary page that was not authored with a canvas.
 * @param {object} [opts]
 * @param {boolean} [opts.full=false] whole document (true) or what the viewport shows (false).
 * @param {'auto'|'shadow'|'move'|'overlay'} [opts.route='auto']
 * @param {number} [opts.scale=devicePixelRatio] plus as/type/quality/background as captureElement.
 */
export async function capturePage(opts = {}) {
  need();
  const t0 = performance.now();
  const { full = false, scale = devicePixelRatio } = opts;
  let route = opts.route ?? 'auto';
  const notes = [];
  // Before anything changes: even attaching the shadow root restarts animations.
  const anims = animationTimes(document.documentElement);
  if (route === 'auto') {
    route = canShadow() ? 'shadow' : 'move';
    if (route === 'move') notes.push('body already has a shadow root of its own, so the shadow route was not used');
  }
  const doc = document.documentElement;
  const body = document.body;
  const scroll = { x: scrollX, y: scrollY };
  const vw = doc.clientWidth, vh = doc.clientHeight;
  const dw = Math.max(doc.scrollWidth, vw), dh = Math.max(doc.scrollHeight, vh);
  const w = full ? dw : vw, h = full ? dh : vh;
  const s = fitScale(w, h, scale);
  if (s < scale) notes.push(`scale reduced from ${scale} to ${s.toFixed(2)} to stay inside canvas size limits`);
  const bodyCS = getComputedStyle(body);
  const pageBg = opts.background ?? pageBackground();

  // The stage keeps the document's scrollable size, so the real scroll
  // position never changes. The canvas sits where the viewport is and shows
  // exactly what the page showed, so there is nothing to flicker.
  //   stage (dw × dh)
  //     canvas (sticky at the viewport for a viewport shot; full size otherwise)
  //       frame   [drawable]  containing block for fixed elements
  //         scroller          clips, and is scrolled to the page's scroll offset
  //           content         the page: a <slot>, or body's children
  const stage = document.createElement('div');
  stage.dataset.elementCapture = 'page';
  const canvas = drawableCanvas(w, h, s);
  const frame = document.createElement('div');
  frame.setAttribute('drawable', '');
  const scroller = document.createElement('div');
  const content = document.createElement(route === 'shadow' ? 'slot' : 'div');
  if (route === 'overlay') {
    stage.style.cssText = `position:fixed;inset:0;width:${vw}px;height:${vh}px;z-index:2147483647;pointer-events:none;margin:0`;
    canvas.style.cssText = `display:block;width:${vw}px;height:${vh}px`;
  } else {
    // Out of flow at the document origin, so body's margins and scroll
    // anchoring have nothing to react to; pinToOrigin() corrects the offset.
    stage.style.cssText = `position:absolute;left:0;top:0;width:${dw}px;height:${dh}px;margin:0;overflow:visible;overflow-anchor:none`;
    canvas.style.cssText = full
      ? `display:block;width:${w}px;height:${h}px`
      : `display:block;position:sticky;top:0;left:0;width:${w}px;height:${h}px`;
  }
  frame.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;background:${pageBg}`;
  scroller.style.cssText = `width:${w}px;height:${h}px;overflow:hidden`;
  // Stand in for <body> as the block that page content is laid out in.
  const wrap = document.createElement('div');
  // Same margins and padding as <body>, so margin collapsing with the first
  // and last child comes out the same.
  wrap.style.cssText = `margin:${bodyCS.marginTop} ${bodyCS.marginRight} ${bodyCS.marginBottom} ${bodyCS.marginLeft};padding:${bodyCS.paddingTop} ${bodyCS.paddingRight} ${bodyCS.paddingBottom} ${bodyCS.paddingLeft}`;
  wrap.append(content);
  scroller.append(wrap);
  frame.append(scroller);
  canvas.append(frame);
  stage.append(canvas);

  let restore;
  if (route === 'shadow') restore = mountShadow(stage, notes);
  else if (route === 'move' || route === 'overlay') restore = mountMove(stage, content, route, dw, dh, notes);
  else throw new TypeError(`unknown route "${route}"`);

  if (route !== 'overlay') pinToOrigin(stage);
  restoreAnimations(document.documentElement, anims);
  try {
    if (!full) { scroller.scrollLeft = scroll.x; scroller.scrollTop = scroll.y; }
    const ctx = canvas.getContext('2d');
    const frames = await untilDrawn(canvas, () => {
      if (!full && (scroller.scrollTop !== scroll.y || scroller.scrollLeft !== scroll.x)) {
        scroller.scrollLeft = scroll.x; scroller.scrollTop = scroll.y;
      }
      ctx.reset();
      ctx.drawElementImage(frame, 0, 0, canvas.width, canvas.height);
    });
    const out = copyOut(canvas, 0, 0, canvas.width, canvas.height);
    const m = meta(`page:${route}`, frames, { scale: s, width: w, height: h }, out, notes);
    m.full = full;
    m.scrollBefore = scroll;
    const running = animationTimes(document.documentElement);
    restore();
    restore = null;
    restoreAnimations(document.documentElement, running);
    if (scrollX !== scroll.x || scrollY !== scroll.y) {
      m.notes.push(`the browser scrolled to ${scrollX},${scrollY} when the focused element was moved back; the scroll position was restored`);
      scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' });
    }
    m.ms = Math.round(performance.now() - t0);
    return finish(out, m, { ...opts, background: undefined });
  } finally {
    restore?.();
  }
}

// Move an absolutely positioned box so its corner is the document origin,
// whatever its containing block turned out to be.
function pinToOrigin(el) {
  const r = el.getBoundingClientRect();
  const dx = r.left + scrollX, dy = r.top + scrollY;
  if (dx) el.style.left = `${-dx}px`;
  if (dy) el.style.top = `${-dy}px`;
}

function pageBackground() {
  // The canvas background propagates from <html> or <body>; neither is inside our frame.
  for (const el of [document.documentElement, document.body]) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  }
  return 'Canvas';
}

const OURS = Symbol.for('element-capture.bodyRoot');

function canShadow() {
  const body = document.body;
  // An open root that belongs to the page works, but costs focus: prefer 'move'.
  if (body.shadowRoot) return body.shadowRoot === body[OURS];
  try {
    // A closed root is invisible; the only way to find out is to try.
    body[OURS] = body.attachShadow({ mode: 'open' });
    body[OURS].append(document.createElement('slot'));
    return true;
  } catch {
    return false;
  }
}

function mountShadow(stage, notes) {
  const body = document.body;
  let root = body.shadowRoot ?? body[OURS];
  if (!root) root = body[OURS] = body.attachShadow({ mode: 'open' });
  const mine = root === body[OURS];
  if (mine) {
    notes.push('uses a shadow root on <body>; it stays afterwards (as a bare <slot>) because shadow roots cannot be removed');
    // Our own root: swap the idle <slot> for the stage in one go.
    root.replaceChildren(stage);
    return () => root.replaceChildren(document.createElement('slot'));
  }
  // The page's own open shadow root: put its whole tree inside our slot's place.
  notes.push("body already had an open shadow root; its contents were moved inside the canvas and back");
  const content = stage.querySelector('slot');
  const holder = document.createElement('div');
  holder.style.display = 'contents';
  content.replaceWith(holder);
  const kids = [...root.childNodes];
  const atomic = typeof holder.moveBefore === 'function';
  root.append(stage);
  for (const k of kids) (atomic && k.nodeType !== 3 ? holder.moveBefore(k, null) : holder.append(k));
  return () => {
    for (const k of kids) (atomic && k.nodeType !== 3 ? root.moveBefore(k, stage) : root.insertBefore(k, stage));
    stage.remove();
  };
}

function mountMove(stage, content, route, dw, dh, notes) {
  const body = document.body;
  const kids = [...body.childNodes];
  const atomic = typeof body.moveBefore === 'function';
  if (!atomic) notes.push('no moveBefore(): body children were removed and re-inserted (iframes reload, focus and animations reset)');
  let spacer = null;
  if (route === 'overlay') {
    // The overlay is out of flow; something has to keep the document scrollable.
    spacer = document.createElement('div');
    spacer.style.cssText = `position:absolute;left:0;top:0;width:${dw}px;height:${dh}px;visibility:hidden;pointer-events:none`;
    body.append(spacer);
    pinToOrigin(spacer);
  }
  body.append(stage);
  const move = (parent, node, before) => {
    // moveBefore() only takes elements and character data in the same document.
    try {
      if (atomic) return parent.moveBefore(node, before);
    } catch {}
    parent.insertBefore(node, before);
  };
  for (const k of kids) move(content, k, null);
  return () => {
    const ref = spacer ?? stage;
    for (const k of kids) move(body, k, ref);
    stage.remove();
    spacer?.remove();
  };
}

// ------------------------------------------------------------------- video

/**
 * Record an element as video while it stays live and interactive on the page.
 * Resolves once recording has started.
 * WebM by default; pass mimeType: 'video/mp4;codecs=avc1.640028' for MP4 (Chrome's software
 * H.264 encoder crashed the tab in headless testing, so it is opt-in).
 * @returns {Promise<{ stop(): Promise<Blob>, done: Promise<Blob>, stream: MediaStream, canvas: HTMLCanvasElement, mimeType: string }>}
 *   `done` resolves by itself when opts.duration (ms) is given.
 */
export async function recordElement(el, { fps = 30, duration, scale = 1, mimeType, videoBitsPerSecond = 8_000_000 } = {}) {
  need();
  if (owner(el)) throw new DOMException('Element is already drawn by a canvas: record that canvas with canvas.captureStream().', 'InvalidStateError');
  const type = mimeType ?? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.640028'].find((t) => MediaRecorder.isTypeSupported(t));
  const h = hold(el, scale);
  let frames = 0;
  const onPaint = () => {
    try { h.draw(); frames++; } catch {}
  };
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    h.canvas.removeEventListener('paint', onPaint);
    clearInterval(pump);
    h.release();
  };
  let pump;
  try {
    await untilDrawn(h.canvas, h.draw);
  } catch (err) {
    release();
    throw err;
  }
  h.canvas.addEventListener('paint', onPaint);
  // Paint events only fire when the element changes; keep the encoder fed with
  // frames anyway so a still element does not produce an empty file.
  pump = setInterval(() => h.canvas.requestPaint(), 1000 / fps);
  const stream = h.canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType || type });
      lastCapture = { strategy: 'record', frames, scale: h.scale, width: h.canvas.width, height: h.canvas.height, mimeType: blob.type, notes: h.notes };
      resolve(blob);
    };
    recorder.onerror = (e) => { release(); reject(e.error ?? new Error('MediaRecorder error')); };
  });
  recorder.start(250);
  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    for (const t of stream.getTracks()) t.stop();
    return done;
  };
  if (duration) setTimeout(stop, duration);
  return { stop, done, stream, canvas: h.canvas, mimeType: type };
}

// ------------------------------------------------------------------- print

const PAPER = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };

/**
 * Print one element on its own, paginated, at print resolution.
 * @param {object} [opts] dpi (default 200), paper ('A4'|'A5'|'Letter'), margin in mm,
 *   print (default true; false builds the print document and returns it without opening the dialog).
 * @returns {Promise<{ pages: number, frame: HTMLIFrameElement, scale: number }>}
 */
export async function printElement(el, { dpi = 200, paper = 'A4', margin = 12, print = true, ...rest } = {}) {
  const [pw, ph] = PAPER[paper] ?? PAPER.A4;
  const big = await captureElement(el, { ...rest, scale: dpi / 96, as: 'canvas' });
  const meta = lastCapture;
  const innerW = pw - margin * 2, innerH = ph - margin * 2;
  // Fit to page width, never upscale past the element's CSS size.
  const cssMm = (meta.cssWidth / 96) * 25.4;
  const widthMm = Math.min(innerW, cssMm);
  const pxPerMm = big.width / widthMm;
  const sliceH = Math.floor(innerH * pxPerMm);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(`<!doctype html><title>${document.title}</title><style>@page{size:${pw}mm ${ph}mm;margin:${margin}mm}html,body{margin:0}img{display:block;width:${widthMm}mm;break-after:page}img:last-child{break-after:auto}</style>`);
  d.close();
  let pages = 0;
  for (let y = 0; y < big.height; y += sliceH) {
    const slice = copyOut(big, 0, y, big.width, Math.min(sliceH, big.height - y));
    const blob = await new Promise((r) => slice.toBlob(r, 'image/png'));
    const img = d.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = el.getAttribute('aria-label') ?? (el.innerText ?? '').slice(0, 2000);
    d.body.append(img);
    await img.decode().catch(() => {});
    pages++;
  }
  if (print) {
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
  return { pages, frame, scale: meta.scale };
}

// ------------------------------------------------------------- conveniences

/** Copy an element to the clipboard as a PNG. Needs a user gesture. */
export async function copyElement(el, opts = {}) {
  const blob = captureElement(el, { ...opts, type: 'image/png', as: 'blob' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return blob;
}

/** Capture and save as a file. */
export async function downloadElement(el, filename = 'element.png', opts = {}) {
  const type = filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? 'image/jpeg' : filename.endsWith('.webp') ? 'image/webp' : 'image/png';
  const blob = await captureElement(el, { type, ...opts, as: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return blob;
}
