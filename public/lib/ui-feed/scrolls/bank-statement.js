// <bank-statement>: a scroll container of transactions with sticky day headings under a shrinking header.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, easeOut } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const SERIF = "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
// As plain HTML the component's rules are gone, so a scroll container is given a height of its own.
const scroller = (el) => { el.style.cssText += 'max-height:300px;overflow-y:auto;width:100%'; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

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
