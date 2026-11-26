// <hob-lock>: two switches on a kitchen worktop under a hob whose keys live in a lockable <fieldset>.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, lerp, rr, spring, TAU, seg7Text } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

const NAVY = '#1d3a8a';

export class HobLock extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static HOLD = 3;
  static css = `
    .lock, .again { width: 336px; display: grid; grid-template-columns: 1fr auto; align-items: center; color: ${NAVY}; }
    .lock b { font: 700 34px/1 ${SANS}; letter-spacing: -0.02em; }
    .lock p, .again small { grid-column: 1 / -1; margin: 10px 0 0; font: 400 9.5px/1.5 ${SANS}; color: #2a2a2a; }
    .again b { display: block; font: 600 14px/1.2 ${SANS}; } .again small { display: block; margin: 2px 0 0; }
    input[role=switch] { margin: 0; opacity: 0; cursor: pointer; }
    .lock input { width: 112px; height: 60px; } .again input { width: 52px; height: 30px; }
    fieldset { width: 336px; height: 36px; margin: 0; padding: 0; border: 0; display: flex; align-items: center; gap: 0; }
    fieldset button, fieldset label { width: 34px; height: 36px; padding: 0; border: 0; background: transparent; color: transparent; font-size: 1px; cursor: pointer; }
    fieldset label input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    fieldset .zones { display: flex; margin: 0 46px 0 30px; } fieldset .zones label { width: 38px; }
    button.key { touch-action: none; }`;

  ready() {
    this.knob = { x: 1, v: 0 }; this.knob2 = { x: 1, v: 0 }; this.held = 0;
    this.levels = [0, 0, 0, 0];
    this.build();
  }

  // #region hob-lock
  build() {
    const box = this.canvas ?? this.$('.plain'), on = this.hasAttribute('locked'), again = !this.hasAttribute('no-relock');
    this.lockRow = node(`<label class="lock"><b>Child lock</b><input type="checkbox" role="switch" ${on ? 'checked' : ''} aria-describedby="why"><p id="why"></p></label>`);
    this.againRow = node(`<label class="again"><span><b>Lock again after cooking</b><small>10 minutes after the last zone goes off</small></span><input type="checkbox" role="switch" ${again ? 'checked' : ''}></label>`);
    this.sw = this.lockRow.querySelector('input'); this.sw2 = this.againRow.querySelector('input');
    // The hob's own keys. A disabled fieldset disables all of them at once while the lock is on, except the
    // lock key, which is outside it: hold it for three seconds to unlock.
    this.keys = node(`<div class="keys"><fieldset aria-label="Hob"><button type="button" class="power" aria-label="Power">P</button><span class="zones" role="radiogroup" aria-label="Zone">${[1, 2, 3, 4].map((n) => `<label><input type="radio" name="zone" value="${n}" ${n === 1 ? 'checked' : ''}>Zone ${n}</label>`).join('')}</span><button type="button" class="down" aria-label="Lower">−</button><button type="button" class="up" aria-label="Higher">+</button></fieldset></div>`);
    this.key = node('<button type="button" class="key" aria-label="Lock key: hold for 3 seconds to unlock">Lock key</button>');
    this.fs = this.keys.querySelector('fieldset');
    box.replaceChildren(this.keys, this.key, this.lockRow, this.againRow);
    this.sw.addEventListener('change', () => this.sync());
    this.sw2.addEventListener('change', () => this.sync());
    const zone = () => +this.fs.querySelector('input:checked').value - 1;
    this.fs.querySelector('.up').addEventListener('click', () => { this.levels[zone()] = Math.min(9, this.levels[zone()] + 1); this.sync(); });
    this.fs.querySelector('.down').addEventListener('click', () => { this.levels[zone()] = Math.max(0, this.levels[zone()] - 1); this.sync(); });
    this.fs.querySelector('.power').addEventListener('click', () => { this.levels = [0, 0, 0, 0]; this.sync(); });
    this.fs.addEventListener('change', () => this.request());
    // Holding the lock key: pointer or Space and Enter. It counts while held, and toggles at three seconds.
    const start = (e) => { if (e.type === 'keydown' && (e.repeat || (e.key !== ' ' && e.key !== 'Enter'))) return; e.preventDefault(); try { this.key.setPointerCapture(e.pointerId); } catch {} this.holding = performance.now(); this.request(); };
    const stop = () => { this.holding = 0; this.request(); };
    this.key.addEventListener('pointerdown', start); this.key.addEventListener('keydown', start);
    for (const t of ['pointerup', 'pointercancel', 'keyup', 'blur']) this.key.addEventListener(t, stop);
    this.key.addEventListener('click', (e) => e.preventDefault());
    this.knob.x = this.sw.checked ? 1 : 0; this.knob2.x = this.sw2.checked ? 1 : 0;
    this.sync();
  }
  sync() {
    const on = this.sw.checked;
    this.fs.disabled = on;
    this.lockRow.querySelector('p').textContent = on ? 'Hob controls and oven door are locked. Hold the lock key on the hob for 3 seconds to unlock.' : 'Anyone can switch the hob on.';
    const fd = new FormData(), name = this.getAttribute('name') ?? 'hob';
    if (on) fd.append(name, 'locked');
    if (this.sw2.checked) fd.append(name, 'relock');
    this.levels.forEach((l, i) => { if (l) fd.append(`zone${i + 1}`, l); });
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h, now) {
    const on = this.sw.checked;
    let moving = spring(this.knob, on ? 1 : 0, this.dt, 300, 22);
    moving = spring(this.knob2, this.sw2.checked ? 1 : 0, this.dt, 300, 22) || moving;
    // the glass of the hob, with a pot on the first zone and the light from a window across it
    ctx.drawImage(cached(this, 'hob', 360, 150, hobGlass), 0, 0, 360, 150);
    const heat = this.levels[0] / 9;
    if (heat) { const g = ctx.createRadialGradient(80, 40, 40, 80, 40, 110); g.addColorStop(0, `rgba(255,70,20,${0.45 * heat})`); g.addColorStop(1, 'rgba(255,40,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 360, 150); }
    ctx.drawImage(cached(this, 'pot', 160, 110, pot), 0, -14, 160, 110);
    // the keys: a power symbol, the lock key, four zone digits, minus and plus
    const lit = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)', ky = 128;
    put(ctx, this.keys, 12, ky - 18); hit(ctx, this.keys, 12, ky - 18);
    ctx.strokeStyle = lit; ctx.fillStyle = lit; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(29, ky, 6, -1.1, 4.25); ctx.stroke(); ctx.fillRect(28.3, ky - 9, 1.4, 7);
    const sel = +this.fs.querySelector('input:checked').value - 1;
    for (let i = 0; i < 4; i++) {
      const x = 90 + i * 38;
      seg7Text(ctx, String(this.levels[i]), x, ky - 9, 10, 18, on ? 'rgba(255,255,255,0.2)' : this.levels[i] ? '#ff5a2a' : '#fff', '');
      if (!on && i === sel) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 5, ky + 15, 1.6, 0, TAU); ctx.fill(); }
      const zf = this.fs.querySelectorAll('.zones input')[i];
      if (this.shadowRoot.activeElement === zf) { ctx.save(); ctx.strokeStyle = '#8fb3ff'; ctx.setLineDash([2, 2]); ctx.strokeRect(x - 6, ky - 14, 22, 30); ctx.restore(); }
    }
    ctx.strokeStyle = lit; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(286, ky); ctx.lineTo(296, ky); ctx.moveTo(320, ky); ctx.lineTo(330, ky); ctx.moveTo(325, ky - 5); ctx.lineTo(325, ky + 5); ctx.stroke();
    // the lock key, lit blue while locked, with a ring that fills while it is held
    const held = this.holding ? (now - this.holding) / 1000 / HobLock.HOLD : 0;
    if (held >= 1) { this.holding = 0; this.sw.checked = !this.sw.checked; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }
    const kx = 52, kc = on ? '#5b8cff' : 'rgba(255,255,255,0.9)';
    padlock(ctx, kx, ky, 0.85, kc, on ? 0 : 1);
    if (on) { ctx.save(); ctx.shadowColor = '#5b8cff'; ctx.shadowBlur = 8; padlock(ctx, kx, ky, 0.85, kc, 0); ctx.restore(); }
    if (held > 0) { ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(kx, ky, 13, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, held)); ctx.stroke(); moving = true; }
    if (this.shadowRoot.activeElement === this.key) { ctx.save(); ctx.strokeStyle = '#8fb3ff'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(kx, ky, 16, 0, TAU); ctx.stroke(); ctx.restore(); }
    hit(ctx, this.key, kx - 17, ky - 17, 34, 34);
    // the worktop, with sunlight through the window across it
    ctx.drawImage(cached(this, 'wood', 360, 210, wood), 0, 150, 360, 210);
    put(ctx, this.lockRow, 12, 178);
    toggle(ctx, 236, 172, 112, 60, this.knob.x, true, this.shadowRoot.activeElement === this.sw);
    hit(ctx, this.sw, 236, 172, 112, 60);
    put(ctx, this.againRow, 12, 304);
    toggle(ctx, 296, 304, 52, 30, this.knob2.x, false, this.shadowRoot.activeElement === this.sw2);
    hit(ctx, this.sw2, 296, 304, 52, 30);
    return moving;
  }
  // #endregion hob-lock
}
customElements.define('hob-lock', HobLock);

function padlock(ctx, x, y, s, colour, open) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(0, -3 - open * 2, 4.5, Math.PI, open ? Math.PI * 1.85 : TAU); if (!open) ctx.lineTo(4.5, -1); ctx.moveTo(-4.5, -3 - open * 2); ctx.lineTo(-4.5, -1); ctx.stroke();
  rr(ctx, -7, -1, 14, 11, 2); ctx.fill();
  ctx.restore();
}
// A switch: the track, and a white knob with a padlock on the big one.
function toggle(ctx, x, y, w, h, t, lock, focused) {
  const on = t > 0.5, r = h / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(60,30,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  const tr = ctx.createLinearGradient(0, y, 0, y + h);
  tr.addColorStop(0, `rgb(${lerp(196, 23, t)},${lerp(205, 52, t)},${lerp(222, 140, t)})`); tr.addColorStop(1, `rgb(${lerp(214, 36, t)},${lerp(222, 72, t)},${lerp(236, 170, t)})`);
  ctx.fillStyle = tr; rr(ctx, x, y, w, h, r); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
  const kx = x + r + (w - h) * t, ky = y + r, kr = r - 4;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  const kg = ctx.createRadialGradient(kx - kr * 0.3, ky - kr * 0.4, 2, kx, ky, kr); kg.addColorStop(0, '#ffffff'); kg.addColorStop(1, '#dfe3ea');
  ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, kr, 0, TAU); ctx.fill();
  ctx.restore();
  if (lock) { ctx.save(); ctx.strokeStyle = 'rgba(60,70,90,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(kx, ky, kr - 6, 0, TAU); ctx.stroke(); ctx.restore(); padlock(ctx, kx, ky, 1, NAVY, on ? 0 : 1); }
  if (focused) { ctx.save(); ctx.strokeStyle = NAVY; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x - 4, y - 4, w + 8, h + 8, r + 4); ctx.stroke(); ctx.restore(); }
}
function hobGlass(g) {
  const b = g.createLinearGradient(0, 0, 0, 150); b.addColorStop(0, '#16181c'); b.addColorStop(1, '#050608'); g.fillStyle = b; g.fillRect(0, 0, 360, 150);
  // the window's light, two soft bands across the glass
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [x, a] of [[40, 0.07], [96, 0.05]]) { g.fillStyle = `rgba(160,180,210,${a})`; g.beginPath(); g.moveTo(x, 150); g.lineTo(x + 40, 150); g.lineTo(x + 140, 0); g.lineTo(x + 100, 0); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.beginPath(); g.arc(80, 40, 64, 0, TAU); g.stroke();
}
function pot(g) {
  const body = g.createRadialGradient(70, 30, 10, 80, 50, 92); body.addColorStop(0, '#5f86c9'); body.addColorStop(0.55, '#2f5aa5'); body.addColorStop(1, '#16305f');
  g.fillStyle = body; g.beginPath(); g.ellipse(80, 50, 74, 60, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.ellipse(80, 50, 58, 46, 0, 0, TAU); g.stroke();
  g.fillStyle = '#1b2f57'; g.beginPath(); g.ellipse(80, 50, 15, 12, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(58, 24, 18, 6, -0.5, 0, TAU); g.fill();
  g.fillStyle = '#244a8c'; rr(g, 136, 44, 22, 14, 6); g.fill(); rr(g, 2, 44, 22, 14, 6); g.fill();
}
function wood(g) {
  g.fillStyle = '#c99a63'; g.fillRect(0, 0, 360, 210);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rnd(i) > 0.5 ? '120,70,30' : '235,190,130'},${0.12 + rnd(i + 1) * 0.15})`; g.lineWidth = 0.6 + rnd(i + 2) * 1.6; const y = rnd(i + 3) * 210; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(120, y + (rnd(i + 4) - 0.5) * 14, 240, y + (rnd(i + 5) - 0.5) * 14, 360, y + (rnd(i + 6) - 0.5) * 10); g.stroke(); }
  // sun through the window: bright diagonal bands with soft edges
  for (const [x, wd] of [[-60, 70], [60, 40], [150, 80]]) { const s = g.createLinearGradient(x, 0, x + wd + 90, 0); s.addColorStop(0, 'rgba(255,240,200,0)'); s.addColorStop(0.5, 'rgba(255,236,190,0.28)'); s.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = s; g.beginPath(); g.moveTo(x, 210); g.lineTo(x + wd, 210); g.lineTo(x + wd + 90, 0); g.lineTo(x + 90, 0); g.fill(); }
  const top = g.createLinearGradient(0, 0, 0, 10); top.addColorStop(0, 'rgba(0,0,0,0.35)'); top.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = top; g.fillRect(0, 0, 360, 10);
}
