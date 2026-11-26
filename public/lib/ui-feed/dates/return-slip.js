// <return-slip>: a library renewal receipt with a <details> that feeds out a calendar of radios.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, esc, TAU, reduced } from '../kit.js';
import { Fold, cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const MONO = "'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const day = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (dt, n) => new Date(dt.getTime() + n * 864e5);
const fmt = (dt, o, loc = 'en-US') => dt.toLocaleDateString(loc, { timeZone: 'UTC', ...o });

function drawDesk(g) {
  const wood = g.createLinearGradient(0, 0, 360, 360); wood.addColorStop(0, '#3a2414'); wood.addColorStop(0.5, '#2a190e'); wood.addColorStop(1, '#1d1009');
  g.fillStyle = wood; g.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rnd(i) > 0.5 ? '110,70,40' : '15,8,4'},${0.18 + rnd(i + 3) * 0.3})`; g.lineWidth = 0.5 + rnd(i + 1) * 1.6; g.beginPath(); const y = rnd(i + 2) * 380 - 10; g.moveTo(0, y); g.bezierCurveTo(120, y + (rnd(i + 4) - 0.5) * 30, 240, y + (rnd(i + 5) - 0.5) * 30, 360, y + (rnd(i + 6) - 0.5) * 20); g.stroke(); }
  // the spines of three books on the left
  [['#7c2a22', 0], ['#2f4a3c', 15], ['#3b3f5c', 29]].forEach(([c, x], i) => {
    const sp = g.createLinearGradient(x, 0, x + 15, 0); sp.addColorStop(0, 'rgba(0,0,0,0.5)'); sp.addColorStop(0.4, c); sp.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = sp; g.fillRect(x, 54 + i * 4, 15, 260);
    g.fillStyle = 'rgba(214,180,110,0.55)'; g.fillRect(x + 2, 90 + i * 4, 11, 1.2); g.fillRect(x + 2, 250 + i * 4, 11, 1.2);
  });
}
// A wren on a twig, in pen strokes: an oval body, a cocked tail, and hatching for the shading.
function drawWren(g, x, y) {
  g.save(); g.translate(x, y); g.strokeStyle = '#2a2a2a'; g.lineCap = 'round'; g.lineWidth = 0.7;
  const body = new Path2D(); body.ellipse(0, 0, 17, 12, -0.2, 0, TAU);
  g.save(); g.clip(body);
  for (let i = -30; i < 30; i += 2.2) { g.beginPath(); g.moveTo(i, -14); g.lineTo(i + 10, 14); g.stroke(); }
  g.lineWidth = 0.5; for (let i = -30; i < 30; i += 3) { g.beginPath(); g.moveTo(i, 14); g.lineTo(i + 12, -2); g.stroke(); }
  g.restore();
  g.lineWidth = 1; g.stroke(body);
  g.fillStyle = '#f8f8f5'; g.beginPath(); g.ellipse(-3, 5, 9, 5, -0.2, 0, TAU); g.fill();
  // head, eye and beak
  g.fillStyle = '#fafaf7'; g.beginPath(); g.arc(-15, -9, 7, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = 0.6; for (let i = -22; i < -8; i += 2) { g.beginPath(); g.moveTo(i, -15); g.lineTo(i + 3, -12); g.stroke(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(-17, -9.5, 1.3, 0, TAU); g.fill();
  g.lineWidth = 1; g.beginPath(); g.moveTo(-21.5, -8.5); g.lineTo(-29, -7); g.lineTo(-21.5, -6.5); g.stroke();
  // the tail, cocked up
  g.beginPath(); g.moveTo(12, -6); g.lineTo(22, -24); g.lineTo(27, -21); g.lineTo(16, -2); g.stroke();
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(14 + i * 1.5, -4 - i * 3); g.lineTo(20 + i * 1.5, -6 - i * 3); g.stroke(); }
  // legs and the twig
  g.beginPath(); g.moveTo(-2, 11); g.lineTo(-4, 18); g.moveTo(4, 11); g.lineTo(5, 18); g.stroke();
  g.lineWidth = 1.4; g.beginPath(); g.moveTo(-26, 19); g.bezierCurveTo(-8, 17, 10, 20, 30, 16); g.stroke();
  g.lineWidth = 0.8; g.beginPath(); g.moveTo(16, 18); g.lineTo(24, 24); g.moveTo(-14, 18); g.lineTo(-20, 13); g.stroke();
  g.restore();
}
// A torn edge: a zigzag along y, pointing up (dir -1) or down (dir 1).
function zigzag(ctx, x, y, w, dir) { const n = Math.round(Math.abs(w) / 3), s = Math.sign(w) * 3; for (let i = 0; i <= n; i++) ctx.lineTo(x + i * s, y + (i % 2 ? dir * 2.2 : 0)); }

export class ReturnSlip extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static PAPER = { x: 50, y: 18, w: 260, bottom: 346 };
  static css = `
    .slip { width: 260px; padding: 74px 14px 14px; box-sizing: border-box; color: #1b1b1b; font: 500 9.5px/1.45 ${MONO}; }
    h3 { margin: 0 0 3px; text-align: center; font: 700 12.5px/1.2 ${MONO}; letter-spacing: 0.16em; text-transform: uppercase; }
    .meta { display: flex; justify-content: space-between; padding-bottom: 4px; margin-bottom: 6px; border-bottom: 1px dashed #777; text-transform: uppercase; }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-template-columns: 1fr auto; margin-bottom: 5px; }
    li b { font-weight: 700; text-transform: uppercase; }
    li span:nth-child(even) { text-align: right; text-transform: uppercase; }
    summary { display: flex; align-items: center; gap: 4px; margin-top: 6px; list-style: none; cursor: pointer; font-weight: 700; }
    summary::-webkit-details-marker { display: none; }
    summary i { flex: 1; height: 7px; border-bottom: 1.5px dotted #333; }
    summary b { padding: 2px 6px; border: 1px solid #222; font-weight: 700; }
    summary b::after { content: ' \\25BC'; font-size: 7px; }
    details[open] > summary b::after { content: ' \\25B2'; }
    summary:focus-visible b { outline: 2px solid #1b1b1b; outline-offset: 1px; }
    h4 { display: flex; justify-content: space-between; margin: 12px 0 3px; font: 700 10.5px/1 ${MONO}; letter-spacing: 0.14em; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { font: 500 7.5px/14px ${MONO}; }
    td { height: 17px; padding: 0; text-align: center; }
    td label { display: block; position: relative; line-height: 17px; cursor: pointer; }
    td input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    td label:has(:disabled) { color: #9a9a9a; cursor: default; }
    td label.closed span { text-decoration: line-through; }
    td label.today span::before { content: '['; } td label.today span::after { content: ']'; }
    td label:has(:checked) { background: #1b1b1b; color: #fff; }
    td label:has(:focus-visible) { outline: 1.5px solid #1b1b1b; outline-offset: 1px; }
    .notes { display: grid; grid-template-columns: 1fr auto; margin-top: 8px; font-size: 8px; text-transform: uppercase; }
    .notes span:nth-child(even) { text-align: right; }`;

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['now', 'until', 'closed', 'library', 'kiosk', 'data-due'] });
    const root = this.shadowRoot;
    root.addEventListener('pointerdown', () => { this.pressed = performance.now(); });
    root.addEventListener('keydown', (e) => {
      if (!this.fold?.open) return;
      if (e.key === 'Escape' || ((e.key === 'Enter' || e.key === ' ') && e.target.type === 'radio')) { e.preventDefault(); this.toggle(false); }
    });
  }

  // #region return-slip
  build() {
    const box = this.canvas ?? this.$('.plain'), now = new Date((this.getAttribute('now') ?? '2026-11-21T14:07') + 'Z'), today = day(iso(now));
    const until = day(this.getAttribute('until') ?? iso(addDays(today, 21))), closed = (this.getAttribute('closed') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const isClosed = (d) => closed.includes(iso(d)) || closed.includes(fmt(d, { weekday: 'short' }).toLowerCase());
    const up = (s) => s.toUpperCase(), short = (d) => up(fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }));
    const books = this.books = [...this.querySelectorAll(':scope > option')].map((o) => ({ no: o.value, title: o.textContent.trim(), author: o.dataset.author ?? '', due: day(o.dataset.due ?? iso(until)) }));
    const first = this.due = books.reduce((a, b) => (b.due < a ? b.due : a), until);
    // the calendar: whole weeks from the start of this month to the last day a loan can be renewed to
    const start = addDays(day(iso(today).slice(0, 8) + '01'), -day(iso(today).slice(0, 8) + '01').getUTCDay()), end = addDays(until, 6 - until.getUTCDay());
    const weeks = []; for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    const cell = (d) => {
      const out = d < today || d > until, shut = isClosed(d), off = out || shut;
      const said = `${fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}${shut ? ', closed' : out ? ', not available' : ''}`;
      return `<td><label class="${shut && !out ? 'closed' : ''}${iso(d) === iso(today) ? ' today' : ''}"><input type="radio" name="renew" value="${iso(d)}" aria-label="${esc(said)}"${off ? ' disabled' : ''}><span>${d.getUTCDate()}</span></label></td>`;
    };
    const notes = closed.map((c) => /^\d/.test(c) ? `Closed ${fmt(day(c), { weekday: 'short', month: 'short', day: 'numeric' })}` : `Closed ${c}days`);
    this.slip = node(`<div class="slip">
      <h3>${esc(this.getAttribute('library') ?? 'Library')}</h3>
      <div class="meta"><span>${esc(this.getAttribute('kiosk') ?? '')}</span><span>${esc(up(fmt(now, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })))} ${esc(now.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }))}</span></div>
      <ul>${books.map((b) => `<li><b>${esc(b.title)}</b><span>No. ${esc(b.no)}</span><span>${esc(b.author)}</span><span class="due">Due ${esc(short(b.due))}</span></li>`).join('')}</ul>
      <details><summary>Return by <i></i><b></b></summary>
        <h4><span>${esc(up(fmt(today, { month: 'long', year: 'numeric' })))}</span><span>RENEW</span></h4>
        <table><thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((t) => `<th>${up(t)}</th>`).join('')}</tr></thead>
        <tbody>${weeks.map((w) => `<tr>${w.map(cell).join('')}</tr>`).join('')}</tbody></table>
        <div class="notes">${notes.map((n, i) => `<span>${esc(n)}</span><span>${i === 0 ? 'Renew to ' + esc(short(until)) : esc(this.getAttribute('closed-note') ?? '')}</span>`).join('')}</div>
      </details></div>`);
    box.replaceChildren(this.slip);
    this.details = this.slip.querySelector('details'); this.summary = this.details.firstElementChild;
    this.radios = [...this.slip.querySelectorAll('input')];
    const pick = this.radios.find((r) => r.value === iso(first)); if (pick) pick.checked = true;
    this.fold = new Fold(this, this.details, 0.5);
    this.summary.addEventListener('click', (e) => { if (this.plain) return; e.preventDefault(); this.toggle(!this.fold.open); });
    this.details.addEventListener('change', () => {
      this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
      if (performance.now() - (this.pressed ?? -1e4) < 800) setTimeout(() => this.toggle(false), reduced() ? 0 : 260);
    });
    this.sync();
  }
  get value() { return this.radios.find((r) => r.checked)?.value ?? ''; }
  // The loans due before the new date are renewed to it.
  sync() {
    const v = this.value, to = v ? day(v) : this.due, short = (d) => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    this.summary.querySelector('b').textContent = fmt(to, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    this.slip.querySelectorAll('.due').forEach((el, i) => { const b = this.books[i]; el.textContent = 'Due ' + short(b.due < to ? to : b.due); });
    this.setValue(v);
    this.request();
  }
  toggle(open) {
    if (this.plain) { this.details.open = open; return; }
    const inside = this.details.contains(this.shadowRoot.activeElement) && this.shadowRoot.activeElement !== this.summary;
    this.fold.set(open);
    if (open) (this.radios.find((r) => r.checked) ?? this.radios.find((r) => !r.disabled))?.focus({ preventScroll: true });
    else if (inside) this.summary.focus({ preventScroll: true });
  }

  draw(ctx, w, h) {
    const P = ReturnSlip.PAPER, d = this.details, wasOpen = d.open;
    const moving = this.fold.step(this.dt), e = this.fold.e;
    // The frame where the details closes still has the open picture, so it is drawn at the height it had.
    const shut = wasOpen && !d.open, full = shut ? this.full : this.slip.offsetHeight; this.full = full;
    const base = full - (d.open && !shut ? this.fold.h : 0) - (shut ? this.fold.h : 0), tall = base + this.fold.h * e;
    // The paper feeds up out of the printer: as the calendar prints, the top of the receipt rises.
    const lift = Math.max(0, P.y + tall + 6 - P.bottom), top = P.y - lift;
    ctx.drawImage(cached(this, 'desk', 360, 360, drawDesk), 0, 0, w, h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
    const paper = ctx.createLinearGradient(P.x, 0, P.x + P.w, 0); paper.addColorStop(0, '#f1f0ec'); paper.addColorStop(0.5, '#fbfbf9'); paper.addColorStop(1, '#eceae4');
    ctx.fillStyle = paper; ctx.beginPath(); ctx.moveTo(P.x, top + 2); zigzag(ctx, P.x, top + 2, P.w, -1); ctx.lineTo(P.x + P.w, top + tall + 4); zigzag(ctx, P.x + P.w, top + tall + 4, -P.w, 1); ctx.closePath(); ctx.fill();
    ctx.restore();
    drawWren(ctx, P.x + P.w / 2 + 4, top + 38);
    ctx.save(); ctx.beginPath(); ctx.rect(P.x, top, P.w, tall); ctx.clip();
    put(ctx, this.slip, P.x, top, P.w, full);
    ctx.restore();
    return moving || shut;
  }
  // #endregion return-slip
}
customElements.define('return-slip', ReturnSlip);
