// Sticky header that casts a shadow, for /list-table/.
// The scroll container is drawable, so the browser scrolls it and keeps the sticky header in place.
// The canvas draws the header band a second time, on top, with a shadow that follows scrollTop.
import { mount, put, hitOnly, clamp, smooth } from '/lib/stage-2d.js';

export default function start() {
  const canvas = document.getElementById('stickyCanvas');
  const scroller = document.getElementById('scroller');
  const table = document.getElementById('log');
  const head = table.tHead;
  const out = document.getElementById('stickyOut');
  const mode = document.getElementById('stickyMode');
  const PATHS = ['/', '/start/', '/slot/', '/sort-table/', '/heat-map/', '/shared/style.css', '/shared/nav.js', '/lib/stage-2d.js', '/list-table/', '/api/reports'];
  // 40 rows of sample data.
  table.tBodies[0].innerHTML = Array.from({ length: 40 }, (_, i) =>
    `<tr><td class="num">${i + 1}</td><td>${PATHS[(i * 7) % PATHS.length]}</td><td class="num">${12 + ((i * 37) % 180)}</td><td><input type="checkbox" aria-label="Keep request ${i + 1}"${i % 5 === 1 ? ' checked' : ''}></td></tr>`).join('');
  let paints = 0;

  // #region sticky-paint
  const stage = mount(canvas, (ctx, w, h) => {
    paints++;
    const top = scroller.scrollTop;
    const depth = smooth(clamp(top / 140));           // 0 at the top of the table, 1 after 140 px
    if (!put(ctx, scroller, 0, 0, w, h)) return false;
    const hh = head.offsetHeight, bw = scroller.clientWidth;   // clientWidth leaves out a scrollbar
    if (depth > 0 && mode.value !== 'none') {
      ctx.save();
      ctx.shadowColor = `rgb(0 0 0 / ${0.25 + 0.3 * depth})`;
      ctx.shadowBlur = 3 + 24 * depth;
      ctx.shadowOffsetY = 1 + 13 * depth;
      // The header comes toward the reader: up to 4% larger, about the middle of its top edge.
      const k = 1 + 0.04 * depth;
      ctx.translate(bw / 2, 0); ctx.scale(k, k); ctx.translate(-bw / 2, 0);
      if (mode.value === 'slice') {
        // The top band of the scroller's own picture. No second element is needed.
        ctx.drawElementImage(scroller, 0, 0, bw, hh, 0, 0, bw, hh);
      } else {
        // The thead as a drawable element nested in the drawable scroller.
        put(ctx, head, 0, 0, head.offsetWidth, hh);
      }
      ctx.restore();
      // The source-rectangle draw moved the hit box of the scroller to the band. Put it back.
      if (mode.value === 'slice') hitOnly(ctx, scroller, 0, 0, w, h);
    }
    out.textContent = `scrollTop ${Math.round(top)} of ${scroller.scrollHeight - scroller.clientHeight} px. Shadow depth ${depth.toFixed(2)}: blur ${(3 + 24 * depth).toFixed(0)} px, offset ${(1 + 13 * depth).toFixed(0)} px. ${paints} paint events, no scroll listener.`;
    return false;
  });
  // #endregion sticky-paint

  mode.addEventListener('change', () => { head.toggleAttribute('drawable', mode.value === 'nested'); stage.request(); });
  const smoothly = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
  document.getElementById('stickyTop').addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: smoothly() }));
  document.getElementById('stickyMid').addEventListener('click', () => scroller.scrollTo({ top: table.tBodies[0].rows[19].offsetTop - head.offsetHeight, behavior: smoothly() }));
  window.__listTable = { ...(window.__listTable ?? {}), sticky: { canvas, scroller, get paints() { return paints; } } };
}
