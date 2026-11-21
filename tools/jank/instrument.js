// Injected into every page before its own scripts (see check.mjs). Records what
// a person would see as "the page jumping about": layout shifts, scrolling that
// nobody asked for, focus moving, visible canvases being resized (which clears
// them) and big overlays. Everything lands in window.__jank.
(() => {
  // Count WebGL contexts the way Chrome on Android does (/shared/context-guard.js reads this).
  window.__gfxLimit = 8;
  if (window.top !== window || window.__jank) return;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return el === document ? 'document' : el === window ? 'window' : String(el && el.nodeName);
    let s = el.localName;
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  // First stack frame that is page code, as "file:line".
  const caller = () => {
    const lines = (new Error().stack || '').split('\n').slice(3);
    for (const l of lines) {
      const m = l.match(/(https?:\/\/[^\s)]+):(\d+):\d+/);
      if (m) return new URL(m[1]).pathname + ':' + m[2];
    }
    return '?';
  };
  const J = (window.__jank = {
    shifts: [], cls: 0,
    scrollCalls: [], scrollEvents: 0, scrollTravel: 0, scrollMaxFromStart: 0,
    focusCalls: [], focusEvents: [],
    canvasResizes: [], longTasks: [], lastInput: -1e9, phase: 'load',
    marks: [],
  });
  // nav.js keeps the page body transparent until the page has built itself.
  // Nothing that moves before then can be seen, so it is not counted.
  let revealedAt = null;
  const held = () => !!document.documentElement && document.documentElement.classList.contains('page-loading');
  new MutationObserver(() => {
    if (held()) J.sawHold = true;
    else if (J.sawHold && revealedAt === null) revealedAt = performance.now();
  }).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true });
  const userRecently = () => performance.now() - J.lastInput < 1000;
  for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'wheel']) {
    addEventListener(type, (e) => { if (e.isTrusted) J.lastInput = performance.now(); }, { capture: true, passive: true });
  }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        if (J.sawHold && (revealedAt === null || e.startTime < revealedAt)) continue;
        J.cls += e.value;
        J.shifts.push({
          t: Math.round(e.startTime), phase: J.phase, value: +e.value.toFixed(4),
          sources: (e.sources || []).slice(0, 4).map((s) => ({
            node: desc(s.node),
            from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round),
            to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round),
          })),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) J.longTasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), phase: J.phase });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* older browser */ }

  // Scrolling. With no input, every scroll is the page's own doing.
  let lastY = 0, startY = null;
  addEventListener('scroll', () => {
    if (userRecently()) { lastY = scrollY; return; }
    if (startY === null) startY = 0;
    J.scrollEvents++;
    J.scrollTravel += Math.abs(scrollY - lastY);
    J.scrollMaxFromStart = Math.max(J.scrollMaxFromStart, Math.abs(scrollY - startY));
    lastY = scrollY;
  }, { passive: true });

  const wrap = (proto, name, kind, note) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      if (!userRecently()) {
        const rec = { t: now(), phase: J.phase, fn: name, on: desc(this), by: caller() };
        if (note) Object.assign(rec, note.call(this, args));
        (kind === 'scroll' ? J.scrollCalls : J.focusCalls).push(rec);
      }
      return orig.apply(this, args);
    };
  };
  wrap(Element.prototype, 'scrollIntoView', 'scroll');
  wrap(Element.prototype, 'scrollIntoViewIfNeeded', 'scroll');
  for (const fn of ['scrollTo', 'scrollBy', 'scroll']) {
    wrap(window, fn, 'scroll');
    wrap(Element.prototype, fn, 'scroll', function () { return { inner: this !== document.documentElement && this !== document.body }; });
  }
  wrap(HTMLElement.prototype, 'focus', 'focus', (args) => ({ preventScroll: !!(args[0] && args[0].preventScroll) }));
  wrap(SVGElement.prototype, 'focus', 'focus', (args) => ({ preventScroll: !!(args[0] && args[0].preventScroll) }));
  addEventListener('focusin', (e) => {
    if (userRecently()) return;
    J.focusEvents.push({ t: now(), phase: J.phase, on: desc(e.target) });
  }, true);

  // Canvas backing-store writes. Assigning width or height clears the canvas
  // even when the value does not change.
  const canvases = new Map();
  for (const prop of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    Object.defineProperty(HTMLCanvasElement.prototype, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(v) {
        if (this.isConnected) {
          let c = canvases.get(this);
          if (!c) canvases.set(this, (c = { el: this, writes: 0, same: 0, phases: {}, by: {}, first: now(), last: 0 }));
          const old = d.get.call(this);
          c.writes++;
          if (old === Math.floor(+v)) c.same++;
          c.phases[J.phase] = (c.phases[J.phase] || 0) + 1;
          const by = caller();
          c.by[by] = (c.by[by] || 0) + 1;
          c.last = now();
        }
        d.set.call(this, v);
      },
    });
  }

  // Called from the harness.
  J.inViewport = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) !== false;
  };
  J.collect = () => {
    J.canvasResizes = [...canvases.values()].map((c) => ({
      canvas: desc(c.el), host: desc(c.el.getRootNode().host || c.el.parentElement), writes: c.writes, same: c.same,
      phases: c.phases, by: c.by, first: c.first, last: c.last, connected: c.el.isConnected, visible: J.inViewport(c.el),
    }));
    J.revealedAt = revealedAt === null ? null : Math.round(revealedAt);
    // Canvas contexts, counted by /shared/context-guard.js.
    const g = window.__gfx;
    J.gfx = g ? { peak: g.peak, noted: g.noted, released: g.released, made: g.made.length, summary: g.summary() } : null;
    const { collect, inViewport, sample, ...data } = J;
    return data;
  };
  // One cheap look at the page, taken by the harness alongside each screenshot.
  const canvasKeys = new WeakMap();
  let canvasKeyCount = 0;
  J.sample = () => {
    const out = { y: Math.round(scrollY), vw: innerWidth, vh: innerHeight, active: desc(document.activeElement), h: document.documentElement.scrollHeight, canvases: [], overlay: null };
    const walk = (root) => {
      for (const c of root.querySelectorAll('canvas')) {
        if (!J.inViewport(c)) continue;
        // A fixture parked at 2% opacity cannot be seen blanking; skip anything that faint.
        let alpha = 1;
        for (let n = c; n && alpha > 0.1; n = n.parentElement || n.getRootNode().host) alpha *= +getComputedStyle(n).opacity;
        if (alpha <= 0.1) continue;
        const r = c.getBoundingClientRect();
        // A canvas mostly below or above the screen shows only an edge of itself, and an edge is often one flat
        // colour: that is not the canvas going blank. Only canvases at least half on screen are judged.
        const seen = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        if (seen < r.width * r.height * 0.5) continue;
        // Many canvases can share a description (a table with one per row), so each also gets a key of its own:
        // "had a picture, now flat" must be about one canvas, not two that look alike in the log.
        if (!canvasKeys.has(c)) canvasKeys.set(c, ++canvasKeyCount);
        out.canvases.push({ id: desc(c) + '@' + desc(c.getRootNode().host || c.parentElement), key: canvasKeys.get(c), x: r.x, y: r.y, w: r.width, h: r.height });
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    for (const el of document.elementsFromPoint(innerWidth / 2, innerHeight / 2)) {
      if (el.closest?.('#site-nav')) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > innerWidth * innerHeight * 0.4) { out.overlay = desc(el); break; }
    }
    return out;
  };
})();
