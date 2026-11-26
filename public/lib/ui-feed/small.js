// ui-feed/small.js: five small controls, rebuilt from demos on ui-feed.dev.
//
//   <type-styles>      a carousel of typefaces: a radio for each card, and the cards drawn as slices of one
//                      row, squeezed as they move away from the middle
//   <format-bar>       Bold, Italic and Underline as <button aria-pressed>, with a role="tooltip" that names
//                      each one and its shortcut
//   <presence-avatar>  an avatar that is a <button aria-pressed>: away or back online, with the dark fill
//                      spreading out of the status badge
//   <password-reveal>  an <input type="password"> whose dots are drawn by the canvas and pop in as you type,
//                      and a <button aria-pressed> that shows the password
//   <topic-list>       a checkbox for each newsletter. A chosen one is drawn from an italic copy of the list
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /small-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, rr, spring, TAU, reduced } from './kit.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const SERIF = "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
const MONO = "'IBM Plex Mono', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const local = (el, e) => { const r = el.canvas.getBoundingClientRect(), k = r.width / el.constructor.size[0]; return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
// A focus ring is drawn only for keyboard focus, as :focus-visible would show it.
const fv = (ctrl, el) => ctrl.shadowRoot.activeElement === el && el.matches(':focus-visible');
const ring = (ctx, x, y, w, h, r, colour = '#fff') => { ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore(); };

// ---------------------------------------------------------------------------------------------------------
// Type styles: a carousel whose cards are slices of one row, squeezed as they leave the middle
// ---------------------------------------------------------------------------------------------------------

export class TypeStyles extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static CARD = { w: 200, h: 248, gap: 14, top: 36 };
  static css = `
    .row { display: flex; gap: 14px; }
    .card { flex: none; width: 200px; height: 248px; padding: 0 20px 22px; box-sizing: border-box; display: grid; grid-template-rows: 1fr auto; align-items: center; justify-items: center; background: #24130d; border-radius: 22px; color: #fbe9d6; }
    .card b { display: inline-block; font-size: 96px; line-height: 1; font-weight: 400; }
    .card span { justify-self: start; font: 600 15px/1 ${SANS}; }
    .dots { display: flex; gap: 0; }
    .dots label { width: 22px; height: 22px; } .dots input { width: 22px; height: 22px; margin: 0; opacity: 0; cursor: pointer; }
    .grab { width: 360px; height: 248px; touch-action: pan-y; cursor: grab; }`;

  ready() {
    this.pos = { x: 0, v: 0 };
    this.build();
  }

  // #region type-styles
  build() {
    const box = this.canvas ?? this.$('.plain'), name = this.getAttribute('name') ?? 'style';
    this.styles = options(this);
    const start = Math.max(0, this.styles.findIndex((o) => o.selected));
    // Each card names a typeface. The <option>'s data-style is the CSS of its "Aa".
    this.row = node(`<div class="row" aria-hidden="true">${this.styles.map((o) => `<div class="card"><b style="${esc(o.data.style ?? '')}">${esc(o.data.sample ?? 'Aa')}</b><span>${esc(o.label)}</span></div>`).join('')}</div>`);
    // The value is a radio group, one radio a dot: arrows move it, and it is what the form sends.
    this.dots = node(`<div class="dots" role="radiogroup" aria-label="${esc(this.getAttribute('label') ?? 'Type style')}">${this.styles.map((o, i) => `<label><input type="radio" name="${esc(name)}" value="${esc(o.value)}" aria-label="${esc(o.label)}" ${i === start ? 'checked' : ''}></label>`).join('')}</div>`);
    this.radios = [...this.dots.querySelectorAll('input')];
    this.grab = node('<div class="grab" aria-hidden="true"></div>');
    box.replaceChildren(this.row, this.grab, this.dots);
    this.pos.x = start;
    this.dots.addEventListener('change', () => this.sync());
    // A drag across the cards moves the row with the finger and lets go to the nearest card.
    let drag = null;
    // No focus from a press on the cards: delegatesFocus would send it to the first radio, not the chosen one.
    this.grab.addEventListener('pointerdown', (e) => { e.preventDefault(); drag = { x: local(this, e).x, at: this.pos.x }; try { this.grab.setPointerCapture(e.pointerId); } catch {} });
    this.grab.addEventListener('pointermove', (e) => { if (!drag) return; const dx = local(this, e).x - drag.x; if (Math.abs(dx) > 4) drag.moved = true; this.pos.x = clamp(drag.at - dx / 130, -0.3, this.styles.length - 0.7); this.pos.v = 0; this.request(); });
    const end = (e) => {
      if (!drag) return;
      let i = Math.round(this.pos.x);
      // a tap on a card at the side goes to that card
      if (!drag.moved && e.type === 'pointerup') { const x = local(this, e).x; if (x < 80) i = Math.round(drag.at) - 1; else if (x > 280) i = Math.round(drag.at) + 1; }
      drag = null; this.pick(clamp(i, 0, this.styles.length - 1));
    };
    this.grab.addEventListener('pointerup', end); this.grab.addEventListener('pointercancel', end);
    this.sync();
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  pick(i) { if (this.radios.includes(this.shadowRoot.activeElement)) this.radios[i].focus({ preventScroll: true }); if (!this.radios[i].checked) { this.radios[i].checked = true; this.radios[i].dispatchEvent(new Event('change', { bubbles: true })); } else this.request(); }
  sync() { this.setValue(this.radios[this.index].value); this.request(); }

  draw(ctx, w, h) {
    const C = TypeStyles.CARD, n = this.styles.length;
    ctx.fillStyle = '#ff9a57'; ctx.fillRect(0, 0, w, h);
    const moving = spring(this.pos, this.index, this.dt, 170, 22);
    const p = this.pos.x;
    // A card's width falls as it moves from the middle; the row is laid out from those widths so that the
    // middle of the card at `p` sits in the middle of the canvas.
    const width = (d) => C.w * Math.max(0.3, 1 - 0.4 * Math.min(d, 1) - 0.15 * Math.max(0, d - 1));
    const ws = this.styles.map((_, i) => width(Math.abs(i - p))), xs = [];
    let x = 0; ws.forEach((cw, i) => { xs[i] = x; x += cw + C.gap; });
    const i0 = clamp(Math.floor(p), 0, n - 1), i1 = clamp(i0 + 1, 0, n - 1), k = p - i0;
    const mid = lerp(xs[i0] + ws[i0] / 2, xs[i1] + ws[i1] / 2, i0 === i1 ? 0 : k), shift = 180 - mid;
    this.styles.forEach((_, i) => {
      const cx = xs[i] + shift, cw = ws[i];
      if (cx > w || cx + cw < 0) return;
      ctx.save();
      rr(ctx, cx, C.top, cw, C.h, 22); ctx.clip();
      // the card squeezed to its width: a slice of the row, scaled across
      ctx.translate(cx, C.top); ctx.scale(cw / C.w, 1);
      put(ctx, this.row, -i * (C.w + C.gap), 0, this.row.offsetWidth, C.h);
      ctx.restore();
    });
    hit(ctx, this.row, -2000, 0);
    hit(ctx, this.grab, 0, C.top, 360, C.h);
    // the dots: the chosen one is a bar, and each takes the pointer as its radio
    const D = { x: 180 - n * 11, y: C.top + C.h + 22 };
    put(ctx, this.dots, D.x, D.y - 11); hit(ctx, this.dots, D.x, D.y - 11);
    this.styles.forEach((_, i) => {
      const on = clamp(1 - Math.abs(i - p)), dw = lerp(6, 18, on), cx = D.x + i * 22 + 11;
      ctx.fillStyle = `rgba(36,19,13,${lerp(0.45, 1, on)})`; rr(ctx, cx - dw / 2, D.y - 3, dw, 6, 3); ctx.fill();
    });
    if (this.radios.some((r) => fv(this, r))) ring(ctx, D.x - 4, D.y - 13, n * 22 + 8, 26, 13, '#24130d');
    return moving;
  }
  // #endregion type-styles
}
customElements.define('type-styles', TypeStyles);

// ---------------------------------------------------------------------------------------------------------
// Text formatting: three toggle buttons and a tooltip with the shortcut
// ---------------------------------------------------------------------------------------------------------

const MARKS = [{ k: 'bold', label: 'Bold', key: 'b', glyph: 'B' }, { k: 'italic', label: 'Italic', key: 'i', glyph: 'I' }, { k: 'underline', label: 'Underline', key: 'u', glyph: 'U' }];

export class FormatBar extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BAR = { x: 18, y: 150, w: 324, h: 112, b: 100 };
  static css = `
    .bar { display: flex; gap: 6px; padding: 6px; }
    .bar button { width: 100px; height: 100px; padding: 0; border: 0; border-radius: 22px; background: transparent; color: #fbf3e4; font: 700 60px/1 ${SERIF}; cursor: pointer; }
    .bar button.italic { font-style: italic; font-weight: 400; } .bar button.underline { font-weight: 400; text-decoration: underline; text-underline-offset: 8px; text-decoration-thickness: 4px; }
    .bar button:focus-visible { outline: 0; }
    .tip { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; background: #a8f0cf; border-radius: 14px; color: #1d1060; font: 700 23px/1 ${SANS}; white-space: nowrap; }
    .tip kbd { padding: 6px 8px; background: #6fdca9; border-radius: 7px; font: 700 14px/1 ${SANS}; }
    .sample { width: 300px; color: #e6defc; font: 400 17px/1.4 ${SERIF}; text-align: center; }`;

  ready() {
    this.press = MARKS.map(() => ({ x: 0, v: 0 }));
    this.pop = { x: 0, v: 0 };
    this.build();
  }

  // #region format-bar
  build() {
    const box = this.canvas ?? this.$('.plain'), mac = /Mac|iP/.test(navigator.platform);
    this.mod = mac ? '⌘' : 'Ctrl+';
    const on = (this.getAttribute('value') ?? '').split(/[\s,]+/);
    this.bar = node(`<div class="bar" role="toolbar" aria-label="Formatting">${MARKS.map((m) => `<button type="button" class="${m.k}" aria-pressed="${on.includes(m.k)}" aria-keyshortcuts="${mac ? 'Meta' : 'Control'}+${m.key.toUpperCase()}" aria-describedby="tip">${m.glyph}</button>`).join('')}</div>`);
    this.buttons = [...this.bar.querySelectorAll('button')];
    this.tip = node('<div class="tip" role="tooltip" id="tip"></div>');
    this.sample = node(`<p class="sample">${esc(this.textContent.trim() || 'The quick brown fox')}</p>`);
    box.replaceChildren(this.sample, this.bar, this.tip);
    this.buttons.forEach((b, i) => {
      b.addEventListener('click', () => this.toggle(i));
      b.addEventListener('pointerenter', () => this.show(i, 350));
      b.addEventListener('pointerleave', () => this.show(this.buttons.indexOf(this.shadowRoot.activeElement), 0));
      b.addEventListener('focus', () => this.show(i, 0));
      b.addEventListener('blur', () => this.show(-1, 0));
    });
    // The arrow keys move along the toolbar, and the shortcuts work anywhere inside it.
    this.bar.addEventListener('keydown', (e) => {
      const at = this.buttons.indexOf(this.shadowRoot.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.buttons[(at + (e.key === 'ArrowRight' ? 1 : 2)) % 3].focus(); }
      const m = e.ctrlKey || e.metaKey ? MARKS.findIndex((x) => x.key === e.key.toLowerCase()) : -1;
      if (m >= 0) { e.preventDefault(); this.toggle(m); }
      if (e.key === 'Escape') this.show(-1, 0);
    });
    this.buttons.forEach((b, i) => b.tabIndex = i ? -1 : 0);
    this.bar.addEventListener('focusin', (e) => this.buttons.forEach((b) => b.tabIndex = b === e.target ? 0 : -1));
    this.shown = -1;
    this.sync();
  }
  show(i, wait) {
    clearTimeout(this.timer);
    const go = () => { this.shown = i; if (i >= 0) { const m = MARKS[i]; this.tip.innerHTML = `${m.label}<kbd>${esc(this.mod)}${m.key.toUpperCase()}</kbd>`; } this.request(); };
    if (wait && i >= 0) this.timer = setTimeout(go, wait); else go();
  }
  toggle(i) { const b = this.buttons[i]; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }
  sync() {
    const on = MARKS.filter((m, i) => this.buttons[i].getAttribute('aria-pressed') === 'true');
    const fd = new FormData(), name = this.getAttribute('name') ?? 'format';
    for (const m of on) fd.append(name, m.k);
    this.setValue(fd);
    // the sample line takes the marks, so the toolbar has something to act on
    const st = this.sample.style, has = (k) => on.some((m) => m.k === k);
    st.fontWeight = has('bold') ? '700' : '400'; st.fontStyle = has('italic') ? 'italic' : 'normal'; st.textDecoration = has('underline') ? 'underline' : 'none';
    this.request();
  }

  draw(ctx, w, h) {
    const B = FormatBar.BAR;
    ctx.fillStyle = '#4b22c4'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.sample, 30, 286);
    ctx.fillStyle = '#3a1898'; rr(ctx, B.x, B.y, B.w, B.h, 28); ctx.fill();
    let moving = false;
    this.buttons.forEach((b, i) => {
      moving = spring(this.press[i], b.getAttribute('aria-pressed') === 'true' ? 1 : 0, this.dt, 360, 24) || moving;
      const t = clamp(this.press[i].x), bx = B.x + 6 + i * (B.b + 6), s = lerp(0.9, 1, t), hb = B.b / 2;
      if (t > 0.01) { ctx.save(); ctx.globalAlpha = t; ctx.translate(bx + hb, B.y + B.h / 2); ctx.scale(s, s); ctx.fillStyle = '#6b3cf0'; rr(ctx, -hb, -hb, B.b, B.b, 22); ctx.fill(); ctx.restore(); }
      if (fv(this, b)) ring(ctx, bx - 2, B.y + 4, B.b + 4, B.b + 4, 24);
    });
    put(ctx, this.bar, B.x, B.y);
    // the tooltip over the button it names, springing up out of it
    moving = spring(this.pop, this.shown >= 0 ? 1 : 0, this.dt, 340, 22) || moving;
    if (this.shown >= 0 || this.pop.x > 0.02) {
      const i = Math.max(0, this.shown), cx = B.x + 6 + i * (B.b + 6) + B.b / 2, tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      const tx = clamp(cx - tw / 2, 8, w - tw - 8), ty = B.y - th - 16, s = clamp(this.pop.x, 0, 1.2);
      ctx.save(); ctx.globalAlpha = clamp(s * 2);
      ctx.translate(cx, B.y - 6); ctx.scale(s, s); ctx.translate(-cx, -(B.y - 6));
      ctx.fillStyle = '#a8f0cf'; ctx.beginPath(); ctx.moveTo(cx - 8, ty + th - 1); ctx.lineTo(cx, ty + th + 8); ctx.lineTo(cx + 8, ty + th - 1); ctx.fill();
      put(ctx, this.tip, tx, ty, tw, th);
      ctx.restore();
    } else hit(ctx, this.tip, -1000, 0);
    return moving;
  }
  // #endregion format-bar
}
customElements.define('format-bar', FormatBar);

// ---------------------------------------------------------------------------------------------------------
// Back online: an avatar button. The dark fill spreads out of the status badge when the person comes back
// ---------------------------------------------------------------------------------------------------------

export class PresenceAvatar extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    button { width: 300px; height: 300px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #0d0d0d; cursor: pointer; }
    button:focus-visible { outline: 0; }
    .face { display: grid; place-items: center; width: 300px; height: 300px; }
    .face span { font: 200 108px/1 ${SANS}; letter-spacing: -0.02em; }
    .bold span { font-weight: 900; color: #f9ea14; letter-spacing: -0.04em; }
    output { width: 1px; height: 1px; overflow: hidden; }`;

  ready() {
    this.fill = { x: 0, v: 0 };
    this.build();
  }

  // #region presence-avatar
  build() {
    const box = this.canvas ?? this.$('.plain'), initials = esc(this.getAttribute('initials') ?? '?'), who = esc(this.getAttribute('person') ?? '');
    const online = this.hasAttribute('online');
    // The button is the avatar: its pressed state is "online". Its own text is the thin initials; a bold
    // copy, inert and hidden, is drawn inside the dark fill.
    this.btn = node(`<button type="button" aria-pressed="${online}" aria-label="${who}, online"><span class="face"><span>${initials}</span></span></button>`);
    this.bold = node(`<div class="face bold" inert aria-hidden="true"><span>${initials}</span></div>`);
    this.status = node('<output role="status"></output>');
    box.replaceChildren(this.btn, this.bold, this.status);
    this.fill.x = online ? 1 : 0;
    this.btn.addEventListener('click', () => { this.btn.setAttribute('aria-pressed', String(!this.online)); this.sync(true); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.addEventListener('feed-plain', () => { this.bold.hidden = true; });
    this.sync();
  }
  get online() { return this.btn.getAttribute('aria-pressed') === 'true'; }
  sync(said) {
    if (said) this.status.textContent = `${this.getAttribute('person') ?? ''} is ${this.online ? 'back online' : 'away'}`;
    this.setValue(this.online ? 'online' : 'away');
    this.request();
  }

  draw(ctx, w, h) {
    ctx.fillStyle = '#f9ea14'; ctx.fillRect(0, 0, w, h);
    const moving = spring(this.fill, this.online ? 1 : 0, this.dt, 120, 17);
    const C = { x: 180, y: 180, r: 150 }, badge = { x: C.x + C.r * Math.cos(0.75), y: C.y + C.r * Math.sin(0.75) };
    const t = clamp(this.fill.x);
    // away: a ring and thin initials
    ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(C.x, C.y, C.r - 4, 0, TAU); ctx.stroke();
    put(ctx, this.btn, 30, 30, 300, 300);
    // online: a dark disc that grows out of the badge, clipped to the avatar, with bold initials inside it
    if (t > 0.001) {
      const reach = Math.hypot(badge.x - (C.x - C.r), badge.y - (C.y - C.r)) * t;
      ctx.save(); ctx.beginPath(); ctx.arc(C.x, C.y, C.r, 0, TAU); ctx.clip();
      ctx.beginPath(); ctx.arc(badge.x, badge.y, reach, 0, TAU); ctx.clip();
      ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, w, h);
      put(ctx, this.bold, 30, 30, 300, 300);
      ctx.restore();
    }
    hit(ctx, this.bold, -1000, 0);
    // the badge: a moon while away, a ring while online
    ctx.fillStyle = '#0d0d0d'; ctx.beginPath(); ctx.arc(badge.x, badge.y, 34, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f9ea14';
    ctx.beginPath(); ctx.arc(badge.x, badge.y, 18, 0, TAU); ctx.fill();
    // the moon's shadow slides off as it turns into a ring
    ctx.fillStyle = '#0d0d0d'; ctx.beginPath(); ctx.arc(badge.x + lerp(9, 0, t), badge.y - lerp(9, 0, t), lerp(17, 10, t), 0, TAU); ctx.fill();
    if (fv(this, this.btn)) { ctx.save(); ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(C.x, C.y, C.r + 10, 0, TAU); ctx.stroke(); ctx.restore(); }
    put(ctx, this.status, -10, -10);
    return moving;
  }
  // #endregion presence-avatar
}
customElements.define('presence-avatar', PresenceAvatar);

// ---------------------------------------------------------------------------------------------------------
// Show and hide: a password field whose dots are drawn by the canvas, and an eye that opens
// ---------------------------------------------------------------------------------------------------------

export class PasswordReveal extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static FIELD = { x: 24, y: 150, w: 312, h: 56 };
  static css = `
    label { width: 312px; color: #fbe6cf; font: 600 21px/1 ${SANS}; letter-spacing: 0.01em; }
    input { width: 264px; height: 56px; padding: 0; border: 0; background: transparent; outline: 0; font: 400 30px/56px ${MONO}; letter-spacing: 14px; color: transparent; caret-color: #fbe6cf; }
    input.shown { color: #fbe6cf; }
    .mirror { font: 400 30px/56px ${MONO}; letter-spacing: 14px; white-space: pre; visibility: visible; color: transparent; }
    button.eye { width: 44px; height: 44px; padding: 0; border: 0; background: transparent; color: transparent; font-size: 1px; cursor: pointer; }
    p { width: 312px; margin: 0; color: #2a120b; font: 500 14px/1.3 ${MONO}; }`;

  ready() {
    this.lid = { x: 0, v: 0 };
    this.dots = [];
    this.build();
  }

  // #region password-reveal
  build() {
    const box = this.canvas ?? this.$('.plain'), min = +(this.getAttribute('minlength') ?? 8);
    this.label = node(`<label for="pw">${esc(this.getAttribute('label') ?? 'Password')}</label>`);
    this.input = node(`<input id="pw" type="password" autocomplete="new-password" minlength="${min}" aria-describedby="hint" spellcheck="false">`);
    this.eye = node('<button type="button" class="eye" aria-pressed="false" aria-controls="pw">Show password</button>');
    this.hint = node(`<p id="hint">At least ${min} characters</p>`);
    // An invisible copy of what is typed, in the same font, to measure where each character sits.
    this.mirror = node('<span class="mirror" aria-hidden="true"></span>');
    box.replaceChildren(this.label, this.input, this.eye, this.hint, this.mirror);
    this.min = min;
    this.input.addEventListener('input', () => this.sync());
    this.eye.addEventListener('click', () => {
      const show = this.eye.getAttribute('aria-pressed') !== 'true';
      this.eye.setAttribute('aria-pressed', String(show));
      this.eye.textContent = show ? 'Hide password' : 'Show password';
      // The field's type changes, so the browser treats it as text while it is shown; its text is drawn
      // by the field itself then, and the dots fade.
      this.input.type = show ? 'text' : 'password';
      this.input.classList.toggle('shown', show);
      this.request();
    });
    this.addEventListener('feed-plain', () => { this.mirror.hidden = true; this.input.style.color = 'inherit'; });
    this.sync();
  }
  sync() {
    const v = this.input.value;
    // one dot for each character: a new one pops in, a removed one is dropped
    while (this.dots.length < v.length) this.dots.push({ x: reduced() ? 1 : 0, v: 0 });
    this.dots.length = v.length;
    this.mirror.textContent = v;
    const short = v.length > 0 && v.length < this.min;
    this.hint.textContent = v.length >= this.min ? `✓ ${v.length} characters` : `At least ${this.min} characters${short ? `, ${this.min - v.length} to go` : ''}`;
    try { this.internals?.setValidity(short ? { tooShort: true } : {}, short ? `Use at least ${this.min} characters.` : '', this.input); } catch {}
    this.setValue(v);
    this.request();
  }

  draw(ctx, w, h) {
    const F = PasswordReveal.FIELD, shown = this.eye.getAttribute('aria-pressed') === 'true', v = this.input.value;
    ctx.fillStyle = '#c4512e'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.label, F.x, F.y - 34);
    let moving = spring(this.lid, shown ? 1 : 0, this.dt, 260, 22);
    // The dots go where the characters are: the mirror is laid out in the field's font, so its width over
    // the count is the width of one character, and the field's scroll moves them with the caret.
    const pitch = v.length ? this.mirror.offsetWidth / v.length : 18, scroll = this.input.scrollLeft, fade = 1 - clamp(this.lid.x);
    ctx.save(); ctx.beginPath(); ctx.rect(F.x - 12, F.y, 276, F.h); ctx.clip();
    this.dots.forEach((d, i) => {
      moving = spring(d, 1, this.dt, 420, 16) || moving;
      const cx = F.x + i * pitch + pitch / 2 - scroll, r = 10.5 * Math.max(0, d.x);
      ctx.globalAlpha = fade; ctx.fillStyle = '#fbe6cf'; ctx.beginPath(); ctx.arc(cx - 7, F.y + F.h / 2, r, 0, TAU); ctx.fill();
    });
    ctx.restore();
    put(ctx, this.input, F.x, F.y);
    put(ctx, this.mirror, -2000, 0);
    // the line under the field: light, and green once it is long enough
    const ok = v.length >= this.min, focused = this.shadowRoot.activeElement === this.input;
    ctx.fillStyle = ok ? '#b8f5c6' : '#fbe6cf'; ctx.fillRect(F.x, F.y + F.h + 4, F.w, focused ? 3.5 : 2.5);
    if (v.length && !ok) { ctx.fillStyle = '#2a120b'; ctx.fillRect(F.x, F.y + F.h + 4, F.w * v.length / this.min, focused ? 3.5 : 2.5); }
    put(ctx, this.hint, F.x, F.y + F.h + 20);
    // the eye: closed, with lashes, opening into an eye with a pupil
    const ex = F.x + F.w - 22, ey = F.y + F.h / 2, o = clamp(this.lid.x);
    ctx.save(); ctx.strokeStyle = '#fbe6cf'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ex - 12, ey); ctx.quadraticCurveTo(ex, ey + 9, ex + 12, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex - 12, ey); ctx.quadraticCurveTo(ex, ey + 9 - 20 * o, ex + 12, ey); ctx.stroke();
    if (o > 0.4) { ctx.fillStyle = '#fbe6cf'; ctx.beginPath(); ctx.arc(ex, ey - 1, 3.5 * o, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1 - o;
    for (const a of [-0.9, -0.3, 0.3, 0.9]) { ctx.beginPath(); ctx.moveTo(ex + a * 9, ey + 6 - Math.abs(a)); ctx.lineTo(ex + a * 13, ey + 11); ctx.stroke(); }
    ctx.restore();
    if (fv(this, this.eye)) ring(ctx, ex - 20, ey - 20, 40, 40, 20, '#fbe6cf');
    hit(ctx, this.eye, ex - 22, ey - 22, 44, 44);
    return moving;
  }
  // #endregion password-reveal
}
customElements.define('password-reveal', PasswordReveal);

// ---------------------------------------------------------------------------------------------------------
// Newsletter topics: a checkbox a row. A chosen row is drawn from an italic copy, with a red dot
// ---------------------------------------------------------------------------------------------------------

export class TopicList extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static TOP = 46; static ROW = 44;
  static css = `
    h3 { width: 316px; margin: 0; padding-bottom: 7px; border-bottom: 2px solid #7d7d7d; color: #bdbdbd; font: 500 8px/1 ${MONO}; letter-spacing: 0.16em; }
    ol { width: 316px; margin: 0; padding: 0; list-style: none; }
    li { position: relative; border-bottom: 1px solid #3a3a3a; }
    label { display: flex; align-items: center; height: 43px; color: #8c8c8c; font: 400 26px/1 ${SERIF}; cursor: pointer; }
    label span { flex: 1; } label small { margin-right: 34px; font: 500 7.5px/1 ${MONO}; letter-spacing: 0.14em; }
    input { position: absolute; right: 0; width: 26px; height: 26px; margin: 0; opacity: 0; }
    .italic label { color: #f4f1ea; font-style: italic; }
    .italic small { color: #bdbdbd; font-style: normal; }`;

  ready() {
    this.build();
  }

  // #region topic-list
  build() {
    const box = this.canvas ?? this.$('.plain'), name = this.getAttribute('name') ?? 'topic';
    this.topics = options(this);
    const rows = (inputs) => this.topics.map((o) => `<li><label><span>${esc(o.label)}</span><small>${esc((o.data.cadence ?? '').toUpperCase())}</small>${inputs ? `<input type="checkbox" name="${esc(name)}" value="${esc(o.value)}" ${o.selected ? 'checked' : ''}>` : ''}</label></li>`).join('');
    this.head = node(`<h3>${esc((this.getAttribute('label') ?? 'Your newsletters').toUpperCase())}</h3>`);
    this.list = node(`<ol aria-label="${esc(this.getAttribute('label') ?? 'Your newsletters')}">${rows(true)}</ol>`);
    // The same rows, in italic and white. Inert and hidden: each chosen row is drawn from this copy.
    this.italic = node(`<ol class="italic" inert aria-hidden="true">${rows(false)}</ol>`);
    this.boxes = [...this.list.querySelectorAll('input')];
    this.mix = this.boxes.map((b) => ({ x: b.checked ? 1 : 0, v: 0 }));
    box.replaceChildren(this.head, this.list, this.italic);
    this.list.addEventListener('change', () => this.sync());
    this.addEventListener('feed-plain', () => { this.italic.hidden = true; });
    this.sync();
  }
  sync() {
    const fd = new FormData(), name = this.getAttribute('name') ?? 'topic';
    for (const b of this.boxes) if (b.checked) fd.append(name, b.value);
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h) {
    const { TOP, ROW } = TopicList, x0 = 22;
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.head, x0, 18);
    let moving = false;
    this.boxes.forEach((b, i) => {
      moving = spring(this.mix[i], b.checked ? 1 : 0, this.dt, 240, 22) || moving;
      const t = clamp(this.mix[i].x), y = TOP + i * ROW, li = b.closest('li');
      // the plain row and the italic row, crossfaded, each a slice of its own list
      for (const [list, a] of [[this.list, 1 - t], [this.italic, t]]) {
        if (a < 0.01) continue;
        ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.rect(0, y, w, ROW); ctx.clip();
        put(ctx, list, x0 + (list === this.italic ? lerp(-6, 0, t) : 0), y - li.offsetTop, list.offsetWidth, list.offsetHeight);
        ctx.restore();
      }
      // the dot: a ring, filled red from the middle as it is chosen
      const cx = x0 + 316 - 12, cy = y + ROW / 2;
      ctx.strokeStyle = t > 0.5 ? '#e8442f' : '#6d6d6d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.stroke();
      if (t > 0.01) { ctx.fillStyle = '#e8442f'; ctx.beginPath(); ctx.arc(cx, cy, 5 * Math.max(0, this.mix[i].x), 0, TAU); ctx.fill(); }
      if (fv(this, b)) ring(ctx, x0 - 6, y + 2, 328, ROW - 4, 6, '#f4f1ea');
    });
    // the list's hit region where it is laid out, so a tap on any row toggles its checkbox
    hit(ctx, this.list, x0, TOP);
    hit(ctx, this.italic, -2000, 0);
    const n = this.boxes.filter((b) => b.checked).length;
    ctx.fillStyle = '#8c8c8c'; ctx.font = `500 8px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(`${n} OF ${this.boxes.length}`, x0 + 316, 18 + 8); ctx.textAlign = 'left';
    return moving;
  }
  // #endregion topic-list
}
customElements.define('topic-list', TopicList);
