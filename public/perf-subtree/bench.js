// Benchmark engine and DOM/CSS workload builders for /perf-subtree/.
//
// Each workload renders 16 sibling cards inside a grid. In 2D and WebGL routes,
// each card carries the `drawable` attribute inside a single drawable canvas so
// `paint` events report `e.changedElements` per sibling when 1 of 16 mutates.

import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { supported as canvasSupported, testStage } from '/shared/support.js';

export const CARD_COUNT = 16;

export const BACKENDS = [
  { id: 'dom', label: 'Plain DOM' },
  { id: '2d', label: '2D drawElementImage()' },
  { id: 'webgl', label: 'WebGL texElementSubImage2D()' },
];

export const CONTAIN_MODES = [
  { id: 'none', label: 'contain: none', css: 'none' },
  { id: 'layout-paint', label: 'contain: layout paint', css: 'layout paint' },
  { id: 'strict', label: 'contain: strict', css: 'strict' },
];

export const MUTATION_MODES = [
  { id: 'layout', label: 'Layout (text + padding)' },
  { id: 'paint', label: 'Paint (colour only)' },
  { id: 'transform', label: 'Transform (translateX)' },
];

export const WORKLOADS = [
  {
    id: 'flat',
    name: '1. Flat baseline cards',
    short: 'Flat baseline',
    detail: '16 cards with a border, title, counter and chip. Baseline for the other workloads.',
    defaultMutation: 'layout',
  },
  {
    id: 'deep',
    name: '2. Deep nested DOM (24 levels)',
    short: 'Deep DOM (24x)',
    detail: 'Each card wraps its changing label inside 24 nested div elements.',
    defaultMutation: 'layout',
  },
  {
    id: 'typography',
    name: '3. Rich text and typography',
    short: 'Rich typography',
    detail: 'Mixed font weights, OpenType ligatures (ffi, fl), CJK text and emoji in every card.',
    defaultMutation: 'layout',
  },
  {
    id: 'shadow',
    name: '4. CSS box-shadow stack',
    short: 'box-shadow stack',
    detail: 'Five blurred box-shadow layers (outer blur, spread and inset) on each card.',
    defaultMutation: 'layout',
  },
  {
    id: 'filter',
    name: '5. CSS filter: blur() and drop-shadow()',
    short: 'CSS filter',
    detail: 'Child badges with filter: blur(1px) drop-shadow(0 3px 6px) inside every card.',
    defaultMutation: 'layout',
  },
  {
    id: 'backdrop',
    name: '6. CSS backdrop-filter: blur(8px)',
    short: 'backdrop-filter',
    detail: 'A translucent frosted chip with backdrop-filter: blur(8px) over a striped card background.',
    defaultMutation: 'layout',
  },
  {
    id: 'svg-filter',
    name: '7. Inline SVG feTurbulence + feGaussianBlur',
    short: 'SVG filter',
    detail: 'Each card embeds an inline SVG using feTurbulence and feGaussianBlur filters.',
    defaultMutation: 'layout',
  },
  {
    id: 'mutation',
    name: '8. Mutation type comparison',
    short: 'Mutation types',
    detail: 'Compares transform-only, paint-only and layout mutations on the same 16-card grid.',
    defaultMutation: 'transform',
    compareMutations: true,
  },
  {
    id: 'contain',
    name: '9. Containment comparison (none / layout paint / strict)',
    short: 'Containment sweep',
    detail: 'Heavy shadow and nested-text cards timed with contain: none, layout paint and strict.',
    defaultMutation: 'layout',
    compareContain: true,
  },
];

export const capability = {
  dom: true,
  '2d': canvasSupported,
  webgl: canvasSupported && glSupported,
};

const PASSTHROUGH_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(r));

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((s.length - 1) * p));
  return s[idx];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

let svgSeq = 0;

// #region workloads
// Builds 16 sibling cards for the chosen workload. Each card gets `drawable`
// when mounted inside a canvas so `paint` reports changed siblings individually.
export function buildGrid(workloadId, { contain = 'none', drawable = false, flowLayout = false } = {}) {
  const grid = document.createElement('div');
  grid.className = `st-grid st-w-${workloadId}${flowLayout ? ' st-flow' : ''}`;
  grid.dataset.contain = contain;

  const cards = [];
  const targets = [];

  for (let i = 0; i < CARD_COUNT; i++) {
    const card = document.createElement('div');
    card.className = 'st-card';
    if (drawable) card.setAttribute('drawable', '');

    const head = document.createElement('div');
    head.className = 'st-head';

    const title = document.createElement('span');
    title.className = 'st-title';
    title.textContent = `C${String(i + 1).padStart(2, '0')}`;

    const chip = document.createElement('span');
    chip.className = 'st-chip';
    chip.textContent = workloadId === 'backdrop' ? 'blur' : 'tag';

    head.append(title, chip);
    card.append(head);

    const val = document.createElement('div');
    val.className = 'st-val';
    val.textContent = `#0`;

    if (workloadId === 'deep') {
      let host = card;
      for (let depth = 0; depth < 24; depth++) {
        const wrap = document.createElement('div');
        wrap.className = 'st-nest';
        host.append(wrap);
        host = wrap;
      }
      host.append(val);
    } else if (workloadId === 'typography') {
      const sample = document.createElement('div');
      sample.className = 'st-typo';
      sample.innerHTML = '<strong>ffi</strong> <em>漢字</em> <span>🔬⚡</span> ';
      sample.append(val);
      card.append(sample);
    } else if (workloadId === 'svg-filter') {
      const uid = `stf-${++svgSeq}`;
      const row = document.createElement('div');
      row.className = 'st-svg-row';
      row.innerHTML =
        `<svg class="st-svg" viewBox="0 0 60 28" width="52" height="24" aria-hidden="true">` +
        `<defs><filter id="${uid}" x="-20%" y="-20%" width="140%" height="140%">` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" result="n"/>` +
        `<feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="b"/>` +
        `<feComposite in="b" in2="n" operator="atop"/>` +
        `</filter></defs>` +
        `<rect x="4" y="4" width="52" height="20" rx="5" fill="#d2491f" filter="url(#${uid})"/>` +
        `</svg>`;
      row.append(val);
      card.append(row);
    } else if (workloadId === 'contain') {
      let host = card;
      for (let depth = 0; depth < 12; depth++) {
        const wrap = document.createElement('div');
        wrap.className = 'st-nest';
        host.append(wrap);
        host = wrap;
      }
      host.append(val);
    } else {
      card.append(val);
    }

    grid.append(card);
    cards.push(card);
    targets.push({ card, val, chip });
  }

  return { grid, cards, targets };
}

// Mutates only 1 of the 16 sibling cards per frame so over-invalidation shows up
// in `e.changedElements.length > 1`.
export function mutateOne(targets, idx, tick, mutationMode = 'layout') {
  const t = targets[idx % targets.length];
  if (!t) return;
  if (mutationMode === 'transform') {
    const dx = ((tick % 5) - 2) * 3;
    t.chip.style.transform = `translateX(${dx}px)`;
    return;
  }
  if (mutationMode === 'paint') {
    const alt = tick % 2 === 0;
    t.chip.style.backgroundColor = alt ? '#d2491f' : '#1f7a3a';
    t.chip.style.color = '#ffffff';
    return;
  }
  // Default: layout mutation (text length + inline padding change).
  const wide = tick % 2 === 1;
  t.val.textContent = wide ? `#${tick} recalc` : `#${tick}`;
  t.val.style.paddingLeft = wide ? '8px' : '0px';
}
// #endregion workloads

function observeBackingSize(canvas, onResize) {
  let lastW = 0;
  let lastH = 0;
  const apply = (w, h) => {
    const bw = Math.max(1, Math.round(w));
    const bh = Math.max(1, Math.round(h));
    if (bw !== lastW || bh !== lastH) {
      lastW = bw;
      lastH = bh;
      onResize(bw, bh);
    }
  };
  if (typeof ResizeObserver === 'undefined') return { disconnect() {} };
  const ro = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const dp = entry.devicePixelContentBoxSize?.[0];
    if (dp) {
      apply(dp.inlineSize, dp.blockSize);
    } else {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const box = entry.contentBoxSize?.[0];
      const cw = box ? box.inlineSize : entry.contentRect.width;
      const ch = box ? box.blockSize : entry.contentRect.height;
      apply(cw * dpr, ch * dpr);
    }
  });
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(canvas);
  }
  return ro;
}

export function mountStage(host, {
  workloadId = 'flat',
  backend = '2d',
  contain = 'none',
  flowLayout = false,
  onLost = () => {},
  onRestored = () => {},
} = {}) {
  host.replaceChildren();

  const stats = {
    paints: 0,
    handlerMsTotal: 0,
    changedSamples: 0,
    changedSum: 0,
    changedMax: 0,
    overInvalidations: 0,
    uploads: 0,
    lastChanged: null,
  };

  const resetStats = () => {
    stats.paints = 0;
    stats.handlerMsTotal = 0;
    stats.changedSamples = 0;
    stats.changedSum = 0;
    stats.changedMax = 0;
    stats.overInvalidations = 0;
    stats.uploads = 0;
    stats.lastChanged = null;
  };

  if (backend === 'dom') {
    const wrap = document.createElement('div');
    wrap.className = 'st-dom-wrap';
    const { grid, cards, targets } = buildGrid(workloadId, { contain, drawable: false, flowLayout });
    wrap.append(grid);
    host.append(wrap);
    return {
      backend,
      canvas: null,
      grid,
      cards,
      targets,
      stats,
      resetStats,
      requestPaint() {},
      destroy() {
        host.replaceChildren();
      },
    };
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'st-canvas';
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');

  const { grid, cards, targets } = buildGrid(workloadId, { contain, drawable: true, flowLayout });
  canvas.append(grid);
  host.append(canvas);

  const recordChanged = (e) => {
    if (e.changedElements) {
      const n = e.changedElements.length;
      stats.changedSamples++;
      stats.changedSum += n;
      if (n > stats.changedMax) stats.changedMax = n;
      if (n > 1) stats.overInvalidations++;
      stats.lastChanged = n;
    }
  };

  let destroyed = false;

  if (backend === '2d') {
    // #region paint-2d
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    let backingW = 0;
    let backingH = 0;
    let lost = false;

    const onContextLost = (e) => {
      e.preventDefault();
      lost = true;
      onLost('2D canvas context was lost.');
    };
    const onContextRestored = () => {
      lost = false;
      onRestored();
      canvas.requestPaint?.();
    };
    canvas.addEventListener('contextlost', onContextLost);
    canvas.addEventListener('contextrestored', onContextRestored);

    const ro = observeBackingSize(canvas, (bw, bh) => {
      backingW = bw;
      backingH = bh;
      if (!destroyed && !lost) canvas.requestPaint?.();
    });

    const onPaint = (e) => {
      if (destroyed || lost) return;
      const t0 = performance.now();
      stats.paints++;
      recordChanged(e);

      const cw = canvas.clientWidth || host.clientWidth || 360;
      const ch = canvas.clientHeight || host.clientHeight || 340;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const bw = backingW || Math.max(1, Math.round(cw * dpr));
      const bh = backingH || Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const scaleX = bw / cw;
      const scaleY = bh / ch;
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      for (const card of cards) {
        const x = card.offsetLeft;
        const y = card.offsetTop;
        const w = card.offsetWidth;
        const h = card.offsetHeight;
        if (w > 0 && h > 0) {
          ctx.drawElementImage(card, x, y, w, h);
        }
      }
      stats.handlerMsTotal += performance.now() - t0;
    };

    canvas.addEventListener('paint', onPaint);
    canvas.requestPaint?.();
    // #endregion paint-2d

    return {
      backend,
      canvas,
      grid,
      cards,
      targets,
      stats,
      resetStats,
      requestPaint() { if (!destroyed && !lost) canvas.requestPaint?.(); },
      destroy() {
        destroyed = true;
        ro.disconnect();
        canvas.removeEventListener('paint', onPaint);
        canvas.removeEventListener('contextlost', onContextLost);
        canvas.removeEventListener('contextrestored', onContextRestored);
        canvas.remove();
        window.__gfx?.retire?.(canvas);
        host.replaceChildren();
      },
    };
  }

  if (backend === 'webgl') {
    if (!glSupported) throw new Error('WebGL texElementSubImage2D() is not available here');
    // #region paint-webgl
    const gl = new ElementGL(canvas, {
      fragment: PASSTHROUGH_FRAG,
      onLost: () => onLost('WebGL context was lost.'),
      onRestored: () => onRestored(),
    });
    const placed = new WeakMap();
    const ro = observeBackingSize(canvas, () => {
      if (!destroyed && !gl.lost) canvas.requestPaint?.();
    });

    const onPaint = (e) => {
      if (destroyed || gl.lost) return;
      const t0 = performance.now();
      stats.paints++;
      recordChanged(e);

      const changed = e.changedElements ? new Set(e.changedElements) : null;
      for (const card of cards) {
        if (!gl.has(card) || !changed || changed.has(card)) {
          gl.upload(card);
          stats.uploads++;
        }
      }
      if (!gl.begin()) return;
      for (const card of cards) {
        const x = card.offsetLeft;
        const y = card.offsetTop;
        const w = card.offsetWidth;
        const h = card.offsetHeight;
        if (w <= 0 || h <= 0) continue;
        gl.quad(card, ElementGL.rect(canvas, x, y, w, h));
        const key = `${x},${y},${w},${h}`;
        if (placed.get(card) !== key) {
          placed.set(card, key);
          canvas.updateElementGeometry?.(card, {
            canvasTransform: new DOMMatrix().translate(x, y),
          });
          card.dataset.hit = key;
        }
      }
      stats.handlerMsTotal += performance.now() - t0;
    };

    canvas.addEventListener('paint', onPaint);
    canvas.requestPaint?.();
    // #endregion paint-webgl

    return {
      backend,
      canvas,
      grid,
      cards,
      targets,
      stats,
      resetStats,
      requestPaint() { if (!destroyed && !gl.lost) canvas.requestPaint?.(); },
      destroy() {
        destroyed = true;
        ro.disconnect();
        canvas.removeEventListener('paint', onPaint);
        gl.dispose();
        canvas.remove();
        window.__gfx?.retire?.(canvas);
        host.replaceChildren();
      },
    };
  }

  throw new Error(`Unknown backend: ${backend}`);
}

// #region measure
// Measures rAF frame times, Long Animation Frames breakdown, paint rate and
// e.changedElements over-invalidation while mutating 1 of 16 siblings per frame.
export async function measureRun(host, {
  workloadId = 'flat',
  backend = '2d',
  contain = 'none',
  mutationMode = 'layout',
  dwellMs = 600,
  warmupFrames = 4,
  minFrames = 14,
  maxMs = 2400,
  flowLayout = false,
  signal = null,
} = {}) {
  const handle = mountStage(host, { workloadId, backend, contain, flowLayout });

  // Let initial layout and first paint settle before counting steady-state stats.
  await raf();
  await raf();

  const loafSupported = typeof PerformanceObserver !== 'undefined' &&
    Boolean(PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame'));
  const loafEntries = [];
  let po = null;
  if (loafSupported) {
    po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) loafEntries.push(entry);
    });
    po.observe({ type: 'long-animation-frame', buffered: false });
  }

  let tick = 0;
  for (let w = 0; w < warmupFrames; w++) {
    if (signal?.aborted) break;
    mutateOne(handle.targets, tick % CARD_COUNT, tick, mutationMode);
    tick++;
    await raf();
  }

  handle.resetStats();
  loafEntries.length = 0;

  const dts = [];
  let mutations = 0;
  let mutateMsTotal = 0;
  const tStart = performance.now();
  let lastTs = await raf();

  while (!signal?.aborted) {
    const now = performance.now();
    const elapsed = now - tStart;
    if ((elapsed >= dwellMs && dts.length >= minFrames) || elapsed >= maxMs) break;

    const m0 = performance.now();
    mutateOne(handle.targets, tick % CARD_COUNT, tick, mutationMode);
    mutateMsTotal += performance.now() - m0;
    tick++;
    mutations++;

    const ts = await raf();
    dts.push(ts - lastTs);
    lastTs = ts;
  }

  const tEnd = performance.now();
  if (po) {
    await sleep(100);
    po.disconnect();
  }

  const windowLoafs = loafEntries.filter((e) => (e.startTime + e.duration) >= tStart && e.startTime <= tEnd + 60);
  const loaf = windowLoafs.length
    ? {
        count: windowLoafs.length,
        duration: mean(windowLoafs.map((e) => e.duration)),
        script: mean(windowLoafs.map((e) => (e.renderStart > 0 ? Math.max(0, e.styleAndLayoutStart - e.renderStart) : Math.max(0, e.styleAndLayoutStart - e.startTime)))),
        styleAndLayout: mean(windowLoafs.map((e) => Math.max(0, (e.startTime + e.duration) - e.styleAndLayoutStart))),
        afterMain: mean(windowLoafs.filter((e) => e.presentationTime > 0).map((e) => Math.max(0, e.presentationTime - (e.startTime + e.duration)))),
      }
    : null;

  const s = handle.stats;
  const elapsedSec = Math.max(0.001, (tEnd - tStart) / 1000);
  const avgDt = mean(dts);
  const result = {
    workloadId,
    backend,
    contain,
    mutationMode,
    frames: dts.length,
    mutations,
    elapsedMs: tEnd - tStart,
    fps: avgDt ? 1000 / avgDt : 0,
    p50: percentile(dts, 0.5),
    p95: percentile(dts, 0.95),
    meanMs: avgDt,
    scriptJsMs: mutations ? (mutateMsTotal + s.handlerMsTotal) / mutations : 0,
    handlerMs: s.paints ? s.handlerMsTotal / s.paints : 0,
    loafSupported,
    loafCount: windowLoafs.length,
    loaf,
    paints: s.paints,
    paintHz: s.paints / elapsedSec,
    paintPerMutation: mutations ? s.paints / mutations : 0,
    changedSupported: s.changedSamples > 0,
    changedMean: s.changedSamples ? s.changedSum / s.changedSamples : null,
    changedMax: s.changedSamples ? s.changedMax : null,
    overInvalidations: s.overInvalidations,
    uploadsPerPaint: s.paints ? s.uploads / s.paints : null,
    aborted: Boolean(signal?.aborted),
  };

  handle.destroy();
  return result;
}
// #endregion measure

export function computeContainDelta(baseRun, containedRun) {
  if (!baseRun || !containedRun || !baseRun.p95 || !containedRun.p95) return null;
  const p95DeltaMs = containedRun.p95 - baseRun.p95;
  const p95DeltaPct = (p95DeltaMs / baseRun.p95) * 100;
  const changedDelta = (baseRun.changedMean != null && containedRun.changedMean != null)
    ? containedRun.changedMean - baseRun.changedMean
    : null;
  return { p95DeltaMs, p95DeltaPct, changedDelta };
}

export function formatMarkdownReport({ rows, deltas, device }) {
  const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));
  const lines = [
    '# Subtree complexity benchmark report (`/perf-subtree/`)',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- UA: ${device.ua}`,
    `- DPR: ${device.dpr}, viewport: ${device.width}x${device.height}, cores: ${device.cores}`,
    '',
    '| Workload | Backend | contain | Mutation | FPS | p50 ms | p95 ms | JS ms | LoAFs (script / style+layout / post-main) | Paint/mut | changedElements (mean / max) |',
    '|---|---|---|---|---:|---:|---:|---:|---|---:|---|',
  ];

  for (const r of rows) {
    const loafStr = !r.loafSupported
      ? 'unsupported'
      : r.loaf
        ? `${r.loafCount} (${num(r.loaf.script)} / ${num(r.loaf.styleAndLayout)} / ${num(r.loaf.afterMain)} ms)`
        : '0 (<50 ms)';
    const paintStr = r.backend === 'dom' ? '-' : `${r.paints}/${r.mutations} (${num(r.paintPerMutation, 2)})`;
    const chStr = r.backend === 'dom'
      ? '-'
      : r.changedSupported
        ? `${num(r.changedMean, 2)} / ${r.changedMax}`
        : 'n/a';
    lines.push(
      `| ${r.workloadId} | ${r.backend} | ${r.contain} | ${r.mutationMode} | ${num(r.fps, 1)} | ${num(r.p50, 1)} | ${num(r.p95, 1)} | ${num(r.scriptJsMs, 2)} | ${loafStr} | ${paintStr} | ${chStr} |`
    );
  }

  if (deltas.length) {
    lines.push(
      '',
      '## Containment delta (`contain: layout paint` or `strict` vs `contain: none`)',
      '',
      '| Workload | Backend | Mode | Base p95 ms | Contained p95 ms | Delta | changedElements delta |',
      '|---|---|---|---:|---:|---:|---:|'
    );
    for (const d of deltas) {
      const sign = d.p95DeltaMs > 0 ? '+' : '';
      const chDelta = d.changedDelta == null ? '-' : `${d.changedDelta > 0 ? '+' : ''}${d.changedDelta.toFixed(2)}`;
      lines.push(
        `| ${d.workloadId} | ${d.backend} | ${d.mode} | ${num(d.baseP95, 1)} | ${num(d.containedP95, 1)} | ${sign}${num(d.p95DeltaMs, 1)} ms (${sign}${num(d.p95DeltaPct, 0)}%) | ${chDelta} |`
      );
    }
  }

  return lines.join('\n');
}

export function buildCompactTelemetry(rows, deltas) {
  const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
  return {
    dpr: window.devicePixelRatio || 1,
    w: window.innerWidth,
    cores: navigator.hardwareConcurrency || null,
    rows: rows.map((r) => ({
      w: r.workloadId,
      b: r.backend,
      c: r.contain,
      m: r.mutationMode,
      fps: r1(r.fps),
      p50: r1(r.p50),
      p95: r1(r.p95),
      loafs: r.loafCount,
      after: r.loaf ? r1(r.loaf.afterMain) : null,
      sl: r.loaf ? r1(r.loaf.styleAndLayout) : null,
      pm: r.backend === 'dom' ? null : r2(r.paintPerMutation),
      ch: r.changedSupported ? r2(r.changedMean) : null,
      chMax: r.changedMax,
    })),
    deltas: deltas.map((d) => ({
      w: d.workloadId,
      b: d.backend,
      m: d.mode,
      ms: r1(d.p95DeltaMs),
      pct: r1(d.p95DeltaPct),
      ch: d.changedDelta == null ? null : r2(d.changedDelta),
    })),
  };
}

// Live checks run on isolated fixtures inside testStage() and never touch the visible demo.
export function buildLiveChecks() {
  const waitPaint = (canvas, ms = 1200) => new Promise((resolve) => {
    let done = false;
    const finish = (ev) => {
      if (done) return;
      done = true;
      canvas.removeEventListener('paint', onP);
      resolve(ev);
    };
    const onP = (ev) => finish(ev);
    canvas.addEventListener('paint', onP);
    setTimeout(() => finish(null), ms);
  });

  const hasNonBlankPixels = (canvas) => {
    if (!canvas.width || !canvas.height) return 0;
    // Copy the drawable canvas into a plain 2D canvas with willReadFrequently
    // so the drawable canvas itself is never read directly.
    const copy = document.createElement('canvas');
    copy.width = Math.max(1, Math.min(canvas.width, 320));
    copy.height = Math.max(1, Math.min(canvas.height, 240));
    const cc = copy.getContext('2d', { willReadFrequently: true });
    cc.drawImage(canvas, 0, 0, copy.width, copy.height);
    const data = cc.getImageData(0, 0, copy.width, copy.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 10) lit++;
    return lit;
  };

  return [
    {
      name: '2D drawElementImage() draws 16 sibling drawable cards',
      why: 'Checks that 16 sibling drawable cards paint into a 2D canvas using 5-argument CSS-unit sizes.',
      run: async () => {
        if (!canvasSupported) throw new Error('HTML-in-canvas 2D API is not available in this browser');
        const box = document.createElement('div');
        box.style.cssText = 'width:320px;height:220px;';
        testStage().append(box);
        const h = mountStage(box, { workloadId: 'flat', backend: '2d', contain: 'none' });
        await waitPaint(h.canvas, 1000);
        await raf();
        const paints = h.stats.paints;
        const lit = hasNonBlankPixels(h.canvas);
        if (!paints) throw new Error('paint event did not fire on the 2D fixture');
        if (!lit) throw new Error('canvas drew 0 opaque pixels');
        return `${paints} paint event(s), ${lit} sampled opaque pixels across 16 drawable cards.`;
      },
    },
    {
      name: 'Mutating 1 of 16 siblings reports e.changedElements',
      why: 'Checks whether changing one card with contain: layout paint names only that card in changedElements.',
      run: async () => {
        if (!canvasSupported) throw new Error('HTML-in-canvas 2D API is not available in this browser');
        const box = document.createElement('div');
        box.style.cssText = 'width:320px;height:220px;';
        testStage().append(box);
        const h = mountStage(box, { workloadId: 'flat', backend: '2d', contain: 'layout-paint' });
        await waitPaint(h.canvas, 1000);
        await raf();
        h.resetStats();
        const p = waitPaint(h.canvas, 1000);
        mutateOne(h.targets, 3, 1, 'layout');
        const ev = await p;
        if (!ev) throw new Error('mutating 1 sibling did not trigger a paint event');
        if (!ev.changedElements) return 'paint fired, but e.changedElements is not exposed in this browser.';
        const n = ev.changedElements.length;
        const namedTarget = [...ev.changedElements].includes(h.cards[3]);
        return `e.changedElements.length = ${n} of 16 (mutated card named: ${namedTarget ? 'yes' : 'no'}).`;
      },
    },
    {
      name: 'Flow-layout sibling reflow: contain: none vs contain: layout paint',
      why: 'Mutates card 0 width in a wrapping flex container to compare sibling over-invalidation with and without containment.',
      run: async () => {
        if (!canvasSupported) throw new Error('HTML-in-canvas 2D API is not available in this browser');
        const probe = async (contain) => {
          const box = document.createElement('div');
          box.style.cssText = 'width:320px;height:220px;';
          testStage().append(box);
          const h = mountStage(box, { workloadId: 'flat', backend: '2d', contain, flowLayout: true });
          await waitPaint(h.canvas, 1000);
          await raf();
          const p = waitPaint(h.canvas, 1000);
          h.targets[0].val.textContent = 'expanded sibling text payload';
          h.targets[0].card.style.paddingRight = '14px';
          const ev = await p;
          const count = ev?.changedElements ? ev.changedElements.length : null;
          h.destroy();
          box.remove();
          return count;
        };
        const withoutContain = await probe('none');
        const withContain = await probe('layout-paint');
        if (withoutContain == null || withContain == null) {
          return `changedElements not reported (none=${withoutContain}, layout-paint=${withContain}).`;
        }
        return `changedElements length: contain: none = ${withoutContain}/16, contain: layout paint = ${withContain}/16.`;
      },
    },
    {
      name: 'WebGL ElementGL uploads only changed elements on 1-sibling mutation',
      why: 'Verifies texElementSubImage2D() via ElementGL uploads 16 cards on initial paint and fewer on single-card edits.',
      run: async () => {
        if (!capability.webgl) throw new Error('WebGL texElementSubImage2D() is not available in this browser');
        const box = document.createElement('div');
        box.style.cssText = 'width:320px;height:220px;';
        testStage().append(box);
        const h = mountStage(box, { workloadId: 'flat', backend: 'webgl', contain: 'layout-paint' });
        await waitPaint(h.canvas, 1000);
        await raf();
        const initialUploads = h.stats.uploads;
        h.resetStats();
        const p = waitPaint(h.canvas, 1000);
        mutateOne(h.targets, 5, 2, 'paint');
        const ev = await p;
        const deltaUploads = h.stats.uploads;
        const chLen = ev?.changedElements?.length ?? null;
        h.destroy();
        if (!ev) throw new Error('WebGL paint event did not fire after mutation');
        return `Initial uploads: ${initialUploads}/16. After mutating 1 card: ${deltaUploads} upload(s) (changedElements: ${chLen ?? 'n/a'}).`;
      },
    },
    {
      name: 'Transform, paint and layout mutations inside a drawable subtree',
      why: 'Checks whether transform-only, colour-only and text/padding mutations on an inner child each fire paint.',
      run: async () => {
        if (!canvasSupported) throw new Error('HTML-in-canvas 2D API is not available in this browser');
        const box = document.createElement('div');
        box.style.cssText = 'width:320px;height:220px;';
        testStage().append(box);
        const h = mountStage(box, { workloadId: 'flat', backend: '2d', contain: 'layout-paint' });
        await waitPaint(h.canvas, 1000);
        await raf();

        const results = [];
        for (const mode of ['transform', 'paint', 'layout']) {
          const p = waitPaint(h.canvas, 450);
          mutateOne(h.targets, 2, mode === 'layout' ? 1 : 2, mode);
          const ev = await p;
          results.push(`${mode}: ${ev ? `paint (${ev.changedElements?.length ?? '?'} changed)` : 'no paint in 450 ms'}`);
        }
        return results.join('; ');
      },
    },
    {
      name: 'Long Animation Frames (long-animation-frame) availability',
      why: 'Checks whether PerformanceObserver exposes long-animation-frame entries for script, style/layout and presentation splits.',
      run: async () => {
        const types = typeof PerformanceObserver !== 'undefined' ? (PerformanceObserver.supportedEntryTypes ?? []) : [];
        const hasLoaf = types.includes('long-animation-frame');
        if (!hasLoaf) throw new Error('long-animation-frame is not in PerformanceObserver.supportedEntryTypes');
        return 'long-animation-frame is supported (reports frames over 50 ms with renderStart, styleAndLayoutStart and presentationTime).';
      },
    },
  ];
}
