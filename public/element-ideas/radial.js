import { mount, put, park, colors, back, clamp, tween } from './kit.js';

export default function start() {
  const canvas = document.getElementById('radialCanvas');
  const toggle = document.getElementById('radialToggle');
  const menu = document.getElementById('radialMenu');
  const items = [...menu.children];
  const out = document.getElementById('radialOut');
  let open = 0, wanted = 0, cancel = null;

  // #region radial
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    const cx = w / 2, cy = h / 2, radius = Math.min(108, w / 2 - 44);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.globalAlpha = open;
    ctx.beginPath(); ctx.arc(cx, cy, radius * open, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
    items.forEach((li, i) => {
      // Each item starts a little later than the one before it.
      const o = back(clamp(open * 1.6 - i * 0.075));
      if (o <= 0.01) { park(canvas, li); return; }
      const angle = -Math.PI / 2 + i * 2 * Math.PI / items.length;
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * radius * o, cy + Math.sin(angle) * radius * o);
      ctx.rotate((1 - o) * -1.2);
      ctx.scale(o, o);
      ctx.globalAlpha = clamp(o);
      // Each <li> of the <menu> is drawn on its own, so its button is hit where it lands.
      put(ctx, li, -li.offsetWidth / 2, -li.offsetHeight / 2);
      ctx.restore();
    });
    put(ctx, toggle, cx - toggle.offsetWidth / 2, cy - toggle.offsetHeight / 2);
    return false;
  });
  // #endregion radial

  function set(state, focus = true) {
    wanted = state;
    toggle.setAttribute('aria-expanded', !!state);
    // Closed, the items are not drawn. inert keeps Tab and hit testing away from them.
    menu.inert = !state;
    const from = open;
    cancel?.();
    cancel = tween(420, (p) => { open = from + (state - from) * p; stage.request(); });
    if (focus) (state ? items[0].querySelector('button') : toggle).focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => set(wanted ? 0 : 1));
  menu.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    out.textContent = 'Chosen: ' + button.textContent;
    set(0);
  });
  canvas.addEventListener('keydown', (e) => {
    if (!wanted) return;
    if (e.key === 'Escape') { set(0); return; }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement?.closest('li'));
    items[(i + step + items.length) % items.length].querySelector('button').focus({ preventScroll: true });
  });
  canvas.addEventListener('focusin', stage.request);
  canvas.addEventListener('focusout', stage.request);
  menu.inert = true;
}
