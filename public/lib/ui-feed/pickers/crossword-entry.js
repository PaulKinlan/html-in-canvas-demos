// <crossword-entry>: one <input type="text"> across a row of a crossword grid <table>.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, easeOut, TAU, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const SLAB = "Rockwell, 'Rockwell Nova', 'Roboto Slab', 'Zilla Slab', 'Noto Serif', 'DejaVu Serif', Georgia, serif";
// A point of a pointer event, in the control's design units.
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

function drawPaper(g) {
  // specks and blotches over the whole print, light on the black squares and dark on the paper
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd(i + 7) * 0.07})`; const s = 0.6 + rnd(i + 3) ** 2 * 2.6; g.fillRect(rnd(i + 1) * 360, rnd(i + 2) * 360, s, s); }
  g.filter = 'blur(3px)';
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + rnd(i + 70) * 0.05})`; g.beginPath(); g.ellipse(rnd(i + 71) * 360, rnd(i + 72) * 360, 6 + rnd(i + 73) * 16, 4 + rnd(i + 74) * 10, rnd(i) * 3, 0, TAU); g.fill(); }
}

export class CrosswordEntry extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static HEAD = 103;
  static css = `
    header { display: flex; gap: 12px; width: 360px; height: 97px; padding: 0 6px 0 4px; box-sizing: border-box; overflow: hidden; background: #efefec; color: #141414; }
    header b { flex: none; font: 900 92px/97px ${SLAB}; letter-spacing: -0.06em; }
    header div { flex: 1; min-width: 0; padding-top: 12px; }
    header small { display: block; font: 700 10px/1 ${SLAB}; letter-spacing: 0.14em; text-transform: uppercase; }
    header p { margin: 10px 0 0; font: 500 21px/1.18 ${SLAB}; letter-spacing: -0.01em; }
    table { width: 360px; border-collapse: separate; border-spacing: 0; background: #141414; table-layout: fixed; }
    td { position: relative; height: 51px; padding: 0; box-shadow: inset 0 0 0 1px #141414; background: #efefec; color: #141414; text-align: center; font: 900 39px/51px ${SLAB}; }
    td.block { background: #141414; }
    td.entry { background: #f542b9; }
    td sup { position: absolute; left: 3px; top: 3px; font: 700 8px/1 ${SLAB}; }
    input { width: 360px; height: 51px; padding: 0; border: 0; outline: 0; background: transparent; color: transparent; caret-color: transparent; font: 16px ${SANS}; cursor: text; }
    input::selection { background: transparent; color: transparent; }`;

  ready() {
    this.born = [];
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['clue', 'number', 'direction', 'data-numbers'] });
    const root = this.shadowRoot;
    root.addEventListener('input', (e) => { if (e.target !== this.input) return; this.typed(e); });
    root.addEventListener('compositionend', () => this.typed({}));
    // A tap puts the caret in the square that was tapped, or after the last letter.
    root.addEventListener('click', (e) => {
      if (e.target !== this.input || this.plain) return;
      const at = Math.min(this.letters.length, Math.floor(point(this, e).x / (360 / this.cols)));
      this.input.setSelectionRange(at, at); this.request();
    });
    root.addEventListener('selectionchange', () => this.request());
    document.addEventListener('selectionchange', () => { if (this.shadowRoot.activeElement === this.input) this.request(); });
    root.addEventListener('focusin', () => this.blink(true));
    root.addEventListener('focusout', () => this.blink(false));
  }

  // #region crossword-entry
  build() {
    const box = this.canvas ?? this.$('.plain'), rows = options(this), was = this.input?.value ?? this.getAttribute('value') ?? '';
    // Each <option> is a row: # is a black square, . an empty one, ? a square of the answer, a letter is given.
    this.cols = Math.max(1, ...rows.map((r) => r.label.length));
    this.row = Math.max(0, rows.findIndex((r) => r.label.includes('?')));
    this.first = Math.max(0, rows[this.row]?.label.indexOf('?') ?? 0);
    this.length = (rows[this.row]?.label.match(/\?/g) ?? []).length || this.cols;
    const number = this.getAttribute('number') ?? '', dir = this.getAttribute('direction') ?? 'Across', clue = this.getAttribute('clue') ?? '';
    this.header = node(`<header><b>${esc(number)}</b><div><small>${esc(dir)}</small><p>${esc(clue)} (${this.length})</p></div></header>`);
    this.table = node(`<table aria-label="Crossword grid">${rows.map((r) => { const nums = (r.data.numbers ?? '').split(/\s+/); return `<tr>${[...r.label.padEnd(this.cols, '#')].map((ch, c) => `<td class="${ch === '#' ? 'block' : ch === '?' ? 'entry' : ''}">${/\d/.test(nums[c] ?? '') ? `<sup>${esc(nums[c])}</sup>` : ''}${/[A-Za-z]/.test(ch) ? esc(ch.toUpperCase()) : ''}</td>`).join('')}</tr>`; }).join('')}</table>`);
    this.input = node(`<input type="text" maxlength="${this.length}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="${esc(`${number} ${dir}: ${clue}, ${this.length} letters`)}">`);
    this.input.value = was;
    box.replaceChildren(this.header, this.table, this.input);
    this.typed({});
  }
  get letters() { return this.input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, this.length); }
  get value() { return this.letters; }
  set value(v) { this.input.value = String(v); this.typed({}); }
  // Keep letters only, in capitals. While an IME is composing the field is left alone and only the drawing is cleaned.
  typed(e) {
    const text = this.letters, now = performance.now();
    if (!e.isComposing && this.input.value !== text) { const at = Math.min(text.length, this.input.selectionStart ?? text.length); this.input.value = text; try { this.input.setSelectionRange(at, at); } catch {} }
    for (let i = 0; i < this.length; i++) { if (text[i] !== this.was?.[i]) this.born[i] = text[i] ? now : 0; }
    this.was = text;
    this.setValue(text);
    const short = text.length > 0 && text.length < this.length;
    try { this.internals?.setValidity(short ? { tooShort: true } : {}, short ? `${this.length} letters are needed` : '', this.input); } catch {}
    this.caretOn = true; this.request();
  }
  // The field's own caret is transparent, or its blink would raise two paints a second for a picture that isn't drawn.
  blink(on) {
    clearInterval(this.timer); this.caretOn = on;
    if (on && !reduced()) this.timer = setInterval(() => { this.caretOn = !this.caretOn; this.request(); }, 530);
    this.request();
  }

  draw(ctx, w, h, now) {
    const H = CrosswordEntry.HEAD, cw = w / this.cols, ch = this.table.offsetHeight / Math.max(1, this.table.rows.length), y0 = H + this.row * ch;
    ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.header, 0, 0);
    put(ctx, this.table, 0, H);
    hit(ctx, this.input, 0, y0, w, ch);
    // the letters of the answer, each stamped into its square when it is typed
    const text = this.letters, focused = this.shadowRoot.activeElement === this.input;
    let moving = false;
    ctx.fillStyle = '#141414'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `900 39px ${SLAB}`;
    for (let i = 0; i < text.length; i++) {
      const age = reduced() ? 1 : clamp((now - (this.born[i] || 0)) / 150), x = (this.first + i + 0.5) * cw, y = y0 + ch / 2;
      if (age < 1) moving = true;
      ctx.save(); ctx.translate(x, y); ctx.rotate((rnd(i * 7 + text.charCodeAt(i)) - 0.5) * 0.07); ctx.scale(lerp(1.45, 1, easeOut(age)), lerp(1.45, 1, easeOut(age)));
      ctx.globalAlpha = clamp(age * 2); ctx.fillText(text[i], 0, 14); ctx.restore();
    }
    if (focused) {
      const a = this.input.selectionStart ?? text.length, b = this.input.selectionEnd ?? a;
      if (b > a) { ctx.fillStyle = 'rgba(20,20,20,0.22)'; ctx.fillRect((this.first + a) * cw, y0 + 1, (b - a) * cw, ch - 2); }
      else if (a < this.length && this.caretOn) { ctx.fillStyle = '#141414'; ctx.fillRect((this.first + a + 0.5) * cw - 0.8, y0 + 13, 1.6, ch - 26); }
      if (this.input.matches(':focus-visible') && text.length === this.length) { ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.strokeRect(this.first * cw + 3, y0 + 3, this.length * cw - 6, ch - 6); }
    }
    ctx.drawImage(cached(this, 'paper', 360, 360, drawPaper), 0, 0, w, h);
    return moving;
  }
  // #endregion crossword-entry
}
customElements.define('crossword-entry', CrosswordEntry);
