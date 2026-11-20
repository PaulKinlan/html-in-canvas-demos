// <slot-view src="https://shop.example/product/42" name="product"></slot-view>
//
// Shows one named, live piece of another site's page, without an iframe's
// box: the picture is as big as the piece is, can sit in a line of text on
// the baseline (`inline`), can have text wrap round its outline (`shape`),
// and can be styled, clipped and transformed like an image.
//
// The other site's page runs in a frame this element keeps invisible. It
// must opt in (see slot-provider.js) and the person must agree, on that
// site's own origin, before a single pixel arrives. This element never needs
// HTML-in-canvas itself; only the providing page does. Where the provider
// has no HTML-in-canvas, the frame is simply shown.
//
//   attributes  src, name, scopes="view input" (default) | "view",
//               inline, shape, consent="auto" (default) | "popup"
//   properties  state, scopes, meta, frames, theme = { '--x': … }
//   methods     ask(), forget(), send(msg)
//   events      consent, app, themed, attention, frame, protocol
//
// Protocol: /slot-view/PROTOCOL.md
import './live-view.js';
import { portLink } from './live-view.js';

const PROTOCOL = 1;
const INPUT = new Set(['pointer', 'key', 'text', 'choose', 'act']);

export class SlotView extends HTMLElement {
  static observedAttributes = ['src', 'name'];
  #frame;
  #view;
  #gate;
  #outline;
  #origin = null;
  #link = null;
  #facade = null;
  #state = 'idle';
  #scopes = [];
  #need = null; // the provider's current question: { popup, min, title, kind, label }
  #info = null;
  #layout = null;
  #theme = {};
  #shapeAt = 0;
  #popup = null;
  #loaded = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
        :host { display: block; position: relative; }
        :host([inline]) { display: inline-block; line-height: 0; vertical-align: baseline; }
        [hidden] { display: none !important; }
        iframe { position: absolute; left: 0; top: 0; width: 100%; height: 150px; border: 0; opacity: 0; pointer-events: none; color-scheme: light; background: transparent; }
        :host([inline]) iframe { width: 300px; }
        /* The provider asks the person something in its own frame: show the real frame, nothing over it, nothing fading it. */
        :host([state=asking]) iframe, :host([state=plain]) iframe { position: relative; display: block; opacity: 1; pointer-events: auto; }
        :host([state=asking]) iframe { min-width: var(--ask-w); min-height: var(--ask-h); max-width: 100%; }
        live-view { display: block; }
        :host([inline]) live-view { display: inline-block; }
        .gate { font: 13px/1.3 system-ui, sans-serif; vertical-align: baseline; display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 10px; border: 1px dashed color-mix(in srgb, currentColor 45%, transparent); border-radius: 10px; }
        :host([inline]) .gate { display: inline; padding: 0; border: 0; font-size: 13px; line-height: 1.4; white-space: nowrap; }
        .gate button { font: inherit; color: inherit; background: color-mix(in srgb, currentColor 10%, transparent); border: 1px solid color-mix(in srgb, currentColor 40%, transparent); border-radius: 999px; padding: 2px 10px; cursor: pointer; min-height: 28px; }
        :host([inline]) .gate button { min-height: 0; padding: 0 8px; }
        .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      </style><iframe title="Embedded piece of another site" loading="eager"></iframe><live-view part="view" hidden></live-view><span class="gate" part="gate" hidden><span class="what"></span><button type="button"></button></span><div class="sr outline"></div>`;
    this.#frame = root.querySelector('iframe');
    this.#view = root.querySelector('live-view');
    this.#gate = root.querySelector('.gate');
    this.#outline = root.querySelector('.outline');
    this.#gate.querySelector('button').addEventListener('click', () => this.#gateClick());
    for (const type of ['frame', 'refused']) this.#view.addEventListener(type, (e) => this.dispatchEvent(new CustomEvent(type, { detail: e.detail })));
    this.#view.addEventListener('bitmap', (e) => this.#shape(e.detail));
    this.#view.addEventListener('message', (e) => this.#other(e.detail));
  }

  connectedCallback() {
    addEventListener('message', this.#onWindowMessage);
    this.#load();
  }
  disconnectedCallback() {
    removeEventListener('message', this.#onWindowMessage);
    this.#link?.close();
    this.#link = null;
    this.#loaded = '';
  }
  attributeChangedCallback() {
    if (this.isConnected) this.#load();
  }

  get state() {
    return this.#state;
  }
  /** What the provider granted: [] | ['view'] | ['view', 'input']. */
  get scopes() {
    return [...this.#scopes];
  }
  get meta() {
    return this.#view.meta;
  }
  get layout() {
    return this.#layout;
  }
  get frames() {
    return this.#view.frames;
  }
  get slots() {
    return this.#info?.slots ?? [];
  }
  get view() {
    return this.#view;
  }
  get frameElement() {
    return this.#frame;
  }
  get theme() {
    return this.#theme;
  }
  /** Ask the provider to set custom properties. It applies the ones it allows and reports back in a `themed` event. */
  set theme(vars) {
    this.#theme = { ...this.#theme, ...vars };
    this.#post({ t: 'theme', vars: this.#theme });
  }
  /** Send any protocol message. */
  send(msg) {
    this.#post(msg);
  }
  /** Give up this page's permission. The provider forgets it. */
  forget() {
    this.#post({ t: 'revoke' });
  }
  /** Answer the provider's open question with "no" (the only answer an embedder may give). */
  dismiss() {
    this.#post({ t: 'dismiss' });
  }
  /** Ask (again) for permission. */
  ask() {
    this.#post({ t: 'ask' });
  }

  #want() {
    const scopes = (this.getAttribute('scopes') ?? 'view input').split(/\s+/).filter(Boolean);
    return { slot: this.getAttribute('name') ?? '', scopes, sizing: this.hasAttribute('inline') ? 'content' : 'fill' };
  }

  #load() {
    const src = this.getAttribute('src');
    if (!src) return;
    const url = new URL(src, document.baseURI);
    const k = url.href + '|' + this.getAttribute('name');
    if (k === this.#loaded) return;
    this.#loaded = k;
    this.#origin = url.origin;
    this.#link?.close();
    this.#link = null;
    this.#set('loading');
    this.#frame.src = url.href;
  }

  // #region connect
  #onWindowMessage = (e) => {
    if (e.source !== this.#frame.contentWindow || e.origin !== this.#origin || e.data?.slotview !== PROTOCOL) return;
    if (e.data.type !== 'ready') return;
    this.#info = e.data;
    this.#trace('in', { type: 'ready', supported: e.data.supported, slots: e.data.slots.map((s) => s.name) });
    const { port1, port2 } = new MessageChannel();
    this.#link = portLink(port1);
    this.#link.onmessage = (m) => this.#receive(m);
    const want = this.#want();
    this.#frame.contentWindow.postMessage({ slotview: PROTOCOL, type: 'request', ...want }, this.#origin, [port2]);
    this.#trace('out', { type: 'request', ...want });
    if (Object.keys(this.#theme).length) this.theme = {};
  };
  // #endregion connect

  #post(msg, transfer) {
    if (!this.#link) return;
    this.#link.send(msg, transfer);
    if (msg.t !== 'pointer' || msg.kind !== 'move') this.#trace('out', msg);
  }

  #trace(dir, msg) {
    this.dispatchEvent(new CustomEvent('protocol', { detail: { dir, msg } }));
  }

  #set(state) {
    this.#state = state;
    this.setAttribute('state', state);
    this.#view.hidden = state !== 'live';
    this.#gate.hidden = !['gate', 'denied', 'error'].includes(state);
    if (state !== 'live' && this.style.shapeOutside) {
      // The real frame is a rectangle again: text must not run over it.
      this.style.shapeOutside = '';
      this.#shapeAt = 0;
    }
  }

  #receive(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t !== 'frame') this.#trace('in', m.t === 'meta' ? { t: 'meta', w: m.w, h: m.h, map: `${m.map.length} elements` } : m);
    if (m.t === 'consent') return this.#consent(m);
    if (m.t === 'attention') return this.#attention(m);
    if (m.t === 'layout') return this.#applyLayout(m);
    if (m.t === 'plain') {
      this.#scopes = [];
      return this.#set('plain');
    }
    if (m.t === 'themed') return void this.dispatchEvent(new CustomEvent('themed', { detail: m }));
    if (m.t === 'app') return void this.dispatchEvent(new CustomEvent('app', { detail: m.data }));
    if (m.t === 'meta') this.#buildOutline(m.map);
    this.#facade?.onmessage?.(m);
  }
  // Messages <live-view> did not recognise.
  #other() {}

  #consent(m) {
    this.#popup = null;
    if (m.state === 'granted') {
      this.#scopes = m.scopes;
      this.#need = null;
      this.#view.readOnly = !m.scopes.includes('input');
      this.#set('live');
      // <live-view> draws the frames and turns pointer and keys into messages.
      this.#facade = { transfers: true, onmessage: null, send: (msg, t) => this.#post(msg, t) };
      this.#view.connect(this.#facade, { frames: 'bitmap' });
    } else if (m.state === 'needed') {
      this.#scopes = [];
      this.#need = { ...m, kind: 'consent' };
      this.#presentQuestion();
    } else {
      this.#scopes = [];
      this.#facade = null;
      this.#need = null;
      this.#outline.replaceChildren();
      this.#showGate(m.state === 'revoked' ? 'Permission given up.' : m.reason === 'declined' ? 'Not shared.' : `Not available: ${m.reason ?? 'refused'}.`, m.reason && m.reason !== 'declined' ? null : 'Ask again', 'denied');
    }
    this.dispatchEvent(new CustomEvent('consent', { detail: m }));
  }

  #attention(m) {
    if (m.on) {
      this.#need = { ...m, kind: 'confirm' };
      this.#presentQuestion();
    } else {
      this.#need = null;
      this.#popup = null;
      this.#set('live');
    }
    this.dispatchEvent(new CustomEvent('attention', { detail: m }));
  }

  // The provider has a question for the person. Either show its real frame
  // (it draws the question itself) or, when this element is too small or
  // sits inline, offer a button that opens the provider's own window.
  #presentQuestion() {
    const need = this.#need;
    const r = this.getBoundingClientRect();
    const avail = this.parentElement?.getBoundingClientRect().width ?? r.width;
    const mode = this.getAttribute('consent') === 'popup' || this.hasAttribute('inline') || Math.max(r.width, avail) < need.min.w ? 'popup' : 'frame';
    if (mode === 'frame') {
      this.style.setProperty('--ask-w', need.min.w + 'px');
      this.style.setProperty('--ask-h', need.min.h + 'px');
      this.#set('asking');
    } else {
      const host = new URL(this.#origin).host;
      this.#showGate(need.kind === 'consent' ? (this.hasAttribute('inline') ? '' : `“${need.title}” from ${host}`) : `Confirm “${need.label}” with ${host}`, need.kind === 'consent' ? (this.hasAttribute('inline') ? `Allow ${need.title}…` : 'Allow…') : 'Confirm…', 'gate');
    }
    this.#post({ t: 'present', mode });
  }

  #showGate(text, action, state) {
    this.#gate.querySelector('.what').textContent = text;
    const b = this.#gate.querySelector('button');
    b.hidden = !action;
    b.textContent = action ?? '';
    this.#set(state);
  }

  #gateClick() {
    if (this.#state === 'gate' && this.#need) {
      // A window on the provider's origin. It finds the waiting frame itself.
      this.#popup = window.open(this.#need.popup, 'slot-view-ask', 'popup,width=440,height=380');
      this.#trace('out', { note: 'opened the provider\'s consent window' });
    } else this.ask();
  }

  #applyLayout(m) {
    this.#layout = m;
    this.#frame.style.height = Math.max(1, m.h) + 'px';
    if (this.hasAttribute('inline')) {
      this.#frame.style.width = Math.max(1, m.w) + 'px';
      this.style.verticalAlign = `${-m.below}px`;
    }
    this.dispatchEvent(new CustomEvent('layout', { detail: m }));
  }

  // Text can wrap round the piece's real outline: build a shape-outside image
  // from the alpha of the frames (the page has to float the element).
  #shape(bitmap) {
    if (!this.hasAttribute('shape')) return;
    const now = performance.now();
    if (now - this.#shapeAt < 1000) return;
    this.#shapeAt = now;
    // The browser lays a shape image out at its own pixel size, so make it
    // exactly as many pixels as this element has CSS pixels.
    const r = this.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.width));
    c.height = Math.max(1, Math.round(r.height));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    this.style.shapeOutside = `url(${c.toDataURL('image/png')})`;
    this.style.shapeImageThreshold = '0.3';
  }

  // Real, focusable stand-ins for the piece's controls, so the keyboard and
  // assistive technology have something to hold on to. Activating one is
  // forwarded by id. Only built when input was granted.
  #buildOutline(map) {
    if (!this.#scopes.includes('input')) return this.#outline.replaceChildren();
    const seen = new Set();
    for (const item of map) {
      seen.add(item.id);
      let el = this.#outline.querySelector(`[data-id="${item.id}"]`);
      if (!el) {
        el = document.createElement(item.editable ? 'input' : 'button');
        el.dataset.id = item.id;
        if (item.editable) el.addEventListener('input', () => this.#post({ t: 'act', kind: 'fill', id: item.id, value: el.value }));
        else {
          el.type = 'button';
          el.addEventListener('click', () => this.#post({ t: 'act', kind: 'click', id: item.id }));
        }
        el.addEventListener('focus', () => this.#post({ t: 'highlight', id: item.id }));
        this.#outline.append(el);
      }
      if (item.editable) {
        el.setAttribute('aria-label', item.name);
        if (this.shadowRoot.activeElement !== el) el.value = item.value ?? '';
      } else el.textContent = item.name;
    }
    for (const el of [...this.#outline.children]) if (!seen.has(el.dataset.id)) el.remove();
  }
}
if (!customElements.get('slot-view')) customElements.define('slot-view', SlotView);
export { INPUT };
