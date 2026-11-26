// <walk-circle>: a range whose handle rides a walking-distance circle on a street map.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, clamp, spring, TAU } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
// A range under a drawn handle: the pointer is captured and the control works out the value.
function grip(el, on) {
  let id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    id = e.pointerId; try { el.setPointerCapture(id); } catch {}      // a pointer made in script cannot be captured
    e.preventDefault(); el.focus({ preventScroll: true }); on.down?.(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) on.move?.(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; on.up?.(e); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return () => id !== null;
}

// #region walk-circle
// A range in minutes of walking. Its handle rides on a circle on a street map, and the circle's radius is the
// distance walked in that time at 80 metres a minute. Stops inside the circle are counted. The map is made
// up: a grid of streets from a fixed seed, with stops where tram and metro lines cross them.
const CITY = (() => {
  const lines = (n, seed) => { const out = []; let at = -260; for (let i = 0; at < 260; i++) { at += 14 + rnd(seed + i) * 26; out.push({ at, wide: rnd(seed + i * 3) > 0.8 }); } return out; };
  const xs = lines(0, 10), ys = lines(0, 50), stops = [];
  // a line runs along one street. It has a stop at every second or third crossing
  const route = (along, index, kind, seed) => {
    const fixed = (along === 'x' ? xs : ys)[index].at, cross = along === 'x' ? ys : xs;
    for (let i = Math.floor(rnd(seed) * 3); i < cross.length; i += 2 + Math.floor(rnd(seed + i) * 2)) stops.push(along === 'x' ? { x: fixed, y: cross[i].at, kind } : { x: cross[i].at, y: fixed, kind });
    return { along, at: fixed, kind };
  };
  const mid = (list) => list.reduce((best, l, i) => (Math.abs(l.at) < Math.abs(list[best].at) ? i : best), 0);
  const mx = mid(xs), my = mid(ys);
  const routes = [route('x', mx + 2, 'metro', 1), route('y', my + 1, 'metro', 2), route('x', mx - 3, 'tram', 3), route('y', my - 2, 'tram', 4), route('x', mx + 6, 'tram', 5), route('y', my + 5, 'tram', 6), route('y', my - 6, 'tram', 7)];
  return { xs, ys, stops, routes };
})();

export class WalkCircle extends FeedControl {
  static size = [360, 372];
  static html = `<span class="place"><slot>Here</slot></span><output class="count" aria-live="polite"></output><input type="range" aria-label="Maximum walk to a stop, in minutes">`;
  static css = `
    .place { box-sizing: border-box; padding: 2px 5px; background: #fbf3e4; border: 1px solid #111; color: #111; font: 800 6.5px/1 ${SANS}; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }
    .count { width: 200px; height: 12px; font: 500 9px/12px ${SANS}; opacity: 0; }
    input { width: 48px; height: 48px; opacity: 0; margin: 0; touch-action: none; }`;
  static observedAttributes = ['value'];
  static C = { x: 180, y: 192 }; static SCALE = 0.1; static PACE = 80; static ANGLE = -2.2;     // pixels a metre, metres a minute, where the handle sits

  ready() {
    this.range = this.$('input');
    this.min = Number(this.getAttribute('min') ?? 3); this.max = Number(this.getAttribute('max') ?? 20);
    Object.assign(this.range, { min: this.min, max: this.max, step: 1 });
    this.v = clamp(Math.round(Number(this.getAttribute('value') ?? 12)), this.min, this.max);
    this.r = { x: this.radius(this.v), v: 0 };
    this.pop = CITY.stops.map(() => ({ x: 0, v: 0 }));
    this.maps = [0, 1].map(() => Object.assign(document.createElement('canvas'), { width: 1, height: 1 }));
    this.held = grip(this.range, {
      move: (e) => { const p = point(this, e), { C } = WalkCircle; this.set(Math.hypot(p.x - C.x, p.y - C.y) / WalkCircle.SCALE / WalkCircle.PACE, true); },
      up: () => this.dispatchEvent(new Event('change', { bubbles: true })),
    });
    this.range.addEventListener('input', () => { if (!this.held()) this.set(this.range.valueAsNumber, true); });
    this.set(this.v);
  }
  attributeChangedCallback(_, __, v) { if (this.range && v !== null) this.value = v; }
  radius(min) { return min * WalkCircle.PACE * WalkCircle.SCALE; }
  get value() { return String(this.v); }
  set value(v) { this.set(Number(v)); }
  // The stops within the walk, by kind.
  get reach() {
    const R = this.radius(this.v), out = { metro: 0, tram: 0 };
    for (const s of CITY.stops) if (Math.hypot(s.x, s.y) <= R) out[s.kind]++;
    return out;
  }
  set(v, input = false) {
    v = clamp(Math.round(Number(v) || 0), this.min, this.max);
    const changed = v !== this.v; this.v = v;
    this.setValue(String(v));
    if (!this.held()) this.range.value = v;
    const { metro, tram } = this.reach, text = `${metro + tram} stops within ${v * WalkCircle.PACE} metres`;
    this.range.setAttribute('aria-valuetext', `${v} minutes, ${text}`);
    const out = this.$('.count'); if (out.textContent !== text) out.textContent = text;
    if (changed && input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }
  // The map twice, on two plain canvases: orange with pale streets for outside the circle, pale with dark
  // streets for inside it.
  paintMaps(w, h, px) {
    const { C } = WalkCircle;
    this.maps.forEach((c, inside) => {
      c.width = Math.round(w * px); c.height = Math.round(h * px);
      const g = c.getContext('2d'); g.scale(px, px);
      g.fillStyle = inside ? '#fbf3e4' : '#f25c05'; g.fillRect(0, 0, w, h);
      g.translate(C.x, C.y); g.rotate(-0.14);
      // blocks: some are parks or squares
      CITY.xs.forEach((a, i) => CITY.ys.forEach((b, j) => {
        const k = rnd(i * 31 + j * 17); if (k < 0.82 || !CITY.xs[i + 1] || !CITY.ys[j + 1]) return;
        g.fillStyle = inside ? 'rgba(242,92,5,0.16)' : 'rgba(255,255,255,0.12)'; g.fillRect(a.at + 2, b.at + 2, CITY.xs[i + 1].at - a.at - 4, CITY.ys[j + 1].at - b.at - 4);
      }));
      g.strokeStyle = inside ? '#f25c05' : '#fbe9d2';
      for (const [list, vertical] of [[CITY.xs, true], [CITY.ys, false]]) for (const l of list) {
        g.lineWidth = l.wide ? 2.2 : 0.7; g.beginPath();
        if (vertical) { g.moveTo(l.at, -300); g.lineTo(l.at, 300); } else { g.moveTo(-300, l.at); g.lineTo(300, l.at); }
        g.stroke();
      }
      // the lines: metro thick, tram thin
      for (const r of CITY.routes) {
        g.strokeStyle = inside ? '#111' : '#3a1500'; g.lineWidth = r.kind === 'metro' ? 2.6 : 1.3; g.beginPath();
        if (r.along === 'x') { g.moveTo(r.at, -300); g.lineTo(r.at, 300); } else { g.moveTo(-300, r.at); g.lineTo(300, r.at); }
        g.stroke();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    });
  }

  draw(ctx, w, h) {
    const { C, ANGLE } = WalkCircle;
    const key = `${Math.round(w * this.px)}`;
    if (this.mapsFor !== key) { this.paintMaps(w, h, this.px); this.mapsFor = key; }
    let live = spring(this.r, this.radius(this.v), this.dt, 240, 19);
    const R = this.r.x;
    ctx.drawImage(this.maps[0], 0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.clip(); ctx.drawImage(this.maps[1], 0, 0, w, h); ctx.restore();
    // stops: hollow outside the walk, solid inside, and each one swells as the circle passes it
    ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(-0.14);
    CITY.stops.forEach((s, i) => {
      const inside = Math.hypot(s.x, s.y) <= R;
      if (spring(this.pop[i], inside ? 1 : 0, this.dt, 320, 16)) live = true;
      const k = this.pop[i].x, size = (s.kind === 'metro' ? 3.4 : 2.6) * (1 + k * 0.35);
      ctx.fillStyle = inside ? '#111' : '#fbe9d2'; ctx.strokeStyle = inside ? '#111' : '#3a1500'; ctx.lineWidth = 1;
      ctx.beginPath(); if (s.kind === 'metro') ctx.rect(s.x - size, s.y - size, size * 2, size * 2); else ctx.arc(s.x, s.y, size, 0, TAU);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.stroke();
    put(ctx, this.$('.place'), C.x - this.$('.place').offsetWidth / 2, C.y - 6);
    hit(ctx, this.$('.count'), 10, h - 16, 200, 12);
    // lettering round the circle: the setting either side of the handle, the counts along the bottom
    const along = (text, centre, radius, flip) => {
      ctx.font = `900 10px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const stepA = 7.2 / radius, chars = [...text];
      chars.forEach((ch, n) => {
        const a = centre + (n - (chars.length - 1) / 2) * stepA * (flip ? -1 : 1);
        ctx.save(); ctx.translate(C.x + Math.cos(a) * radius, C.y + Math.sin(a) * radius); ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        ctx.strokeStyle = '#f25c05'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeText(ch, 0, 0); ctx.fillStyle = '#111'; ctx.fillText(ch, 0, 0); ctx.restore();
      });
      return (chars.length * stepA) / 2;
    };
    const gap = 17 / (R + 10), { metro, tram } = this.reach;
    const left = 'MAX WALK', right = `MIN · ${this.v * WalkCircle.PACE} M`;
    along(left, ANGLE - gap - (left.length * 7.2) / (R + 10) / 2, R + 10, false);
    along(right, ANGLE + gap + (right.length * 7.2) / (R + 10) / 2, R + 10, false);
    const m = `${metro} METRO`, t = `${tram} TRAM`;
    along(m, Math.PI / 2 + 0.12 + (m.length * 7.2) / (R + 10) / 2, R + 10, true);
    along(t, Math.PI / 2 - 0.12 - (t.length * 7.2) / (R + 10) / 2, R + 10, true);
    // the handle
    const hx = C.x + Math.cos(ANGLE) * R, hy = C.y + Math.sin(ANGLE) * R, held = this.held();
    ctx.fillStyle = 'rgba(60,20,0,0.3)'; ctx.beginPath(); ctx.arc(hx + 1, hy + (held ? 1 : 3), 14, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx, hy, held ? 15 : 14, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fbf3e4'; ctx.font = `900 13px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(this.v), hx, hy + 0.5);
    if (this.range.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 19, 0, TAU); ctx.stroke(); }
    hit(ctx, this.range, hx - 24, hy - 24, 48, 48);
    // north
    ctx.save(); ctx.translate(w - 24, 24); ctx.rotate(-0.14); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(0, -17); ctx.lineTo(5, -7); ctx.fill();
    ctx.fillStyle = '#fbf3e4'; ctx.font = `900 8px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, 0.5); ctx.restore();
    return live;
  }
}
customElements.define('walk-circle', WalkCircle);
// #endregion walk-circle
