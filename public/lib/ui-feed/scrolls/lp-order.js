// <lp-order>: a <details> for each side of a record whose hatched side bar splits into track bars as it opens.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, esc, clamp, lerp, easeOut } from '../kit.js';
import { Fold, cached } from '../fold.js';

const MONO = "'IBM Plex Mono', 'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const secs = (t) => { const [m, s] = String(t ?? '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

export class LpOrder extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static CHART = { x: 170, w: 176, top: 30, mins: 45 };
  static css = `
    .head { display: flex; width: 336px; height: 20px; color: #333; font: 500 8.5px/20px ${MONO}; }
    .head span:first-child { flex: 1; }
    .head span:last-child { width: 200px; }
    details { width: 336px; color: #333; }
    summary { display: flex; align-items: center; height: 22px; cursor: pointer; list-style: none; font: 500 9px/22px ${MONO}; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '+'; display: inline-grid; place-items: center; width: 9px; height: 9px; margin-right: 5px; border: 1px solid #333; font: 600 9px/1 ${MONO}; }
    details[open] summary::before { content: '\\2212'; }
    summary:focus-visible, li:focus-visible { outline: 1px dashed #5a3fd0; outline-offset: 1px; }
    summary span, li span { flex: 1; }
    summary time, li time { width: 52px; margin-right: 182px; text-align: right; }
    ol { margin: 0; padding: 0 0 0 20px; list-style: none; }
    li { display: flex; height: 22px; font: 400 9px/22px ${MONO}; }`;

  ready() {
    this.build();
  }

  // #region lp-order
  build() {
    const box = this.canvas ?? this.$('.plain');
    // <optgroup label="Side A"> holds an <option data-time> for each track.
    let at = 0;
    this.sides = [...this.querySelectorAll(':scope > optgroup')].map((g) => {
      const tracks = [...g.querySelectorAll('option')].map((o) => { const t = { title: o.textContent.trim(), len: secs(o.dataset.time), time: o.dataset.time, from: at }; at += t.len; return t; });
      return { label: g.label, tracks, from: tracks[0]?.from ?? at, len: tracks.reduce((s, t) => s + t.len, 0) };
    });
    this.head = node('<div class="head" aria-hidden="true"><span>Track</span><span>Min</span></div>');
    this.details = this.sides.map((s) => node(`<details><summary><span>${esc(s.label)}</span><time>${clock(s.len)}</time></summary><ol>${s.tracks.map((t) => `<li><span>${esc(t.title)}</span><time>${esc(t.time)}</time></li>`).join('')}</ol></details>`));
    // Each details is a child of the canvas itself: drawElementImage() draws only direct children.
    box.replaceChildren(this.head, ...this.details);
    this.folds = this.details.map((d) => new Fold(this, d, 0.5));
    this.details.forEach((d, i) => d.firstElementChild.addEventListener('click', (e) => { if (this.plain) return; e.preventDefault(); this.folds[i].set(!this.folds[i].open); }));
    if (this.hasAttribute('open')) this.folds[0].set(true);
  }

  draw(ctx, w, h) {
    const C = LpOrder.CHART, px = (s) => C.x + (s / 60) * (C.w / C.mins);
    let moving = false;
    ctx.fillStyle = '#e9eee4'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached(this, 'grid', 360, 360, (g) => { g.strokeStyle = 'rgba(90,130,110,0.22)'; g.lineWidth = 0.5; for (let i = 0; i <= 360; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); } }), 0, 0, w, h);
    // the minute axis
    ctx.fillStyle = '#333'; ctx.font = `500 8px ${MONO}`; ctx.textAlign = 'center';
    for (let m = 0; m <= C.mins; m += 5) ctx.fillText(String(m), px(m * 60), 20);
    for (let m = 0; m <= C.mins; m++) ctx.fillRect(px(m * 60) - 0.3, 24, 0.6, m % 5 ? 3 : 5);
    ctx.fillRect(C.x, 28, C.w, 0.8); ctx.textAlign = 'left';
    put(ctx, this.head, 12, 10);
    // The details are laid out one under the other. Each one's rows open over time (Fold), so the sides
    // below move down with the drawn height, not with the layout, which jumps.
    let y = C.top + 6;
    this.details.forEach((d, i) => {
      const f = this.folds[i], wasOpen = d.open; moving = f.step(this.dt) || moving;
      const shut = wasOpen && !d.open, s = this.sides[i], e = f.e, head = 22, full = shut ? this.tall?.[i] ?? head : d.offsetHeight;
      (this.tall ??= [])[i] = full;
      const shown = head + (full - head) * e;
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, shown); ctx.clip();
      put(ctx, d, 12, y, 336, full);
      ctx.restore();
      // the side's bar, hatched, fades as its tracks come out of it
      const sx = px(s.from), sw = px(s.from + s.len) - sx;
      ctx.save(); ctx.globalAlpha = 1 - e * 0.65; hatch(ctx, sx, y + 5, sw, 12, '#3b3b3b', '#f4f6f0'); ctx.restore();
      // each track's bar drops from the side's bar to its own row, one after another
      s.tracks.forEach((t, k) => {
        const p = clamp((e - k * 0.08) / 0.6), ty = lerp(y + 5, y + head + k * 22 + 5, easeOut(p));
        if (e <= 0.001) return;
        ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, shown); ctx.clip();
        hatch(ctx, px(t.from), ty, px(t.from + t.len) - px(t.from), 12, '#5a3fd0', '#c9bff5');
        ctx.restore();
      });
      // the line of the tree
      if (e > 0) { ctx.fillStyle = '#555'; ctx.fillRect(16.5, y + 16, 0.8, (shown - head - 11) * 1); for (let k = 0; k < s.tracks.length; k++) { const ly = y + head + k * 22 + 11; if (ly < y + shown) ctx.fillRect(16.5, ly, 12, 0.8); } }
      y += shown;
    });
    // The hit regions follow the drawing; the last side may be partly drawn while it opens.
    return moving;
  }
  // #endregion lp-order
}
customElements.define('lp-order', LpOrder);

// A bar with diagonal lines across it.
function hatch(ctx, x, y, w, h, ink, ground) {
  ctx.save();
  ctx.fillStyle = ground; ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = ink; ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 3.2) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
