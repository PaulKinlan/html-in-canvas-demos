// <track-scroll>: a scroll container of tracks with a drawn thumb that reveals a reversed copy beside it.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, rr, spring } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const GROT = "'Syne', 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";
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
