// <kit-slot>: a small element that draws its children in a canvas, written
// to try six newer DOM features in a drawable custom element. Every feature
// is checked first and has the older code beside it, so the element works
// either way and the two versions can be compared line for line.
//
//   import { defineKit } from '/component-kit/kit.js';
//   defineKit();                       // the page's registry
//   defineKit(new CustomElementRegistry()); // or one of your own
//
//   <kit-slot>
//     <section>First</section>
//     <section>Second</section>
//   </kit-slot>
//
//   slot.show(slot.children[1]);       // draw another child, with a cross-fade
//
//   <label for="name">Name</label>
//   <kit-field id="name"></kit-field>  // an <input> in the shadow root, drawn by a canvas
//
// The region comments mark the old and new version of each part. The page
// /component-kit/ cuts its listings and its line counts from them.

const tryNew = (fn) => { try { return !!fn(); } catch { return false; } };

/** Which of the features this browser has. */
export const features = {
  scopedRegistry: tryNew(() => new CustomElementRegistry()),
  manualSlots: typeof ShadowRoot !== 'undefined' && 'slotAssignment' in ShadowRoot.prototype && 'assign' in HTMLSlotElement.prototype,
  referenceTarget: typeof ShadowRoot !== 'undefined' && 'referenceTarget' in ShadowRoot.prototype,
  disposable: typeof DisposableStack === 'function',
  observable: typeof EventTarget !== 'undefined' && 'when' in EventTarget.prototype,
  moveBefore: typeof Element !== 'undefined' && 'moveBefore' in Element.prototype,
};

export const supported = typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

const STYLE = `
  :host { display: block; position: relative; }
  canvas { display: block; width: 100%; height: 100%; }
  :host([plain]) canvas { display: none; }
`;
const FADE_MS = 260;

/**
 * Make the element class. `use` turns single features off, which is how the
 * page runs the old and the new code side by side in one browser.
 */
export function makeKitSlot(use = features) {
  return class KitSlot extends HTMLElement {
    static use = use;
    #root;
    #canvas;
    #ctx = null;
    #slot = null;
    #shown = null;
    #fade = null;      // { image, from } while the previous child fades out
    #held = null;      // DisposableStack, new code only
    #gone = null;      // AbortController, new code only
    #onPaint = null;   // old code only
    #onLost = null;    // old code only
    #ro = null;
    paintCount = 0;

    constructor() {
      super();
      // #region new-slots
      // Manual assignment: one unnamed <slot>, and script decides which
      // children go in it. The children need no slot attribute.
      if (use.manualSlots) {
        this.#root = this.attachShadow({ mode: 'open', slotAssignment: 'manual' });
        this.#root.innerHTML = `<style>${STYLE}</style><canvas content="drawable" layoutsubtree><slot></slot></canvas>`;
        this.#slot = this.#root.querySelector('slot');
      }
      // #endregion new-slots
      // #region old-slots
      // Named slots: the element writes slot="shown" on the child to draw
      // and removes it from the others, so it edits the page's own markup.
      // A MutationObserver has to put the attribute back when children change.
      if (!use.manualSlots) {
        this.#root = this.attachShadow({ mode: 'open' });
        this.#root.innerHTML = `<style>${STYLE}</style><canvas content="drawable" layoutsubtree><slot name="shown"></slot></canvas>`;
        this.#slot = this.#root.querySelector('slot');
        new MutationObserver(() => {
          if (!this.#shown?.isConnected || this.#shown.parentNode !== this) this.#shown = null;
          for (const child of this.children) {
            if (child === (this.#shown ?? this.firstElementChild)) child.setAttribute('slot', 'shown');
            else child.removeAttribute('slot');
          }
        }).observe(this, { childList: true });
      }
      // #endregion old-slots
      this.#canvas = this.#root.querySelector('canvas');
    }

    get canvas() { return this.#canvas; }
    /** The child being drawn. */
    get shown() { return this.#shown; }

    connectedCallback() {
      if (!supported) return this.#plain();
      this.#ctx ??= this.#canvas.getContext('2d');
      this.#ro = new ResizeObserver(([entry]) => {
        const box = entry.devicePixelContentBoxSize?.[0];
        const w = Math.max(1, box ? box.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio));
        const h = Math.max(1, box ? box.blockSize : Math.round(entry.contentRect.height * devicePixelRatio));
        if (this.#canvas.width !== w) this.#canvas.width = w;
        if (this.#canvas.height !== h) this.#canvas.height = h;
        this.#canvas.requestPaint();
      });
      try { this.#ro.observe(this.#canvas, { box: 'device-pixel-content-box' }); } catch { this.#ro.observe(this.#canvas); }

      // #region new-paint
      // Observable: the paint events are a stream. The subscription ends
      // with the AbortSignal, so there is no handler to keep and remove.
      if (use.observable) {
        this.#gone = new AbortController();
        this.#canvas.when('paint').subscribe(() => this.#draw(), { signal: this.#gone.signal });
        this.#canvas.when('contextlost').take(1).subscribe(() => this.#plain('the canvas lost its context'), { signal: this.#gone.signal });
      }
      // #endregion new-paint
      // #region old-paint
      if (!use.observable) {
        this.#onPaint = () => this.#draw();
        this.#canvas.addEventListener('paint', this.#onPaint);
        this.#onLost = () => {
          this.#canvas.removeEventListener('contextlost', this.#onLost);
          this.#plain('the canvas lost its context');
        };
        this.#canvas.addEventListener('contextlost', this.#onLost);
      }
      // #endregion old-paint
      this.show(this.#shown ?? this.firstElementChild, { fade: false });
    }

    disconnectedCallback() {
      this.#ro?.disconnect();
      // #region new-paint
      this.#gone?.abort();
      // #endregion new-paint
      // #region old-paint
      if (this.#onPaint) {
        this.#canvas.removeEventListener('paint', this.#onPaint);
        this.#canvas.removeEventListener('contextlost', this.#onLost);
      }
      // #endregion old-paint
      this.#endFade();
    }

    /**
     * The paint events of this element as an Observable of
     * { count, shown }, or null where there is no Observable API.
     */
    get paints() {
      return use.observable ? this.#canvas.when('paint').map(() => ({ count: this.paintCount, shown: this.#shown })) : null;
    }

    /** Draw `child` instead of the current one. The old picture fades out over the new one. */
    show(child, { fade = true } = {}) {
      if (!child || child.parentNode !== this) return;
      const previous = this.#shown;
      if (supported && fade && previous && previous !== child && this.#ctx) this.#startFade(previous);
      this.#shown = child;
      if (supported && !child.hasAttribute('drawable')) child.setAttribute('drawable', '');
      // #region new-slots
      if (use.manualSlots) this.#slot.assign(child);
      // #endregion new-slots
      // #region old-slots
      if (!use.manualSlots) {
        for (const c of this.children) c === child ? c.setAttribute('slot', 'shown') : c.removeAttribute('slot');
      }
      // #endregion old-slots
      if (supported) this.#canvas.requestPaint();
      this.dispatchEvent(new CustomEvent('kitshow', { detail: { child } }));
    }

    // The outgoing child is captured as an ElementImage before it leaves the
    // slot. The image must be closed when the fade ends, when another show()
    // interrupts it, and when the element leaves the page.
    #startFade(previous) {
      this.#endFade();
      let image;
      try { image = this.#canvas.captureElementImage(previous); } catch { return; }
      // #region new-dispose
      // DisposableStack: everything that needs closing is adopted once, and
      // one dispose() closes it all, in reverse order, whichever way the fade ends.
      if (use.disposable) {
        this.#held = new DisposableStack();
        this.#held.adopt(image, (i) => i.close());
        this.#held.defer(() => (this.#fade = null));
      }
      // #endregion new-dispose
      this.#fade = { image, from: performance.now(), width: previous.offsetWidth, height: previous.offsetHeight };
    }
    #endFade() {
      // #region new-dispose
      if (use.disposable) {
        this.#held?.dispose();
        this.#held = null;
        return;
      }
      // #endregion new-dispose
      // #region old-dispose
      if (this.#fade) {
        try {
          this.#fade.image.close();
        } finally {
          this.#fade = null;
        }
      }
      // #endregion old-dispose
    }

    #draw() {
      const ctx = this.#ctx, canvas = this.#canvas, el = this.#shown;
      if (!ctx || !el) return;
      this.paintCount++;
      const k = canvas.width / Math.max(1, canvas.clientWidth);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      try {
        ctx.drawElementImage(el, 0, 0, el.offsetWidth, el.offsetHeight);
        if (this.#fade) {
          const t = (performance.now() - this.#fade.from) / FADE_MS;
          if (t >= 1) this.#endFade();
          else {
            ctx.globalAlpha = 1 - t;
            ctx.drawElementImage(this.#fade.image, 0, 0, this.#fade.width, this.#fade.height);
            ctx.globalAlpha = 1;
            requestAnimationFrame(() => this.isConnected && canvas.requestPaint());
          }
        }
      } catch (err) {
        // "No cached paint record": the child has not painted yet. Ask again.
        if (/paint record/i.test(err?.message ?? '')) canvas.requestPaint();
        else { this.#endFade(); this.lastError = err; }
      }
    }

    // No HTML-in-canvas, or the canvas was lost: the children are shown as ordinary HTML.
    #plain(reason = '') {
      if (this.hasAttribute('plain')) return;
      this.setAttribute('plain', reason);
      this.#root.append(this.#slot); // out of the canvas, so its children are laid out as normal
      if (reason) this.#root.append(Object.assign(document.createElement('small'), { textContent: `Shown as plain HTML (${reason}).`, style: 'display:block;font:11px system-ui;opacity:.7' }));
    }
  };
}

/**
 * <kit-field>: a text field drawn by a canvas, with the <input> inside the
 * shadow root. A <label for> in the page has to reach it.
 */
export function makeKitField(use = features) {
  return class KitField extends HTMLElement {
    static use = use;
    #root;
    #canvas;
    #input;
    #labels = [];
    constructor() {
      super();
      this.#root = this.attachShadow({ mode: 'open' });
      this.#root.innerHTML = `<style>${STYLE} input { font: inherit; padding: 6px 10px; margin: 6px; width: calc(100% - 12px); box-sizing: border-box; }</style><canvas content="drawable" layoutsubtree><input id="control" drawable></canvas>`;
      this.#canvas = this.#root.querySelector('canvas');
      this.#input = this.#root.querySelector('input');
      // #region new-label
      // Reference Target: anything that refers to this element by id
      // (<label for>, aria-labelledby, popovertarget) is forwarded to the
      // element with this id inside the shadow root.
      if (use.referenceTarget) this.#root.referenceTarget = 'control';
      // #endregion new-label
    }
    get control() { return this.#input; }
    get canvas() { return this.#canvas; }

    connectedCallback() {
      // #region old-label
      // No Reference Target: find the labels by hand, copy their text to
      // aria-label, and pass their clicks on to the input.
      if (!use.referenceTarget && this.id) {
        const labels = this.getRootNode().querySelectorAll(`label[for="${CSS.escape(this.id)}"]`);
        const text = [...labels].map((l) => l.textContent.trim()).join(' ');
        if (text) this.#input.setAttribute('aria-label', text);
        for (const label of labels) {
          const pass = (e) => {
            e.preventDefault();
            this.#input.focus();
          };
          label.addEventListener('click', pass);
          this.#labels.push([label, pass]);
        }
      }
      // #endregion old-label
      if (!supported) {
        this.setAttribute('plain', '');
        this.#root.append(this.#input); // out of the canvas: an ordinary field
        return;
      }
      const ctx = this.#canvas.getContext('2d');
      const size = () => {
        const k = devicePixelRatio;
        this.#canvas.width = Math.max(1, Math.round(this.#canvas.clientWidth * k));
        this.#canvas.height = Math.max(1, Math.round(this.#canvas.clientHeight * k));
        this.#canvas.requestPaint();
      };
      this.#canvas.addEventListener('paint', () => {
        const k = this.#canvas.width / Math.max(1, this.#canvas.clientWidth);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.clearRect(0, 0, this.#canvas.clientWidth, this.#canvas.clientHeight);
        try { ctx.drawElementImage(this.#input, 6, 6, this.#input.offsetWidth, this.#input.offsetHeight); } catch (err) { if (/paint record/i.test(err.message)) this.#canvas.requestPaint(); }
      });
      new ResizeObserver(size).observe(this.#canvas);
    }

    disconnectedCallback() {
      // #region old-label
      for (const [label, pass] of this.#labels) label.removeEventListener('click', pass);
      this.#labels = [];
      // #endregion old-label
    }
  };
}

// #region new-registry
/**
 * Define <kit-slot> in a registry. With a scoped registry, two versions of
 * the element can be on one page: each shadow root looks its tags up in the
 * registry it was given.
 */
export function defineKit(registry = customElements, use = features, name = 'kit-slot') {
  if (!registry.get(name)) registry.define(name, makeKitSlot(use));
  if (!registry.get('kit-field')) registry.define('kit-field', makeKitField(use));
  return registry.get(name);
}
// #endregion new-registry
// #region old-registry
/**
 * One global registry: a second version needs its own tag name, and every
 * page that uses it has to write that name.
 */
export function defineKitGlobal(use = features, version = '') {
  const name = version ? `kit-slot-${version}` : 'kit-slot';
  if (customElements.get(name)) {
    console.warn(`<${name}> is already defined; this copy is not used.`);
    return customElements.get(name);
  }
  const KitSlot = makeKitSlot(use);
  customElements.define(name, KitSlot);
  customElements.define(version ? `kit-field-${version}` : 'kit-field', makeKitField(use));
  return KitSlot;
}
// #endregion old-registry

/**
 * Put `target` inside `host`, in the place where `target` is now.
 * Returns what survived the move, for the page to report.
 */
export function wrap(target, host, use = features) {
  // #region new-move
  // moveBefore() moves a connected node without removing it first: focus,
  // a loaded iframe, a playing video and CSS transitions carry on.
  if (use.moveBefore) {
    target.before(host);
    try {
      host.moveBefore(target, null);
      host.show?.(target, { fade: false });
      return host;
    } catch {
      host.remove();
    }
  }
  // #endregion new-move
  // #region old-move
  // replaceWith() + append() removes the node and inserts it again. Focus is
  // lost, so it is put back by hand; an iframe inside reloads and nothing
  // can be done about that.
  const focused = target.contains(document.activeElement) ? document.activeElement : null;
  target.replaceWith(host);
  host.append(target);
  host.show?.(target, { fade: false }); // a child that is not assigned to the slot has no box and cannot take focus
  focused?.focus({ preventScroll: true });
  // #endregion old-move
  return host;
}
