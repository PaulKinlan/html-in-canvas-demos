// <topic-list>: a checkbox list whose chosen rows crossfade to an italic copy with a red dot.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, rr, spring, TAU } from '../kit.js';

const SERIF = "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
const MONO = "'IBM Plex Mono', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
// A focus ring is drawn only for keyboard focus, as :focus-visible would show it.
const fv = (ctrl, el) => ctrl.shadowRoot.activeElement === el && el.matches(':focus-visible');
const ring = (ctx, x, y, w, h, r, colour = '#fff') => { ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore(); };

export class TopicList extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static TOP = 46; static ROW = 44;
  static css = `
    h3 { width: 316px; margin: 0; padding-bottom: 7px; border-bottom: 2px solid #7d7d7d; color: #bdbdbd; font: 500 8px/1 ${MONO}; letter-spacing: 0.16em; }
    ol { width: 316px; margin: 0; padding: 0; list-style: none; }
    li { position: relative; border-bottom: 1px solid #3a3a3a; }
    label { display: flex; align-items: center; height: 43px; color: #8c8c8c; font: 400 26px/1 ${SERIF}; cursor: pointer; }
    label span { flex: 1; } label small { margin-right: 34px; font: 500 7.5px/1 ${MONO}; letter-spacing: 0.14em; }
    input { position: absolute; right: 0; width: 26px; height: 26px; margin: 0; opacity: 0; }
    .italic label { color: #f4f1ea; font-style: italic; }
    .italic small { color: #bdbdbd; font-style: normal; }`;

  ready() {
    this.build();
  }

  // #region topic-list
  build() {
    const box = this.canvas ?? this.$('.plain'), name = this.getAttribute('name') ?? 'topic';
    this.topics = options(this);
    const rows = (inputs) => this.topics.map((o) => `<li><label><span>${esc(o.label)}</span><small>${esc((o.data.cadence ?? '').toUpperCase())}</small>${inputs ? `<input type="checkbox" name="${esc(name)}" value="${esc(o.value)}" ${o.selected ? 'checked' : ''}>` : ''}</label></li>`).join('');
    this.head = node(`<h3>${esc((this.getAttribute('label') ?? 'Your newsletters').toUpperCase())}</h3>`);
    this.list = node(`<ol aria-label="${esc(this.getAttribute('label') ?? 'Your newsletters')}">${rows(true)}</ol>`);
    // The same rows, in italic and white. Inert and hidden: each chosen row is drawn from this copy.
    this.italic = node(`<ol class="italic" inert aria-hidden="true">${rows(false)}</ol>`);
    this.boxes = [...this.list.querySelectorAll('input')];
    this.mix = this.boxes.map((b) => ({ x: b.checked ? 1 : 0, v: 0 }));
    box.replaceChildren(this.head, this.list, this.italic);
    this.list.addEventListener('change', () => this.sync());
    this.addEventListener('feed-plain', () => { this.italic.hidden = true; });
    this.sync();
  }
  sync() {
    const fd = new FormData(), name = this.getAttribute('name') ?? 'topic';
    for (const b of this.boxes) if (b.checked) fd.append(name, b.value);
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h) {
    const { TOP, ROW } = TopicList, x0 = 22;
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.head, x0, 18);
    let moving = false;
    this.boxes.forEach((b, i) => {
      moving = spring(this.mix[i], b.checked ? 1 : 0, this.dt, 240, 22) || moving;
      const t = clamp(this.mix[i].x), y = TOP + i * ROW, li = b.closest('li');
      // the plain row and the italic row, crossfaded, each a slice of its own list
      for (const [list, a] of [[this.list, 1 - t], [this.italic, t]]) {
        if (a < 0.01) continue;
        ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.rect(0, y, w, ROW); ctx.clip();
        put(ctx, list, x0 + (list === this.italic ? lerp(-6, 0, t) : 0), y - li.offsetTop, list.offsetWidth, list.offsetHeight);
        ctx.restore();
      }
      // the dot: a ring, filled red from the middle as it is chosen
      const cx = x0 + 316 - 12, cy = y + ROW / 2;
      ctx.strokeStyle = t > 0.5 ? '#e8442f' : '#6d6d6d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.stroke();
      if (t > 0.01) { ctx.fillStyle = '#e8442f'; ctx.beginPath(); ctx.arc(cx, cy, 5 * Math.max(0, this.mix[i].x), 0, TAU); ctx.fill(); }
      if (fv(this, b)) ring(ctx, x0 - 6, y + 2, 328, ROW - 4, 6, '#f4f1ea');
    });
    // the list's hit region where it is laid out, so a tap on any row toggles its checkbox
    hit(ctx, this.list, x0, TOP);
    hit(ctx, this.italic, -2000, 0);
    const n = this.boxes.filter((b) => b.checked).length;
    ctx.fillStyle = '#8c8c8c'; ctx.font = `500 8px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(`${n} OF ${this.boxes.length}`, x0 + 316, 18 + 8); ctx.textAlign = 'left';
    return moving;
  }
  // #endregion topic-list
}
customElements.define('topic-list', TopicList);
