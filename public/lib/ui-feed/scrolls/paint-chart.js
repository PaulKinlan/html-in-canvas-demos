// <paint-chart>: a scroll container of colour swatches whose top rows squash into a stack of paint chips.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, hit, options, esc, rr } from '../kit.js';

const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
// As plain HTML the component's rules are gone, so a scroll container is given a height of its own.
const scroller = (el) => { el.style.cssText += 'max-height:300px;overflow-y:auto;width:100%'; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

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
