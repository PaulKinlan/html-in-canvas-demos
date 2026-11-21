// Latency measurements for /perf/.
//
//   measureLatency(stage)  time from a DOM change to the frame that shows it,
//                          for plain DOM, a 2D canvas and a worker canvas
//   measureFrames(stage)   where the time of a long frame goes, from Long
//                          Animation Frames entries
//
// Both build their fixtures inside `stage` and empty it when they finish.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(r));
const median = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const W = 300, H = 120;

// Element Timing entries, by the elementtiming identifier.
const seen = new Map();
let observing = false;
function observe() {
  if (observing) return true;
  if (!PerformanceObserver.supportedEntryTypes?.includes('element')) return false;
  new PerformanceObserver((list) => { for (const e of list.getEntries()) seen.set(e.identifier, e); }).observe({ type: 'element' });
  observing = true;
  return true;
}
async function entry(id, ms = 1500) {
  for (let t = 0; t < ms; t += 16) { if (seen.has(id)) return seen.get(id); await sleep(16); }
  return null;
}
let serial = 0;
// #region change
// The DOM change being timed: a new line of text with an elementtiming
// attribute. Element Timing reports each element once, so every sample is a
// new element. The change is made from a timer, as an event handler would.
function change(box) {
  const id = `lat-${++serial}`;
  const p = document.createElement('p');
  p.setAttribute('elementtiming', id);
  p.textContent = `Sample ${serial}: the quick brown fox`;
  p.style.cssText = 'margin:0;font:20px/1.4 system-ui,sans-serif;color:#000';
  box.replaceChildren(p);
  return { id, t0: performance.now() };
}
// #endregion change

function canvasIn(stage) {
  stage.innerHTML = `<canvas content="drawable" layoutsubtree width="${W}" height="${H}" style="width:${W}px;height:${H}px;display:block;background:#fff"><div drawable style="width:${W}px;height:${H}px;background:#fff"></div></canvas>`;
  const canvas = stage.firstElementChild;
  return { canvas, box: canvas.firstElementChild };
}

/**
 * @returns {Promise<Array<{ id, label, samples, ms, detail }>>} one row per route.
 * `ms` is the median time from the change to the frame that shows it.
 */
export async function measureLatency(stage, { samples = 8, onRow } = {}) {
  const rows = [];
  const push = (row) => { rows.push(row); onRow?.(row); };
  if (!observe()) {
    push({ id: 'none', label: 'Element Timing', ms: null, detail: 'This browser has no Element Timing entries, so nothing can be timed.' });
    return rows;
  }
  const shown = (e) => (e ? (e.presentationTime ?? e.renderTime) : NaN);

  // 1. Plain DOM.
  {
    stage.innerHTML = `<div style="width:${W}px;height:${H}px;background:#fff"></div>`;
    const box = stage.firstElementChild;
    await sleep(200);
    const out = [];
    for (let i = 0; i < samples; i++) {
      await sleep(40 + Math.random() * 30);
      const { id, t0 } = change(box);
      out.push(shown(await entry(id)) - t0);
    }
    push({ id: 'dom', label: 'Plain DOM', samples: out, ms: median(out), detail: 'Change the DOM, read presentationTime from the element\'s Element Timing entry.' });
  }

  // #region latency-2d
  // 2. A 2D canvas on the main thread. The paint event that draws the change
  // runs in the same frame that paints the element, so the frame's presentation
  // time is the element's presentationTime as long as the handler ran before it.
  {
    const { canvas, box } = canvasIn(stage);
    const ctx = canvas.getContext('2d');
    let paintAt = 0;
    canvas.addEventListener('paint', () => { paintAt = performance.now(); ctx.reset(); ctx.drawElementImage(box, 0, 0, W, H); });
    canvas.requestPaint();
    await sleep(200);
    const out = [], handler = [];
    let late = 0;
    for (let i = 0; i < samples; i++) {
      await sleep(40 + Math.random() * 30);
      paintAt = 0;
      const { id, t0 } = change(box);
      const e = await entry(id);
      const at = shown(e);
      handler.push(paintAt - t0);
      if (!paintAt || paintAt > at) late++;
      out.push(at - t0);
    }
    push({ id: '2d', label: '2D canvas, main thread', samples: out, ms: median(out), detail: `The paint event ran ${median(handler)?.toFixed(1)} ms after the change (median). In ${samples - late} of ${samples} samples it ran before the frame was presented, so the canvas showed the change in the same frame as plain DOM would.` });
  }
  // #endregion latency-2d

  // #region latency-never
  // 3. Does Element Timing say when the canvas showed the element, or only when
  // the browser painted the element's picture? Use a canvas whose paint handler
  // draws nothing. An entry that still arrives is about the picture.
  {
    const { canvas, box } = canvasIn(stage);
    const ctx = canvas.getContext('2d');
    canvas.addEventListener('paint', () => { ctx.reset(); });
    canvas.requestPaint();
    await sleep(200);
    const { id, t0 } = change(box);
    const e = await entry(id, 1000);
    push({
      id: 'never', label: 'A canvas that never draws the element', ms: e ? shown(e) - t0 : null,
      detail: e
        ? 'An Element Timing entry arrives although no pixel of the element reached the screen. presentationTime is the frame in which the element\'s picture was painted. It is not proof that a canvas drew it.'
        : 'No Element Timing entry arrives for an element the canvas does not draw, so in this browser an entry means the canvas showed it.',
    });
  }
  // #endregion latency-never

  // #region latency-worker
  // 4. A worker canvas. The main thread takes an ElementImage snapshot in its
  // paint event and transfers it. The worker draws it on its next frame and
  // reports the time on the shared epoch clock.
  {
    const { canvas, box } = canvasIn(stage);
    let ok = true, err = '';
    const worker = new Worker('/perf/latency-worker.js');
    const drawn = new Map();
    worker.onmessage = ({ data }) => { if (data.type === 'drawn') drawn.set(data.id, data.at - performance.timeOrigin); };
    try {
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: off }, [off]);
    } catch (e) { ok = false; err = e.message; }
    let current = null, captureAt = 0;
    canvas.addEventListener('paint', () => {
      if (!current) return;
      try {
        const image = canvas.captureElementImage(box);
        captureAt = performance.now();
        worker.postMessage({ type: 'image', image, id: current, width: W, height: H }, [image]);
      } catch (e) { ok = false; err = e.message; }
      current = null;
    });
    await sleep(200);
    const out = [], capture = [];
    for (let i = 0; ok && i < samples; i++) {
      await sleep(40 + Math.random() * 30);
      const { id, t0 } = change(box);
      current = id; captureAt = 0;
      canvas.requestPaint();
      for (let t = 0; t < 1500 && !drawn.has(id); t += 8) await sleep(8);
      out.push(drawn.has(id) ? drawn.get(id) - t0 : NaN);
      capture.push(captureAt - t0);
    }
    worker.terminate();
    push(ok
      ? { id: 'worker', label: 'Worker canvas, ElementImage snapshot', samples: out, ms: median(out), detail: `Time until the worker's drawElementImage() call returned. The snapshot was taken ${median(capture)?.toFixed(1)} ms after the change (median). The worker's frame is presented after this, so add up to one frame.` }
      : { id: 'worker', label: 'Worker canvas, ElementImage snapshot', ms: null, detail: `Could not run: ${err}` });
  }
  stage.replaceChildren();
  return rows;
}

// #region frames
// Long Animation Frames entries exist only for frames over 50 ms, so the scene
// grows until frames are that long. Each frame rewrites the text of every cell.
//   script        renderStart to styleAndLayoutStart: rAF callbacks and observers
//   style, layout and paint   styleAndLayoutStart to the end of the frame
//   after the main thread     end of the frame to presentationTime: raster and the compositor
async function longFrames(stage, kind, n) {
  const cells = Array.from({ length: n }, (_, i) => `<span style="display:inline-block;width:30px;height:12px;font:9px sans-serif;color:#000">${i}</span>`).join('');
  const box = `<div ${kind === 'dom' ? '' : 'drawable'} style="width:100%;height:100%;overflow:hidden;background:#fff">${cells}</div>`;
  stage.innerHTML = kind === 'dom' ? box : `<canvas content="drawable" layoutsubtree style="display:block;width:100%;height:100%">${box}</canvas>`;
  const canvas = stage.querySelector('canvas'), el = stage.querySelector('div');
  let handlerMs = 0;
  if (canvas) {
    canvas.width = stage.clientWidth; canvas.height = stage.clientHeight;
    const ctx = canvas.getContext('2d');
    canvas.addEventListener('paint', () => { const t = performance.now(); ctx.reset(); ctx.drawElementImage(el, 0, 0, el.offsetWidth, el.offsetHeight); handlerMs += performance.now() - t; });
  }
  const entries = [];
  const po = new PerformanceObserver((list) => entries.push(...list.getEntries()));
  po.observe({ type: 'long-animation-frame' });
  await sleep(300);
  entries.length = 0; handlerMs = 0;
  const spans = [...el.children];
  const frames = 12;
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) { for (const s of spans) s.textContent = (Math.random() * 1000) | 0; canvas?.requestPaint(); await raf(); }
  const perFrame = (performance.now() - t0) / frames;
  await sleep(300);
  po.disconnect();
  stage.replaceChildren();
  const avg = (f) => (entries.length ? entries.reduce((a, e) => a + f(e), 0) / entries.length : null);
  return {
    kind, n, perFrame, long: entries.length, handlerMs: handlerMs / frames,
    total: avg((e) => e.duration),
    script: avg((e) => e.styleAndLayoutStart - e.renderStart),
    render: avg((e) => e.startTime + e.duration - e.styleAndLayoutStart),
    after: avg((e) => (e.presentationTime ?? e.startTime + e.duration) - (e.startTime + e.duration)),
    split: entries[0] && 'styleDuration' in entries[0] ? { style: avg((e) => e.styleDuration), layout: avg((e) => e.layoutDuration) } : null,
  };
}

/** @returns {Promise<{ n: number, rows: object[] } | { error: string }>} */
export async function measureFrames(stage, { onStatus } = {}) {
  if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return { error: 'This browser has no Long Animation Frames entries.' };
  // Find a cell count that makes plain DOM frames long, then run both scenes with it.
  let n = 2000, dom = null;
  for (; n <= 32000; n *= 2) {
    onStatus?.(`Plain DOM, ${n} cells`);
    dom = await longFrames(stage, 'dom', n);
    if (dom.long >= 6) break;
  }
  n = Math.min(n, 32000);
  onStatus?.(`2D canvas, ${n} cells`);
  const canvas = await longFrames(stage, '2d', n);
  return { n, rows: [dom, canvas] };
}
// #endregion frames
