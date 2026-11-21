// <selection-fx>: draw an effect on the text the reader has selected.
//
//   <script type="module" src="/lib/selection-fx.js"></script>
//
//   <selection-fx effect="glow">
//     <p>Ordinary text. Select some of it.</p>
//   </selection-fx>
//
// The children stay in the light DOM and are slotted into a canvas (see
// surface.js). Selecting works as usual: the browser still owns the selection,
// the clipboard, the Android handles and the copy menu. The element hides the
// browser's highlight colour with ::selection and draws its own picture from
// the rectangles of the selected text.
//
// Attributes
//   effect     highlight | lift | loupe | trail | marker | focus   (2D canvas)
//              caret: a streak behind the caret, wavy lines under `highlight` ranges (2D canvas)
//              glow | burn | wave                                  (shader)
//              key-glow: every pixel near --selection-fx-color glows (shader)
//              none                                                (the browser's own highlight)
//   highlight  name of a CSS Custom Highlight (CSS.highlights) to treat like a
//              selection, for search results and similar. Call refresh() after
//              changing the Highlight if it has no ::highlight() style.
//   engine     auto | webgpu | webgl | 2d. Shader effects use WebGPU when
//              /shared/backend.js says it works, then WebGL. With neither the
//              element draws the "highlight" effect and `note` says why.
//   native     keep the browser's highlight colour as well.
//   bleed      CSS px of canvas outside the box for glows and the loupe (default 28).
//
// CSS properties on the element
//   --selection-fx-color   the effect's colour (each effect has a default)
//   --selection-fx-bg      the colour the text sits on, when the text has its
//                          own opaque background. Shaders use it to tell glyphs
//                          from background.
//   --selection-fx-amount  strength, default 1
//
// Script
//   el.rects       the selected text as [{x, y, w, h}] in CSS px from the element's top-left
//   el.focusPoint  {x, y, h} where the moving end of the selection is, or null
//   el.caret       {x, y, w, h} of the caret while the selection is collapsed in the element
//   el.marked      the rectangles that come from the `highlight` attribute
//   el.engine      '2d' | 'webgl' | 'webgpu'
//   el.note        why a wanted engine is not in use
//   el.refresh()   measure again
//   'selectionfx'  event, detail { rects, text }
//   'selectionfxengine'  event when the first frame is drawn on a new engine, detail { engine, note }
//
// Your own effect:
//
//   import { defineSelectionEffect } from '/lib/selection-fx.js';
//   defineSelectionEffect('box', {                 // 2D
//     draw(ctx, s, el) {                           // ctx is in CSS px, origin at the element's corner
//       el.drawContent(ctx);
//       ctx.strokeStyle = s.color.css;
//       for (const r of s.rects) ctx.strokeRect(r.x, r.y, r.w, r.h);
//     },
//   });
//   defineSelectionEffect('tint', {                // shader: GLSL for WebGL, WGSL for WebGPU
//     glsl: `vec4 fx(vec2 p) { vec4 c = tex(p); return mix(c, u_color * c.a, ink(p) * sel(p).r); }`,
//     wgsl: `fn fx(p: vec2f) -> vec4f { let c = tex(p); return mix(c, u.color * c.a, ink(p) * sel(p).r); }`,
//   });
//
// Shader inputs. `p` is in CSS px from the element's top-left.
//   tex(p)     the element's picture, premultiplied, clear outside the box
//   sel(p)     r: 1 inside the selected rectangles, g: rectangles selected in
//              the last 1.2 s, fading, b: the selected rectangles blurred by 10 px
//   ink(p)     0..1, how much glyph is at p (alpha times distance from --selection-fx-bg)
//   u_time (s), u_since (s since something became selected), u_amount,
//   u_size, u_focus (px, far away when there is none), u_color, u_bg

import { SurfaceElement, ElementTexture, supportedGL, program, cssZoom } from './surface.js';
import { supportedGPU, GPUCanvas, GPUElementTexture, watchFrame } from './gpu-util.js';
import { webgpu } from '../shared/backend.js';

const TRAIL = 1.2; // seconds a deselected rectangle stays in sel().g and in the "trail" effect
const effects = new Map();
const instances = new Set();

/** Add or replace an effect. See the top of this file. */
export function defineSelectionEffect(name, def) {
  effects.set(name, { ...def, kind: def.draw ? '2d' : 'shader' });
  for (const el of instances) if (el.effectName === name) el.effectChanged();
}
export { effects as selectionEffects };

// ------------------------------------------------------------------ measuring

// #region rects
/**
 * The rectangles of the text inside `range`, limited to `root`. One Range per
 * text node, so the boxes of block elements that happen to be fully selected
 * are not included (range.getClientRects() on the whole range returns those too).
 */
export function textRects(range, root) {
  const out = [];
  if (!range || range.collapsed || !range.intersectsNode(root)) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const part = new Range();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start) continue;
    part.setStart(node, start);
    part.setEnd(node, end);
    for (const q of part.getClientRects()) if (q.width > 0.5 && q.height > 0.5) out.push(q);
  }
  return out;
}

/** Join rectangles that sit next to each other on one line, so a line with a link and an <em> in it is one box. */
export function mergeLines(rects) {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const r of sorted) {
    const last = lines.find((l) => {
      const overlap = Math.min(l.y + l.h, r.y + r.h) - Math.max(l.y, r.y);
      return overlap > 0.6 * Math.min(l.h, r.h) && r.x <= l.x + l.w + 2 && r.x + r.w >= l.x - 2;
    });
    if (!last) lines.push({ ...r });
    else {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      last.w = Math.max(last.x + last.w, r.x + r.w) - x;
      last.h = Math.max(last.y + last.h, r.y + r.h) - y;
      last.x = x;
      last.y = y;
    }
  }
  return lines;
}
// #endregion rects

const colourProbe = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) : null;
const colourCache = new Map();
/** Any CSS colour as { r, g, b, a } in 0..1 plus the string. */
function colour(text, fallback) {
  const key = text || fallback;
  let c = colourCache.get(key);
  if (c) return c;
  let d = [0, 0, 0, 255];
  if (colourProbe) {
    colourProbe.clearRect(0, 0, 1, 1);
    colourProbe.fillStyle = fallback;
    colourProbe.fillStyle = key; // an invalid value leaves the fallback in place
    colourProbe.fillRect(0, 0, 1, 1);
    d = colourProbe.getImageData(0, 0, 1, 1).data;
  }
  c = { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255, css: `rgb(${d[0]} ${d[1]} ${d[2]})` };
  c.alpha = (a) => `rgb(${d[0]} ${d[1]} ${d[2]} / ${a})`;
  c.lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  colourCache.set(key, c);
  return c;
}

/** The first background colour behind an element that is not transparent. */
function backgroundBehind(el) {
  for (let n = el; n; n = n.parentElement ?? n.getRootNode()?.host) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg) && colour(bg, '#fff').a > 0.5) return bg;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? '#121212' : '#ffffff';
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);
const mix = (a, b, t) => a + (b - a) * t;

// One stylesheet for the document: while an element is drawing an effect, the
// browser's own highlight colour is transparent inside it. Text colour is left
// alone (no `color` in the rule), so the glyphs draw as if nothing was selected.
// #region hide
let sheet = null;
function hideNativeHighlight() {
  if (sheet) return;
  sheet = new CSSStyleSheet();
  sheet.replaceSync('selection-fx[fx-live]:not([native]) ::selection, selection-fx[fx-live]:not([native])::selection { background-color: transparent; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
// #endregion hide

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  // A lost WebGPU device leaves its canvases showing the browser's broken-canvas
  // picture, and nothing redraws an idle element. Move every element off it now.
  addEventListener('webgpulost', () => {
    for (const el of instances) el.gpuLost();
  });
  // #region listen
  document.addEventListener('selectionchange', () => {
    for (const el of instances) el.refresh();
  });
  // #endregion listen
}

// --------------------------------------------------------------- the element

export class SelectionFx extends SurfaceElement {
  static contextType = '2d';
  static defaultBleed = 28;
  static observedAttributes = ['effect', 'engine', 'highlight', 'native'];

  /** '2d' | 'webgl' | 'webgpu' once a context exists. */
  engine = null;
  /** Why the engine asked for (or WebGPU) is not the one in use. */
  note = '';
  rects = [];
  /** The part of `rects` that comes from the `highlight` attribute's Highlight. */
  marked = [];
  focusPoint = null;
  /** {x, y, w, h} of the caret when the selection is collapsed inside the element, else null. */
  caret = null;
  frames = 0;

  #signature = '';
  #markSignature = '';
  #caretFrom = null;
  #caretAt = -1e9;
  #changedAt = -1e9;
  #startedAt = -1e9;
  #prev = [];
  #gl = null;
  #gpu = null;
  #mask = null;
  #maskDirty = true;
  #measureQueued = false;
  #offscreen = false;

  get effectName() {
    const name = this.getAttribute('effect') || 'highlight';
    return effects.has(name) ? name : 'highlight';
  }
  get #def() {
    return effects.get(this.effectName);
  }
  /** The engine this effect should have, before asking whether it is available. */
  get #wanted() {
    const ask = this.getAttribute('engine') || 'auto';
    if (this.#def.kind === '2d' || ask === '2d') return '2d';
    return ask;
  }

  /** Called when the page's WebGPU device is lost. */
  gpuLost() {
    this.#leaveGPU(webgpu.reason || 'the WebGPU device was lost');
  }

  // #region recover
  // A canvas that loses its context shows a white box with a broken-picture
  // icon. Waiting for it to come back leaves that on screen, so the element
  // moves its content to a new canvas with a 2D context straight away. A second
  // loss on the 2D canvas is left to SurfaceElement, which shows plain HTML.
  #losses = 0;
  #watch(canvas) {
    // 2D canvases fire contextlost, WebGL canvases webglcontextlost.
    const lost = () => {
      if (canvas !== this.canvas || !this.live) return;
      const was = this.engine;
      if (was === '2d' && this.#losses++ > 0) return;
      this.#drop();
      this.#lostNote = `the ${was} canvas lost its context`;
      if (this.getAttribute('engine') === '2d') this.swapCanvas();
      else this.setAttribute('engine', '2d');
      this.dispatchEvent(new CustomEvent('selectionfxfallback', { detail: { from: was, reason: this.#lostNote }, bubbles: true }));
    };
    canvas.addEventListener('contextlost', lost);
    canvas.addEventListener('webglcontextlost', lost);
  }
  #lostNote = '';
  swapCanvas() {
    super.swapCanvas();
    if (this.canvas) this.#watch(this.canvas);
  }
  // #endregion recover

  // #region look
  // A GPU canvas can validate every call and still show nothing, or one flat
  // colour (seen on Android). Look at a small copy of frames 3 and 20 on a GPU
  // engine; if there is no picture, draw with the 2D canvas instead.
  #engineFrames = 0;
  #lookAtPicture() {
    if (this.engine === '2d' || this.#offscreen) return;
    const n = ++this.#engineFrames;
    if (n !== 3 && n !== 20) return;
    let flat = true;
    try {
      const probe = (SelectionFx.probe ??= new OffscreenCanvas(24, 24).getContext('2d', { willReadFrequently: true }));
      probe.clearRect(0, 0, 24, 24);
      probe.drawImage(this.canvas, 0, 0, 24, 24);
      const d = probe.getImageData(0, 0, 24, 24).data;
      for (let i = 4; i < d.length && flat; i += 4) flat = Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) + Math.abs(d[i + 3] - d[3]) < 12;
    } catch {
      return;
    }
    if (!flat) return;
    const was = this.engine;
    queueMicrotask(() => {
      if (this.engine !== was) return;
      this.#drop();
      this.#lostNote = `the ${was} canvas showed no picture`;
      this.setAttribute('engine', '2d');
      this.dispatchEvent(new CustomEvent('selectionfxfallback', { detail: { from: was, reason: this.#lostNote }, bubbles: true }));
    });
  }
  // #endregion look

  /** Give the GPU context back now. For fixtures that are about to be removed. */
  dispose() {
    const canvas = this.canvas;
    this.#drop();
    this.live = false;
    // Out of the document first. In Chromium 157, losing the context of a WebGL
    // canvas that is still attached and holds an element texture crashed the tab.
    // So the canvas is retired: the guard frees it a moment after it has left the page.
    this.remove();
    globalThis.__gfx?.retire(canvas);
  }

  connected() {
    instances.add(this);
    this.#watch(this.canvas);
    listen();
    hideNativeHighlight();
    this.#syncLive();
    this.refresh();
  }
  disconnected() {
    instances.delete(this);
  }
  resized() {
    this.#maskDirty = true;
    this.#queueMeasure();
  }
  fallBackToPlain(reason) {
    super.fallBackToPlain(reason);
    this.removeAttribute('fx-live'); // the browser's highlight comes back
    this.note = reason;
  }
  attributeChangedCallback(name, before, after) {
    if (before === after || !this.live || !this.canvas) return;
    if (name === 'effect' || name === 'engine') this.effectChanged();
    else {
      this.#syncLive();
      this.refresh();
    }
  }
  /** The effect or its definition changed: keep the canvas when the engine still fits, else start on a new one. */
  effectChanged() {
    this.#syncLive();
    this.#signature = '';
    this.#startedAt = performance.now() / 1000;
    const want = this.#wanted;
    // A canvas keeps its first kind of context. `#gaveUp` means a GPU engine was wanted and none could start.
    const fits = want === '2d' ? this.engine === '2d' : this.engine === 'webgpu' ? want !== 'webgl' : this.engine === 'webgl' ? want !== 'webgpu-offscreen' : this.#gaveUp;
    if (this.ctx && !fits) {
      this.#drop();
      this.swapCanvas();
    } else this.invalidate();
    this.refresh();
  }
  #gaveUp = false;
  #told = null;
  #syncLive() {
    this.toggleAttribute('fx-live', this.live && !this.#def.native);
  }

  // ---- contexts

  createContext(canvas) {
    const want = this.#wanted;
    this.#offscreen = want === 'webgpu-offscreen';
    this.note = this.#lostNote;
    this.#lostNote = '';
    this.#engineFrames = 0;
    this.#gaveUp = false;
    if (want === '2d') return this.#context2d(canvas);
    if (want === 'webgl') return this.#contextGL(canvas);
    if (!supportedGPU) {
      this.note = 'this browser cannot put an element into a WebGPU texture';
      return this.#contextGL(canvas);
    }
    if (!this.#def.wgsl) {
      this.note = `the effect "${this.effectName}" has no WGSL source`;
      return this.#contextGL(canvas);
    }
    return webgpu({ force: this.#offscreen }).then((gpu) => {
      if (!gpu || gpu.lost) {
        this.note = webgpu.reason || 'WebGPU did not start';
        return this.#contextGL(canvas);
      }
      try {
        const surface = new GPUCanvas(canvas, gpu, { present: !this.#offscreen });
        this.#gpu = { surface, device: gpu.device, format: gpu.format, pipelines: new Map(), checked: false };
        this.engine = 'webgpu';
        return surface.context;
      } catch (err) {
        this.note = err.message;
        return this.#contextGL(canvas);
      }
    });
  }
  #context2d(canvas) {
    this.engine = '2d';
    return canvas.getContext('2d');
  }
  #contextGL(canvas) {
    const gl = supportedGL ? canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false }) : null;
    if (!gl) {
      this.note ||= 'this browser cannot put an element into a WebGL texture';
      this.#gaveUp = true;
      return this.#context2d(canvas);
    }
    this.engine = 'webgl';
    this.#gl = { gl, programs: new Map(), tex: new ElementTexture(gl, canvas, this.content), maskTex: gl.createTexture() };
    gl.bindTexture(gl.TEXTURE_2D, this.#gl.maskTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return gl;
  }
  #drop() {
    this.#gpu?.tex?.destroy();
    this.#gpu?.maskTex?.destroy();
    this.#gpu?.surface.destroy();
    this.#gpu = this.#gl = null;
    this.engine = null;
  }
  /** Leave WebGPU for WebGL, with the reason in `note`. */
  #leaveGPU(reason) {
    if (this.engine !== 'webgpu') return;
    this.#drop();
    this.setAttribute('engine', 'webgl');
    this.note = reason;
    this.dispatchEvent(new CustomEvent('selectionfxfallback', { detail: { from: 'webgpu', reason }, bubbles: true }));
  }

  // ---- measuring

  /** Measure the selection again and redraw if it changed. */
  refresh() {
    if (!this.live || !this.isConnected) return;
    this.#measure();
  }
  #queueMeasure() {
    if (this.#measureQueued) return;
    this.#measureQueued = true;
    queueMicrotask(() => {
      this.#measureQueued = false;
      this.refresh();
    });
  }

  // #region measure
  #measure() {
    const ranges = [];
    const selection = getSelection();
    for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
    const marks = [];
    const name = this.getAttribute('highlight');
    if (name && globalThis.CSS?.highlights?.has(name)) marks.push(...CSS.highlights.get(name));

    // Client rectangles follow where the canvas last drew the element. This
    // element always leaves the geometry at the layout position (render() ends
    // with setGeometry()), so subtracting the host's corner gives element px.
    const base = this.getBoundingClientRect();
    const zoom = cssZoom(this);
    const local = (q) => ({ x: (q.left - base.left) / zoom, y: (q.top - base.top) / zoom, w: q.width / zoom, h: q.height / zoom });
    const selected = ranges.flatMap((range) => textRects(range, this)).map(local);
    const marked = mergeLines(marks.flatMap((range) => textRects(range, this)).map(local));
    const rects = mergeLines([...selected, ...marked]);
    const markSignature = marked.map((r) => `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)}`).join(';');
    if (markSignature !== this.#markSignature) {
      this.#markSignature = markSignature;
      this.marked = marked;
      this.invalidate();
    }

    // Where the moving end of the selection is (the end under the finger).
    let focus = null;
    if (selection.focusNode && this.contains(selection.focusNode) && !selection.isCollapsed) {
      const caret = new Range();
      caret.setStart(selection.focusNode, selection.focusOffset);
      const q = caret.getClientRects()[0] ?? caret.getBoundingClientRect();
      if (q && q.height) focus = local(q);
      else if (rects.length) {
        const order = new Range();
        order.setStart(selection.anchorNode, selection.anchorOffset);
        order.setEnd(selection.focusNode, selection.focusOffset);
        const backward = order.collapsed;
        const r = backward ? rects[0] : rects.at(-1);
        focus = { x: backward ? r.x : r.x + r.w, y: r.y, w: 0, h: r.h };
      }
    }
    this.focusPoint = focus;

    // #region caret
    // The caret, when the selection is collapsed inside this element. A
    // collapsed Range has one client rectangle of zero width at the caret.
    let caret = null;
    if (selection.isCollapsed && selection.focusNode && this.contains(selection.focusNode)) {
      const at = new Range();
      at.setStart(selection.focusNode, selection.focusOffset);
      const q = at.getClientRects()[0];
      if (q && q.height) caret = local(q);
    }
    const same = (a, b) => (!a && !b) || (a && b && Math.abs(a.x - b.x) < 0.3 && Math.abs(a.y - b.y) < 0.3);
    if (!same(caret, this.caret)) {
      this.#caretFrom = this.caret && caret ? this.caret : null;
      this.#caretAt = performance.now() / 1000;
      this.caret = caret;
      this.invalidate();
      this.dispatchEvent(new CustomEvent('selectionfxcaret', { detail: { caret }, bubbles: true }));
    }
    // #endregion caret

    const signature = rects.map((r) => `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)},${r.h.toFixed(1)}`).join(';');
    if (signature === this.#signature) return;
    const now = performance.now() / 1000;
    if (this.rects.length) this.#prev.push({ rects: this.rects, t: now });
    if (this.#prev.length > 12) this.#prev.shift();
    if (!this.rects.length && rects.length) this.#startedAt = now;
    this.#signature = signature;
    this.#changedAt = now;
    this.rects = rects;
    this.#maskDirty = true;
    this.invalidate();
    this.dispatchEvent(new CustomEvent('selectionfx', { detail: { rects, text: rects.length ? selection.toString() : '' }, bubbles: true }));
  }
  // #endregion measure

  // ---- drawing

  /** Draw the whole element at its place. For 2D effects. */
  drawContent(ctx, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawElementImage(this.content, 0, 0, this.width, this.height);
    ctx.restore();
  }

  #state(time) {
    const now = time / 1000;
    const still = reduced.matches;
    const style = getComputedStyle(this);
    const def = this.#def;
    const bg = colour(style.getPropertyValue('--selection-fx-bg').trim() || backgroundBehind(this), '#fff');
    this.#prev = still ? [] : this.#prev.filter((p) => now - p.t < TRAIL);
    return {
      rects: this.rects,
      marked: this.marked,
      focus: this.focusPoint,
      caret: this.caret,
      caretFrom: this.#caretFrom,
      caretAge: still ? 10 : now - this.#caretAt,
      trail: this.#prev.map((p) => ({ rects: p.rects, age: (now - p.t) / TRAIL })),
      time: still ? 0 : now,
      since: still ? 10 : now - this.#startedAt,
      sinceChange: still ? 10 : now - this.#changedAt,
      width: this.width,
      height: this.height,
      bleed: this.bleed,
      amount: parseFloat(style.getPropertyValue('--selection-fx-amount')) || 1,
      color: colour(style.getPropertyValue('--selection-fx-color').trim() || def.color, '#f5a300'),
      bg,
      fg: colour(style.color, '#000'),
      dark: bg.lum < 0.4,
      still,
    };
  }

  render(time) {
    let def = this.#def;
    if (def.kind === 'shader' && this.engine === '2d') def = effects.get('highlight'); // no GPU route: see `note`
    const s = this.#state(time);
    if (this.engine === '2d') {
      const ctx = this.ctx;
      ctx.reset();
      ctx.scale(this.scale, this.scale);
      ctx.translate(this.bleed, this.bleed);
      def.draw(ctx, s, this);
    } else if (this.engine === 'webgl') this.#renderGL(def, s);
    else if (this.engine === 'webgpu') this.#renderGPU(def, s);
    // Selecting, the caret and the handles all happen where the text is laid
    // out, whatever the effect drew.
    this.setGeometry();
    this.contentDirty = false;
    this.frames++;
    this.#lookAtPicture();
    if (this.engine !== this.#told) {
      this.#told = this.engine;
      this.dispatchEvent(new CustomEvent('selectionfxengine', { detail: { engine: this.engine, note: this.note }, bubbles: true }));
    }
    const settling = s.sinceChange < TRAIL + 0.2 || s.since < 1.2 || s.caretAge < 0.5;
    const again = !s.still && (settling || (def.animated && (s.rects.length > 0 || !!s.caret)));
    if (again) this.#maskDirty = true;
    return again;
  }

  // #region mask
  // What the shaders know about the selection: a small picture the size of the
  // canvas. Red is the selected rectangles, green the ones selected a moment
  // ago (fading), blue the selected rectangles blurred.
  #drawMask(s) {
    const cssW = this.canvas.width / this.scale;
    const cssH = this.canvas.height / this.scale;
    const k = Math.min(this.scale, 2, 2048 / cssW, 2048 / cssH);
    const w = Math.max(1, Math.round(cssW * k));
    const h = Math.max(1, Math.round(cssH * k));
    this.#mask ??= new OffscreenCanvas(w, h);
    const mask = this.#mask;
    if (mask.width !== w || mask.height !== h) {
      mask.width = w;
      mask.height = h;
    }
    const m = mask.getContext('2d');
    m.reset();
    m.fillStyle = '#000';
    m.fillRect(0, 0, w, h);
    m.scale(k, k);
    m.translate(this.bleed, this.bleed);
    m.globalCompositeOperation = 'lighter';
    for (const t of s.trail) {
      m.fillStyle = `rgb(0 255 0 / ${1 - t.age})`;
      for (const r of t.rects) m.fillRect(r.x, r.y, r.w, r.h);
    }
    m.fillStyle = '#f00';
    for (const r of s.rects) m.fillRect(r.x, r.y, r.w, r.h);
    m.filter = 'blur(10px)';
    m.fillStyle = '#00f';
    for (const r of s.rects) m.fillRect(r.x, r.y, r.w, r.h);
    return mask;
  }
  // #endregion mask

  #uniforms(s, texW, texH) {
    const sc = this.scale;
    return {
      canvas: [this.canvas.width / sc, this.canvas.height / sc],
      origin: [this.bleed, this.bleed],
      size: [this.width, this.height],
      texSize: [texW / sc, texH / sc],
      focus: s.focus && s.rects.length ? [s.focus.x, s.focus.y + s.focus.h / 2] : [-1e4, -1e4],
      time: s.time % 600,
      since: Math.min(s.since, 100),
      amount: s.amount,
      scale: sc,
      color: [s.color.r, s.color.g, s.color.b, 1],
      bg: [s.bg.r, s.bg.g, s.bg.b, 1],
    };
  }

  // #region webgl
  #renderGL(def, s) {
    const g = this.#gl;
    const { gl } = g;
    let entry = g.programs.get(def);
    if (!entry) {
      entry = { program: null, u: {} };
      try {
        entry.program = program(gl, GLSL_VERT, GLSL_HEAD + def.glsl + GLSL_TAIL);
        for (const n of ['u_tex', 'u_mask', 'u_canvas', 'u_origin', 'u_size', 'u_texSize', 'u_focus', 'u_time', 'u_since', 'u_amount', 'u_scale', 'u_color', 'u_bg']) entry.u[n] = gl.getUniformLocation(entry.program, n);
      } catch (err) {
        this.lastError = err;
        console.error(err);
      }
      g.programs.set(def, entry);
    }
    if (!entry.program) return;
    // The element's picture: uploaded again only when the browser repainted it.
    if (this.contentDirty || !g.tex.width) g.tex.update();
    if (this.#maskDirty) {
      gl.bindTexture(gl.TEXTURE_2D, g.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.#drawMask(s));
      this.#maskDirty = false;
    }
    const v = this.#uniforms(s, g.tex.width, g.tex.height);
    const u = entry.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(entry.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tex.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.maskTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform1i(u.u_mask, 1);
    gl.uniform2fv(u.u_canvas, v.canvas);
    gl.uniform2fv(u.u_origin, v.origin);
    gl.uniform2fv(u.u_size, v.size);
    gl.uniform2fv(u.u_texSize, v.texSize);
    gl.uniform2fv(u.u_focus, v.focus);
    gl.uniform1f(u.u_time, v.time);
    gl.uniform1f(u.u_since, v.since);
    gl.uniform1f(u.u_amount, v.amount);
    gl.uniform1f(u.u_scale, v.scale);
    gl.uniform4fv(u.u_color, v.color);
    gl.uniform4fv(u.u_bg, v.bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // #endregion webgl

  // #region webgpu
  #renderGPU(def, s) {
    const g = this.#gpu;
    if (g.surface.lost) return this.#leaveGPU(webgpu.reason || 'the WebGPU device was lost');
    const { device } = g;
    const frame = () => {
      g.tex ??= new GPUElementTexture(device, this.canvas, this.content);
      if (this.contentDirty || !g.tex.width) g.tex.update();
      if (this.#maskDirty || !g.maskTex) {
        const mask = this.#drawMask(s);
        if (!g.maskTex || g.maskTex.width !== mask.width || g.maskTex.height !== mask.height) {
          g.maskTex?.destroy();
          g.maskTex = device.createTexture({ size: [mask.width, mask.height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
          g.bind = null;
        }
        device.queue.copyExternalImageToTexture({ source: mask }, { texture: g.maskTex }, [mask.width, mask.height]);
        this.#maskDirty = false;
      }
      let pipeline = g.pipelines.get(def);
      if (!pipeline) {
        const module = device.createShaderModule({ code: WGSL_HEAD + def.wgsl + WGSL_TAIL });
        pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: g.format }] } });
        g.pipelines.set(def, pipeline);
        g.bind = null;
      }
      g.sampler ??= device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      g.buffer ??= device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const v = this.#uniforms(s, g.tex.width, g.tex.height);
      device.queue.writeBuffer(g.buffer, 0, new Float32Array([...v.canvas, ...v.origin, ...v.size, ...v.texSize, ...v.focus, v.time, v.since, v.amount, v.scale, 0, 0, ...v.color, ...v.bg]));
      if (!g.bind || g.bind.pipeline !== pipeline || g.bind.view !== g.tex.view) {
        g.bind = {
          pipeline,
          view: g.tex.view,
          group: device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: g.buffer } }, { binding: 1, resource: g.sampler }, { binding: 2, resource: g.tex.view }, { binding: 3, resource: g.maskTex.createView() }],
          }),
        };
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: g.surface.view(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, g.bind.group);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      // Two empty frames in a row: WebGPU validates but shows nothing here. Use WebGL.
      g.surface.shown((why) => this.#gpu === g && this.#leaveGPU(why));
    };
    if (g.checked) return frame();
    g.checked = true;
    // The first frame is watched, so a browser whose WebGPU rejects it goes to WebGL with the reason.
    watchFrame(device, frame, (problem) => this.#gpu === g && this.#leaveGPU(`WebGPU rejected the first frame: ${problem}`));
  }
  // #endregion webgpu

  /** The canvas as ImageData, for checks. Draws a frame first. */
  async readback() {
    this.contentDirty = true;
    this.#maskDirty = true;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.engine === 'webgpu') {
      if (!this.#offscreen) throw new Error('readback on WebGPU needs engine="webgpu-offscreen"');
      this.render(performance.now());
      await this.#gpu.device.queue.onSubmittedWorkDone();
      return this.#gpu.surface.read();
    }
    this.render(performance.now());
    if (this.engine === '2d') return this.ctx.getImageData(0, 0, w, h);
    const gl = this.#gl.gl;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // top row first
    return new ImageData(out, w, h);
  }
}

// ------------------------------------------------------------ shader contract

const GLSL_VERT = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const GLSL_HEAD = `#version 300 es
precision highp float;
uniform sampler2D u_tex, u_mask;
uniform vec2 u_canvas, u_origin, u_size, u_texSize, u_focus;
uniform float u_time, u_since, u_amount, u_scale;
uniform vec4 u_color, u_bg;
out vec4 outColor;
vec4 tex(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) return vec4(0.0);
  return texture(u_tex, p / u_texSize);
}
vec3 sel(vec2 p) { return texture(u_mask, (p + u_origin) / u_canvas).rgb; }
float ink(vec2 p) {
  vec4 c = tex(p);
  if (c.a < 0.02) return 0.0;
  return c.a * smoothstep(0.08, 0.3, distance(c.rgb / c.a, u_bg.rgb));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
const GLSL_TAIL = `
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_canvas.y * u_scale - gl_FragCoord.y) / u_scale - u_origin;
  outColor = fx(p);
}`;

const WGSL_HEAD = `
struct U {
  canvas: vec2f, origin: vec2f, size: vec2f, texSize: vec2f, focus: vec2f,
  time: f32, since: f32, amount: f32, scale: f32,
  color: vec4f, bg: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var element: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
fn tex(p: vec2f) -> vec4f {
  let c = textureSampleLevel(element, smp, p / u.texSize, 0.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x > u.size.x || p.y > u.size.y) { return vec4f(0.0); }
  return c;
}
fn sel(p: vec2f) -> vec3f { return textureSampleLevel(mask, smp, (p + u.origin) / u.canvas, 0.0).rgb; }
fn ink(p: vec2f) -> f32 {
  let c = tex(p);
  if (c.a < 0.02) { return 0.0; }
  return c.a * smoothstep(0.08, 0.3, distance(c.rgb / c.a, u.bg.rgb));
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), f.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn fbm(p0: vec2f) -> f32 { var v = 0.0; var a = 0.5; var p = p0; for (var i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
const WGSL_TAIL = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return fx(pos.xy / u.scale - u.origin);
}`;

/** The full shader sources for an effect, as compiled. For checks and for showing the code. */
export function shaderSource(name) {
  const def = effects.get(name);
  return { glsl: def?.glsl ? GLSL_HEAD + def.glsl + GLSL_TAIL : null, wgsl: def?.wgsl ? WGSL_HEAD + def.wgsl + WGSL_TAIL : null };
}

// ------------------------------------------------------------- 2D effects

const round = (ctx, r, pad = 0, radius = 4) => {
  ctx.beginPath();
  ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, radius);
};

// The browser's own highlight, drawn into the canvas with the text.
defineSelectionEffect('none', {
  native: true,
  draw(ctx, s, el) {
    el.drawContent(ctx);
  },
});

// #region effect-highlight
// Rounded boxes behind the text, in any colour.
defineSelectionEffect('highlight', {
  color: '#ffd24a',
  draw(ctx, s, el) {
    const k = ease(s.since / 0.18);
    ctx.fillStyle = s.color.alpha(s.dark ? 0.45 : 0.6);
    for (const r of s.rects) {
      round(ctx, r, 1 + 2 * k, 5);
      ctx.fill();
    }
    el.drawContent(ctx);
  },
});
// #endregion effect-highlight

// #region effect-lift
// The selected lines are drawn a second time, larger, on a plate with a
// shadow. Everything else is dimmed.
defineSelectionEffect('lift', {
  color: '#2f6fed',
  draw(ctx, s, el) {
    const k = s.rects.length ? ease(s.since / 0.35) : 0;
    el.drawContent(ctx, mix(1, 0.4, k));
    for (const r of s.rects) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.save();
      ctx.translate(cx, cy - 3 * k);
      ctx.scale(1 + 0.07 * k, 1 + 0.07 * k);
      ctx.translate(-cx, -cy);
      ctx.save();
      ctx.shadowColor = `rgb(0 0 0 / ${0.35 * k})`;
      ctx.shadowBlur = 14 * k * el.scale;
      ctx.shadowOffsetY = 6 * k * el.scale;
      ctx.fillStyle = s.bg.css;
      round(ctx, r, 3, 6);
      ctx.fill();
      ctx.restore();
      round(ctx, r, 3, 6);
      ctx.clip();
      el.drawContent(ctx);
      ctx.fillStyle = s.color.alpha(0.14);
      ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
      ctx.restore();
    }
  },
});
// #endregion effect-lift

// #region effect-loupe
// A magnifier above the moving end of the selection, where a finger would be.
defineSelectionEffect('loupe', {
  color: '#2f6fed',
  draw(ctx, s, el) {
    const boxes = () => {
      ctx.fillStyle = s.color.alpha(0.28);
      for (const r of s.rects) {
        round(ctx, r, 1, 3);
        ctx.fill();
      }
    };
    boxes();
    el.drawContent(ctx);
    const f = s.focus;
    if (!f || !s.rects.length) return;
    const k = ease(s.since / 0.2);
    const zoom = 1.7;
    const w = Math.min(170, s.width + 2 * s.bleed - 8);
    const h = Math.max(46, f.h * zoom + 14);
    const fx = f.x;
    const fy = f.y + f.h / 2;
    const x = Math.max(-s.bleed + 4, Math.min(s.width + s.bleed - w - 4, fx - w / 2));
    let y = f.y - h - 10;
    if (y < -s.bleed + 2) y = f.y + f.h + 26; // no room above: go below, clear of an Android handle
    const plate = { x, y, w, h };
    ctx.save();
    ctx.globalAlpha = k;
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / .35)';
    ctx.shadowBlur = 16 * el.scale;
    ctx.shadowOffsetY = 5 * el.scale;
    ctx.fillStyle = s.bg.css;
    round(ctx, plate, 0, 12);
    ctx.fill();
    ctx.restore();
    round(ctx, plate, 0, 12);
    ctx.clip();
    // Map the focus point to the middle of the plate, magnified. The text is
    // drawn again from the element, so it is sharp at this size, not scaled pixels.
    ctx.translate(Math.max(x + 16, Math.min(x + w - 16, fx)), y + h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-fx, -fy);
    boxes();
    el.drawContent(ctx);
    ctx.fillStyle = s.color.css;
    ctx.fillRect(fx - 0.75, f.y, 1.5, f.h);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = k;
    ctx.strokeStyle = s.color.alpha(0.8);
    ctx.lineWidth = 1.5;
    round(ctx, plate, 0, 12);
    ctx.stroke();
    ctx.restore();
  },
});
// #endregion effect-loupe

// #region effect-trail
// Rectangles that were selected a moment ago stay for 1.2 s and fade.
defineSelectionEffect('trail', {
  color: '#e0218a',
  draw(ctx, s, el) {
    for (const t of s.trail) {
      ctx.fillStyle = `hsl(${320 - 200 * t.age} 90% 60% / ${0.5 * (1 - t.age) ** 2})`;
      for (const r of t.rects) {
        round(ctx, r, 1 + 10 * t.age, 4 + 10 * t.age);
        ctx.fill();
      }
    }
    ctx.fillStyle = s.color.alpha(0.45);
    for (const r of s.rects) {
      round(ctx, r, 2, 5);
      ctx.fill();
    }
    el.drawContent(ctx);
  },
});
// #endregion effect-trail

// #region effect-marker
// A highlighter pen: an uneven stroke per line, drawn left to right, one line after the other.
defineSelectionEffect('marker', {
  color: '#ffe14a',
  draw(ctx, s, el) {
    const jitter = (r, n) => (((Math.sin(r.y * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1 - 0.5;
    ctx.fillStyle = s.color.alpha(s.dark ? 0.5 : 0.75);
    s.rects.forEach((r, i) => {
      const k = ease((s.since - i * 0.09) / 0.3);
      if (k <= 0) return;
      const top = r.y + r.h * 0.12 + jitter(r, 1) * 3;
      const bottom = r.y + r.h * 0.92 + jitter(r, 2) * 3;
      const x0 = r.x - 3 + jitter(r, 3) * 3;
      const x1 = r.x + (r.w + 4 + jitter(r, 4) * 4) * k;
      const lean = jitter(r, 5) * 3;
      ctx.beginPath();
      ctx.moveTo(x0 + 2, top + lean);
      // The top and bottom edges wander a little, like a felt tip.
      for (let x = x0; x <= x1; x += 14) ctx.lineTo(x, top + lean * (1 - (x - x0) / Math.max(1, x1 - x0)) + jitter({ y: r.y + x }, 6) * 1.6);
      ctx.lineTo(x1 + 2, top + 1);
      ctx.lineTo(x1, bottom);
      for (let x = x1; x >= x0; x -= 14) ctx.lineTo(x, bottom + jitter({ y: r.y + x }, 7) * 1.6);
      ctx.lineTo(x0 - 1, bottom - 1);
      ctx.closePath();
      ctx.fill();
    });
    el.drawContent(ctx);
  },
});
// #endregion effect-marker

// #region effect-focus
// The text that is not selected is blurred and dimmed.
defineSelectionEffect('focus', {
  color: '#2f6fed',
  draw(ctx, s, el) {
    const k = s.rects.length ? ease(s.since / 0.4) : 0;
    if (k > 0) ctx.filter = `blur(${(2.2 * k * el.scale).toFixed(2)}px)`;
    el.drawContent(ctx, mix(1, 0.55, k));
    ctx.filter = 'none';
    if (!k) return;
    ctx.save();
    ctx.beginPath();
    for (const r of s.rects) ctx.roundRect(r.x - 4, r.y - 2, r.w + 8, r.h + 4, 4);
    ctx.clip();
    ctx.clearRect(-s.bleed, -s.bleed, s.width + 2 * s.bleed, s.height + 2 * s.bleed);
    el.drawContent(ctx);
    ctx.restore();
  },
});
// #endregion effect-focus

// #region effect-caret
// For editors. The browser draws the caret; this adds a streak from where the
// caret was to where it is, for a quarter of a second, and a soft light around
// it. Ranges from the `highlight` attribute get a moving wavy underline, and a
// selection gets plain boxes.
defineSelectionEffect('caret', {
  color: '#ff3d7f',
  animated: true,
  draw(ctx, s, el) {
    const marked = new Set(s.marked.map((r) => `${r.x.toFixed(1)},${r.y.toFixed(1)}`));
    ctx.fillStyle = s.color.alpha(0.3);
    for (const r of s.rects) {
      if (marked.has(`${r.x.toFixed(1)},${r.y.toFixed(1)}`)) continue;
      round(ctx, r, 1, 3);
      ctx.fill();
    }
    el.drawContent(ctx);
    ctx.strokeStyle = s.color.css;
    ctx.lineWidth = 1.6;
    for (const r of s.marked) {
      const y = r.y + r.h - 1.5;
      ctx.beginPath();
      for (let x = 0; x <= r.w; x += 1.5) ctx.lineTo(r.x + x, y + Math.sin((r.x + x) * 0.9 - s.time * 9) * 1.6);
      ctx.stroke();
    }
    const c = s.caret;
    if (!c) return;
    const from = s.caretFrom;
    const k = 1 - ease(s.caretAge / 0.25);
    if (from && k > 0) {
      // A quad from the old caret to the new one, solid at the new end.
      const g = ctx.createLinearGradient(from.x, from.y, c.x, c.y + (c.y === from.y ? 0 : c.h));
      g.addColorStop(0, s.color.alpha(0));
      g.addColorStop(1, s.color.alpha(0.75 * k));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y + from.h * 0.35);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(c.x, c.y + c.h);
      ctx.lineTo(from.x, from.y + from.h * 0.65);
      ctx.closePath();
      ctx.fill();
    }
    const pulse = 0.55 + 0.45 * Math.sin(s.time * 4);
    const light = ctx.createRadialGradient(c.x, c.y + c.h / 2, 0, c.x, c.y + c.h / 2, c.h * 1.1);
    light.addColorStop(0, s.color.alpha(0.35 * pulse + 0.4 * k));
    light.addColorStop(1, s.color.alpha(0));
    ctx.fillStyle = light;
    ctx.fillRect(c.x - c.h * 1.2, c.y - c.h * 0.7, c.h * 2.4, c.h * 2.4);
  },
});
// #endregion effect-caret

// ------------------------------------------------------------ shader effects

// #region effect-key-glow
// No rectangles at all: every pixel close to --selection-fx-color glows. Give
// the caret (caret-color) and a ::highlight() that colour and the shader finds
// them in the element's picture by itself.
defineSelectionEffect('key-glow', {
  color: '#ff3d7f',
  animated: true,
  glsl: `
float key(vec2 p) {
  vec4 c = tex(p);
  if (c.a < 0.05) return 0.0;
  return c.a * (1.0 - smoothstep(0.12, 0.32, distance(c.rgb / c.a, u_color.rgb)));
}
vec4 fx(vec2 p) {
  vec4 c = tex(p);
  float halo = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 d = vec2(cos(a), sin(a));
    halo += key(p + d * 3.0) + 0.7 * key(p + d * 7.0) + 0.4 * key(p + d * 12.0);
  }
  float h = clamp(halo / 12.0 * (0.7 + 0.3 * sin(u_time * 4.0)) * u_amount, 0.0, 1.0) * (1.0 - key(p));
  return c * (1.0 - h * 0.5) + vec4(u_color.rgb * h, h) * 0.8;
}`,
  wgsl: `
fn key(p: vec2f) -> f32 {
  let c = tex(p);
  if (c.a < 0.05) { return 0.0; }
  return c.a * (1.0 - smoothstep(0.12, 0.32, distance(c.rgb / c.a, u.color.rgb)));
}
fn fx(p: vec2f) -> vec4f {
  let c = tex(p);
  var halo = 0.0;
  for (var i = 0; i < 12; i++) {
    let a = f32(i) * 0.5236;
    let d = vec2f(cos(a), sin(a));
    halo += key(p + d * 3.0) + 0.7 * key(p + d * 7.0) + 0.4 * key(p + d * 12.0);
  }
  let h = clamp(halo / 12.0 * (0.7 + 0.3 * sin(u.time * 4.0)) * u.amount, 0.0, 1.0) * (1.0 - key(p));
  return c * (1.0 - h * 0.5) + vec4f(u.color.rgb * h, h) * 0.8;
}`,
});
// #endregion effect-key-glow

// #region effect-glow
// Selected glyphs take the effect colour and light the area around them.
defineSelectionEffect('glow', {
  color: '#ff9d00',
  animated: true,
  glsl: `
vec4 fx(vec2 p) {
  vec4 c = tex(p);
  vec3 m = sel(p);
  float k = min(1.0, u_since * 4.0);
  // Glyph coverage around p, on two rings. Only counted near the selection (m.b is the blurred mask).
  float halo = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 d = vec2(cos(a), sin(a));
    halo += ink(p + d * 2.5) + 0.6 * ink(p + d * 6.0);
  }
  halo = halo / 19.2 * smoothstep(0.15, 0.6, m.b);
  float pulse = 0.8 + 0.2 * sin(u_time * 3.0);
  float on = ink(p) * m.r * k;
  float dark = step(dot(u_bg.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.4);
  vec3 lit = mix(u_color.rgb * 0.85, mix(u_color.rgb, vec3(1.0), 0.6), dark);
  vec4 o = c;
  o.rgb = mix(o.rgb, lit * c.a, on);
  float h = clamp(halo * pulse * k * u_amount * 1.6, 0.0, 1.0) * (1.0 - on);
  return o * (1.0 - h * 0.6) + vec4(u_color.rgb * h, h) * 0.6 + vec4(u_color.rgb, 1.0) * h * 0.25 * dark;
}`,
  wgsl: `
fn fx(p: vec2f) -> vec4f {
  let c = tex(p);
  let m = sel(p);
  let k = min(1.0, u.since * 4.0);
  var halo = 0.0;
  for (var i = 0; i < 12; i++) {
    let a = f32(i) * 0.5236;
    let d = vec2f(cos(a), sin(a));
    halo += ink(p + d * 2.5) + 0.6 * ink(p + d * 6.0);
  }
  halo = halo / 19.2 * smoothstep(0.15, 0.6, m.b);
  let pulse = 0.8 + 0.2 * sin(u.time * 3.0);
  let on = ink(p) * m.r * k;
  let dark = step(dot(u.bg.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.4);
  let lit = mix(u.color.rgb * 0.85, mix(u.color.rgb, vec3f(1.0), 0.6), dark);
  var o = c;
  o = vec4f(mix(o.rgb, lit * c.a, on), o.a);
  let h = clamp(halo * pulse * k * u.amount * 1.6, 0.0, 1.0) * (1.0 - on);
  return o * (1.0 - h * 0.6) + vec4f(u.color.rgb * h, h) * 0.6 + vec4f(u.color.rgb, 1.0) * h * 0.25 * dark;
}`,
});
// #endregion effect-glow

// #region effect-burn
// Flames rise from the selected glyphs. Text that was selected a moment ago stays red while it cools.
defineSelectionEffect('burn', {
  color: '#ff5a00',
  animated: true,
  glsl: `
vec4 fx(vec2 p) {
  vec4 c = tex(p);
  vec3 m = sel(p);
  float k = min(1.0, u_since * 2.5);
  // Look below p for selected glyphs: a flame at p comes from ink under it.
  float f = 0.0;
  for (int i = 1; i <= 8; i++) {
    float h = float(i) * 3.0;
    float sway = (noise(vec2(p.x * 0.11, p.y * 0.07 + u_time * 2.4 + float(i) * 0.37)) - 0.5) * h * 1.1;
    vec2 q = p + vec2(sway, h);
    f += ink(q) * sel(q).r * (1.0 - float(i) / 9.0);
  }
  f = f / 3.0 * (0.25 + 1.5 * fbm(vec2(p.x * 0.16, p.y * 0.12 + u_time * 3.2)));
  f = clamp(f * k * u_amount, 0.0, 1.0);
  vec3 fire = mix(vec3(0.9, 0.15, 0.0), vec3(1.0, 0.75, 0.1), smoothstep(0.2, 0.7, f));
  fire = mix(fire, vec3(1.0, 0.97, 0.8), smoothstep(0.75, 1.0, f));
  float on = ink(p) * m.r * k;
  vec3 ember = mix(vec3(0.3, 0.04, 0.0), vec3(1.0, 0.45, 0.05), noise(p * 0.35 + u_time * 1.5));
  vec4 o = c;
  o.rgb = mix(o.rgb, ember * c.a, on);
  o.rgb = mix(o.rgb, u_color.rgb * c.a, ink(p) * m.g * (1.0 - m.r) * 0.9);
  float a = smoothstep(0.12, 0.55, f) * (1.0 - on * 0.9) * mix(0.95, 0.5, m.r); // weaker inside the line box, so the text can be read
  return vec4(fire, 1.0) * a + o * (1.0 - a);
}`,
  wgsl: `
fn fx(p: vec2f) -> vec4f {
  let c = tex(p);
  let m = sel(p);
  let k = min(1.0, u.since * 2.5);
  var f = 0.0;
  for (var i = 1; i <= 8; i++) {
    let h = f32(i) * 3.0;
    let sway = (noise(vec2f(p.x * 0.11, p.y * 0.07 + u.time * 2.4 + f32(i) * 0.37)) - 0.5) * h * 1.1;
    let q = p + vec2f(sway, h);
    f += ink(q) * sel(q).r * (1.0 - f32(i) / 9.0);
  }
  f = f / 3.0 * (0.25 + 1.5 * fbm(vec2f(p.x * 0.16, p.y * 0.12 + u.time * 3.2)));
  f = clamp(f * k * u.amount, 0.0, 1.0);
  var fire = mix(vec3f(0.9, 0.15, 0.0), vec3f(1.0, 0.75, 0.1), smoothstep(0.2, 0.7, f));
  fire = mix(fire, vec3f(1.0, 0.97, 0.8), smoothstep(0.75, 1.0, f));
  let on = ink(p) * m.r * k;
  let ember = mix(vec3f(0.3, 0.04, 0.0), vec3f(1.0, 0.45, 0.05), noise(p * 0.35 + u.time * 1.5));
  var rgb = mix(c.rgb, ember * c.a, on);
  rgb = mix(rgb, u.color.rgb * c.a, ink(p) * m.g * (1.0 - m.r) * 0.9);
  let a = smoothstep(0.12, 0.55, f) * (1.0 - on * 0.9) * mix(0.95, 0.5, m.r);
  return vec4f(fire, 1.0) * a + vec4f(rgb, c.a) * (1.0 - a);
}`,
});
// #endregion effect-burn

// #region effect-wave
// The selected text moves on a sine wave and cycles through colours. The
// blurred mask (sel().b) sets the height, so the wave joins the still text
// at both ends without a step.
defineSelectionEffect('wave', {
  color: '#00b3a4',
  animated: true,
  glsl: `
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
vec4 fx(vec2 p) {
  float k = min(1.0, u_since * 3.0);
  float s = smoothstep(0.1, 0.7, sel(p).b) * k;
  vec2 q = p + vec2(0.0, sin(p.x * 0.07 - u_time * 5.0) * 4.0 * s * u_amount);
  vec4 c = tex(q);
  float on = ink(q) * s;
  vec3 tint = mix(u_color.rgb, hue(p.x * 0.004 + u_time * 0.25), 0.6);
  return vec4(mix(c.rgb, tint * c.a, on), c.a);
}`,
  wgsl: `
fn hue(h: f32) -> vec3f { return clamp(abs(fract(h + vec3f(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0)); }
fn fx(p: vec2f) -> vec4f {
  let k = min(1.0, u.since * 3.0);
  let s = smoothstep(0.1, 0.7, sel(p).b) * k;
  let q = p + vec2f(0.0, sin(p.x * 0.07 - u.time * 5.0) * 4.0 * s * u.amount);
  let c = tex(q);
  let on = ink(q) * s;
  let tint = mix(u.color.rgb, hue(p.x * 0.004 + u.time * 0.25), 0.6);
  return vec4f(mix(c.rgb, tint * c.a, on), c.a);
}`,
});
// #endregion effect-wave

if (!customElements.get('selection-fx')) customElements.define('selection-fx', SelectionFx);
