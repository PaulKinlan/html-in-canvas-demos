// live-surface.js: make any element a "live surface" that can be shown
// somewhere else (another window, tab, origin or device) and driven from there.
//
//   <live-region name="cart"> …ordinary DOM… </live-region>
//   const surface = document.querySelector('live-region').surface;
//
//   // or, for an element that is already on the page:
//   const surface = attachSurface(document.querySelector('#billing'));
//
// How it works: the element gets a shadow root holding
//   <canvas content="drawable"><div drawable><slot></slot></div></canvas>
// so its children stay exactly where they are in the document (light DOM,
// same selectors, same listeners, same accessibility tree) but are painted
// through an HTML-in-canvas canvas. That gives us their pixels on every
// `paint` event, with nothing to ask the user: no getDisplayMedia prompt,
// and only this element, never the rest of the screen.
//
// Each paint the surface draws the content 1:1, copies the result to a
// "mirror" canvas (blacking out anything marked private), and only then runs
// your optional local effect. The mirror is what leaves the page, as
// ImageBitmaps over a MessagePort, as a MediaStream, or as JPEG blobs.
//
// Input comes back as small JSON messages and is replayed on the real DOM.
// See serve() below for the protocol and live-view.js for the other end.

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

const PRIVATE = '[data-private], input[type=password]';
const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"])';
const TEXTUAL = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', '']);

// #region shadow
const SHADOW = `<style>
  :host { display: block; }
  canvas { display: block; width: 100%; height: 0; }
  /* Canvas children are shrink-to-fit by default; fill the canvas like a block would. */
  #box { display: flow-root; width: 100%; box-sizing: border-box; }
</style><canvas part="canvas" content="drawable" layoutsubtree><div id="box" part="box" drawable><slot></slot></div></canvas>`;
// #endregion shadow

// Layout properties copied from a host onto the inner box when an existing
// element is converted, so a grid or flex container keeps laying out its
// children the same way.
const LAYOUT_PROPS = ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows', 'justify-items', 'place-content'];

let nextElementId = 1;
const elementIds = new WeakMap();
const idOf = (el) => {
  if (!elementIds.has(el)) elementIds.set(el, 'e' + nextElementId++);
  return elementIds.get(el);
};

export class LiveSurface extends EventTarget {
  host;
  canvas;
  box;
  mirror = document.createElement('canvas');
  /** Optional local effect: ({ ctx, el, width, height, dpr, time, draw }) => void. Runs after the clean copy is taken. */
  render = null;
  /** Return false to refuse a remote input message. */
  acceptInput = () => true;
  /** Cap on the mirror's width in device pixels (keeps streams small). */
  maxMirrorWidth = 1600;
  /** Shared frames have a solid background (video and JPEG have no alpha). Set false to keep transparency for bitmap viewers. */
  opaque = true;
  /** Minimum backing-store scale of the canvas, whatever the screen's devicePixelRatio. */
  minScale = 2;

  #ctx;
  #mctx;
  #ro;
  #dpr = devicePixelRatio;
  #raf = 0;
  #frames = 0;
  #cursors = new Map();
  #highlights = [];
  #pressed = null;
  #consumers = 0;
  #onShow = null;
  #blankAt = 0;
  #blankRuns = 0;
  #probe = null;
  /** True while the browser has dropped this canvas's pixels. */
  lost = false;
  /** True when the last few pictures were one flat colour although the element has content. */
  blank = false;

  constructor(host, root) {
    super();
    this.host = host;
    this.canvas = root.querySelector('canvas');
    this.box = root.querySelector('#box');
    this.#ctx = this.canvas.getContext('2d');
    this.#mctx = this.mirror.getContext('2d');
    this.#ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this.box) {
          this.canvas.style.height = entry.borderBoxSize[0].blockSize + 'px';
        } else {
          const px = entry.devicePixelContentBoxSize?.[0];
          let w = px ? px.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio);
          let h = px ? px.blockSize : Math.round(entry.contentRect.height * devicePixelRatio);
          if (!w || !h) continue;
          // On 1x screens, paint at 2x anyway so text survives video encoding
          // and being enlarged on a phone.
          const scale = Math.max(w / entry.contentRect.width, this.minScale);
          if (scale > w / entry.contentRect.width) {
            w = Math.round(entry.contentRect.width * scale);
            h = Math.round(entry.contentRect.height * scale);
          }
          this.#dpr = w / entry.contentRect.width;
          // Assigning either side clears the canvas, even to the same value.
          if (this.canvas.width !== w) this.canvas.width = w;
          if (this.canvas.height !== h) this.canvas.height = h;
        }
      }
      this.requestPaint();
    });
    this.#ro.observe(this.box);
    try {
      this.#ro.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.#ro.observe(this.canvas);
    }
    this.canvas.addEventListener('paint', () => this.#paint());
    // A phone can throw a canvas's pixels away (memory pressure, a long time
    // in the background). Nothing repaints it by itself, so say so and ask.
    this.canvas.addEventListener('contextlost', () => {
      this.lost = true;
      this.dispatchEvent(new CustomEvent('trouble', { detail: 'lost' }));
    });
    this.canvas.addEventListener('contextrestored', () => {
      this.lost = false;
      this.requestPaint();
      this.dispatchEvent(new CustomEvent('trouble', { detail: null }));
    });
    this.#onShow = () => document.visibilityState === 'visible' && this.requestPaint();
    document.addEventListener('visibilitychange', this.#onShow);
    addEventListener('pageshow', this.#onShow);
    this.requestPaint();
  }

  get width() {
    return this.box.offsetWidth;
  }
  get height() {
    return this.box.offsetHeight;
  }
  get dpr() {
    return this.#dpr;
  }
  get frames() {
    return this.#frames;
  }

  requestPaint() {
    this.canvas.requestPaint?.();
  }

  /** Repaint every frame (for animated local effects, cursors and highlights). */
  set animate(on) {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (!on) return;
    const tick = () => {
      this.requestPaint();
      this.#raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // #region paint
  #paint() {
    const ctx = this.#ctx;
    const dpr = this.#dpr;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    if (!this.canvas.width || !this.canvas.height) return;
    ctx.reset();
    ctx.scale(dpr, dpr);
    try {
      // Explicit size: the default is the snapshot's own pixel size, which is
      // wrong once the canvas is denser than the screen.
      ctx.drawElementImage(this.box, 0, 0, this.width, this.height);
    } catch {
      // No paint record yet. Nothing guarantees another paint event, so ask.
      setTimeout(() => this.requestPaint(), 50);
      return;
    }
    this.#copyToMirror();
    const time = performance.now();
    if (this.render) {
      ctx.reset();
      ctx.scale(dpr, dpr);
      const draw = (x = 0, y = 0, w = this.width, h = this.height) => ctx.drawElementImage(this.box, x, y, w, h);
      this.render({ ctx, el: this.box, width, height, dpr, time, draw });
    }
    this.#drawOverlays(ctx, time);
    this.#frames++;
    this.#watchBlank(time);
    this.dispatchEvent(new CustomEvent('frame', { detail: { width: this.width, height: this.height } }));
  }
  // #endregion paint

  /** Is the shareable copy one flat colour (64 samples)? */
  isBlank() {
    const probe = (this.#probe ??= Object.assign(document.createElement('canvas'), { width: 8, height: 8 }).getContext('2d', { willReadFrequently: true }));
    try {
      probe.clearRect(0, 0, 8, 8);
      probe.drawImage(this.mirror, 0, 0, 8, 8);
      const d = probe.getImageData(0, 0, 8, 8).data;
      for (let i = 4; i < d.length; i += 4) {
        if (Math.abs(d[i] - d[0]) > 6 || Math.abs(d[i + 1] - d[1]) > 6 || Math.abs(d[i + 2] - d[2]) > 6 || Math.abs(d[i + 3] - d[3]) > 6) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // At most once a second while consumers are watching: if the picture is
  // flat although the element has text or controls in it, the paint was
  // lost. Ask again, and after three in a row tell the viewers.
  #watchBlank(time) {
    if (!this.#consumers || time - this.#blankAt < 1000) return;
    this.#blankAt = time;
    const flat = this.isBlank() && (this.host.textContent.trim().length > 0 || !!this.host.querySelector('img, svg, canvas, video, input, button'));
    this.#blankRuns = flat ? this.#blankRuns + 1 : 0;
    const blank = this.#blankRuns >= 3;
    if (flat) setTimeout(() => this.requestPaint(), 300);
    if (blank !== this.blank) {
      this.blank = blank;
      this.dispatchEvent(new CustomEvent('trouble', { detail: blank ? 'blank' : null }));
    }
  }

  // #region mirror
  // The clean, shareable copy. drawImage(canvas) is synchronous, so the copy
  // is taken between the 1:1 draw and the local effect.
  #copyToMirror() {
    const scale = Math.min(1, this.maxMirrorWidth / this.canvas.width);
    const w = Math.max(1, Math.round(this.canvas.width * scale));
    const h = Math.max(1, Math.round(this.canvas.height * scale));
    if (this.mirror.width !== w || this.mirror.height !== h) {
      this.mirror.width = w;
      this.mirror.height = h;
    }
    const m = this.#mctx;
    m.reset();
    if (this.opaque) {
      // Use the nearest real background colour behind the element.
      m.fillStyle = backgroundOf(this.host);
      m.fillRect(0, 0, w, h);
    }
    m.drawImage(this.canvas, 0, 0, w, h);
    const base = this.box.getBoundingClientRect();
    const k = (this.#dpr * scale * this.width) / Math.max(1, base.width);
    m.fillStyle = '#111';
    for (const el of this.host.querySelectorAll(PRIVATE)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      m.beginPath();
      m.roundRect((r.x - base.x) * k, (r.y - base.y) * k, r.width * k, r.height * k, 4 * k);
      m.fill();
    }
  }
  // #endregion mirror

  #drawOverlays(ctx, time) {
    this.#highlights = this.#highlights.filter((h) => h.until > time);
    for (const h of this.#highlights) {
      const r = h.rect();
      if (!r) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time / 180);
      ctx.save();
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 2 + pulse * 2;
      ctx.shadowColor = h.color;
      ctx.shadowBlur = 6 + pulse * 10;
      ctx.beginPath();
      ctx.roundRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 8);
      ctx.stroke();
      ctx.restore();
    }
    for (const c of this.#cursors.values()) {
      const x = c.x * this.width;
      const y = c.y * this.height;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = c.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 17);
      ctx.lineTo(4.5, 13);
      ctx.lineTo(8, 20);
      ctx.lineTo(10.5, 19);
      ctx.lineTo(7.2, 12.2);
      ctx.lineTo(13, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (c.label) {
        ctx.font = '600 11px system-ui';
        const w = ctx.measureText(c.label).width + 10;
        ctx.beginPath();
        ctx.roundRect(12, 18, w, 18, 9);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(c.label, 17, 31);
      }
      ctx.restore();
    }
    // Keep animating while something is pulsing.
    if (this.#highlights.length && !this.#raf) requestAnimationFrame(() => this.requestPaint());
  }

  /** Show (or with null, remove) a remote pointer. It is painted on the canvas, never added to the DOM, and never shared back. */
  setCursor(id, cursor) {
    if (cursor) this.#cursors.set(id, { color: '#d2491f', ...cursor });
    else this.#cursors.delete(id);
    this.requestPaint();
  }

  /** Pulse a ring round an element (by describe() id) or a normalised rect for a few seconds. */
  highlight(target, { color = '#d2491f', ms = 4000 } = {}) {
    const rect = () => {
      const base = this.box.getBoundingClientRect();
      if (typeof target === 'string') {
        const el = this.#find(target);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x - base.x, y: r.y - base.y, w: r.width, h: r.height };
      }
      return { x: target.x * this.width, y: target.y * this.height, w: target.w * this.width, h: target.h * this.height };
    };
    this.#highlights.push({ rect, color, until: performance.now() + ms });
    this.requestPaint();
  }

  // #region out
  /** An ImageBitmap of the shareable copy. */
  bitmap() {
    return createImageBitmap(this.mirror);
  }
  // #endregion out

  // #region out
  /** A MediaStream of the shareable copy (for <video>, Picture-in-Picture, WebRTC, recording). */
  stream(fps = 30) {
    return this.mirror.captureStream(fps);
  }
  // #endregion out

  /** A JPEG/WebP/PNG blob of the shareable copy. */
  blob(type = 'image/jpeg', quality = 0.7) {
    return new Promise((resolve) => this.mirror.toBlob(resolve, type, quality));
  }

  /** A data URL of the shareable copy, scaled down to at most maxWidth pixels wide. */
  dataURL(type = 'image/jpeg', quality = 0.8, maxWidth = Infinity) {
    const m = this.mirror;
    if (m.width <= maxWidth) return m.toDataURL(type, quality);
    const c = document.createElement('canvas');
    c.width = maxWidth;
    c.height = Math.round((m.height * maxWidth) / m.width);
    c.getContext('2d').drawImage(m, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  }

  /** Ids of the remote pointers currently drawn on the canvas. */
  get cursors() {
    return [...this.#cursors.keys()];
  }

  /**
   * What is in the region, read from the real DOM: the part pixels can't
   * carry. Rects are normalised to the region. Private values are withheld.
   */
  describe() {
    const base = this.box.getBoundingClientRect();
    const items = [];
    for (const el of this.host.querySelectorAll(INTERACTIVE)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.disabled) continue;
      const secret = el.matches(PRIVATE) || !!el.closest('[data-private]');
      const item = {
        id: idOf(el),
        role: roleOf(el),
        name: secret ? nameOf(el, true) : nameOf(el),
        rect: { x: (r.x - base.x) / base.width, y: (r.y - base.y) / base.height, w: r.width / base.width, h: r.height / base.height },
      };
      if ('value' in el && !['button', 'summary'].includes(item.role)) {
        item.value = secret ? '[redacted]' : el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : String(el.value ?? '');
      }
      if (isEditable(el)) item.editable = true;
      items.push(item);
    }
    return items;
  }

  #find(id) {
    for (const el of this.host.querySelectorAll('*')) if (elementIds.get(el) === id) return el;
    return null;
  }

  /** Deepest element of the region under a region-local point. Uses the geometry drawElementImage() set, and ignores whatever is on top of the canvas. */
  elementAt(x, y) {
    const base = this.box.getBoundingClientRect();
    const px = base.x + x;
    const py = base.y + y;
    let hit = null;
    for (const el of this.host.querySelectorAll('*')) {
      if (el.tagName === 'OPTION' || el.tagName === 'OPTGROUP') continue;
      const r = el.getBoundingClientRect();
      if (px >= r.left && px < r.right && py >= r.top && py < r.bottom && r.width && r.height) {
        if (getComputedStyle(el).pointerEvents === 'none') continue;
        hit = el;
      }
    }
    return hit;
  }

  /**
   * Replay one remote input message on the real DOM. Returns a reply for the
   * sender (focus state, or a request to show a native picker), or null.
   *   { t:'pointer', kind:'down'|'move'|'up'|'wheel', x, y }   x, y in 0..1
   *   { t:'key', key, shift }
   *   { t:'text', data }
   *   { t:'choose', id, value }
   *   { t:'act', kind:'click'|'fill'|'focus', id, value }      by describe() id
   */
  // #region input
  input(msg, from) {
    if (!this.acceptInput(msg, from)) return { t: 'refused', what: msg.t };
    this.dispatchEvent(new CustomEvent('input', { detail: { msg, from } }));
    if (msg.t === 'pointer') return this.#pointer(msg);
    if (msg.t === 'key') return this.#key(msg);
    if (msg.t === 'text') return this.#text(msg.data);
    if (msg.t === 'choose') {
      const el = this.#find(msg.id);
      if (el?.tagName === 'SELECT') {
        el.value = msg.value;
        fire(el, 'input');
        fire(el, 'change');
      }
      return null;
    }
    if (msg.t === 'act') {
      const el = this.#find(msg.id);
      if (!el) return { t: 'refused', what: 'act' };
      if (msg.kind === 'click') return this.#activate(el);
      el.focus({ preventScroll: true });
      if (msg.kind === 'fill' && isEditable(el)) {
        if ('value' in el) {
          el.select?.();
          el.setRangeText?.(String(msg.value ?? ''), 0, el.value.length, 'end');
          fire(el, 'input');
          fire(el, 'change');
        } else {
          el.textContent = String(msg.value ?? '');
          fire(el, 'input');
        }
      }
      return this.#focusState();
    }
    return null;
  }
  // #endregion input

  #pointer({ kind, x, y, dx = 0, dy = 0 }) {
    const lx = x * this.width;
    const ly = y * this.height;
    const target = this.elementAt(lx, ly);
    const base = this.box.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, clientX: base.x + lx, clientY: base.y + ly, view: window, pointerId: 77, pointerType: 'mouse', isPrimary: true, button: 0, buttons: kind === 'up' ? 0 : this.#pressed || kind === 'down' ? 1 : 0 };
    if (kind === 'wheel') {
      let el = target;
      while (el && el !== this.host && !(el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      (el && el !== this.host ? el : null)?.scrollBy(dx, dy);
      return null;
    }
    if (kind === 'down') {
      if (!target) return null;
      this.#pressed = target;
      target.dispatchEvent(new PointerEvent('pointerdown', init));
      target.dispatchEvent(new MouseEvent('mousedown', init));
      const focusable = target.closest(INTERACTIVE);
      if (focusable && this.host.contains(focusable)) focusable.focus({ preventScroll: true });
      else if (this.host.contains(document.activeElement)) document.activeElement.blur();
      if (target.matches('input[type=range]')) setRange(target, init.clientX);
      if (isEditable(target) && 'selectionStart' in target) {
        try {
          target.setSelectionRange(target.value.length, target.value.length);
        } catch {}
      }
      return this.#focusState();
    }
    if (kind === 'move') {
      const el = this.#pressed ?? target;
      if (!el) return null;
      el.dispatchEvent(new PointerEvent('pointermove', init));
      el.dispatchEvent(new MouseEvent('mousemove', init));
      if (this.#pressed?.matches('input[type=range]')) setRange(this.#pressed, init.clientX);
      return null;
    }
    if (kind === 'up') {
      const pressed = this.#pressed;
      this.#pressed = null;
      const el = pressed ?? target;
      if (!el) return null;
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      if (pressed?.matches('input[type=range]')) {
        fire(pressed, 'change');
        return null;
      }
      // A click is a press and release on the same element.
      if (pressed && target && (pressed === target || pressed.contains(target) || target.contains(pressed))) return this.#activate(pressed, init);
    }
    return null;
  }

  #activate(el, init) {
    const select = el.closest('select');
    if (select) {
      // A native <select> popup belongs to this window. Ask the viewer to
      // show a native picker of its own instead.
      return { t: 'select', id: idOf(select), name: nameOf(select), value: select.value, options: [...select.options].map((o) => ({ value: o.value, label: o.label, disabled: o.disabled })) };
    }
    if (isEditable(el)) {
      el.focus({ preventScroll: true });
      return this.#focusState();
    }
    // click() runs default actions: buttons, checkboxes, radios, labels,
    // links, <summary>, form submission.
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', init ?? { bubbles: true, cancelable: true, composed: true }));
    return this.#focusState();
  }

  #key({ key, shift }) {
    const active = document.activeElement;
    if (!active || !this.host.contains(active)) return null;
    const down = new KeyboardEvent('keydown', { key, shiftKey: !!shift, bubbles: true, cancelable: true, composed: true });
    if (!active.dispatchEvent(down)) return this.#focusState();
    if (key === 'Tab') {
      const order = [...this.host.querySelectorAll(INTERACTIVE)].filter((el) => !el.disabled && el.getBoundingClientRect().width);
      const next = order[(order.indexOf(active) + (shift ? -1 : 1) + order.length) % order.length];
      next?.focus({ preventScroll: true });
    } else if (isEditable(active)) {
      if (key.length === 1) return this.#text(key);
      if ('selectionStart' in active && active.selectionStart != null) {
        const s = active.selectionStart;
        const e = active.selectionEnd;
        if (key === 'Backspace') edit(active, '', s === e ? Math.max(0, s - 1) : s, e);
        else if (key === 'Delete') edit(active, '', s, s === e ? Math.min(active.value.length, e + 1) : e);
        else if (key === 'ArrowLeft') active.setSelectionRange(Math.max(0, s - 1), Math.max(0, s - 1));
        else if (key === 'ArrowRight') active.setSelectionRange(e + 1, e + 1);
        else if (key === 'Home') active.setSelectionRange(0, 0);
        else if (key === 'End') active.setSelectionRange(active.value.length, active.value.length);
        else if (key === 'Enter') {
          if (active.tagName === 'TEXTAREA') edit(active, '\n', s, e);
          else active.form?.requestSubmit();
        }
      } else if ('value' in active) {
        // type=number, email…: no selection API, edit at the end.
        if (key === 'Backspace') {
          active.value = String(active.value).slice(0, -1);
          fire(active, 'input');
        } else if (key === 'Enter') active.form?.requestSubmit();
      } else if (key === 'Backspace') document.execCommand('delete');
      else if (key === 'Enter') document.execCommand('insertParagraph');
    } else if (key === 'Enter' || key === ' ') {
      active.click?.();
    } else if (active.matches('input[type=range]') && key.startsWith('Arrow')) {
      const step = Number(active.step) || 1;
      active.value = Number(active.value) + (key === 'ArrowRight' || key === 'ArrowUp' ? step : -step);
      fire(active, 'input');
      fire(active, 'change');
    }
    active.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }));
    return this.#focusState();
  }

  #text(data) {
    const active = document.activeElement;
    if (!active || !this.host.contains(active) || !isEditable(active) || !data) return null;
    if ('selectionStart' in active && active.selectionStart != null) edit(active, data, active.selectionStart, active.selectionEnd);
    else if ('value' in active) {
      active.value = String(active.value) + data;
      fire(active, 'input', data);
    } else document.execCommand('insertText', false, data);
    return null;
  }

  #focusState() {
    const active = document.activeElement;
    const inside = active && this.host.contains(active);
    return { t: 'focus', id: inside ? idOf(active) : null, editable: !!(inside && isEditable(active)), multiline: inside && active.tagName === 'TEXTAREA', inputmode: inside ? active.inputMode || (active.type === 'number' ? 'decimal' : active.type === 'email' ? 'email' : active.type === 'tel' ? 'tel' : 'text') : 'text' };
  }

  destroy() {
    this.animate = false;
    this.#ro.disconnect();
    document.removeEventListener('visibilitychange', this.#onShow);
    removeEventListener('pageshow', this.#onShow);
  }

  // Called by serve().
  _consumer(delta) {
    this.#consumers += delta;
    this.requestPaint();
    this.dispatchEvent(new CustomEvent('consumers', { detail: this.#consumers }));
  }
  /** How many viewers are currently being sent this surface. */
  get consumers() {
    return this.#consumers;
  }
}

function edit(el, text, start, end) {
  el.setRangeText(text, start, end, 'end');
  fire(el, 'input', text || null);
}
function fire(el, type, data) {
  el.dispatchEvent(type === 'input' ? new InputEvent('input', { bubbles: true, composed: true, data: data ?? null, inputType: data ? 'insertText' : 'deleteContentBackward' }) : new Event(type, { bubbles: true, composed: true }));
}
function setRange(el, clientX) {
  const r = el.getBoundingClientRect();
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const step = Number(el.step) || 1;
  const f = Math.min(1, Math.max(0, (clientX - r.left - 8) / Math.max(1, r.width - 16)));
  const v = Math.round((min + f * (max - min)) / step) * step;
  if (String(v) !== el.value) {
    el.value = v;
    fire(el, 'input');
  }
}
function isEditable(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return !el.readOnly;
  if (el.tagName === 'INPUT') return TEXTUAL.has(el.getAttribute('type') ?? '') && !el.readOnly;
  return el.isContentEditable;
}
function roleOf(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') return { checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button' }[el.type] ?? 'textbox';
  return tag;
}
function nameOf(el, secret = false) {
  const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || (secret || 'value' in el && el.tagName !== 'BUTTON' ? '' : el.textContent) || el.getAttribute('name') || '';
  return label.replace(/\s+/g, ' ').trim().slice(0, 80);
}
function backgroundOf(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement ?? node.getRootNode().host) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/.test(bg)) return bg;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? '#161514' : '#ffffff';
}

/**
 * Convert an element that is already on the page into a live surface,
 * without moving it or its children. Throws if the element can't take a
 * shadow root (wrap it in <live-region> instead).
 */
export function attachSurface(host) {
  if (host.surface) return host.surface;
  if (!supported) throw new Error('HTML-in-canvas is not available');
  const cs = getComputedStyle(host);
  const layout = LAYOUT_PROPS.map((p) => [p, cs.getPropertyValue(p)]);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = SHADOW;
  const box = root.querySelector('#box');
  const display = cs.display;
  if (/flex|grid/.test(display)) {
    for (const [p, v] of layout) box.style.setProperty(p, p === 'display' ? v.replace('inline-', '') : v);
    // The host now has one child (the canvas); it should be a plain block.
    root.querySelector('style').textContent += ':host { display: block !important; }';
  }
  host.surface = new LiveSurface(host, root);
  return host.surface;
}

/** <live-region>: a block whose content can be shared. Plain DOM where the API is missing. */
export class LiveRegion extends HTMLElement {
  surface = null;
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    if (supported) {
      root.innerHTML = SHADOW;
      this.surface = new LiveSurface(this, root);
    } else {
      root.innerHTML = '<style>:host { display: block; }</style><slot></slot>';
    }
  }
}
if (!customElements.get('live-region')) customElements.define('live-region', LiveRegion);

/**
 * Serve a surface to one viewer over a link ({ send(msg, transfer), onmessage, transfers }).
 *
 *   viewer -> source  { t:'hello', frames:'bitmap'|'blob'|'none', fps }
 *   source -> viewer  { t:'meta', w, h, title, map }      size in CSS px, describe() map
 *   source -> viewer  { t:'frame', bitmap | blob }        unless frames:'none' (video track carries them)
 *   viewer -> source  pointer / key / text / choose / act (see LiveSurface.input)
 *   viewer -> source  { t:'cursor', x, y, label } | { t:'cursor', off:true }
 *   source -> viewer  { t:'focus', … } | { t:'select', … } | { t:'refused', what }
 *   source -> viewer  { t:'trouble', what:'lost'|'blank'|null }   the picture was lost / is back
 *   viewer -> source  { t:'hello' } again at any time asks for a fresh meta and frame
 *   either            { t:'bye' }
 *
 * Returns a function that stops serving.
 */
export function serve(surface, link, { title = document.title, peer = 'viewer', sendBinary = null, persistent = false } = {}) {
  let mode = null;
  let busy = false;
  let again = false;
  let last = 0;
  let minGap = 0;
  let lastMeta = '';
  let stopped = false;

  const meta = () => {
    const m = { t: 'meta', w: surface.width, h: surface.height, title, map: surface.describe() };
    const key = JSON.stringify(m);
    if (key !== lastMeta) {
      lastMeta = key;
      link.send(m);
    }
  };

  const onFrame = async () => {
    if (stopped || !mode) return;
    meta();
    if (mode === 'none') return;
    // Nothing painted yet: the mirror is still a blank default-sized canvas.
    if (!surface.frames) return;
    if (busy) {
      // A paint arrived while the last frame was being packed. Don't lose
      // it: it may be the final state.
      again = true;
      return;
    }
    const now = performance.now();
    if (now - last < minGap) {
      // Make sure the final state is sent even if it arrived inside the gap.
      clearTimeout(onFrame.timer);
      onFrame.timer = setTimeout(onFrame, minGap - (now - last) + 1);
      return;
    }
    busy = true;
    last = now;
    try {
      if (mode === 'bitmap') {
        const bitmap = await surface.bitmap();
        link.send({ t: 'frame', bitmap }, [bitmap]);
      } else {
        const blob = await surface.blob('image/jpeg', 0.6);
        if (sendBinary) sendBinary(await blob.arrayBuffer());
        else link.send({ t: 'frame', blob });
      }
    } catch (err) {
      link.send({ t: 'error', message: String(err) });
    }
    busy = false;
    if (again) {
      again = false;
      onFrame();
    }
  };

  link.onmessage = (msg) => {
    if (stopped || !msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (!mode) surface._consumer(1);
      mode = msg.frames ?? 'bitmap';
      minGap = msg.fps ? 1000 / msg.fps : mode === 'blob' ? 100 : 0;
      lastMeta = '';
      last = 0;
      surface.requestPaint();
      onFrame();
    } else if (msg.t === 'cursor') {
      surface.setCursor(peer, msg.off ? null : { x: msg.x, y: msg.y, label: msg.label, color: msg.color });
    } else if (msg.t === 'highlight') {
      surface.highlight(msg.id ?? msg.rect, { color: msg.color });
    } else if (msg.t === 'bye') {
      // A persistent server (e.g. on a BroadcastChannel) waits for the next hello.
      if (persistent) {
        if (mode) surface._consumer(-1);
        mode = null;
        surface.setCursor(peer, null);
      } else stop();
    } else {
      const reply = surface.input(msg, peer);
      if (reply) link.send(reply);
    }
  };
  surface.addEventListener('frame', onFrame);
  // { t:'trouble', what:'lost'|'blank'|null }: the viewer shows a message instead of a dead picture.
  const onTrouble = (e) => mode && link.send({ t: 'trouble', what: e.detail });
  surface.addEventListener('trouble', onTrouble);
  // `paint` only fires while this document is being rendered. Tell viewers
  // when it stops, so a frozen picture is explained.
  const onVisibility = () => mode && link.send({ t: 'visibility', state: document.visibilityState });
  document.addEventListener('visibilitychange', onVisibility);

  function stop() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    surface.removeEventListener('frame', onFrame);
    surface.removeEventListener('trouble', onTrouble);
    surface.setCursor(peer, null);
    if (mode) surface._consumer(-1);
    try {
      link.send({ t: 'bye' });
    } catch {}
  }
  return stop;
}
