// PerformanceObserver, ReportingObserver and window.__gfx telemetry wrapper for /crashes/suite/.
// Follows the same observer patterns as /canvas-skin/page.js, /perf/latency.js and /shared/context-guard.js.

// #region observers
export function createSuiteObservers(onEvent) {
  const supported = new Set(
    typeof PerformanceObserver !== 'undefined' && Array.isArray(PerformanceObserver.supportedEntryTypes)
      ? PerformanceObserver.supportedEntryTypes
      : []
  );

  const state = {
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
      reportsFiled: 0,
    },
    events: [], // chronological log of notable observer / crash / report entries
  };

  let activeWindow = null;

  const pushEvent = (kind, message, data = null) => {
    const entry = { at: new Date().toISOString().slice(11, 19), kind, message, data };
    state.events.unshift(entry);
    if (state.events.length > 80) state.events.pop();
    onEvent?.(state, entry);
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
    if (v >= 0.01) pushEvent('cls', `Layout shift: +${v.toFixed(4)}`, { value: v });
  });

  observePerf('event', (e) => {
    const dur = Math.round(e.duration || 0);
    if (dur > state.totals.worstEventMs) state.totals.worstEventMs = dur;
    if (activeWindow && dur > activeWindow.worstEventMs) activeWindow.worstEventMs = dur;
  }, { durationThreshold: 16 });

  if (typeof ReportingObserver !== 'undefined') {
    try {
      const ro = new ReportingObserver((list) => {
        for (const r of list) {
          state.totals.browserReports++;
          if (activeWindow) activeWindow.browserReports++;
          const detail = r.body?.message || r.body?.reason || r.body?.id || JSON.stringify(r.body || {});
          pushEvent('reporting', `ReportingObserver [${r.type}]: ${String(detail).slice(0, 140)}`, { type: r.type, url: r.url });
        }
      }, { types: ['crash', 'intervention', 'deprecation'], buffered: true });
      ro.observe();
    } catch {}
  }

  // Watch window.__gfx lost events passively via polling on snapshot/endWindow
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
      newLosses: Math.max(0, g1.lost - w.lostBefore),
      memMB: g1.memMB,
      openSnapshots: g1.openSnapshots,
    };
  }

  function recordRunnerReports(rawJson) {
    try {
      const list = JSON.parse(rawJson || '[]');
      for (const r of list) {
        state.totals.browserReports++;
        pushEvent('reporting', `Runner ReportingObserver [${r.type}]: ${r.detail}`, r);
      }
    } catch {}
  }

  function recordCrash(caseId, title, detail) {
    state.totals.crashesDetected++;
    pushEvent('crash', `Crash detected in isolated runner on "${caseId}": ${detail}`, { caseId, title });
    try {
      if (window.__gfx?.report) {
        window.__gfx.report('canary-crash', `${caseId}: ${detail}`, { caseId, title, ua: navigator.userAgent });
        state.totals.reportsFiled++;
      }
    } catch {}
  }

  function fileSummaryReport(message, body) {
    pushEvent('report', `Filed /api/reports [canary-suite]: ${message}`, body);
    try {
      if (window.__gfx?.report) {
        window.__gfx.report('canary-suite', message, { ...body, observers: state.totals, gfx: gfxSnapshot() });
        state.totals.reportsFiled++;
      }
    } catch {}
    onEvent?.(state, null);
  }

  return {
    state,
    gfxSnapshot,
    beginWindow,
    endWindow,
    recordRunnerReports,
    recordCrash,
    fileSummaryReport,
    pushEvent,
  };
}
// #endregion observers
