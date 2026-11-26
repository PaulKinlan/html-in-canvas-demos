// <presence-avatar>: an avatar toggle button whose dark fill spreads out of its status badge.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, esc, clamp, lerp, spring, TAU } from '../kit.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
// A focus ring is drawn only for keyboard focus, as :focus-visible would show it.
const fv = (ctrl, el) => ctrl.shadowRoot.activeElement === el && el.matches(':focus-visible');

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
