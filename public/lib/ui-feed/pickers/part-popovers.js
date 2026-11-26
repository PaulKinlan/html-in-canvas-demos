// <part-popovers>: a <button> and a non-modal <dialog> for each part of a bicycle.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, spring, TAU, reduced } from '../kit.js';
import { cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const mix = (a, b, t) => { const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

function drawBike(g) {
  const green = '#12381f', greenLight = '#2a6a3c', cream = '#efe2c4', tan = '#b9652a', steel = '#c9ccd0';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const rear = { x: 66, y: 268 }, front = { x: 272, y: 268 }, R = 52, bb = { x: 160, y: 272 }, seat = { x: 124, y: 172 }, head = { x: 226, y: 150 };
  const line = (pts, colour, width) => { g.strokeStyle = colour; g.lineWidth = width; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); };
  for (const c of [rear, front]) {
    // spokes, rim and a cream tyre
    g.strokeStyle = 'rgba(235,235,240,0.75)'; g.lineWidth = 0.5;
    for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, b = a + (i % 2 ? 0.5 : -0.5); g.beginPath(); g.moveTo(c.x + Math.cos(b) * 5, c.y + Math.sin(b) * 5); g.lineTo(c.x + Math.cos(a) * (R - 6), c.y + Math.sin(a) * (R - 6)); g.stroke(); }
    g.strokeStyle = cream; g.lineWidth = 6.5; g.beginPath(); g.arc(c.x, c.y, R - 3, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(120,96,60,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.stroke();
    g.strokeStyle = steel; g.lineWidth = 1.6; g.beginPath(); g.arc(c.x, c.y, R - 7.5, 0, TAU); g.stroke();
    g.fillStyle = '#8d9096'; g.beginPath(); g.arc(c.x, c.y, 4, 0, TAU); g.fill();
  }
  // mudguards
  g.strokeStyle = green; g.lineWidth = 3.4;
  g.beginPath(); g.arc(rear.x, rear.y, R + 5, Math.PI * 0.98, Math.PI * 1.92); g.stroke();
  g.beginPath(); g.arc(front.x, front.y, R + 5, Math.PI * 1.12, Math.PI * 1.98); g.stroke();
  // the rack over the back wheel
  line([seat.x + 8, 204, 20, 204], green, 2.6); line([24, 204, rear.x, rear.y], green, 1.6); line([70, 204, rear.x, rear.y], green, 1.6); line([seat.x + 4, 214, 22, 210], green, 1.4);
  // the frame: seat tube, two swept tubes down from the head tube, stays and fork
  line([bb.x, bb.y, seat.x + 3, seat.y + 10], green, 5);
  g.strokeStyle = green; g.lineWidth = 4.6;
  g.beginPath(); g.moveTo(head.x + 1, head.y + 18); g.bezierCurveTo(214, 230, 190, 262, bb.x, bb.y); g.stroke();
  g.beginPath(); g.moveTo(head.x + 3, head.y + 32); g.bezierCurveTo(222, 232, 196, 250, bb.x - 8, bb.y - 34); g.stroke();
  line([bb.x - 16, bb.y - 60, rear.x, rear.y], green, 3.2);
  line([head.x, head.y, head.x + 5, head.y + 40], green, 6);
  g.strokeStyle = green; g.lineWidth = 3.6; g.beginPath(); g.moveTo(head.x + 5, head.y + 40); g.quadraticCurveTo(250, 232, front.x, front.y); g.stroke();
  g.strokeStyle = greenLight; g.lineWidth = 1; g.beginPath(); g.moveTo(head.x, head.y + 20); g.bezierCurveTo(213, 230, 189, 261, bb.x + 2, bb.y - 2); g.stroke();
  // the chain case
  g.fillStyle = green; g.beginPath(); g.moveTo(rear.x - 4, rear.y - 9); g.lineTo(bb.x + 4, bb.y - 17); g.arc(bb.x + 2, bb.y, 17, -Math.PI / 2, Math.PI / 2); g.lineTo(rear.x - 4, rear.y + 8); g.arc(rear.x - 4, rear.y, 8.5, Math.PI / 2, -Math.PI / 2); g.closePath(); g.fill();
  g.strokeStyle = greenLight; g.lineWidth = 1; g.beginPath(); g.moveTo(rear.x, rear.y - 7); g.lineTo(bb.x + 2, bb.y - 14); g.stroke();
  // crank, pedal and stand
  line([bb.x + 2, bb.y, bb.x + 16, bb.y + 22], steel, 2.6); line([bb.x + 10, bb.y + 23, bb.x + 24, bb.y + 23], '#3a3a3a', 3.4);
  g.fillStyle = steel; g.beginPath(); g.arc(bb.x + 2, bb.y, 3, 0, TAU); g.fill();
  line([bb.x - 8, bb.y + 8, bb.x + 4, 331], steel, 2);
  // seat post and saddle with its springs
  line([seat.x + 3, seat.y + 12, seat.x + 1, seat.y - 2], steel, 2.6);
  g.strokeStyle = steel; g.lineWidth = 1; for (const sx of [seat.x - 12, seat.x + 12]) { g.beginPath(); for (let i = 0; i <= 12; i++) g.lineTo(sx + (i % 2 ? 2.6 : -2.6), seat.y - 2 + i * 0.8); g.stroke(); }
  const leather = g.createLinearGradient(0, seat.y - 14, 0, seat.y); leather.addColorStop(0, '#d98a4a'); leather.addColorStop(1, '#9a4a16');
  g.fillStyle = leather; g.beginPath(); g.moveTo(seat.x - 24, seat.y - 6); g.bezierCurveTo(seat.x - 22, seat.y - 15, seat.x - 6, seat.y - 12, seat.x + 4, seat.y - 9); g.bezierCurveTo(seat.x + 14, seat.y - 7, seat.x + 24, seat.y - 9, seat.x + 27, seat.y - 5); g.bezierCurveTo(seat.x + 18, seat.y - 1, seat.x + 4, seat.y + 1, seat.x - 6, seat.y); g.bezierCurveTo(seat.x - 16, seat.y, seat.x - 25, seat.y - 1, seat.x - 24, seat.y - 6); g.fill();
  // stem, bars and grips
  line([head.x, head.y, head.x - 3, head.y - 16], steel, 3);
  g.strokeStyle = steel; g.lineWidth = 2.4; g.beginPath(); g.moveTo(head.x - 3, head.y - 16); g.quadraticCurveTo(head.x + 8, head.y - 24, head.x - 12, head.y - 16); g.lineTo(head.x - 32, head.y - 13); g.stroke();
  line([head.x - 22, head.y - 14.5, head.x - 36, head.y - 12.5], tan, 4.6);
  // the bell
  g.fillStyle = '#e5c15a'; g.beginPath(); g.arc(head.x + 2, head.y - 19, 4.6, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(head.x + 0.6, head.y - 20.6, 1.5, 0, TAU); g.fill();
  // the basket: rattan woven in two directions
  const bx = head.x + 14, by = head.y - 2, bw = 56, bh = 40;
  const wick = g.createLinearGradient(bx, by, bx + bw, by + bh); wick.addColorStop(0, '#d79a52'); wick.addColorStop(1, '#a8662a');
  const shape = new Path2D(); shape.moveTo(bx, by); shape.lineTo(bx + bw, by - 3); shape.lineTo(bx + bw - 7, by + bh); shape.lineTo(bx + 6, by + bh + 1); shape.closePath();
  g.fillStyle = wick; g.fill(shape);
  g.save(); g.clip(shape);
  g.lineWidth = 1; for (let i = -10; i < 30; i++) { g.strokeStyle = 'rgba(96,52,14,0.55)'; g.beginPath(); g.moveTo(bx + i * 5, by - 4); g.lineTo(bx + i * 5 + 24, by + bh + 2); g.stroke(); g.strokeStyle = 'rgba(255,220,160,0.4)'; g.beginPath(); g.moveTo(bx + i * 5 + 24, by - 4); g.lineTo(bx + i * 5, by + bh + 2); g.stroke(); }
  g.restore();
  g.strokeStyle = '#8a5220'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(bx - 1, by); g.lineTo(bx + bw + 1, by - 3); g.stroke();
  // the lamp on the fork
  g.fillStyle = steel; g.beginPath(); g.ellipse(head.x + 24, head.y + 50, 6.5, 5.5, 0, 0, TAU); g.fill();
  g.fillStyle = '#fff6c9'; g.beginPath(); g.ellipse(head.x + 28, head.y + 50, 3, 4.6, 0, 0, TAU); g.fill();
}
function drawBikeScene(g) {
  const wall = g.createLinearGradient(0, 0, 360, 330); wall.addColorStop(0, '#f2477c'); wall.addColorStop(1, '#e83b70');
  g.fillStyle = wall; g.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,160,190' : '150,20,60'},${0.05 + rnd(i + 9) * 0.07})`; g.fillRect(rnd(i + 1) * 360, rnd(i + 2) * 330, 1 + rnd(i + 3) * 2, 1); }
  const floor = g.createLinearGradient(0, 326, 0, 360); floor.addColorStop(0, '#b99a8e'); floor.addColorStop(0.2, '#d2b9ad'); floor.addColorStop(1, '#c6aa9d');
  g.fillStyle = floor; g.fillRect(0, 327, 360, 33);
  // the bicycle is drawn once on its own picture: again in one dark colour for the shadow on the wall
  const c = document.createElement('canvas'), k = g.getTransform().a; c.width = Math.ceil(360 * k); c.height = Math.ceil(360 * k);
  const b = c.getContext('2d'); b.scale(k, k); drawBike(b);
  g.save(); g.filter = 'brightness(0) blur(2.5px)'; g.globalAlpha = 0.2; g.drawImage(c, 22, 5, 360, 360); g.restore();
  g.save(); g.filter = 'blur(4px)'; g.fillStyle = 'rgba(70,30,30,0.35)'; g.beginPath(); g.ellipse(180, 331, 150, 5, 0, 0, TAU); g.fill(); g.restore();
  g.drawImage(c, 0, 0, 360, 360);
}

export class PartPopovers extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static CARD = 160;
  static css = `
    button.dot { width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
    dialog { width: 160px; padding: 13px 13px 13px; border: 0; background: #fff; color: #111; inset: auto; left: 0; top: 0; font: 500 10.5px/1.3 ${SANS}; }
    dialog h3 { margin: 0; font: 800 32px/1 ${SANS}; letter-spacing: -0.05em; }
    dialog p { margin: 6px 0 12px; }
    dialog form { display: flex; align-items: center; justify-content: space-between; margin: 0; }
    dialog data { font: 700 24px/1 ${SANS}; letter-spacing: -0.02em; }
    dialog button { width: 54px; height: 29px; padding: 0; border: 0; border-radius: 15px; background: #111; color: #fff; font: 700 11.5px/1 ${SANS}; cursor: pointer; }
    dialog button:focus-visible { outline: 2px solid #e83b70; outline-offset: 2px; }
    output { left: auto; top: auto; padding: 6px 10px 6px; background: #111; color: #fff; border-radius: 14px; font: 700 11px/1 ${SANS}; white-space: nowrap; }`;

  ready() {
    this.added = new Set((this.getAttribute('value') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-at', 'data-price', 'data-note', 'value'] });
    const root = this.shadowRoot;
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.parts.some((p) => p.want)) { e.preventDefault(); this.show(-1, true); } });
    root.addEventListener('pointerdown', (e) => { if (e.target === this.canvas) this.show(-1); });
  }

  // #region part-popovers
  build() {
    const box = this.canvas ?? this.$('.plain'), money = (n) => '$' + Number(n).toLocaleString('en-US');
    box.replaceChildren();
    this.parts = options(this).map((o, i) => {
      const [x, y] = (o.data.at ?? '').split(',').map(Number);
      const button = node(`<button type="button" class="dot" aria-haspopup="dialog" aria-expanded="false" aria-controls="part${i}">${esc(o.label)}</button>`);
      const dialog = node(`<dialog id="part${i}" aria-label="${esc(o.label)}"><h3>${esc(o.label)}</h3><p>${esc(o.data.note ?? '')}</p><form method="dialog"><data value="${esc(o.data.price ?? 0)}">${money(o.data.price ?? 0)}</data><button value="add">Add</button></form></dialog>`);
      box.append(button, dialog);
      const part = { ...o, x: x || 40 + i * 50, y: y || 40, price: Number(o.data.price ?? 0), button, dialog, t: 0, want: 0, pop: { x: 0, v: 0 } };
      button.addEventListener('click', () => this.show(part.want ? -1 : i));
      // The form would close the dialog at once. Cancel that, and close it when it has been drawn shut.
      dialog.querySelector('form').addEventListener('submit', (e) => {
        part.said = e.submitter?.value ?? '';
        if (this.added.has(o.value)) this.added.delete(o.value); else this.added.add(o.value);
        this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
        if (this.plain) return;
        e.preventDefault(); this.show(-1, true);
      });
      return part;
    });
    this.sum = node('<output aria-live="polite"></output>');
    box.append(this.sum);
    this.sync();
  }
  // Open the dialog of one part and close the others. -1 closes them all.
  show(index, refocus = false) {
    this.parts.forEach((p, i) => {
      const open = i === index;
      if (open && !p.dialog.open) {
        p.dialog.open = true;                              // show() would also move focus, and may scroll the page to it
        p.dialog.querySelector('button').focus({ preventScroll: true });
      }
      if (!open && p.want && refocus) p.button.focus({ preventScroll: true });
      if (!open && this.plain && p.dialog.open) p.dialog.close();
      p.want = open ? 1 : 0;
      p.button.setAttribute('aria-expanded', String(open));
    });
    this.request();
  }
  get value() { return this.parts.filter((p) => this.added.has(p.value)).map((p) => p.value).join(','); }
  set value(v) { this.added = new Set(String(v).split(',').map((s) => s.trim()).filter(Boolean)); this.sync(); this.request(); }
  sync() {
    let total = 0, n = 0;
    for (const p of this.parts) {
      const on = this.added.has(p.value);
      if (on) { total += p.price; n++; }
      p.button.setAttribute('aria-label', on ? `${p.label}, added` : p.label);
      p.dialog.querySelector('button').textContent = on ? 'Remove' : 'Add';
      p.dialog.querySelector('button').value = on ? 'remove' : 'add';
    }
    this.sum.value = n ? `${n} ${n === 1 ? 'part' : 'parts'} added, $${total.toLocaleString('en-US')}` : '';
    this.setValue(this.value);
  }
  // Where the card of a part goes: above its button if there is room, else below, and inside the picture.
  place(p) {
    const W = PartPopovers.CARD, H = p.dialog.offsetHeight, above = p.y - 20 - H >= 8;
    return { x: clamp(p.x - W * 0.42, 10, 350 - W), y: above ? p.y - 20 - H : p.y + 20, w: W, h: H, above };
  }

  draw(ctx, w, h) {
    ctx.drawImage(cached(this, 'scene', 360, 360, drawBikeScene), 0, 0, w, h);
    let moving = false;
    const focus = this.shadowRoot.activeElement;
    for (const p of this.parts) {
      if (p.t !== p.want) { p.t = reduced() ? p.want : p.want ? Math.min(1, p.t + this.dt / 0.2) : Math.max(0, p.t - this.dt / 0.14); }
      const springing = p.dialog.open && spring(p.pop, p.want, this.dt, 420, 30);
      moving = moving || p.t !== p.want || springing;
      if (p.t === 0 && !p.want && p.dialog.open) { p.dialog.close(p.said ?? ''); p.said = ''; p.pop.x = p.pop.v = 0; }
    }
    // the buttons: a white disc with a plus that turns into a cross on black, or a tick once the part is added
    for (const p of this.parts) {
      const e = smooth(p.t), on = this.added.has(p.value);
      hit(ctx, p.button, p.x - 18, p.y - 18);
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, TAU); ctx.fill();
      ctx.fillStyle = mix('#ffffff', '#111111', Math.max(e, on ? 1 : 0)); ctx.beginPath(); ctx.arc(0, 0, 7.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = mix('#111111', '#ffffff', Math.max(e, on ? 1 : 0)); ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (on && e < 0.5) { ctx.beginPath(); ctx.moveTo(-3.2, 0.2); ctx.lineTo(-0.9, 2.5); ctx.lineTo(3.3, -2.3); ctx.stroke(); }
      else { ctx.rotate(e * Math.PI / 4); ctx.beginPath(); ctx.moveTo(-3.2, 0); ctx.lineTo(3.2, 0); ctx.moveTo(0, -3.2); ctx.lineTo(0, 3.2); ctx.stroke(); }
      ctx.restore();
      if (focus === p.button && p.button.matches(':focus-visible')) focusRing(ctx, p.x - 14, p.y - 14, 28, 28);
    }
    // the open cards, grown from their buttons
    for (const p of this.parts) {
      if (!p.dialog.open) continue;
      const c = this.place(p), s = clamp(lerp(0.6, 1, p.pop.x), 0.3, 1.2), a = clamp(p.t * 1.6);
      const tipY = c.above ? p.y - 12 : p.y + 12, x = p.x + (c.x - p.x) * s, y = tipY + ((c.above ? c.y - 8 : c.y + 8) - tipY) * s, cw = c.w * s, ch = c.h * s;
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(150,20,60,0.55)'; ctx.fillRect(x + 3, y + 3, cw, ch);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(p.x, tipY); ctx.lineTo(p.x - 7 * s, c.above ? y + ch - 0.5 : y + 0.5); ctx.lineTo(p.x + 7 * s, c.above ? y + ch - 0.5 : y + 0.5); ctx.closePath(); ctx.fill();
      put(ctx, p.dialog, x, y, cw, ch);
      ctx.restore();
    }
    if (this.sum.value) put(ctx, this.sum, 12, 360 - 12 - this.sum.offsetHeight);
    return moving;
  }
  // #endregion part-popovers
}
customElements.define('part-popovers', PartPopovers);
