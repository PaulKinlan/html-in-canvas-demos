// <kiln-timeline>: kiln firing programme on a real-time segmented LCD backed by an <ol> of buttons.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, hit, options, esc, lerp, rr, reduced } from '../kit.js';
import { focusRing } from '../fold.js';

const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
// A character on fourteen segments, for the names on the display.
const SEG14 = { R: 'abefpqm', A: 'abcefpq', M: 'bcefhj', P: 'abefpq', H: 'bcefpq', O: 'abcdef', L: 'def', D: 'abcdil', C: 'adef', E: 'adefpq', N: 'bcefhm', F: 'aefpq', I: 'adil', T: 'ail', S: 'afpqcd', U: 'bcdef', K: 'efpjm', G: 'acdefq', B: 'abcdilq', W: 'bcefkm', X: 'hjkm', Y: 'hjl', V: 'efkj', ' ': '' };
function seg14(ctx, ch, x, y, w, h, colour) {
  const lit = SEG14[ch] ?? '', t = w * 0.17, m = y + h / 2, g = t * 0.3;
  ctx.save(); ctx.transform(1, 0, -0.06, 1, (y + h) * 0.06, 0); ctx.fillStyle = ctx.strokeStyle = colour; ctx.lineWidth = t * 0.85; ctx.lineCap = 'butt';
  const bar = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  const on = (s, ...p) => { if (lit.includes(s)) bar(...p); };
  on('a', x + t / 2 + g, y + t / 2, x + w - t / 2 - g, y + t / 2); on('d', x + t / 2 + g, y + h - t / 2, x + w - t / 2 - g, y + h - t / 2);
  on('f', x + t / 2, y + t / 2 + g, x + t / 2, m - g); on('e', x + t / 2, m + g, x + t / 2, y + h - t / 2 - g);
  on('b', x + w - t / 2, y + t / 2 + g, x + w - t / 2, m - g); on('c', x + w - t / 2, m + g, x + w - t / 2, y + h - t / 2 - g);
  on('p', x + t / 2 + g, m, x + w / 2 - g / 2, m); on('q', x + w / 2 + g / 2, m, x + w - t / 2 - g, m);
  on('i', x + w / 2, y + t + g, x + w / 2, m - g); on('l', x + w / 2, m + g, x + w / 2, y + h - t - g);
  on('h', x + t * 1.25, y + t * 1.3, x + w / 2 - t * 0.5, m - t * 0.7); on('j', x + w - t * 1.25, y + t * 1.3, x + w / 2 + t * 0.5, m - t * 0.7);
  on('k', x + t * 1.25, y + h - t * 1.3, x + w / 2 - t * 0.5, m + t * 0.7); on('m', x + w - t * 1.25, y + h - t * 1.3, x + w / 2 + t * 0.5, m + t * 0.7);
  ctx.restore();
}
// Figures on seven segments, with a colon and a point. Returns the width drawn.
const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const seg7Wide = (text, w, gap) => [...text].reduce((sum, c) => sum + (c === ':' ? w * 0.34 + gap : w + gap), 0) - gap;
function seg7Row(ctx, text, x, y, w, h, colour, gap) {
  const t = Math.max(1, w * 0.17), m = y + h / 2, g = t * 0.28;
  ctx.save(); ctx.transform(1, 0, -0.06, 1, (y + h) * 0.06, 0); ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = t; ctx.lineCap = 'butt';
  for (const c of text) {
    if (c === ':') { ctx.fillRect(x + w * 0.05, y + h * 0.27, t * 1.1, t * 1.1); ctx.fillRect(x + w * 0.05, y + h * 0.66, t * 1.1, t * 1.1); x += w * 0.34 + gap; continue; }
    const lit = SEG7[c] ?? '', bar = (s, x0, y0, x1, y1) => { if (lit.includes(s)) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); } };
    bar('a', x + t / 2 + g, y + t / 2, x + w - t / 2 - g, y + t / 2); bar('g', x + t / 2 + g, m, x + w - t / 2 - g, m); bar('d', x + t / 2 + g, y + h - t / 2, x + w - t / 2 - g, y + h - t / 2);
    bar('f', x + t / 2, y + t / 2 + g, x + t / 2, m - g); bar('e', x + t / 2, m + g, x + t / 2, y + h - t / 2 - g);
    bar('b', x + w - t / 2, y + t / 2 + g, x + w - t / 2, m - g); bar('c', x + w - t / 2, m + g, x + w - t / 2, y + h - t / 2 - g);
    x += w + gap;
  }
  ctx.restore();
}
const clock = (s) => { s = Math.floor(s); return [Math.floor(s / 3600), String(Math.floor(s / 60) % 60).padStart(2, '0'), String(s % 60).padStart(2, '0')]; };
const seconds = (text) => String(text ?? '0').split(':').map(Number).reduce((s, v) => s * 60 + v, 0);

export class KilnTimeline extends FeedControl {
  static size = [360, 360];
  static radius = 8;
  static fps = 4;
  static ROW = { x: 24, y: 163, h: 29.4 };
  static html = `<output class="temp" aria-live="off"></output><ol></ol>`;
  static css = `
    .temp { width: 1px; height: 1px; overflow: hidden; opacity: 0; }
    ol { width: 312px; margin: 0; padding: 0; list-style: none; }
    li { height: 29.4px; }
    button { display: block; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: none; font-size: 1px; color: transparent; cursor: pointer; touch-action: manipulation; outline: none; }`;

  ready() {
    this.out = this.$('.temp'); this.list = this.$('ol');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true });
    this.list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const i = [...this.list.querySelectorAll('button')].indexOf(b);
      this.inspect = this.inspect === i ? -1 : i;
      this.mark(); this.request();
    });
  }
  // #region kiln-program
  // The firing as segments with a start, an end and a temperature at each. A ramp or a cool has a rate in
  // degrees an hour and a temperature to reach. A hold has a number of minutes.
  build() {
    let t = 0, temp = Number(this.getAttribute('from') ?? 68);
    this.unit = this.getAttribute('unit') ?? '°F';
    this.segs = options(this).map((o, i) => {
      const kind = o.data.kind ?? 'ramp', rate = Math.abs(Number(o.data.rate) || 0), to = kind === 'hold' ? temp : Number(o.data.to ?? temp);
      const long = kind === 'hold' ? (Number(o.data.minutes) || 0) * 60 : rate ? (Math.abs(to - temp) / rate) * 3600 : 0;
      const seg = { n: i + 1, kind, rate, minutes: Number(o.data.minutes) || 0, t0: t, t1: t + long, from: temp, to };
      t += long; temp = to;
      return seg;
    });
    this.end = t;
    this.began = seconds(this.getAttribute('start') ?? '06:30') * 60;      // "06:30" is hours and minutes
    this.base = seconds(this.getAttribute('elapsed') ?? '0:00:00');
    this.speed = Number(this.getAttribute('speed') ?? 1) || 1;
    this.since = performance.now(); this.inspect ??= -1;
    const hhmm = (s) => { const [h, m] = clock(this.began + s); return `${String(h % 24).padStart(2, '0')}:${m}`; };
    this.rows = [...this.segs.map((s) => ({ time: hhmm(s.t0), name: s.kind.toUpperCase(), seg: s, text: `Segment ${s.n}, ${s.kind}: ${s.kind === 'hold' ? `${s.minutes} minutes at ${s.to} ${this.unit}` : `${s.rate} ${this.unit} an hour to ${s.to} ${this.unit}`}` })),
      { time: hhmm(this.end), name: 'END', seg: null, text: 'End: elements off' }];
    this.list.innerHTML = this.rows.map((r) => `<li><button type="button" aria-pressed="false"><time>${r.time}</time> ${esc(r.text)}</button></li>`).join('');
    this.said = ''; this.mark(); this.request();
  }
  get elapsed() { return Math.min(this.end, this.base + ((performance.now() - this.since) / 1000) * this.speed); }
  // The segment a time falls in, and the temperature then.
  state(t = this.elapsed) {
    const i = this.segs.findIndex((s) => t < s.t1), s = this.segs[i];
    if (!s) return { index: this.segs.length, temp: this.segs.at(-1)?.to ?? 0, heat: false };
    return { index: i, temp: lerp(s.from, s.to, s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 1), heat: s.kind !== 'cool' };
  }
  // #endregion kiln-program
  get value() { const s = this.state(); return s.index < this.segs.length ? String(s.index + 1) : 'end'; }
  mark() {
    const now = this.state().index;
    [...this.list.children].forEach((li, i) => { i === now ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current'); li.firstElementChild.setAttribute('aria-pressed', String(i === this.inspect)); });
    this.current = now; this.setValue(this.value);
  }

  // #region kiln-timeline
  draw(ctx, w, h) {
    const INK = '#131a04', GHOST = 'rgba(19,26,4,0.075)', { ROW } = KilnTimeline;
    const t = this.elapsed, s = this.state(t);
    if (s.index !== this.current) { this.mark(); this.dispatchEvent(new Event('change', { bubbles: true })); }
    const said = `${s.temp.toFixed(0)} ${this.unit}`;                     // the output changes once a degree, not once a frame
    if (said !== this.said) { this.said = said; this.out.value = said; }

    ctx.fillStyle = '#16180f'; ctx.fillRect(0, 0, w, h);
    const glass = ctx.createLinearGradient(0, 0, 0, h); glass.addColorStop(0, '#c8f01f'); glass.addColorStop(1, '#a9dc12');
    ctx.fillStyle = glass; rr(ctx, 9, 9, w - 18, h - 18, 4); ctx.fill();
    const edge = ctx.createLinearGradient(0, 9, 0, 30); edge.addColorStop(0, 'rgba(0,0,0,0.22)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = edge; rr(ctx, 9, 9, w - 18, 21, 4); ctx.fill();
    const small = (text, x, y, on = true, size = 6.2, align = 'left') => { ctx.fillStyle = on ? INK : GHOST; ctx.font = `700 ${size}px ${SANS}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, x, y); };
    // a number on seven segments with every segment faintly visible behind it, ending at x
    const figure = (text, cells, right, y, cw, ch, gap = cw * 0.26) => {
      seg7Row(ctx, cells, right - seg7Wide(cells, cw, gap), y, cw, ch, GHOST, gap);
      if (text !== '') seg7Row(ctx, String(text), right - seg7Wide(String(text), cw, gap), y, cw, ch, INK, gap);
    };

    small('KILN', 24, 28); small('HEAT', 336, 28, s.heat && t < this.end, 6.2, 'right');
    const [whole, tenth] = (Math.floor(s.temp * 10) / 10).toFixed(1).split('.');   // the last figure is cut, not rounded
    figure(whole, '8888', 232, 36, 41, 78); figure(tenth, '8', 292, 36, 41, 78);
    ctx.fillStyle = INK; ctx.fillRect(236, 105, 9, 9);
    small(this.unit, 308, 50, true, 15);
    const [eh, em, es] = clock(t), [ch, cm] = clock(this.began + t);
    small('ELAPSED', 24, 139); figure(`${eh}:${em}:${es}`, '88:88:88', 136, 124, 8.4, 16);
    small('TIME', 268, 139); figure(`${String(ch % 24).padStart(2, '0')}:${cm}`, '88:88', 336, 124, 8.4, 16);
    ctx.fillStyle = INK; ctx.fillRect(24, 152, 312, 1.2);

    this.rows.forEach((r, i) => {
      const y = ROW.y + i * ROW.h, mid = y + 10, shown = (i === s.index || i === this.inspect) && r.seg;
      figure(r.time, '88:88', 76, y + 2, 8.4, 16);
      // the column of marks: done, now, and still to come
      if (i < this.rows.length - 1) { ctx.fillStyle = INK; for (let d = 0; d < 4; d++) ctx.fillRect(89.5, mid + 8 + d * 4.2, 2.4, 2.4); }
      ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      if (i < s.index) ctx.fillRect(86.5, mid - 4.5, 9, 9);
      else if (i === s.index) { ctx.strokeRect(85.2, mid - 5.8, 11.6, 11.6); ctx.fillRect(87.6, mid - 3.4, 6.8, 6.8); ctx.beginPath(); ctx.moveTo(79, mid - 3); ctx.lineTo(83, mid); ctx.lineTo(79, mid + 3); ctx.fill(); }
      else ctx.strokeRect(87, mid - 4, 8, 8);
      small('SEG', 104, y + 18, Boolean(r.seg), 4.6);
      if (r.seg) figure(String(r.seg.n), '8', 128, y + 2, 8.4, 16);
      [...r.name].forEach((ch, k) => seg14(ctx, ch, 134 + k * 13.4, y + 2, 10.4, 16, INK));
      // the rate and the temperature to reach, for the segment that is running and the one that was pressed
      const hold = r.seg?.kind === 'hold';
      figure(shown ? String(hold ? r.seg.minutes : r.seg.rate) : '', '888', 234, y + 2, 8.4, 16);
      small(`${this.unit}/h`, 237, y + 9, Boolean(shown) && !hold, 5); small('MIN', 237, y + 17, Boolean(shown) && hold, 5);
      ctx.fillStyle = shown ? INK : GHOST; ctx.beginPath(); ctx.moveTo(262, mid - 3.2); ctx.lineTo(267, mid); ctx.lineTo(262, mid + 3.2); ctx.fill();
      figure(shown ? String(r.seg.to) : '', '8888', 320, y + 2, 8.4, 16);
      small(this.unit, 323, y + 18, Boolean(shown), 5.4);
      for (const side of [1, -1]) {                                      // brackets round the row that was pressed
        const bx = side > 0 ? 15 : w - 15; ctx.strokeStyle = i === this.inspect ? INK : GHOST; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(bx + side * 3.5, y - 1.5); ctx.lineTo(bx, y - 1.5); ctx.lineTo(bx, y + 21.5); ctx.lineTo(bx + side * 3.5, y + 21.5); ctx.stroke();
      }
      const button = this.list.children[i]?.firstElementChild;
      if (button?.matches(':focus-visible')) focusRing(ctx, 20, y - 3, w - 40, 26, INK);
    });
    hit(ctx, this.list, ROW.x, ROW.y - 4);
    return t < this.end && !reduced();                                   // the display runs for as long as the firing does
  }
  // #endregion kiln-timeline
}
customElements.define('kiln-timeline', KilnTimeline);
