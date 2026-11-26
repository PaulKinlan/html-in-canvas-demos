// <tulip-carousel>: a scroll-snap scroller of slides paired with a radio for each slide.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, TAU, reduced } from '../kit.js';
import { cached, focusRing } from '../fold.js';

const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Bodoni 72', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// A tulip in a glass, 130 by 330 units. `shape` is "lily" for pointed petals that flare, else a cup.
function drawTulip(g, o) {
  const petal = o.petal ?? '#e2231a', dark = o.dark ?? '#9c0f0f', lily = o.shape === 'lily';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const vx = 44, vw = 36, vt = 212, vb = 318, water = 284;
  // the far wall of the glass and the water
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(vx, vt, vw, vb - vt);
  g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(vx + 1, water, vw - 2, vb - water);
  // stem and leaf
  const stem = new Path2D(); stem.moveTo(vx + vw * 0.56, vb - 6); stem.bezierCurveTo(vx + vw * 0.5, 240, 70, 150, 66, 74);
  g.strokeStyle = '#3d7a23'; g.lineWidth = 4.4; g.stroke(stem);
  g.strokeStyle = '#7fb944'; g.lineWidth = 1.5; g.save(); g.translate(-1, 0); g.stroke(stem); g.restore();
  const leaf = g.createLinearGradient(20, 100, 66, 210); leaf.addColorStop(0, '#a9c98a'); leaf.addColorStop(0.5, '#5c9a3a'); leaf.addColorStop(1, '#2f6a1f');
  g.fillStyle = leaf; g.beginPath(); g.moveTo(63, 214); g.bezierCurveTo(52, 170, 34, 140, 10, 112); g.bezierCurveTo(40, 118, 62, 150, 67, 200); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(62, 204); g.bezierCurveTo(52, 166, 36, 138, 14, 114); g.stroke();
  // the flower: two petals behind and one in front
  const cx = 66, cy = 74, hgt = lily ? 62 : 54, wid = lily ? 20 : 23;
  const one = (dx, lean, shade, tip) => {
    const grad = g.createLinearGradient(cx + dx - wid, cy - hgt, cx + dx + wid, cy); grad.addColorStop(0, shade ? dark : petal); grad.addColorStop(0.55, petal); grad.addColorStop(1, dark);
    g.fillStyle = grad; g.beginPath(); g.moveTo(cx, cy);
    g.bezierCurveTo(cx + dx - wid, cy - hgt * 0.25, cx + dx - wid * (lily ? 0.5 : 0.95), cy - hgt * 0.8, cx + dx + lean, cy - hgt * tip);
    g.bezierCurveTo(cx + dx + wid * (lily ? 0.5 : 0.95), cy - hgt * 0.8, cx + dx + wid, cy - hgt * 0.25, cx, cy); g.fill();
  };
  one(-wid * 0.62, lily ? -15 : -3, true, lily ? 1.02 : 0.96); one(wid * 0.62, lily ? 15 : 3, true, lily ? 1.02 : 0.96); one(0, 0, false, lily ? 0.92 : 1);
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(cx - 5, cy - 8); g.quadraticCurveTo(cx - 9, cy - hgt * 0.55, cx - 3, cy - hgt * 0.84); g.stroke();
  // the near wall of the glass: edges, the surface of the water, the thick base and a long highlight
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(vx, vt); g.lineTo(vx, vb - 2); g.moveTo(vx + vw, vt); g.lineTo(vx + vw, vb - 2); g.stroke();
  g.beginPath(); g.ellipse(vx + vw / 2, vt, vw / 2, 3, 0, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(vx + vw / 2, water, vw / 2 - 1, 2.4, 0, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(vx + vw / 2, vb - 2, vw / 2, 3.4, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.26)'; g.fillRect(vx + 5, vt + 8, 2.6, vb - vt - 20);
  g.save(); g.filter = 'blur(3px)'; g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(vx + vw / 2 + 16, vb + 2, 34, 3.5, 0, 0, TAU); g.fill(); g.restore();
}

export class TulipCarousel extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    .track { display: flex; width: 360px; height: 360px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; outline: 0; }
    .track.held { scroll-snap-type: none; cursor: grabbing; }
    article { position: relative; flex: none; width: 360px; height: 360px; overflow: hidden; scroll-snap-align: start; scroll-snap-stop: always; color: #fff; }
    h3 { position: absolute; left: 16px; top: 98px; margin: 0; font: 400 74px/1 ${DISPLAY}; letter-spacing: -0.045em; white-space: nowrap; }
    p { position: absolute; left: 17px; top: 186px; margin: 0; font: 500 11px/1 ${SANS}; }
    p span { margin-left: 8px; opacity: 0.75; }
    input { opacity: 0; width: 66px; height: 32px; margin: 0; cursor: pointer; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['label', 'data-kind', 'data-height', 'data-ground', 'data-petal', 'data-dark', 'data-shape'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.go(this.radios.indexOf(e.target)); this.commit(); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region tulip-carousel
  build() {
    const list = this.list = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren(); this.pictures?.clear();
    const track = this.track = node(`<div class="track" tabindex="0" role="region" aria-roledescription="carousel" aria-label="${esc(this.getAttribute('label') ?? 'Tulip varieties')}">${list.map((o, i) => `<article aria-label="${i + 1} of ${list.length}" style="background:${esc(o.data.ground ?? '#e8540c')}"><h3>${esc(o.label)}</h3><p>${esc(o.data.kind ?? '')}<span>${esc(o.data.height ?? '')}</span></p></article>`).join('')}</div>`);
    box.append(track);
    this.radios = list.map((o) => { const r = node(`<input type="radio" name="slide" value="${esc(o.value)}" aria-label="${esc(o.label)}">`); box.append(r); return r; });
    const at = Math.max(0, list.findIndex((o) => o.value === was), was ? -1 : list.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    track.scrollLeft = at * 360;
    this.heading = -1;
    // The scroller scrolls by itself: touch, wheel and arrow keys. The radios follow where it comes to rest.
    track.addEventListener('scroll', () => {
      this.request();
      const near = clamp(Math.round(track.scrollLeft / 360), 0, list.length - 1);
      if (this.heading >= 0) { if (near === this.heading) this.heading = -1; return; }
      if (near !== this.index && !this.held) { this.radios[near].checked = true; this.commit(); }
    });
    track.addEventListener('scrollend', () => { this.heading = -1; });
    // A mouse has no drag to scroll, so the control adds one. Snapping is off while the button is down.
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button || this.plain) return;
      const x0 = e.clientX, s0 = track.scrollLeft, k = 360 / this.canvas.getBoundingClientRect().width;
      const move = (m) => { if (!this.held && Math.abs(m.clientX - x0) > 3) { this.held = true; track.classList.add('held'); } if (this.held) track.scrollLeft = s0 - (m.clientX - x0) * k; };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!this.held) return;
        const dx = track.scrollLeft - s0, near = clamp(Math.round((s0 + dx + Math.sign(dx) * 110) / 360), 0, list.length - 1);
        this.held = false;
        this.radios[near].checked = true; this.commit();
        track.scrollTo({ left: near * 360, behavior: reduced() ? 'auto' : 'smooth' });
        const done = () => { track.classList.remove('held'); track.removeEventListener('scrollend', done); clearTimeout(timer); };
        const timer = setTimeout(done, 700); track.addEventListener('scrollend', done);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
    this.setValue(this.value);
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { const i = this.radios.findIndex((r) => r.value === String(v)); if (i < 0) return; this.radios[i].checked = true; this.go(i); this.setValue(this.value); }
  // Scroll to a slide. Until the scroller arrives, the slides it passes do not check their radios.
  go(i) {
    if (Math.round(this.track.scrollLeft) === i * 360) return;
    this.heading = i;
    this.track.scrollTo({ left: i * 360, behavior: reduced() || this.plain ? 'auto' : 'smooth' });
    this.request();
  }
  commit() { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); }

  draw(ctx, w, h) {
    const sl = this.track.scrollLeft, n = this.list.length;
    put(ctx, this.track, 0, 0);
    // a tulip for each slide near the view. It moves a little faster than its slide.
    this.list.forEach((o, i) => {
      const x = i * 360 - sl;
      if (Math.abs(x) > 420) return;
      ctx.drawImage(cached(this, `tulip${i}`, 130, 330, (g) => drawTulip(g, o.data)), 226 + x * 1.16, 18, 130, 330);
    });
    // the markers: a line for each slide and a bright one that follows the scroll position
    const bw = (w - 34 - (n - 1) * 4) / Math.max(1, n), y = 338;
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    this.radios.forEach((r, i) => { hit(ctx, r, 17 + i * (bw + 4) - 2, y - 16, bw + 4, 32); ctx.fillRect(17 + i * (bw + 4), y, bw, 1.5); });
    ctx.fillStyle = '#fff'; ctx.fillRect(17 + clamp(sl / 360, 0, n - 1) * (bw + 4), y - 0.3, bw, 2.1);
    const f = this.shadowRoot.activeElement;
    if (f?.type === 'radio' && f.matches(':focus-visible')) focusRing(ctx, 17 + this.radios.indexOf(f) * (bw + 4) - 2, y - 9, bw + 4, 18);
    if (f === this.track && f.matches(':focus-visible')) focusRing(ctx, 4, 4, w - 8, h - 8);
    return false;
  }
  // #endregion tulip-carousel
}
customElements.define('tulip-carousel', TulipCarousel);
