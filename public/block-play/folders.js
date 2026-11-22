import { mount, put, clamp, smooth } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('foldersCanvas'), out = document.getElementById('foldersOut');
  const folders = [...canvas.querySelectorAll('fieldset')];
  const name = (i) => folders[i].querySelector('legend').textContent.trim();
  let order = folders.map((_, i) => i), from = folders.map((_, i) => i), now = [...from], t0 = -1e9, moving = -1;
  // #region folders
  // Each <fieldset> is a folder and its <legend> holds a button, the tab. A folder further back is drawn
  // 34 px higher, a little smaller and darker, so its tab stands clear above the folder in front. The
  // folders are drawn from the back to the front. Where two overlap, the one drawn last takes the input,
  // which is the one in front.
  const STEP = 34, TIME = 450;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const u = smooth(clamp((t - t0) / TIME)), fw = folders[0].offsetWidth, k = Math.min(1, (w - 24) / fw);
    now = folders.map((_, i) => from[i] + (order.indexOf(i) - from[i]) * u);
    const back = [...folders.keys()].sort((a, b) => now[b] - now[a]);
    for (const i of back) {
      const d = now[i], s = k * (1 - 0.035 * d);
      // The folder that was picked rises out of the stack on its way to the front.
      const lift = i === moving ? Math.sin(u * Math.PI) * 46 : 0;
      ctx.save();
      ctx.translate(w / 2, 62 + (folders.length - 1 - d) * STEP - lift);
      ctx.scale(s, s);
      ctx.filter = d > 0.02 ? `brightness(${1 - 0.09 * d})` : 'none';
      put(ctx, folders[i], -fw / 2, 0);
      ctx.restore();
    }
    out.textContent = `Order from the front: ${order.map(name).join(', ')}.${u < 1 ? ' Moving.' : ''}`;
    return u < 1;
  });
  canvas.addEventListener('click', (e) => {
    const tab = e.target.closest('legend button');
    if (!tab) return;
    const i = folders.indexOf(tab.closest('fieldset'));
    if (order[0] === i) return;
    from = [...now]; order = [i, ...order.filter((x) => x !== i)]; moving = i; t0 = performance.now();
    stage.request();
  });
  // #endregion folders
  return { stage };
}
