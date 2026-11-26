// <travel-journal>: a scrapbook page with an <input type="file"> drop zone and photos tossed onto the page.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, spring, TAU, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// Where each photo lands on the page, and its tilt. Photos after these are piled near the middle.
const SLOTS = [{ x: 14, y: 104, w: 156, h: 118, r: -0.035 }, { x: 196, y: 88, w: 112, h: 152, r: 0.03 }, { x: 8, y: 236, w: 138, h: 108, r: 0.025 }, { x: 132, y: 226, w: 102, h: 126, r: -0.05 }];

export class TravelJournal extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    h2 { width: 250px; margin: 0; display: flex; flex-wrap: wrap; gap: 2px 3px; align-items: flex-end; }
    h2 span { display: inline-block; padding: 1px 4px; font: 900 18px/1 ${SANS}; color: #111; background: #fff; }
    h2 span.big { font: 900 28px/0.95 Impact, 'Anton', 'Arial Black', ${SANS}; padding: 2px 5px; }
    h2 span:nth-child(3n) { background: #f2c84b; } h2 span:nth-child(4n) { background: #111; color: #fff; }
    h2 span:nth-child(5n) { background: #e74c6b; color: #fff; font-family: Georgia, serif; } h2 span:nth-child(7n) { background: #f5a3b5; }
    h2 span.gap { width: 100%; height: 0; padding: 0; background: none; }
    p.date { width: max-content; padding: 4px 8px; background: #f3f0e6; font: 600 9px/1 ${MONO}; color: #111; }
    output.count { width: max-content; display: flex; align-items: center; gap: 6px; padding: 3px 7px 3px 3px; background: #f3f0e6; font: 800 8px/1 ${MONO}; letter-spacing: 0.08em; color: #111; }
    output.count b { padding: 2px 5px; background: #e74c6b; color: #fff; font: 900 20px/1 Impact, 'Arial Black', ${SANS}; }
    ul { width: 360px; height: 360px; margin: 0; padding: 0; list-style: none; }
    li { position: absolute; padding: 5px 5px 0; background: #fbfaf5; box-sizing: border-box; }
    li .pic { display: block; width: 100%; background: #9aa; object-fit: cover; }
    li p { margin: 0; display: flex; align-items: center; gap: 6px; height: 22px; font: 600 8.5px/1 ${MONO}; color: #111; white-space: nowrap; overflow: hidden; }
    li time { padding: 2px 4px; background: #111; color: #fff; font: 700 9px/1 ${MONO}; }
    label.drop { display: grid; place-items: center; align-content: center; gap: 6px; width: 112px; height: 104px; border: 0; color: #fff; text-align: center; font: 800 10px/1.2 ${MONO}; letter-spacing: 0.04em; cursor: pointer; }
    label.drop small { font: 500 7px/1 ${MONO}; opacity: 0.85; }
    label.drop span.add { padding: 4px 7px; background: #f2c84b; color: #111; font: 800 8px/1 ${MONO}; }
    label.drop input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    output.status { width: 360px; font: 600 9px/1.2 ${MONO}; color: #fff; text-align: right; }`;

  ready() {
    this.added = [];
    this.build();
    this.addEventListener('feed-plain', () => { for (const li of this.list.children) li.style.position = 'static'; });
  }

  // #region travel-journal
  build() {
    const box = this.canvas ?? this.$('.plain');
    const day = esc(this.getAttribute('day') ?? '1'), place = esc(this.getAttribute('place') ?? '');
    // The heading is cut out letter by letter, like a ransom note. Each letter is a span, read as one word.
    const cut = (s, cls) => [...s].map((c) => `<span class="${cls}" aria-hidden="true">${esc(c)}</span>`).join('');
    this.head = node(`<h2 aria-label="Day ${day}, ${place}">${cut('DAY', '')}${cut(day, 'big')}<span class="gap"></span>${cut(place.toUpperCase(), 'big')}</h2>`);
    this.date = node(`<p class="date">${esc(this.getAttribute('date') ?? '')}</p>`);
    this.count = node('<output class="count"><b>0</b>PHOTOS</output>');
    this.list = node('<ul aria-label="Photos"></ul>');
    this.drop = node(`<label class="drop"><span>DROP PHOTOS<br>HERE</span><small>JPG · PNG · WebP</small><span class="add">+ ADD PHOTOS</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple></label>`);
    this.file = this.drop.querySelector('input');
    this.status = node('<output class="status" role="status"></output>');
    box.replaceChildren(this.head, this.date, this.count, this.list, this.drop, this.status);
    // The photos the page starts with are <option>s. Their pictures are painted by the canvas.
    for (const o of options(this)) this.add({ time: o.data.time, title: o.label, scene: o.data.scene, start: true });
    this.file.addEventListener('change', () => this.take([...this.file.files]));
    // A file dragged over the zone: the input takes the drop itself, and the zone is drawn lit while it is over.
    this.file.addEventListener('dragenter', () => { this.over = true; this.request(); });
    this.file.addEventListener('dragleave', () => { this.over = false; this.request(); });
    this.file.addEventListener('drop', () => { this.over = false; });
    this.sync();
  }
  // Files from the input. Only pictures are taken; the rest are named in the status line.
  take(files) {
    const ok = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)), bad = files.filter((f) => !ok.includes(f));
    for (const f of ok) {
      const at = new Date(f.lastModified || Date.now());
      this.add({ time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`, title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: f });
    }
    this.status.textContent = `${ok.length} ${ok.length === 1 ? 'file' : 'files'} accepted.${bad.length ? ` ${bad.map((f) => f.name).join(', ')} ${bad.length === 1 ? 'is not a' : 'are not'} JPG, PNG or WebP.` : ''}`;
    this.sync();
  }
  add({ time, title, scene, file, start }) {
    const i = this.added.length, slot = SLOTS[i] ?? { x: 70 + rnd(i) * 120, y: 110 + rnd(i + 1) * 120, w: 130, h: 116, r: (rnd(i + 2) - 0.5) * 0.24 };
    const li = document.createElement('li');
    li.style.cssText = `left:${slot.x}px;top:${slot.y}px;width:${slot.w}px;height:${slot.h}px`;
    const url = file ? URL.createObjectURL(file) : '';
    li.innerHTML = `${file ? `<img class="pic" alt="${esc(title)}" src="${url}">` : `<span class="pic" role="img" aria-label="${esc(title)}"></span>`}<p><time>${esc(time ?? '')}</time>${esc(title)}</p>`;
    li.querySelector('.pic').style.height = `${slot.h - 27}px`;
    this.list.append(li);
    // A new photo is tossed on: it falls from above the page, turning, and lands on its slot.
    this.added.push({ li, slot, scene, file, y: { x: start ? 0 : -1, v: 0 }, url });
    li.querySelector('img')?.addEventListener('load', () => this.request());
  }
  sync() {
    this.count.querySelector('b').textContent = this.added.length;
    const fd = new FormData(), name = this.getAttribute('name') ?? 'photos';
    for (const a of this.added) if (a.file) fd.append(name, a.file);
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h, now) {
    let moving = false;
    ctx.drawImage(cached(this, 'felt', 360, 360, felt), 0, 0, w, h);
    put(ctx, this.head, 12, 12);
    put(ctx, this.date, 214, 70);
    put(ctx, this.count, 268, 14);
    // The list is laid out as one element. Each photo is drawn as a slice of its picture, turned, with tape.
    const L = this.list;
    for (const a of this.added) {
      moving = spring(a.y, 0, this.dt, 120, 14) || moving;
      const s = a.slot, fall = a.y.x, cx = s.x + s.w / 2, cy = s.y + s.h / 2 + fall * 300;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(s.r + fall * 0.9); ctx.translate(-s.w / 2, -s.h / 2);
      ctx.shadowColor = 'rgba(0,0,20,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, s.w, s.h);
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip();
      put(ctx, L, -s.x, -s.y, L.offsetWidth, L.offsetHeight);
      if (!a.file) ctx.drawImage(cached(this, 'scene-' + a.scene + s.w, s.w - 10, s.h - 27, (g, sw, sh) => scene(g, a.scene, sw, sh)), 5, 5, s.w - 10, s.h - 27);
      ctx.restore();
      // a strip of tape across the top
      ctx.save(); ctx.translate(cx, cy - s.h / 2); ctx.rotate(s.r * 2 - 0.2 + fall); ctx.fillStyle = 'rgba(240,232,200,0.75)'; ctx.fillRect(-18, -6, 36, 12); ctx.restore();
    }
    hit(ctx, L, -2000, 0);
    // the drop zone: blue, with a dashed edge that runs while a file is over it, and scissors
    const Z = { x: 236, y: 244, w: 112, h: 104 };
    ctx.fillStyle = '#1946d8'; ctx.fillRect(Z.x, Z.y, Z.w, Z.h);
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = this.over ? 2 : 1.2; ctx.setLineDash([4, 3]);
    if (this.over && !reduced()) { ctx.lineDashOffset = -now / 40; moving = true; }
    ctx.strokeRect(Z.x + 3, Z.y + 3, Z.w - 6, Z.h - 6); ctx.restore();
    if (this.over) { ctx.fillStyle = 'rgba(242,200,75,0.25)'; ctx.fillRect(Z.x, Z.y, Z.w, Z.h); }
    put(ctx, this.drop, Z.x, Z.y, Z.w, Z.h);
    if (this.shadowRoot.activeElement === this.file) { ctx.save(); ctx.strokeStyle = '#f2c84b'; ctx.lineWidth = 2.5; ctx.strokeRect(Z.x - 2, Z.y - 2, Z.w + 4, Z.h + 4); ctx.restore(); }
    put(ctx, this.status, 0, 350);
    return moving;
  }
  // #endregion travel-journal
}
customElements.define('travel-journal', TravelJournal);

function felt(g) {
  g.fillStyle = '#1f4fd6'; g.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 3200; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '120,160,255' : '0,10,80'},${0.08 + rnd(i + 1) * 0.12})`; g.fillRect(rnd(i + 2) * 360, rnd(i + 3) * 360, 1 + rnd(i + 4) * 2, 1); }
}

// Four little paintings for the photos the page starts with, so that no picture is borrowed.
function scene(g, kind, w, h) {
  const sky = (a, b) => { const s = g.createLinearGradient(0, 0, 0, h); s.addColorStop(0, a); s.addColorStop(1, b); g.fillStyle = s; g.fillRect(0, 0, w, h); };
  if (kind === 'town') {
    sky('#f3b38c', '#c9a6b8');
    for (let row = 0; row < 7; row++) for (let i = 0; i < 9; i++) {
      const bw = 12 + rnd(row * 9 + i) * 14, x = i * (w / 8) - 6 + rnd(i + row) * 6, y = h * 0.3 + row * h * 0.1 + rnd(row + i * 3) * 6;
      g.fillStyle = `hsl(${30 + rnd(i * row) * 12}, ${30 + rnd(i) * 15}%, ${58 + rnd(row * 7 + i) * 22 - row * 3}%)`; g.fillRect(x, y, bw, h * 0.12);
      g.fillStyle = 'rgba(60,40,40,0.55)'; g.fillRect(x + bw * 0.35, y + h * 0.05, 2.5, 4);
    }
    g.fillStyle = '#c9b29c'; g.fillRect(w * 0.62, h * 0.12, 7, h * 0.22); g.beginPath(); g.moveTo(w * 0.62 - 2, h * 0.12); g.lineTo(w * 0.62 + 3.5, h * 0.05); g.lineTo(w * 0.62 + 9, h * 0.12); g.fill();
  } else if (kind === 'bread') {
    sky('#5b4636', '#2b211b');
    g.fillStyle = '#8a6a4b'; g.fillRect(0, h * 0.62, w, h);
    const loaf = g.createRadialGradient(w * 0.45, h * 0.42, 4, w * 0.5, h * 0.52, w * 0.42); loaf.addColorStop(0, '#e8b779'); loaf.addColorStop(0.6, '#b97a3e'); loaf.addColorStop(1, '#6b3f1d');
    g.fillStyle = loaf; g.beginPath(); g.ellipse(w * 0.5, h * 0.55, w * 0.38, h * 0.26, -0.15, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(250,220,170,0.7)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(w * (0.3 + i * 0.15), h * 0.42); g.quadraticCurveTo(w * (0.36 + i * 0.15), h * 0.5, w * (0.33 + i * 0.15), h * 0.66); g.stroke(); }
  } else if (kind === 'steps') {
    sky('#e9dcc2', '#b9a183');
    g.fillStyle = '#d8c6a5'; g.fillRect(0, 0, w * 0.22, h); g.fillRect(w * 0.78, 0, w, h);
    for (let i = 0; i < 12; i++) { const y = h * 0.35 + i * h * 0.055, inset = (12 - i) * w * 0.012; g.fillStyle = i % 2 ? '#c4ad89' : '#a8916f'; g.fillRect(w * 0.22 + inset, y, w * 0.56 - inset * 2, h * 0.055); }
    g.fillStyle = 'rgba(80,60,40,0.35)'; for (let i = 0; i < 6; i++) g.fillRect(w * (0.04 + (i % 2) * 0.8), h * (0.15 + i * 0.12), 8, 12);
  } else {
    sky('#dfe7ec', '#c3ccd1');
    g.fillStyle = '#e9e3d6'; g.fillRect(w * 0.15, h * 0.2, w * 0.7, h * 0.8);
    g.fillStyle = '#2c5aa0'; g.beginPath(); g.ellipse(w * 0.5, h * 0.6, w * 0.16, h * 0.17, 0, 0, TAU); g.fill();
    g.fillStyle = '#c0392b'; g.beginPath(); g.moveTo(w * 0.5, h * 0.33); g.lineTo(w * 0.58, h * 0.45); g.lineTo(w * 0.44, h * 0.45); g.fill();
    g.fillStyle = '#f2c84b'; g.beginPath(); g.moveTo(w * 0.62, h * 0.48); g.lineTo(w * 0.72, h * 0.5); g.lineTo(w * 0.62, h * 0.53); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.55, h * 0.47, 2.5, 0, TAU); g.fill();
  }
  // a little grain, as a print has
  for (let i = 0; i < w * h / 40; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '0,0,0'},0.06)`; g.fillRect(rnd(i + 1) * w, rnd(i + 2) * h, 1, 1); }
}
