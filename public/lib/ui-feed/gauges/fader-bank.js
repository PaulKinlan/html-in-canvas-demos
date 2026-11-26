// <fader-bank>: one <input type="range"> for each <option>, drawn as the faders of a mixing desk.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, options, clamp, lerp, rr } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const HAND = "'Bradley Hand', 'Segoe Print', 'Chalkboard SE', 'Comic Sans MS', cursive";
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";
const MINUS = '−';

// A pointer position in the control's design units.
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };

// #region grip
// A native range sits under a drawn handle. The handle moves on a path the range knows nothing about, so the
// control captures the pointer and works out the position itself. While the handle is held the range's own
// `input` events are ignored (a range under a finger keeps answering the drag). The keyboard still moves it.
function grip(el, on) {
  let id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    id = e.pointerId; try { el.setPointerCapture(id); } catch {}      // a pointer made in script cannot be captured
    e.preventDefault(); el.focus({ preventScroll: true });
    on.down?.(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) on.move?.(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; on.up?.(e); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return () => id !== null;
}
// #endregion grip

// #region fader-bank
// One range for each <option>. A fader's travel is not linear in decibels: the scale is spread out round
// 0 dB and squeezed toward silence, so the range holds the position of the cap (0 to 1000) and the control
// converts it to decibels through the marks printed beside the slot.
const MARKS = [[10, 0], [5, 0.11], [0, 0.21], [-5, 0.31], [-10, 0.41], [-20, 0.54], [-30, 0.67], [-40, 0.8], [-60, 0.92], [-90, 1]];
export const faderDb = (t) => {
  if (t >= 0.995) return -Infinity;
  for (let i = 1; i < MARKS.length; i++) if (t <= MARKS[i][1]) return lerp(MARKS[i - 1][0], MARKS[i][0], (t - MARKS[i - 1][1]) / (MARKS[i][1] - MARKS[i - 1][1]));
  return -Infinity;
};
export const faderAt = (db) => {
  if (!(db > -90)) return 1;
  if (db >= 10) return 0;
  for (let i = 1; i < MARKS.length; i++) if (db >= MARKS[i][0]) return lerp(MARKS[i - 1][1], MARKS[i][1], (MARKS[i - 1][0] - db) / (MARKS[i - 1][0] - MARKS[i][0]));
  return 1;
};
const dbText = (db) => (db === -Infinity ? `${MINUS}∞` : `${db < -0.04 ? MINUS : db > 0.04 ? '+' : ''}${Math.abs(db).toFixed(1)}`);

export class FaderBank extends FeedControl {
  static size = [360, 384];
  static css = `
    input { width: 60px; height: 44px; opacity: 0; margin: 0; touch-action: none; }
    label { box-sizing: border-box; width: 78px; height: 24px; padding: 0 6px; background: linear-gradient(#efe3bd, #e3d4a4); color: #1c2a6b;
      font: italic 600 15px/24px ${HAND}; text-align: center; white-space: nowrap; overflow: hidden; }
    output { box-sizing: border-box; width: 72px; height: 26px; background: #120505; border: 1px solid #000; border-radius: 2px; color: #ff3a2c;
      font: 600 16px/24px ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing: 0.12em; text-align: center; text-shadow: 0 0 6px #ff2a1c; }`;
  static TOP = 112; static BOT = 352;

  ready() {
    this.canvas.setAttribute('role', 'group');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  build() {
    for (const el of this.$$('input, label, output')) el.remove();
    const make = (tag, props) => { const el = Object.assign(document.createElement(tag), props); el.setAttribute('drawable', ''); this.canvas.append(el); return el; };
    this.channels = options(this).map((o, i) => {
      const ch = { name: o.label, key: o.data.name ?? o.label.toLowerCase().replace(/\W+/g, '-'), t: faderAt(Number(o.value)) };
      ch.label = make('label', { htmlFor: `f${i}`, textContent: o.label });
      ch.out = make('output', { htmlFor: `f${i}` });
      ch.range = make('input', { type: 'range', id: `f${i}`, min: 0, max: 1000, step: 10, ariaLabel: `${o.label} level` });
      let off = 0;
      ch.held = grip(ch.range, {
        down: (e) => { off = point(this, e).y - this.capY(ch); this.sync(); },
        move: (e) => {
          const { TOP, BOT } = FaderBank;
          let t = clamp((point(this, e).y - off - TOP) / (BOT - TOP));
          if (Math.abs(t - MARKS[2][1]) < 0.012) t = MARKS[2][1];       // the detent at 0 dB
          ch.t = t; this.sync(true);
        },
        up: () => { this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); },
      });
      ch.range.addEventListener('input', () => { if (!ch.held()) { ch.t = 1 - ch.range.valueAsNumber / 1000; this.sync(true); } });
      ch.range.addEventListener('dblclick', () => { ch.t = MARKS[2][1]; this.sync(true); });
      return ch;
    });
    this.sync();
  }
  capY(ch) { return lerp(FaderBank.TOP, FaderBank.BOT, ch.t); }
  // The level of one channel in decibels, by its name or its place.
  level(which) { const ch = typeof which === 'number' ? this.channels[which] : this.channels.find((c) => c.key === which || c.name === which); return ch ? faderDb(ch.t) : undefined; }
  get value() { return this.channels.map((ch) => `${ch.key}=${Number.isFinite(faderDb(ch.t)) ? faderDb(ch.t).toFixed(1) : '-inf'}`).join(' '); }
  sync(input = false) {
    const data = new FormData(), base = this.getAttribute('name');
    for (const ch of this.channels) {
      const db = faderDb(ch.t), text = dbText(db);
      if (!ch.held()) ch.range.value = Math.round((1 - ch.t) * 1000);
      ch.range.setAttribute('aria-valuetext', `${text} dB`);
      if (ch.out.textContent !== text) ch.out.textContent = text;
      if (base) data.append(`${base}-${ch.key}`, Number.isFinite(db) ? db.toFixed(1) : '-inf');
    }
    this.setValue(base ? data : null);
    if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }

  draw(ctx, w, h) {
    const { TOP, BOT } = FaderBank, n = this.channels.length || 1, sw = w / n;
    ctx.fillStyle = '#0d0d0e'; ctx.fillRect(0, 0, w, h);
    this.channels.forEach((ch, i) => {
      const x0 = i * sw + 3, cx = i * sw + sw / 2 + 8, y = this.capY(ch);
      // the strip: brushed dark metal
      const g = ctx.createLinearGradient(x0, 0, x0 + sw - 6, 0); g.addColorStop(0, '#2b2c2f'); g.addColorStop(0.5, '#232427'); g.addColorStop(1, '#1b1c1e');
      ctx.fillStyle = g; rr(ctx, x0, 4, sw - 6, h - 8, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let x = x0 + 2; x < x0 + sw - 8; x += 2.5) { ctx.moveTo(x, 6); ctx.lineTo(x, h - 6); }
      ctx.stroke();
      // tape, readout
      ctx.save(); ctx.translate(i * sw + sw / 2, 30); ctx.rotate((rnd(i + 3) - 0.5) * 0.09);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-38, -10, 78, 24); put(ctx, ch.label, -39, -12); ctx.restore();
      put(ctx, ch.out, i * sw + sw / 2 - 36, 54);
      // scale
      ctx.fillStyle = '#c9c9c4'; ctx.strokeStyle = '#77787a'; ctx.lineWidth = 0.8; ctx.font = `500 9.5px ${SANS}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      MARKS.forEach(([db, t]) => {
        const ty = lerp(TOP, BOT, t);
        ctx.fillText(db === -90 ? `${MINUS}∞` : db > 0 ? `+${db}` : db < 0 ? `${MINUS}${-db}` : '0', cx - 34, ty);
        ctx.beginPath(); ctx.moveTo(cx - 30, ty); ctx.lineTo(cx - (db === 0 ? 10 : 18), ty); ctx.stroke();
      });
      // slot
      ctx.fillStyle = '#050505'; rr(ctx, cx - 3, TOP - 20, 6, BOT - TOP + 40, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.6; rr(ctx, cx - 3, TOP - 20, 6, BOT - TOP + 40, 3); ctx.stroke();
      // cap: a block of metal with a groove, lit from above, pressed a little when held
      const held = ch.held(), cw = 40, chh = 28;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(ctx, cx - cw / 2 + 2, y - chh / 2 + (held ? 3 : 6), cw, chh, 3); ctx.fill();
      const m = ctx.createLinearGradient(0, y - chh / 2, 0, y + chh / 2);
      for (const [at, c] of [[0, '#f4f4f2'], [0.18, '#c9cac8'], [0.44, '#e9e9e7'], [0.47, '#55575a'], [0.53, '#2c2d2f'], [0.56, '#d8d8d6'], [0.85, '#a9aaa8'], [1, '#6f7072']]) m.addColorStop(at, c);
      ctx.fillStyle = m; rr(ctx, cx - cw / 2, y - chh / 2, cw, chh, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6; rr(ctx, cx - cw / 2, y - chh / 2, cw, chh, 3); ctx.stroke();
      if (ch.range.matches(':focus-visible')) { ctx.strokeStyle = '#7fb4ff'; ctx.lineWidth = 2; rr(ctx, cx - cw / 2 - 4, y - chh / 2 - 4, cw + 8, chh + 8, 5); ctx.stroke(); }
      hit(ctx, ch.range, cx - 30, y - 22, 60, 44);
    });
    return false;
  }
}
customElements.define('fader-bank', FaderBank);
// #endregion fader-bank
