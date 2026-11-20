// slot-share.js: share named slots of a <canvas-slot> with other documents
// (other tabs, popups, cross-origin iframes) over MessagePorts.
//
// Why pixels? An ElementImage can only be drawn into the canvas it was
// captured from (or that canvas's transferred OffscreenCanvas), so a snapshot
// can't be redrawn in another document's canvas. What *can* travel is an
// ImageBitmap cut from the source canvas after drawElementImage(), which is
// readable because HTML-in-canvas uses "read-back-allowed" rendering.
// Interactivity comes back the other way: the viewer sends pointer and key
// events over the same port and the publisher replays them on the real DOM.
//
// Protocol (all over one MessagePort):
//   viewer -> publisher  {type:'subscribe', names:[…]}
//   publisher -> viewer  {type:'frame', name, bitmap, width, height}   (bitmap transferred)
//   viewer -> publisher  {type:'pointer', name, kind, x, y}            (CSS px, element-local)
//   viewer -> publisher  {type:'key', name, key}

/** Publish the slots of a <canvas-slot>. Call add(port) for each viewer. */
export function publish(canvasSlot) {
  const viewers = new Map(); // port -> Set(names)
  let force = true;

  async function sendFrames({ elements, changed, dpr }) {
    if (!viewers.size) return;
    const canvas = canvasSlot.canvas;
    const cr = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, cr.width);
    for (const [port, names] of viewers) {
      for (const name of names) {
        const el = elements.get(name);
        if (!el) continue;
        if (!force && changed.size && !changed.has(el)) continue;
        // drawElementImage() moved the element's geometry to where it was drawn,
        // so its client rect tells us which part of the canvas holds it.
        const r = el.getBoundingClientRect();
        const sx = Math.round((r.x - cr.x) * scaleX);
        const sy = Math.round((r.y - cr.y) * scaleX);
        const sw = Math.max(1, Math.round(r.width * scaleX));
        const sh = Math.max(1, Math.round(r.height * scaleX));
        try {
          const bitmap = await createImageBitmap(canvas, sx, sy, sw, sh);
          port.postMessage({ type: 'frame', name, bitmap, width: r.width, height: r.height }, [bitmap]);
        } catch (err) {
          port.postMessage({ type: 'error', name, message: String(err) });
        }
      }
    }
    force = false;
  }

  canvasSlot.addEventListener('render', (e) => sendFrames(e.detail));

  function onMessage(port, msg) {
    if (msg.type === 'subscribe') {
      viewers.set(port, new Set([...(viewers.get(port) ?? []), ...msg.names]));
      force = true;
      canvasSlot.requestPaint();
    } else if (msg.type === 'pointer' || msg.type === 'key') {
      const el = canvasSlot.elements.get(msg.name);
      if (el) replay(el, msg);
      // Input changes the DOM, which fires paint, which sends a new frame.
    } else if (msg.type === 'bye') {
      viewers.delete(port);
    }
  }

  return {
    add(port) {
      port.onmessage = (e) => onMessage(port, e.data);
      port.start?.();
      return port;
    },
    get viewerCount() {
      return viewers.size;
    },
  };
}

// Replay a remote input event on the real element.
function replay(el, msg) {
  const r = el.getBoundingClientRect();
  if (msg.type === 'pointer') {
    const cx = r.x + msg.x;
    const cy = r.y + msg.y;
    const target = document.elementFromPoint(cx, cy);
    if (!target || !el.contains(target)) return;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, view: window };
    if (msg.kind === 'click') {
      target.dispatchEvent(new PointerEvent('pointerdown', init));
      target.dispatchEvent(new MouseEvent('mousedown', init));
      const focusable = target.closest('input, textarea, button, select, a[href], [tabindex]');
      focusable?.focus({ preventScroll: true });
      target.dispatchEvent(new PointerEvent('pointerup', init));
      target.dispatchEvent(new MouseEvent('mouseup', init));
      if (target.matches('input[type=checkbox], input[type=radio]') || !target.matches('input, textarea')) {
        target.click();
      }
    } else if (msg.kind === 'move') {
      target.dispatchEvent(new PointerEvent('pointermove', init));
    }
    return;
  }
  // Keys go to whatever is focused inside the element.
  const active = document.activeElement;
  if (!active || !el.contains(active)) return;
  const k = msg.key;
  active.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  if (active.matches('input, textarea')) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    if (k.length === 1) {
      active.setRangeText(k, start, end, 'end');
    } else if (k === 'Backspace') {
      active.setRangeText('', Math.max(0, start - (start === end ? 1 : 0)), end, 'end');
    } else if (k === 'Enter') {
      active.form?.requestSubmit();
      return;
    } else {
      return;
    }
    active.dispatchEvent(new InputEvent('input', { bubbles: true, data: k.length === 1 ? k : null }));
  } else if (k === 'Enter' || k === ' ') {
    active.click();
  }
}

/** <slot-mirror name="…">: shows a remote slot and sends input back. */
export class SlotMirror extends HTMLElement {
  #canvas;
  #ctx;
  #port = null;
  #size = { width: 0, height: 0 };
  #frames = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
        :host { display: inline-block; position: relative; outline: none; }
        :host(:focus-visible) canvas { outline: 2px solid Highlight; outline-offset: 2px; }
        canvas { display: block; cursor: pointer; }
        .empty { font: 13px system-ui; color: GrayText; padding: 8px; }
      </style><div class="empty">waiting for frames…</div><canvas hidden></canvas>`;
    this.#canvas = root.querySelector('canvas');
    this.#ctx = this.#canvas.getContext('2d');
    this.tabIndex = 0;
    this.setAttribute('role', 'img');
    this.#canvas.addEventListener('click', (e) => this.#sendPointer('click', e));
    this.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || ['Backspace', 'Enter'].includes(e.key)) {
        e.preventDefault();
        this.#port?.postMessage({ type: 'key', name: this.name, key: e.key });
      }
    });
  }

  get name() {
    return this.getAttribute('name');
  }
  get frames() {
    return this.#frames;
  }

  /** Attach to a port that leads to a publisher. */
  attach(port) {
    this.#port = port;
    port.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type !== 'frame' || m.name !== this.name) return;
      this.#draw(m);
    });
    port.start?.();
    port.postMessage({ type: 'subscribe', names: [this.name] });
  }

  #draw({ bitmap, width, height }) {
    const dpr = devicePixelRatio;
    if (width !== this.#size.width || height !== this.#size.height) {
      this.#size = { width, height };
      this.#canvas.style.width = width + 'px';
      this.#canvas.style.height = height + 'px';
    }
    if (this.#canvas.width !== bitmap.width) this.#canvas.width = bitmap.width;
    if (this.#canvas.height !== bitmap.height) this.#canvas.height = bitmap.height;
    this.#ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    this.#ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    this.#canvas.hidden = false;
    this.shadowRoot.querySelector('.empty').hidden = true;
    this.#frames++;
    this.dispatchEvent(new CustomEvent('frame'));
  }

  #sendPointer(kind, e) {
    const r = this.#canvas.getBoundingClientRect();
    this.focus();
    this.#port?.postMessage({ type: 'pointer', name: this.name, kind, x: e.clientX - r.x, y: e.clientY - r.y });
  }
}
if (!customElements.get('slot-mirror')) customElements.define('slot-mirror', SlotMirror);

/**
 * Same-origin tabs that don't know about each other can't postMessage
 * directly. A SharedWorker brokers the introduction: it creates a
 * MessageChannel per viewer and hands one end to the publisher and the other
 * to the viewer. After that the tabs talk port-to-port.
 */
export function connectBroker({ role, channel, onPort }) {
  if (typeof SharedWorker === 'undefined') throw new Error('SharedWorker is not available in this browser');
  const sw = new SharedWorker(new URL('./broker.js', import.meta.url), { name: 'slot-share-broker' });
  sw.port.onmessage = (e) => {
    if (e.data.type === 'port') onPort(e.ports[0], e.data);
  };
  sw.port.start();
  sw.port.postMessage({ type: role, channel });
  return sw;
}
