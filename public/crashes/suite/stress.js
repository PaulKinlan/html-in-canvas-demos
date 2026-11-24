// Crash regression definitions, safe engine checks, and five tap-to-run stress tests
// for /crashes/suite/. Nothing starts on page load.

import { webgpu } from '/shared/backend.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nextPaint = (canvas) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('paint timed out after 3 s')), 3000);
  canvas.addEventListener('paint', () => { clearTimeout(timer); resolve(); }, { once: true });
  canvas.requestPaint();
});

const makeDrawable = (host, w, h, html) => {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = `width:${w}px;height:${h}px;display:block;`;
  canvas.innerHTML = html;
  host.append(canvas);
  return canvas;
};

const retireCanvas = (canvas) => {
  if (!canvas) return;
  try { window.__gfx?.retire?.(canvas); } catch {}
  canvas.remove();
};

const makeOnScreenDrawable = (w, h, html) => {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#fff;box-shadow:0 2px 12px #0003;';
  document.body.append(wrap);
  const canvas = makeDrawable(wrap, w, h, html);
  return { canvas, cleanup: () => { retireCanvas(canvas); wrap.remove(); } };
};

// #region catalog
// Every historical crash, context loss and rendering bug with a standalone repro page.
// `storageKey` matches the localStorage key written by the repro page so the suite can
// tell whether a popup finished cleanly or crashed mid-run.
export const REPRO_CATALOG = [
  {
    id: 'iframe-in-paint-remove',
    kind: 'crash',
    title: 'Remove an iframe child inside paint',
    before: 'C157 & C158: crashed tab (CHECK int3)',
    repro: '/crashes/repro/iframe-in-paint.html',
    autoQuery: '?autorun=b',
    timeoutMs: 4500,
    button: 'B: remove in paint',
    storageKey: 'repro-iframe-in-paint',
    note: 'C160.0.8180.0 (2026-11-24): fixed, survived.',
  },
  {
    id: 'adopt-painted-canvas',
    kind: 'crash',
    title: 'adoptNode() of a painted drawable canvas into an iframe',
    before: 'C157 & C158: crashed tab',
    repro: '/crashes/repro/adopt-painted-canvas.html',
    autoQuery: '?autorun=a',
    timeoutMs: 3500,
    button: 'A: painted here first',
    storageKey: 'repro-adopt-painted-canvas',
    note: 'C160.0.8180.0 (2026-11-24): fixed, painted in frame with no crash.',
  },
  {
    id: 'opacity-in-drawn-iframe',
    kind: 'crash',
    title: 'opacity: 0.02 around a drawable canvas inside a drawn iframe',
    before: 'C157: crashed tab within 300 ms',
    repro: '/crashes/repro/opacity-in-drawn-iframe.html',
    autoQuery: '?autorun=a',
    timeoutMs: 4500,
    button: 'A: opacity .02',
    storageKey: 'repro-opacity-in-drawn-iframe',
    note: 'C158 & C160 (2026-11-24): fixed, 2 s of paints with no crash.',
  },
  {
    id: 'lose-context-stress',
    kind: 'crash',
    // gfx-allow: lose-context prose description of a crash case
    title: 'Multi-canvas WebGL loseContext() + restoreContext() inside paint',
    before: 'C157 & C158: crashed tab (4 drawable WebGL canvases + iframes)',
    repro: '/crashes/repro/lose-context-stress.html',
    autoQuery: '?autorun=b',
    timeoutMs: 4500,
    button: 'B: loseContext() + restoreContext() cycle',
    storageKey: 'repro-lose-context-stress',
    note: 'C160.0.8180.0 (2026-11-24): fixed, 4 lost and 4 restored with no crash.',
  },
  {
    id: 'video-iframe-readback',
    kind: 'crash',
    title: 'Iframe playing video inside drawable canvas + repaint + getImageData()',
    before: 'C157: crashed in /video/ check fixture',
    repro: '/crashes/repro/video-iframe-readback.html',
    autoQuery: '?autorun=a',
    timeoutMs: 5000,
    button: 'A: iframe video + repaint + getImageData()',
    storageKey: 'repro-video-iframe-readback',
    note: 'Uses a local MediaStream video so no media network fetch is needed.',
  },
  {
    id: 'frequent-read-drawable',
    kind: 'loss',
    title: 'willReadFrequently: true on a drawable 2D canvas',
    before: 'Android C159: lost every 2D context in 8 to 22 ms, repeatedly',
    repro: '/crashes/repro/frequent-read-drawable.html',
    autoQuery: '?autorun=a',
    timeoutMs: 7000,
    button: 'A: with willReadFrequently',
    storageKey: 'repro-frequent-read-drawable',
    note: 'Needs testing on Android Canary; desktop macOS shows no loss.',
  },
  {
    id: 'float-readback',
    kind: 'loss',
    // gfx-allow: float-readback prose description of a crash case
    title: 'float16 Display P3 getImageData({ pixelFormat: "rgba-float16" })',
    before: 'Android C159: lost every float16 2D context on the page',
    repro: '/crashes/repro/float-readback.html',
    autoQuery: '?autorun=b',
    timeoutMs: 6500,
    button: 'B: draw an element, then read',
    storageKey: 'repro-float-readback',
    note: 'Needs testing on Android Canary.',
  },
  {
    id: 'white-webgl',
    kind: 'blank',
    title: 'Animated transparent WebGL 2 canvas with drawable children',
    before: 'Android C159: turned solid white on /particles/ with no contextlost',
    repro: '/crashes/repro/white-webgl.html',
    autoQuery: '?autorun=a',
    timeoutMs: 5500,
    button: 'Run 3 s WebGL loop',
    storageKey: 'repro-white-webgl',
    note: 'Samples frames for all-white or blank output across 3 s.',
  },
  {
    id: 'rotated-draw-text-flicker',
    kind: 'engine',
    title: 'Continuous ctx.rotate() with drawElementImage() drops text lines',
    before: 'C157 & C160 macOS Metal: drops >15% of text pixels on Apple Metal',
    repro: '/crashes/repro/rotated-draw-text-flicker.html',
    autoQuery: '?autorun=a',
    timeoutMs: 4500,
    button: 'A: continuous ctx.rotate()',
    storageKey: 'repro-rotated-draw-text-flicker',
    note: 'Reproduces the /slot/hello glyph-atlas flicker on Apple Metal.',
  },
  {
    id: 'ninth-webgl-context',
    kind: 'loss',
    title: 'Context eviction limit (9th on Android, 17th on desktop)',
    before: 'Documented browser limit (not a crash)',
    repro: '/crashes/repro/ninth-webgl-context.html',
    autoQuery: '?autorun=a',
    timeoutMs: 5500,
    button: 'Make 17 WebGL contexts',
    storageKey: 'repro-ninth-webgl-context',
    note: 'Confirms oldest context eviction timing.',
  },
  {
    id: 'view-transition-drawable-child',
    kind: 'crash',
    title: 'element.startViewTransition() on a drawable child (runs last)',
    before: 'C157 & C158: crashed renderer',
    repro: '/crashes/repro/view-transition-drawable-child.html',
    autoQuery: '?autorun=a',
    timeoutMs: 3500,
    button: 'A: drawable child',
    storageKey: 'repro-view-transition-drawable-child',
    note: 'C160.0.8180.0 (2026-11-24): still crashes renderer. Placed last so all earlier repros finish in one pass.',
  },
  {
    id: 'readback-matrix',
    kind: 'loss',
    title: 'Repeated getImageData() on an accelerated drawable 2D canvas (7 reloads)',
    before: 'Android C159: 2nd readback in paint loop lost every 2D context',
    repro: '/crashes/repro/readback-matrix.html',
    autoQuery: '?case=draw-read-twice&chain=2',
    timeoutMs: 32000,
    skipInAll: true,
    button: 'Run the seven repeated-read cases',
    storageKey: 'repro-readback-matrix',
    note: 'Reloads its popup 7 times (~25 s). Run this row on its own.',
  },
];
// #endregion catalog

// #region checks
// Non-crashing engine regression checks that run directly inside a hidden fixture box.
export const ENGINE_CHECKS = [
  {
    id: 'movebefore-same-task',
    title: 'moveBefore() out and back in one task keeps element drawable',
    before: 'C157: threw InvalidStateError',
    async run(stage) {
      if (!('moveBefore' in Element.prototype)) return { status: 'skip', detail: 'moveBefore() not supported' };
      const holder = document.createElement('div');
      stage.append(holder);
      const canvas = makeDrawable(stage, 260, 80, '<div drawable style="width:180px;padding:8px;background:#e8f5e9;color:#111">Moved card</div>');
      const el = canvas.firstElementChild;
      const ctx = canvas.getContext('2d');
      try {
        await nextPaint(canvas);
        ctx.drawElementImage(el, 8, 8, el.offsetWidth, el.offsetHeight);
        holder.moveBefore(el, null);
        canvas.moveBefore(el, null);
        await nextPaint(canvas);
        ctx.drawElementImage(el, 8, 8, el.offsetWidth, el.offsetHeight);
        return { status: 'pass', detail: 'drawElementImage() succeeded after same-task moveBefore()' };
      } catch (e) {
        return { status: 'fail', detail: `threw ${e.name}: ${e.message}` };
      } finally {
        retireCanvas(canvas);
        holder.remove();
      }
    },
  },
  {
    id: 'stale-hit-test',
    title: 'Moving a drawn hit box clears hit-test cache without toggling an attribute',
    before: 'C157: elementFromPoint() returned stale element at old coords',
    async run() {
      const { canvas, cleanup } = makeOnScreenDrawable(300, 90, '<button drawable type="button" style="width:80px;height:40px">Hit</button>');
      const btn = canvas.firstElementChild;
      const ctx = canvas.getContext('2d');
      try {
        await nextPaint(canvas);
        ctx.clearRect(0, 0, 300, 90);
        ctx.drawElementImage(btn, 10, 10, btn.offsetWidth, btn.offsetHeight);
        const r = canvas.getBoundingClientRect();
        const hitBefore = document.elementFromPoint(r.left + 40, r.top + 30);
        await nextPaint(canvas);
        ctx.clearRect(0, 0, 300, 90);
        ctx.drawElementImage(btn, 180, 10, btn.offsetWidth, btn.offsetHeight);
        const hitOld = document.elementFromPoint(r.left + 40, r.top + 30);
        const hitNew = document.elementFromPoint(r.left + 210, r.top + 30);
        if (hitBefore === btn && hitOld !== btn && hitNew === btn) {
          return { status: 'pass', detail: 'old point cleared and new point hit immediately' };
        }
        return {
          status: 'fail',
          detail: `before=${hitBefore?.tagName}, oldPoint=${hitOld === btn ? 'STALE BUTTON' : hitOld?.tagName}, newPoint=${hitNew === btn ? 'BUTTON' : hitNew?.tagName}`,
        };
      } finally {
        cleanup();
      }
    },
  },
  {
    id: 'clear-geometry-keeps-region',
    title: 'clearElementGeometry() removes the old hit region',
    before: 'C157: old hit box stayed active after clearElementGeometry()',
    async run() {
      const { canvas, cleanup } = makeOnScreenDrawable(260, 80, '<button drawable type="button" style="width:90px;height:40px">Clear</button>');
      const btn = canvas.firstElementChild;
      const ctx = canvas.getContext('2d');
      try {
        if (typeof canvas.clearElementGeometry !== 'function') {
          return { status: 'skip', detail: 'clearElementGeometry() not on HTMLCanvasElement' };
        }
        await nextPaint(canvas);
        ctx.drawElementImage(btn, 20, 20, btn.offsetWidth, btn.offsetHeight);
        const r = canvas.getBoundingClientRect();
        const before = document.elementFromPoint(r.left + 55, r.top + 38);
        canvas.clearElementGeometry(btn);
        btn.toggleAttribute('data-cache-bust');
        const after = document.elementFromPoint(r.left + 55, r.top + 38);
        if (before === btn && after !== btn) {
          return { status: 'pass', detail: 'hit box cleared after clearElementGeometry()' };
        }
        return { status: 'fail', detail: `before=${before?.tagName}, after=${after === btn ? 'STILL BUTTON' : after?.tagName}` };
      } finally {
        cleanup();
      }
    },
  },
  {
    id: 'source-rect-hit-region',
    title: 'updateElementGeometry() restores full hit box after a 9-arg source-rect draw',
    before: 'C157: hit box stayed clipped to the source rectangle size',
    async run() {
      const { canvas, cleanup } = makeOnScreenDrawable(280, 90, '<button drawable type="button" style="width:160px;height:44px">Wide button</button>');
      const btn = canvas.firstElementChild;
      const ctx = canvas.getContext('2d');
      try {
        await nextPaint(canvas);
        ctx.drawElementImage(btn, 0, 0, 40, 44, 10, 10, 40, 44);
        canvas.updateElementGeometry(btn, { canvasTransform: new DOMMatrix().translate(10, 10) });
        btn.toggleAttribute('data-cache-bust');
        const r = canvas.getBoundingClientRect();
        const hitLeft = document.elementFromPoint(r.left + 25, r.top + 30);
        const hitRight = document.elementFromPoint(r.left + 130, r.top + 30);
        if (hitLeft === btn && hitRight === btn) {
          return { status: 'pass', detail: 'full 160 px width is clickable after updateElementGeometry()' };
        }
        return { status: 'fail', detail: `left=${hitLeft === btn ? 'hit' : 'miss'}, right(130px)=${hitRight === btn ? 'hit' : 'miss (clipped to source rect)'}` };
      } finally {
        cleanup();
      }
    },
  },
  {
    id: 'rotated-draw-text-flicker',
    title: '45 frames of continuous ctx.rotate() with drawElementImage() do not drop text',
    before: 'C157 & C160 macOS Metal: dropped text lines on ~30% of frames',
    async run(stage) {
      const W = 400, H = 220, dpr = 2;
      const canvas = makeDrawable(stage, W, H, '<div drawable style="box-sizing:border-box;width:320px;padding:14px 16px;background:#fff;color:#111;font:15px/1.45 system-ui,sans-serif"><h2 style="margin:0 0 6px;font-size:18px">Live HTML heading line one</h2><p style="margin:0 0 8px">Second line of dark text inside the card.</p><p style="margin:0">Third line of dark text to test glyph atlas drops.</p></div>');
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const el = canvas.firstElementChild;
      const ctx = canvas.getContext('2d');
      const copy = document.createElement('canvas');
      copy.width = W; copy.height = H;
      const cctx = copy.getContext('2d', { willReadFrequently: true });
      const counts = [];
      try {
        await new Promise((resolve) => {
          let f = 0, done = false;
          const finish = () => { if (!done) { done = true; canvas.onpaint = null; resolve(); } };
          const guard = setTimeout(finish, 4000);
          canvas.onpaint = () => {
            if (done) return;
            f++;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            ctx.save();
            ctx.translate(W / 2, H / 2 + Math.sin(f * 0.15) * 4);
            ctx.rotate(Math.sin(f * 0.12) * 0.05);
            ctx.drawElementImage(el, -el.offsetWidth / 2, -el.offsetHeight / 2, el.offsetWidth, el.offsetHeight);
            ctx.restore();
            cctx.clearRect(0, 0, W, H);
            cctx.drawImage(canvas, 0, 0, W, H);
            const data = cctx.getImageData(40, 30, W - 80, H - 60).data;
            let dark = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] < 110 && data[i + 1] < 110 && data[i + 2] < 110 && data[i + 3] > 200) dark++;
            counts.push(dark);
            if (f >= 45) { clearTimeout(guard); finish(); }
          };
          const pump = () => { if (!done && f < 45) { canvas.requestPaint(); requestAnimationFrame(pump); } };
          pump();
        });
        const sorted = [...counts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 1;
        const drops = counts.filter((c) => c < median * 0.85).length;
        if (drops === 0 && median > 200) {
          return { status: 'pass', detail: `0 drops in 45 frames (median ${median} dark px, min ${sorted[0]})` };
        }
        return { status: 'fail', detail: `${drops}/45 frames dropped text (>15% loss; median ${median}, min ${sorted[0]})` };
      } finally {
        canvas.onpaint = null;
        retireCanvas(canvas);
      }
    },
  },
  {
    id: 'inner-canvas-shifted',
    title: 'Plain <canvas> nested inside a padded drawable element draws at the right offset',
    before: 'C157: inner canvas pixels shifted by minus its padding offset',
    async run(stage) {
      const canvas = makeDrawable(stage, 160, 120, '<figure drawable style="box-sizing:border-box;margin:0;width:140px;height:100px;padding:20px;background:#fff"><canvas id="inner" width="60" height="60" style="display:block;width:60px;height:60px"></canvas></figure>');
      const fig = canvas.firstElementChild;
      const inner = fig.querySelector('#inner');
      const ictx = inner.getContext('2d');
      ictx.fillStyle = '#dd2222';
      ictx.fillRect(0, 0, 16, 60);
      ictx.fillStyle = '#1166dd';
      ictx.fillRect(16, 0, 44, 60);
      const ctx = canvas.getContext('2d');
      const copy = document.createElement('canvas');
      copy.width = 160; copy.height = 120;
      const cctx = copy.getContext('2d', { willReadFrequently: true });
      try {
        await nextPaint(canvas);
        ctx.clearRect(0, 0, 160, 120);
        ctx.drawElementImage(fig, 10, 10, fig.offsetWidth, fig.offsetHeight);
        cctx.drawImage(canvas, 0, 0);
        // Red left stripe should be at x = 10 + 20 + 6 = 36, y = 10 + 20 + 30 = 60.
        // If shifted by -20 px, x=36 shows blue instead of red!
        const leftPx = cctx.getImageData(36, 60, 1, 1).data;
        const rightPx = cctx.getImageData(66, 60, 1, 1).data;
        const isRed = leftPx[0] > 170 && leftPx[2] < 80;
        const isBlue = rightPx[2] > 170 && rightPx[0] < 80;
        if (isRed && isBlue) {
          return { status: 'pass', detail: `red stripe at x=36 (${leftPx.slice(0, 3).join(',')}), blue at x=66 (${rightPx.slice(0, 3).join(',')})` };
        }
        return { status: 'fail', detail: `atRedStripe=(${leftPx.slice(0, 3).join(',')}), atBlueArea=(${rightPx.slice(0, 3).join(',')})` };
      } finally {
        retireCanvas(canvas);
      }
    },
  },
  {
    id: 'snapshot-burst-close',
    title: 'captureElementImage() burst of 120 snapshots with close() leaks 0 handles',
    before: 'Stress baseline for snapshot allocation & GPU release',
    async run(stage) {
      const canvas = makeDrawable(stage, 260, 100, '<div drawable style="width:200px;padding:10px;background:#dceefb;color:#102a43">Snapshot target #0</div>');
      const el = canvas.firstElementChild;
      const ctx = canvas.getContext('2d');
      try {
        if (typeof canvas.captureElementImage !== 'function') {
          return { status: 'skip', detail: 'captureElementImage() not available' };
        }
        await nextPaint(canvas);
        const t0 = performance.now();
        for (let i = 0; i < 120; i++) {
          el.textContent = `Snapshot target #${i}`;
          const snap = canvas.captureElementImage(el);
          ctx.clearRect(0, 0, 260, 100);
          ctx.drawElementImage(snap, 10, 10, el.offsetWidth, el.offsetHeight);
          snap.close();
        }
        const elapsed = performance.now() - t0;
        const open = window.__gfx?.openSnapshots?.() ?? 0;
        if (open === 0) {
          return { status: 'pass', detail: `120 captures+draws+closes in ${elapsed.toFixed(1)} ms (${(elapsed / 120).toFixed(2)} ms/op), 0 open` };
        }
        return { status: 'fail', detail: `finished in ${elapsed.toFixed(1)} ms, but ${open} snapshots still open` };
      } finally {
        retireCanvas(canvas);
      }
    },
  },
  {
    id: 'webgpu-upload-smoke',
    title: 'WebGPU queue.drawElementImageToTexture() uploads a live element cleanly',
    before: 'Verifies WebGPU element upload without device loss',
    async run(stage) {
      const gpu = await webgpu();
      if (!gpu?.device) return { status: 'skip', detail: 'No WebGPU adapter/device in this browser' };
      const { device } = gpu;
      if (typeof device.queue.drawElementImageToTexture !== 'function') {
        return { status: 'skip', detail: 'GPUQueue.drawElementImageToTexture() not exposed' };
      }
      const canvas = makeDrawable(stage, 160, 80, '<div drawable style="width:128px;height:64px;background:#e63946;color:#fff;padding:6px">GPU DOM</div>');
      const el = canvas.firstElementChild;
      const wctx = canvas.getContext('webgpu');
      let tex = null;
      try {
        if (!wctx) return { status: 'skip', detail: 'canvas.getContext("webgpu") returned null' };
        wctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' });
        await nextPaint(canvas);
        tex = device.createTexture({
          size: [128, 64, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        const t0 = performance.now();
        device.queue.drawElementImageToTexture({ source: el }, { texture: tex });
        await device.queue.onSubmittedWorkDone();
        const ms = performance.now() - t0;
        return { status: 'pass', detail: `uploaded 128x64 element to WebGPU texture in ${ms.toFixed(1)} ms` };
      } catch (e) {
        return { status: 'fail', detail: `${e.name}: ${e.message}` };
      } finally {
        try { tex?.destroy(); } catch {}
        retireCanvas(canvas);
      }
    },
  },
];
// #endregion checks

// #region stress-2d
// Stress 1: High-density 2D live DOM wall (24 / 64 / 128 interactive elements)
export function start2DWallStress(container, opts, onStats) {
  const count = opts.count || 64;
  const animateRotate = !!opts.rotate;
  const reflowChurn = !!opts.reflow;
  const W = 640, H = 380;
  const dpr = Math.min(2, devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = `width:100%;max-width:${W}px;aspect-ratio:${W}/${H};display:block;border:1px solid var(--line);border-radius:10px;background:#0f172a;`;

  const cards = [];
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.setAttribute('drawable', '');
    d.style.cssText = `box-sizing:border-box;width:118px;padding:6px 8px;border-radius:6px;background:hsl(${(i * 23) % 360} 70% 92%);color:#111;font:11px/1.3 system-ui,sans-serif;border:1px solid #0002;`;
    d.innerHTML = `<b>#${i + 1}</b> <span class="v">0</span><br><input type="checkbox" ${i % 2 ? 'checked' : ''} style="margin:2px 4px 0 0"><button type="button" style="font:10px sans-serif;padding:1px 4px">Tap</button>`;
    d.querySelector('button').addEventListener('click', () => {
      const s = d.querySelector('.v');
      s.textContent = String((+s.textContent || 0) + 10);
    });
    canvas.append(d);
    cards.push(d);
  }
  container.replaceChildren(canvas);

  const ctx = canvas.getContext('2d');
  let losses = 0, running = true, rafId = 0, frames = 0, totalDraws = 0;
  const paintTimes = [];
  const tStart = performance.now();
  let lastReport = tStart, framesSinceReport = 0;

  canvas.addEventListener('contextlost', () => { losses++; });

  const cols = Math.ceil(Math.sqrt(count * (W / H)));
  const rows = Math.ceil(count / cols);
  const cellW = W / cols;
  const cellH = H / rows;

  canvas.onpaint = () => {
    if (!running) return;
    const p0 = performance.now();
    frames++;
    framesSinceReport++;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = p0 * 0.002;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const col = i % cols, row = Math.floor(i / cols);
      const cx = (col + 0.5) * cellW + Math.sin(t + i * 0.35) * 4;
      const cy = (row + 0.5) * cellH + Math.cos(t + i * 0.41) * 3;
      const scale = Math.min(1, (cellW - 4) / (c.offsetWidth || 118), (cellH - 4) / (c.offsetHeight || 44));
      ctx.save();
      ctx.translate(cx, cy);
      if (animateRotate) ctx.rotate(Math.sin(t * 1.4 + i) * 0.14);
      ctx.scale(scale, scale);
      ctx.drawElementImage(c, -(c.offsetWidth || 118) / 2, -(c.offsetHeight || 44) / 2, c.offsetWidth || 118, c.offsetHeight || 44);
      ctx.restore();
      totalDraws++;
    }
    paintTimes.push(performance.now() - p0);
    if (paintTimes.length > 120) paintTimes.shift();
  };

  const step = () => {
    if (!running) return;
    // Mutate 4 elements each frame to force live DOM repaints under load
    for (let k = 0; k < 4; k++) {
      const idx = (frames * 4 + k) % cards.length;
      const el = cards[idx];
      el.querySelector('.v').textContent = String(frames);
      if (reflowChurn && k === 0 && frames % 10 === 0) {
        el.style.width = `${106 + ((frames / 10) % 3) * 12}px`;
      }
    }
    canvas.requestPaint();
    const now = performance.now();
    if (now - lastReport >= 350) {
      const fps = (framesSinceReport * 1000) / (now - lastReport);
      const sorted = [...paintTimes].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
      const avg = paintTimes.reduce((s, v) => s + v, 0) / (paintTimes.length || 1);
      onStats({
        fps: fps.toFixed(1),
        avgPaintMs: avg.toFixed(2),
        p95PaintMs: p95.toFixed(2),
        frames,
        totalDraws,
        losses,
        memMB: window.__gfx?.memory?.()?.mb?.toFixed(1) ?? 'n/a',
      });
      lastReport = now;
      framesSinceReport = 0;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    canvas.onpaint = null;
    retireCanvas(canvas);
  };
}
// #endregion stress-2d

// #region stress-snapshots
// Stress 2: Rapid captureElementImage() snapshot ring-buffer & burst test
export function startSnapshotStress(container, opts, onStats) {
  const trailLen = opts.trail || 24;
  const W = 640, H = 300;
  const dpr = Math.min(2, devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = `width:100%;max-width:${W}px;aspect-ratio:${W}/${H};display:block;border:1px solid var(--line);border-radius:10px;background:#111827;`;
  canvas.innerHTML = `<div drawable style="box-sizing:border-box;width:190px;padding:10px 12px;border-radius:10px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font:600 13px/1.3 system-ui,sans-serif">Live Card<div class="sub" style="font-weight:400;font-size:12px">Frame 0</div></div>`;
  container.replaceChildren(canvas);

  const el = canvas.firstElementChild;
  const sub = el.querySelector('.sub');
  const ctx = canvas.getContext('2d');
  const ring = [];
  let running = true, rafId = 0, frames = 0, created = 0, closed = 0, losses = 0;
  const captureTimes = [];
  let lastReport = performance.now(), framesSince = 0;

  canvas.addEventListener('contextlost', () => { losses++; });

  canvas.onpaint = () => {
    if (!running) return;
    frames++;
    framesSince++;
    const c0 = performance.now();
    if (typeof canvas.captureElementImage === 'function') {
      const snap = canvas.captureElementImage(el);
      created++;
      ring.push({ snap, angle: frames * 0.14, x: W / 2 + Math.cos(frames * 0.08) * 190, y: H / 2 + Math.sin(frames * 0.11) * 75 });
      while (ring.length > trailLen) {
        const old = ring.shift();
        old.snap.close();
        closed++;
      }
    }
    captureTimes.push(performance.now() - c0);
    if (captureTimes.length > 90) captureTimes.shift();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ew = el.offsetWidth || 190, eh = el.offsetHeight || 54;
    for (let i = 0; i < ring.length; i++) {
      const item = ring[i];
      const alpha = (i + 1) / ring.length;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.translate(item.x, item.y);
      ctx.rotate(Math.sin(item.angle) * 0.25);
      const s = 0.55 + 0.45 * alpha;
      ctx.scale(s, s);
      ctx.drawElementImage(item.snap, -ew / 2, -eh / 2, ew, eh);
      ctx.restore();
    }
  };

  const step = () => {
    if (!running) return;
    sub.textContent = `Frame ${frames} (${created} snaps)`;
    canvas.requestPaint();
    const now = performance.now();
    if (now - lastReport >= 350) {
      const fps = (framesSince * 1000) / (now - lastReport);
      const avgCap = captureTimes.reduce((s, v) => s + v, 0) / (captureTimes.length || 1);
      onStats({
        fps: fps.toFixed(1),
        avgCaptureMs: avgCap.toFixed(2),
        created,
        closed,
        open: ring.length,
        losses,
      });
      lastReport = now;
      framesSince = 0;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    canvas.onpaint = null;
    while (ring.length) { try { ring.pop().snap.close(); } catch {} }
    retireCanvas(canvas);
  };
}
// #endregion stress-snapshots

// #region stress-webgl
// Stress 3: WebGL 2 16-texture + mipmap + offscreen FBO post-pass + optional resize & loseContext
export function startWebGLStress(container, opts, onStats) {
  const texCount = opts.textures || 16;
  const genMipmaps = opts.mipmaps !== false;
  const resizeChurn = !!opts.resize;
  let W = 640, H = 360;
  const dpr = Math.min(2, devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = `width:100%;max-width:${W}px;aspect-ratio:${W}/${H};display:block;border:1px solid var(--line);border-radius:10px;background:#090d16;`;

  const panels = [];
  for (let i = 0; i < texCount; i++) {
    const p = document.createElement('div');
    p.setAttribute('drawable', '');
    p.style.cssText = `box-sizing:border-box;width:160px;height:90px;padding:8px;border-radius:8px;background:linear-gradient(135deg,hsl(${(i * 25) % 360} 75% 42%),hsl(${(i * 25 + 45) % 360} 75% 24%));color:#fff;font:12px/1.3 system-ui,sans-serif;border:1px solid #fff3;`;
    p.innerHTML = `<b>Panel ${i + 1}</b><div class="cnt">upload 0</div><progress value="${(i + 1) * 5}" max="100" style="width:100%"></progress>`;
    canvas.append(p);
    panels.push(p);
  }
  container.replaceChildren(canvas);

  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer: false }); // gfx-allow: webgl-context single dedicated stress canvas retired on stop
  if (!gl) {
    onStats({ error: 'WebGL 2 unavailable' });
    return () => retireCanvas(canvas);
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const link = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    return p;
  };

  const sceneProg = link(
    `#version 300 es
    in vec2 a_p; in vec2 a_uv; uniform vec4 u_rect; uniform float u_ang; out vec2 v_uv;
    void main() {
      vec2 c = a_p - 0.5;
      float s = sin(u_ang), co = cos(u_ang);
      vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
      vec2 p = u_rect.xy + r * u_rect.zw;
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      gl_Position.y = -gl_Position.y;
      v_uv = a_uv;
    }`,
    `#version 300 es
    precision mediump float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
    void main() { o = texture(u_tex, v_uv); }`
  );

  const postProg = link(
    `#version 300 es
    in vec2 a_p; out vec2 v_uv;
    void main() { v_uv = a_p; gl_Position = vec4(a_p * 2.0 - 1.0, 0.0, 1.0); }`,
    `#version 300 es
    precision mediump float; in vec2 v_uv; uniform sampler2D u_scene; uniform float u_t; out vec4 o;
    void main() {
      vec2 uv = v_uv;
      float wave = sin(uv.y * 18.0 + u_t * 3.0) * 0.003;
      float r = texture(u_scene, uv + vec2(wave + 0.002, 0.0)).r;
      float g = texture(u_scene, uv + vec2(wave, 0.0)).g;
      float b = texture(u_scene, uv + vec2(wave - 0.002, 0.0)).b;
      float a = texture(u_scene, uv).a;
      o = vec4(r, g, b, a);
    }`
  );

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,0,0, 1,0,1,0, 0,1,0,1, 0,1,0,1, 1,0,1,0, 1,1,1,1]), gl.STATIC_DRAW);

  const textures = panels.map(() => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, genMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, genMipmaps ? 5 : 1, gl.RGBA8, 256, 128);
    return t;
  });

  // Offscreen FBO for post-processing pass
  let fbo = gl.createFramebuffer();
  let fboTex = gl.createTexture();
  const allocFbo = (w, h) => {
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  allocFbo(canvas.width, canvas.height);

  let running = true, rafId = 0, frames = 0, losses = 0, restores = 0, uploadErrors = 0;
  const uploadTimes = [];
  let lastReport = performance.now(), framesSince = 0;

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); losses++; });
  canvas.addEventListener('webglcontextrestored', () => { restores++; });

  const cols = 4, rows = Math.ceil(texCount / cols);

  canvas.onpaint = () => {
    if (!running || gl.isContextLost()) return;
    frames++;
    framesSince++;
    if (resizeChurn && frames % 45 === 0) {
      const nw = (frames % 90 === 0 ? 640 : 560) * dpr;
      const nh = (frames % 90 === 0 ? 360 : 320) * dpr;
      if (canvas.width !== nw || canvas.height !== nh) {
        canvas.width = nw;
        canvas.height = nh;
        allocFbo(nw, nh);
      }
    }

    const u0 = performance.now();
    for (let i = 0; i < panels.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
      try {
        if (gl.texElementSubImage2D) gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, panels[i]);
        else if (gl.texElementImage2D) gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panels[i]);
        if (genMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
      } catch {
        uploadErrors++;
      }
    }
    uploadTimes.push(performance.now() - u0);
    if (uploadTimes.length > 90) uploadTimes.shift();

    // Pass 1: draw all panels into FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.04, 0.06, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(sceneProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const pLoc = gl.getAttribLocation(sceneProg, 'a_p');
    const uvLoc = gl.getAttribLocation(sceneProg, 'a_uv');
    gl.enableVertexAttribArray(pLoc); gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
    const rectLoc = gl.getUniformLocation(sceneProg, 'u_rect');
    const angLoc = gl.getUniformLocation(sceneProg, 'u_ang');

    const t = performance.now() * 0.0018;
    for (let i = 0; i < panels.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
      const col = i % cols, row = Math.floor(i / cols);
      gl.uniform4f(rectLoc, 0.03 + col * (0.94 / cols), 0.04 + row * (0.92 / rows), 0.9 / cols, 0.84 / rows);
      gl.uniform1f(angLoc, Math.sin(t + i * 0.6) * 0.09);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Pass 2: FBO -> screen with chromatic wave shader
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(postProg);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    const pp = gl.getAttribLocation(postProg, 'a_p');
    gl.enableVertexAttribArray(pp); gl.vertexAttribPointer(pp, 2, gl.FLOAT, false, 16, 0);
    gl.uniform1f(gl.getUniformLocation(postProg, 'u_t'), t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const step = () => {
    if (!running) return;
    const idx = frames % panels.length;
    panels[idx].querySelector('.cnt').textContent = `upload ${frames}`;
    canvas.requestPaint();
    const now = performance.now();
    if (now - lastReport >= 350) {
      const fps = (framesSince * 1000) / (now - lastReport);
      const avgUp = uploadTimes.reduce((s, v) => s + v, 0) / (uploadTimes.length || 1);
      onStats({
        fps: fps.toFixed(1),
        avgUploadMs: avgUp.toFixed(2),
        textures: texCount,
        mipmaps: genMipmaps,
        losses,
        restores,
        uploadErrors,
        renderer,
      });
      lastReport = now;
      framesSince = 0;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
    canvas.onpaint = null;
    retireCanvas(canvas);
  };
  stop.triggerLoss = () => {
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext(); // gfx-allow: lose-context manual user-triggered recovery test button
    setTimeout(() => { if (running) try { ext.restoreContext(); } catch {} }, 600);
    return true;
  };
  return stop;
}
// #endregion stress-webgl

// #region stress-webgpu
// Stress 4: WebGPU drawElementImageToTexture() high-frequency upload + WGSL wave shader
export async function startWebGPUStress(container, onStats) {
  const gpu = await webgpu();
  if (!gpu?.device) {
    onStats({ error: 'WebGPU adapter/device unavailable in this browser' });
    return () => {};
  }
  const { device } = gpu;
  if (typeof device.queue.drawElementImageToTexture !== 'function') {
    onStats({ error: 'GPUQueue.drawElementImageToTexture() is not exposed' });
    return () => {};
  }

  const W = 640, H = 300;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = `width:100%;max-width:${W}px;aspect-ratio:${W}/${H};display:block;border:1px solid var(--line);border-radius:10px;background:#0a0f1c;`;

  const cards = [];
  for (let i = 0; i < 8; i++) {
    const c = document.createElement('div');
    c.setAttribute('drawable', '');
    c.style.cssText = `box-sizing:border-box;width:160px;height:80px;padding:8px;border-radius:8px;background:hsl(${(i * 42) % 360} 72% 38%);color:#fff;font:12px/1.3 system-ui,sans-serif;`;
    c.innerHTML = `<b>WGSL #${i + 1}</b><div class="n">frame 0</div>`;
    canvas.append(c);
    cards.push(c);
  }
  container.replaceChildren(canvas);

  const wctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  wctx.configure({ device, format, alphaMode: 'premultiplied' });

  const textures = cards.map(() => device.createTexture({
    size: [256, 128, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const uniformBuf = device.createBuffer({ size: 256 * 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({
    code: `
      struct Uni { rect: vec4<f32>, time: f32, idx: f32, pad0: f32, pad1: f32 };
      @group(0) @binding(0) var<uniform> u: Uni;
      @group(0) @binding(1) var samp: sampler;
      @group(0) @binding(2) var tex: texture_2d<f32>;
      struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
      @vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
        var pts = array<vec2<f32>, 6>(
          vec2(0.0,0.0), vec2(1.0,0.0), vec2(0.0,1.0),
          vec2(0.0,1.0), vec2(1.0,0.0), vec2(1.0,1.0)
        );
        let p = pts[vi];
        let wobble = sin(u.time * 3.0 + u.idx + p.x * 3.14) * 0.015;
        let q = u.rect.xy + p * u.rect.zw + vec2(0.0, wobble);
        var out: VOut;
        out.pos = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
        out.uv = p;
        return out;
      }
      @fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
        return textureSample(tex, samp, in.uv);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const groups = textures.map((tex, i) => device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf, offset: i * 256, size: 32 } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: tex.createView() },
    ],
  }));

  let running = true, rafId = 0, frames = 0, errors = 0, deviceLost = false;
  const uploadTimes = [];
  let lastReport = performance.now(), framesSince = 0;

  device.lost.then(() => { deviceLost = true; });

  canvas.onpaint = () => {
    if (!running || deviceLost) return;
    frames++;
    framesSince++;
    const t = performance.now() * 0.001;
    const u0 = performance.now();
    for (let i = 0; i < cards.length; i++) {
      try {
        device.queue.drawElementImageToTexture({ source: cards[i] }, { texture: textures[i] });
      } catch {
        errors++;
      }
      const col = i % 4, row = Math.floor(i / 4);
      const data = new Float32Array([0.04 + col * 0.24, 0.08 + row * 0.46, 0.21, 0.38, t, i, 0, 0]);
      device.queue.writeBuffer(uniformBuf, i * 256, data);
    }
    uploadTimes.push(performance.now() - u0);
    if (uploadTimes.length > 90) uploadTimes.shift();

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: wctx.getCurrentTexture().createView(),
        clearValue: { r: 0.04, g: 0.06, b: 0.11, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    for (let i = 0; i < groups.length; i++) {
      pass.setBindGroup(0, groups[i]);
      pass.draw(6);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  const step = () => {
    if (!running) return;
    const idx = frames % cards.length;
    cards[idx].querySelector('.n').textContent = `frame ${frames}`;
    canvas.requestPaint();
    const now = performance.now();
    if (now - lastReport >= 350) {
      const fps = (framesSince * 1000) / (now - lastReport);
      const avg = uploadTimes.reduce((s, v) => s + v, 0) / (uploadTimes.length || 1);
      onStats({
        fps: fps.toFixed(1),
        avgUploadMs: avg.toFixed(2),
        frames,
        errors,
        deviceLost,
        backend: gpu.info?.description || gpu.info?.architecture || 'WebGPU',
      });
      lastReport = now;
      framesSince = 0;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    canvas.onpaint = null;
    for (const t of textures) try { t.destroy(); } catch {}
    try { uniformBuf.destroy(); } catch {}
    retireCanvas(canvas);
  };
}
// #endregion stress-webgpu

// #region stress-lifecycle
// Stress 5: DOM lifecycle, iframe child, projective updateElementGeometry(), and rapid child add/remove
export function startLifecycleStress(container, onStats) {
  const W = 640, H = 280;
  const dpr = Math.min(2, devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = `width:100%;max-width:${W}px;aspect-ratio:${W}/${H};display:block;border:1px solid var(--line);border-radius:10px;background:#1e293b;`;

  const card = document.createElement('div');
  card.setAttribute('drawable', '');
  card.style.cssText = 'box-sizing:border-box;width:220px;padding:10px;border-radius:8px;background:#f8fafc;color:#0f172a;font:13px/1.35 system-ui,sans-serif;';
  card.innerHTML = '<b>Interactive target</b><br><button type="button" id="lbtn">Clicks: 0</button> <input type="range" min="0" max="100" value="50" style="width:90px">';
  let clicks = 0;
  card.querySelector('#lbtn').addEventListener('click', (e) => { clicks++; e.target.textContent = `Clicks: ${clicks}`; });

  const iframe = document.createElement('iframe');
  iframe.setAttribute('drawable', '');
  iframe.style.cssText = 'width:200px;height:110px;border:0;border-radius:8px;';
  iframe.srcdoc = '<!doctype html><body style="margin:0;padding:10px;background:#0f766e;color:#fff;font:13px system-ui"><b>Same-origin iframe</b><div id="t">0</div><script>let n=0;setInterval(()=>{n++;document.getElementById("t").textContent="tick "+n;},100);<\/script></body>';

  canvas.append(card, iframe);
  container.replaceChildren(canvas);

  const ctx = canvas.getContext('2d');
  let running = true, rafId = 0, frames = 0, domOps = 0, errors = 0, losses = 0;
  let lastReport = performance.now(), framesSince = 0;
  const tempPool = [];

  canvas.addEventListener('contextlost', () => { losses++; });

  canvas.onpaint = () => {
    if (!running) return;
    frames++;
    framesSince++;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = performance.now() * 0.002;
    const x1 = 36 + Math.sin(t) * 24;
    const y1 = 44 + Math.cos(t * 1.3) * 18;
    try {
      ctx.drawElementImage(card, x1, y1, card.offsetWidth || 220, card.offsetHeight || 72);
      canvas.updateElementGeometry?.(card, { canvasTransform: new DOMMatrix().translate(x1 * dpr, y1 * dpr).scale(dpr) });
      card.toggleAttribute('data-hit-tick');
      ctx.drawElementImage(iframe, 340 + Math.cos(t) * 20, 46, iframe.offsetWidth || 200, iframe.offsetHeight || 110);
      for (let i = 0; i < tempPool.length; i++) {
        const chip = tempPool[i];
        ctx.drawElementImage(chip, 36 + i * 95, 190, chip.offsetWidth || 86, chip.offsetHeight || 36);
      }
    } catch {
      errors++;
    }
  };

  const step = () => {
    if (!running) return;
    // Add & remove transient drawable DOM children outside paint every 12 frames
    if (frames % 12 === 0) {
      if (tempPool.length >= 6) {
        const old = tempPool.shift();
        old.remove();
        domOps++;
      }
      const chip = document.createElement('div');
      chip.setAttribute('drawable', '');
      chip.style.cssText = 'box-sizing:border-box;width:86px;padding:6px;border-radius:6px;background:#fef08a;color:#422006;font:11px system-ui;';
      chip.textContent = `Node #${domOps}`;
      canvas.append(chip);
      tempPool.push(chip);
      domOps++;
    }
    canvas.requestPaint();
    const now = performance.now();
    if (now - lastReport >= 350) {
      const fps = (framesSince * 1000) / (now - lastReport);
      onStats({ fps: fps.toFixed(1), frames, domOps, clicks, errors, losses });
      lastReport = now;
      framesSince = 0;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    canvas.onpaint = null;
    retireCanvas(canvas);
  };
}
// #endregion stress-lifecycle
