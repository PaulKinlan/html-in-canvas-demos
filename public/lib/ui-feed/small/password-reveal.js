// <password-reveal>: a password input whose dots pop in on a spring, with a show/hide eye button.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, esc, clamp, rr, spring, TAU, reduced } from '../kit.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
// A focus ring is drawn only for keyboard focus, as :focus-visible would show it.
const fv = (ctrl, el) => ctrl.shadowRoot.activeElement === el && el.matches(':focus-visible');
const ring = (ctx, x, y, w, h, r, colour = '#fff') => { ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore(); };

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
