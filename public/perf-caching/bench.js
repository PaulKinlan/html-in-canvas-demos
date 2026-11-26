// Benchmark harness for /perf-caching/.
//
// Measures four partial-update strategies on a 24-card drawable 2D canvas
// dashboard across 0%, 5%, 25% and 100% dirty ratios, plus a 60 fps
// ElementImage snapshot churn test.

export const CARD_COUNT = 24;

export const DIRTY_RATIOS = [0, 5, 25, 100];

export const STRATEGIES = [
  {
    id: 'full',
    label: 'Full replay',
    short: 'drawElementImage() all 24 cards',
    detail: 'Calls ctx.reset() and 5-arg drawElementImage(el, x, y, w, h) for every card on every paint.',
  },
  {
    id: 'snapshot',
    label: 'ElementImage cache',
    short: 'captureElementImage() dirty cards only',
    detail: 'Re-captures only cards in e.changedElements (or dirty), closing each replaced snapshot before capturing the next.',
  },
  {
    id: 'offscreen',
    label: 'Offscreen 2D cache',
    short: 'Plain <canvas> cache per card',
    detail: 'Draws dirty cards once and copies them into plain offscreen 2D canvases; clean cards blit with ctx.drawImage().',
  },
  {
    id: 'dirty-rect',
    label: 'Clipped dirty-rect',
    short: 'ctx.clip() + 9-arg source-rect',
    detail: 'Keeps the framebuffer and clips to each dirty card metric strip, updating it with 9-arg drawElementImage().',
  },
];

export const CHURN_MODES = [
  {
    id: 'direct-60',
    label: 'Baseline: direct drawElementImage()',
    rate: '60 draws/s, 0 snapshots',
    capturesPerFrame: 0,
    batchSize: 0,
  },
  {
    id: 'immediate-60',
    label: '60/s, immediate .close()',
    rate: '1 capture/frame, closed in same paint',
    capturesPerFrame: 1,
    batchSize: 1,
  },
  {
    id: 'batch8-60',
    label: '60/s, batched .close() (pool of 8)',
    rate: '1 capture/frame, drained every 8 frames',
    capturesPerFrame: 1,
    batchSize: 8,
  },
  {
    id: 'immediate-240',
    label: '240/s (4/frame), immediate .close()',
    rate: '4 captures/frame, closed in same paint',
    capturesPerFrame: 4,
    batchSize: 1,
  },
];

const SERVICES = [
  ['api-gw', 'ms', 42], ['auth-01', 'ms', 18], ['edge-uk', 'ms', 11], ['edge-us', 'ms', 24],
  ['kv-read', 'ms', 6], ['d1-sync', 'ms', 31], ['queue-a', 'q/s', 310], ['queue-b', 'q/s', 185],
  ['img-opt', 'ms', 54], ['search', 'ms', 29], ['billing', 'ms', 47], ['webhooks', 'q/s', 92],
  ['ingest', 'MB', 128], ['cache-l1', '%', 96], ['cache-l2', '%', 84], ['tls-edge', 'ms', 9],
  ['dns-any', 'ms', 4], ['log-sink', 'MB', 64], ['metrics', 'q/s', 420], ['rate-lim', 'ms', 3],
  ['pdf-gen', 'ms', 88], ['mail-tx', 'q/s', 44], ['geo-ip', 'ms', 7], ['cron-01', '%', 62],
];

const raf = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function safeDraw9(ctx, el, sx, sy, sw, sh, dx, dy, dw, dh) {
  try {
    ctx.drawElementImage(el, sx, sy, sw, sh, dx, dy, dw, dh, { preserveElementGeometry: true });
  } catch {
    ctx.drawElementImage(el, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

function startLoafObserver() {
  const entries = [];
  if (typeof PerformanceObserver === 'undefined') return { entries, stop() {} };
  if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
    return { entries, supported: false, stop() {} };
  }
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) entries.push(e);
  });
  try {
    po.observe({ type: 'long-animation-frame' });
  } catch {
    return { entries, supported: false, stop() {} };
  }
  return {
    entries,
    supported: true,
    stop() { try { po.disconnect(); } catch {} },
  };
}

function summariseLoaf(entries, supported) {
  if (!supported) return { supported: false, count: 0, durationMean: null, afterMean: null };
  if (!entries.length) return { supported: true, count: 0, durationMean: null, afterMean: null };
  const durations = entries.map((e) => e.duration);
  const afters = entries
    .filter((e) => Number.isFinite(e.presentationTime) && e.presentationTime > 0)
    .map((e) => Math.max(0, e.presentationTime - (e.startTime + e.duration)));
  return {
    supported: true,
    count: entries.length,
    durationMean: mean(durations),
    afterMean: mean(afters),
  };
}

function gfxSnapshots() {
  const s = window.__gfx?.snapshots;
  return s ? { made: s.made, open: s.open, peak: s.peak } : { made: 0, open: 0, peak: 0 };
}

function gfxMemoryMB() {
  const m = window.__gfx?.memory?.();
  if (!m) return { mb: 0, canvases: 0, largestMP: 0, removedMB: 0 };
  return {
    mb: m.bytes / 1e6,
    canvases: m.canvases,
    largestMP: m.largest / 1e6,
    removedMB: m.removed / 1e6,
  };
}

export class DashboardHarness {
  constructor(canvas, { onLost, onMetrics } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onLost = onLost;
    this.onMetrics = onMetrics;

    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = 0;
    this.cssH = 0;
    this.cards = [];

    // Active rendering state.
    this.mode = 'full'; // 'full' | 'snapshot' | 'offscreen' | 'dirty-rect' | 'churn'
    this.cold = true;
    this.dirty = new Set();
    this.tick = 0;
    this.cursor = 0;
    this.aborted = false;
    this.liveRunning = false;
    this.liveRaf = 0;
    this.busy = false;

    // Strategy 2: main-thread ElementImage snapshot cache.
    this.snaps = new Array(CARD_COUNT).fill(null);

    // Strategy 3: plain non-drawable offscreen 2D canvas cache per card.
    this.offscreenCaches = new Array(CARD_COUNT).fill(null);

    // Part 2: churn pool.
    this.churnSpec = null;
    this.churnPool = [];

    // Per-run counters.
    this.collecting = false;
    this.paintTimes = [];
    this.captureCloseTimes = [];
    this.changedEvents = 0;
    this.changedElementsSeen = 0;
    this.peakOpenInRun = 0;
    this.peakMBInRun = 0;
    this.canvasesInRun = 0;
    this.highlightDirty = false;
    this.lastDirtyDrawn = new Set();

    this._buildCards();
    this._bindEvents();
    this.layout();
  }

  _buildCards() {
    const frag = document.createDocumentFragment();
    this.cards = [];
    for (let i = 0; i < CARD_COUNT; i++) {
      const [name, unit, base] = SERVICES[i];
      const el = document.createElement('div');
      el.className = 'dash-card';
      el.setAttribute('drawable', '');
      el.dataset.idx = String(i);
      el.innerHTML =
        `<div class="dc-head">` +
          `<span class="dc-name">${name}</span>` +
          `<button type="button" class="dc-pin" aria-pressed="false" title="Pin ${name}">pin</button>` +
        `</div>` +
        `<div class="metric-strip">` +
          `<div class="dc-row"><strong class="dc-val">${base.toFixed(1)}</strong><span class="dc-unit">${unit}</span><span class="dc-badge ok">ok</span></div>` +
          `<div class="dc-meter"><span class="dc-fill" style="width:${30 + ((i * 19) % 55)}%"></span></div>` +
        `</div>`;
      const pinBtn = el.querySelector('.dc-pin');
      pinBtn.addEventListener('click', () => {
        const next = pinBtn.getAttribute('aria-pressed') !== 'true';
        pinBtn.setAttribute('aria-pressed', String(next));
        el.classList.toggle('pinned', next);
        this.dirty.add(i);
        this.canvas.requestPaint?.();
      });
      frag.append(el);
      this.cards.push({
        i,
        el,
        name,
        unit,
        base,
        valEl: el.querySelector('.dc-val'),
        badgeEl: el.querySelector('.dc-badge'),
        fillEl: el.querySelector('.dc-fill'),
        stripEl: el.querySelector('.metric-strip'),
        x: 0,
        y: 0,
        w: 120,
        h: 72,
        stripY: 28,
      });
    }
    this.canvas.replaceChildren(frag);
  }

  _bindEvents() {
    this._onPaint = (e) => this._handlePaint(e);
    this.canvas.addEventListener('paint', this._onPaint);

    this.canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      this.stopAll();
      this.onLost?.(true);
    });
    this.canvas.addEventListener('contextrestored', () => {
      this.cold = true;
      this.onLost?.(false);
      this.canvas.requestPaint?.();
    });

    this._onPageHide = () => this.stopAll();
    window.addEventListener('pagehide', this._onPageHide);

    const onResize = (entries) => {
      const entry = entries[0];
      const box = entry.devicePixelContentBoxSize?.[0];
      if (box) {
        const cw = Math.max(200, Math.round(this.canvas.clientWidth));
        const ch = this._heightForWidth(cw);
        this._applySize(cw, ch, box.inlineSize / cw);
      } else {
        this.layout();
      }
    };
    this._ro = new ResizeObserver(onResize);
    try {
      this._ro.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      this._ro.observe(this.canvas);
    }
  }

  _heightForWidth(w) {
    if (w >= 680) return 352;
    if (w >= 460) return 432;
    return 472;
  }

  layout() {
    const cw = Math.max(200, Math.round(this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 360));
    const ch = this._heightForWidth(cw);
    this._applySize(cw, ch, window.devicePixelRatio || 1);
  }

  _applySize(cw, ch, rawDpr) {
    const zoom = this.canvas.currentCSSZoom || 1;
    let dpr = Math.max(1, rawDpr * zoom);
    // Stay comfortably under the 4 MP single-canvas budget even on ultra-high-DPR displays.
    const maxPx = 3_600_000;
    if (cw * ch * dpr * dpr > maxPx) {
      dpr = Math.sqrt(maxPx / (cw * ch));
    }
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));

    if (this.canvas.style.height !== `${ch}px`) {
      this.canvas.style.height = `${ch}px`;
    }
    const sizeChanged = this.canvas.width !== bw || this.canvas.height !== bh || this.cssW !== cw || this.cssH !== ch;
    this.cssW = cw;
    this.cssH = ch;
    this.dpr = bw / cw;

    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;

    const cols = cw >= 680 ? 6 : cw >= 460 ? 4 : 3;
    const rows = Math.ceil(CARD_COUNT / cols);
    const pad = 8;
    const gap = 6;
    const cardW = Math.floor((cw - pad * 2 - gap * (cols - 1)) / cols);
    const cardH = Math.floor((ch - pad * 2 - gap * (rows - 1)) / rows);

    for (let i = 0; i < CARD_COUNT; i++) {
      const c = this.cards[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      c.x = pad + col * (cardW + gap);
      c.y = pad + row * (cardH + gap);
      c.w = cardW;
      c.h = cardH;
      c.el.style.width = `${cardW}px`;
      c.el.style.height = `${cardH}px`;
    }
    // Measure stripY once after setting card sizes.
    for (let i = 0; i < CARD_COUNT; i++) {
      const c = this.cards[i];
      const sy = c.stripEl.offsetTop;
      c.stripY = sy > 0 && sy < c.h - 10 ? sy : Math.floor(c.h * 0.42);
    }

    if (sizeChanged) {
      this.cleanupCaches();
      this.cold = true;
      if (this.mode === 'full') this.canvas.requestPaint?.();
    }
  }

  _boardBg() {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return dark ? '#1a1816' : '#efece6';
  }

  cleanupCaches() {
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i]) {
        try { this.snaps[i].close(); } catch {}
        this.snaps[i] = null;
      }
    }
    for (let i = 0; i < this.churnPool.length; i++) {
      try { this.churnPool[i]?.close(); } catch {}
    }
    this.churnPool.length = 0;

    for (let i = 0; i < this.offscreenCaches.length; i++) {
      const entry = this.offscreenCaches[i];
      if (entry) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
        window.__gfx?.retire(entry.canvas);
        this.offscreenCaches[i] = null;
      }
    }
  }

  _ensureOffscreenCaches() {
    const dpr = this.dpr;
    for (let i = 0; i < CARD_COUNT; i++) {
      const c = this.cards[i];
      const bw = Math.max(1, Math.round(c.w * dpr));
      const bh = Math.max(1, Math.round(c.h * dpr));
      let entry = this.offscreenCaches[i];
      if (!entry) {
        // Plain non-drawable <canvas>, no willReadFrequently.
        const off = document.createElement('canvas');
        off.width = bw;
        off.height = bh;
        entry = { canvas: off, ctx: off.getContext('2d'), bw, bh };
        this.offscreenCaches[i] = entry;
      } else if (entry.bw !== bw || entry.bh !== bh) {
        entry.canvas.width = bw;
        entry.canvas.height = bh;
        entry.bw = bw;
        entry.bh = bh;
      }
    }
  }

  mutateCards(ratioPct) {
    this.tick++;
    const k = ratioPct <= 0 ? 0 : Math.max(1, Math.round((CARD_COUNT * ratioPct) / 100));
    const mutated = [];
    for (let j = 0; j < k; j++) {
      const idx = (this.cursor + j) % CARD_COUNT;
      const c = this.cards[idx];
      const wave = 0.5 + 0.5 * Math.sin(this.tick * 0.27 + idx * 1.13);
      const val = c.base * (0.65 + wave * 0.85);
      const pct = Math.max(8, Math.min(98, Math.round(14 + wave * 82)));
      c.valEl.textContent = val.toFixed(1);
      c.fillEl.style.width = `${pct}%`;
      if (pct > 82) {
        c.badgeEl.textContent = 'hot';
        c.badgeEl.className = 'dc-badge hot';
        c.fillEl.className = 'dc-fill hot';
      } else if (pct > 62) {
        c.badgeEl.textContent = 'load';
        c.badgeEl.className = 'dc-badge warn';
        c.fillEl.className = 'dc-fill warn';
      } else {
        c.badgeEl.textContent = 'ok';
        c.badgeEl.className = 'dc-badge ok';
        c.fillEl.className = 'dc-fill';
      }
      this.dirty.add(idx);
      mutated.push(idx);
    }
    this.cursor = (this.cursor + Math.max(1, k)) % CARD_COUNT;
    return mutated;
  }

  _handlePaint(e) {
    if (!this.ctx || !this.cards.length) return;
    const t0 = performance.now();
    const ctx = this.ctx;
    const dpr = this.dpr;
    const bg = this._boardBg();
    const changed = new Set(e.changedElements ?? []);
    if (this.collecting) {
      if (e.changedElements) this.changedEvents++;
      this.changedElementsSeen += changed.size;
    }

    this.lastDirtyDrawn = new Set(this.dirty);

    if (this.mode === 'full') {
      // #region strategy-full
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i];
        ctx.drawElementImage(c.el, c.x, c.y, c.w, c.h);
      }
      // #endregion strategy-full
    } else if (this.mode === 'snapshot') {
      // #region strategy-snapshot
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i];
        if (this.cold || !this.snaps[i] || changed.has(c.el) || this.dirty.has(i)) {
          // Close the replaced snapshot first so open snapshots stay <= 24.
          if (this.snaps[i]) {
            this.snaps[i].close();
            this.snaps[i] = null;
          }
          this.snaps[i] = this.canvas.captureElementImage(c.el);
        }
        ctx.drawElementImage(this.snaps[i], c.x, c.y, c.w, c.h);
      }
      // #endregion strategy-snapshot
    } else if (this.mode === 'offscreen') {
      // #region strategy-offscreen
      this._ensureOffscreenCaches();
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i];
        const cache = this.offscreenCaches[i];
        if (this.cold || changed.has(c.el) || this.dirty.has(i)) {
          ctx.drawElementImage(c.el, c.x, c.y, c.w, c.h);
          cache.ctx.clearRect(0, 0, cache.bw, cache.bh);
          cache.ctx.drawImage(
            this.canvas,
            Math.round(c.x * dpr), Math.round(c.y * dpr), cache.bw, cache.bh,
            0, 0, cache.bw, cache.bh,
          );
        } else {
          ctx.drawImage(cache.canvas, c.x, c.y, c.w, c.h);
        }
      }
      // #endregion strategy-offscreen
    } else if (this.mode === 'dirty-rect') {
      // #region strategy-dirty-rect
      if (this.cold) {
        ctx.reset();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
        for (let i = 0; i < this.cards.length; i++) {
          const c = this.cards[i];
          ctx.drawElementImage(c.el, c.x, c.y, c.w, c.h);
        }
      } else if (this.dirty.size > 0 || changed.size > 0) {
        for (let i = 0; i < this.cards.length; i++) {
          const c = this.cards[i];
          if (!this.dirty.has(i) && !changed.has(c.el)) continue;
          const sx = 0;
          const sy = c.stripY;
          const sw = c.w;
          const sh = c.h - sy;
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.beginPath();
          ctx.rect(c.x + sx, c.y + sy, sw, sh);
          ctx.clip();
          ctx.fillStyle = bg;
          ctx.fillRect(c.x + sx, c.y + sy, sw, sh);
          safeDraw9(ctx, c.el, sx, sy, sw, sh, c.x + sx, c.y + sy, sw, sh);
          ctx.restore();
        }
      }
      // #endregion strategy-dirty-rect
    } else if (this.mode === 'churn' && this.churnSpec) {
      // #region churn-test
      const { capturesPerFrame, batchSize } = this.churnSpec;
      if (this.cold) {
        ctx.reset();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
        for (let i = 0; i < this.cards.length; i++) {
          const c = this.cards[i];
          ctx.drawElementImage(c.el, c.x, c.y, c.w, c.h);
        }
      } else {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        let capMs = 0;
        const targets = [...this.dirty];
        if (capturesPerFrame === 0) {
          for (const idx of targets) {
            const c = this.cards[idx];
            ctx.fillStyle = bg;
            ctx.fillRect(c.x, c.y, c.w, c.h);
            ctx.drawElementImage(c.el, c.x, c.y, c.w, c.h);
          }
        } else {
          for (let j = 0; j < capturesPerFrame; j++) {
            const idx = targets[j % Math.max(1, targets.length)] ?? (this.tick + j) % CARD_COUNT;
            const c = this.cards[idx];
            const tc0 = performance.now();
            const img = this.canvas.captureElementImage(c.el);
            capMs += performance.now() - tc0;
            ctx.fillStyle = bg;
            ctx.fillRect(c.x, c.y, c.w, c.h);
            ctx.drawElementImage(img, c.x, c.y, c.w, c.h);
            const tc1 = performance.now();
            if (batchSize <= 1) {
              img.close();
            } else {
              this.churnPool.push(img);
              if (this.churnPool.length >= batchSize) {
                for (let k = 0; k < this.churnPool.length; k++) this.churnPool[k].close();
                this.churnPool.length = 0;
              }
            }
            capMs += performance.now() - tc1;
          }
        }
        ctx.restore();
        if (this.collecting) this.captureCloseTimes.push(capMs);
      }
      // #endregion churn-test
    }

    if (this.highlightDirty && this.lastDirtyDrawn.size > 0 && this.mode !== 'dirty-rect') {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#d2491f';
      ctx.lineWidth = 1.5;
      for (const idx of this.lastDirtyDrawn) {
        const c = this.cards[idx];
        ctx.strokeRect(c.x + 0.75, c.y + 0.75, c.w - 1.5, c.h - 1.5);
      }
      ctx.restore();
    }

    this.cold = false;
    this.dirty.clear();

    const elapsed = performance.now() - t0;
    if (this.collecting) {
      this.paintTimes.push(elapsed);
      const s = gfxSnapshots();
      if (s.open > this.peakOpenInRun) this.peakOpenInRun = s.open;
      const m = gfxMemoryMB();
      if (m.mb > this.peakMBInRun) this.peakMBInRun = m.mb;
      if (m.canvases > this.canvasesInRun) this.canvasesInRun = m.canvases;
    }
  }

  drawInitial() {
    this.cleanupCaches();
    this.mode = 'full';
    this.cold = true;
    this.dirty.clear();
    this.canvas.requestPaint?.();
  }

  startLive(strategy, dirtyPct) {
    if (this.busy) return;
    this.stopLive();
    this.cleanupCaches();
    this.mode = strategy;
    this.cold = true;
    this.highlightDirty = true;
    this.liveRunning = true;

    let last = 0;
    let lastHud = performance.now();
    const deltas = [];
    this.collecting = true;
    this.paintTimes = [];

    const step = (t) => {
      if (!this.liveRunning) return;
      this.liveRaf = requestAnimationFrame(step);
      if (last) deltas.push(t - last);
      last = t;
      this.mutateCards(dirtyPct);
      this.canvas.requestPaint?.();
      if (t - lastHud >= 280) {
        lastHud = t;
        const recent = deltas.slice(-30);
        const paints = this.paintTimes.slice(-30);
        const p50 = percentile(recent, 0.5);
        const p95 = percentile(recent, 0.95);
        const pMean = mean(paints);
        this.onMetrics?.({
          strategy,
          dirtyPct,
          rafP50: p50,
          rafP95: p95,
          paintMean: pMean,
          snapshots: gfxSnapshots(),
          memory: gfxMemoryMB(),
        });
      }
    };
    this.canvas.requestPaint?.();
    this.liveRaf = requestAnimationFrame(step);
  }

  stopLive() {
    this.liveRunning = false;
    this.collecting = false;
    this.highlightDirty = false;
    if (this.liveRaf) {
      cancelAnimationFrame(this.liveRaf);
      this.liveRaf = 0;
    }
    this.cleanupCaches();
    this.mode = 'full';
    this.cold = true;
    this.canvas.requestPaint?.();
  }

  abort() {
    this.aborted = true;
    this.stopLive();
  }

  stopAll() {
    this.aborted = true;
    this.stopLive();
    this.cleanupCaches();
  }

  async runCell({ strategy, dirtyPct, warmupMs = 280, measureMs = 1200 }) {
    this.stopLive();
    this.aborted = false;
    this.busy = true;
    this.cleanupCaches();
    this.mode = strategy;
    this.cold = true;
    this.highlightDirty = false;
    this.dirty.clear();

    const loaf = startLoafObserver();
    const snapBefore = gfxSnapshots();
    const rafDeltas = [];

    try {
      // Cold paint first.
      this.canvas.requestPaint?.();
      await raf();

      // Warmup loop.
      const warmEnd = performance.now() + warmupMs;
      while (!this.aborted && performance.now() < warmEnd) {
        this.mutateCards(dirtyPct);
        this.canvas.requestPaint?.();
        await raf();
      }

      // Measurement window.
      loaf.entries.length = 0;
      this.paintTimes = [];
      this.captureCloseTimes = [];
      this.changedEvents = 0;
      this.changedElementsSeen = 0;
      this.peakOpenInRun = gfxSnapshots().open;
      const startMem = gfxMemoryMB();
      this.peakMBInRun = startMem.mb;
      this.canvasesInRun = startMem.canvases;
      this.collecting = true;

      let lastT = await raf();
      const endAt = performance.now() + measureMs;
      while (!this.aborted && performance.now() < endAt) {
        this.mutateCards(dirtyPct);
        this.canvas.requestPaint?.();
        const now = await raf();
        rafDeltas.push(now - lastT);
        lastT = now;
      }

      // Allow any final LoAF entry to flush.
      this.collecting = false;
      await sleep(60);

      const snapMid = gfxSnapshots();
      const memMid = gfxMemoryMB();
      const loafSummary = summariseLoaf(loaf.entries, loaf.supported);

      // Tear down caches right away and verify openSnapshots returns to 0.
      this.cleanupCaches();
      const snapAfter = gfxSnapshots();
      const memAfter = gfxMemoryMB();

      const meanDelta = mean(rafDeltas);
      return {
        strategy,
        dirtyPct,
        aborted: this.aborted,
        frames: rafDeltas.length,
        paints: this.paintTimes.length,
        fps: meanDelta ? 1000 / meanDelta : 0,
        rafP50: percentile(rafDeltas, 0.5),
        rafP95: percentile(rafDeltas, 0.95),
        paintMean: mean(this.paintTimes),
        paintP95: percentile(this.paintTimes, 0.95),
        loaf: loafSummary,
        changedEvents: this.changedEvents,
        changedElementsSeen: this.changedElementsSeen,
        snapshots: {
          madeDelta: snapMid.made - snapBefore.made,
          peakOpen: Math.max(this.peakOpenInRun, snapMid.open),
          endOpen: snapAfter.open,
        },
        memory: {
          peakMB: Math.max(this.peakMBInRun, memMid.mb),
          afterMB: memAfter.mb,
          canvases: Math.max(this.canvasesInRun, memMid.canvases),
        },
      };
    } finally {
      this.collecting = false;
      loaf.stop();
      this.cleanupCaches();
      this.mode = 'full';
      this.cold = true;
      this.busy = false;
      this.canvas.requestPaint?.();
    }
  }

  async runChurnMode({ modeId, warmupMs = 280, measureMs = 2000 }) {
    const spec = CHURN_MODES.find((m) => m.id === modeId);
    if (!spec) throw new Error(`Unknown churn mode: ${modeId}`);

    this.stopLive();
    this.aborted = false;
    this.busy = true;
    this.cleanupCaches();
    this.mode = 'churn';
    this.churnSpec = spec;
    this.cold = true;
    this.highlightDirty = false;
    this.dirty.clear();

    const loaf = startLoafObserver();
    const snapBefore = gfxSnapshots();
    const rafDeltas = [];
    const mutatePct = spec.capturesPerFrame > 1 ? Math.round((spec.capturesPerFrame / CARD_COUNT) * 100) : 5;

    try {
      this.canvas.requestPaint?.();
      await raf();

      const warmEnd = performance.now() + warmupMs;
      while (!this.aborted && performance.now() < warmEnd) {
        this.mutateCards(mutatePct);
        this.canvas.requestPaint?.();
        await raf();
      }

      // Drain any warmup snapshots before timing.
      for (let k = 0; k < this.churnPool.length; k++) this.churnPool[k].close();
      this.churnPool.length = 0;

      loaf.entries.length = 0;
      this.paintTimes = [];
      this.captureCloseTimes = [];
      this.peakOpenInRun = gfxSnapshots().open;
      const startMem = gfxMemoryMB();
      this.peakMBInRun = startMem.mb;
      this.canvasesInRun = startMem.canvases;
      const madeStart = gfxSnapshots().made;
      this.collecting = true;

      let lastT = await raf();
      const endAt = performance.now() + measureMs;
      while (!this.aborted && performance.now() < endAt) {
        this.mutateCards(mutatePct);
        this.canvas.requestPaint?.();
        const now = await raf();
        rafDeltas.push(now - lastT);
        lastT = now;
      }

      this.collecting = false;
      await sleep(60);

      const snapMid = gfxSnapshots();
      const memMid = gfxMemoryMB();
      const loafSummary = summariseLoaf(loaf.entries, loaf.supported);

      // Always close every snapshot in the pool.
      this.cleanupCaches();
      const snapAfter = gfxSnapshots();
      const memAfter = gfxMemoryMB();
      const meanDelta = mean(rafDeltas);

      return {
        modeId,
        label: spec.label,
        rate: spec.rate,
        aborted: this.aborted,
        frames: rafDeltas.length,
        paints: this.paintTimes.length,
        fps: meanDelta ? 1000 / meanDelta : 0,
        rafP50: percentile(rafDeltas, 0.5),
        rafP95: percentile(rafDeltas, 0.95),
        paintMean: mean(this.paintTimes),
        paintP95: percentile(this.paintTimes, 0.95),
        captureCloseMean: mean(this.captureCloseTimes),
        loaf: loafSummary,
        snapshots: {
          madeDelta: snapMid.made - madeStart,
          totalSinceBefore: snapMid.made - snapBefore.made,
          peakOpen: Math.max(this.peakOpenInRun, snapMid.open),
          endOpen: snapAfter.open,
        },
        memory: {
          peakMB: Math.max(this.peakMBInRun, memMid.mb),
          afterMB: memAfter.mb,
          canvases: Math.max(this.canvasesInRun, memMid.canvases),
        },
      };
    } finally {
      this.collecting = false;
      loaf.stop();
      this.churnSpec = null;
      this.cleanupCaches();
      this.mode = 'full';
      this.cold = true;
      this.busy = false;
      this.canvas.requestPaint?.();
    }
  }
}

export function fmtMs(v, digits = 1) {
  return v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(digits)} ms`;
}

export function formatMarkdown({ part1 = [], part2 = [], meta = {} }) {
  const lines = [
    `## /perf-caching/ benchmark run`,
    ``,
    `- Date: ${meta.date || new Date().toISOString().slice(0, 10)}`,
    `- Browser: ${meta.ua || navigator.userAgent}`,
    `- Viewport: ${meta.viewport || `${innerWidth}x${innerHeight}`}, DPR: ${meta.dpr ?? devicePixelRatio}, cores: ${meta.cores ?? navigator.hardwareConcurrency ?? '?'}`,
    ``,
  ];

  if (part1.length) {
    lines.push(
      `### Part 1: 24-card partial-update strategies`,
      ``,
      `| Strategy | Dirty | rAF p50 | rAF p95 | Paint JS | LoAF (>50 ms / post-main) | Snapshots (made / peak / end) | Canvas MB |`,
      `|---|---:|---:|---:|---:|---|---:|---:|`,
    );
    for (const r of part1) {
      const loafText = !r.loaf.supported
        ? 'unsupported'
        : r.loaf.count
          ? `${r.loaf.count} / ${fmtMs(r.loaf.afterMean)}`
          : '0';
      lines.push(
        `| ${r.strategy} | ${r.dirtyPct}% | ${fmtMs(r.rafP50)} | ${fmtMs(r.rafP95)} | ${fmtMs(r.paintMean, 2)} | ${loafText} | ${r.snapshots.madeDelta} / ${r.snapshots.peakOpen} / ${r.snapshots.endOpen} | ${r.memory.peakMB.toFixed(1)} |`,
      );
    }
    lines.push('');
  }

  if (part2.length) {
    lines.push(
      `### Part 2: ElementImage snapshot churn`,
      ``,
      `| Mode | rAF p50 | rAF p95 | Paint JS | Capture+close | LoAF (>50 ms / post-main) | Snapshots (made / peak / end) | Canvas MB |`,
      `|---|---:|---:|---:|---:|---|---:|---:|`,
    );
    for (const r of part2) {
      const loafText = !r.loaf.supported
        ? 'unsupported'
        : r.loaf.count
          ? `${r.loaf.count} / ${fmtMs(r.loaf.afterMean)}`
          : '0';
      lines.push(
        `| ${r.label} | ${fmtMs(r.rafP50)} | ${fmtMs(r.rafP95)} | ${fmtMs(r.paintMean, 2)} | ${fmtMs(r.captureCloseMean, 2)} | ${loafText} | ${r.snapshots.madeDelta} / ${r.snapshots.peakOpen} / ${r.snapshots.endOpen} | ${r.memory.peakMB.toFixed(1)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function reportSweep({ part1 = [], part2 = [], meta = {} }) {
  if (!window.__gfx?.report) return false;
  const compact1 = part1.map((r) => ({
    s: r.strategy,
    d: r.dirtyPct,
    p50: r.rafP50 != null ? +r.rafP50.toFixed(1) : null,
    p95: r.rafP95 != null ? +r.rafP95.toFixed(1) : null,
    js: r.paintMean != null ? +r.paintMean.toFixed(2) : null,
    loaf: r.loaf.count,
    after: r.loaf.afterMean != null ? +r.loaf.afterMean.toFixed(1) : null,
    peak: r.snapshots.peakOpen,
    end: r.snapshots.endOpen,
    mb: +r.memory.peakMB.toFixed(1),
  }));
  const compact2 = part2.map((r) => ({
    m: r.modeId,
    p50: r.rafP50 != null ? +r.rafP50.toFixed(1) : null,
    p95: r.rafP95 != null ? +r.rafP95.toFixed(1) : null,
    js: r.paintMean != null ? +r.paintMean.toFixed(2) : null,
    cap: r.captureCloseMean != null ? +r.captureCloseMean.toFixed(2) : null,
    loaf: r.loaf.count,
    after: r.loaf.afterMean != null ? +r.loaf.afterMean.toFixed(1) : null,
    made: r.snapshots.madeDelta,
    peak: r.snapshots.peakOpen,
    end: r.snapshots.endOpen,
    mb: +r.memory.peakMB.toFixed(1),
  }));
  const msg = `perf-caching sweep: ${compact1.length} partial cells, ${compact2.length} churn modes, dpr=${meta.dpr ?? devicePixelRatio}`;
  window.__gfx.report('perf-caching', msg, { meta, part1: compact1, part2: compact2 }, true);
  return true;
}
