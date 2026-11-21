import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('expCanvas');
  const figure = document.getElementById('expFigure');
  const chart = document.getElementById('expChart');
  const out = document.getElementById('expOut');
  const shot = document.getElementById('expShot');
  const boxes = [...figure.querySelectorAll('input[type=checkbox]')];
  const series = boxes.map((b) => ({ box: b, value: Number(b.value), colour: b.dataset.colour, share: b.closest('label').querySelector('b'), now: Number(b.value) }));
  let paints = 0, inner = 0, last = 0, flash = 0, result = 'Nothing exported yet.';

  // #region export-chart
  // The chart is drawn by script into a plain <canvas> inside the figure. It is not a drawable canvas:
  // it is content, like an image. Its buffer is sized for the screen's pixel ratio once.
  const g = chart.getContext('2d');
  const dpr = Math.min(3, devicePixelRatio || 1);
  chart.width = Math.round(chart.clientWidth * dpr); chart.height = Math.round(chart.clientHeight * dpr);
  function drawChart() {
    inner++;
    const size = chart.clientWidth, r = size / 2 - 6;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const total = series.reduce((a, s) => a + s.now, 0);
    let from = -Math.PI / 2;
    for (const s of series) {
      const sweep = total > 0.01 ? s.now / total * Math.PI * 2 : 0;
      g.beginPath(); g.moveTo(size / 2, size / 2); g.arc(size / 2, size / 2, r, from, from + sweep); g.closePath();
      g.fillStyle = s.colour; g.fill();
      from += sweep;
    }
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(size / 2, size / 2, r * 0.55, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over';
    const shown = series.filter((s) => s.box.checked).reduce((a, s) => a + s.value, 0);
    g.fillStyle = getComputedStyle(figure).color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 22px system-ui, sans-serif'; g.fillText(String(shown), size / 2, size / 2 - 4);
    g.font = '11px system-ui, sans-serif'; g.fillText('visits', size / 2, size / 2 + 14);
  }
  // #endregion export-chart

  // #region export
  // The outer canvas draws the whole <figure> with one call: the inner canvas, the legend with its
  // checkboxes and the caption are one picture. Then it adds a line of its own text. toBlob() on the
  // outer canvas gives all of it as one PNG.
  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    // A checkbox in the legend is the state. The handler eases each slice towards it and redraws the chart.
    let moving = false;
    const total = series.filter((s) => s.box.checked).reduce((a, s) => a + s.value, 0);
    for (const s of series) {
      const want = s.box.checked ? s.value : 0;
      if (Math.abs(want - s.now) > 0.05) { s.now += (want - s.now) * (1 - Math.exp(-dt * 9)); moving = true; } else s.now = want;
      const share = s.box.checked && total ? `${Math.round(s.value / total * 100)}%` : '';
      if (s.share.textContent !== share) s.share.textContent = share;
    }
    if (moving || !inner) drawChart();

    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
    const k = Math.min(1, (w - 16) / figure.offsetWidth);
    const fx = (w - figure.offsetWidth * k) / 2, fy = 10;
    ctx.save(); ctx.translate(fx, fy); ctx.scale(k, k);
    ctx.shadowColor = '#0003'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    put(ctx, figure, 0, 0);
    ctx.restore();
    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Added by the outer canvas: ${new Date().toISOString().slice(0, 10)}`, w / 2, fy + figure.offsetHeight * k + 26);
    if (flash > 0) { ctx.fillStyle = `rgb(255 255 255 / ${flash})`; ctx.fillRect(0, 0, w, h); flash = Math.max(0, flash - dt * 2.5); }
    out.textContent = `Outer canvas ${canvas.width} by ${canvas.height} px. Inner chart redrawn ${inner} times. Paint events: ${paints}. ${result}`;
    return moving || flash > 0;
  });

  // One call, on a tap. The canvas is not tainted, because everything in it is same-origin.
  const toPng = () => new Promise((resolve, reject) => {
    try { canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob() gave no picture'))), 'image/png'); } catch (e) { reject(e); }
  });
  // #endregion export

  // #region export-buttons
  let url = null;
  async function take(how) {
    const t0 = performance.now();
    let blob;
    try { blob = await toPng(); } catch (e) { result = `Export failed: ${e.message}`; stage.request(); return null; }
    const ms = performance.now() - t0;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    shot.src = url; shot.hidden = false;
    shot.alt = 'The exported picture: the chart, its legend and its caption';
    result = `Last export: PNG, ${(blob.size / 1024).toFixed(0)} kB, toBlob() took ${ms.toFixed(0)} ms, ${how}.`;
    flash = 0.8; stage.request();
    return blob;
  }
  document.getElementById('expSave').addEventListener('click', async () => {
    const blob = await take('saved as a file');
    if (!blob) return;
    const a = Object.assign(document.createElement('a'), { href: url, download: 'chart-and-legend.png' });
    a.click();
  });
  document.getElementById('expCopy').addEventListener('click', async () => {
    // The promise is given to ClipboardItem at once, so the write still belongs to the tap.
    try {
      const pending = toPng();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
      await take('copied to the clipboard');
    } catch (e) { result = `Copy failed: ${e.message}`; stage.request(); }
  });
  const share = document.getElementById('expShare');
  share.addEventListener('click', async () => {
    const blob = await take('passed to navigator.share()');
    if (!blob) return;
    const file = new File([blob], 'chart-and-legend.png', { type: 'image/png' });
    try {
      if (!navigator.canShare?.({ files: [file] })) throw new Error('this browser cannot share a file');
      await navigator.share({ files: [file], title: 'Chart and legend' });
    } catch (e) { result += ` Share: ${e.message}`; stage.request(); }
  });
  // #endregion export-buttons

  return { stage };
}
