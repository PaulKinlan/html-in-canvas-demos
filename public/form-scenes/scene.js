// Shared by the four demos on /form-scenes/. Each scene is drawn in a fixed design space (380 CSS pixels
// wide) and scaled to the canvas, so the layout is the same on a phone and on a wide window.
import { mount } from '/lib/stage-2d.js';

// #region scene
// paint(ctx, time, colours) draws in design units. Return true from it to ask for another frame.
export function scene(canvas, W, H, paint) {
  const geo = { k: 1, ox: 0 };
  const stage = mount(canvas, (ctx, w, h, t) => {
    geo.k = Math.min(w / W, h / H);
    geo.ox = (w - W * geo.k) / 2;
    ctx.translate(geo.ox, 0);
    ctx.scale(geo.k, geo.k);
    return paint(ctx, t, colours(canvas));
  });
  // A pointer event's position in design units.
  stage.point = (e) => {
    const b = canvas.getBoundingClientRect();
    return [(e.clientX - b.left - geo.ox) / geo.k, (e.clientY - b.top) / geo.k];
  };
  return stage;
}
// #endregion scene

export function colours(el) {
  const s = getComputedStyle(el);
  const v = (n) => s.getPropertyValue(n).trim();
  return { fg: v('--fg'), bg: v('--bg'), card: v('--card'), line: v('--line'), accent: v('--accent'), muted: v('--muted'), ok: v('--ok'), bad: v('--bad') };
}

// A small repeatable random number generator, so a scene looks the same on every load.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const query = (form) => new URLSearchParams(new FormData(form)).toString() || '(nothing)';
