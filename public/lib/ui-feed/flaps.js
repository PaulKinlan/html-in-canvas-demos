// ui-feed/flaps.js: controls that move like boards, blinds and decks of cards. Each is a rebuild, in
// HTML-in-canvas, of a demo on https://ui-feed.dev/ (the page that uses them links to each original).
//
//   <flap-date name="delivery" value="2026-11-20"></flap-date>
//   <blind-select name="stop"><option value="2" data-number="2">Harbour</option>…</blind-select>
//   <lift-pager name="floor" rows="1"><section>…</section>…</lift-pager>
//   <riffle-pager name="card"><section>…</section>…</riffle-pager>
//
// The pieces that tumble, roll and fan are pictures of the control's own elements, drawn in parts. A flap
// is the picture of one field clipped to its top or bottom half and squashed; a blind is one tall element
// drawn through a window; a riffled card is the same page drawn with a transform.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, easeOut, rr, spring, reduced } from './kit.js';

// #region flap-date
export class FlapDate extends FeedControl {
  static size = [360, 252];
  // One <input type="date"> is the control. The three drums are pictures of three <span>s that hold its
  // parts, so the digits are the page's own text, in the page's font.
  static html = `<input type="date"><label for="d"></label>
    <span class="cell" data-part="0"></span><span class="cell" data-part="1"></span><span class="cell" data-part="2"></span>`;
  static css = `
    input { width: 230px; height: 42px; padding: 0 10px; border: 1px solid #3a3a3a; border-radius: 8px; outline: 0;
      background: #111; color: #eee; font: 17px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color-scheme: dark; }
    input:focus-visible { border-color: #fff; box-shadow: inset 0 0 0 1px #fff; }
    label { color: #9a9a9a; font: 15px system-ui, sans-serif; }
    .cell { display: grid; place-items: center; width: 86px; height: 92px; border-radius: 6px;
      background: linear-gradient(#f7f7f5 0 50%, #e4e4e0 50% 100%); color: #15151a;
      font: 600 40px/92px 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; letter-spacing: -1px; }`;

  ready() {
    this.input = this.$('input'); this.label = this.$('label'); this.cells = this.$$('.cell');
    this.input.id = 'd';
    this.label.textContent = this.getAttribute('label') ?? 'Delivery date';
    this.input.value = this.getAttribute('value') ?? '';
    this.shown = ['', '', ''];
    this.flips = [0, 0, 0];
    // The first fill is not a flip: the drums start showing the value the page gave.
    this.shown = this.parts();
    this.cells.forEach((cell, i) => { cell.textContent = this.shown[i]; });
    this.setValue(this.input.value);
    this.input.addEventListener('input', () => { this.fill(); this.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  get value() { return this.input.value; }
  set value(v) { this.input.value = v; this.fill(); }
  parts() {
    const v = this.input.value;
    if (!v) return ['--', '--', '----'];
    const [y, m, d] = v.split('-');
    return [m, d, y];
  }
  fill() {
    const want = this.parts();
    want.forEach((text, i) => {
      if (this.cells[i].textContent === text) return;
      this.flips[i] = 1;                                 // 1 falls to 0 as the flap drops
    });
    this.setValue(this.input.value);
    this.request();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(0, 0, w, h);
    let moving = false;
    const want = this.parts();
    this.cells.forEach((cell, i) => {
      const x = 16 + i * 110, y = 20, cw = 86, ch = 92;
      // The flap is the top half of the old picture, squashed towards the middle, then the bottom half of
      // the new one rising. Both are pictures of the same element, so it is drawn with its old text first.
      const flip = this.flips[i];
      if (flip > 0) {
        moving = true;
        const step = reduced() ? 1 : this.dt * 3.4;
        this.flips[i] = Math.max(0, flip - step);
        if (flip > 0.5) {
          if (cell.textContent !== this.shown[i]) cell.textContent = this.shown[i] || want[i];
        } else if (cell.textContent !== want[i]) {
          cell.textContent = want[i];
          this.shown[i] = want[i];
        }
      } else if (cell.textContent !== want[i]) { cell.textContent = want[i]; this.shown[i] = want[i]; }

      ctx.save();
      rr(ctx, x, y, cw, ch, 6);
      ctx.clip();
      // the still halves
      const half = ch / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y + half, cw, half); ctx.clip(); put(ctx, cell, x, y, cw, ch); ctx.restore();
      if (flip <= 0) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, half); ctx.clip(); put(ctx, cell, x, y, cw, ch); ctx.restore(); }
      else {
        // the moving flap: the first half of the turn squashes the top down, the second lifts the bottom
        const t = flip > 0.5 ? (flip - 0.5) * 2 : (0.5 - flip) * 2;
        const down = flip > 0.5;
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, cw, half); ctx.clip();
        ctx.translate(x, y + half);
        ctx.scale(1, down ? smooth(t) : smooth(t));
        ctx.translate(-x, -(y + half));
        ctx.save(); ctx.beginPath(); ctx.rect(x, down ? y : y + half, cw, half); ctx.clip();
        put(ctx, cell, x, down ? y : y - half, cw, ch);
        ctx.restore();
        ctx.restore();
        ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - t)})`;
        ctx.fillRect(x, y, cw, half);
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y + half); ctx.lineTo(x + cw, y + half); ctx.stroke();
      ctx.restore();
      // the frame and its pins
      ctx.strokeStyle = '#5a5a5e'; ctx.lineWidth = 2;
      rr(ctx, x - 1, y - 1, cw + 2, ch + 2, 7); ctx.stroke();
      ctx.fillStyle = '#2a2a2e';
      for (const px of [x - 4, x + cw + 4]) { rr(ctx, px - 3, y + half - 9, 6, 18, 3); ctx.fill(); }
    });
    put(ctx, this.label, 16, 136);
    put(ctx, this.input, 16, 164);
    hit(ctx, this.input, 16, 164);
    ctx.fillStyle = '#6a6a70';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Month, day and year. The drums are the field’s own text.', 16, 236);
    return moving;
  }
}
customElements.define('flap-date', FlapDate);
// #endregion flap-date

// #region blind-select
export class BlindSelect extends FeedControl {
  static size = [360, 300];
  // The blind is one tall element with every destination on it. The canvas draws it through a window, so
  // only the chosen line and its neighbours are seen, and the <select> is the control.
  static html = `<div class="roll"></div><select></select>
    <button type="button" class="step" data-d="-1" aria-label="Previous destination">↑</button>
    <button type="button" class="step" data-d="1" aria-label="Next destination">↓</button>`;
  static css = `
    .roll { width: 320px; color: #f4c20a; font: 700 29px/72px 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif;
      text-transform: uppercase; letter-spacing: 1px; }
    .roll div { display: flex; gap: 12px; align-items: baseline; height: 72px; padding: 0 16px; box-sizing: border-box; }
    .roll b { font-size: 21px; font-weight: 400; opacity: .8; min-width: 24px; }
    .roll span { overflow: hidden; white-space: nowrap; }
    select { width: 220px; height: 40px; opacity: 0; }
    .step { width: 44px; height: 44px; margin: 0; padding: 0; border: 1px solid #585042; border-radius: 6px;
      background: #241f16; color: #f4c20a; font: 20px/40px system-ui, sans-serif; outline: 0; touch-action: manipulation; }
    .step:focus-visible { border-color: #fff; }`;

  ready() {
    this.roll = this.$('.roll'); this.select = this.$('select');
    this.pos = { x: 0, v: 0 };
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    this.select.addEventListener('change', () => { this.send(); });
    this.shadowRoot.addEventListener('click', (e) => {
      const b = e.target.closest('.step');
      if (!b) return;
      const n = this.select.options.length;
      this.select.selectedIndex = (this.select.selectedIndex + +b.dataset.d + n) % n;
      this.send();
    });
  }
  get value() { return this.select.value; }
  set value(v) { this.select.value = v; this.send(); }
  send() { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); this.request(); }
  sync() {
    const keep = this.select.value, list = options(this);
    this.select.innerHTML = list.map((o) => `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    this.roll.innerHTML = list.map((o) => `<div><b>${esc(o.data.number ?? '')}</b><span>${esc(o.label)}</span></div>`).join('');
    if (keep && [...this.select.options].some((o) => o.value === keep)) this.select.value = keep;
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h) {
    const row = this.roll.firstElementChild?.offsetHeight || 72;
    const moving = spring(this.pos, this.select.selectedIndex, this.dt, 120, 17);
    ctx.fillStyle = '#17140e';
    ctx.fillRect(0, 0, w, h);
    const win = { x: 20, y: 48, w: 320, h: 150 };
    ctx.save();
    rr(ctx, win.x, win.y, win.w, win.h, 8);
    ctx.clip();
    ctx.fillStyle = '#efb100';
    ctx.fillRect(win.x, win.y, win.w, win.h);
    // the blind, drawn once, moved so that the chosen line is in the middle of the window
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    put(ctx, this.roll, win.x, win.y + win.h / 2 - row / 2 - this.pos.x * row);
    ctx.restore();
    // the roller's shadow at the top and bottom of the window
    const sh = ctx.createLinearGradient(0, win.y, 0, win.y + 26);
    sh.addColorStop(0, 'rgba(60,40,0,0.5)'); sh.addColorStop(1, 'rgba(60,40,0,0)');
    ctx.fillStyle = sh; ctx.fillRect(win.x, win.y, win.w, 26);
    const sb = ctx.createLinearGradient(0, win.y + win.h - 26, 0, win.y + win.h);
    sb.addColorStop(0, 'rgba(60,40,0,0)'); sb.addColorStop(1, 'rgba(60,40,0,0.5)');
    ctx.fillStyle = sb; ctx.fillRect(win.x, win.y + win.h - 26, win.w, 26);
    ctx.restore();
    ctx.strokeStyle = '#3a3222'; ctx.lineWidth = 3;
    rr(ctx, win.x, win.y, win.w, win.h, 8); ctx.stroke();
    // the rollers
    ctx.fillStyle = '#2b2519';
    for (const y of [win.y - 14, win.y + win.h + 2]) { rr(ctx, win.x + 10, y, win.w - 20, 12, 6); ctx.fill(); }
    const steps = this.$$('.step');
    put(ctx, steps[0], w - 60, 214);
    put(ctx, steps[1], w - 60, 260);
    hit(ctx, this.select, win.x, win.y, win.w, win.h);
    if (this.select.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); rr(ctx, win.x + 4, win.y + 4, win.w - 8, win.h - 8, 6); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#c9b482';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('DESTINATION', 22, 36);
    ctx.letterSpacing = '0px';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#8d7f5f';
    ctx.fillText(`Stop ${this.select.selectedIndex + 1} of ${this.select.options.length}`, 22, 232);
    ctx.fillText('Tap the blind for the list', 22, 254);
    return moving;
  }
}
customElements.define('blind-select', BlindSelect);
// #endregion blind-select

// #region lift-pager
// Pagination drawn as a lift floor indicator. The pages are the element's light DOM: one <section> each.
export class LiftPager extends FeedControl {
  static size = [360, 330];
  static html = `<div class="sheet"><slot></slot></div><nav aria-label="Floors"></nav>`;
  static css = `
    .sheet { width: 320px; color: #1c1c1c; font: 15px/1.5 system-ui, sans-serif; }
    ::slotted(section) { box-sizing: border-box; width: 320px; height: 122px; padding: 2px 16px; overflow: hidden; }
    ::slotted(section) > * { margin: 4px 0 !important; }
    nav { display: flex; gap: 10px; width: 320px; }
    button { width: 60px; height: 60px; margin: 0; padding: 0; border: 2px solid #8d8d8d; border-radius: 50%;
      background: radial-gradient(circle at 38% 32%, #fdfdfd, #c9c9c9 72%, #9a9a9a 100%); color: #222;
      font: 600 22px/56px system-ui, sans-serif; outline: 0; touch-action: manipulation; }
    button:disabled { color: #a0a0a0; }
    button:focus-visible { border-color: #0a63c9; box-shadow: 0 0 0 3px rgba(10,99,201,0.4); }`;

  ready() {
    this.sheet = this.$('.sheet'); this.nav = this.$('nav');
    this.page = 0; this.pos = { x: 0, v: 0 };
    this.nav.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.go(this.page + +b.dataset.d);
    });
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true });
    this.sync();
  }
  get pages() { return [...this.querySelectorAll(':scope > section')]; }
  get value() { return String(this.page + 1); }
  go(to) {
    to = clamp(to, 0, this.pages.length - 1);
    if (to === this.page) return;
    this.page = to;
    this.sync();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sync() {
    const n = this.pages.length;
    this.page = clamp(this.page, 0, Math.max(0, n - 1));
    this.nav.innerHTML = `<button type="button" data-d="-1" aria-label="Previous floor"${this.page === 0 ? ' disabled' : ''}>‹</button>
      <button type="button" data-d="1" aria-label="Next floor"${this.page >= n - 1 ? ' disabled' : ''}>›</button>`;
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h) {
    const pages = this.pages, n = pages.length;
    const moving = spring(this.pos, this.page, this.dt, 90, 15);
    ctx.fillStyle = '#d9d7d2';
    ctx.fillRect(0, 0, w, h);
    // the brushed panel
    const panel = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 24; i++) panel.addColorStop(i / 24, i % 2 ? '#c7c6c2' : '#d6d5d1');
    ctx.fillStyle = panel;
    rr(ctx, 12, 12, w - 24, 110, 10); ctx.fill();
    ctx.strokeStyle = '#a8a7a3'; ctx.lineWidth = 1.5; ctx.stroke();
    // the floor numbers, with the travelling light over the current one
    const pitch = (w - 80) / Math.max(1, n);
    ctx.font = '600 34px "Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const x = 48 + (i + 0.5) * pitch, lit = 1 - clamp(Math.abs(this.pos.x - i));
      ctx.fillStyle = `rgb(${Math.round(lerp(120, 220, lit))}, ${Math.round(lerp(118, 60, lit))}, ${Math.round(lerp(114, 40, lit))})`;
      if (lit > 0.02) { ctx.shadowColor = `rgba(220,60,30,${lit * 0.9})`; ctx.shadowBlur = 18 * lit; }
      ctx.fillText(pages[i].dataset.floor ?? String(i + 1), x, 56);
      ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // the arrow, pointing the way the lift is going
    const dir = Math.abs(this.pos.v) < 0.05 ? 0 : Math.sign(this.pos.v);
    ctx.fillStyle = dir ? '#d8411e' : '#9a9995';
    ctx.save();
    ctx.translate(w / 2, 98);
    if (dir < 0) ctx.rotate(Math.PI);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(10, 7); ctx.lineTo(-10, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    // the page, as a card that slides in from the direction of travel
    const card = { x: 20, y: 136, w: 320, h: 130 };
    ctx.save();
    rr(ctx, card.x, card.y, card.w, card.h, 8);
    ctx.clip();
    ctx.fillStyle = '#fbfaf8';
    ctx.fillRect(card.x, card.y, card.w, card.h);
    const frac = this.pos.x - Math.round(this.pos.x);
    const near = pages[clamp(Math.round(this.pos.x), 0, n - 1)];
    // The pages are slotted, so they are drawn as a slice of the drawable <div> that holds the slot.
    if (near) { const s = this.slice(near); put(ctx, this.sheet, card.x, card.y + 4 - frac * 60 - s.top, s.w, s.h); }
    ctx.restore();
    ctx.strokeStyle = '#b6b4b0'; ctx.lineWidth = 1.5;
    rr(ctx, card.x, card.y, card.w, card.h, 8); ctx.stroke();
    // The call buttons are drawn as one <nav>: a descendant of a drawable element cannot be drawn on its own.
    put(ctx, this.nav, 20, 266);
    hit(ctx, this.nav, 20, 266);
    ctx.fillStyle = '#6d6b67';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`Floor ${this.page + 1} of ${n}`, 160, 302);
    return moving;
  }
}
customElements.define('lift-pager', LiftPager);
// #endregion lift-pager

// #region riffle-pager
// Pagination drawn as a deck of cards. A page is a <section> of light DOM, drawn with a transform; the
// cards behind are the same page's picture, so one element stands in for the whole deck.
export class RifflePager extends FeedControl {
  static size = [360, 340];
  static html = `<div class="sheet"><slot></slot></div><nav aria-label="Pages"></nav>`;
  static css = `
    .sheet { width: 252px; color: #1a1a1a; font: 15px/1.45 Georgia, 'Times New Roman', serif; }
    ::slotted(section) { box-sizing: border-box; width: 252px; height: 168px; padding: 16px 18px;
      background: #fffdf6; border: 1px solid #ddd6c2; border-radius: 10px; }
    nav { display: flex; gap: 6px; width: 320px; }
    button { min-width: 38px; height: 40px; margin: 0; padding: 0 6px; border: 1px solid #c7bfa8; border-radius: 6px;
      background: #fffdf6; color: #2c2a24; font: 15px/38px Georgia, 'Times New Roman', serif; outline: 0; touch-action: manipulation; }
    button[aria-current] { background: #2c2a24; border-color: #2c2a24; color: #fffdf6; }
    button:disabled { color: #b4ac97; }
    button:focus-visible { border-color: #2c2a24; box-shadow: inset 0 0 0 2px #2c2a24; }`;

  ready() {
    this.sheet = this.$('.sheet'); this.nav = this.$('nav');
    this.page = 0; this.turned = -1e9; this.from = 0;
    this.nav.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.go(b.dataset.p === 'prev' ? this.page - 1 : b.dataset.p === 'next' ? this.page + 1 : +b.dataset.p);
    });
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true });
    this.sync();
  }
  get pages() { return [...this.querySelectorAll(':scope > section')]; }
  get value() { return String(this.page + 1); }
  go(to) {
    to = clamp(to, 0, this.pages.length - 1);
    if (to === this.page) return;
    this.from = this.page; this.page = to; this.turned = performance.now();
    this.sync();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sync() {
    const n = this.pages.length, focus = this.shadowRoot.activeElement?.dataset?.p;
    this.page = clamp(this.page, 0, Math.max(0, n - 1));
    const show = [...new Set([0, this.page - 1, this.page, this.page + 1, n - 1])].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    let html = `<button type="button" data-p="prev" aria-label="Previous page"${this.page === 0 ? ' disabled' : ''}>←</button>`;
    let last = -1;
    for (const i of show) {
      if (i - last > 1) html += `<button type="button" disabled aria-hidden="true">…</button>`;
      html += `<button type="button" data-p="${i}" aria-label="Page ${i + 1}"${i === this.page ? ' aria-current="page"' : ''}>${i + 1}</button>`;
      last = i;
    }
    html += `<button type="button" data-p="next" aria-label="Next page"${this.page >= n - 1 ? ' disabled' : ''}>→</button>`;
    this.nav.innerHTML = html;
    if (focus != null) (this.nav.querySelector(`[data-p="${focus}"]:not(:disabled)`) ?? this.nav.querySelector('[aria-current]'))?.focus();
    this.setValue(this.value);
    this.request();
  }
  draw(ctx, w, h, now) {
    const pages = this.pages, n = pages.length, card = pages[this.page];
    ctx.fillStyle = '#e7e2d4';
    ctx.fillRect(0, 0, w, h);
    const cw = 252, ch = 168, cx = (w - cw) / 2, cy = 34;
    const t = reduced() ? 1 : clamp((now - this.turned) / 520);
    const dir = Math.sign(this.page - this.from) || 1;
    // the deck: the same card drawn small and dark behind, one for each page that is left
    const behind = Math.min(6, n - 1);
    for (let i = behind; i >= 1; i--) {
      const k = i / Math.max(1, behind);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(cx + cw / 2, cy + ch / 2);
      ctx.rotate(lerp(0, 0.07, k) * dir);
      ctx.translate(-cw / 2, -ch / 2 + k * 8);
      ctx.fillStyle = '#d8d1bd';
      rr(ctx, 0, 0, cw, ch, 10); ctx.fill();
      ctx.restore();
    }
    // the card on top, riffling in. The page is slotted, so what is drawn is a slice of the drawable
    // <div> that holds the slot, clipped to the card: a slotted element has no picture of its own.
    if (card) {
      const s = this.slice(card);
      ctx.save();
      ctx.translate(cx + cw / 2, cy + ch / 2);
      if (t < 1) {
        const e = easeOut(t);
        ctx.rotate(lerp(0.55 * dir, 0, e));
        ctx.translate(lerp(150 * dir, 0, e), lerp(60, 0, e));
        ctx.scale(lerp(0.86, 1, e), lerp(0.86, 1, e));
        ctx.globalAlpha = lerp(0.2, 1, e);
      }
      ctx.shadowColor = 'rgba(40,34,20,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#fffdf6';
      rr(ctx, -cw / 2, -ch / 2, cw, ch, 10); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      rr(ctx, -cw / 2, -ch / 2, cw, ch, 10); ctx.clip();
      put(ctx, this.sheet, -cw / 2, -ch / 2 - s.top, s.w, s.h);
      ctx.restore();
    }
    put(ctx, this.nav, 20, 240);
    hit(ctx, this.nav, 20, 240);
    ctx.fillStyle = '#6a6354';
    ctx.font = '14px Georgia, serif';
    ctx.fillText(`Card ${this.page + 1} of ${n}`, 20, 310);
    return t < 1;
  }
}
customElements.define('riffle-pager', RifflePager);
// #endregion riffle-pager
