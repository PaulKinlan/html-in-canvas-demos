// ui-feed/scrolls.js: five controls that scroll, resize or unfold over time, rebuilt from demos on ui-feed.dev.
//
//   <paint-chart>        a scroll container of colour swatches. The swatches that leave at the top are drawn
//                        squashed into a stack, as paint chips
//   <track-scroll>       a scroll container of tracks with a thumb drawn by the canvas. The rows level with
//                        the thumb are drawn from a second copy of the list, in reverse
//   <bank-statement>     a scroll container of transactions with sticky day headings, under a heading that
//                        shrinks as it scrolls
//   <seismo-split>       a trace and a table of events, split by an <input type="range"> that is dragged as the
//                        bar between them
//   <lp-order>           a <details> for each side of a record. The bar of the side splits into the bars of
//                        its tracks as it opens
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /scroll-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, easeOut, rr, spring, TAU, reduced } from './kit.js';
import { Fold, cached } from './folds.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const SERIF = "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
const GROT = "'Syne', 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const VT = "'VT323', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
// As plain HTML the component's rules are gone, so a scroll container is given a height of its own.
const scroller = (el) => { el.style.cssText += 'max-height:300px;overflow-y:auto;width:100%'; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const secs = (t) => { const [m, s] = String(t ?? '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

// A thumb for a scroll container, dragged by pointer. The element is a <div> the canvas draws with no alpha
// at the thumb's place, so that it takes the pointer; the keys and the wheel go to the scroll container.
function thumbDrag(ctrl, thumb, box, travel) {
  let start = null;
  thumb.addEventListener('pointerdown', (e) => { e.preventDefault(); try { thumb.setPointerCapture(e.pointerId); } catch { /* a pointer made by a script has none to capture */ } start = { y: e.clientY, top: box.scrollTop }; ctrl.dragging = true; ctrl.request(); });
  thumb.addEventListener('pointermove', (e) => {
    if (!start) return;
    const k = ctrl.canvas.getBoundingClientRect().width / ctrl.constructor.size[0];
    box.scrollTop = start.top + ((e.clientY - start.y) / k) * (box.scrollHeight - box.clientHeight) / travel();
  });
  const end = () => { start = null; ctrl.dragging = false; ctrl.request(); };
  thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------------------------------------
// Paint chart: swatches in a scroll container. Those that scroll off the top are squashed into a stack.
// ---------------------------------------------------------------------------------------------------------

export class PaintChart extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  // The container is taller than the canvas. Its top STACK units are drawn squashed into SQUASH units.
  static STACK = 150; static SQUASH = 42;
  static css = `
    .chart { width: 360px; height: 468px; overflow-y: auto; user-select: none; scrollbar-width: none; overscroll-behavior: contain; outline: 0; }
    .chart::-webkit-scrollbar { display: none; }
    .chart:focus-visible { box-shadow: inset 0 0 0 3px #fff; }
    .chart ol { margin: 0; padding: 150px 0 0; list-style: none; }
    .chart li { display: flex; align-items: baseline; justify-content: space-between; height: 90px; padding: 0 52px 0 26px; box-sizing: border-box; color: #1d1410; }
    .chart li b { white-space: nowrap; font: 400 40px/90px ${DISPLAY}; letter-spacing: -0.02em; }
    .chart li i { white-space: nowrap; font: italic 400 16px/1 ${DISPLAY}; }
    .chart li.dark { color: #fff8ec; }
    .thumb { width: 28px; height: 100px; touch-action: none; cursor: grab; }`;

  ready() {
    this.build();
    this.addEventListener('feed-plain', () => { this.thumb.hidden = true; scroller(this.chart); });   // as plain HTML the container has its own bar
  }

  // #region paint-chart
  build() {
    const box = this.canvas ?? this.$('.plain');
    this.chart = node(`<div class="chart" tabindex="0" role="region" aria-label="${esc(this.getAttribute('label') ?? 'Paint chart')}"><ol>${options(this).map((o, i) => `<li class="${o.data.dark !== undefined ? 'dark' : ''}" style="background:${esc(o.data.colour)}"><b>${esc(o.label)}</b><i>No. ${String(i + 1).padStart(2, '0')}</i></li>`).join('')}</ol></div>`);
    this.thumb = node('<div class="thumb" aria-hidden="true"></div>');
    box.replaceChildren(this.chart, this.thumb);
    this.chart.addEventListener('scroll', () => this.request(), { passive: true });
    thumbDrag(this, this.thumb, this.chart, () => 232);
  }

  draw(ctx, w, h) {
    const { STACK, SQUASH } = PaintChart, c = this.chart, H = c.offsetHeight;
    ctx.fillStyle = '#1d1410'; ctx.fillRect(0, 0, w, h);
    // The rest of the container, from STACK down, is drawn as it is, from SQUASH down on the canvas.
    ctx.save(); ctx.beginPath(); ctx.rect(0, SQUASH, w, h - SQUASH); ctx.clip();
    put(ctx, c, 0, SQUASH - STACK, 360, H);
    ctx.restore();
    // The top STACK units are squashed into SQUASH, harder at the top, in bands, so the swatches that have
    // left look like a stack of chips seen edge on.
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      const s0 = STACK * (i / bands) ** 0.55, s1 = STACK * ((i + 1) / bands) ** 0.55, d0 = SQUASH * i / bands, d1 = SQUASH * (i + 1) / bands;
      const k = (d1 - d0) / (s1 - s0);
      ctx.save(); ctx.beginPath(); ctx.rect(0, d0, w, d1 - d0 + 0.3); ctx.clip();
      ctx.translate(0, d0 - s0 * k); ctx.scale(1, k);
      put(ctx, c, 0, 0, 360, H);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 0, w, SQUASH);
    const shade = ctx.createLinearGradient(0, SQUASH, 0, SQUASH + 10); shade.addColorStop(0, 'rgba(0,0,0,0.22)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade; ctx.fillRect(0, SQUASH, w, 10);
    // The container takes the wheel and touch over the whole canvas: its hit region is the as-is draw.
    hit(ctx, c, 0, SQUASH - STACK, 360, H);
    // the scroll bar: a dark track and a white pill
    const max = Math.max(1, c.scrollHeight - c.clientHeight), y = 14 + (c.scrollTop / max) * 232;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; rr(ctx, 325, 14, 14, 332, 7); ctx.fill();
    ctx.fillStyle = this.dragging ? '#fff' : 'rgba(255,255,255,0.92)'; rr(ctx, 325, y, 14, 100, 7); ctx.fill();
    hit(ctx, this.thumb, 318, y, 28, 100);
    return false;
  }
  // #endregion paint-chart
}
customElements.define('paint-chart', PaintChart);

// ---------------------------------------------------------------------------------------------------------
// Tracks: a scroll container with a drawn thumb. Rows level with the thumb are drawn in reverse.
// ---------------------------------------------------------------------------------------------------------

export class TrackScroll extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static THUMB = { x: 340, top: 12, travel: 336, min: 80 };
  static css = `
    .list { width: 334px; height: 360px; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; outline: 0; }
    .list::-webkit-scrollbar { display: none; }
    .list:focus-visible { box-shadow: inset 0 0 0 2px #efe2bd; }
    ol { margin: 0; padding: 0 0 0 14px; list-style: none; }
    .copy ol { width: 320px; }
    li { display: grid; grid-template-columns: 26px 1fr auto; align-items: center; height: 64px; box-sizing: border-box; border-bottom: 1px solid rgba(239,226,189,0.16); color: #efe2bd; }
    li small { font: 500 10px/1 ${GROT}; opacity: 0.7; }
    li b { display: block; width: max-content; font: 600 19px/1.15 ${GROT}; letter-spacing: -0.01em; }
    li span { display: block; width: max-content; font: 500 12px/1.3 ${GROT}; opacity: 0.75; }
    li time { padding-right: 10px; font: 500 12px/1 ${GROT}; }
    .copy li { border-color: transparent; }
    .copy li small, .copy li b, .copy li span, .copy li time { opacity: 1; color: #fff; background: #0c0f0a; padding: 1px 3px; margin-left: -3px; }
    .copy li time { margin-right: 7px; }
    .thumb { width: 28px; height: 100px; touch-action: none; cursor: grab; }`;

  ready() {
    this.band = { x: 0, v: 0 };
    this.build();
    this.addEventListener('feed-plain', () => { this.copy.hidden = this.thumb.hidden = true; scroller(this.list); });
  }

  // #region track-scroll
  build() {
    const box = this.canvas ?? this.$('.plain'), tracks = options(this);
    const rows = tracks.map((o, i) => `<li><small>${String(i + 1).padStart(2, '0')}</small><div><b>${esc(o.label)}</b><span>${esc(o.data.artist ?? '')}</span></div><time>${esc(o.data.time ?? '')}</time></li>`).join('');
    this.list = node(`<div class="list" tabindex="0" role="region" aria-label="${esc(this.getAttribute('label') ?? 'Tracks')}"><ol>${rows}</ol></div>`);
    // The same rows with each label on a black ground. Inert and hidden: only the first copy is read.
    this.copy = node(`<div class="copy" inert aria-hidden="true"><ol>${rows}</ol></div>`);
    this.thumb = node('<div class="thumb" aria-hidden="true"></div>');
    box.replaceChildren(this.list, this.copy, this.thumb);
    this.list.addEventListener('scroll', () => this.request(), { passive: true });
    thumbDrag(this, this.thumb, this.list, () => TrackScroll.THUMB.travel - this.thumbH);
  }
  get thumbH() { const l = this.list, T = TrackScroll.THUMB; return Math.max(T.min, T.travel * l.clientHeight / Math.max(1, l.scrollHeight)); }

  draw(ctx, w, h) {
    const T = TrackScroll.THUMB, l = this.list;
    let moving = false;
    ctx.fillStyle = '#29321f'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached(this, 'cloth', 360, 360, cloth), 0, 0, w, h);
    put(ctx, l, 0, 0);
    const max = Math.max(1, l.scrollHeight - l.clientHeight), th = this.thumbH, y = T.top + (l.scrollTop / max) * (T.travel - th);
    // While the thumb is held, the rows beside it are drawn from the reversed copy, in a band that opens.
    moving = spring(this.band, this.dragging ? 1 : 0, this.dt, 260, 26) || moving;
    if (this.band.x > 0.01) {
      const mid = y + th / 2, half = th / 2 * clamp(this.band.x, 0, 1.1);
      ctx.save(); ctx.beginPath(); ctx.rect(0, mid - half, 334, half * 2); ctx.clip();
      put(ctx, this.copy, 0, -l.scrollTop);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(239,226,189,0.14)'; ctx.fillRect(T.x + 6, T.top, 2, T.travel);
    ctx.fillStyle = '#efe2bd'; rr(ctx, T.x + 3, y, 8, th, 4); ctx.fill();
    hit(ctx, this.thumb, T.x - 7, y, 28, th);
    return moving;
  }
  // #endregion track-scroll
}
customElements.define('track-scroll', TrackScroll);

function cloth(g) {
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '200,210,160' : '0,0,0'},${0.03 + rnd(i + 1) * 0.05})`; g.fillRect(rnd(i + 2) * 360, rnd(i + 3) * 360, 1 + rnd(i + 4) * 2, 1); }
}

// ---------------------------------------------------------------------------------------------------------
// A bank statement: sticky day headings in a scroll container, under a heading that shrinks
// ---------------------------------------------------------------------------------------------------------

const money = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pounds = (n) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export class BankStatement extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static TOP = 112;
  static css = `
    header { width: 360px; height: 112px; padding: 14px 20px 0; box-sizing: border-box; color: #1b1b1b; }
    header small { display: block; font: 600 7px/1 ${SANS}; letter-spacing: 0.16em; text-transform: uppercase; }
    header h3 { margin: 10px 0 6px; font: 400 40px/1 ${SERIF}; letter-spacing: -0.02em; }
    header p { display: flex; justify-content: space-between; align-items: baseline; margin: 0; font: 400 12px/1 ${SERIF}; }
    header p b { font-size: 14px; }
    header p i { font-size: 10px; margin-right: 6px; }
    .mini { width: 360px; height: 34px; padding: 0 20px; box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; color: #1b1b1b; font: 400 14px/1 ${SERIF}; }
    .mini b { font-weight: 700; }
    .rows { width: 360px; height: 248px; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; outline: 0; }
    .rows::-webkit-scrollbar { display: none; }
    .rows:focus-visible { box-shadow: inset 0 0 0 2px #1b1b1b; }
    section { padding: 0 20px; }
    h4 { position: sticky; top: 0; display: flex; justify-content: space-between; margin: 0; padding: 8px 0 4px; background: #dcdcd9; border-bottom: 1px solid #1b1b1b; font: 600 6.5px/1 ${SANS}; letter-spacing: 0.14em; text-transform: uppercase; color: #333; z-index: 1; }
    .t { display: grid; grid-template-columns: 1fr auto 76px; align-items: baseline; padding: 7px 0 6px; border-bottom: 1px solid rgba(0,0,0,0.14); color: #1b1b1b; }
    .t b { font: 400 13px/1.2 ${SERIF}; }
    .t i { grid-column: 1; font: italic 400 9.5px/1.3 ${SERIF}; color: #555; }
    .t data { grid-row: 1; grid-column: 2; font: 500 12px/1 ${SERIF}; }
    .t data.in { font-weight: 700; }
    .t output { grid-row: 1; grid-column: 3; text-align: right; font: 400 12px/1 ${SERIF}; color: #444; }`;

  ready() {
    this.build();
    this.addEventListener('feed-plain', () => { this.mini.hidden = true; scroller(this.rows); });
  }

  // #region bank-statement
  build() {
    const box = this.canvas ?? this.$('.plain'), rows = options(this);
    // Each <option> is a transaction, newest first. The balance after each one is worked back from the closing one.
    let bal = Number(this.getAttribute('balance') ?? 0);
    const items = rows.map((o) => { const amt = Number(o.value), it = { ...o, amt, after: bal }; bal -= amt; return it; });
    const days = []; for (const it of items) { const d = it.data.day; (days.at(-1)?.day === d ? days.at(-1).items : (days.push({ day: d, items: [] }), days.at(-1).items)).push(it); }
    const title = esc(this.getAttribute('month') ?? ''), acct = esc(this.getAttribute('account') ?? ''), close = pounds(Number(this.getAttribute('balance') ?? 0));
    this.header = node(`<header><small>${esc(this.getAttribute('bank') ?? '')}</small><h3>${title}</h3><p><span>${acct}</span><span><i>Balance</i><b>${close}</b></span></p></header>`);
    this.mini = node(`<div class="mini" aria-hidden="true"><span>${title}</span><b>${close}</b></div>`);
    this.rows = node(`<div class="rows" tabindex="0" role="region" aria-label="Transactions">${days.map((d) => `<section><h4><span>${esc(d.day)}</span><span>Balance</span></h4>${d.items.map((t) => `<div class="t"><b>${esc(t.label)}</b><i>${esc(t.data.kind ?? '')}</i><data value="${t.amt}" class="${t.amt > 0 ? 'in' : ''}">${money(t.amt)}</data><output>${pounds(t.after)}</output></div>`).join('')}</section>`).join('')}</div>`);
    box.replaceChildren(this.header, this.mini, this.rows);
    this.rows.addEventListener('scroll', () => this.request(), { passive: true });
  }

  draw(ctx, w, h) {
    const TOP = BankStatement.TOP, r = this.rows;
    // The heading folds away over the first 120 units of scroll and the list moves up into its room.
    const p = clamp(r.scrollTop / 120), e = easeOut(p), top = lerp(TOP, 40, e);
    // The container changes height in rAF, not here, and only when it must: a layout change in the paint
    // handler would be drawn a frame late.
    const want = Math.round(360 - top);
    if (r.offsetHeight !== want && !this.sizing) this.sizing = requestAnimationFrame(() => { this.sizing = 0; r.style.height = want + 'px'; this.request(); });
    ctx.fillStyle = '#dcdcd9'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached(this, 'paper', 360, 360, paper), 0, 0, w, h);
    put(ctx, r, 0, top);
    ctx.fillStyle = '#dcdcd9'; ctx.fillRect(0, 0, w, top);
    if (e < 0.98) {
      ctx.save(); ctx.globalAlpha = 1 - e; ctx.translate(20, 0); ctx.scale(lerp(1, 0.55, e), lerp(1, 0.55, e)); ctx.translate(-20, -40 * e);
      put(ctx, this.header, 0, 0); ctx.restore();
    } else hit(ctx, this.header, 0, -200);
    if (e > 0.02) { ctx.save(); ctx.globalAlpha = e; put(ctx, this.mini, 0, 4); ctx.restore(); }
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(20, top - 1.5, 320, 1.5);
    // the scroll bar
    const max = Math.max(1, r.scrollHeight - r.clientHeight), bh = Math.max(26, (h - top) * r.clientHeight / r.scrollHeight);
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(352, top + (r.scrollTop / max) * (h - top - bh), 3, bh);
    return r.offsetHeight !== want;
  }
  // #endregion bank-statement
}
customElements.define('bank-statement', BankStatement);

function paper(g) {
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '80,80,70'},${0.04 + rnd(i + 1) * 0.06})`; g.fillRect(rnd(i + 2) * 360, rnd(i + 3) * 360, 1, 1); }
}

// ---------------------------------------------------------------------------------------------------------
// Seismograph: a trace and a table of events, split by a range input dragged as the bar between them
// ---------------------------------------------------------------------------------------------------------

const AMBER = '#ffb21e';

export class SeismoSplit extends FeedControl {
  static size = [360, 360];
  static radius = 6;
  static PANE = { x: 12, top: 56, bottom: 348, bar: 14 };
  static css = `
    header { width: 336px; height: 44px; color: ${AMBER}; font: 400 13px/1 ${VT}; }
    header > b { position: absolute; left: 0; top: 2px; font: 400 15px/1 ${VT}; letter-spacing: 0.04em; }
    header > span { position: absolute; left: 0; top: 18px; font: 400 13px/1 ${VT}; }
    header time { position: absolute; right: 0; top: 2px; font: 400 28px/1 ${VT}; }
    header time small { font-size: 13px; margin-right: 6px; }
    input.split { width: 336px; height: 14px; margin: 0; opacity: 0; cursor: ns-resize; touch-action: none; }
    .events { width: 336px; overflow-y: auto; scrollbar-width: none; outline: 0; }
    .events::-webkit-scrollbar { display: none; }
    .events:focus-visible { box-shadow: inset 0 0 0 1px ${AMBER}; }
    table { width: 336px; border-collapse: collapse; color: ${AMBER}; font: 400 13px/1 ${VT}; }
    th { position: sticky; top: 0; background: #120a02; text-align: left; font-weight: 400; padding: 2px 3px; border-bottom: 1px solid ${AMBER}; }
    td { padding: 1px 3px; white-space: nowrap; }
    td:nth-child(2), td:nth-child(3) { text-align: right; }`;

  ready() {
    this.build();
    this.addEventListener('feed-plain', () => { scroller(this.events); this.split.style.opacity = 1; });
    // The clock ticks once a second, only while the control is on screen.
    new IntersectionObserver(([e]) => {
      clearInterval(this.tick);
      if (e.isIntersecting && !reduced()) this.tick = setInterval(() => this.request(), 1000);
    }).observe(this);
  }

  // #region seismo-split
  build() {
    const box = this.canvas ?? this.$('.plain'), ev = options(this);
    this.header = node(`<header><b>${esc(this.getAttribute('net') ?? 'Network')}</b><span>${esc(this.getAttribute('station') ?? '')}</span><time><small>UTC</small><span></span></time></header>`);
    // The bar between the panes. A range input, so it has a value, the arrow keys and Page Up and Down.
    this.split = node('<input class="split" type="range" min="60" max="236" step="1" value="96" aria-label="Height of the trace" aria-orientation="vertical">');
    this.events = node(`<div class="events" tabindex="0" role="region" aria-label="Events"><table><thead><tr><th>UTC</th><th>MAG</th><th>DEPTH</th><th>LOCATION</th></tr></thead><tbody>${ev.map((o) => `<tr><td>${esc(o.value)}</td><td>${esc(o.data.mag)}</td><td>${esc(o.data.depth)}KM</td><td>${esc(o.label)}</td></tr>`).join('')}</tbody></table></div>`);
    box.replaceChildren(this.header, this.split, this.events);
    this.mags = ev.map((o) => ({ t: o.value, mag: Number(o.data.mag) }));
    this.split.addEventListener('input', () => this.layout());
    // A drag anywhere on the bar moves it: the range input's own drag runs along it, not across it.
    let start = null;
    this.split.addEventListener('pointerdown', (e) => { e.preventDefault(); this.split.focus({ preventScroll: true }); try { this.split.setPointerCapture(e.pointerId); } catch {} start = { y: e.clientY, v: +this.split.value }; });
    this.split.addEventListener('pointermove', (e) => {
      if (!start) return;
      const k = this.canvas.getBoundingClientRect().width / 360;
      this.split.value = String(Math.round(start.v + (e.clientY - start.y) / k));
      this.layout(); this.split.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const end = () => { start = null; };
    this.split.addEventListener('pointerup', end); this.split.addEventListener('pointercancel', end);
    // Up makes the trace shorter, as the bar goes up. A range's ArrowUp would make it taller.
    this.split.addEventListener('keydown', (e) => {
      const by = { ArrowUp: -8, ArrowDown: 8, PageUp: -40, PageDown: 40 }[e.key];
      if (by === undefined) return;
      e.preventDefault(); this.split.value = String(+this.split.value + by); this.layout();
    });
    this.layout();
  }
  get trace() { return +this.split.value; }
  layout() {
    const P = SeismoSplit.PANE, want = Math.round(P.bottom - (P.top + this.trace + P.bar));
    this.split.setAttribute('aria-valuetext', `Trace ${Math.round((this.trace - 60) / 176 * 100)}%, ${Math.floor(this.trace / 34)} ${Math.floor(this.trace / 34) === 1 ? 'minute' : 'minutes'} shown`);
    if (this.events.offsetHeight !== want) this.events.style.height = want + 'px';
    this.request();
  }

  draw(ctx, w, h, now) {
    const P = SeismoSplit.PANE, T = this.trace, x0 = P.x, x1 = 360 - P.x;
    const t0 = this.base ??= Date.UTC(2026, 10, 21, 14, 32, 43) - now;   // the clock starts where the original's did
    const t = new Date(t0 + now), hh = (n) => String(n).padStart(2, '0');
    const shown = `${hh(t.getUTCHours())}:${hh(t.getUTCMinutes())}:${hh(t.getUTCSeconds())}`, face = this.header.querySelector('time span');
    if (face.textContent !== shown) face.textContent = shown;   // a change raises a paint event, so only once a second
    ctx.fillStyle = '#0c2a52'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached(this, 'case', 360, 360, (g) => { for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '120,170,230' : '0,10,30'},${0.08 + rnd(i + 1) * 0.12})`; g.fillRect(rnd(i + 2) * 360, rnd(i + 3) * 360, 2, 2); } }), 0, 0, w, h);
    ctx.fillStyle = '#120a02'; rr(ctx, 8, 8, 344, 344, 8); ctx.fill();
    // a glow on everything amber: the picture of the header and the table, and the trace
    ctx.save(); ctx.shadowColor = 'rgba(255,170,30,0.65)'; ctx.shadowBlur = 6;
    put(ctx, this.header, x0, 10);
    // The trace: a row a minute, the newest at the bottom. A shorter pane shows the last few minutes.
    const rows = 6, rowH = 34, y0 = P.top + T - rows * rowH;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, P.top, x1 - x0, T); ctx.clip();
    ctx.strokeStyle = 'rgba(255,178,30,0.25)'; ctx.lineWidth = 0.6;
    for (let s = 0; s <= 6; s++) { const x = x0 + (x1 - x0) * s / 6; ctx.beginPath(); ctx.moveTo(x, P.top); ctx.lineTo(x, P.top + T); ctx.stroke(); }
    ctx.font = `400 13px ${VT}`; ctx.fillStyle = AMBER;
    for (let s = 0; s < 6; s++) ctx.fillText(String(s * 10), x0 + 4 + (x1 - x0) * s / 6, y0 + 10 > P.top ? P.top + 10 : P.top + 10);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1.1;
    for (let r = 0; r < rows; r++) {
      const cy = y0 + r * rowH + rowH / 2, quake = r === rows - 1;
      if (cy < P.top - rowH) continue;
      ctx.fillText(`14:${27 + r}`, x0 + 3, cy - 6);
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 1.5) {
        const i = x * 3.1 + r * 977, k = (x - x0) / (x1 - x0);
        let a = (rnd(i) - 0.5) * 3 + Math.sin(i * 0.05) * 1.5;
        if (quake && k > 0.18) a *= 1 + 9 * Math.exp(-(k - 0.2) * 9) * (k > 0.26 ? 1.8 : 0.6);
        x === x0 ? ctx.moveTo(x, cy + a) : ctx.lineTo(x, cy + a);
      }
      ctx.stroke();
      if (quake) { ctx.fillText('P', x0 + (x1 - x0) * 0.18, cy - 4); ctx.fillText('S', x0 + (x1 - x0) * 0.26, cy - 4); }
    }
    // the arrival times of the last event, on a strip at the foot of the trace
    ctx.fillStyle = '#120a02'; ctx.fillRect(x0, P.top + T - 14, x1 - x0, 14);
    const [h0, m0, s0] = String(this.mags[0]?.t ?? '0:0:0').split(':').map(Number), at = (d) => { const v = h0 * 3600 + m0 * 60 + s0 + d; return `${hh(Math.floor(v / 3600))}:${hh(Math.floor(v / 60) % 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`; };
    ctx.fillStyle = AMBER; ctx.fillText(`P ${at(0)}   S ${at(2.2)}   S−P 2.2 S`, x0 + 2, P.top + T - 3);
    ctx.restore();
    // the bar between the panes, with its arrows
    const by = P.top + T;
    ctx.fillStyle = 'rgba(255,178,30,0.4)'; ctx.fillRect(x0, by + 3, x1 - x0, P.bar - 6);
    ctx.fillStyle = AMBER; ctx.fillRect(170, by + 1, 20, P.bar - 2);
    ctx.fillStyle = '#120a02'; ctx.beginPath(); ctx.moveTo(174, by + 6); ctx.lineTo(180, by + 2.5); ctx.lineTo(186, by + 6); ctx.moveTo(174, by + 8); ctx.lineTo(180, by + 11.5); ctx.lineTo(186, by + 8); ctx.fill();
    put(ctx, this.events, x0, by + P.bar);
    ctx.restore();
    hit(ctx, this.split, x0, by, x1 - x0, P.bar);
    if (this.shadowRoot.activeElement === this.split) { ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]); ctx.strokeRect(x0 - 1, by, x1 - x0 + 2, P.bar); ctx.setLineDash([]); }
    // scan lines over the screen
    ctx.drawImage(cached(this, 'scan', 360, 360, (g) => { g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 8; y < 352; y += 3) g.fillRect(8, y, 344, 1); }), 0, 0, w, h);
    return false;
  }
  // #endregion seismo-split
}
customElements.define('seismo-split', SeismoSplit);

// ---------------------------------------------------------------------------------------------------------
// A record's running order: a details for each side. The side's bar splits into its tracks as it opens.
// ---------------------------------------------------------------------------------------------------------

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
