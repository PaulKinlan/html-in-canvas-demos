// Shared by prerendered.html (sent with "Supports-Loading-Mode: prerender-cross-origin-frames")
// and prerendered-plain.html (sent without). Records what had happened by the time the page was shown.
import { otherOrigin } from '/lib/live-origins.js';

const startedPrerendering = document.prerendering === true;
const t0 = performance.now();
const events = [];
const note = (what) => events.push({ what, at: Math.round(performance.now() - t0), prerendering: document.prerendering === true });
note('script started');
document.addEventListener('prerenderingchange', () => { note('activated (shown to the person)'); setTimeout(report, 1200); });

const remote = otherOrigin();
const canvas = document.getElementById('board');
const W = 300, H = 110;
canvas.width = W * 2 + 10; canvas.height = H;
canvas.style.cssText = `width:${W * 2 + 10}px;max-width:100%;height:auto`;
const tile = (id, src, extra = '') => `<iframe drawable id="${id}" title="${id}" src="${src}" ${extra} style="width:${W}px;height:${H}px;border:0;position:absolute;left:0;top:0"></iframe>`;
// #region tiles
canvas.innerHTML =
  tile('same', '/iframe-tiles/tile.html?id=same&title=Same%20origin&lines=1') +
  (remote ? tile('cross', remote + '/iframe-tiles/tile.html?id=cross&title=Other%20origin&lines=1&bg=%239fd3ff') : tile('cross', '/iframe-tiles/tile.html?id=cross&title=Sandboxed&lines=1&bg=%239fd3ff', 'sandbox="allow-scripts"'));
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let paints = 0, firstPicture = null;
canvas.addEventListener('paint', () => {
  paints++;
  if (paints === 1) note('first paint event');
  ctx.reset();
  ctx.drawElementImage(document.getElementById('same'), 0, 0, W, H);
  ctx.drawElementImage(document.getElementById('cross'), W + 10, 0, W, H);
  const px = ctx.getImageData(W - 6, 6, 1, 1).data;
  if (!firstPicture && px[3] > 250 && px[0] > 200) { firstPicture = true; note('the same-origin tile has a picture in the canvas'); }
});
// #endregion tiles
const loaded = {};
addEventListener('message', (e) => {
  if (e.data?.type !== 'tile' || loaded[e.data.id]) return;
  loaded[e.data.id] = e.data;
  note(`tile "${e.data.id}" ran its script (the tile itself says prerendering was ${e.data.wasPrerendering})`);
  canvas.requestPaint();
});

function report() {
  const out = document.getElementById('out');
  const activated = events.find((e) => e.what.startsWith('activated'));
  const before = (needle) => { const e = events.find((x) => x.what.includes(needle)); return !e ? 'never' : !activated ? `at ${e.at} ms (the page was not prerendered)` : e.at <= activated.at ? `before the page was shown (${activated.at - e.at} ms earlier)` : `${e.at - activated.at} ms after the page was shown`; };
  const rows = [
    ['This page was prerendered', startedPrerendering ? 'yes' : 'no: open it from the button on the main page'],
    ['Same-origin tile ran its script', before('tile "same"')],
    [`${remote ? 'Cross-origin' : 'Sandboxed'} tile ran its script`, before('tile "cross"')],
    ['First paint event of the canvas', before('first paint')],
    ['Same-origin tile had a picture in the canvas', before('has a picture')],
  ];
  out.innerHTML = '';
  for (const [k, v] of rows) { const tr = out.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
  document.getElementById('log').textContent = events.map((e) => `${String(e.at).padStart(6)} ms  ${e.prerendering ? '[prerendering] ' : ''}${e.what}`).join('\n');
  window.__prerenderReport = { startedPrerendering, rows, events };
}
if (!startedPrerendering) setTimeout(report, 2500);
