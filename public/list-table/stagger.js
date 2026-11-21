// Staggered list entrance, for /list-table/.
// Each item of an <ol> is drawn at a delay from its index. The numbers come from the list markers, by one
// of three routes: an inside marker in the picture of each <li>, an outside marker (which is lost), or
// rows cut from the picture of the whole <ol>.
import { mount, put, hitOnly, clamp, lerp, easeOut, back, reducedMotion } from '/lib/stage-2d.js';

export default function start() {
  const canvas = document.getElementById('listCanvas');
  const ol = document.getElementById('steps');
  const out = document.getElementById('listOut');
  const markers = document.getElementById('listMarkers');
  const style = document.getElementById('listStyle');
  const insert = document.getElementById('listInsert');
  const STEP = 90, DURATION = 620;
  const seen = new WeakMap();       // li -> { t0, y }: when its entrance starts and where it was last drawn
  let extra = null;                 // the inserted <li>, if there is one
  let played = false;

  // #region ol-markers
  // Move the drawable attribute between the items and the list. A drawable <li> inside a drawable <ol>
  // would be a nested drawable element, so only one of the two has it at a time.
  function setRoute(route) {
    const slices = route === 'slices';
    ol.dataset.markers = route === 'inside' ? 'inside' : 'outside';
    ol.toggleAttribute('drawable', slices);
    for (const li of ol.children) li.toggleAttribute('drawable', !slices);
    replay();
  }
  // #endregion ol-markers

  function replay() {
    const now = performance.now();
    [...ol.children].forEach((li, i) => seen.set(li, { t0: now + i * STEP, y: null }));
    stage.request();
  }

  // #region ol-slice
  // Draw one item with the current transform. In "slices" the item has no picture of its own, so draw
  // the row of the <ol> that holds it: the nine-argument call takes a source rectangle in the element's
  // own CSS pixels. The row starts at the left edge of the <ol>, so it includes the marker.
  function drawItem(ctx, li, x, y) {
    if (li.hasAttribute('drawable')) return put(ctx, li, x, y, li.offsetWidth, li.offsetHeight);
    try {
      ctx.drawElementImage(ol, 0, li.offsetTop, ol.offsetWidth, li.offsetHeight, x - li.offsetLeft, y, ol.offsetWidth, li.offsetHeight);
      return true;
    } catch { return false; }
  }
  // #endregion ol-slice

  // #region ol-paint
  const stage = mount(canvas, (ctx, w, h, now) => {
    const items = [...ol.children], slices = ol.hasAttribute('drawable');
    const still = reducedMotion();
    let moving = false, missing = false;
    if (!played && !still) return false;               // nothing is drawn until the entrance starts
    items.forEach((li, i) => {
      const s = seen.get(li) ?? { t0: -1e9, y: li.offsetTop };
      seen.set(li, s);
      const p = still ? 1 : clamp((now - s.t0) / DURATION);
      // An item below an inserted one slides to its new offsetTop.
      if (s.y == null || still) s.y = li.offsetTop;
      else if (Math.abs(li.offsetTop - s.y) > 0.5) { s.y = lerp(s.y, li.offsetTop, 0.2); moving = true; } else s.y = li.offsetTop;
      if (p <= 0) { moving = true; return; }           // not yet its turn
      if (p < 1) moving = true;
      const e = easeOut(p), lw = li.offsetWidth, lh = li.offsetHeight, x = li.offsetLeft, y = s.y;
      ctx.save();
      ctx.globalAlpha = clamp(p * 2.5);
      if (style.value === 'slide') {
        ctx.translate(x + lw / 2 + (1 - e) * w * 0.7, y + lh / 2);
        ctx.rotate((1 - e) * 0.12);
      } else if (style.value === 'drop') {
        const b = back(p);
        ctx.translate(x + lw / 2, y + lh / 2 - (1 - b) * 90);
        ctx.scale(1 + (1 - e) * 0.12, 0.6 + 0.4 * b);
      } else {
        // Fan: every item starts stacked on the first one and swings down round the top left corner.
        ctx.translate(x, lerp(items[0].offsetTop, y, e) + lh / 2);
        ctx.rotate((1 - back(p)) * -0.5 * Math.min(i + 1, 4) / 4);
        ctx.translate(lw / 2, 0);
      }
      if (p < 1) { ctx.shadowColor = 'rgb(0 0 0 / .25)'; ctx.shadowBlur = 16 * (1 - e); ctx.shadowOffsetY = 8 * (1 - e); }
      if (!drawItem(ctx, li, -lw / 2, -lh / 2)) missing = true;
      ctx.restore();
    });
    // A row draw moves the hit box of the whole <ol>. End with a full draw at zero alpha, which puts
    // every checkbox back under its drawn place.
    if (slices && !moving) hitOnly(ctx, ol, 0, 0, ol.offsetWidth, ol.offsetHeight);
    const route = slices ? 'rows of the ol picture, cut with a source rectangle. Markers: in the picture.'
      : ol.dataset.markers === 'inside' ? 'one picture for each li, list-style-position: inside. Markers: in the picture.'
      : 'one picture for each li, list-style-position: outside. Markers: not in the picture, which ends at the border box.';
    out.textContent = `${items.length} items, ${route}`;
    return moving || missing;
  });
  // #endregion ol-paint

  markers.addEventListener('change', () => setRoute(markers.value));
  style.addEventListener('change', replay);
  document.getElementById('listReplay').addEventListener('click', replay);
  document.getElementById('listReversed').addEventListener('change', (e) => { ol.reversed = e.target.checked; });
  insert.addEventListener('click', () => {
    if (extra) { extra.remove(); extra = null; insert.textContent = 'Insert a step at 3'; stage.request(); return; }
    extra = document.createElement('li');
    extra.innerHTML = '<label><input type="checkbox"> Record the findings</label>';
    extra.toggleAttribute('drawable', !ol.hasAttribute('drawable'));
    // Remember where the items are drawn now, so the ones below can slide down.
    for (const li of ol.children) { const s = seen.get(li); if (s && s.y == null) s.y = li.offsetTop; }
    ol.insertBefore(extra, ol.children[2]);
    seen.set(extra, { t0: performance.now() + 120, y: null });
    insert.textContent = 'Remove the inserted step';
    stage.request();
  });
  // The entrance plays the first time half of the canvas is on screen.
  new IntersectionObserver(([e], io) => { if (e.isIntersecting && !played) { played = true; io.disconnect(); replay(); } }, { threshold: 0.5 }).observe(canvas);
  window.__listTable = { ...(window.__listTable ?? {}), stagger: { canvas, ol, replay } };
}
