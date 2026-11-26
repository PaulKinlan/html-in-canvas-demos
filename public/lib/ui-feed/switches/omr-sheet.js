// <omr-sheet>: a checkbox group styled as an OMR answer sheet with animated pencil marks.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, options, esc, clamp, lerp, rr, reduced } from '../kit.js';

// #region omr-sheet
//   <omr-sheet name="shift" columns="Morning Afternoon Evening">
//     <option value="mon" data-checked="Morning">Monday</option> …
//   </omr-sheet>
// A form of checkboxes laid out and styled as an answer sheet, drawn as one picture. The canvas draws
// pencil over each checked box, stroke by stroke, and leaves a smudge where a mark was rubbed out.
export class OmrSheet extends FeedControl {
  static size = [360, 400];
  static html = `<div class="sheet"></div>`;
  static css = `
    .sheet { width: 336px; background: #fff; color: #e2007a; font: 700 14px/1 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; text-transform: uppercase; padding: 10px 0 6px 22px; }
    .head, .row { display: grid; grid-template-columns: 104px repeat(var(--n), 1fr); align-items: center; }
    .head { height: 24px; font-size: 9px; letter-spacing: 1px; text-align: center; }
    .row { height: 50px; padding-left: 8px; font-size: 16px; border-top: 1px solid #e2007a; }
    .row:nth-child(even) { background: #fbe3f0; }
    .row label { justify-self: center; position: relative; width: 60px; height: 44px; display: grid; place-items: center; }
    .row input { appearance: none; width: 52px; height: 24px; margin: 0; border: 1.5px solid #e2007a; border-radius: 12px; background: #fff; outline: none; touch-action: manipulation; }
    .row input:focus-visible { box-shadow: 0 0 0 3px #1a1a1a; }
    .row label span { position: absolute; font-size: 10px; pointer-events: none; }`;

  ready() {
    this.form = this.$('.sheet');
    this.marks = new Map();                                     // input -> { amount, smudge }
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true });
    this.form.addEventListener('change', () => { this.send(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  get value() { return [...this.form.querySelectorAll('input:checked')].map((i) => `${i.name}:${i.value}`); }
  send() {
    const data = new FormData(), name = this.getAttribute('name') || 'sheet';
    for (const v of this.value) data.append(name, v);
    this.setValue(data);
    this.request();
  }
  sync() {
    const cols = (this.getAttribute('columns') || 'Yes').split(/\s+/);
    this.form.style.setProperty('--n', cols.length);
    this.form.innerHTML = `<div class="head"><span></span>${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` +
      options(this).map((o) => `<div class="row"><span>${esc(o.label)}</span>${cols.map((c) => `<label><input type="checkbox" name="${esc(o.value)}" value="${esc(c)}" aria-label="${esc(o.label)}, ${esc(c)}"${(o.data.checked ?? '').split(/\s+/).includes(c) ? ' checked' : ''}><span>${esc(c[0])}</span></label>`).join('')}</div>`).join('');
    this.marks.clear();
    for (const i of this.form.querySelectorAll('input')) this.marks.set(i, { amount: i.checked ? 1 : 0, smudge: 0 });
    this.send();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#e9e4da'; ctx.fillRect(0, 0, w, h);
    const fx = 12, fy = 8;
    ctx.save(); ctx.shadowColor = '#0003'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    put(ctx, this.form, fx, fy);
    ctx.restore();
    let moving = false, n = 0;
    for (const [input, m] of this.marks) {
      const box = input.parentElement;                         // the label is the input's offsetParent
      const x = fx + box.offsetLeft + input.offsetLeft, y = fy + box.offsetTop + input.offsetTop;
      if (n % 3 === 0) { ctx.fillStyle = '#111'; ctx.fillRect(fx + 5, y + 8, 11, 6); }            // timing marks
      const to = input.checked ? 1 : 0;
      if (m.amount !== to) {
        if (to === 0) m.smudge = 1;
        m.amount = reduced() ? to : clamp(m.amount + (to ? 1 : -1) * this.dt * (to ? 3.2 : 6));
        moving = moving || m.amount !== to;
      }
      if (m.smudge > 0 || m.amount > 0) scribble(ctx, x, y, 52, 24, m.amount, m.smudge, n);
      n++;
    }
    return moving;
  }
}
// A pencil mark over a box: a zigzag whose points come from the box's index, so it is the same each frame.
function scribble(ctx, x, y, w, h, amount, smudge, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 233280 + 49297) % 233280; s = (s * 9301 + 49297) % 233280; return s / 233280; };
  ctx.save();
  if (smudge) { ctx.fillStyle = `rgba(60,60,70,${0.1 * smudge})`; rr(ctx, x - 2, y - 1, w + 4, h + 2, h / 2); ctx.fill(); }
  const points = 26, shown = (points - 1) * amount;
  ctx.strokeStyle = '#2b2b33d8'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  let lx = 0, ly = 0;
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const px = x + 2 + t * (w - 4) + (rnd() - 0.5) * 3, py = i % 2 ? y + 2 + rnd() * 5 : y + h - 2 - rnd() * 5;
    const part = clamp(shown - (i - 1));
    if (i === 0) ctx.moveTo(px, py);
    else if (part > 0) ctx.lineTo(lerp(lx, px, part), lerp(ly, py, part));
    lx = px; ly = py;
  }
  ctx.stroke();
  ctx.restore();
}
customElements.define('omr-sheet', OmrSheet);
// #endregion omr-sheet
