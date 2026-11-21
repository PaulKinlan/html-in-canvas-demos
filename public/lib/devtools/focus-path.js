// Focus order drawn as a path: the Tab stops under a root element in the order
// sequential focus navigation visits them, and a numbered line through them.
import { inCanvas, plate } from './stage.js';

// #region tab-order
/** Is this element a stop for the Tab key? */
export function isTabStop(el) {
  let index = el.tabIndex;
  if (index < 0) {
    if (el.hasAttribute('tabindex')) return false;
    // tabIndex reads -1 for two kinds of element that Tab does stop at.
    const editingHost = el.isContentEditable && !el.parentElement?.isContentEditable;
    if (!editingHost && !isKeyboardScroller(el)) return false;
  }
  if (el.matches(':disabled')) return false;
  if (el.closest('[inert]')) return false;
  if (el.localName === 'input' && el.type === 'hidden') return false;
  // Not rendered: display: none, visibility: hidden, or inside a closed <details>.
  if (!el.checkVisibility({ visibilityProperty: true })) return false;
  if (el.localName === 'input' && el.type === 'radio' && el.name) {
    // One stop per radio group: the checked button, or the first one.
    const group = [...(el.form ?? el.getRootNode()).querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)].filter((r) => r.form === el.form && !r.disabled);
    const stop = group.find((r) => r.checked) ?? group[0];
    if (stop !== el) return false;
  }
  return true;
}

/** A scroll container with nothing focusable inside is a Tab stop, so that the keyboard can scroll it. */
function isKeyboardScroller(el) {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const style = getComputedStyle(el);
  if (!/auto|scroll/.test(style.overflowY + style.overflowX)) return false;
  for (const inside of el.querySelectorAll('*')) if (inside.tabIndex >= 0) return false;
  return true;
}

/**
 * The Tab stops under `root` in the order Tab visits them: elements with a
 * positive tabindex first, lowest value first, then all the others in tree
 * order. Shadow trees and frames are not followed.
 */
export function tabOrder(root) {
  const stops = [...root.querySelectorAll('*')].filter(isTabStop);
  const positive = stops.filter((el) => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex); // sort() is stable
  return [...positive, ...stops.filter((el) => el.tabIndex <= 0)];
}
// #endregion tab-order

// #region place
/**
 * Where each stop is in the canvas. getBoundingClientRect() of a canvas child
 * reports the box it was last drawn in, so the path follows the picture and
 * not the layout. `drawn` (elements passed to drawElementImage() this frame)
 * marks the stops that were left out of the picture.
 */
export function placeStops(canvas, stops, drawn = null) {
  const origin = canvas.getBoundingClientRect();
  return stops.map((el, i) => {
    const r = inCanvas(canvas, el.getBoundingClientRect(), origin);
    const isDrawn = !drawn || drawn.some((d) => d === el || d.contains(el));
    return { el, number: i + 1, ...r, cx: r.x + r.width / 2, cy: r.y + r.height / 2, drawn: isDrawn, tabIndex: el.tabIndex };
  });
}
// #endregion place

// #region draw-path
const INK = { forward: '#2f6bff', back: '#ff7a1a', missing: '#e5484d', active: '#12b76a', text: '#fff' };

/** Does the step from a to b go against reading order (up, or left on the same line)? */
export function goesBack(a, b) {
  const sameLine = Math.abs(b.cy - a.cy) < Math.min(a.height, b.height) * 0.6;
  return sameLine ? b.cx < a.cx : b.cy < a.cy;
}

/**
 * Draw the path. The context is in CSS pixels. Stops that are not drawn are
 * lined up along the bottom edge in a red strip, and the path runs to them there.
 */
export function drawFocusPath(ctx, placed, { width, height, time = 0, active = null, moving = true } = {}) {
  const missing = placed.filter((s) => !s.drawn);
  const points = placed.map((s) => ({ ...s }));
  if (missing.length) {
    const strip = 30, step = Math.min(34, (width - 20) / missing.length);
    ctx.save();
    ctx.fillStyle = 'rgba(229,72,77,.16)';
    ctx.fillRect(0, height - strip, width, strip);
    ctx.fillStyle = INK.missing;
    ctx.fillRect(0, height - strip, width, 1.5);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(`${missing.length} Tab ${missing.length === 1 ? 'stop is' : 'stops are'} not drawn`, width - 8, height - strip / 2);
    ctx.restore();
    let n = 0;
    for (const p of points) if (!p.drawn) { p.cx = 20 + step * n++; p.cy = height - strip / 2; p.x = p.cx - 11; p.y = p.cy - 11; p.width = p.height = 22; }
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The line, one step at a time, so a step against reading order can be a different colour.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const back = goesBack(a, b);
    ctx.strokeStyle = !a.drawn || !b.drawn ? INK.missing : back ? INK.back : INK.forward;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.setLineDash(back ? [7, 6] : [12, 5]);
    ctx.lineDashOffset = moving ? -(time / 40) % 1000 : 0; // the dashes move from a to b
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
    // An arrow head half way along.
    const angle = Math.atan2(b.cy - a.cy, b.cx - a.cx), mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    if (Math.hypot(b.cx - a.cx, b.cy - a.cy) > 30) {
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(angle) * 7, my + Math.sin(angle) * 7);
      ctx.lineTo(mx + Math.cos(angle + 2.5) * 7, my + Math.sin(angle + 2.5) * 7);
      ctx.lineTo(mx + Math.cos(angle - 2.5) * 7, my + Math.sin(angle - 2.5) * 7);
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // An outline round each stop and its number.
  for (const p of points) {
    const on = p.el === active;
    const colour = !p.drawn ? INK.missing : on ? INK.active : p.tabIndex > 0 ? INK.back : INK.forward;
    if (p.drawn) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = on ? 3 : 1.25;
      ctx.globalAlpha = on ? 1 : 0.55;
      ctx.strokeRect(p.x - 2, p.y - 2, p.width + 4, p.height + 4);
      ctx.globalAlpha = 1;
    }
    const bx = p.drawn ? Math.max(11, p.x) : p.cx, by = p.drawn ? Math.max(11, p.y) : p.cy;
    ctx.beginPath();
    ctx.arc(bx, by, on ? 12 : 10, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = INK.text;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.number), bx, by + 0.5);
    if (p.tabIndex > 0 && p.drawn) plate(ctx, `tabindex=${p.tabIndex}`, bx - 10, by - 31, { fill: INK.back, maxX: width - 4 });
  }
  ctx.restore();
  return { steps: Math.max(0, points.length - 1), back: points.slice(1).filter((b, i) => goesBack(points[i], b)).length, missing: missing.length };
}
// #endregion draw-path
