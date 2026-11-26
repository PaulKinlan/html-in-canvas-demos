// <glaze-radios>: radios drawn as a segmented control that wipes a new glaze over a mug.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU, reduced } from '../kit.js';
import { cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const NARROW = "'Cormorant Garamond', 'Bodoni 72 Smallcaps', 'Didot', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const mix = (a, b, t) => { const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// #region glaze-mug
const GLAZES = {
  celadon: { base: '#a9c5a1', deep: '#7fa682', ridge: '#8fb38e', rim: '#c3d9b9', speck: 'rgba(70,100,70,0.35)', gloss: 0.5, thumb: '#b4cfab' },
  tenmoku: { base: '#231814', deep: '#0e0907', ridge: '#8c3d16', rim: '#a8521f', speck: 'rgba(190,96,40,0.5)', gloss: 0.9, thumb: '#3a2a22' },
  shino: { base: '#efe7dc', deep: '#d9cdbd', ridge: '#eb8a55', rim: '#ef7f45', speck: 'rgba(120,70,40,0.5)', gloss: 0.35, thumb: '#f4e9dc' },
  cobalt: { base: '#2445a8', deep: '#142a72', ridge: '#16307f', rim: '#5d7fd6', speck: 'rgba(10,20,70,0.5)', gloss: 0.8, thumb: '#3557c0' },
};
// A thrown mug, 300 by 250 units, in one glaze. Every glaze is drawn on the same shape so that one can be
// wiped over another.
function drawMug(g, z, seed = 1) {
  const L = 44, Rr = 206, T = 26, B = 220, rim = 13;
  const body = new Path2D(); body.moveTo(L, T); body.lineTo(L + 3, B - 14); body.quadraticCurveTo(L + 4, B, L + 22, B + 2); body.lineTo(Rr - 22, B + 2); body.quadraticCurveTo(Rr - 4, B, Rr - 3, B - 14); body.lineTo(Rr, T); body.ellipse((L + Rr) / 2, T, (Rr - L) / 2, rim, 0, 0, Math.PI, true); body.closePath();
  // the handle, behind the body
  const handle = new Path2D(); handle.moveTo(Rr - 8, 62); handle.bezierCurveTo(Rr + 44, 40, Rr + 66, 78, Rr + 52, 122); handle.bezierCurveTo(Rr + 40, 158, Rr + 14, 168, Rr - 8, 176);
  g.lineCap = 'round';
  g.strokeStyle = z.deep; g.lineWidth = 19; g.stroke(handle);
  g.strokeStyle = z.base; g.lineWidth = 14; g.stroke(handle);
  g.save(); g.translate(-3, -3); g.strokeStyle = `rgba(255,255,255,${0.2 + z.gloss * 0.3})`; g.lineWidth = 3; g.stroke(handle); g.restore();
  g.strokeStyle = z.ridge; g.globalAlpha = 0.5; g.lineWidth = 3; g.save(); g.translate(4, 4); g.stroke(handle); g.restore(); g.globalAlpha = 1;
  // the body
  g.fillStyle = z.base; g.fill(body);
  g.save(); g.clip(body);
  // throwing rings: the glaze pools dark in each groove and breaks on each ridge
  for (let i = 0; i < 10; i++) {
    const y = T + 22 + i * 18 + (rnd(seed + i) - 0.5) * 9, hgt = 4 + rnd(seed + i + 20) * 7;
    const band = g.createLinearGradient(0, y - hgt, 0, y + hgt); band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.5, z.ridge); band.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.25 + rnd(seed + i + 40) * 0.45; g.fillStyle = band;
    g.beginPath(); g.moveTo(L - 2, y - hgt); g.quadraticCurveTo((L + Rr) / 2, y - hgt + 9, Rr + 2, y - hgt); g.lineTo(Rr + 2, y + hgt); g.quadraticCurveTo((L + Rr) / 2, y + hgt + 9, L - 2, y + hgt); g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
  // speckle, pinholes and runs
  for (let i = 0; i < 260; i++) { g.fillStyle = z.speck; const r = 0.3 + rnd(seed + i * 3) ** 3 * 1.6; g.beginPath(); g.arc(L + rnd(seed + i * 3 + 1) * (Rr - L), T + rnd(seed + i * 3 + 2) * (B - T), r, 0, TAU); g.fill(); }
  // the unglazed foot
  const foot = g.createLinearGradient(0, B - 12, 0, B + 2); foot.addColorStop(0, '#d2a878'); foot.addColorStop(1, '#b98a58');
  g.fillStyle = foot; g.beginPath(); g.moveTo(L - 2, B - 10); g.quadraticCurveTo((L + Rr) / 2, B - 2, Rr + 2, B - 10); g.lineTo(Rr + 2, B + 4); g.lineTo(L - 2, B + 4); g.closePath(); g.fill();
  for (let i = 0; i < 90; i++) { g.fillStyle = rnd(i + 5) > 0.5 ? 'rgba(90,50,20,0.5)' : 'rgba(255,230,190,0.5)'; g.fillRect(L + rnd(seed + i + 300) * (Rr - L), B - 9 + rnd(seed + i + 400) * 11, 1.2, 1.2); }
  // the round of the cylinder: light from the upper left, dark toward the right edge
  const round = g.createLinearGradient(L, 0, Rr, 0); round.addColorStop(0, 'rgba(0,0,0,0.16)'); round.addColorStop(0.16, `rgba(255,255,255,${0.1 + z.gloss * 0.22})`); round.addColorStop(0.34, 'rgba(255,255,255,0)'); round.addColorStop(0.7, 'rgba(0,0,0,0.06)'); round.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = round; g.fillRect(L - 2, T - rim, Rr - L + 4, B - T + rim + 6);
  g.restore();
  // the mouth: the inside, then the lip where the glaze runs thin
  const cx = (L + Rr) / 2;
  const inside = g.createLinearGradient(L, T - rim, Rr, T + rim); inside.addColorStop(0, z.deep); inside.addColorStop(0.6, z.base); inside.addColorStop(1, z.rim);
  g.fillStyle = inside; g.beginPath(); g.ellipse(cx, T, (Rr - L) / 2, rim, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(cx - 6, T + 2, (Rr - L) / 2 - 12, rim - 4, 0, 0, TAU); g.fill();
  g.strokeStyle = z.rim; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, T, (Rr - L) / 2 - 1, rim, 0, 0, TAU); g.stroke();
  g.strokeStyle = `rgba(255,255,255,${0.25 + z.gloss * 0.3})`; g.lineWidth = 1.2; g.beginPath(); g.ellipse(cx, T - 0.5, (Rr - L) / 2 - 1, rim, 0, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
}
// #endregion glaze-mug

export class GlazeRadios extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BAR = { x: 13, y: 284, w: 334, h: 61, pad: 4 };
  static css = `
    input { opacity: 0; margin: 0; height: 53px; cursor: pointer; }
    label { height: 53px; text-align: center; font: 400 18px/53px ${NARROW}; letter-spacing: -0.02em; color: #fbe3d6; white-space: nowrap; }
    output { width: 320px; font: 500 12.5px/1.3 ${SANS}; color: #fde9df; }`;
  static observedAttributes = ['value'];

  ready() {
    this.canvas?.setAttribute('role', 'radiogroup');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['label', 'data-note'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.sync(true); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region glaze-radios
  build() {
    const list = this.list = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren();
    (this.canvas ?? box).ariaLabel = this.getAttribute('label') ?? 'Glaze';
    const B = GlazeRadios.BAR, tw = this.tw = (B.w - B.pad * 2) / Math.max(1, list.length);
    this.radios = []; this.labels = [];
    list.forEach((o, i) => {
      const r = node(`<input type="radio" name="glaze" id="g${i}" value="${esc(o.value)}">`); r.style.width = `${tw}px`;
      const l = node(`<label for="g${i}">${esc(o.label)}</label>`); l.style.width = `${tw}px`;
      box.append(r, l); this.radios.push(r); this.labels.push(l);
    });
    this.note = node('<output aria-live="polite"></output>'); box.append(this.note);
    const at = Math.max(0, list.findIndex((o) => o.value === was), was ? -1 : list.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.pos = { x: at, v: 0 }; this.shown = at; this.from = at; this.wipe = 1; this.fade = 1;
    this.sync(false);
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v); this.sync(true); this.request(); }
  glaze(i) { return GLAZES[this.list[i]?.value] ?? GLAZES.celadon; }
  sync(animate) {
    const i = this.index;
    this.note.value = this.list[i]?.data.note ?? '';
    if (animate && i !== this.shown) {
      // the mug that shows now becomes the one underneath, and the new glaze is wiped over it
      if (this.wipe > 0.5) this.from = this.shown;
      this.shown = i; this.wipe = reduced() ? 1 : 0; this.fade = reduced() ? 1 : 0;
    }
    this.setValue(this.value);
  }

  draw(ctx, w, h) {
    const B = GlazeRadios.BAR, n = this.radios.length;
    let moving = spring(this.pos, this.index, this.dt, 260, 24);
    if (this.wipe < 1) { this.wipe = Math.min(1, this.wipe + this.dt / 0.55); moving = true; }
    if (this.fade < 1) { this.fade = Math.min(1, this.fade + this.dt / 0.4); moving = true; }
    const ground = ctx.createLinearGradient(0, 0, w, h); ground.addColorStop(0, '#f2470a'); ground.addColorStop(1, '#ea3c06');
    ctx.fillStyle = ground; ctx.fillRect(0, 0, w, h);
    // the shadow the mug throws to the right
    ctx.save(); ctx.filter = 'blur(5px)'; ctx.fillStyle = 'rgba(120,20,0,0.5)';
    ctx.beginPath(); ctx.ellipse(232, 205, 86, 21, -0.12, 0, TAU); ctx.fill(); ctx.restore();
    // the mug in the glaze before, then the new glaze over it from the right edge to the left
    const MX = 22, MY = 14, mug = (i) => cached(this, `mug${i}`, 300, 250, (g) => drawMug(g, this.glaze(i), 3));
    if (this.wipe < 1) ctx.drawImage(mug(this.from), MX, MY, 300, 250);
    const edge = lerp(MX + 300, MX, smooth(this.wipe));
    ctx.save(); ctx.beginPath(); ctx.rect(edge, 0, w - edge, h); ctx.clip();
    ctx.drawImage(mug(this.shown), MX, MY, 300, 250);
    ctx.restore();
    // the words for the glaze come in as it does
    ctx.save(); ctx.globalAlpha = smooth(this.fade); put(ctx, this.note, 31, 256); ctx.restore();
    // the bar, the thumb in the colour of the glaze, and the names
    ctx.fillStyle = '#c42f05'; rr(ctx, B.x, B.y, B.w, B.h, B.h / 2); ctx.fill();
    const x = this.pos.x, near = clamp(Math.round(x), 0, n - 1), tx = B.x + B.pad + x * this.tw, squash = clamp(Math.abs(this.pos.v) * 0.012, 0, 0.16);
    const tint = mix(this.glaze(this.from).thumb, this.glaze(this.shown).thumb, smooth(this.wipe));
    this.labels.forEach((l, i) => put(ctx, l, B.x + B.pad + i * this.tw, B.y + B.pad));
    ctx.save();
    rr(ctx, tx - this.tw * squash / 2, B.y + B.pad + 53 * squash / 2, this.tw * (1 + squash), 53 * (1 - squash), 27); ctx.clip();
    ctx.fillStyle = tint; ctx.fillRect(0, B.y, w, B.h);
    // the names again, dark or light to suit the thumb, seen only through it
    const dark = this.glaze(near).gloss > 0.6;
    ctx.filter = dark ? 'brightness(0) invert(1)' : 'brightness(0)'; ctx.globalAlpha = 0.86;
    this.labels.forEach((l, i) => put(ctx, l, B.x + B.pad + i * this.tw, B.y + B.pad));
    ctx.restore();
    // the radios are drawn last, with no alpha, so that a tap on a name answers the radio and not its label
    this.radios.forEach((r, i) => hit(ctx, r, B.x + B.pad + i * this.tw, B.y + B.pad));
    const f = this.shadowRoot.activeElement;
    if (f?.type === 'radio' && f.matches(':focus-visible')) focusRing(ctx, tx + 3, B.y + B.pad + 3, this.tw - 6, 47);
    return moving;
  }
  // #endregion glaze-radios
}
customElements.define('glaze-radios', GlazeRadios);
