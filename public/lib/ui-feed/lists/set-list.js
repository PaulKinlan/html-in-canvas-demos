// <set-list>: a button for each song and a text field to add one, drawn as strips of tape on a stage.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, easeOut, spring, TAU, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const MARKER = "'Permanent Marker', 'Marker Felt', 'Arial Black', 'Impact', sans-serif";
const HAND = "'Caveat', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive";
const MONO = "'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

const toSeconds = (t) => { const m = /^(\d+):(\d\d)$/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : 0; };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function drawStage(g) {
  const bg = g.createRadialGradient(150, 160, 30, 180, 180, 330); bg.addColorStop(0, '#3a2a1e'); bg.addColorStop(0.6, '#221812'); bg.addColorStop(1, '#0d0907');
  g.fillStyle = bg; g.fillRect(0, 0, 360, 360);
  // scuffs, gaffer marks and dust on the floor
  for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${rnd(i) > 0.5 ? '160,130,100' : '0,0,0'},${0.05 + rnd(i + 1) * 0.12})`; g.lineWidth = 0.4 + rnd(i + 2) * 1.6; const x = rnd(i + 3) * 360, y = rnd(i + 4) * 360, l = 10 + rnd(i + 5) * 60, a = (rnd(i + 6) - 0.5) * 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(220,200,170,${rnd(i + 9) * 0.08})`; g.fillRect(rnd(i + 7) * 360, rnd(i + 8) * 360, 1, 1); }
  // the corner of a monitor speaker and its cable
  g.save(); g.translate(318, -6); g.rotate(0.5);
  const box = g.createLinearGradient(-40, 0, 40, 0); box.addColorStop(0, '#2a2a2a'); box.addColorStop(1, '#0a0a0a');
  g.fillStyle = box; g.fillRect(-46, 0, 92, 70); g.fillStyle = '#151515'; g.beginPath(); g.arc(0, 34, 24, 0, TAU); g.fill();
  g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.arc(0, 34, 24, 0, TAU); g.stroke(); g.restore();
  g.strokeStyle = '#0b0b0b'; g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(326, 62); g.bezierCurveTo(286, 140, 350, 210, 300, 262); g.stroke();
}
// A strip of tape with torn ends, from x 0 to w.
function tape(ctx, w, h, seed, colour) {
  ctx.beginPath(); ctx.moveTo(0, 1);
  for (let x = 0; x <= w; x += 7) ctx.lineTo(x, (rnd(seed + x) - 0.5) * 1.6);
  for (let y = 0; y <= h; y += 3) ctx.lineTo(w + (rnd(seed + y * 3) - 0.5) * 4, y);
  for (let x = w; x >= 0; x -= 7) ctx.lineTo(x, h + (rnd(seed + x * 2) - 0.5) * 1.6);
  for (let y = h; y >= 0; y -= 3) ctx.lineTo((rnd(seed + y * 5) - 0.5) * 4, y);
  ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
  // the paper of the tape: a few fibres, lighter at one edge
  ctx.save(); ctx.clip(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h * 0.3);
  ctx.globalAlpha = 0.12; ctx.strokeStyle = '#5a3d1c'; ctx.lineWidth = 0.6;
  for (let i = 0; i < w / 9; i++) { const x = rnd(seed + i * 11) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 3, h); ctx.stroke(); }
  ctx.restore();
}

export class SetList extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static LIST = { x: 22, y: 12, row: 34 };
  static css = `
    ol { width: 236px; margin: 0; padding: 0; list-style: none; }
    li { height: 34px; display: flow-root; }
    li.leaving { position: absolute; left: 0; }
    button.song, input.add { display: flex; align-items: baseline; gap: 7px; height: 26px; margin-top: 3px; padding: 0 9px; border: 0; background: transparent; color: #17110b; cursor: pointer; white-space: nowrap; }
    button.song b { font: 400 19px/26px ${MARKER}; letter-spacing: 0.04em; text-transform: uppercase; }
    button.song i { font: 400 12px/1 ${HAND}; color: #3b2a19; }
    button.song small { font: 400 8px/1 ${MONO}; color: #3b2a19; }
    button.song:focus-visible { outline: 2px dashed #ff2e88; outline-offset: 1px; }
    input.add { width: 150px; outline: 0; font: 400 17px/26px ${MARKER}; letter-spacing: 0.04em; text-transform: uppercase; caret-color: #ff2e88; cursor: text; }
    input.add::placeholder { color: rgba(23,17,11,0.4); }
    .card { width: 118px; padding: 9px 10px 8px; box-sizing: border-box; color: #2b2b2b; font: 400 7px/1.35 ${MONO}; text-transform: uppercase; }
    .card output { display: block; margin-top: 4px; font: 400 10px/1 ${MARKER}; }
    .card output b { font: 400 25px/1 ${MARKER}; }`;

  ready() {
    this.rows = new Map();                // li -> { y, peel, born } springs and times for each strip
    this.build();
    const root = this.shadowRoot;
    root.addEventListener('keydown', (e) => this.key(e));
    root.addEventListener('focusin', () => this.request());
  }

  // #region set-list
  build() {
    const box = this.canvas ?? this.$('.plain');
    this.ol = node(`<ol aria-label="${esc(this.getAttribute('label') ?? 'Setlist')}"></ol>`);
    this.add = document.createElement('input');
    Object.assign(this.add, { type: 'text', className: 'add', placeholder: 'Add a song', autocomplete: 'off', spellcheck: false, enterKeyHint: 'done' });
    this.add.setAttribute('aria-label', 'Add a song, with its length after it, as in Encore 4:10');
    this.card = node(`<div class="card"><div>${esc(this.getAttribute('venue') ?? '')}</div><div>${esc(this.getAttribute('date') ?? '')}</div><div>${esc(this.getAttribute('times') ?? '')}</div><output aria-live="polite"></output></div>`);
    const last = document.createElement('li'); last.className = 'new'; last.append(this.add);
    this.ol.append(last);
    for (const o of options(this)) this.ol.insertBefore(this.song(o.label, o.data.time, o.data.note), last);
    box.replaceChildren(this.ol, this.card);
    this.sync();
  }
  song(title, time = '', note = '') {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="song" data-time="${esc(time)}" aria-label="${esc(title)}${time ? ', ' + esc(time) : ''}${note ? ', ' + esc(note) : ''}. Delete removes it."><b>${esc(title)}</b>${note ? `<i>${esc(note)}</i>` : ''}<small>${esc(time)}</small></button>`;
    return li;
  }
  get songs() { return [...this.ol.querySelectorAll('li:not(.leaving) button.song')]; }
  get value() { return this.songs.map((b) => b.querySelector('b').textContent); }
  sync() {
    const data = new FormData(), name = this.getAttribute('name') || 'song';
    for (const t of this.value) data.append(name, t);
    this.setValue(data);
    const total = this.songs.reduce((s, b) => s + toSeconds(b.dataset.time), 0);
    this.card.querySelector('output').innerHTML = `Set <b>${clock(total)}</b>`;
    this.request();
  }
  // Enter in the field adds a song ("Title 4:20"). Backspace in an empty field goes to the last song.
  // Delete or Backspace on a song takes it off; the arrow keys move between songs.
  key(e) {
    const t = e.target, songs = this.songs, i = songs.indexOf(t);
    if (t === this.add) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const m = /^(.*?)(?:\s+(\d{1,2}:\d\d))?$/.exec(this.add.value.trim());
        if (!m || !m[1]) return;
        const li = this.song(m[1], m[2] ?? '');
        this.ol.insertBefore(li, this.add.parentElement);
        this.rows.set(li, { y: { x: li.offsetTop, v: 0 }, born: performance.now() });
        this.add.value = ''; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (e.key === 'Backspace' && !this.add.value && songs.length) { e.preventDefault(); songs.at(-1).focus({ preventScroll: true }); }
      if (e.key === 'ArrowUp' && songs.length) { e.preventDefault(); songs.at(-1).focus({ preventScroll: true }); }
      return;
    }
    if (i < 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); (songs[i + 1] ?? this.add).focus({ preventScroll: true }); }
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); songs[i - 1].focus({ preventScroll: true }); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(songs[i]); }
  }
  // The strip is taken out of the flow at once, so the others close up, and is drawn peeling off until it goes.
  remove(button) {
    const songs = this.songs, i = songs.indexOf(button), li = button.closest('li');
    (songs[i + 1] ?? songs[i - 1] ?? this.add).focus({ preventScroll: true });
    const top = li.offsetTop;
    li.classList.add('leaving'); li.style.top = top + 'px'; li.inert = true;
    const row = this.rows.get(li) ?? { y: { x: top, v: 0 } }; row.peel = performance.now(); this.rows.set(li, row);
    if (reduced() || this.plain) li.remove();
    this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  draw(ctx, w, h, now) {
    const { x: LX, y: LY } = SetList.LIST;
    let moving = false;
    ctx.drawImage(cached(this, 'stage', 360, 360, drawStage), 0, 0, w, h);
    const focus = this.shadowRoot.activeElement;
    for (const li of this.ol.children) {
      const row = this.rows.get(li) ?? { y: { x: li.offsetTop, v: 0 } }; this.rows.set(li, row);
      const target = li.offsetTop;
      moving = spring(row.y, target, this.dt, 190, 20) || moving;
      const b = li.firstElementChild, y = LY + row.y.x, bw = li.classList.contains('new') ? 150 : b.offsetWidth;
      const born = row.born ? clamp((now - row.born) / 260) : 1, peel = row.peel ? clamp((now - row.peel) / 450) : 0;
      if (born < 1 || (peel > 0 && peel < 1)) moving = true;
      if (peel >= 1) { li.remove(); this.rows.delete(li); continue; }
      const lift = b === focus ? 1 : 0, seed = (b.textContent.length * 37 + bw) | 0;
      ctx.save();
      ctx.translate(LX + bw * (1 - peel) * 0, y + 3);
      // peeling: the strip lifts from its right end and goes up and away
      if (peel) { ctx.translate(bw * 0.1, -18 * easeOut(peel)); ctx.rotate(-0.35 * easeOut(peel)); ctx.globalAlpha = 1 - peel ** 2; }
      if (lift) { ctx.rotate(-0.012); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4; }
      const tw = bw * easeOut(born);
      // the pink tab that holds the strip down, then the strip, then the song on it
      ctx.save(); ctx.translate(-14, 8); ctx.rotate(-0.08); tape(ctx, 24, 12, seed + 5, '#ff2e88'); ctx.restore();
      tape(ctx, Math.max(4, tw), 26, seed, li.classList.contains('new') ? '#9c7a50' : '#c69c66');
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); ctx.rect(-4, -4, tw + 8, 34); ctx.clip();
      put(ctx, this.ol, 0, -li.offsetTop - 3);
      ctx.restore();
    }
    // the song buttons answer where the strips come to rest
    hit(ctx, this.ol, LX, LY);
    // the running order card, pinned at an angle
    ctx.save(); ctx.translate(238, 262); ctx.rotate(-0.05);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ece6d6'; ctx.fillRect(0, 0, 118, 86); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(120,140,190,0.35)'; ctx.lineWidth = 0.6; for (let y = 22; y < 86; y += 9) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(114, y); ctx.stroke(); }
    put(ctx, this.card, 0, 0);
    ctx.save(); ctx.translate(50, -6); ctx.rotate(0.1); tape(ctx, 26, 11, 77, 'rgba(255,46,136,0.9)'); ctx.restore();
    ctx.restore();
    return moving;
  }
  // #endregion set-list
}
customElements.define('set-list', SetList);
