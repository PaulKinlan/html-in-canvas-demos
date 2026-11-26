// <load-waterfall>: a <table> of page requests with a radio per row, waterfall bars and an <output>.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, options, esc, reduced } from '../kit.js';

const SERIF = "'Bodoni Moda', 'Bodoni 72', Didot, 'Playfair Display', 'Libre Caslon Text', 'Liberation Serif', Georgia, serif";
const INK = '#141414', RED = '#e2401b', PAPER = '#f8f6f1';
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const box = (c) => c.canvas ?? c.$('.plain');
const secs = (v) => `${(+v).toFixed(2)} s`;

export class LoadWaterfall extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  // The axis: 0 s at x 158, 57.7 units a second.
  static AXIS = { x: 158, k: 57.7, top: 57, row: 28 };
  static css = `
    table { top: 4px !important; width: 344px; border-collapse: collapse; color: ${INK}; font-family: ${SERIF}; }
    caption { height: 26px; text-align: left; padding-left: 16px; font: 400 11px/26px ${SERIF}; caption-side: top; }
    th, td { padding: 0; border: 0; }
    thead tr { height: 27px; }
    thead th { font: italic 400 17px/1 ${SERIF}; text-align: left; vertical-align: bottom; padding: 0 0 4px 16px; }
    abbr { text-decoration: none; }
    thead th.kb { font: 400 9px/1 ${SERIF}; letter-spacing: 0.08em; text-align: right; padding: 0 8px 4px 0; text-transform: uppercase; }
    thead th.time, td.time { padding: 0; width: 195px; color: transparent; font-size: 1px; }
    tbody tr { height: 28px; }
    tbody th { width: 119px; text-align: left; font: italic 400 17px/1 ${SERIF}; white-space: nowrap; }
    tbody th label { display: block; position: relative; padding: 4px 0 7px 16px; cursor: pointer; }
    tbody th input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    tbody th, tbody td.kb { border-bottom: 1px solid #cfccc4; }
    tbody tr:last-child th, tbody tr:last-child td.kb { border-bottom: 0; }
    td.kb { width: 30px; text-align: right; padding-right: 8px; font: 400 11px/1 ${SERIF}; font-variant-numeric: lining-nums; }
    tbody tr:hover th { font-weight: 700; }
    tbody tr:has(:checked) th, tbody tr:has(:checked) td.kb { background: ${INK}; color: #fff; font-weight: 700; border-bottom-color: ${INK}; }
    output { top: 288px !important; left: 16px !important; width: 328px; height: 64px; display: grid; grid-template-columns: 142px 1fr; grid-template-rows: 46px 18px; color: ${INK}; font: 400 10.5px/1.45 ${SERIF}; }
    output .big { grid-row: 1; font: italic 400 62px/46px ${SERIF}; letter-spacing: -0.04em; white-space: nowrap; }
    output .big i { font-size: 15px; letter-spacing: 0; margin-left: 3px; }
    output .keys { grid-row: 2; grid-column: 1; display: flex; gap: 10px; align-items: center; font-size: 9.5px; white-space: nowrap; }
    output .keys small { font-size: 7.5px; letter-spacing: 0.1em; text-transform: uppercase; }
    output .wait::before { content: ''; display: inline-block; width: 8px; height: 6px; margin-right: 4px; border-left: 1.5px solid currentColor; background: linear-gradient(currentColor, currentColor) 0 50% / 100% 1.5px no-repeat; }
    output .load::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 4px; background: currentColor; }
    output .what { grid-column: 2; grid-row: 1 / 3; padding-top: 6px; }
    output .what small { font-size: 7.5px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; margin-right: 5px; }
    output .what em { display: block; }
    output.hot .big, output.hot .keys { color: ${RED}; }`;

  ready() {
    this.build();
  }

  // #region load-waterfall
  build() {
    // Each <option> is a request: data-kb, data-start (s), data-wait (s waiting for the first byte), data-end (s),
    // data-file, data-note, data-hot (on the path to the largest paint), data-after (the value of the request
    // that named it).
    this.reqs = options(this).map((o) => ({ ...o, kb: o.data.kb, t0: +o.data.start, wait: +o.data.wait, t1: +o.data.end, hot: 'hot' in o.data, after: o.data.after }));
    const name = this.getAttribute('name') ?? 'request';
    const chosen = Math.max(0, this.reqs.findIndex((r) => r.selected));
    this.table = node(`<table><caption>${esc(this.getAttribute('caption') ?? '')}</caption>
      <thead><tr><th scope="col" class="name">${esc(this.getAttribute('label') ?? 'Fig.')}</th><th scope="col" class="kb"><abbr title="kilobytes">kB</abbr></th><th scope="col" class="time">Timeline</th></tr></thead>
      <tbody>${this.reqs.map((r, i) => `<tr><th scope="row"><label><input type="radio" name="${esc(name)}" value="${esc(r.value)}"${i === chosen ? ' checked' : ''}>${esc(r.label)}</label></th><td class="kb">${esc(Math.round(+r.kb))}</td><td class="time">${esc(`starts at ${secs(r.t0)}, waits ${secs(r.wait)}, loads in ${secs(r.t1 - r.t0 - r.wait)}`)}</td></tr>`).join('')}</tbody></table>`);
    this.radios = [...this.table.querySelectorAll('input')];
    this.out = node('<output aria-live="polite"></output>');
    box(this).replaceChildren(this.table, this.out);
    // A click anywhere on a row chooses it, as the name does.
    this.table.addEventListener('click', (e) => { const tr = e.target.closest('tbody tr'); if (tr && !e.target.closest('label')) tr.querySelector('input').click(); });
    this.table.addEventListener('change', () => this.read());
    this.read();
    this.clock = reduced() ? 9 : -1;     // the replay of the page arriving starts at the first frame
  }
  read() {
    const i = Math.max(0, this.radios.findIndex((r) => r.checked)), r = this.reqs[i];
    this.chosen = i;
    const load = r.t1 - r.t0 - r.wait;
    this.out.className = r.hot ? 'hot' : '';
    this.out.innerHTML = `<span class="big">${(r.t1 - r.t0).toFixed(2)}<i>s</i></span>
      <span class="keys"><span class="wait">${r.wait.toFixed(2)} <small>waiting</small></span><span class="load">${load.toFixed(2)} <small>loading</small></span></span>
      <span class="what"><small>${esc(r.label)}</small><i>${esc(r.data.file ?? '')}</i><br>${esc(r.kb)} kB, from ${secs(r.t0)} to ${secs(r.t1)}<em>${esc(r.data.note ?? '')}</em></span>`;
    this.setValue(r.value);
    this.request();
  }

  draw(ctx, w, h) {
    const A = LoadWaterfall.AXIS, x = (t) => A.x + t * A.k, bottom = A.top + this.reqs.length * A.row;
    // The figure replays the page arriving: a clock runs from 0 to 3.3 s at 1.8 times real speed.
    if (this.clock < 0) this.clock = 0; else this.clock += this.dt * 1.8;
    const now = this.clock, moving = now < 3.4;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    put(ctx, this.table, 0, 4);
    // the rules: one over the head, one under the rows
    ctx.fillStyle = INK; ctx.fillRect(16, 29.5, 328, 1.3); ctx.fillRect(16, bottom, 328, 1.3);
    // the axis
    ctx.font = `400 10px ${SERIF}`; ctx.textBaseline = 'alphabetic';
    for (let s = 0; s <= 3; s++) { ctx.textAlign = s ? 'center' : 'left'; ctx.fillText(s ? `${s} s` : '0', x(s) + (s ? 4 : -1), 50); ctx.fillRect(x(s), 53, 1, 4); }
    ctx.textAlign = 'left';
    // first and largest paint, each shown once the clock has passed it
    const line = (at, label, colour, dash) => {
      if (now < at) return;
      const X = x(at);
      ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 1;
      if (dash) ctx.setLineDash([2.5, 2.5]);
      ctx.beginPath(); ctx.moveTo(X + 0.5, 40); ctx.lineTo(X + 0.5, bottom); ctx.stroke(); ctx.restore();
      ctx.fillStyle = colour; ctx.font = `700 7.5px ${SERIF}`; const k = label.split(' ')[0];
      ctx.textAlign = 'right'; ctx.fillText(k.toUpperCase(), X - 2, 38);
      ctx.textAlign = 'left'; ctx.font = `400 10px ${SERIF}`; ctx.fillText(`${at.toFixed(2)} s`, X + 2, 38);
    };
    line(+(this.getAttribute('fcp') ?? 0), 'fcp', INK, true);
    line(+(this.getAttribute('lcp') ?? 0), 'lcp', RED, false);
    // the bars: a whisker while the request waits, a block while it loads, cut at the clock
    this.reqs.forEach((r, i) => {
      if (now < r.t0) return;
      const cy = A.top + i * A.row + A.row / 2, c = r.hot ? RED : INK, x0 = x(r.t0), xw = x(Math.min(now, r.t0 + r.wait)), x1 = x(Math.min(now, r.t1));
      ctx.fillStyle = c;
      ctx.fillRect(x0, cy - 4.5, 1.3, 9);
      ctx.fillRect(x0, cy - 0.65, xw - x0, 1.3);
      if (now > r.t0 + r.wait) ctx.fillRect(xw, cy - 7, Math.max(2, x1 - xw), 14);
    });
    // the chain from a request to the ones it named, and the note beside it
    const from = this.reqs.findIndex((r) => this.reqs.some((k) => k.after === r.value));
    if (from >= 0 && now > this.reqs[from].t1) {
      const F = this.reqs[from], X = x(F.t1) - 1, kids = this.reqs.map((r, i) => [r, i]).filter(([r]) => r.after === F.value), last = kids.at(-1)[1];
      const cy = (i) => A.top + i * A.row + A.row / 2;
      ctx.fillStyle = RED; ctx.fillRect(X, cy(from) + 7, 1.2, cy(last) - cy(from) - 7);
      for (const [r, i] of kids) if (now >= r.t0) { ctx.fillStyle = r.hot ? RED : INK; ctx.fillRect(X, cy(i) - 0.6, x(r.t0) - X, 1.2); }
      const note = this.getAttribute('note');
      if (note) {
        ctx.fillStyle = RED; ctx.font = `italic 400 10px ${SERIF}`; ctx.textAlign = 'right';
        const lines = [], words = note.split(' ');
        let cur = '';
        for (const wd of words) { const t = cur ? `${cur} ${wd}` : wd; if (ctx.measureText(t).width > 66 && cur) { lines.push(cur); cur = wd; } else cur = t; }
        lines.push(cur);
        lines.forEach((l, k) => ctx.fillText(l, X - 6, cy(from + 1) - 6 + k * 11.5));
        ctx.textAlign = 'left';
      }
    }
    // the chosen row's focus, as a dashed box round its band
    const r = this.radios[this.chosen];
    if (r.matches(':focus-visible')) { ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.strokeRect(1.5, A.top + this.chosen * A.row + 1.5, 146, A.row - 3); ctx.restore(); }
    put(ctx, this.out, 16, 288);
    return moving;
  }
  // #endregion load-waterfall
}
customElements.define('load-waterfall', LoadWaterfall);
