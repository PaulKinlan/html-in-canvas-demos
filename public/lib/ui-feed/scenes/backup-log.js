// <backup-log>: a <table role="treegrid"> drawn as a green screen waterfall with rows sliding on springs.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, spring } from '../kit.js';
import { cached } from '../fold.js';

const MONO = "'IBM Plex Mono', 'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

const GREEN = '#5dff9a', DIM = 'rgba(93,255,154,0.55)';
const hms = (s) => { const [h, m, x] = String(s).split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
const fmt = (v) => `${String(Math.floor(v / 3600)).padStart(2, '0')}:${String(Math.floor(v / 60) % 60).padStart(2, '0')}:${String(Math.round(v % 60)).padStart(2, '0')}`;
const span = (v) => `${Math.floor(v / 60)} min ${Math.round(v % 60)} s`;

export class BackupLog extends FeedControl {
  static size = [360, 360];
  static radius = 10;
  static CHART = { x: 150, w: 186, top: 48, row: 24 };
  static css = `
    table { width: 336px; border-collapse: collapse; color: ${GREEN}; font: 400 11.5px/1 ${MONO}; }
    tr { height: 24px; outline: 0; }
    th { width: 132px; padding: 0; text-align: left; font-weight: 400; white-space: nowrap; }
    td { padding: 0 0 0 8px; color: transparent; font-size: 9.5px; white-space: nowrap; }   /* read out; the canvas writes it beside the bar */
    tr[aria-level="2"] th { padding-left: 14px; } tr[aria-level="3"] th { padding-left: 24px; }
    tr[aria-expanded] th::before { content: '\\25BE '; } tr[aria-expanded="false"] th::before { content: '\\25B8 '; }
    tr[aria-selected="true"] th { background: ${GREEN}; color: #041b0c; }
    tr[hidden] { display: none; }
    output { width: 336px; display: grid; grid-template-columns: 1fr auto; gap: 3px 0; color: ${GREEN}; font: 400 11px/1.15 ${MONO}; }
    output b { font-weight: 700; } output span:nth-child(even) { text-align: right; }`;

  ready() { this.build(); }

  // #region backup-log
  build() {
    const box = this.canvas ?? this.$('.plain');
    // Each <option> is a job: data-level for its depth in the tree, data-start and data-end, data-photos, data-mb.
    this.jobs = options(this).map((o) => ({ ...o, level: +(o.data.level ?? 1), t0: hms(o.data.start), t1: hms(o.data.end) }));
    this.jobs.forEach((j, i) => { j.parent = -1; for (let k = i - 1; k >= 0; k--) if (this.jobs[k].level < j.level) { j.parent = k; break; } j.kids = 0; });
    this.jobs.forEach((j) => { if (j.parent >= 0) this.jobs[j.parent].kids++; });
    this.from = hms(this.getAttribute('from') ?? '02:00'); this.to = hms(this.getAttribute('to') ?? '02:45');
    this.table = node(`<table role="treegrid" aria-label="Nightly backup jobs"><tbody>${this.jobs.map((j, i) => `<tr role="row" aria-level="${j.level}"${j.kids ? ' aria-expanded="true"' : ''} aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-i="${i}"><th role="rowheader">${esc(j.label)}</th><td role="gridcell">${j.data.photos ? `${esc(j.data.photos)} photos` : ''}</td></tr>`).join('')}</tbody></table>`);
    this.rows = [...this.table.querySelectorAll('tr')];
    this.foot = node('<output aria-live="polite"></output>');
    box.replaceChildren(this.table, this.foot);
    this.ys = this.rows.map(() => ({ x: -1, v: 0 }));
    this.table.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i; if (tr.hasAttribute('aria-expanded') && e.target.closest('th') && this.sel === i) this.toggle(i); this.pick(i); });
    this.table.addEventListener('keydown', (e) => this.key(e));
    this.sel = 0; this.pick(0);
  }
  visible() { return this.rows.filter((r) => !r.hidden); }
  pick(i, focus = false) {
    this.sel = i;
    this.rows.forEach((r, k) => { r.setAttribute('aria-selected', String(k === i)); r.tabIndex = k === i ? 0 : -1; });
    if (focus) this.rows[i].focus({ preventScroll: true });
    // A job with no count of its own counts the photos of the jobs under it.
    const j = this.jobs[i], photos = j.data.photos ?? this.jobs.filter((x, k) => this.under(k, i)).reduce((s, x) => s + +(x.data.photos ?? 0), 0);
    this.foot.innerHTML = `<b>${esc(j.label)}</b><b>${span(j.t1 - j.t0)}</b><span>${fmt(j.t0)} to ${fmt(j.t1)}</span><span>${photos ? `${esc(photos)} photos` : ''}${j.data.mb ? `  ${esc(j.data.mb)} MB` : ''}</span>`;
    this.setValue(j.value);
    this.request();
  }
  under(k, i) { for (let p = this.jobs[k].parent; p >= 0; p = this.jobs[p].parent) if (p === i) return true; return false; }
  toggle(i, open = this.rows[i].getAttribute('aria-expanded') !== 'true') {
    if (!this.rows[i].hasAttribute('aria-expanded')) return;
    this.rows[i].setAttribute('aria-expanded', String(open));
    // A row is shown when every row above it in the tree is open.
    this.jobs.forEach((j, k) => { let show = true; for (let p = j.parent; p >= 0; p = this.jobs[p].parent) if (this.rows[p].getAttribute('aria-expanded') === 'false') show = false; this.rows[k].hidden = !show; });
    this.request();
  }
  // The keys of a treegrid's rows: Up and Down, Home and End, Right opens or goes in, Left closes or goes out.
  key(e) {
    const vis = this.visible(), at = vis.indexOf(this.rows[this.sel]), row = this.rows[this.sel], j = this.jobs[this.sel];
    const go = (r) => r && this.pick(+r.dataset.i, true);
    const moves = {
      ArrowDown: () => go(vis[at + 1]), ArrowUp: () => go(vis[at - 1]), Home: () => go(vis[0]), End: () => go(vis.at(-1)),
      ArrowRight: () => (row.getAttribute('aria-expanded') === 'false' ? this.toggle(this.sel, true) : go(vis[at + 1]?.getAttribute('aria-level') > row.getAttribute('aria-level') ? vis[at + 1] : null)),
      ArrowLeft: () => (row.getAttribute('aria-expanded') === 'true' ? this.toggle(this.sel, false) : go(this.rows[j.parent])),
      Enter: () => this.toggle(this.sel),
    };
    if (!moves[e.key]) return;
    e.preventDefault(); moves[e.key]();
  }

  draw(ctx, w, h) {
    const C = BackupLog.CHART, T = this.table, px = (t) => C.x + (t - this.from) / (this.to - this.from) * C.w;
    let moving = false;
    ctx.fillStyle = '#04140a'; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(180, 170, 40, 180, 180, 260); glow.addColorStop(0, 'rgba(30,90,50,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.shadowColor = 'rgba(93,255,154,0.7)'; ctx.shadowBlur = 5;
    // the time axis, and the moment the fibre went down
    ctx.fillStyle = DIM; ctx.font = `400 10px ${MONO}`; ctx.fillText(this.getAttribute('date') ?? '', 12, 26);
    ctx.textAlign = 'center';
    for (let t = this.from; t <= this.to; t += 900) ctx.fillText(fmt(t).slice(0, 5), px(t), 26);
    ctx.textAlign = 'left';
    const ev = this.getAttribute('event'), evT = ev ? hms(ev.split(' ')[0]) : 0;
    // Each row is drawn as a slice of the table's picture at a y that follows its place on a spring, so
    // the rows under one that closes slide up rather than jump.
    const vis = this.visible(), bottom = C.top + vis.length * C.row;
    for (let t = this.from; t <= this.to; t += 900) { ctx.fillStyle = 'rgba(93,255,154,0.18)'; for (let y = C.top - 6; y < bottom; y += 4) ctx.fillRect(px(t), y, 1, 2); }
    if (ev) { ctx.fillStyle = GREEN; for (let y = 32; y < bottom; y += 5) ctx.fillRect(px(evT), y, 1.2, 3); ctx.fillText(ev.split(' ').slice(1).join(' '), px(evT) + 5, 42); }
    this.rows.forEach((r, i) => {
      const s = this.ys[i];
      if (r.hidden) { s.x = -1; return; }
      const want = C.top + vis.indexOf(r) * C.row;
      if (s.x < 0) s.x = want;
      moving = spring(s, want, this.dt, 260, 26) || moving;
      const y = s.x, j = this.jobs[i];
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, C.row); ctx.clip();
      put(ctx, T, 12, y - r.offsetTop, T.offsetWidth, T.offsetHeight);
      ctx.restore();
      // the bar: a bracket for a job with children, a block for one without
      const x0 = px(j.t0), x1 = Math.max(px(j.t1), x0 + 3), cy = y + C.row / 2;
      ctx.fillStyle = GREEN;
      if (j.kids) { ctx.fillRect(x0, cy - 0.6, x1 - x0, 1.2); ctx.fillRect(x0, cy - 5, 1.2, 10); ctx.fillRect(x1 - 1.2, cy - 5, 1.2, 10); }
      else ctx.fillRect(x0, cy - 5, x1 - x0, 10);
      if (j.data.photos) { ctx.fillStyle = DIM; ctx.font = `400 9.5px ${MONO}`; ctx.fillText(`${j.data.photos} photos`, x1 + 4, cy + 3.5); }
      if (this.shadowRoot.activeElement === r) { ctx.strokeStyle = GREEN; ctx.setLineDash([3, 2]); ctx.strokeRect(10.5, y + 1.5, 136, C.row - 3); ctx.setLineDash([]); }
    });
    // The table's hit region goes back to where it is laid out, so a click finds the row under it.
    if (!moving) hit(ctx, T, 12, C.top - (this.rows.find((r) => !r.hidden)?.offsetTop ?? 0));
    ctx.fillStyle = DIM; ctx.fillRect(12, 304, 336, 1);
    put(ctx, this.foot, 12, 312);
    ctx.restore();
    // scan lines and the curve of the glass
    ctx.drawImage(cached(this, 'crt', 360, 360, (g) => { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < 360; y += 3) g.fillRect(0, y, 360, 1); const v = g.createRadialGradient(180, 180, 150, 180, 180, 260); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = v; g.fillRect(0, 0, 360, 360); }), 0, 0, w, h);
    return moving;
  }
  // #endregion backup-log
}
customElements.define('backup-log', BackupLog);
