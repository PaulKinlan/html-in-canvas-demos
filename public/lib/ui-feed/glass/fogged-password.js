// <fogged-password>: a password field under condensation that you wipe away with a finger.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, lerp, rr, TAU } from '../kit.js';

// A plain 2D canvas for each control to copy into. Never drawable, never willReadFrequently.
const copies = new WeakMap();
function copyOf(control, w, h) {
  let c = copies.get(control);
  if (!c) copies.set(control, c = document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
// Copy a rectangle of the control's own canvas (CSS px) into that plain canvas.
function behind(control, x, y, w, h) {
  const px = control.px;
  const sx = Math.round(x * px), sy = Math.round(y * px), sw = Math.max(1, Math.round(w * px)), sh = Math.max(1, Math.round(h * px));
  const c = copyOf(control, sw, sh);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(control.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return { canvas: c, copy: { sx: 0, sy: 0, sw, sh, x, y, width: w, height: h } };
}

// #region fogged-password
export class FoggedPassword extends FeedControl {
  static size = [360, 300];
  static LIFE = 4200;             // how long a wipe stays clear, in milliseconds
  // The mirror is the same text with no dots. It is read only and out of the tab order: the password
  // input is the control. Both are in the canvas, and the mirror is drawn only inside the wiped part.
  static html = `<label for="p"></label><input type="password" id="p" autocomplete="off" spellcheck="false">
    <input type="text" class="mirror" tabindex="-1" aria-hidden="true" readonly spellcheck="false">
    <button type="button" class="eye" aria-pressed="false" aria-label="Show the password"></button>`;
  static css = `
    label { color: #24323c; font: 500 17px system-ui, sans-serif; }
    input { width: 300px; height: 92px; padding: 0 18px; border: 0; outline: 0; background: transparent;
      color: #16222b; caret-color: #16222b; font: 23px/92px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 1px; }
    /* A finger on the pane wipes the fog. Without this the browser takes the drag as a page scroll after a few
       pixels and sends pointercancel, so the wipe stops under the finger. The rest of the card still scrolls. */
    input { touch-action: none; }
    input::selection { background: #16222b; color: #e8f1f5; }
    .eye { width: 44px; height: 44px; margin: 0; padding: 0; border: 1px solid #b9c7ce; border-radius: 10px; background: #fff; outline: 0; touch-action: manipulation; }
    .eye:focus-visible { border-color: #16222b; box-shadow: inset 0 0 0 2px #16222b; }`;

  ready() {
    this.input = this.$('#p'); this.mirror = this.$('.mirror'); this.eye = this.$('.eye'); this.label = this.$('label');
    this.label.textContent = this.getAttribute('label') ?? 'Password';
    this.input.placeholder = this.getAttribute('placeholder') ?? '';
    this.input.value = this.getAttribute('value') ?? '';
    this.wipes = [];                                   // { x, y, r, t } in design units
    this.last = null;
    this.sync();
    this.input.addEventListener('input', () => { this.sync(); this.dispatchEvent(new Event('input', { bubbles: true })); });
    this.eye.addEventListener('click', () => {
      const on = this.eye.getAttribute('aria-pressed') === 'false';
      this.eye.setAttribute('aria-pressed', String(on));
      this.input.type = on ? 'text' : 'password';
      this.request();
    });
    // The fog is wiped by dragging anywhere over the pane. The password input is under it and still
    // takes taps, focus and typing.
    const pane = { x: 20, y: 76, w: 320, h: 140 };
    const put_ = (e) => {
      const r = this.canvas.getBoundingClientRect(), k = this.constructor.size[0] / r.width;
      const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
      if (x < pane.x || x > pane.x + pane.w || y < pane.y || y > pane.y + pane.h) return;
      const now = performance.now();
      if (this.last) { const d = Math.hypot(x - this.last.x, y - this.last.y); for (let i = 18; i < d; i += 18) this.wipes.push({ x: lerp(this.last.x, x, i / d), y: lerp(this.last.y, y, i / d), r: 26, t: now }); }
      this.wipes.push({ x, y, r: 26, t: now });
      this.last = { x, y };
      if (this.wipes.length > 400) this.wipes.splice(0, this.wipes.length - 400);
      this.request();
    };
    this.canvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') put_(e); });
    this.canvas.addEventListener('pointerdown', put_);
    this.canvas.addEventListener('pointerup', () => { this.last = null; });
    this.canvas.addEventListener('pointerleave', () => { this.last = null; });
    this.canvas.addEventListener('pointercancel', () => { this.last = null; });
  }
  get value() { return this.input.value; }
  set value(v) { this.input.value = v; this.sync(); }
  sync() {
    this.mirror.value = this.input.value;
    this.setValue(this.input.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.fillStyle = '#f7fafb';
    ctx.fillRect(0, 0, w, h);
    put(ctx, this.label, 20, 20);
    put(ctx, this.eye, w - 64, 12);
    const pane = { x: 20, y: 76, w: 320, h: 140 };
    // What is behind the glass: the field, drawn once.
    ctx.save();
    rr(ctx, pane.x, pane.y, pane.w, pane.h, 16);
    ctx.clip();
    ctx.fillStyle = '#eaf1f4';
    ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
    put(ctx, this.input, pane.x + 10, pane.y + 24);
    ctx.restore();

    const src = behind(this, pane.x, pane.y, pane.w, pane.h);
    // A wipe lasts LIFE milliseconds. The fog comes back from the rim of each wiped disc inwards, the way
    // breath closes over a wiped window: the clear middle shrinks while the soft edge widens.
    const LIFE = FoggedPassword.LIFE;
    const live = [];
    for (const p of this.wipes) { const age = (now - p.t) / LIFE; if (age < 1) live.push([p, age]); }
    const fading = live.length > 0;

    // The clear text, under the fog, only where the glass has been wiped. It is drawn over the field, so
    // the dots of the password are not seen through it.
    if (fading) {
      ctx.save();
      rr(ctx, pane.x, pane.y, pane.w, pane.h, 16); ctx.clip();
      ctx.beginPath();
      for (const [p, age] of live) { const r = p.r * (1 - 0.5 * age); ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, TAU); }
      ctx.clip();
      ctx.fillStyle = '#eaf1f4';
      ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
      put(ctx, this.mirror, pane.x + 10, pane.y + 24);
      ctx.restore();
    }

    // The fog is made on a plain canvas of its own and laid over the pane. Cutting the wipes out of the
    // control's canvas itself (destination-out) also cut out the field under the fog, so each wipe was a
    // hole through to the page: black on a dark page.
    const px = this.px, fog = this.fog || (this.fog = document.createElement('canvas'));
    if (fog.width !== src.canvas.width || fog.height !== src.canvas.height) { fog.width = src.canvas.width; fog.height = src.canvas.height; }
    const g = fog.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, fog.width, fog.height);
    g.filter = `blur(${Math.round(9 * px)}px) brightness(1.06)`;
    g.drawImage(src.canvas, -6 * px, -6 * px, fog.width + 12 * px, fog.height + 12 * px);
    g.filter = 'none';
    g.setTransform(px, 0, 0, px, -pane.x * px, -pane.y * px);     // the control's own units from here
    const haze = g.createLinearGradient(pane.x, pane.y, pane.x + pane.w * 0.7, pane.y + pane.h);
    haze.addColorStop(0, 'rgba(255,255,255,0.86)'); haze.addColorStop(0.55, 'rgba(236,243,246,0.8)'); haze.addColorStop(1, 'rgba(206,219,226,0.78)');
    g.fillStyle = haze;
    g.fillRect(pane.x, pane.y, pane.w, pane.h);
    g.globalCompositeOperation = 'destination-out';
    for (const [p, age] of live) {
      const core = Math.max(0, 0.72 * (1 - age * 1.25)), a = 1 - age * age * age;
      const rad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      rad.addColorStop(0, `rgba(0,0,0,${a})`); rad.addColorStop(core, `rgba(0,0,0,${a})`);
      rad.addColorStop(core + (1 - core) * 0.55, `rgba(0,0,0,${a * 0.28})`); rad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rad;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
    }
    ctx.save();
    rr(ctx, pane.x, pane.y, pane.w, pane.h, 16); ctx.clip();
    ctx.drawImage(fog, pane.x, pane.y, pane.w, pane.h);
    ctx.restore();
    // the eye on the button, which has no content of its own
    {
      const ex = w - 64 + 22, ey = 12 + 22, shown = this.eye.getAttribute('aria-pressed') === 'true';
      ctx.save();
      ctx.strokeStyle = '#24323c'; ctx.fillStyle = '#24323c'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - 11, ey); ctx.quadraticCurveTo(ex, ey - 9, ex + 11, ey); ctx.quadraticCurveTo(ex, ey + 9, ex - 11, ey); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, TAU); ctx.fill();
      if (!shown) { ctx.beginPath(); ctx.moveTo(ex - 9, ey + 9); ctx.lineTo(ex + 9, ey - 9); ctx.stroke(); }
      ctx.restore();
    }
    // The hit region of the password input covers the whole pane.
    hit(ctx, this.input, pane.x, pane.y, pane.w, pane.h);
    if (this.input.matches(':focus-visible')) { ctx.strokeStyle = '#16222b'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); rr(ctx, pane.x + 3, pane.y + 3, pane.w - 6, pane.h - 6, 13); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#6b7f8a';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(this.wipes.length ? 'Keep wiping to read it' : 'Wipe the glass with a finger', 22, 244);
    ctx.fillText(`${this.input.value.length} characters`, 22, 266);
    return fading;
  }
}
customElements.define('fogged-password', FoggedPassword);
// #endregion fogged-password
