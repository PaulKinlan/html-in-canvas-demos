import { mount, put, colors, smooth, lerp, tween } from './kit.js';

export default function start() {
  const canvas = document.getElementById('findCanvas');
  const view = document.getElementById('findView');
  const world = document.getElementById('findWorld');
  const form = document.getElementById('findForm');
  const out = document.getElementById('findOut');
  const places = [...world.children];
  const cam = { x: 0, y: 0 };
  let zoom = 1, cancel = null, lastHit = null;

  // #region find
  // The view is a 300 by 220 box with overflow: hidden over a world of twelve boxes that size.
  // Find-in-page scrolls it to show a match. That scroll is taken back and replayed as a flight.
  view.addEventListener('scroll', () => {
    const tx = view.scrollLeft, ty = view.scrollTop;
    if (Math.abs(tx - cam.x) < 1 && Math.abs(ty - cam.y) < 1) return;   // our own scrollTo
    const from = { ...cam };
    view.scrollTo(from.x, from.y);
    cancel?.();
    cancel = tween(1100, (p) => {
      const e = smooth(p);
      cam.x = lerp(from.x, tx, e); cam.y = lerp(from.y, ty, e);
      zoom = 1 - 0.45 * Math.sin(Math.PI * p);
      view.scrollTo(cam.x, cam.y);
      stage.request();
    });
  });

  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    const W = view.offsetWidth, H = view.offsetHeight;
    const x0 = Math.round((w - W) / 2), y0 = 12;
    ctx.save();
    ctx.translate(x0 + W / 2, y0 + H / 2); ctx.scale(zoom, zoom);
    put(ctx, view, -W / 2, -H / 2);
    ctx.restore();
    // A map of the world under the view, with the camera's place on it.
    const cols = Math.round(world.offsetWidth / W), rowsN = Math.round(world.offsetHeight / H);
    const s = 16, mx = Math.round((w - cols * s) / 2), my = y0 + H + 12;
    ctx.strokeStyle = c.line; ctx.fillStyle = c.card;
    for (let r = 0; r < rowsN; r++) for (let q = 0; q < cols; q++) { ctx.fillRect(mx + q * s, my + r * s * 0.7, s - 2, s * 0.7 - 2); ctx.strokeRect(mx + q * s, my + r * s * 0.7, s - 2, s * 0.7 - 2); }
    ctx.fillStyle = c.accent;
    ctx.fillRect(mx + cam.x / W * s, my + cam.y / H * s * 0.7, s - 2, s * 0.7 - 2);
    return false;
  });
  // #endregion find

  // hidden=until-found parts are opened by the browser when find-in-page reaches them.
  world.addEventListener('beforematch', (e) => { out.textContent = `The browser opened a hidden part in "${e.target.closest('section').querySelector('h3').textContent}" (beforematch).`; });

  // A script cannot open find-in-page, so this box does the same job: find the text, select it, scroll it into the view.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const word = form.elements.word.value.trim().toLowerCase();
    if (!word) return;
    const walker = document.createTreeWalker(world, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let node; (node = walker.nextNode());) {
      for (let i = node.data.toLowerCase().indexOf(word); i >= 0; i = node.data.toLowerCase().indexOf(word, i + 1)) hits.push({ node, i });
    }
    if (!hits.length) { out.textContent = `"${word}" is not in the canvas.`; return; }
    const n = lastHit?.word === word ? (lastHit.n + 1) % hits.length : 0;
    lastHit = { word, n };
    const { node, i } = hits[n];
    const hiddenPart = node.parentElement.closest('[hidden]');
    if (hiddenPart) hiddenPart.hidden = false;
    const range = document.createRange();
    range.setStart(node, i); range.setEnd(node, i + word.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const place = node.parentElement.closest('section');
    out.textContent = `Match ${n + 1} of ${hits.length}, in "${place.querySelector('h3').textContent}".`;
    view.scrollTo(place.offsetLeft, place.offsetTop);
  });
  out.textContent = `${places.length} places. The view shows one.`;
}
