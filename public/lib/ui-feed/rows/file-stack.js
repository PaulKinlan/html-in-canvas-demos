// <file-stack>: a <ul> of files and a file input whose rows share the canvas height, scaled to fit.
// Standalone ES module; only depends on ../kit.js.

import { FeedControl, put, hit, options, esc, spring } from '../kit.js';

const SLAB = "'Roboto Slab', 'Zilla Slab', Rockwell, 'DejaVu Serif', Georgia, serif";
const BROWNS = [['#3a221d', '#f6e5c6'], ['#6a3c26', '#f6e5c6'], ['#9c5e33', '#f6e5c6'], ['#cc9150', '#3a221d']];
const ADD = ['#f0dbb5', '#3a221d'];
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const box = (c) => c.canvas ?? c.$('.plain');
const within = (el, top) => { let x = 0, y = 0; for (let n = el; n && n !== top; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };

export class FileStack extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static ROW = 72;               // every row is laid out this tall, and drawn scaled to its share of the height
  static RIGHT = 74;             // the column the remove buttons sit in, at that size
  static css = `
    ul { width: 360px; margin: 0; padding: 0; list-style: none; font-family: ${SLAB}; }
    li, label.add { position: relative; display: flex; align-items: center; width: 360px; height: 72px; box-sizing: border-box; padding: 0 17px 0 23px; color: var(--ink); }
    .nm { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: clip; font: 700 34px/1 ${SLAB}; letter-spacing: -0.02em; }
    .nm span { font-weight: 400; opacity: 0.62; }
    button { all: unset; box-sizing: border-box; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 3px; cursor: pointer; color: var(--ink); }
    button svg, .add svg { width: 26px; height: 26px; pointer-events: none; }
    button:active { background: var(--ink); color: var(--bg); }
    label.add { cursor: pointer; font: 700 34px/1 ${SLAB}; letter-spacing: -0.02em; justify-content: space-between; }
    label.add svg { margin-right: 7px; }
    label.add input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    label.add:active { filter: brightness(0.9); }
    .sr { width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }`;

  ready() {
    this.build();
  }

  // #region file-stack
  build() {
    this.name = this.getAttribute('name') ?? 'files';
    this.ul = node(`<ul aria-label="${esc(this.getAttribute('label') ?? 'Files')}"></ul>`);
    this.add = node(`<label class="add" style="--ink:${ADD[1]};--bg:${ADD[0]}"><span>${esc(this.getAttribute('add') ?? 'Add files')}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.8" fill="none"/></svg><input type="file" multiple></label>`);
    this.status = node('<output role="status" class="sr"></output>');
    this.input = this.add.querySelector('input');
    box(this).replaceChildren(this.ul, this.add, this.status);
    this.items = []; this.made = 0;
    this.addH = { x: -1, v: 0 };
    // Files named in <option> children are listed as empty File objects, so the form sends their names.
    for (const o of options(this)) this.push(new File([], o.label), true);
    this.input.addEventListener('change', () => {
      const files = [...this.input.files];
      files.forEach((f) => this.push(f));
      this.input.value = '';
      this.say(files.length === 1 ? `${files[0].name} added.` : `${files.length} files added.`);
    });
    this.ul.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.remove(this.items.find((it) => it.btn === b)); });
    this.sync();
  }
  push(file, settled = false) {
    const [bg, ink] = BROWNS[this.made++ % BROWNS.length], dot = file.name.lastIndexOf('.');
    const base = dot > 0 ? file.name.slice(0, dot) : file.name, ext = dot > 0 ? file.name.slice(dot) : '';
    const li = document.createElement('li');
    li.style.cssText = `--bg:${bg};--ink:${ink}`;
    li.innerHTML = `<span class="nm">${esc(base)}<span>${esc(ext)}</span></span><button type="button" aria-label="Remove ${esc(file.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></button>`;
    this.ul.append(li);
    this.items.push({ file, li, btn: li.querySelector('button'), bg, h: { x: settled ? -1 : 0, v: 0 }, gone: false });
    this.sync();
  }
  remove(it) {
    if (!it || it.gone) return;
    it.gone = true;
    it.li.inert = true;                 // it stays in the list, out of reach, until its row has closed
    const live = this.items.filter((x) => !x.gone), next = live.find((x) => this.items.indexOf(x) > this.items.indexOf(it));
    (next?.btn ?? this.input).focus({ preventScroll: true });
    this.say(`${it.file.name} removed.`);
    this.sync();
  }
  say(text) { this.status.textContent = text; }
  sync() {
    const fd = new FormData();
    for (const it of this.items) if (!it.gone) fd.append(this.name, it.file);
    this.setValue(fd);
    this.request();
  }

  // One row: its background, then two draws of the element scaled by s. The first is cut to the name, from
  // the left. The second is cut to the button column and moved so that the button lands on the right edge.
  // The second draw is the one the element's hit region follows.
  row(ctx, el, top, y, rh, bg, w) {
    const s = rh / FileStack.ROW, R = FileStack.RIGHT * s, H = el.offsetHeight;
    ctx.fillStyle = bg; ctx.fillRect(0, y, w, rh + 0.5);
    ctx.save(); ctx.beginPath(); ctx.rect(0, y, w - R, rh); ctx.clip();
    put(ctx, el, 0, y - top * s, 360 * s, H * s); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(w - R, y, R, rh); ctx.clip();
    put(ctx, el, w - 360 * s, y - top * s, 360 * s, H * s); ctx.restore();
    return s;
  }

  draw(ctx, w, h) {
    const live = this.items.filter((x) => !x.gone).length, share = h / (live + 1), ROW = FileStack.ROW;
    let moving = false, y = 0, settle = false;
    for (const it of this.items) {
      if (it.h.x < 0) it.h.x = share;
      moving = spring(it.h, it.gone ? 0 : share, this.dt, 240, 26) || moving;
      if (it.gone && it.h.x < 0.5) settle = true;
    }
    if (this.addH.x < 0) this.addH.x = share;
    moving = spring(this.addH, share, this.dt, 240, 26) || moving;
    // The rows are scaled to fill the height exactly, so a spring that overshoots never leaves a gap.
    const total = this.items.reduce((t, it) => t + Math.max(0, it.h.x), 0) + this.addH.x, fit = h / total;
    this.items.forEach((it, i) => {
      const rh = Math.max(0, it.h.x) * fit;
      if (rh > 0.2) this.row(ctx, this.ul, i * ROW, y, rh, it.bg, w);
      if (it.btn.matches(':focus-visible') && rh > 4) {
        const s = rh / ROW, b = within(it.btn, it.li);
        ctx.save(); ctx.strokeStyle = getComputedStyle(it.li).getPropertyValue('--ink'); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.strokeRect(w - (360 - b.x) * s - 3, y + b.y * s - 3, b.w * s + 6, b.h * s + 6); ctx.restore();
      }
      y += rh;
    });
    const ah = this.addH.x * fit;
    this.row(ctx, this.add, 0, y, ah, ADD[0], w);
    hit(ctx, this.add, 0, y, w, ah);       // the whole bottom row opens the file picker
    if (this.input.matches(':focus-visible')) { ctx.save(); ctx.strokeStyle = ADD[1]; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.strokeRect(4, y + 4, w - 8, ah - 8); ctx.restore(); }
    // A closed row leaves the list in the next frame (the layout changes outside the paint handler).
    if (settle && !this.sweep) this.sweep = requestAnimationFrame(() => {
      this.sweep = 0;
      this.items = this.items.filter((it) => { if (it.gone && it.h.x < 0.5) { it.li.remove(); return false; } return true; });
      this.request();
    });
    return moving;
  }
  // #endregion file-stack
}
customElements.define('file-stack', FileStack);
