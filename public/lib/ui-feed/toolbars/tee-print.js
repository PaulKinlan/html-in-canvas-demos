// <tee-print>: a file input drop zone over a T-shirt that validates and screen-prints PNG artwork.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, clamp, easeOut, spring, TAU, reduced } from '../kit.js';
import { cached } from '../fold.js';

const HEAVY = "'Archivo Black', 'Dela Gothic One', 'Arial Black', 'Inter Display', Inter, 'Helvetica Neue', Arial, sans-serif";
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const changed = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

const INK = '#1554d1', PINK = '#f2489b', NAVY = '#1b2591';
const HEADS = { empty: ['Drop', '<em>art</em>', 'here'], over: ['Let', 'go'], small: ['Too', 'small'], type: ['Not a', 'PNG'], done: [] };
// The print area: 15 by 18 inches on the front of the shirt.
const PRINT = { x: 85, y: 70, w: 190, h: 228, inW: 15, inH: 18 };

function rulers(ctx, x, y, w, h, inW, inH, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a * 0.8; ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 0.8;
  ctx.font = `700 7px ${HEAVY}`; ctx.textAlign = 'center';
  ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + w, y - 7); ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 4); ctx.moveTo(x + w, y - 10); ctx.lineTo(x + w, y - 4);
  ctx.moveTo(x + w + 9, y); ctx.lineTo(x + w + 9, y + h); ctx.moveTo(x + w + 6, y); ctx.lineTo(x + w + 12, y); ctx.moveTo(x + w + 6, y + h); ctx.lineTo(x + w + 12, y + h); ctx.stroke();
  const label = (s, tx, ty) => { const tw = ctx.measureText(s).width + 6; ctx.fillStyle = '#f6f6f8'; ctx.fillRect(tx - tw / 2, ty - 5, tw, 9); ctx.fillStyle = INK; ctx.fillText(s, tx, ty + 2.5); };
  label(`${inW.toFixed(1)} in`, x + w / 2, y - 7);
  ctx.translate(x + w + 9, y + h / 2); ctx.rotate(-Math.PI / 2); label(`${inH.toFixed(1)} in`, 0, 0);
  ctx.restore();
}

// The number of colours in a picture, from a small copy read once on a plain canvas (never a drawable one).
let counter;
function countColours(bmp) {
  counter ??= document.createElement('canvas');
  counter.width = counter.height = 48;
  const g = counter.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, 48, 48); g.drawImage(bmp, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data, seen = new Map();
  let solid = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    solid++;
    const k = (d[i] >> 5) << 6 | (d[i + 1] >> 5) << 3 | (d[i + 2] >> 5);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return Math.max(1, [...seen.values()].filter((n) => n >= solid * 0.03).length);
}
// One ink: the picture's own alpha, and its darkness, as the strength of the ink, with a little grain.
function inkLayer(bmp, area) {
  const c = document.createElement('canvas'), W = Math.round(area.w * 3), H = Math.round(area.h * 3);
  const s = Math.min(W / bmp.width, H / bmp.height); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, [r, gr, b] = [0x15, 0x54, 0xd1];
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, a = (d[i + 3] / 255) * (1 - 0.8 * lum) * (0.82 + 0.18 * rnd(i));
    d[i] = r; d[i + 1] = gr; d[i + 2] = b; d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// The shirt on pink: its shape, shading and shadow are painted once.
function drawTee(g, w, h) {
  g.fillStyle = '#f04a9c'; g.fillRect(0, 0, w, h);
  const shirt = new Path2D('M118 -4 C140 22 220 22 242 -4 L318 24 L372 92 L372 170 L322 156 L300 136 L304 338 L56 338 L60 136 L38 156 L-12 170 L-12 92 L42 24 Z');
  g.save(); g.translate(7, 9); g.fillStyle = 'rgba(52, 28, 140, 0.55)'; g.fill(shirt); g.restore();
  const body = g.createLinearGradient(0, 0, w, h); body.addColorStop(0, '#fbfbfd'); body.addColorStop(1, '#e9ecf6');
  g.fillStyle = body; g.fill(shirt);
  g.save(); g.clip(shirt);
  // folds, in thin blue, and the collar
  g.strokeStyle = 'rgba(21, 84, 209, 0.33)'; g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = 50 + rnd(i) * 260, y = 40 + rnd(i + 5) * 290, l = 10 + rnd(i + 9) * 34, a = -1.2 + rnd(i + 2) * 0.8;
    g.lineWidth = 0.6 + rnd(i + 4) * 1.4;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.6 + 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.lineWidth = 7; g.strokeStyle = 'rgba(21, 84, 209, 0.22)';
  g.beginPath(); g.moveTo(118, -4); g.bezierCurveTo(140, 26, 220, 26, 242, -4); g.stroke();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(21, 84, 209, 0.4)';
  g.beginPath(); g.moveTo(60, 136); g.lineTo(52, 40); g.moveTo(300, 136); g.lineTo(308, 40); g.moveTo(62, 330); g.lineTo(298, 330); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(21, 84, 209, 0.6)'; g.lineWidth = 1; g.stroke(shirt);
}
function drawGrain(g, w, h) {
  for (let i = 0; i < 9000; i++) {
    const r = rnd(i * 1.37);
    g.fillStyle = r > 0.66 ? 'rgba(21,84,209,0.22)' : r > 0.33 ? 'rgba(255,255,255,0.3)' : 'rgba(240,74,156,0.16)';
    g.fillRect(rnd(i + 0.11) * w, rnd(i + 0.57) * h, 0.7, 0.7);
  }
}
// The sample artwork: a sun over three waves and the club's name, on a transparent background.
function drawSample(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.scale(w / 1500, h / 1800); w = 1500;   // drawn in units of a 1500 by 1800 sheet
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.beginPath(); g.arc(w / 2, 560, 300, 0, TAU); g.fill();
  g.lineWidth = 36; g.lineCap = 'round';
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 360, 560 + Math.sin(a) * 360); g.lineTo(w / 2 + Math.cos(a) * 470, 560 + Math.sin(a) * 470); g.stroke(); }
  g.lineWidth = 46;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let x = 80; x <= w - 80; x += 10) { const y = 1060 + k * 110 + Math.sin(x / 95 + k) * 34; x === 80 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  }
  g.font = `900 190px ${HEAVY}`; g.textAlign = 'center';
  g.fillText('SEA SWIM', w / 2, 1560); g.font = `900 120px ${HEAVY}`; g.fillText('CLUB · EST 1926', w / 2, 1720);
}

// #region tee-print
//   <tee-print name="art" min="1200" dpi="300"></tee-print>
// An <input type="file" accept="image/png"> covers the whole control and is drawn with no alpha, so a click
// or a dropped file anywhere lands on it. A label for it is the "Browse files" button. A PNG that is big
// enough is printed onto the shirt in one ink at its size in inches; anything else changes the headline.
export class TeePrint extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static html = `<input type="file" id="file" accept="image/png,.png" aria-describedby="hint">
    <p class="plate head" aria-hidden="true"></p><h2 class="head"></h2>
    <label class="browse" for="file">Browse files</label><p class="hint" id="hint"></p>
    <button type="button" class="alt"></button>
    <p class="fname"></p><p class="facts"></p><label class="replace" for="file">Replace</label><button type="button" class="remove">✕</button>
    <output class="said" role="status"></output>`;
  static css = `
    [hidden] { display: none !important; }
    input { width: 360px; height: 360px; opacity: 0; cursor: pointer; }
    .head { width: max-content; margin: 0; color: ${NAVY}; font: 900 84px/0.82 ${HEAVY}; letter-spacing: -2px; text-transform: uppercase; font-stretch: expanded; }
    .head span { display: block; } .head span:nth-child(2) { text-align: center; } .head em { font-style: normal; color: ${PINK}; }
    .plate { color: ${PINK}; } .plate em { color: #3046e0; }
    .browse { display: block; width: 108px; height: 30px; background: ${INK}; color: #fff; text-align: center; font: 800 13.5px/30px ${HEAVY}; letter-spacing: 0.02em; box-shadow: 4px 4px 0 ${PINK}; cursor: pointer; }
    .browse:active, .replace:active, .alt:active, .remove:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 ${PINK}; }
    .hint { width: 112px; margin: 0; color: ${INK}; font: 700 9px/1.3 ${HEAVY}; }
    .alt { all: unset; color: ${INK}; font: 800 9.5px/1.6 ${HEAVY}; text-decoration: underline 1.5px; text-underline-offset: 2px; cursor: pointer; }
    .alt:focus-visible, .remove:focus-visible { outline: 2px dashed ${INK}; outline-offset: 3px; }
    .fname { width: 244px; margin: 0; color: ${NAVY}; font: 900 24px/1 ${HEAVY}; letter-spacing: -0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .facts { width: 230px; margin: 0; color: ${INK}; text-align: center; font: 700 8px/1 ${HEAVY}; opacity: 0.85; }
    .replace { display: block; width: 58px; height: 18px; border: 1.5px solid ${INK}; box-sizing: border-box; background: #fff; color: ${INK}; text-align: center; font: 800 9px/15px ${HEAVY}; box-shadow: 3px 3px 0 ${PINK}; cursor: pointer; }
    .remove { all: unset; box-sizing: border-box; width: 18px; height: 18px; border: 1.5px solid ${INK}; background: #fff; color: ${INK}; text-align: center; font: 700 11px/15px ${HEAVY}; box-shadow: 3px 3px 0 ${PINK}; cursor: pointer; }`;

  ready() {
    this.file = this.$('input'); this.headEl = this.$('h2.head'); this.plate = this.$('.plate');
    this.browse = this.$('.browse'); this.hint = this.$('.hint'); this.alt = this.$('.alt');
    this.fname = this.$('.fname'); this.facts = this.$('.facts'); this.replace = this.$('.replace'); this.remove = this.$('.remove'); this.said = this.$('.said');
    this.min = +this.getAttribute('min') || 1200; this.dpi = +this.getAttribute('dpi') || 300;
    this.reg = { x: 0, v: 0 }; this.inked = -1e9;
    this.file.addEventListener('change', () => this.take(this.file.files[0]));
    // a file dragged over the shirt changes the headline until it is dropped or leaves
    this.file.addEventListener('dragenter', () => { if (this.state !== 'over') { this.before = this.state; this.set('over'); } });
    this.file.addEventListener('dragleave', () => { if (this.state === 'over') this.set(this.before); });
    this.file.addEventListener('drop', () => { if (this.state === 'over') this.set(this.before); });
    this.alt.addEventListener('click', () => this.kept && this.state !== 'done' && this.state !== 'empty' ? this.keep() : this.sample());
    this.remove.addEventListener('click', () => this.clear());
    this.set('empty');
  }
  set(state, hint) {
    const was = this.state;
    this.state = state;
    const lines = HEADS[state].map((l) => `<span>${l}</span>`).join('');
    this.headEl.innerHTML = lines; this.plate.innerHTML = lines;
    this.headEl.hidden = this.plate.hidden = !lines;
    for (const el of [this.fname, this.facts, this.replace, this.remove]) el.hidden = state !== 'done';
    for (const el of [this.browse, this.hint, this.alt]) el.hidden = state === 'done';
    this.hint.textContent = hint ?? `PNG with a transparent background, at ${this.dpi} dpi. I print up to ${PRINT.inW} × ${PRINT.inH} in.`;
    this.alt.textContent = this.kept && state !== 'empty' ? `Keep ${this.kept.name}` : 'No artwork yet? Use the sample';
    this.remove.setAttribute('aria-label', `Remove ${this.kept?.name ?? 'the artwork'}`);
    // the new headline comes in with its two inks out of register, and they settle together
    if (was && was !== state && !reduced()) { this.reg.x = 1; this.reg.v = 0; }
    this.request();
  }
  async take(f) {
    if (!f) return;
    const say = (s) => { this.said.textContent = s; };
    const png = f.type === 'image/png' || /\.png$/i.test(f.name);
    if (!png) { say('1 file rejected.'); return this.set('type', `${f.name} isn't a PNG. Export it as a PNG with a transparent background.`); }
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { say('1 file rejected.'); return this.set('type', `${f.name} couldn't be read as a PNG.`); }
    const { width: w, height: h } = bmp;
    if (Math.min(w, h) < this.min) {
      bmp.close(); say('1 file rejected.');
      return this.set('small', `${f.name} is ${w} × ${h} px: ${(w / this.dpi).toFixed(1)} × ${(h / this.dpi).toFixed(1)} in at ${this.dpi} dpi. Send ${this.min} px or more.`);
    }
    this.kept = f;
    this.art = { w, h, colours: countColours(bmp), ink: inkLayer(bmp, PRINT) };
    bmp.close();
    const inW = Math.min(PRINT.inW, w / this.dpi), inH = Math.min(PRINT.inH, h / this.dpi), fit = Math.min(inW / (w / this.dpi), inH / (h / this.dpi));
    this.art.inW = (w / this.dpi) * fit; this.art.inH = (h / this.dpi) * fit;
    this.fname.textContent = f.name;
    this.facts.textContent = `${Math.max(1, Math.round(f.size / 1000))} kB · ${w} × ${h} px at ${this.dpi} dpi · ${this.art.colours} colour${this.art.colours === 1 ? '' : 's'}`;
    this.inked = performance.now();
    say(`1 file accepted. ${f.name} prints at ${this.art.inW.toFixed(1)} by ${this.art.inH.toFixed(1)} in.`);
    this.send();
    this.set('done');
    changed(this);
  }
  send() {
    const fd = new FormData();
    if (this.kept && this.art) fd.append(this.getAttribute('name') ?? 'art', this.kept);
    this.setValue(fd);
  }
  keep() {
    const dt = new DataTransfer(); dt.items.add(this.kept); this.file.files = dt.files;
    this.said.textContent = `Kept ${this.kept.name}.`;
    this.set('done');
  }
  clear() {
    const name = this.kept?.name;
    this.kept = null; this.art = null; this.file.value = '';
    this.said.textContent = `${name} removed.`;
    this.send(); this.set('empty'); changed(this);
    this.file.focus({ preventScroll: true });
  }
  // The sample is drawn on a plain canvas and turned into a PNG file when you ask for it.
  async sample() {
    const c = document.createElement('canvas'); c.width = 1800; c.height = 2100;
    drawSample(c.getContext('2d'), 1800, 2100);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    const f = new File([blob], 'sea-swim-club.png', { type: 'image/png' }), dt = new DataTransfer();
    dt.items.add(f); this.file.files = dt.files;
    this.take(f);
  }

  draw(ctx, w, h, now) {
    ctx.drawImage(cached(this, 'tee', w, h, drawTee), 0, 0, w, h);
    let moving = spring(this.reg, 0, this.dt, 120, 14);
    const done = this.state === 'done' && this.art;
    if (done) {
      // the print, wiped on from the top as if by a squeegee, at its size in inches
      const t = reduced() ? 1 : clamp((now - this.inked) / 700), u = PRINT.w / PRINT.inW;
      const aw = this.art.inW * u, ah = this.art.inH * u, ax = PRINT.x + (PRINT.w - aw) / 2, ay = PRINT.y + 8;
      ctx.save(); ctx.beginPath(); ctx.rect(ax - 2, ay - 2, aw + 4, (ah + 4) * easeOut(t)); ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.art.ink, ax, ay, aw, ah);
      ctx.restore();
      if (t < 1) { ctx.fillStyle = 'rgba(27,37,145,0.5)'; ctx.fillRect(ax - 6, ay + ah * easeOut(t) - 1, aw + 12, 2.5); moving = true; }
      rulers(ctx, ax, ay, aw, ah, this.art.inW, this.art.inH, clamp(t * 2 - 1));
      hit(ctx, this.file, 0, 0, w, h);
      put(ctx, this.facts, 180 - 115, 304);
      put(ctx, this.fname, 14, 322);
      put(ctx, this.replace, 262, 328);
      put(ctx, this.remove, 327, 328);
    } else {
      // The headline in two inks: a pink plate under the navy one, offset, coming into register. Both are
      // drawn up to 1.3 times wider than they are laid out, which stands in for an extended face.
      const o = 2.4 + this.reg.x * 16, hw = Math.min(this.headEl.offsetWidth * 1.3, 344), hh = this.headEl.offsetHeight;
      ctx.save();
      ctx.globalAlpha = 1 - this.reg.x * 0.45;
      put(ctx, this.plate, 8 + o, 10 + o * 0.6, hw, hh);
      put(ctx, this.headEl, 8 - this.reg.x * 6, 10 - this.reg.x * 3, hw, hh);
      ctx.restore();
      // the input goes over the headline, so a press on the big letters opens the picker too
      hit(ctx, this.file, 0, 0, w, h);
      put(ctx, this.browse, 64, 252);
      put(ctx, this.hint, 180, 250);
      put(ctx, this.alt, 64, 292);
    }
    // The file input has no picture of its own here, so its focus ring is drawn round the button it is under.
    if (this.shadowRoot.activeElement === this.file && this.file.matches(':focus-visible')) {
      const b = done ? [262, 328, 58, 18] : [64, 252, 108, 30];
      ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(b[0] - 4, b[1] - 4, b[2] + 8, b[3] + 8); ctx.restore();
    }
    // grain over everything, as on a print
    ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(cached(this, 'grain', w, h, drawGrain), 0, 0, w, h); ctx.restore();
    return moving;
  }
}
customElements.define('tee-print', TeePrint);
// #endregion tee-print
