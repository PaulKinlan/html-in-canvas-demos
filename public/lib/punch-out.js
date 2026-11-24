// A sixth layout for lib/select-picker.js: the open menu has a piece cut out
// of one corner, in the shape of the select's own button, and the options
// flow round the cut like words round a picture.
//
//   <select picker="punch-out">
//     <button><selectedcontent></selectedcontent></button>
//     <option>…</option>
//   </select>
//
//   import { punchOut } from '/lib/punch-out.js';
//   const picker = punchOut(select);
//
// The picker is placed over the button with CSS anchor positioning. Its canvas
// draws the menu as one L-shaped path and leaves the corner with the button
// empty. Two things would still take a press meant for the button: the
// picker's own box, and the canvas, which takes the pointer in its empty
// pixels too. So the picker has pointer-events: none (its canvas has auto),
// and the canvas has a clip-path with the same corner missing. The button
// under the cut is then the real button, and a press on it closes the picker.
//
// After the Punch-Out Dropdown by Fabio Azevedo. The code here is not taken
// from it.

import { SelectPicker, layouts, supported } from './select-picker.js';

export { supported };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Space for the shadow round the menu, the gap between the button and the menu, and the menu's padding. CSS px. */
export const PUNCH = { margin: 18, gap: 7, pad: 10, radius: 16, spacing: 7 };

// #region css
// None of this applies when the library has left the select plain, with no canvas.
const CSS_TEXT = `
select[picker="punch-out"]:not([picker-state="plain"])::picker(select) {
  position-anchor: auto; position-area: none; margin: 0; inset: auto; pointer-events: none;
  left: calc(anchor(left) - ${PUNCH.gap}px);
  top: calc(anchor(top) - ${PUNCH.gap}px);
  position-try-fallbacks: --punch-right, --punch-up, --punch-up-right;
}
@position-try --punch-right { left: auto; right: calc(anchor(right) - ${PUNCH.gap}px); }
@position-try --punch-up { top: auto; bottom: calc(anchor(bottom) - ${PUNCH.gap}px); }
@position-try --punch-up-right { left: auto; top: auto; right: calc(anchor(right) - ${PUNCH.gap}px); bottom: calc(anchor(bottom) - ${PUNCH.gap}px); }
select[picker="punch-out"]:not([picker-state="plain"]) > canvas { pointer-events: auto; margin: -${PUNCH.margin}px; background: none; border: 0; border-radius: 0; box-shadow: none; touch-action: manipulation; }
:where(select[picker="punch-out"]:not([picker-state="plain"])) option { width: max-content; height: 38px; padding: 0 13px 0 10px; gap: 7px; border-radius: 19px; font: 15px/1 system-ui, sans-serif; background: color-mix(in srgb, currentColor 9%, var(--picker-bg, Canvas)); }
:where(select[picker="punch-out"]:not([picker-state="plain"])) option:is(:hover, :focus-visible) { background: color-mix(in srgb, var(--picker-accent, AccentColor) 26%, var(--picker-bg, Canvas)); }
:where(select[picker="punch-out"]:not([picker-state="plain"])) option:checked { background: var(--picker-accent, AccentColor); color: #fff; font-weight: 600; }
select[picker="punch-out"]:not([picker-state="plain"]) option:focus-visible { outline: 0; }
`;
// #endregion css

function addCSS(node) {
  const root = node.getRootNode(), head = root.nodeType === 9 ? root.head : root;
  if (head.querySelector('style[data-punch-out]')) return;
  const style = document.createElement('style');
  style.dataset.punchOut = '';
  style.textContent = CSS_TEXT;
  head.append(style);
}

// #region shape
// The outline of the menu in a frame where the cut is at the top left: a
// rectangle w by h with the corner cw by ch missing. arcTo() rounds the five
// outer corners and the one inner corner with the same call.
function outline(ctx, w, h, cw, ch, r) {
  const points = [[cw, 0], [w, 0], [w, h], [0, h], [0, ch], [cw, ch]];
  ctx.beginPath();
  ctx.moveTo((cw + w) / 2, 0);
  for (let i = 1; i <= points.length; i++) {
    const [x, y] = points[i % points.length], [nx, ny] = points[(i + 1) % points.length];
    ctx.arcTo(x, y, nx, ny, Math.min(r, Math.hypot(nx - x, ny - y) / 2, Math.hypot(x - points[i - 1][0], y - points[i - 1][1]) / 2));
  }
  ctx.closePath();
}
// #endregion shape

// #region flow
// Flow the options in lines, as text is. The lines level with the cut are
// shorter. Lines are filled from the cut outwards: with the button at the top
// that is the reading order, and with the button at the bottom the options are
// taken from the last one backwards, so the order on screen stays the same and
// the line that is left part empty is the one furthest from the button.
function flow(sizes, k, w, cw, ch, flipY) {
  const { pad, spacing } = PUNCH;
  const lineH = Math.max(1, ...sizes.map((size) => size.h)) * k, step = lineH + spacing * k;
  let beside = 0;
  while (pad + beside * step + lineH / 2 < ch) beside++;
  // The top of row j, counted from the cut. The first row past the cut starts below it.
  const rowY = (j) => (j < beside ? pad + j * step : Math.max(pad + j * step, ch + spacing + (j - beside) * step));
  const long = w - pad * 2, short = w - cw - spacing - pad;
  const width = (j) => (j < beside ? short : long);
  const lines = [[]];
  let used = 0;
  for (let n = 0; n < sizes.length; n++) {
    const i = flipY ? sizes.length - 1 - n : n, ow = sizes[i].w * k;
    // A new line when this one is full, and when a short line has no room for even one option.
    while (used + ow > width(lines.length - 1) && (lines.at(-1).length || lines.length <= beside)) { lines.push([]); used = 0; }
    lines.at(-1)[flipY ? 'unshift' : 'push']({ i, w: ow, h: sizes[i].h * k });
    used += ow + spacing * k;
  }
  for (const line of lines) {
    let x = 0;
    for (const o of line) { o.x = x; x += o.w + spacing * k; }
  }
  return { lines, rowY, h: Math.max(rowY(lines.length - 1) + lineH + pad, ch + 30) };
}
// #endregion flow

// #region layout
const LAYOUT = {
  prepare(s) {
    const picker = s.picker;
    if (!picker || !s.sizes.length) return;
    const { margin: M, gap, pad, spacing } = PUNCH;
    // Where the button is under the canvas. The CSS puts it in a corner, and which corner depends on the room.
    const c = picker.canvas.getBoundingClientRect(), b = picker.select.getBoundingClientRect();
    const hole = { x: b.left - c.left - gap, y: b.top - c.top - gap, w: b.width + gap * 2, h: b.height + gap * 2 };
    const flipX = hole.x + hole.w / 2 > s.w / 2, flipY = hole.y + hole.h / 2 > s.h / 2;
    const w = s.w - M * 2, room = s.h - M * 2;
    const cw = clamp(hole.w, 0, w - 60), ch = clamp(hole.h, 0, room - 60);
    // The canvas is made as tall as the lines need. The options keep their
    // size when the canvas changes, so one more frame settles it.
    const want = Math.ceil(Math.min(flow(s.sizes, 1, w, cw, hole.h, flipY).h + M * 2, clamp(innerHeight - 24, 220, 460)));
    if (want !== s.h && picker.want !== want) {
      picker.want = want;
      Promise.resolve().then(() => picker.refresh());
    }
    // If the window is too short for that, the options are drawn smaller.
    let k = 1, lines, rowY, h;
    for (; ; k -= 0.08) {
      ({ lines, rowY, h } = flow(s.sizes, k, w, cw, ch, flipY));
      if (h <= room || k <= 0.6) break;
    }
    const fits = h <= room;
    h = Math.min(h, room);
    const g = (s.punch ??= {});
    // The menu is in the corner of the canvas that the button is in.
    const top = flipY ? s.h - M - h : M;
    Object.assign(g, { hole, flipX, flipY, w, h, cw, ch, k, fits, lines: lines.length, top });
    g.spots = [];
    lines.forEach((line, j) => {
      const level = rowY(j) < ch;
      const y = flipY ? h - rowY(j) - (line[0]?.h ?? 0) : rowY(j);
      const left = level && !flipX ? cw + spacing : pad;
      for (const o of line) {
        g.spots[o.i] = {
          x: M + left + o.x, y: top + y, w: o.w, h: o.h, row: j, level,
          // 0 next to the button, 1 at the far corner: the order the options appear in.
          far: clamp(Math.hypot(left + o.x + o.w / 2 - (flipX ? w - cw / 2 : cw / 2), y + o.h / 2 - (flipY ? h - ch / 2 : ch / 2)) / Math.hypot(w, h), 0, 1),
        };
      }
    });
    // A canvas takes the pointer in its empty pixels too. So the button's own
    // box, with its rounded corner, and the part of the canvas the menu does
    // not use are cut from the canvas's box with clip-path. A press there
    // reaches the button. The menu's shadow in the gap round the button stays.
    const X = (x) => (M + (flipX ? w - x : x)).toFixed(1), Y = (y) => (flipY ? s.h - M - y : M + y).toFixed(1);
    const P = (x, y) => `${X(x)} ${Y(y)}`;
    const m = M + 2, bw = cw - gap, bh = ch - gap;
    const r = Math.min(parseFloat(getComputedStyle(picker.select).borderBottomRightRadius) || 0, bw / 2, bh / 2), c1 = r * 0.4477;
    const cut = `M${P(bw, -m)} L${P(w + m, -m)} L${P(w + m, h + m)} L${P(-m, h + m)} L${P(-m, bh)} L${P(bw - r, bh)} C${P(bw - c1, bh)} ${P(bw, bh - c1)} ${P(bw, bh - r)} Z`;
    // picker.clip = false leaves the canvas whole, to show what the cut is for.
    const clip = picker.clip === false ? '' : `path("${cut}")`;
    if (g.clip !== clip) { g.clip = clip; picker.canvas.style.clipPath = clip; }
  },
  place(i, s) {
    const g = s.punch, p = g?.spots[i];
    if (!p) return null;
    // Options appear outwards from the button and rise 10 px into place.
    const t = reduced() ? 1 : clamp(s.open * 1.7 - p.far * 0.9, 0, 1);
    const rise = (1 - t) * 10 * (g.flipY ? 1 : -1);
    return { m: new DOMMatrix().translate(p.x, p.y + rise).scale(g.k), alpha: t, order: i };
  },
  under(ctx, s) {
    const g = s.punch;
    if (!g?.spots) return;
    const { margin: M, radius } = PUNCH;
    // The menu grows out of the cut: its far edges start at the button and move to full size.
    const t = reduced() ? 1 : s.open;
    const w = g.cw + 24 + (g.w - g.cw - 24) * t, h = g.ch + 24 + (g.h - g.ch - 24) * t;
    ctx.translate(g.flipX ? s.w - M : M, g.flipY ? g.top + g.h : g.top);
    ctx.scale(g.flipX ? -1 : 1, g.flipY ? -1 : 1);
    outline(ctx, w, h, g.cw, g.ch, radius);
    const style = getComputedStyle(s.picker.canvas);
    ctx.shadowColor = 'rgb(0 0 0 / .3)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5 * (devicePixelRatio || 1);
    ctx.fillStyle = style.getPropertyValue('--picker-bg').trim() || 'Canvas';
    ctx.globalAlpha = clamp(t * 3, 0, 1);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha *= 0.2;
    ctx.strokeStyle = s.ink;
    ctx.stroke();
  },
  over(ctx, s) {
    // A ring on the option the arrow keys are on. An outline outside the option's box is not in its picture.
    const g = s.punch, p = g?.spots[s.active], option = s.picker?.options[s.active];
    if (!p || !option?.matches(':focus-visible')) return;
    ctx.strokeStyle = s.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4, p.h / 2 + 2);
    ctx.stroke();
  },
};
layouts['punch-out'] = { ...LAYOUT, size: (n, vw) => [Math.min(376, vw + 4), 300] };
// #endregion layout

// #region picker
/** Give a select the punch-out picker. Returns the SelectPicker. */
export function punchOut(select) {
  addCSS(select);
  select.setAttribute('picker', 'punch-out');
  // Moving the options into the picker's canvas makes the select choose again. Put the choice back.
  const chosen = select.selectedIndex;
  const picker = new SelectPicker(select, { layout: 'punch-out' });
  if (chosen >= 0 && select.selectedIndex !== chosen) select.selectedIndex = chosen;
  picker.s.picker = picker;
  // Each picker has its own height, so each has its own copy of the layout.
  picker.layout = { ...LAYOUT, size: (n, vw) => [Math.min(376, vw + 4), picker.want ?? 300] };
  return picker;
}
// #endregion picker
