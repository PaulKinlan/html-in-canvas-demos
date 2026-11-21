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
//   const print = await captureElement(el, { dpi: 300 });      // print-quality PNG, size recorded in the file
//   const webm  = await exportVideo(el, { fps: 60 });          // WebCodecs: animations stepped frame by frame
//   const clip  = await encodeFrames(frames, { fps: 30 });     // any canvases / bitmaps you already have
//   await copyElement(el, { html: true });                     // one clipboard item: PNG, HTML and text
//   await printElement(el, { footer: 'Page {page} of {pages}' });   // @page margin boxes
//   const folder = await pickFolder();  await saveToFolder(blob, 'card.png', folder);
//   const watch  = await watchFolder(folder, (names) => …);    // FileSystemObserver, or polling
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

import { WebMMuxer } from './webm-mux.js';

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

async function finish(out, meta, { as = 'blob', type = 'image/png', quality, background, dpi } = {}) {
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
    // Say how big a pixel is, so a 300 dpi export opens at the element's real
    // size in print and layout tools instead of 3× too large.
    if (result.type === 'image/png') {
      const ppi = dpi ?? meta.scale * 96;
      result = await withPngDensity(result, ppi);
      meta.dpi = Math.round(ppi);
    }
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

let crcTable = null;
function crc32(bytes) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Insert a pHYs chunk (pixels per metre) after IHDR. */
async function withPngDensity(blob, ppi) {
  const head = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  if (head.length < 33 || head[12] !== 0x49 || head[13] !== 0x48) return blob; // not IHDR first: leave it
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  const ppm = Math.round(ppi / 0.0254);
  v.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm); v.setUint32(12, ppm); chunk[16] = 1;
  v.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Blob([head, chunk, blob.slice(33)], { type: 'image/png' });
  return out;
}

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
 * @param {number} [opts.dpi] instead of scale: 300 gives 300 pixels per CSS inch (scale 3.125).
 *   PNG output records its density (pHYs), so it opens at the element's real size.
 * @param {'blob'|'canvas'|'bitmap'|'dataurl'} [opts.as='blob']
 * @param {string} [opts.type='image/png'] [opts.quality]
 * @param {string} [opts.background] CSS colour painted behind the element (default transparent).
 * @param {'auto'|'move'|'inplace'|'clone'} [opts.strategy='auto']
 */
// #region entry
export async function captureElement(el, opts = {}) {
  need();
  if (!(el instanceof Element) || !el.isConnected) throw new TypeError('captureElement needs a connected element');
  if (el === document.body || el === document.documentElement) return capturePage({ full: true, ...opts });
  const t0 = performance.now();
  if (opts.dpi) opts = { ...opts, scale: opts.dpi / 96 };
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
// #endregion entry

// #region hold
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
// #endregion hold

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

// ------------------------------------------------------------ WebCodecs video

const VIDEO_CODECS = { vp9: 'vp09.00.10.08', vp8: 'vp8' };

/** Natural length of the element's animations from where they are now, in ms. */
function animationSpan(anims) {
  let span = 0;
  for (const a of anims) {
    const t = a.effect?.getComputedTiming?.();
    if (!t) continue;
    const end = Number.isFinite(t.endTime) ? t.endTime : (t.delay ?? 0) + (Number(t.duration) || 0) * (t.direction?.startsWith('alternate') ? 2 : 1);
    span = Math.max(span, end - (Number.isFinite(t.endTime) ? (a.currentTime ?? 0) : 0));
  }
  return span;
}

/**
 * Encode an element straight to a video file with WebCodecs. Unlike recordElement() this
 * is not a screen recording: in 'stepped' mode every CSS animation, transition and Web
 * Animation under the element is paused and moved forward exactly one frame at a time, so
 * the file has every frame, evenly spaced, however slow the machine or the encoder is.
 *
 * @param {Element} el
 * @param {object} [opts]
 * @param {number} [opts.fps=30]
 * @param {number} [opts.duration] ms. Default: the length of the element's animations (one
 *   cycle of an infinite one), or 2000.
 * @param {number} [opts.scale=1] output pixels per CSS pixel (re-rasterized, like captureElement).
 * @param {'stepped'|'realtime'} [opts.mode='stepped'] 'realtime' encodes what the element does
 *   in real time, for motion driven by script or user input that cannot be stepped.
 * @param {(ms: number, frame: number) => void|Promise<void>} [opts.onframe] called before each
 *   stepped frame: put script-driven state where it should be at `ms`.
 * @param {'now'|'start'} [opts.from='now'] 'start' rewinds the animations to 0 first.
 * @param {'vp9'|'vp8'} [opts.codec] default vp9, vp8 if the encoder does not have it.
 * @param {number} [opts.bitrate] bits per second. Default scales with size and fps.
 * @param {string} [opts.background='#fff'] video has no alpha; this is painted behind the element.
 * @param {(done: number, total: number) => void} [opts.onprogress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Blob>} video/webm. blob.capture has { frames, width, height, fps, duration, codec, mode, ms }.
 */
export async function exportVideo(el, opts = {}) {
  need();
  if (typeof VideoEncoder === 'undefined') throw new DOMException('WebCodecs (VideoEncoder) is not available here.', 'NotSupportedError');
  if (!(el instanceof Element) || !el.isConnected) throw new TypeError('exportVideo needs a connected element');
  if (owner(el)) throw new DOMException('Element is already drawn by a canvas: export that canvas instead.', 'InvalidStateError');
  const { fps = 30, scale = 1, mode = 'stepped', from = 'now', background = '#fff', onframe, onprogress, signal } = opts;
  const t0 = performance.now();

  // Pick a codec the encoder really has before touching the page.
  const [bw, bh] = boxSize(el);
  const s = fitScale(bw, bh, scale);
  const width = Math.max(2, Math.round(bw * s / 2) * 2), height = Math.max(2, Math.round(bh * s / 2) * 2); // encoders want even sizes
  const bitrate = opts.bitrate ?? Math.round(Math.min(40e6, Math.max(1e6, width * height * fps * 0.12)));
  let config = null, codec = null;
  for (const name of opts.codec ? [opts.codec] : ['vp9', 'vp8']) {
    const c = { codec: VIDEO_CODECS[name] ?? name, width, height, bitrate, framerate: fps, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; codec = name; break; } } catch {}
  }
  if (!config) throw new DOMException(`No WebCodecs encoder for ${opts.codec ?? 'vp9 or vp8'} at ${width}×${height}.`, 'NotSupportedError');

  const h = hold(el, s);
  h.canvas.width = width; h.canvas.height = height;
  const draw = () => {
    h.ctx.reset();
    h.ctx.fillStyle = background;
    h.ctx.fillRect(0, 0, width, height);
    h.ctx.drawElementImage(el, 0, 0, width, height);
  };
  const mux = new WebMMuxer({ width, height, codec, fps });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk) => mux.add(chunk), error: (e) => (failure = e) });
  encoder.configure(config);
  const frameUs = 1e6 / fps;
  const keyEvery = Math.max(1, Math.round(fps * 2));
  let n = 0;
  const push = async (us) => {
    const frame = new VideoFrame(h.canvas, { timestamp: Math.round(us), duration: Math.round(frameUs) });
    encoder.encode(frame, { keyFrame: n % keyEvery === 0 });
    frame.close();
    n++;
    // Do not let frames pile up in front of a slow encoder.
    while (encoder.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 2));
    if (failure) throw failure;
    signal?.throwIfAborted();
  };

  let paused = [], duration = opts.duration;
  try {
    await untilDrawn(h.canvas, draw);
    await nextFrame(); // restarted animations have been seeked back by now
    if (mode === 'realtime') {
      duration ??= 2000;
      const start = performance.now();
      await new Promise((resolve, reject) => {
        let busy = false;
        const onPaint = async () => {
          const t = performance.now() - start;
          if (t >= duration) { h.canvas.removeEventListener('paint', onPaint); clearInterval(pump); return resolve(); }
          if (busy || t * 1000 < n * frameUs - frameUs / 2) return; // encoder behind, or faster than fps
          busy = true;
          try { draw(); await push(t * 1000); onprogress?.(t, duration); }
          catch (err) { if (!/paint record/.test(err.message)) { h.canvas.removeEventListener('paint', onPaint); clearInterval(pump); reject(err); } }
          busy = false;
        };
        h.canvas.addEventListener('paint', onPaint);
        const pump = setInterval(() => h.canvas.requestPaint(), 1000 / fps);
      });
    } else {
      const anims = el.getAnimations({ subtree: true });
      for (const a of anims) {
        if (from === 'start') a.currentTime = 0;
        paused.push({ a, base: Number(a.currentTime ?? 0), state: a.playState });
        a.pause();
      }
      duration ??= Math.min(60000, Math.round(animationSpan(anims)) || 2000);
      const total = Math.max(1, Math.round(duration * fps / 1000));
      for (let i = 0; i < total; i++) {
        const ms = i * 1000 / fps;
        for (const p of paused) p.a.currentTime = p.base + ms;
        await onframe?.(ms, i);
        await untilDrawn(h.canvas, draw);
        await push(i * frameUs);
        onprogress?.(i + 1, total);
      }
      duration = total * 1000 / fps;
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try { encoder.close(); } catch {}
    // Hand the animations back where they would have been had nothing happened.
    for (const p of paused) {
      try { p.a.currentTime = p.base; if (p.state === 'running') p.a.play(); } catch {}
    }
    h.release();
  }
  const blob = mux.finish();
  const meta = { strategy: `webcodecs ${mode}`, frames: mux.frames, scale: s, cssWidth: bw, cssHeight: bh, width, height, fps, duration, codec, mode, bitrate, mimeType: blob.type, ms: Math.round(performance.now() - t0), notes: h.notes };
  try { Object.defineProperty(blob, 'capture', { value: meta, enumerable: false }); } catch {}
  lastCapture = meta;
  return blob;
}

/**
 * Encode frames you already have (canvases, ImageBitmaps, VideoFrames) to a WebM file.
 * Takes any iterable or async iterable of frames, or of { time (seconds), bitmap | canvas | frame },
 * which is what <dom-rewind>.frames() yields:
 *
 *   const webm = await encodeFrames(rewind.frames({ seconds: 5, fps: 30 }), { fps: 30 });
 *
 * Sources are closed after encoding when they have close(). Without `time`, frames are spaced by fps.
 * @returns {Promise<Blob>} video/webm, with blob.capture = { frames, width, height, fps, duration, codec }
 */
export async function encodeFrames(source, { fps = 30, codec: wanted, bitrate, background = '#fff', onprogress } = {}) {
  if (typeof VideoEncoder === 'undefined') throw new DOMException('WebCodecs (VideoEncoder) is not available here.', 'NotSupportedError');
  const t0 = performance.now();
  let encoder = null, mux = null, failure = null, pad = null, codec = null, n = 0, lastUs = -1, width = 0, height = 0;
  const frameUs = 1e6 / fps;
  for await (const item of source) {
    const image = item?.bitmap ?? item?.canvas ?? item?.frame ?? item?.image ?? item;
    const w = image.displayWidth ?? image.width, h = image.displayHeight ?? image.height;
    if (!encoder) {
      width = Math.max(2, Math.round(w / 2) * 2); height = Math.max(2, Math.round(h / 2) * 2);
      for (const name of wanted ? [wanted] : ['vp9', 'vp8']) {
        const c = { codec: VIDEO_CODECS[name] ?? name, width, height, bitrate: bitrate ?? Math.round(Math.min(40e6, Math.max(1e6, width * height * fps * 0.12))), framerate: fps, latencyMode: 'quality' };
        try { if ((await VideoEncoder.isConfigSupported(c)).supported) { codec = name; encoder = new VideoEncoder({ output: (chunk) => mux.add(chunk), error: (e) => (failure = e) }); encoder.configure(c); break; } } catch {}
      }
      if (!encoder) throw new DOMException(`No WebCodecs encoder for ${wanted ?? 'vp9 or vp8'} at ${width}×${height}.`, 'NotSupportedError');
      mux = new WebMMuxer({ width, height, codec, fps });
      pad = new OffscreenCanvas(width, height).getContext('2d'); // flatten alpha, even out the size
    }
    pad.fillStyle = background; pad.fillRect(0, 0, width, height);
    pad.drawImage(image, 0, 0, w, h);
    image.close?.();
    let us = Number.isFinite(item?.time) ? Math.round(item.time * 1e6) : Math.round(n * frameUs);
    if (us <= lastUs) us = lastUs + 1000; // strictly increasing, at least 1 ms apart
    lastUs = us;
    const frame = new VideoFrame(pad.canvas, { timestamp: us, duration: Math.round(frameUs) });
    encoder.encode(frame, { keyFrame: n % Math.max(1, Math.round(fps * 2)) === 0 });
    frame.close();
    n++;
    while (encoder.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 2));
    if (failure) throw failure;
    onprogress?.(n);
  }
  if (!encoder) throw new Error('no frames to encode');
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  const blob = mux.finish();
  const meta = { strategy: 'webcodecs frames', frames: mux.frames, scale: 1, width, height, fps, duration: (lastUs + frameUs) / 1000, codec, mimeType: blob.type, ms: Math.round(performance.now() - t0), notes: [] };
  try { Object.defineProperty(blob, 'capture', { value: meta, enumerable: false }); } catch {}
  lastCapture = meta;
  return blob;
}

/** Save any Blob (a video from exportVideo, say) as a file. */
export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return blob;
}

/** The MediaRecorder formats this browser can write, for recordElement({ mimeType }). HEVC in MP4 is in Chrome 136 and later where the device has an encoder. */
export function recordFormats() {
  const all = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm;codecs=av1', 'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=hvc1.1.6.L93.B0', 'video/mp4;codecs=av01.0.08M.08'];
  return typeof MediaRecorder === 'undefined' ? [] : all.filter((t) => MediaRecorder.isTypeSupported(t));
}

// ------------------------------------------------------------------- print

const PAPER = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };

// #region print
/** CSS string for an @page margin box: text with {page} and {pages} replaced by counters. */
function marginBox(where, text) {
  if (!text) return '';
  const parts = String(text).split(/(\{pages?\})/).filter(Boolean).map((part) =>
    part === '{page}' ? 'counter(page)' : part === '{pages}' ? 'counter(pages)' : JSON.stringify(part));
  return `@${where}{content:${parts.join(' ')};font:9pt system-ui,sans-serif;color:#444}`;
}

/**
 * Print one element on its own, paginated, at print resolution.
 * @param {object} [opts] dpi (default 200), paper ('A4'|'A5'|'Letter'), margin in mm,
 *   print (default true; false builds the print document and returns it without opening the dialog),
 *   header, footer: text for the page's margin boxes. A string goes in the centre; an object
 *   { left, center, right } fills up to three boxes. {page} and {pages} become the page number
 *   and the page count. The margin is raised to at least 14 mm so the boxes have room.
 */
export async function printElement(el, { dpi = 200, paper = 'A4', margin = 12, print = true, header, footer, ...rest } = {}) {
  const [pw, ph] = PAPER[paper] ?? PAPER.A4;
  const boxes = [];
  for (const [side, value] of [['top', header], ['bottom', footer]]) {
    const v = typeof value === 'string' ? { center: value } : value ?? {};
    for (const at of ['left', 'center', 'right']) boxes.push(marginBox(`${side}-${at}`, v[at]));
  }
  const marginCss = boxes.join('');
  if (marginCss) margin = Math.max(margin, 14);
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
  // print-color-adjust keeps the picture's background colours when the person has "background graphics" off.
  const css = `@page{size:${pw}mm ${ph}mm;margin:${margin}mm;${marginCss}}html,body{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}img{display:block;width:${widthMm}mm;break-after:page}img:last-child{break-after:auto}`;
  d.open();
  d.write(`<!doctype html><title>${document.title.replace(/[<&]/g, '')}</title><style>${css}</style>`);
  d.close();
  // Did the browser keep the margin boxes? A CSSPageRule lists them as child rules.
  let marginBoxes = 0;
  try { marginBoxes = [...d.styleSheets[0].cssRules].find((r) => r.type === 6 || r.constructor.name === 'CSSPageRule')?.cssRules?.length ?? 0; } catch {}
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
  return { pages, frame, scale: meta.scale, css, marginBoxes, marginBoxesWanted: boxes.filter(Boolean).length };
}
// #endregion print

// ------------------------------------------------------------- conveniences

// #region copy
/**
 * Copy an element to the clipboard. Needs a user gesture.
 * By default the clipboard item holds a PNG only. With { html: true } the same item also
 * holds the element's markup as text/html and its text as text/plain, so a paste into an
 * image editor gives the picture and a paste into a document or a text field gives the content.
 * @returns {Promise<Blob>} the PNG, with `.types` listing what was written.
 */
export async function copyElement(el, { html = false, ...opts } = {}) {
  // Read the markup first: the capture adds temporary attributes to the element.
  const markup = html ? el.outerHTML : '', text = html ? el.innerText ?? el.textContent ?? '' : '';
  // A promise, so the clipboard write starts inside the user gesture and the capture finishes later.
  const png = captureElement(el, { ...opts, type: 'image/png', as: 'blob' });
  const data = { 'image/png': png };
  if (html) {
    // Chrome 133 and later take strings here. Earlier versions need Blobs.
    const strings = (() => { try { new ClipboardItem({ 'text/plain': 'x' }); return true; } catch { return false; } })();
    data['text/html'] = strings ? markup : new Blob([markup], { type: 'text/html' });
    data['text/plain'] = strings ? text : new Blob([text], { type: 'text/plain' });
  }
  await navigator.clipboard.write([new ClipboardItem(data)]);
  const blob = await png;
  blob.types = Object.keys(data);
  return blob;
}
// #endregion copy

// #region folder
/**
 * Ask the person for a folder to save into (File System Access, on desktop and on Android
 * from Chrome 132). Returns a FileSystemDirectoryHandle, or null where the picker is missing.
 */
export async function pickFolder({ mode = 'readwrite', id = 'element-capture' } = {}) {
  if (!('showDirectoryPicker' in window)) return null;
  return window.showDirectoryPicker({ mode, id });
}

/** Write a Blob into a folder handle. With no handle it falls back to a download. */
export async function saveToFolder(blob, filename, folder) {
  if (!folder) { saveBlob(blob, filename); return { where: 'download', filename }; }
  const file = await folder.getFileHandle(filename, { create: true });
  const w = await file.createWritable();
  await w.write(blob);
  await w.close();
  return { where: folder.name || 'folder', filename, bytes: blob.size };
}

/**
 * Call onchange(names) when a file in a folder handle is added, changed or removed.
 * Uses FileSystemObserver where the browser has it and compares lastModified once a
 * second where it does not. Returns { stop(), how }.
 */
export async function watchFolder(folder, onchange, { interval = 1000 } = {}) {
  if ('FileSystemObserver' in window) {
    try {
      const observer = new FileSystemObserver((records) => {
        const names = [...new Set(records.map((r) => r.relativePathComponents?.[0]).filter(Boolean))];
        // Writes go through a swap file (name.crswap) first. Report the real files only.
        const real = names.filter((n) => !n.endsWith('.crswap'));
        if (real.length || !names.length) onchange(real);
      });
      await observer.observe(folder);
      return { how: 'FileSystemObserver', stop: () => observer.disconnect() };
    } catch {}
  }
  const stamp = async () => {
    const m = new Map();
    for await (const [name, h] of folder.entries()) if (h.kind === 'file') { try { const f = await h.getFile(); m.set(name, `${f.lastModified}:${f.size}`); } catch {} }
    return m;
  };
  let before = await stamp(), stopped = false;
  (async function poll() {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, interval));
      if (stopped) break;
      const now = await stamp();
      const names = [...new Set([...now.keys(), ...before.keys()])].filter((n) => now.get(n) !== before.get(n));
      before = now;
      if (names.length) onchange(names);
    }
  })();
  return { how: 'polling', stop: () => { stopped = true; } };
}
// #endregion folder

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
