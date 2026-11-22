import { mount, put, park, colors, clamp } from '/form-state/kit.js';
import { route } from './probe.js';

const NEED = 70;   // pixels of pull past the end that open the drawer

export default function start() {
  const canvas = document.getElementById('drawerCanvas'), list = document.getElementById('drawerList'), sheet = document.getElementById('drawerSheet');
  const out = document.getElementById('drawerOut');
  const css = CSS.supports('overscroll-area', '--drawer');
  let pull = 0, held = false, endY = null, open = false, u = 0, wheelTimer = 0, opened = 0;
  // #region drawer
  // CSS overscroll-area would let an element be the thing that appears when a scroller is pulled past
  // its end. Chromium 157 does not have it, so the page measures the pull itself. The list is a
  // drawable scroller that scrolls natively. Once it is at its end, the distance the finger (or the
  // wheel) keeps going is the pull. The canvas draws the list pushed up by part of the pull and the
  // drawer rising behind it, and opens the drawer if the pull passes 70 px.
  const atEnd = () => list.scrollTop >= list.scrollHeight - list.clientHeight - 1;
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), lw = list.offsetWidth, lh = list.offsetHeight, sh = sheet.offsetHeight, k = Math.min(1, (w - 24) / lw);
    if (!held && pull > 0) pull = pull < 1 ? 0 : pull * 0.78;
    u += ((open ? 1 : 0) - u) * 0.22; if (Math.abs((open ? 1 : 0) - u) < 0.004) u = open ? 1 : 0;
    const rise = Math.max(u * sh, Math.min(pull, sh * 0.8));
    ctx.save();
    ctx.translate((w - lw * k) / 2, 12 - pull * 0.35 - u * 30); ctx.scale(k, k);
    ctx.globalAlpha = 1 - 0.45 * u; put(ctx, list, 0, 0);
    ctx.restore();
    // The drawer.
    ctx.save();
    ctx.translate((w - lw * k) / 2, h - rise * k); ctx.scale(k, k);
    if (rise > 0.5) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(0, -8, lw, 8); put(ctx, sheet, 0, 0); } else park(canvas, sheet);
    if (!open && pull > 2) {
      const f = clamp(pull / NEED);
      ctx.fillStyle = f >= 1 ? c.ok : c.accent; ctx.fillRect(0, -6, lw * f, 4);
      ctx.fillStyle = c.fg; ctx.beginPath(); ctx.roundRect(lw / 2 - 70, -40, 140, 28, 14); ctx.fill();
      ctx.fillStyle = c.bg; ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(f >= 1 ? 'Let go to open' : 'Keep pulling', lw / 2, -21);
    }
    ctx.restore();
    out.textContent = `CSS.supports('overscroll-area', …) is ${css}. The list is ${atEnd() ? 'at its end' : 'not at its end'}. Pull: ${Math.round(pull)} px. The drawer is ${open ? 'open' : 'closed'}. Opened by a pull: ${opened}.`;
    return held || pull > 0 || (u > 0 && u < 1);
  });
  const let_go = () => { held = false; endY = null; if (pull >= NEED && !open) { open = true; opened++; route('drawerR2', `A pull past the end of the list opened the drawer ${opened} time${opened === 1 ? '' : 's'}.`, 'works'); } stage.request(); };
  canvas.addEventListener('touchstart', (e) => { if (e.target.closest?.('#drawerList')) { held = true; endY = null; } }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!held || open) return;
    const y = e.touches[0].clientY;
    if (!atEnd()) { endY = null; pull = 0; } else { endY ??= y; pull = Math.max(0, endY - y); }
    stage.request();
  }, { passive: true });
  canvas.addEventListener('touchend', let_go); canvas.addEventListener('touchcancel', let_go);
  canvas.addEventListener('wheel', (e) => {
    if (open || !e.target.closest?.('#drawerList') || !atEnd() || e.deltaY <= 0) return;
    held = true; pull = Math.min(140, pull + e.deltaY * 0.5);
    clearTimeout(wheelTimer); wheelTimer = setTimeout(let_go, 160); stage.request();
  }, { passive: true });
  list.addEventListener('scroll', () => stage.request(), { passive: true });
  const close = () => { open = false; pull = 0; stage.request(); };
  document.getElementById('drawerClose').addEventListener('click', close);
  document.getElementById('drawerOpen').addEventListener('click', () => { open = !open; stage.request(); });
  route('drawerR1', `CSS.supports('overscroll-area', '--drawer') is ${css}, and CSS.supports('overscroll-behavior', 'contain') is ${CSS.supports('overscroll-behavior', 'contain')}.`, css ? 'works' : 'blocked');
  // #endregion drawer
  return { stage };
}
