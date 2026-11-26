// <speed-list>: playback speed radios in a <fieldset>, with condensed canvas-squeezed numbers and a spring dot.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, hit, options, esc, spring, TAU, reduced } from '../kit.js';

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const LIME = '#d9f45b';
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const box = (c) => c.canvas ?? c.$('.plain');
const within = (el, top) => { let x = 0, y = 0; for (let n = el; n && n !== top; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };

export class SpeedList extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static SQUEEZE = 0.6;          // how much of its width each number keeps
  static css = `
    fieldset { left: 27px !important; width: 306px; padding: 0; border: 0; margin: 0; color: #4c4e47; font-family: ${SANS}; }
    legend { padding: 22px 0 0; height: 43px; box-sizing: border-box; font: 600 10.5px/1 ${SANS}; letter-spacing: 0.12em; text-transform: uppercase; color: #9b9b93; }
    label { position: relative; display: flex; align-items: flex-end; height: 61px; box-sizing: border-box; border-bottom: 1px solid #3a3a36; cursor: pointer; }
    input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    .n { margin-left: 24px; font: 700 66px/61px ${SANS}; letter-spacing: -0.03em; white-space: nowrap; }
    .c { margin-left: auto; padding-bottom: 6px; font: 400 11.5px/1 ${SANS}; color: #9b9b93; }
    label:has(:checked) .n { color: ${LIME}; }
    label:has(:checked) .c { color: #fff; }
    label:hover .n { color: #6a6d63; }
    label:has(:checked):hover .n { color: ${LIME}; }`;

  ready() {
    this.dot = { x: -1, v: 0 };
    this.build();
  }

  // #region speed-list
  build() {
    const name = this.getAttribute('name') ?? 'speed', opts = options(this);
    const chosen = Math.max(0, opts.findIndex((o) => o.selected));
    this.fs = node(`<fieldset><legend>${esc(this.getAttribute('label') ?? 'Playback speed')}</legend>${opts.map((o, i) => `<label><input type="radio" name="${esc(name)}" value="${esc(o.value)}"${i === chosen ? ' checked' : ''}><span class="n">${esc(o.label)}</span><span class="c">${esc(o.data.note ?? '')}</span></label>`).join('')}</fieldset>`);
    this.rows = [...this.fs.querySelectorAll('label')];
    this.radios = this.rows.map((l) => l.querySelector('input'));
    // a spring for each number's height, kicked when it is chosen
    this.pop = this.rows.map(() => ({ x: 1, v: 0 }));
    box(this).replaceChildren(this.fs);
    this.fs.addEventListener('change', () => { const i = this.radios.findIndex((r) => r.checked); this.pop[i].v = reduced() ? 0 : 3.2; this.pick(); });
    this.pick();
  }
  pick() {
    this.chosen = Math.max(0, this.radios.findIndex((r) => r.checked));
    this.setValue(this.radios[this.chosen].value);
    this.request();
  }

  draw(ctx, w, h) {
    const k = SpeedList.SQUEEZE, fs = this.fs, F = { x: 27, y: 0 }, fw = fs.offsetWidth, fh = fs.offsetHeight;
    let moving = false;
    ctx.fillStyle = '#1c1c1a'; ctx.fillRect(0, 0, w, h);
    // Where each number is: a box in the fieldset's picture.
    const nums = this.rows.map((l) => { const n = l.querySelector('.n'), p = within(n, fs); return { ...p, row: within(l, fs) }; });
    // 1. The fieldset with the numbers cut out of it: the legend, the captions and the lines.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h);
    for (const n of nums) ctx.rect(F.x + n.x - 2, F.y + n.row.y, n.w + 4, n.row.h - 1);
    ctx.clip('evenodd');
    put(ctx, fs, F.x, F.y, fw, fh);
    ctx.restore();
    // 2. Each number again, squeezed to `k` of its width about its left edge, and stretched by its spring.
    nums.forEach((n, i) => {
      moving = spring(this.pop[i], 1, this.dt, 260, 14) || moving;
      const sy = this.pop[i].x, X = F.x + n.x, base = F.y + n.y + n.h * 0.86;
      ctx.save();
      ctx.beginPath(); ctx.rect(X - 1, F.y + n.row.y - 2, n.w * k + 4, n.row.h + 1); ctx.clip();
      ctx.translate(X, base); ctx.scale(k, sy); ctx.translate(-X, -base);
      put(ctx, fs, F.x, F.y, fw, fh);
      ctx.restore();
    });
    // The hit regions go back where the fieldset is laid out, so each row takes its own taps.
    hit(ctx, fs, F.x, F.y, fw, fh);
    // 3. The dot, on a spring to the chosen row, and a line under a row that has keyboard focus.
    const c = nums[this.chosen], want = F.y + c.y + c.h * 0.52;
    if (this.dot.x < 0) this.dot.x = want;
    moving = spring(this.dot, want, this.dt, 300, 24) || moving;
    ctx.fillStyle = LIME; ctx.beginPath(); ctx.arc(F.x + 6, this.dot.x, 5, 0, TAU); ctx.fill();
    const f = this.radios.findIndex((r) => r.matches(':focus-visible'));
    if (f >= 0) { const r = nums[f].row; ctx.fillStyle = LIME; ctx.fillRect(F.x, F.y + r.y + r.h - 2, fw, 2); }
    return moving;
  }
  // #endregion speed-list
}
customElements.define('speed-list', SpeedList);
