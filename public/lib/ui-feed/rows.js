// ui-feed/rows.js: four controls made of rows, rebuilt from demos on ui-feed.dev.
//
//   <load-waterfall name>   a <table> of the requests a page made, with a radio in each row header. The canvas
//                           draws the waterfall: the axis, a bar for each request growing as the page arrives,
//                           the paint lines and the chain to the hero. An <output> reads out the chosen row
//   <speed-list name>       radios in a <fieldset>, one row a speed. The canvas squeezes the picture of each
//                           number into a condensed face and springs a dot to the chosen one
//   <flavour-list name>     checkboxes in a <fieldset>. A white bar follows focus on a spring and each tick
//                           is drawn stroke by stroke
//   <file-stack name>       a <ul> of files with a remove <button> each, and a <label> round an
//                           <input type="file" multiple>. The rows share the height, so the type grows as files go
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /row-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, rr, spring, TAU, reduced } from './kit.js';

const SERIF = "'Bodoni Moda', 'Bodoni 72', Didot, 'Playfair Display', 'Libre Caslon Text', 'Liberation Serif', Georgia, serif";
const TEXT = "'Source Serif 4', 'Source Serif Pro', Charter, 'Bitstream Charter', Georgia, 'Liberation Serif', serif";
const SLAB = "'Roboto Slab', 'Zilla Slab', Rockwell, 'DejaVu Serif', Georgia, serif";
const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const box = (c) => c.canvas ?? c.$('.plain');
// Where an element sits inside an ancestor, in CSS pixels of the layout (the design units of these controls).
const within = (el, top) => { let x = 0, y = 0; for (let n = el; n && n !== top; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };
const secs = (v) => `${(+v).toFixed(2)} s`;

// ---------------------------------------------------------------------------------------------------------
// Load waterfall: a table of requests, a radio in each row header, the bars drawn by the canvas
// ---------------------------------------------------------------------------------------------------------

const INK = '#141414', RED = '#e2401b', PAPER = '#f8f6f1';

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

// ---------------------------------------------------------------------------------------------------------
// Speed list: radios in a fieldset, each number squeezed by the canvas, a dot on a spring
// ---------------------------------------------------------------------------------------------------------

const LIME = '#d9f45b';

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

// ---------------------------------------------------------------------------------------------------------
// Flavour list: checkboxes in a fieldset, a bar that follows focus, ticks drawn stroke by stroke
// ---------------------------------------------------------------------------------------------------------

const NAVY = '#14236a';

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

// ---------------------------------------------------------------------------------------------------------
// File stack: a list of files and a file input. The rows share the height, and each is drawn scaled to fit
// ---------------------------------------------------------------------------------------------------------

const BROWNS = [['#3a221d', '#f6e5c6'], ['#6a3c26', '#f6e5c6'], ['#9c5e33', '#f6e5c6'], ['#cc9150', '#3a221d']];
const ADD = ['#f0dbb5', '#3a221d'];

export class FileStack extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static ROW = 72;               // every row is laid out this tall, and drawn scaled to its share of the height
  static RIGHT = 74;             // the column the remove buttons sit in, at that size
  static css = `
    ul { width: 360px; margin: 0; padding: 0; list-style: none; font-family: ${SLAB}; }
    li, label.add { position: relative; display: flex; align-items: center; width: 360px; height: 72px; box-sizing: border-box; padding: 0 17px 0 23px; color: var(--ink); }
    .nm { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: clip; font: 700 34px/1 ${SLAB}; letter-spacing: -0.02em; }
    .nm span { font-weight: 400; opacity: 0.62; }
    button { all: unset; box-sizing: border-box; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 3px; cursor: pointer; color: var(--ink); }
    button svg, .add svg { width: 26px; height: 26px; pointer-events: none; }
    button:active { background: var(--ink); color: var(--bg); }
    label.add { cursor: pointer; font: 700 34px/1 ${SLAB}; letter-spacing: -0.02em; justify-content: space-between; }
    label.add svg { margin-right: 7px; }
    label.add input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    label.add:active { filter: brightness(0.9); }
    .sr { width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }`;

  ready() {
    this.build();
  }

  // #region file-stack
  build() {
    this.name = this.getAttribute('name') ?? 'files';
    this.ul = node(`<ul aria-label="${esc(this.getAttribute('label') ?? 'Files')}"></ul>`);
    this.add = node(`<label class="add" style="--ink:${ADD[1]};--bg:${ADD[0]}"><span>${esc(this.getAttribute('add') ?? 'Add files')}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.8" fill="none"/></svg><input type="file" multiple></label>`);
    this.status = node('<output role="status" class="sr"></output>');
    this.input = this.add.querySelector('input');
    box(this).replaceChildren(this.ul, this.add, this.status);
    this.items = []; this.made = 0;
    this.addH = { x: -1, v: 0 };
    // Files named in <option> children are listed as empty File objects, so the form sends their names.
    for (const o of options(this)) this.push(new File([], o.label), true);
    this.input.addEventListener('change', () => {
      const files = [...this.input.files];
      files.forEach((f) => this.push(f));
      this.input.value = '';
      this.say(files.length === 1 ? `${files[0].name} added.` : `${files.length} files added.`);
    });
    this.ul.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.remove(this.items.find((it) => it.btn === b)); });
    this.sync();
  }
  push(file, settled = false) {
    const [bg, ink] = BROWNS[this.made++ % BROWNS.length], dot = file.name.lastIndexOf('.');
    const base = dot > 0 ? file.name.slice(0, dot) : file.name, ext = dot > 0 ? file.name.slice(dot) : '';
    const li = document.createElement('li');
    li.style.cssText = `--bg:${bg};--ink:${ink}`;
    li.innerHTML = `<span class="nm">${esc(base)}<span>${esc(ext)}</span></span><button type="button" aria-label="Remove ${esc(file.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></button>`;
    this.ul.append(li);
    this.items.push({ file, li, btn: li.querySelector('button'), bg, h: { x: settled ? -1 : 0, v: 0 }, gone: false });
    this.sync();
  }
  remove(it) {
    if (!it || it.gone) return;
    it.gone = true;
    it.li.inert = true;                 // it stays in the list, out of reach, until its row has closed
    const live = this.items.filter((x) => !x.gone), next = live.find((x) => this.items.indexOf(x) > this.items.indexOf(it));
    (next?.btn ?? this.input).focus({ preventScroll: true });
    this.say(`${it.file.name} removed.`);
    this.sync();
  }
  say(text) { this.status.textContent = text; }
  sync() {
    const fd = new FormData();
    for (const it of this.items) if (!it.gone) fd.append(this.name, it.file);
    this.setValue(fd);
    this.request();
  }

  // One row: its background, then two draws of the element scaled by s. The first is cut to the name, from
  // the left. The second is cut to the button column and moved so that the button lands on the right edge.
  // The second draw is the one the element's hit region follows.
  row(ctx, el, top, y, rh, bg, w) {
    const s = rh / FileStack.ROW, R = FileStack.RIGHT * s, H = el.offsetHeight;
    ctx.fillStyle = bg; ctx.fillRect(0, y, w, rh + 0.5);
    ctx.save(); ctx.beginPath(); ctx.rect(0, y, w - R, rh); ctx.clip();
    put(ctx, el, 0, y - top * s, 360 * s, H * s); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(w - R, y, R, rh); ctx.clip();
    put(ctx, el, w - 360 * s, y - top * s, 360 * s, H * s); ctx.restore();
    return s;
  }

  draw(ctx, w, h) {
    const live = this.items.filter((x) => !x.gone).length, share = h / (live + 1), ROW = FileStack.ROW;
    let moving = false, y = 0, settle = false;
    for (const it of this.items) {
      if (it.h.x < 0) it.h.x = share;
      moving = spring(it.h, it.gone ? 0 : share, this.dt, 240, 26) || moving;
      if (it.gone && it.h.x < 0.5) settle = true;
    }
    if (this.addH.x < 0) this.addH.x = share;
    moving = spring(this.addH, share, this.dt, 240, 26) || moving;
    // The rows are scaled to fill the height exactly, so a spring that overshoots never leaves a gap.
    const total = this.items.reduce((t, it) => t + Math.max(0, it.h.x), 0) + this.addH.x, fit = h / total;
    this.items.forEach((it, i) => {
      const rh = Math.max(0, it.h.x) * fit;
      if (rh > 0.2) this.row(ctx, this.ul, i * ROW, y, rh, it.bg, w);
      if (it.btn.matches(':focus-visible') && rh > 4) {
        const s = rh / ROW, b = within(it.btn, it.li);
        ctx.save(); ctx.strokeStyle = getComputedStyle(it.li).getPropertyValue('--ink'); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.strokeRect(w - (360 - b.x) * s - 3, y + b.y * s - 3, b.w * s + 6, b.h * s + 6); ctx.restore();
      }
      y += rh;
    });
    const ah = this.addH.x * fit;
    this.row(ctx, this.add, 0, y, ah, ADD[0], w);
    hit(ctx, this.add, 0, y, w, ah);       // the whole bottom row opens the file picker
    if (this.input.matches(':focus-visible')) { ctx.save(); ctx.strokeStyle = ADD[1]; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.strokeRect(4, y + 4, w - 8, ah - 8); ctx.restore(); }
    // A closed row leaves the list in the next frame (the layout changes outside the paint handler).
    if (settle && !this.sweep) this.sweep = requestAnimationFrame(() => {
      this.sweep = 0;
      this.items = this.items.filter((it) => { if (it.gone && it.h.x < 0.5) { it.li.remove(); return false; } return true; });
      this.request();
    });
    return moving;
  }
  // #endregion file-stack
}
customElements.define('file-stack', FileStack);
