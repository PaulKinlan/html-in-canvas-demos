// live-view.js: the receiving end of a live surface (see live-surface.js).
//
//   <live-view></live-view>
//   view.connect(link)            // frames arrive as ImageBitmaps or blobs
//   view.connect(link, stream)    // …or as a MediaStream (WebRTC), link carries input
//
// Nothing here uses HTML-in-canvas, so a viewer works in any browser: only
// the page that owns the DOM needs the API. Pointer, wheel and keyboard input
// is sent back over the link; a tap on a text field raises this device's own
// keyboard, and a <select> opens this device's own native picker.

/** Wrap a MessagePort (or a Worker, or a BroadcastChannel) as a link. */
export function portLink(port) {
  const link = {
    transfers: !(typeof BroadcastChannel !== 'undefined' && port instanceof BroadcastChannel),
    onmessage: null,
    send(msg, transfer = []) {
      port.postMessage(msg, link.transfers ? transfer : undefined);
    },
    close() {
      port.close?.();
    },
  };
  port.onmessage = (e) => link.onmessage?.(e.data);
  port.start?.();
  return link;
}

/** A link through window.postMessage to one other window (popup, opener, iframe or parent). */
export function windowLink(target, targetOrigin, channel = 'live') {
  const link = {
    transfers: true,
    onmessage: null,
    send(msg, transfer = []) {
      target.postMessage({ channel, msg }, targetOrigin, transfer);
    },
    close() {
      removeEventListener('message', on);
    },
  };
  const on = (e) => {
    if (e.source !== target || e.data?.channel !== channel) return;
    if (targetOrigin !== '*' && e.origin !== targetOrigin) return;
    link.onmessage?.(e.data.msg);
  };
  addEventListener('message', on);
  return link;
}

/**
 * Two links wired straight to each other, for documents that can already
 * reach one another (an opener and its popup, a page and a Picture-in-Picture
 * window). No postMessage: objects, ImageBitmaps included, pass by reference.
 */
export function directLinkPair() {
  const make = () => ({ transfers: true, onmessage: null, peer: null, send(msg) { queueMicrotask(() => this.peer?.onmessage?.(msg)); }, close() { this.peer = null; } });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

export class LiveView extends HTMLElement {
  #link = null;
  #mode = null;
  #canvas;
  #ctx;
  #video;
  #keys;
  #meta = null;
  #frames = 0;
  #down = false;
  #lastMove = 0;
  #focus = { editable: false };

  static observedAttributes = ['readonly'];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
        :host { display: inline-block; position: relative; max-width: 100%; touch-action: manipulation; }
        :host([fit]) { display: block; }
        canvas, video { display: block; max-width: 100%; height: auto; cursor: default; user-select: none; -webkit-user-select: none; }
        :host([fit]) canvas, :host([fit]) video { width: 100%; }
        :host(:focus-within) .screen { outline: 2px solid Highlight; outline-offset: 2px; }
        .screen { position: relative; border-radius: inherit; }
        [hidden] { display: none !important; }
        .empty { font: 13px system-ui; color: GrayText; padding: 10px; }
        .notice { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; justify-items: center; text-align: center; padding: 10px; font: 13px/1.35 system-ui; color: #fff; background: #1d1c1acc; border-radius: inherit; }
        .notice button { font: inherit; padding: 4px 12px; border-radius: 999px; border: 1px solid #fff; background: transparent; color: #fff; }
        /* Off-screen but focusable: brings up the on-screen keyboard on phones. */
        textarea { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; resize: none; font-size: 16px; }
        dialog { border: 1px solid #8884; border-radius: 12px; padding: 14px; font: 15px system-ui; }
        dialog select { font: inherit; min-width: 200px; margin: 8px 0; display: block; }
        dialog button { font: inherit; }
      </style>
      <div class="screen" part="screen">
        <div class="empty" part="empty">waiting for frames…</div>
        <canvas hidden></canvas><video hidden muted playsinline autoplay></video>
        <div class="notice" part="notice" role="status" hidden><span></span><button type="button">Try again</button></div>
        <textarea aria-label="Keyboard input for the remote element" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
      </div>
      <dialog><form method="dialog"><label><span id="sel-name"></span><select></select></label><button value="ok">OK</button> <button value="cancel">Cancel</button></form></dialog>`;
    this.#canvas = root.querySelector('canvas');
    this.#ctx = this.#canvas.getContext('2d');
    this.#video = root.querySelector('video');
    this.#keys = root.querySelector('textarea');
    this.setAttribute('role', 'application');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Remote element');

    const screen = root.querySelector('.screen');
    screen.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('dialog')) return;
      this.#down = true;
      screen.setPointerCapture(e.pointerId);
      this.#pointer('down', e);
      // Inside the gesture, so phones will raise the keyboard if the tap
      // landed on a text field (known from the element map in `meta`).
      const p = this.#point(e);
      const item = this.elementAt(p.x, p.y);
      this.#keys.inputMode = item?.editable ? 'text' : 'none';
      this.#keys.focus({ preventScroll: true });
      e.preventDefault();
    });
    screen.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - this.#lastMove < 30) return;
      this.#lastMove = now;
      if (this.#down) this.#pointer('move', e);
      const p = this.#point(e);
      this.dispatchEvent(new CustomEvent('hover', { detail: p }));
    });
    screen.addEventListener('pointerup', (e) => {
      if (!this.#down) return;
      this.#down = false;
      this.#pointer('up', e);
    });
    screen.addEventListener('pointercancel', () => (this.#down = false));
    screen.addEventListener('pointerleave', () => this.dispatchEvent(new CustomEvent('hover', { detail: null })));
    screen.addEventListener(
      'wheel',
      (e) => {
        if (this.readOnly) return;
        const p = this.#point(e);
        this.#send({ t: 'pointer', kind: 'wheel', ...p, dx: e.deltaX, dy: e.deltaY });
      },
      { passive: true },
    );

    // Keyboard. Desktop keyboards give keydown with a real key; phone
    // keyboards give key "Unidentified" and then an input event.
    const SPECIAL = ['Backspace', 'Delete', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'];
    this.#keys.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.key === 'Unidentified' || e.key === 'Process') return;
      if (e.key.length === 1 || SPECIAL.includes(e.key)) {
        e.preventDefault();
        this.#send({ t: 'key', key: e.key, shift: e.shiftKey });
      }
    });
    this.#keys.addEventListener('input', (e) => {
      if (e.isComposing) return;
      if (e.inputType === 'deleteContentBackward') this.#send({ t: 'key', key: 'Backspace' });
      else if (e.inputType === 'insertLineBreak') this.#send({ t: 'key', key: 'Enter' });
      else if (e.data) this.#send({ t: 'text', data: e.data });
      else if (this.#keys.value.length > 1) this.#send({ t: 'text', data: this.#keys.value.slice(1) });
      this.#keys.value = ' '; // keep one character so Backspace always has something to delete
      this.#keys.setSelectionRange(1, 1);
    });
    this.#keys.addEventListener('compositionend', (e) => {
      if (e.data) this.#send({ t: 'text', data: e.data });
      this.#keys.value = ' ';
    });
    this.#keys.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        e.preventDefault();
        this.#send({ t: 'text', data: text });
      }
    });
    this.#keys.value = ' ';

    root.querySelector('.notice button').addEventListener('click', (e) => {
      e.stopPropagation();
      this.refresh();
    });
    root.querySelector('.notice').addEventListener('pointerdown', (e) => e.stopPropagation());
    // Coming back from the background: whatever was on screen may be stale or gone.
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.isConnected && this.refresh());
    const dialog = root.querySelector('dialog');
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'ok') this.#send({ t: 'choose', id: dialog.dataset.id, value: dialog.querySelector('select').value });
    });
  }

  get readOnly() {
    return this.hasAttribute('readonly');
  }
  set readOnly(v) {
    this.toggleAttribute('readonly', !!v);
  }
  get meta() {
    return this.#meta;
  }
  get frames() {
    return this.#frames;
  }
  get link() {
    return this.#link;
  }
  /** The element currently showing the frames (a canvas or a video). */
  get surfaceElement() {
    return this.#video.hidden ? this.#canvas : this.#video;
  }

  /** Item of the source's element map under a normalised point. */
  elementAt(x, y) {
    let hit = null;
    for (const item of this.#meta?.map ?? []) {
      const r = item.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) hit = item;
    }
    return hit;
  }

  /**
   * Attach to a source. `frames` says how pixels should arrive: 'bitmap'
   * (links that transfer), 'blob' (anything), or pass a MediaStream.
   */
  connect(link, { frames = link.transfers ? 'bitmap' : 'blob', stream = null, fps } = {}) {
    this.#link = link;
    this.#mode = { frames: stream ? 'none' : frames, fps };
    link.onmessage = (msg) => this.receive(msg);
    if (stream) this.setStream(stream);
    this.notice(null);
    link.send({ t: 'hello', ...this.#mode });
  }

  disconnect() {
    try {
      this.#link?.send({ t: 'bye' });
    } catch {}
    this.#link = null;
  }

  setStream(stream) {
    this.#video.srcObject = stream;
    this.#video.hidden = false;
    this.#canvas.hidden = true;
    this.shadowRoot.querySelector('.empty').hidden = true;
    this.#video.play?.().catch(() => {});
    const count = () => {
      this.#frames++;
      this.dispatchEvent(new CustomEvent('frame'));
      this.#video.requestVideoFrameCallback?.(count);
    };
    this.#video.requestVideoFrameCallback?.(count);
  }

  /** Ask the source for a fresh description and picture. */
  refresh() {
    if (!this.#link || !this.#mode) return;
    try {
      this.#link.send({ t: 'hello', ...this.#mode });
    } catch {}
  }

  /** Say something over the picture (null clears it). Used when the picture is lost, paused or over. */
  notice(text, retry = true) {
    const n = this.shadowRoot.querySelector('.notice');
    n.hidden = !text;
    n.querySelector('span').textContent = text ?? '';
    n.querySelector('button').hidden = !retry;
    this.toggleAttribute('trouble', !!text);
  }

  /** Handle one message from the source (public so relays can feed it). */
  receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'meta') {
      this.#meta = msg;
      this.#canvas.style.width = msg.w + 'px';
      this.#video.style.width = msg.w + 'px';
      this.style.setProperty('--live-w', msg.w + 'px');
      this.style.setProperty('--live-ratio', `${msg.w} / ${msg.h}`);
      this.dispatchEvent(new CustomEvent('meta', { detail: msg }));
    } else if (msg.t === 'frame') {
      if (msg.bitmap) this.#draw(msg.bitmap);
      else if (msg.blob) this.showBlob(msg.blob);
    } else if (msg.t === 'focus') {
      this.#focus = msg;
      this.#keys.inputMode = msg.editable ? msg.inputmode || 'text' : 'none';
      this.dispatchEvent(new CustomEvent('remotefocus', { detail: msg }));
    } else if (msg.t === 'select') {
      this.#pick(msg);
    } else if (msg.t === 'refused') {
      this.dispatchEvent(new CustomEvent('refused', { detail: msg }));
    } else if (msg.t === 'visibility') {
      this.toggleAttribute('stalled', msg.state !== 'visible');
      this.notice(msg.state === 'visible' ? null : 'Paused: the page this comes from is in the background.', false);
      this.dispatchEvent(new CustomEvent('sourcevisibility', { detail: msg.state }));
    } else if (msg.t === 'trouble') {
      this.notice(msg.what === 'lost' ? 'The browser dropped this picture at its source. Waiting for it to come back.' : msg.what === 'blank' ? 'The picture is arriving blank. Asking for it again.' : null);
      this.dispatchEvent(new CustomEvent('trouble', { detail: msg.what }));
    } else if (msg.t === 'bye') {
      this.notice('The other side stopped sharing this.', false);
      this.dispatchEvent(new CustomEvent('bye'));
    } else {
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    }
  }

  /** Show an encoded frame (Blob or ArrayBuffer), e.g. one relayed by a server. */
  async showBlob(data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
    try {
      this.#draw(await createImageBitmap(blob));
    } catch {}
  }

  #draw(bitmap) {
    if (this.#canvas.width !== bitmap.width || this.#canvas.height !== bitmap.height) {
      this.#canvas.width = bitmap.width;
      this.#canvas.height = bitmap.height;
    }
    this.#ctx.drawImage(bitmap, 0, 0);
    this.dispatchEvent(new CustomEvent('bitmap', { detail: bitmap }));
    bitmap.close?.();
    if (this.#canvas.hidden) {
      this.#canvas.hidden = false;
      this.#video.hidden = true;
      this.shadowRoot.querySelector('.empty').hidden = true;
    }
    this.#frames++;
    this.dispatchEvent(new CustomEvent('frame'));
  }

  #pick(msg) {
    const dialog = this.shadowRoot.querySelector('dialog');
    const select = dialog.querySelector('select');
    select.replaceChildren(...msg.options.map((o) => Object.assign(document.createElement('option'), { value: o.value, textContent: o.label, disabled: !!o.disabled })));
    select.value = msg.value;
    dialog.querySelector('#sel-name').textContent = msg.name || 'Choose';
    dialog.dataset.id = msg.id;
    dialog.returnValue = '';
    dialog.showModal();
    this.dispatchEvent(new CustomEvent('select', { detail: msg }));
  }

  #point(e) {
    const r = this.surfaceElement.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))), y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))) };
  }
  #pointer(kind, e) {
    this.#send({ t: 'pointer', kind, ...this.#point(e) });
  }
  #send(msg) {
    if (this.readOnly && msg.t !== 'cursor') return;
    this.#link?.send(msg);
  }

  /** Send any protocol message (cursor, highlight, act…). */
  send(msg) {
    this.#link?.send(msg);
  }
}
if (!customElements.get('live-view')) customElements.define('live-view', LiveView);
