// slot-provider.js: the providing side of the <slot-view> protocol.
//
// A site that wants pieces of its pages to be embeddable marks them up:
//
//   <live-region slot-name="product" slot-title="Product card"> …ordinary DOM… </live-region>
//   <live-region slot-name="price" slot-consent="none"> £9.50 </live-region>
//
// and calls provideSlots() once. Nothing else changes: opened normally the
// page is just the page. Loaded by a <slot-view> on another site it shows
// only the requested region, asks the person for permission, and then sends
// pictures of that region and accepts input for it.
//
// The rules this side enforces (the protocol is in /slot-view/PROTOCOL.md):
//   * No pixel leaves before consent, except for slots marked
//     slot-consent="none", which are view-only like an image.
//   * Consent is given on this origin, by a real click: either in this frame
//     once the browser confirms it is fully visible, or in a top-level window.
//     A click the embedder forwards can never grant anything.
//   * "view" and "input" are separate grants.
//   * Elements marked data-trusted are never activated by forwarded input;
//     the person confirms them here, the same way as consent.
//   * The embedder may set only the custom properties listed in `themeable`.
import { serve, supported } from './live-surface.js';
import { portLink } from './live-view.js';

export const PROTOCOL = 1;
export { supported };

const INPUT = new Set(['pointer', 'key', 'text', 'choose', 'act']);
const ASK_MIN = { w: 270, h: 168 };
const HASH = '#slot-view-ask=';

const CSS = `
html.slot-embedded, html.slot-embedded body { background: transparent !important; margin: 0 !important; overflow: hidden !important; }
html.slot-embedded body { visibility: hidden; }
html.slot-embedded [data-slot-active] { visibility: visible; position: fixed !important; left: 0; top: 0; width: 100vw; margin: 0 !important; z-index: 1; }
/* Content-sized slots: the region takes the width its one child wants (set in px by script, see fit()). */
html.slot-embedded[data-slot-sizing=content] [data-slot-active] > * { width: max-content; }
.slot-ask { visibility: visible; position: fixed; inset: 0; z-index: 2147483647; box-sizing: border-box; display: grid; align-content: center; gap: 6px; padding: 10px 12px;
  font: 13px/1.35 system-ui, sans-serif; color: #1d1c1a; background: #fffdf8; border: 2px solid #1d1c1a; border-radius: 12px; overflow: auto; }
dialog.slot-ask { position: fixed; inset: 0; margin: auto; width: min(360px, calc(100vw - 32px)); height: max-content; font-size: 15px; padding: 18px; }
dialog.slot-ask::backdrop { background: #0008; }
.slot-ask * { box-sizing: border-box; }
.slot-ask .from { font: 11px ui-monospace, monospace; opacity: 0.7; overflow-wrap: anywhere; }
.slot-ask strong { font-size: 1.08em; overflow-wrap: anywhere; }
.slot-ask p { margin: 0; }
.slot-ask label { display: flex; gap: 6px; align-items: start; }
.slot-ask .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.slot-ask button { font: inherit; padding: 5px 14px; border-radius: 999px; border: 1px solid #1d1c1a; background: transparent; color: inherit; cursor: pointer; min-height: 30px; }
.slot-ask button.yes { background: #1d1c1a; color: #fff; font-weight: 600; }
.slot-ask button:disabled { opacity: 0.45; cursor: default; }
.slot-ask .why { font-size: 11px; opacity: 0.75; }
.slot-ask button.link { border: 0; padding: 0; min-height: 0; text-decoration: underline; font-size: 11px; }
`;

const key = (origin, slot) => `slot-view:grant:${origin}|${slot}`;
const store = {
  get(origin, slot) {
    try {
      return JSON.parse(localStorage.getItem(key(origin, slot)));
    } catch {
      return null;
    }
  },
  set(origin, slot, scopes) {
    try {
      localStorage.setItem(key(origin, slot), JSON.stringify(scopes));
    } catch {}
  },
  clear(origin, slot) {
    try {
      localStorage.removeItem(key(origin, slot));
    } catch {}
  },
};

function injectCss(doc = document) {
  if (doc.getElementById('slot-provider-css')) return;
  const style = doc.createElement('style');
  style.id = 'slot-provider-css';
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * Tell `cb` whether the browser vouches that `el` is fully visible: not
 * covered, not transparent, not transformed (IntersectionObserver v2).
 * Calls cb(null) once where the browser can't say.
 */
function watchVisible(el, cb) {
  if (!('isVisible' in IntersectionObserverEntry.prototype)) {
    cb(null);
    return () => {};
  }
  const io = new IntersectionObserver((entries) => cb(entries.at(-1).isVisible), { threshold: [1], trackVisibility: true, delay: 100 });
  io.observe(el);
  return () => io.disconnect();
}

/**
 * Build the question. `req` is { kind:'consent'|'confirm', host, title, scopes, label }.
 * `decide({ ok, input })` is called once, only from a trusted click.
 */
function buildPrompt(doc, req, { modal, decide, openWindow }) {
  const el = doc.createElement(modal ? 'dialog' : 'div');
  el.className = 'slot-ask';
  el.setAttribute('role', modal ? 'dialog' : 'alertdialog');
  el.setAttribute('aria-label', 'Permission request');
  const me = location.host;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const wantsInput = req.kind === 'consent' && req.scopes.includes('input');
  el.innerHTML =
    req.kind === 'consent'
      ? `<div class="from">${esc(me)} asks</div>
         <p><strong>Show “${esc(req.title)}” on ${esc(new URL(req.host).host)}?</strong></p>
         <p>That page will get live pictures of it, and nothing else from here.</p>
         ${wantsInput ? '<label><input type="checkbox" class="input" checked> <span>Let that page click and type in it</span></label>' : ''}
         <div class="row"><button class="yes" disabled>Allow</button><button class="no">Not now</button></div>
         <div class="why" role="status"></div>`
      : `<div class="from">${esc(me)} asks</div>
         <p><strong>${esc(req.label)}?</strong></p>
         <p>${esc(new URL(req.host).host)} pressed this for you. It only happens if you confirm here.</p>
         <div class="row"><button class="yes" disabled>Confirm</button><button class="no">Cancel</button></div>
         <div class="why" role="status"></div>`;
  const yes = el.querySelector('.yes');
  const why = el.querySelector('.why');
  let visible = modal ? true : false;
  let stop = () => {};
  if (modal) yes.disabled = false;
  else {
    const started = performance.now();
    stop = watchVisible(el, (v) => {
      visible = v !== false;
      yes.disabled = !visible;
      if (v === null) why.textContent = 'This browser cannot check that the prompt is uncovered.';
      else if (v) why.textContent = '';
      else if (performance.now() - started > 600) showBlocked();
    });
    const timer = setTimeout(() => !visible && showBlocked(), 1500);
    const prev = stop;
    stop = () => (prev(), clearTimeout(timer));
  }
  function showBlocked() {
    if (why.querySelector('button')) return;
    why.textContent = 'Something is covering or fading this prompt, so Allow is off. ';
    if (openWindow) {
      const b = Object.assign(doc.createElement('button'), { className: 'link', type: 'button', textContent: `Answer in a ${me} window` });
      b.onclick = (e) => e.isTrusted && openWindow();
      why.append(b);
    }
  }
  const finish = (ok, e) => {
    if (!e.isTrusted) return;
    if (ok && !visible) return;
    stop();
    decide({ ok, input: ok && wantsInput && el.querySelector('.input').checked });
  };
  yes.onclick = (e) => finish(true, e);
  el.querySelector('.no').onclick = (e) => finish(false, e);
  return el;
}

/**
 * Start providing the page's slots. Options:
 *   policy(origin, slot)  'ask' (default) | 'allow' | 'deny'
 *   themeable             { '--name': RegExp } custom properties an embedder may set
 *   remember              keep grants in this frame's storage (default true)
 *   title                 fallback title
 * Returns { embedded, tell(data), state } ; tell() sends an app message to the embedder.
 */
export function provideSlots({ policy = () => 'ask', themeable = {}, remember = true, title = document.title } = {}) {
  injectCss();
  const api = { embedded: window !== parent, popup: false, host: null, slot: null, scopes: [], tell: () => {}, onstate: null };

  // ---- Opened as the consent window ----
  if (window === parent && location.hash.startsWith(HASH)) {
    api.popup = true;
    runPopup(location.hash.slice(HASH.length));
    return api;
  }
  if (window === parent) return api;

  // ---- Embedded ----
  document.documentElement.classList.add('slot-embedded');
  const regions = () => [...document.querySelectorAll('[slot-name]')];
  const info = (r) => ({ name: r.getAttribute('slot-name'), title: r.getAttribute('slot-title') ?? title, consent: r.getAttribute('slot-consent') === 'none' ? 'none' : 'ask' });
  const pending = (window.__slotViewPending ??= new Map());
  let session = null;

  addEventListener('message', (e) => {
    if (e.source !== parent || e.data?.slotview !== PROTOCOL) return;
    if (e.data.type === 'request' && e.ports[0]) start(e.origin, e.data, e.ports[0]);
  });
  parent.postMessage({ slotview: PROTOCOL, type: 'ready', supported, slots: regions().map(info) }, '*');

  function start(host, want, port) {
    session?.end();
    const link = portLink(port);
    const region = regions().find((r) => r.getAttribute('slot-name') === want.slot);
    if (!region) return link.send({ t: 'consent', state: 'denied', reason: 'no such slot' });
    for (const r of regions()) r.toggleAttribute('data-slot-active', r === region);
    document.documentElement.dataset.slotSizing = want.sizing === 'content' ? 'content' : 'fill';
    const slot = info(region);
    const asked = (Array.isArray(want.scopes) ? want.scopes : ['view']).filter((s) => s === 'view' || s === 'input');
    if (!asked.includes('view')) asked.unshift('view');
    const s = (session = { host, slot, link, region, scopes: [], stopServe: null, facade: null, ask: null, nonce: null, ended: false, end });
    api.host = host;
    api.slot = slot.name;
    const surface = region.surface;

    // Size and baseline, so the embedder can lay the picture out like text.
    const layout = () => {
      const r = region.getBoundingClientRect();
      const msg = { t: 'layout', w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, below: below(region), sizing: document.documentElement.dataset.slotSizing };
      const k = JSON.stringify(msg);
      if (k !== layout.last) link.send(msg);
      layout.last = k;
    };
    // A canvas has no intrinsic width to shrink to, so a content-sized
    // region is given the max-content width of its one child, in pixels.
    const fit = () => {
      const child = region.firstElementChild;
      if (document.documentElement.dataset.slotSizing === 'content' && child) region.style.width = Math.ceil(child.getBoundingClientRect().width * 100) / 100 + 'px';
      else region.style.width = '';
      layout();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(region);
    if (region.firstElementChild) ro.observe(region.firstElementChild);
    fit();

    link.onmessage = (m) => {
      if (s.ended || !m || typeof m !== 'object') return;
      if (m.t === 'present') return present(m.mode);
      if (m.t === 'ask') return s.scopes.length ? null : needConsent();
      if (m.t === 'dismiss') return void s.ask?.req.resolve({ ok: false }, 'dismissed by the embedder'); // saying no is always allowed
      if (m.t === 'revoke') return revoke();
      if (m.t === 'theme') return theme(m.vars);
      if (!s.scopes.length) return INPUT.has(m.t) || m.t === 'hello' ? link.send({ t: 'refused', what: m.t, why: 'no consent' }) : null;
      if (INPUT.has(m.t)) {
        if (!s.scopes.includes('input')) return link.send({ t: 'refused', what: m.t, why: 'view only' });
        if (guarded(m)) return;
      }
      s.facade?.onmessage?.(m);
    };

    if (!surface) {
      // No HTML-in-canvas here: nothing can be sent, so this stays an
      // ordinary frame that the embedder shows as it is. No consent needed,
      // because the embedder learns nothing an iframe would not tell it.
      link.send({ t: 'plain' });
      layout();
      return;
    }
    surface.opaque = false;
    const rule = slot.consent === 'none' ? 'public' : policy(host, slot.name);
    const kept = remember ? store.get(host, slot.name) : null;
    if (rule === 'deny') return link.send({ t: 'consent', state: 'denied', reason: 'this site is not allowed to embed it' });
    if (rule === 'public') return grant(['view'], 'public');
    if (rule === 'allow') return grant(asked, 'allow-list');
    if (kept?.length) return grant(kept.filter((x) => asked.includes(x)), 'remembered');
    needConsent();

    function needConsent() {
      closeAsk();
      s.nonce = crypto.randomUUID();
      window.name = 'slot-view-' + s.nonce;
      const req = { kind: 'consent', host, slot: slot.name, title: slot.title, scopes: asked, resolve: (d, how) => (d.ok ? grant(d.input ? ['view', 'input'] : ['view'], how, true) : deny()) };
      pending.clear();
      pending.set(s.nonce, req);
      s.ask = { req };
      link.send({ t: 'consent', state: 'needed', slot: slot.name, title: slot.title, scopes: asked, popup: popupUrl(), min: ASK_MIN });
    }
    function popupUrl() {
      const u = new URL(location.href);
      u.hash = HASH + s.nonce;
      return u.href;
    }
    // The embedder says how it is letting the person answer.
    function present(mode) {
      if (!s.ask || s.ask.el) return;
      if (mode !== 'frame') return; // 'popup': the window finds this frame by itself
      const el = buildPrompt(document, s.ask.req, {
        decide: (d) => s.ask?.req.resolve(d, 'frame'),
        openWindow: () => window.open(popupUrl(), 'slot-view-ask', 'popup,width=440,height=380'),
      });
      s.ask.el = el;
      document.documentElement.append(el);
    }
    function closeAsk() {
      s.ask?.el?.remove();
      s.ask = null;
      pending.clear();
    }
    function grant(scopes, how, save = false) {
      closeAsk();
      s.scopes = scopes;
      api.scopes = scopes;
      if (save && remember) store.set(host, slot.name, scopes);
      link.send({ t: 'consent', state: 'granted', slot: slot.name, title: slot.title, scopes, how });
      layout.last = '';
      layout();
      s.facade = { transfers: true, onmessage: null, send: (m, t) => link.send(m, t) };
      s.stopServe = serve(surface, s.facade, { title: slot.title, peer: host });
      api.onstate?.('granted');
    }
    function deny() {
      closeAsk();
      link.send({ t: 'consent', state: 'denied', reason: 'declined' });
      api.onstate?.('denied');
    }
    function revoke() {
      store.clear(host, slot.name);
      s.stopServe?.();
      s.stopServe = null;
      s.facade = null;
      s.scopes = [];
      api.scopes = [];
      closeAsk();
      link.send({ t: 'consent', state: 'revoked' });
      api.onstate?.('revoked');
    }
    function theme(vars) {
      const applied = [];
      const ignored = [];
      for (const [name, value] of Object.entries(vars && typeof vars === 'object' ? vars : {})) {
        if (themeable[name]?.test(String(value))) {
          document.documentElement.style.setProperty(name, value);
          applied.push(name);
        } else ignored.push(name);
      }
      link.send({ t: 'themed', applied, ignored });
    }

    // Forwarded input aimed at a data-trusted element is swallowed, and the
    // person is asked here instead.
    function guarded(m) {
      let el = null;
      if (m.t === 'pointer' && (m.kind === 'down' || m.kind === 'up')) el = surface.elementAt(m.x * surface.width, m.y * surface.height);
      else if (m.t === 'act' && m.kind === 'click') {
        const item = surface.describe().find((i) => i.id === m.id);
        if (item) el = surface.elementAt((item.rect.x + item.rect.w / 2) * surface.width, (item.rect.y + item.rect.h / 2) * surface.height);
      } else if (m.t === 'key' && (m.key === 'Enter' || m.key === ' ')) el = document.activeElement;
      el = el?.closest?.('[data-trusted]');
      if (!el || !region.contains(el)) return false;
      if (m.t === 'pointer' && m.kind === 'down') return true; // wait for the release
      if (s.ask) return true;
      s.nonce = crypto.randomUUID();
      window.name = 'slot-view-' + s.nonce;
      const label = el.getAttribute('data-trusted') || el.getAttribute('aria-label') || el.textContent.trim();
      const req = {
        kind: 'confirm', host, slot: slot.name, title: slot.title, scopes: s.scopes, label,
        resolve: (d, how) => {
          closeAsk();
          if (d.ok) el.click();
          link.send({ t: 'attention', on: false, done: d.ok, how });
        },
      };
      pending.set(s.nonce, req);
      s.ask = { req };
      link.send({ t: 'attention', on: true, reason: 'confirm', label, popup: popupUrl(), min: ASK_MIN });
      return true;
    }

    api.tell = (data) => s.scopes.length && !s.ended && link.send({ t: 'app', data });

    function end() {
      s.ended = true;
      ro.disconnect();
      s.stopServe?.();
      closeAsk();
      link.close();
    }
  }

  // The consent window can also reach this frame through a BroadcastChannel,
  // where the browser lets the two share one.
  try {
    const bc = new BroadcastChannel('slot-view-ask');
    bc.onmessage = (e) => {
      const req = pending.get(e.data?.nonce);
      if (!req) return;
      if (e.data.q === 'who') bc.postMessage({ nonce: e.data.nonce, a: 'who', req: { kind: req.kind, host: req.host, title: req.title, scopes: req.scopes, label: req.label } });
      else if (e.data.q === 'decide') {
        bc.postMessage({ nonce: e.data.nonce, a: 'done' });
        req.resolve(e.data.decision, 'window, by BroadcastChannel');
      }
    };
  } catch {}

  return api;
}

/** Distance from the first line's text baseline to the bottom of the region, in CSS px. */
function below(region) {
  try {
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const node = walker.nextNode();
    if (!node) return 0;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getClientRects()[0];
    const cs = getComputedStyle(node.parentElement);
    const ctx = (below.ctx ??= document.createElement('canvas').getContext('2d'));
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText('x');
    const asc = m.fontBoundingBoxAscent;
    const desc = m.fontBoundingBoxDescent;
    // The text rect is the font's content area: baseline sits `asc` below its top.
    const baseline = rect.top + ((rect.height - (asc + desc)) / 2 + asc);
    return Math.max(0, Math.round((region.getBoundingClientRect().bottom - baseline) * 100) / 100);
  } catch {
    return 0;
  }
}

// ---- The consent window: a top-level page on the provider's origin ----
async function runPopup(nonce) {
  const say = (text) => {
    const d = document.createElement('dialog');
    d.className = 'slot-ask';
    d.innerHTML = `<p></p><div class="row"><button class="no">Close</button></div>`;
    d.querySelector('p').textContent = text;
    d.querySelector('button').onclick = () => window.close();
    document.body.append(d);
    d.showModal();
  };
  const found = await findPending(nonce);
  window.__slotViewRoute = found?.how ?? 'none';
  if (!found) return say('This window could not find the page that asked. Go back to it and try again.');
  let el;
  const decide = (d) => {
    found.resolve(d);
    el.close();
    window.close();
    // Browsers only let script close windows that script opened.
    setTimeout(() => say(d.ok ? 'Allowed. You can close this window.' : 'Not shared. You can close this window.'), 300);
  };
  el = buildPrompt(document, found.req, { modal: true, decide });
  document.body.append(el);
  el.showModal();
}

// Three ways for the window to reach the frame that is waiting, tried in
// order. Which one works is itself a finding.
async function findPending(nonce) {
  const look = (w) => {
    try {
      const req = w.__slotViewPending?.get(nonce);
      return req ? req : null;
    } catch {
      return null;
    }
  };
  const direct = (req, how) => ({ req, how, resolve: (d) => req.resolve(d, 'window, ' + how) });
  // 1. The opener is the frame (it opened us itself), or one of the opener's frames is.
  try {
    if (opener) {
      const hit = look(opener);
      if (hit) return direct(hit, 'opened by the frame');
      for (let i = 0; i < opener.length; i++) {
        const req = look(opener[i]);
        if (req) return direct(req, 'opener.frames');
      }
    }
  } catch {}
  // 2. Find the frame by its window name.
  try {
    const w = window.open('', 'slot-view-' + nonce);
    if (w) {
      const req = look(w);
      if (req) return direct(req, 'window name');
      try {
        if (w !== window && w.location.href === 'about:blank') w.close();
      } catch {}
    }
  } catch {}
  // 3. BroadcastChannel (only where the frame and this window share storage).
  try {
    const bc = new BroadcastChannel('slot-view-ask');
    const answer = (q, a, extra = {}) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 700);
        const on = (e) => {
          if (e.data?.nonce !== nonce || e.data.a !== a) return;
          clearTimeout(timer);
          bc.removeEventListener('message', on);
          resolve(e.data);
        };
        bc.addEventListener('message', on);
        bc.postMessage({ nonce, q, ...extra });
      });
    const who = await answer('who', 'who');
    if (who) return { req: who.req, how: 'BroadcastChannel', resolve: (d) => answer('decide', 'done', { decision: d }) };
  } catch {}
  return null;
}
