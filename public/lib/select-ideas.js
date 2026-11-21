// Five more pickers for a customisable select, built on select-picker.js.
//
//   import { ideaPicker, flyToButton, sampleColours } from '/lib/select-ideas.js';
//   ideaPicker(select, 'lens');     // a long list drawn small, with a magnifier under the pointer
//   ideaPicker(select, 'jelly');    // options on springs
//   ideaPicker(select, 'seats');    // options placed as a seat plan
//   sampleColours(select);          // options on a colour field; a press on the field adds an option
//   flyToButton(select);            // the chosen option's pixels fly from the picker into the button
//
// Each layout is an entry in `layouts` from select-picker.js, so the select
// keeps the value, the keyboard and the form entry, and every option is hit
// tested where it is drawn.

import { SelectPicker, layouts, supported } from './select-picker.js';
export { supported };

const T = (x, y) => new DOMMatrix().translate(x, y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A SelectPicker whose layout can reach the picker (for its canvas and options) through s.picker. */
export function ideaPicker(select, layout, { canvas = null } = {}) {
  // Moving the options into the canvas one at a time makes the select choose
  // again each time, and it ends on the last option. Put the choice back.
  const chosen = select.selectedIndex;
  const picker = new SelectPicker(select, { layout, canvas });
  if (!canvas && chosen >= 0) select.selectedIndex = chosen;
  picker.s.picker = picker;
  return picker;
}

// The text a layout writes for an option. (A label attribute would replace the option's own content.)
const nameOf = (option) => option?.dataset.name ?? option?.label ?? '';

// Layouts with their own motion ask for another frame.
const again = (s) => requestAnimationFrame(() => { try { if (s.picker?.open) s.picker.canvas.requestPaint(); } catch {} });

// #region lens
// Every option is drawn small, in columns, so a list of 150 fits without
// scrolling. over() then draws the options near the pointer a second time,
// enlarged and clipped to a circle. The second drawElementImage() of an option
// also moves its hit box, so a tap in the lens lands on the enlarged option.
const LENS = { cols: 3, R: 78 };
layouts.lens = {
  size: (n, vw, vh) => [Math.min(340, vw - 24), Math.round(clamp(Math.ceil(n / LENS.cols) * 9 + 46, 160, vh * 0.7))],
  releasePicks: true,
  prepare(s) {
    const rows = Math.ceil(s.n / LENS.cols), o = s.sizes[0] ?? { w: 150, h: 30 };
    const colW = (s.w - 16) / LENS.cols, rowH = (s.h - 46) / rows;
    s.lens = { rows, colW, rowH, k: Math.min((colW - 4) / o.w, rowH / o.h) };
    // The point being magnified: the pointer, or the focused option when the keyboard is in use.
    const a = this.spot(s.active, s);
    // Across, the lens is centred on a column, so a whole option fits in it.
    const col = clamp(Math.floor((s.px - 8) / colW), 0, LENS.cols - 1);
    s.focus = s.pointer ? { x: 8 + col * colW + (o.w * s.lens.k) / 2, y: clamp(s.py, 38, s.h - 8) } : { x: a.x + (o.w * s.lens.k) / 2, y: a.y + (o.h * s.lens.k) / 2 };
  },
  /** Top left corner of option i at its small size. */
  spot(i, s) {
    const { rows, colW, rowH } = s.lens;
    return { x: 8 + Math.floor(i / rows) * colW, y: 38 + (i % rows) * rowH };
  },
  place(i, s) {
    const { x, y } = this.spot(i, s);
    return { m: T(x, y).scale(s.lens.k), alpha: 0.75 * s.open, order: i };
  },
  over(ctx, s) {
    const { k } = s.lens, { x: fx, y: fy } = s.focus, R = LENS.R * s.open, zoom = Math.min(1.15 / k, 5);
    const options = s.picker.options;
    ctx.save();
    ctx.beginPath(); ctx.arc(fx, fy, R, 0, 7); ctx.clip();
    ctx.fillStyle = getComputedStyle(s.picker.canvas).backgroundColor;
    ctx.fillRect(fx - R, fy - R, R * 2, R * 2);
    let hot = -1, best = 1e9;
    for (const [i, option] of options.entries()) {
      const p = this.spot(i, s), { w, h } = s.sizes[i];
      const cx = p.x + (w * k) / 2, cy = p.y + (h * k) / 2;
      const d = Math.hypot((cx - fx) * 0.25, cy - fy); // rows are much flatter than they are wide
      if (d < best) { best = d; hot = i; }
      if (Math.abs(cx - fx) * zoom > R + (w * k * zoom) / 2 || Math.abs(cy - fy) * zoom > R + h) continue;
      ctx.save();
      // A point at distance d from the focus is drawn at distance d·zoom.
      ctx.translate(fx + (p.x - fx) * zoom, fy + (p.y - fy) * zoom);
      ctx.scale(k * zoom, k * zoom);
      ctx.drawElementImage(option, 0, 0, w, h);
      ctx.restore();
    }
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = s.accent;
    ctx.beginPath(); ctx.arc(fx, fy, R, 0, 7); ctx.stroke();
    // The name of the option under the pointer, where a finger does not cover it.
    if (s.pointer) { const under = s.picker.optionAt(...at(s)); if (under >= 0) hot = under; }
    s.hot = hot;
    ctx.globalAlpha = s.open;
    ctx.fillStyle = s.ink; ctx.font = '600 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(nameOf(options[hot]), s.w / 2, 20, s.w - 24);
  },
};
// #endregion lens

// #region jelly
// Each option is a mass on a spring. It falls in when the picker opens, is
// pushed aside by a pointer that moves through it, and is joined to its
// neighbours, so a push travels along the list. The transform is a
// translation, a skew and a squash, all affine, so the 2D canvas draws it and
// the hit box follows.
layouts.jelly = {
  size: (n, vw) => [Math.min(270, vw - 24), n * 46 + 20],
  releasePicks: true,
  prepare(s) {
    const now = performance.now();
    if (!s.jelly || s.open < 0.02 || s.jelly.length !== s.n) {
      s.jelly = Array.from({ length: s.n }, (_, i) => ({ x: 0, y: -s.h - i * 46, vx: 0, vy: 0, g: 1, vg: 0 }));
      s.jellyAt = now; s.jellyP = null;
    }
    let dt = Math.min(0.032, (now - s.jellyAt) / 1000);
    s.jellyAt = now;
    const moved = s.pointer && s.jellyP ? { x: s.px - s.jellyP.x, y: s.py - s.jellyP.y } : { x: 0, y: 0 };
    s.jellyP = s.pointer ? { x: s.px, y: s.py } : null;
    let energy = 0;
    for (let step = 0; step < 2; step++) {
      for (const [i, b] of s.jelly.entries()) {
        const home = 10 + i * 46 + 23;
        // The spring to its own place, and springs to the options above and below.
        let fx = -260 * b.x - 15 * b.vx, fy = -210 * b.y - 13 * b.vy;
        for (const j of [i - 1, i + 1]) if (s.jelly[j]) { fx += 120 * (s.jelly[j].x - b.x); fy += 60 * (s.jelly[j].y - b.y); }
        if (s.pointer && Math.abs(s.py - (home + b.y)) < 30) { fx += moved.x * 900; fy += moved.y * 300; }
        b.vx += fx * dt / 2; b.vy += fy * dt / 2;
        b.x += b.vx * dt / 2; b.y += b.vy * dt / 2;
        // g is how swollen the option is: 1.12 under the pointer or with focus.
        const want = (s.pointer ? Math.abs(s.py - home) < 23 : i === s.active) ? 1.12 : 1;
        b.vg += (380 * (want - b.g) - 11 * b.vg) * dt / 2;
        b.g += b.vg * dt / 2;
        energy += Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.vg) * 40 + Math.abs(want - b.g) * 40;
      }
    }
    if (energy > 0.6) again(s);
  },
  place(i, s) {
    const b = s.jelly[i], o = s.sizes[i];
    const squash = clamp(1 + b.vy / 1400, 0.7, 1.3);
    const m = T(s.w / 2 + b.x, 10 + i * 46 + 23 + b.y)
      .skewX(clamp(-b.vx / 22, -24, 24))
      .scale(b.g / squash, b.g * squash)
      .translate(-o.w / 2, -o.h / 2);
    return { m, alpha: s.open, order: b.g };
  },
};
// #endregion jelly

// #region seats
// A seat plan. Each option has data-row (0 is the front) and data-seat (its
// place in the row, -1 to 1 from left to right). Rows are arcs about a point
// above the stage, and each seat is turned to face it. Seats near the pointer
// are enlarged. A taken seat is a disabled option.
layouts.seats = {
  size: (n, vw) => [Math.min(360, vw - 24), 330],
  releasePicks: true,
  prepare(s) {
    s.seat ??= [];
    const options = s.picker.options;
    if (s.seat.length !== s.n) s.seat = options.map((o) => ({ row: +o.dataset.row, at: +o.dataset.seat }));
    const rows = Math.max(...s.seat.map((p) => p.row)) + 1;
    s.plan = { cx: s.w / 2, cy: -150, r0: 250, step: Math.min(30, (s.h - 124) / Math.max(1, rows - 1)), spread: Math.asin(Math.min(1, (s.w / 2 - 22) / (250 + (rows - 1) * 30))) };
  },
  place(i, s) {
    const { cx, cy, r0, step, spread } = s.plan, { row, at } = s.seat[i], o = s.sizes[i];
    const r = r0 + row * step, a = at * spread;
    const x = cx + Math.sin(a) * r, y = cy + Math.cos(a) * r;
    const [fx, fy] = s.pointer ? [s.px, s.py] : [1e4, 1e4];
    const near = Math.exp(-((x - fx) ** 2 + (y - fy) ** 2) / (2 * 26 ** 2));
    const lift = i === s.active && !s.pointer ? 0.35 : near * 0.7;
    return {
      m: T(x + (x - fx) * near * 0.35, y + (y - fy) * near * 0.35).rotate((-a * 180) / Math.PI).scale((1 + lift) * (0.5 + 0.5 * s.open)).translate(-o.w / 2, -o.h / 2),
      alpha: s.open, order: lift,
    };
  },
  under(ctx, s) {
    const { cx, cy, r0, spread } = s.plan;
    ctx.globalAlpha = s.open;
    ctx.strokeStyle = s.ink; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r0 - 34, Math.PI / 2 - spread * 0.7, Math.PI / 2 + spread * 0.7); ctx.stroke();
    ctx.fillStyle = s.ink; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('STAGE', cx, cy + r0 - 44);
  },
  over(ctx, s) {
    const option = s.picker.options[s.pointer ? s.picker.optionAt(...at(s)) : s.active];
    ctx.globalAlpha = s.open;
    ctx.fillStyle = s.ink; ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center';
    if (option) ctx.fillText(nameOf(option) + (option.disabled ? ' (taken)' : ''), s.w / 2, s.h - 14, s.w - 20);
  },
};
// The pointer's place in the viewport, from its place in the canvas.
const at = (s) => { const r = s.picker.canvas.getBoundingClientRect(); return [r.left + s.px, r.top + s.py]; };
// #endregion seats

// #region sample
// Options are dots on a colour field, each at the place of its own colour
// (hue across, lightness down). A press on the field where there is no option
// reads the colour at that point, adds an <option> for it and chooses it.
const FIELD = { pad: 12, top: 12, bottom: 44 };
const hsl = (h, l) => `hsl(${Math.round(h)} 85% ${Math.round(l)}%)`;
const fieldAt = (s, x, y) => ({ h: clamp((x - FIELD.pad) / (s.w - FIELD.pad * 2), 0, 1) * 360, l: 92 - clamp((y - FIELD.top) / (s.h - FIELD.top - FIELD.bottom), 0, 1) * 80 });

layouts.sample = {
  size: (n, vw) => [Math.min(330, vw - 24), 290],
  releasePicks: true,
  place(i, s) {
    const option = s.picker.options[i], o = s.sizes[i];
    const x = FIELD.pad + (+option.dataset.h / 360) * (s.w - FIELD.pad * 2);
    const y = FIELD.top + ((92 - +option.dataset.l) / 80) * (s.h - FIELD.top - FIELD.bottom);
    const near = s.pointer ? Math.exp(-((x - s.px) ** 2 + (y - s.py) ** 2) / (2 * 22 ** 2)) : 0;
    const big = option.selected || (i === s.active && !s.pointer) ? 0.5 : near * 0.6;
    return { m: T(x, y).scale((1 + big) * s.open).translate(-o.w / 2, -o.h / 2), alpha: s.open, order: big };
  },
  under(ctx, s) {
    // The field is drawn once into a canvas of its own, which stays readable.
    const field = (s.field ??= paintField(s));
    ctx.globalAlpha = s.open;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(FIELD.pad, FIELD.top, s.w - FIELD.pad * 2, s.h - FIELD.top - FIELD.bottom, 10); ctx.clip();
    ctx.drawImage(field, FIELD.pad, FIELD.top, s.w - FIELD.pad * 2, s.h - FIELD.top - FIELD.bottom);
    ctx.restore();
  },
  over(ctx, s) {
    const inField = s.pointer && s.py < s.h - FIELD.bottom;
    const { h, l } = fieldAt(s, s.px, s.py);
    const option = inField ? s.picker.options[s.picker.optionAt(...at(s))] : s.picker.options[s.active];
    const colour = option ? option.value : inField ? hsl(h, l) : '';
    ctx.globalAlpha = s.open;
    if (colour) { ctx.fillStyle = colour; ctx.beginPath(); ctx.roundRect(FIELD.pad, s.h - 34, 24, 24, 6); ctx.fill(); }
    ctx.fillStyle = s.ink; ctx.font = '13px ui-monospace, monospace'; ctx.textBaseline = 'middle';
    ctx.fillText(option ? nameOf(option) : inField ? `${colour}  press to add` : '', FIELD.pad + 32, s.h - 22, s.w - 60);
  },
};

function paintField(s) {
  const field = document.createElement('canvas');
  field.width = 180; field.height = 100;
  const ctx = field.getContext('2d', { willReadFrequently: true });
  for (let x = 0; x < field.width; x++) {
    const g = ctx.createLinearGradient(0, 0, 0, field.height);
    for (let k = 0; k <= 4; k++) g.addColorStop(k / 4, hsl((x / (field.width - 1)) * 360, 92 - k * 20));
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1, field.height);
  }
  return field;
}

/**
 * A select whose options sit on a colour field. Returns the picker. The page
 * writes options as <option value="#4682b4" data-h="207" data-l="49">Steel blue</option>.
 * picker.read(x, y) reports how the colour at a canvas point can be read.
 */
export function sampleColours(select, { make = defaultOption, canvas = null } = {}) {
  const picker = ideaPicker(select, 'sample', { canvas });
  if (!supported) return picker;
  const { s } = picker;

  // Reading a pixel from the picker's own canvas, after options were drawn into it.
  picker.read = (x, y) => {
    const dpr = picker.canvas.width / s.w;
    try {
      const d = picker.canvas.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return { from: 'the picker canvas', rgb: [d[0], d[1], d[2]] };
    } catch (err) {
      // Fall back to the field's own canvas, which has no elements drawn in it.
      const f = s.field ?? paintField(s);
      const fx = clamp(Math.round(((x - FIELD.pad) / (s.w - FIELD.pad * 2)) * (f.width - 1)), 0, f.width - 1);
      const fy = clamp(Math.round(((y - FIELD.top) / (s.h - FIELD.top - FIELD.bottom)) * (f.height - 1)), 0, f.height - 1);
      const d = f.getContext('2d').getImageData(fx, fy, 1, 1).data;
      return { from: `the field canvas (the picker canvas refused: ${err.name})`, rgb: [d[0], d[1], d[2]] };
    }
  };

  /** Add an option for the colour at a canvas point and choose it. */
  picker.addAt = (x, y, { close = true } = {}) => {
    const got = picker.read(x, y), { h, l } = fieldAt(s, x, y);
    const hex = '#' + got.rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    let option = picker.options.find((o) => o.value === hex);
    if (!option) {
      option = make(hex);
      option.dataset.h = h.toFixed(1); option.dataset.l = l.toFixed(1);
      picker.canvas.append(option);
      picker.refresh();
    }
    picker.choose(picker.options.indexOf(option), { close });
    return { ...got, hex, option };
  };

  select.addEventListener('pointerup', (e) => {
    if (e.target !== picker.canvas || !picker.open) return; // a press on an option is the select's business
    const r = picker.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < s.h - FIELD.bottom && y > FIELD.top) picker.addAt(x, y);
  });
  return picker;
}

function defaultOption(hex) {
  const option = document.createElement('option');
  option.value = hex;
  option.dataset.name = hex;
  option.innerHTML = `<span class="dot" style="background:${hex}"></span><span class="name">${hex}</span>`;
  return option;
}
// #endregion sample

// #region shelf
// A plain layout for the flight below: cards in two columns, the one under the pointer raised.
layouts.shelf = {
  size(n, vw) {
    const w = Math.min(330, vw - 24);
    return [w, Math.ceil(n / 2) * 96 + 16];
  },
  place(i, s) {
    const o = s.sizes[i], colW = (s.w - 16) / 2;
    const x = 8 + (i % 2) * colW + colW / 2, y = 8 + Math.floor(i / 2) * 96 + 48;
    const on = i === s.active;
    return { m: T(x, y + (1 - s.open) * 30).scale(on ? 1.05 : 1).translate(-o.w / 2, -o.h / 2), alpha: s.open, order: on ? 1 : 0 };
  },
};
// #endregion shelf

// #region fly
// When the select closes, its options stop painting in the same frame, so
// nothing can be drawn with drawElementImage() after a choice. The picker
// canvas still holds the pixels of its last frame. flyToButton() copies the
// chosen option's rectangle out of that canvas into a small canvas in the top
// layer and moves it to the button, where <selectedcontent> is then shown.
export function flyToButton(select, { ms = 520, canvas = null } = {}) {
  const picker = ideaPicker(select, canvas ? 'shelf' : select.getAttribute('picker') || 'shelf', { canvas });
  if (!supported) return picker;
  const state = { flights: 0, last: null };
  picker.flight = state;
  let snap = null;

  // Before the select handles a press or a key, note where every option is.
  const note = () => {
    if (!picker.open) return;
    const c = picker.canvas.getBoundingClientRect();
    snap = { c, rects: picker.options.map((o) => o.getBoundingClientRect()), at: performance.now() };
  };
  for (const type of ['pointerdown', 'pointerup', 'mouseup', 'keydown', 'touchend']) select.addEventListener(type, note, true);

  picker.fly = (i) => {
    const target = select.querySelector('selectedcontent') ?? select;
    const from = snap?.rects[i];
    if (!from || !(from.width > 0)) return null;
    const { c } = snap, k = picker.canvas.width / c.width;
    const copy = document.createElement('canvas');
    copy.width = Math.round(from.width * k); copy.height = Math.round(from.height * k);
    let drawn = 'copied from the picker canvas';
    try { copy.getContext('2d').drawImage(picker.canvas, (from.left - c.left) * k, (from.top - c.top) * k, from.width * k, from.height * k, 0, 0, copy.width, copy.height); }
    catch (err) { drawn = `copy failed: ${err.message}`; }
    copy.popover = 'manual';
    copy.style.cssText = `position:fixed;inset:auto;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none;border-radius:10px;transform-origin:0 0;box-shadow:0 8px 24px rgb(0 0 0 / .3)`;
    document.body.append(copy);
    copy.showPopover();
    const to = target.getBoundingClientRect();
    const scale = Math.min(to.height / from.height, to.width / from.width, 1);
    const dx = to.left - from.left, dy = to.top + (to.height - from.height * scale) / 2 - from.top;
    target.style.opacity = '0';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const anim = copy.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.35 + 40}px, ${dy * 0.5 - 50}px) scale(${(1 + scale) / 2 + 0.15}) rotate(-8deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)`, opacity: 0.2 },
    ], { duration: reduce ? 1 : ms, easing: 'cubic-bezier(.3, 0, .2, 1)' });
    state.flights++;
    state.last = { drawn, from: [from.left, from.top, from.width, from.height].map(Math.round), to: [to.left, to.top].map(Math.round), ink: inkOf(copy) };
    const done = () => {
      copy.remove();
      target.style.opacity = '';
      target.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
    };
    anim.finished.then(done, done);
    return state.last;
  };

  select.addEventListener('input', () => { if (snap && performance.now() - snap.at < 1500) picker.fly(picker.options.indexOf(select.selectedOptions[0])); });
  return picker;
}

// Fraction of the copy's pixels that are not transparent, or a note when it cannot be read.
function inkOf(canvas) {
  try {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 8) n++;
    return n / (d.length / 16);
  } catch (err) { return `not readable (${err.name})`; }
}
// #endregion fly
