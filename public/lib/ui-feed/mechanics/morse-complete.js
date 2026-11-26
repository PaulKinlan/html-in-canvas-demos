// <morse-complete>: a text field with suggestions and a telegraph key that types in Morse.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, rr, spring, TAU, reduced } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// #region morse-complete
// A text field with a short list under it. Typing narrows the list. Beside each name is the Morse for its
// next letter, and the key at the bottom is a button: a short press is a dot, a long one a dash, and a pause
// ends the letter, which is then typed into the field. So two or three letters keyed by hand pick an item.
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..' };
export class MorseComplete extends FeedControl {
  static size = [360, 400];
  static html = `<input type="text" role="combobox" aria-autocomplete="list" aria-controls="list" aria-expanded="true" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="clear" aria-label="Clear">&times;</button><ol id="list" role="listbox"></ol><button type="button" class="key" aria-label="Morse key. A short press is a dot and a long press is a dash."></button><output class="tape" role="status"></output>`;
  static css = `
    input[type=text] { width: 274px; height: 40px; box-sizing: border-box; padding: 0; border: 0; outline: 0; background: transparent; color: #16293c;
      font: 500 23px/40px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 0.04em; }
    input::placeholder { color: #5e7f9f; }
    .clear { width: 30px; height: 40px; border: 0; background: transparent; color: #16293c; font: 400 22px/1 ui-sans-serif, sans-serif; padding: 0; touch-action: manipulation; }
    .clear:focus-visible { outline: 2px solid #16293c; }
    ol { list-style: none; margin: 0; padding: 0; width: 304px; font: 400 15.5px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 0.04em; color: #40607f; }
    li { display: flex; align-items: center; justify-content: space-between; height: 29px; border-bottom: 1px solid #7fa3c6; cursor: pointer; }
    li b { font-weight: 400; color: #16293c; }
    li[aria-selected=true] { color: #16293c; border-bottom-color: #16293c; }
    li span { display: flex; gap: 3px; align-items: center; opacity: 0.55; } li[aria-selected=true] span { opacity: 1; }
    li s { display: block; height: 4px; border-radius: 2px; background: currentColor; width: 4px; } li s.dash { width: 12px; }
    .key { width: 110px; height: 104px; opacity: 0; touch-action: none; user-select: none; -webkit-touch-callout: none; }
    .tape { width: 200px; font: 500 12px/1.3 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color: #2b4a68; white-space: nowrap; }`;
  static DOT = 220;            // a press shorter than this many ms is a dot
  static GAP = 650;            // this long without a press ends the letter
  static AXLE = { x: 176, y: 300 };

  ready() {
    this.field = this.$('input'); this.list = this.$('ol'); this.key = this.$('.key'); this.tape = this.$('.tape');
    this.field.placeholder = this.getAttribute('placeholder') ?? 'Add an item';
    this.field.ariaLabel = this.field.placeholder;
    this.lever = { x: 0, v: 0 }; this.code = ''; this.active = 0; this.picked = '';
    this.field.addEventListener('input', () => { this.picked = ''; this.active = 0; this.filter(); });
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.active = clamp(this.active + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, this.shown.length - 1)); this.filter(); }
      if (e.key === 'Enter' && this.shown[this.active]) { e.preventDefault(); this.pick(this.shown[this.active]); }
    });
    this.list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) this.pick(this.shown[[...this.list.children].indexOf(li)]); });
    this.$('.clear').addEventListener('click', () => { this.field.value = ''; this.picked = ''; this.active = 0; this.filter(); this.setValue(null); this.dispatchEvent(new Event('change', { bubbles: true })); });
    // The key keeps its own pressed flag: :active is not set by every kind of touch.
    const k = this.key;
    k.addEventListener('pointerdown', (e) => { if (!e.button) { k.setPointerCapture(e.pointerId); this.press(true); } });
    for (const type of ['pointerup', 'pointercancel', 'blur']) k.addEventListener(type, () => this.press(false));
    k.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); this.press(true); } });
    k.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.press(false); } });
    k.addEventListener('contextmenu', (e) => e.preventDefault());
    k.addEventListener('click', (e) => e.preventDefault());
    new MutationObserver(() => this.filter()).observe(this, { childList: true, subtree: true, characterData: true });
    this.filter();
  }
  disconnectedCallback() { clearTimeout(this.gap); this.tone(false); }
  get value() { return this.picked; }
  set value(v) { this.field.value = v; this.picked = options(this).some((o) => o.label === v) ? v : ''; this.filter(); this.setValue(this.picked || null); }

  // The list: the options that start with what is typed, five at most, each with the Morse of its next letter.
  filter() {
    const typed = this.field.value.trim().toLowerCase(), all = options(this).map((o) => o.label);
    this.shown = this.picked ? [] : all.filter((name) => name.toLowerCase().startsWith(typed)).slice(0, 5);
    this.active = clamp(this.active, 0, Math.max(0, this.shown.length - 1));
    this.list.innerHTML = this.shown.map((name, i) => {
      const code = MORSE[name[typed.length]?.toLowerCase()] ?? '';
      return `<li role="option" id="o${i}" aria-selected="${i === this.active}"><div><b>${esc(name.slice(0, typed.length))}</b>${esc(name.slice(typed.length))}</div><span aria-label="${code ? 'next letter ' + [...code].map((c) => c === '.' ? 'dot' : 'dash').join(' ') : ''}">${[...code].map((c) => `<s class="${c === '.' ? 'dot' : 'dash'}"></s>`).join('')}</span></li>`;
    }).join('');
    this.field.setAttribute('aria-activedescendant', this.shown.length ? 'o' + this.active : '');
    this.field.setAttribute('aria-expanded', String(this.shown.length > 0));
    this.request();
  }
  pick(name) {
    if (!name) return;
    this.field.value = name; this.picked = name; this.filter();
    this.setValue(name);
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // #region morse-key
  press(down) {
    if (down === !!this.down) return;
    clearTimeout(this.gap);
    if (down) { this.down = performance.now(); }
    else {
      this.code += performance.now() - this.down < MorseComplete.DOT ? '.' : '-';
      this.down = 0;
      this.gap = setTimeout(() => this.letter(), MorseComplete.GAP);
    }
    this.tone(down);
    this.tape.textContent = [...this.code].map((c) => (c === '.' ? '•' : '▬')).join(' ');
    this.request();
  }
  // The pause after the last press: look the code up and type the letter.
  letter() {
    const ch = Object.keys(MORSE).find((k) => MORSE[k] === this.code);
    this.tape.textContent = ch ? `${[...this.code].map((c) => (c === '.' ? '•' : '▬')).join(' ')}  ${ch.toUpperCase()}` : this.code ? 'not a letter' : '';
    this.code = '';
    if (ch) {
      this.field.value += this.field.value ? ch : ch.toUpperCase();
      this.picked = ''; this.active = 0; this.filter();
      this.dispatchEvent(new Event('input', { bubbles: true }));
      if (this.shown.length === 1 && this.shown[0].toLowerCase() === this.field.value.toLowerCase()) this.pick(this.shown[0]);
    }
    this.request();
  }
  // A sounder, if the page asked for one with the `sound` attribute: a sine tone for as long as the key is down.
  tone(on) {
    if (!this.hasAttribute('sound')) return;
    try {
      if (on && !this.audio) {
        const A = window.AudioContext ?? window.webkitAudioContext; if (!A) return;
        this.audio = new A(); this.gain = this.audio.createGain(); this.gain.gain.value = 0;
        const osc = this.audio.createOscillator(); osc.frequency.value = 620; osc.connect(this.gain).connect(this.audio.destination); osc.start();
      }
      if (!this.audio) return;
      if (on) this.audio.resume?.();
      this.gain.gain.setTargetAtTime(on ? 0.12 : 0, this.audio.currentTime, 0.008);
    } catch (e) { window.__gfx?.report?.('error', 'morse sounder: ' + e.message); }
  }
  // #endregion morse-key

  draw(ctx, w, h) {
    const { AXLE } = MorseComplete;
    ctx.fillStyle = '#a9c6e2'; ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, 'rgba(255,255,255,0.12)'); sky.addColorStop(1, 'rgba(40,80,130,0.12)');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    put(ctx, this.field, 28, 16);
    put(ctx, this.$('.clear'), 302, 16);
    ctx.fillStyle = '#16293c'; ctx.fillRect(28, 58, 304, 1.4);
    if (this.field.matches(':focus-visible')) ctx.fillRect(28, 58, 304, 2.4);
    put(ctx, this.list, 28, 62);

    // the lever: at rest the spring holds the knob end up. Pressed, it comes down onto the contact and stops.
    const want = this.down ? 1 : 0;
    let live = reduced() ? ((this.lever.x = want), false) : spring(this.lever, want, this.dt, 1500, 44);
    if (this.lever.x > 1) { this.lever.x = 1; this.lever.v *= -0.25; }      // the contact is hard
    if (this.lever.x < 0) { this.lever.x = 0; this.lever.v *= -0.25; }      // and so is the back stop
    const tilt = lerp(-0.05, 0.022, this.lever.x);
    const BRASS = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#e8c56a'); g.addColorStop(0.45, '#b98a2c'); g.addColorStop(0.55, '#d9b04c'); g.addColorStop(1, '#7c5714'); return g; };
    // shadow on the table, and the wooden base
    ctx.fillStyle = 'rgba(30,60,100,0.25)'; ctx.beginPath(); ctx.ellipse(180, 386, 170, 7, 0, 0, TAU); ctx.fill();
    const wood = ctx.createLinearGradient(0, 348, 0, 384); wood.addColorStop(0, '#7a4326'); wood.addColorStop(0.2, '#5e2f18'); wood.addColorStop(1, '#3a1a0c');
    ctx.fillStyle = wood; rr(ctx, 12, 348, 336, 36, 3); ctx.fill();
    ctx.save(); rr(ctx, 12, 348, 336, 36, 3); ctx.clip(); ctx.strokeStyle = 'rgba(20,8,2,0.35)'; ctx.lineWidth = 0.7;
    for (let i = 0; i < 14; i++) { const y = 351 + i * 2.5 + rnd(i) * 1.5; ctx.beginPath(); ctx.moveTo(12, y); ctx.bezierCurveTo(100, y + rnd(i + 5) * 4 - 2, 240, y + rnd(i + 9) * 4 - 2, 348, y + rnd(i + 2) * 3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,220,180,0.18)'; ctx.fillRect(12, 348, 336, 1.5); ctx.restore();
    // feet on the base: back stop post, spring seat, the pivot block and the contact
    const foot = (x, wd) => { ctx.fillStyle = BRASS(x - wd, 0, x + wd, 0); rr(ctx, x - wd, 340, wd * 2, 9, 2); ctx.fill(); };
    foot(40, 13); foot(108, 11); foot(AXLE.x, 26); foot(262, 15);
    ctx.fillStyle = BRASS(250, 0, 274, 0); rr(ctx, 253, 318, 18, 24, 3); ctx.fill();                       // contact post
    const tip = ctx.createRadialGradient(261, 313, 0.5, 262, 315, 5); tip.addColorStop(0, '#fff'); tip.addColorStop(1, '#7d8288');
    ctx.fillStyle = tip; ctx.beginPath(); ctx.arc(262, 316, 4.2, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = BRASS(162, 0, 190, 0); ctx.beginPath(); ctx.moveTo(160, 342); ctx.lineTo(160, 300); ctx.arc(AXLE.x, 300, 16, Math.PI, TAU); ctx.lineTo(192, 342); ctx.closePath(); ctx.fill();
    // what is on the lever turns about the axle
    const along = (x, y) => { const dx = x - AXLE.x, dy = y - AXLE.y; return { x: AXLE.x + dx * Math.cos(tilt) - dy * Math.sin(tilt), y: AXLE.y + dx * Math.sin(tilt) + dy * Math.cos(tilt) }; };
    // the coil spring between the base and the lever, squeezed or stretched by the lever's end
    const sTop = along(108, 306).y, sBot = 340;
    ctx.strokeStyle = '#3d3f43'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let i = 0; i <= 12; i++) ctx[i ? 'lineTo' : 'moveTo'](108 + (i % 2 ? 7 : -7) * (i && i < 12 ? 1 : 0), lerp(sTop, sBot, i / 12));
    ctx.stroke();
    // the back stop: a threaded post and a knurled nut the lever's tail rests under
    const tail = along(40, 300);
    ctx.fillStyle = BRASS(35, 0, 45, 0); ctx.fillRect(36, 262, 8, 80);
    ctx.strokeStyle = 'rgba(70,45,5,0.6)'; ctx.lineWidth = 0.6; ctx.beginPath(); for (let y = 264; y < 340; y += 2.4) { ctx.moveTo(36, y); ctx.lineTo(44, y + 1); } ctx.stroke();
    ctx.fillStyle = BRASS(22, 0, 58, 0); rr(ctx, 22, 256, 36, 12, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,5,0.55)'; ctx.beginPath(); for (let x = 24; x < 58; x += 2.2) { ctx.moveTo(x, 257); ctx.lineTo(x, 267); } ctx.stroke();
    ctx.fillStyle = BRASS(26, 0, 54, 0); rr(ctx, 26, tail.y - 13, 28, 7, 2); ctx.fill();
    ctx.save(); ctx.translate(AXLE.x, AXLE.y); ctx.rotate(tilt);
    ctx.fillStyle = BRASS(0, -6, 0, 6); rr(ctx, -150, -5.5, 300, 11, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,0.5)'; ctx.fillRect(-150, -5.5, 300, 1.4);
    // the knob: a brass collar, a neck and a wide black cap
    ctx.fillStyle = BRASS(110, 0, 146, 0); rr(ctx, 112, -11, 34, 7, 2); ctx.fill();
    const neck = ctx.createLinearGradient(118, 0, 140, 0); neck.addColorStop(0, '#3b3b3d'); neck.addColorStop(0.4, '#1b1b1c'); neck.addColorStop(1, '#070707');
    ctx.fillStyle = neck; ctx.beginPath(); ctx.moveTo(119, -11); ctx.quadraticCurveTo(124, -24, 116, -38); ctx.lineTo(142, -38); ctx.quadraticCurveTo(134, -24, 139, -11); ctx.closePath(); ctx.fill();
    const capG = ctx.createLinearGradient(0, -56, 0, -36); capG.addColorStop(0, '#4b4b4e'); capG.addColorStop(0.35, '#232325'); capG.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = capG; ctx.beginPath(); ctx.ellipse(129, -45, 39, 10.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.ellipse(120, -50, 22, 3, -0.05, 0, TAU); ctx.fill();
    ctx.restore();
    // the axle
    const ax = ctx.createRadialGradient(AXLE.x - 2, AXLE.y - 3, 1, AXLE.x, AXLE.y, 9); ax.addColorStop(0, '#f6dc8e'); ax.addColorStop(1, '#8a6218');
    ctx.fillStyle = ax; ctx.beginPath(); ctx.arc(AXLE.x, AXLE.y, 8.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,5,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
    // a spark of light where the lever meets the contact
    if (this.lever.x > 0.96) { const sp = ctx.createRadialGradient(262, 311, 0, 262, 311, 9); sp.addColorStop(0, 'rgba(255,255,255,0.9)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sp; ctx.fillRect(252, 301, 20, 20); }
    if (this.key.matches(':focus-visible')) { const kp = along(305, 262); ctx.strokeStyle = '#16293c'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); rr(ctx, kp.x - 48, kp.y - 20, 96, 44, 10); ctx.stroke(); ctx.setLineDash([]); }
    const kp = along(305, 255);
    hit(ctx, this.key, kp.x - 55, kp.y - 34, 110, 104);
    put(ctx, this.tape, 28, 226, 200);
    return live;
  }
}
customElements.define('morse-complete', MorseComplete);
// #endregion morse-complete
