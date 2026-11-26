// <format-bar>: Bold, Italic and Underline toggle buttons with shortcuts and a spring tooltip.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, esc, clamp, lerp, rr, spring } from '../kit.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const SERIF = "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
// A focus ring is drawn only for keyboard focus, as :focus-visible would show it.
const fv = (ctrl, el) => ctrl.shadowRoot.activeElement === el && el.matches(':focus-visible');
const ring = (ctx, x, y, w, h, r, colour = '#fff') => { ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore(); };

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
