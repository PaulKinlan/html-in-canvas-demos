// PerformanceObserver, ReportingObserver, context-loss, console trace and window.__gfx telemetry wrapper for /crashes/suite/.

// #region observers
const EXPECTED_LOSS_IDS = new Set(['lose-context-stress', 'ninth-webgl-context']);

export function createSuiteObservers(suiteId, onEvent) {
  const supported = new Set(
    typeof PerformanceObserver !== 'undefined' && Array.isArray(PerformanceObserver.supportedEntryTypes)
      ? PerformanceObserver.supportedEntryTypes
      : []
  );

  const state = {
    suiteId,
    supported: {
      loaf: supported.has('long-animation-frame'),
      longtask: supported.has('longtask'),
      layoutShift: supported.has('layout-shift'),
      event: supported.has('event'),
      reporting: typeof ReportingObserver !== 'undefined',
    },
    totals: {
      loafCount: 0,
      loafMaxMs: 0,
      loafBlockingMs: 0,
      loafScript: '',
      longTasks: 0,
      longTaskMaxMs: 0,
      cls: 0,
      worstEventMs: 0,
      browserReports: 0,
      crashesDetected: 0,
      contextLosses: 0,
      unexpectedLosses: 0,
      errors: 0,
      reportsFiled: 0,
    },
    byCase: new Map(), // caseId -> { crashes, losses, errors, reports }
    demoResults: new Map(), // demoId -> { status, summary, metrics }
    events: [], // notable observer/crash/loss events
    trace: [], // full chronological console + runner debug log for pasting
  };

  let activeWindow = null;
  let lastRunnerSeq = 0;

  const ts = () => new Date().toISOString().slice(11, 23);

  const ensureCase = (id) => {
    if (!id) return null;
    let c = state.byCase.get(id);
    if (!c) {
      c = { crashes: 0, losses: 0, errors: 0, reports: 0 };
      state.byCase.set(id, c);
    }
    return c;
  };

  const logTrace = (level, tag, message) => {
    const line = `${ts()} [${tag}] ${message}`;
    state.trace.push(line);
    if (state.trace.length > 400) state.trace.shift();
    if (level === 'error') console.error(`[canary-suite] ${line}`);
    else if (level === 'warn') console.warn(`[canary-suite] ${line}`);
    else console.log(`[canary-suite] ${line}`);
  };

  const pushEvent = (kind, message, data = null, level = 'info') => {
    const at = ts();
    const entry = { at, kind, message, data };
    state.events.unshift(entry);
    if (state.events.length > 160) state.events.pop();
    logTrace(level, kind, message);
    onEvent?.(state, entry);
  };

  const fileApiReport = (type, message, body = {}) => {
    try {
      if (window.__gfx?.report) {
        window.__gfx.report(type, message, { ...body, suiteId, ua: navigator.userAgent });
        state.totals.reportsFiled++;
      }
    } catch {}
  };

  const observePerf = (type, handler, extra = {}) => {
    if (!supported.has(type)) return;
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) handler(e);
      });
      po.observe({ type, ...extra });
    } catch {}
  };

  observePerf('long-animation-frame', (e) => {
    const dur = Math.round(e.duration || 0);
    const blk = Math.round(e.blockingDuration || 0);
    const topScript = e.scripts?.reduce((a, s) => (s.duration > (a?.duration ?? 0) ? s : a), null);
    const scriptLabel = topScript ? `${(topScript.invoker || topScript.sourceURL || 'script').slice(0, 48)} (${Math.round(topScript.duration)} ms)` : '';

    state.totals.loafCount++;
    state.totals.loafBlockingMs += blk;
    if (dur > state.totals.loafMaxMs) {
      state.totals.loafMaxMs = dur;
      state.totals.loafScript = scriptLabel;
    }
    if (activeWindow) {
      activeWindow.loafCount++;
      activeWindow.loafBlockingMs += blk;
      if (dur > activeWindow.loafMaxMs) {
        activeWindow.loafMaxMs = dur;
        activeWindow.loafScript = scriptLabel;
      }
    }
    pushEvent('loaf', `Long animation frame: ${dur} ms (blocking ${blk} ms)${scriptLabel ? `: ${scriptLabel}` : ''}`, { dur, blk, scriptLabel });
  });

  observePerf('longtask', (e) => {
    const dur = Math.round(e.duration || 0);
    state.totals.longTasks++;
    if (dur > state.totals.longTaskMaxMs) state.totals.longTaskMaxMs = dur;
    if (activeWindow) {
      activeWindow.longTasks++;
      if (dur > activeWindow.longTaskMaxMs) activeWindow.longTaskMaxMs = dur;
    }
  });

  observePerf('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    const v = e.value || 0;
    state.totals.cls += v;
    if (activeWindow) activeWindow.cls += v;
    if (v >= 0.01) pushEvent('cls', `Layout shift: +${v.toFixed(4)}`, { value: v }, 'warn');
  });

  observePerf('event', (e) => {
    const dur = Math.round(e.duration || 0);
    if (dur > state.totals.worstEventMs) state.totals.worstEventMs = dur;
    if (activeWindow && dur > activeWindow.worstEventMs) activeWindow.worstEventMs = dur;
  }, { durationThreshold: 16 });

  if (typeof ReportingObserver !== 'undefined') {
    const onReports = (list) => {
      for (const r of list) {
        state.totals.browserReports++;
        if (activeWindow) activeWindow.browserReports++;
        const detail = r.body?.message || r.body?.reason || r.body?.id || JSON.stringify(r.body || {});
        pushEvent('reporting', `ReportingObserver [${r.type}]: ${String(detail).slice(0, 140)}`, { type: r.type, url: r.url }, 'warn');
      }
    };
    try {
      new ReportingObserver(onReports, { types: ['crash', 'intervention', 'deprecation', 'permissions-policy-violation'], buffered: true }).observe();
    } catch {
      try {
        new ReportingObserver(onReports, { types: ['crash', 'intervention', 'deprecation'], buffered: true }).observe();
      } catch {}
    }
  }

  document.addEventListener('contextlost', () => {
    state.totals.contextLosses++;
    state.totals.unexpectedLosses++;
    if (activeWindow) activeWindow.pageLosses++;
    pushEvent('loss', `2D contextlost on suite page (${activeWindow?.label || 'idle'})`, null, 'warn');
    fileApiReport('canary-loss', `suite 2D contextlost during ${activeWindow?.label || 'idle'}`, { where: activeWindow?.label || 'idle' });
  }, true);

  document.addEventListener('webglcontextlost', () => {
    state.totals.contextLosses++;
    if (activeWindow) activeWindow.pageLosses++;
    pushEvent('loss', `webglcontextlost on suite page (${activeWindow?.label || 'idle'})`, null, 'warn');
  }, true);

  window.addEventListener('error', (ev) => {
    state.totals.errors++;
    pushEvent('error', `Uncaught error on suite page: ${ev.message || 'error'}`, null, 'error');
  });

  window.addEventListener('unhandledrejection', (ev) => {
    state.totals.errors++;
    pushEvent('error', `Unhandled rejection on suite page: ${ev.reason?.message || String(ev.reason || '')}`, null, 'error');
  });

  const gfxSnapshot = () => {
    const g = window.__gfx;
    const mem = g?.memory?.();
    return {
      lost: g?.lost?.length ?? 0,
      memMB: mem?.bytes != null ? +(mem.bytes / 1e6).toFixed(1) : (mem?.mb != null ? +mem.mb.toFixed(1) : 0),
      openSnapshots: g?.snapshots?.open ?? 0,
      peakSnapshots: g?.snapshots?.peak ?? 0,
      activeWebGL: g?.active?.() ?? 0,
      noSizeDraws: g?.draws?.noSize ?? 0,
    };
  };

  function beginWindow(label) {
    const g0 = gfxSnapshot();
    activeWindow = {
      label,
      t0: performance.now(),
      loafCount: 0,
      loafMaxMs: 0,
      loafBlockingMs: 0,
      loafScript: '',
      longTasks: 0,
      longTaskMaxMs: 0,
      cls: 0,
      worstEventMs: 0,
      browserReports: 0,
      pageLosses: 0,
      lostBefore: g0.lost,
    };
  }

  function endWindow() {
    if (!activeWindow) return null;
    const w = activeWindow;
    activeWindow = null;
    const g1 = gfxSnapshot();
    return {
      label: w.label,
      durationMs: Math.round(performance.now() - w.t0),
      loafCount: w.loafCount,
      loafMaxMs: w.loafMaxMs,
      loafBlockingMs: w.loafBlockingMs,
      loafScript: w.loafScript,
      longTasks: w.longTasks,
      longTaskMaxMs: w.longTaskMaxMs,
      cls: Number(w.cls.toFixed(4)),
      worstEventMs: w.worstEventMs,
      browserReports: w.browserReports,
      newLosses: Math.max(w.pageLosses, g1.lost - w.lostBefore),
      memMB: g1.memMB,
      openSnapshots: g1.openSnapshots,
    };
  }

  function ingestRunnerEvents(rawJson) {
    if (!rawJson) return 0;
    let list;
    try { list = JSON.parse(rawJson); } catch { return 0; }
    if (!Array.isArray(list)) return 0;
    let added = 0;
    for (const ev of list) {
      if ((ev.seq || 0) <= lastRunnerSeq) continue;
      if (ev.suiteId && ev.suiteId !== suiteId) continue;
      lastRunnerSeq = ev.seq || lastRunnerSeq + 1;
      added++;
      const c = ensureCase(ev.caseId);
      if (ev.kind === 'trace') {
        logTrace('info', `runner:${ev.caseId}`, ev.detail);
        onEvent?.(state, null);
      } else if (ev.kind === 'demo-done') {
        state.demoResults.set(ev.caseId, { status: ev.status || 'pass', summary: ev.detail, metrics: ev.metrics || {} });
        pushEvent('demo', `[${ev.caseId}] ${ev.status}: ${ev.detail}`, ev, ev.status === 'pass' ? 'info' : 'warn');
        if (ev.status !== 'pass') {
          fileApiReport('canary-demo', `${ev.caseId} (${ev.status}): ${ev.detail}`, { caseId: ev.caseId, status: ev.status, metrics: ev.metrics });
        }
      } else if (ev.kind === 'crash') {
        state.totals.crashesDetected++;
        if (c) c.crashes++;
        if (ev.caseId?.startsWith('demo-')) {
          state.demoResults.set(ev.caseId, { status: 'crashed', summary: ev.detail, metrics: {} });
        }
        pushEvent('crash', `[${ev.caseId}] ${ev.detail}`, ev, 'error');
        fileApiReport('canary-crash', `${ev.caseId}: ${ev.detail}`, { caseId: ev.caseId, source: 'runner-frame' });
      } else if (ev.kind === 'contextlost' || ev.kind === 'webglcontextlost') {
        const expected = EXPECTED_LOSS_IDS.has(ev.caseId);
        state.totals.contextLosses++;
        if (!expected) state.totals.unexpectedLosses++;
        if (c) c.losses++;
        pushEvent('loss', `[${ev.caseId}] ${ev.detail}${expected ? ' (expected)' : ''}`, ev, expected ? 'info' : 'warn');
        if (!expected) {
          fileApiReport('canary-loss', `${ev.caseId}: ${ev.detail}`, { caseId: ev.caseId, event: ev.kind });
        }
      } else if (ev.kind === 'error' || ev.kind === 'timeout') {
        state.totals.errors++;
        if (c) c.errors++;
        pushEvent('error', `[${ev.caseId}] ${ev.detail}`, ev, 'warn');
        fileApiReport('canary-error', `${ev.caseId}: ${ev.detail}`, { caseId: ev.caseId, kind: ev.kind });
      } else if (ev.kind === 'reporting') {
        state.totals.browserReports++;
        if (c) c.reports++;
        pushEvent('reporting', `[${ev.caseId}] ReportingObserver ${ev.detail}`, ev, 'warn');
      }
    }
    return added;
  }

  function resetRunnerCursor() {
    lastRunnerSeq = 0;
    state.byCase.clear();
  }

  function recordCrash(caseId, title, detail) {
    state.totals.crashesDetected++;
    const c = ensureCase(caseId);
    if (c) c.crashes++;
    if (caseId?.startsWith('demo-')) {
      state.demoResults.set(caseId, { status: 'crashed', summary: `Runner window died: ${detail}`, metrics: {} });
    }
    pushEvent('crash', `[${caseId}] Runner window died: ${detail}`, { caseId, title }, 'error');
    fileApiReport('canary-crash', `${caseId}: ${detail}`, { caseId, title, source: 'runner-heartbeat' });
  }

  function fileSummaryReport(message, body) {
    pushEvent('report', `Filed /api/reports [canary-suite]: ${message}`, body);
    fileApiReport('canary-suite', message, { ...body, observers: state.totals, gfx: gfxSnapshot() });
    onEvent?.(state, null);
  }

  function getDebugLog() {
    return [
      `=== Canary Suite Debug Log (${suiteId}) ===`,
      `UA: ${navigator.userAgent}`,
      `DPR: ${devicePixelRatio} | Time: ${new Date().toISOString()}`,
      `Totals: ${JSON.stringify(state.totals)}`,
      `GFX: ${JSON.stringify(gfxSnapshot())}`,
      '--- Trace ---',
      ...state.trace,
    ].join('\n');
  }

  return {
    state,
    gfxSnapshot,
    beginWindow,
    endWindow,
    ingestRunnerEvents,
    resetRunnerCursor,
    recordCrash,
    fileSummaryReport,
    pushEvent,
    logTrace,
    getDebugLog,
  };
}
// #endregion observers
