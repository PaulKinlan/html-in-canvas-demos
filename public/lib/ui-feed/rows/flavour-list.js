// <flavour-list>: checkboxes in a <fieldset> with a spring focus bar and ticks drawn stroke by stroke.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, options, esc, clamp, rr, spring } from '../kit.js';

const TEXT = "'Source Serif 4', 'Source Serif Pro', Charter, 'Bitstream Charter', Georgia, 'Liberation Serif', serif";
const NAVY = '#14236a';
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const box = (c) => c.canvas ?? c.$('.plain');
const within = (el, top) => { let x = 0, y = 0; for (let n = el; n && n !== top; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };

export class FlavourList extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static css = `
    fieldset { left: 20px !important; width: 320px; padding: 0; border: 0; margin: 0; color: ${NAVY}; font-family: ${TEXT}; }
    legend { padding: 22px 0 0 15px; height: 53px; box-sizing: border-box; font: italic 400 16px/1 ${TEXT}; }
    label { position: relative; display: flex; align-items: center; height: 47px; padding-left: 15px; font: 400 24px/1 ${TEXT}; cursor: pointer; }
    input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    .dot { width: 19px; height: 19px; margin-right: 13px; border-radius: 50%; background: var(--c); flex: none; }`;

  ready() {
    this.bar = { x: -1, v: 0 }; this.barOn = { x: 0, v: 0 };
    this.build();
  }

  // #region flavour-list
  build() {
    this.name = this.getAttribute('name') ?? 'flavour';
    const opts = options(this);
    this.fs = node(`<fieldset><legend>${esc(this.getAttribute('label') ?? 'Flavours')}</legend>${opts.map((o) => `<label><input type="checkbox" name="${esc(this.name)}" value="${esc(o.value)}"${o.selected ? ' checked' : ''}><span class="dot" style="--c:${esc(o.data.colour ?? '#ccc')}"></span>${esc(o.label)}</label>`).join('')}</fieldset>`);
    this.rows = [...this.fs.querySelectorAll('label')];
    this.boxes = this.rows.map((l) => l.querySelector('input'));
    this.ticks = this.boxes.map((b) => ({ x: b.checked ? 1 : 0, v: 0 }));
    this.focused = -1;
    box(this).replaceChildren(this.fs);
    this.fs.addEventListener('change', () => this.sync());
    // The bar marks the row that has focus. A tap focuses the checkbox, so the bar follows taps as well.
    this.fs.addEventListener('focusin', (e) => { this.focused = this.boxes.indexOf(e.target); this.request(); });
    this.fs.addEventListener('focusout', () => { this.focused = -1; this.request(); });
    this.sync();
  }
  sync() {
    const fd = new FormData();
    for (const b of this.boxes) if (b.checked) fd.append(this.name, b.value);
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h) {
    const fs = this.fs, F = { x: 20, y: 0 };   // where the css puts the fieldset
    let moving = false;
    ctx.fillStyle = '#8fcffe'; ctx.fillRect(0, 0, w, h);
    // the white bar under the focused row, moving on a spring and fading in and out
    const rows = this.rows.map((l) => within(l, fs));
    if (this.focused >= 0) { const want = F.y + rows[this.focused].y; if (this.bar.x < 0 || this.barOn.x < 0.02) this.bar.x = want; moving = spring(this.bar, want, this.dt, 340, 28) || moving; }
    moving = spring(this.barOn, this.focused >= 0 ? 1 : 0, this.dt, 300, 30) || moving;
    if (this.barOn.x > 0.01) {
      ctx.save(); ctx.globalAlpha = clamp(this.barOn.x); ctx.fillStyle = '#fff';
      rr(ctx, F.x - 10, this.bar.x, 340, 47, 10); ctx.fill();
      ctx.restore();
    }
    put(ctx, fs, F.x, F.y);
    // a tick for each checked row, drawn along its path as its spring rises
    this.boxes.forEach((b, i) => {
      moving = spring(this.ticks[i], b.checked ? 1 : 0, this.dt, 220, 26) || moving;
      const t = clamp(this.ticks[i].x);
      if (t < 0.01) return;
      const x = F.x + 280, y = F.y + rows[i].y + 23.5;
      const pts = [[x, y], [x + 6, y + 6], [x + 18, y - 7]], l1 = Math.hypot(6, 6), l2 = Math.hypot(12, 13), len = (l1 + l2) * t;
      ctx.save(); ctx.strokeStyle = NAVY; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...pts[0]);
      if (len <= l1) ctx.lineTo(x + 6 * len / l1, y + 6 * len / l1);
      else { ctx.lineTo(...pts[1]); const k = (len - l1) / l2; ctx.lineTo(x + 6 + 12 * k, y + 6 - 13 * k); }
      ctx.stroke(); ctx.restore();
    });
    return moving;
  }
  // #endregion flavour-list
}
customElements.define('flavour-list', FlavourList);
