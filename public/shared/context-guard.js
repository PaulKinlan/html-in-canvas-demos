// Watches every canvas context a page makes, so a canvas that loses its
// context is never left as an empty box.
//
// /shared/nav.js loads this file before any page script, so no page needs to
// include it. It is a plain script with no imports.
//
// What it does:
//
//   1. Counts contexts. Chrome on Android keeps at most 8 WebGL contexts alive
//      in a tab (16 on desktop), frames included. Making one more takes the
//      oldest away ("Too many active WebGL contexts. Oldest context will be
//      lost."), and the oldest is usually the demo the reader is looking at.
//   2. Gives contexts back, only when the limit is about to be reached.
//      A WebGL canvas that was in the page and has been removed (a finished
//      check fixture) keeps counting towards the limit until it is garbage
//      collected. When one more context would reach the limit, those
//      canvases lose their context on purpose, so the browser does not take
//      one from a canvas that is on screen. See drop() for the conditions.
//   3. Redraws a 2D canvas when its context comes back (requestPaint()), so a
//      page whose drawing happens in a paint handler recovers with no code.
//   4. Puts a note with a Reload button over a canvas that is still lost, or
//      still on a lost WebGPU device, 1.5 seconds after the loss. A library
//      that recovers by itself replaces or restores the canvas inside that
//      time and no note appears.
//   5. Estimates the memory of every canvas that has a context (width x height
//      x bytes per pixel x buffers) and compares it with a budget sized for a
//      phone. Over the budget it frees canvases that were removed from the
//      page, and warns in the console.
//   6. Logs every readback (getImageData, readPixels, mapAsync, toDataURL,
//      toBlob). A readback from a GPU canvas that no tap asked for and no
//      live check made is "unasked". Unasked readbacks in four different
//      seconds mean a timer or a frame loop is reading back, which is the
//      pattern that matched the losses on /hdr-glow/ on the test phone.
//   7. Stops a loop of losses. A canvas that loses its context three times in
//      30 seconds is being lost by what the page draws. The guard then stops
//      `paint` events on the page and says so, so that the tab is not taken
//      down with the GPU process.
//   8. Keeps a record of the visit in sessionStorage. If the tab dies (a white
//      page), the next page loaded in that tab shows the record in a bar at
//      the bottom with a Copy button.
//   9. Sends reports to /api/reports (src/reports.js): a lost context, a
//      stopped loop, a script error, a rejected promise, an intervention or
//      deprecation the browser reports, and a tab that died (found by the
//      next page load). Reports are filed by the origin of the page, so
//      production and each preview stay apart. Read them with
//      `npm run reports`. Nothing is sent from localhost.
//  10. Holds drawing after a crash. A page loaded within ten minutes of the
//      same page dying in the same tab starts with its `paint` events
//      stopped and a bar that says so, with a "Draw anyway" button. Without
//      this a page that kills the tab kills it again on every reload.
//  11. Counts snapshots. captureElementImage() returns a picture that holds
//      GPU memory until close() is called on it. The guard counts the ones
//      that are open and reports a page that keeps more than 24.
//
// Rules for pages, checked by `npm run check:gfx` (static) and
// `npm run check:jank` (measured): docs/graphics-rules.md.
//
// window.__gfx:
//   made        every context made: { type, t, where }
//   lost        every loss: { type, t, connected, w, h, why }
//   active()    WebGL contexts that are alive and count towards the limit
//   peak        the largest active() seen
//   noted       how many notes (point 4) were shown
//   release(x)  take the WebGL context of every removed canvas under x (a
//               canvas or an element), or of every removed canvas
//   retire(x)   say that the canvases under x (a canvas or an element) are
//               finished with. Each is freed once it has been out of the page
//               for a moment: a WebGL context is given back, any other canvas
//               is set to 0 by 0. This is the one way for a page or a library
//               to give a context back. Do not call loseContext().
//   memory()    { bytes, canvases, largest, removed }: the estimate of point 5
//   budget      { canvasPx, bytes }: the limits the estimate is compared with
//   report(type, message, body)   send one report (point 9)
//   reports     what was sent or queued on this page: { type, message }
//   snapshots   { made, open, peak }: captureElementImage() pictures (point 11)
//   held        true while drawing is held after a crash (point 10)
//   reads       counts of readbacks; reads.timed is true after point 6
//   halted      true after point 7
//   summary()   one line for a bug report
(function () {
  if (window.__gfx || typeof HTMLCanvasElement === 'undefined') return;

  // window.__gfxLimit lets a test apply the Android limit on a desktop browser.
  var GL_LIMIT = window.__gfxLimit || (/Android/i.test(navigator.userAgent) ? 8 : 16);
  var isGL = function (type) { return /^(webgl|webgl2|experimental-webgl)$/.test(type); };
  var now = function () { return Math.round(performance.now()); };

  // canvas -> { type, ctx, wasConnected, lost, note }
  var info = new WeakMap();
  // Canvases with a WebGL context that has not been lost or released.
  var gl = new Set();
  var gpuCanvases = new Set();
  // Every canvas that has a context, for the memory estimate.
  var all = new Set();

  // The budget is a choice, not a limit read from the browser: one canvas may
  // hold about one phone screen of pixels, and all canvases together about 24
  // phone screens of bytes. window.__gfxBudget lets a test set it.
  var screenPx = 0;
  try { screenPx = Math.round(screen.width * screen.height * devicePixelRatio * devicePixelRatio); } catch (e) {}
  var BUDGET = window.__gfxBudget || { canvasPx: Math.max(4e6, Math.round(screenPx * 1.25)), bytes: Math.max(96e6, screenPx * 24) };

  var G = (window.__gfx = {
    limit: GL_LIMIT,
    budget: BUDGET,
    made: [],
    lost: [],
    released: 0,
    freed: 0,
    noted: 0,
    peak: 0,
    peakBytes: 0,
    peakCanvasPx: 0,
    peakDevices: 0,
    over: null,
    halted: false,
    held: false,
    reports: [],
    snapshots: { made: 0, open: 0, peak: 0 },
    report: send,
    reads: { calls: 0, unasked: 0, unaskedSeconds: 0, largestUnasked: 0, timed: false, by: {}, recent: [] },
    active: function () { prune(); return gl.size; },
    release: release,
    retire: retire,
    memory: memory,
    summary: summary,
  });

  // Also notes when a canvas was first seen in the page and first seen out of it.
  function prune() {
    gl.forEach(function (ref) {
      var c = ref.deref();
      if (!c) { gl.delete(ref); return; }
      var i = info.get(c);
      if (i.lost || (i.ctx.isContextLost && i.ctx.isContextLost())) gl.delete(ref);
      else if (c.isConnected) { i.wasConnected = true; i.goneAt = 0; }
      else if (i.wasConnected && !i.goneAt) i.goneAt = performance.now();
    });
  }

  // ------------------------------------------------------------ memory
  // Bytes a canvas is estimated to hold. A 2D canvas has one buffer, a WebGL
  // or WebGPU canvas a front and a back buffer, antialiasing two more. A
  // float16 canvas has 8 bytes per pixel. A 2D canvas made with
  // willReadFrequently is kept in ordinary memory, not on the GPU, and is
  // counted the same way.
  function bytesOf(c, i) {
    if (!i || i.freed || (i.lost && isGL(i.type))) return 0;
    var buffers = i.type === 'webgpu' || isGL(i.type) ? (i.antialias ? 4 : 2) : 1;
    return c.width * c.height * (i.float ? 8 : 4) * buffers;
  }

  function memory() {
    var m = { bytes: 0, canvases: 0, largest: 0, removed: 0 };
    all.forEach(function (ref) {
      var c = ref.deref();
      if (!c) { all.delete(ref); return; }
      var i = info.get(c), b = bytesOf(c, i);
      if (!b) return;
      m.canvases++;
      m.bytes += b;
      if (c.width * c.height > m.largest) m.largest = c.width * c.height;
      if (i.where === 'canvas') {
        if (c.isConnected) { i.wasConnected = true; i.goneAt = 0; }
        else if (i.wasConnected) { if (!i.goneAt) i.goneAt = performance.now(); m.removed += b; }
      }
    });
    if (m.bytes > G.peakBytes) G.peakBytes = m.bytes;
    if (m.largest > G.peakCanvasPx) G.peakCanvasPx = m.largest;
    return m;
  }

  // Free one canvas that is out of the page: a WebGL context is given back
  // (see drop() for the conditions), any other canvas is set to 0 by 0, which
  // frees its buffer at once and cannot crash.
  function free(c) {
    var i = info.get(c);
    if (!i || i.freed || i.where !== 'canvas' || c.isConnected || !i.goneAt) return false;
    if (isGL(i.type)) { if (!drop(c)) return false; i.freed = true; return true; }
    if (i.type === 'webgpu') { try { i.ctx.unconfigure(); } catch (e) {} }
    try { c.width = 0; c.height = 0; } catch (e) { return false; }
    i.freed = true;
    G.freed++;
    return true;
  }

  function retire(root) {
    if (!root) return;
    all.forEach(function (ref) {
      var c = ref.deref();
      if (c && (c === root || composedContains(root, c))) info.get(c).retired = true;
    });
    tick();
  }

  // Twice a second while any canvas has a context: free retired canvases that
  // have been out of the page since an earlier tick, compare the estimate with
  // the budget, and write the visit record.
  var ticking = 0;
  function tick() { if (!ticking) ticking = setInterval(onTick, 500); }
  function onTick() {
    if (document.hidden) return;
    prune();
    var m = memory();
    var t = performance.now();
    all.forEach(function (ref) {
      var c = ref.deref();
      if (!c) return;
      var i = info.get(c);
      if (i.retired && !i.freed && i.goneAt && t - i.goneAt > 200) free(c);
    });
    if (m.bytes > BUDGET.bytes || m.largest > BUDGET.canvasPx) {
      // Over the budget: free what was removed from the page two seconds ago or more.
      all.forEach(function (ref) {
        var c = ref.deref();
        if (!c) return;
        var i = info.get(c);
        if (!i.freed && i.goneAt && t - i.goneAt > 2000) free(c);
      });
      var after = memory();
      if (!G.over && (after.bytes > BUDGET.bytes || after.largest > BUDGET.canvasPx)) {
        G.over = { t: now(), bytes: after.bytes, largest: after.largest };
        console.warn('context-guard: the canvases on this page are estimated at ' + mb(after.bytes) + ' MB (budget ' + mb(BUDGET.bytes) + ' MB) and the largest has ' + mp(after.largest) + ' megapixels (budget ' + mp(BUDGET.canvasPx) + '). A phone can lose every canvas at that size.');
        send('over-budget', 'canvases estimated at ' + mb(after.bytes) + ' MB, largest ' + mp(after.largest) + ' megapixels', { summary: summary() });
      }
    }
    record();
    if (!all.size) { clearInterval(ticking); ticking = 0; }
  }
  function mb(n) { return (n / 1e6).toFixed(n < 1e7 ? 1 : 0); }
  function mp(n) { return (n / 1e6).toFixed(1); }

  // ------------------------------------------------------------ readbacks
  function asked() {
    // window.__gfxNoTaps: a test harness whose own calls count as taps says so, and no tap is believed.
    try { if (!window.__gfxNoTaps && navigator.userActivation && navigator.userActivation.isActive) return true; } catch (e) {}
    return window.__checkState === 'running' || !!window.__gfxAsked;
  }
  var lastSecond = -1;
  function read(kind, px, gpu) {
    var R = G.reads, t = performance.now();
    R.calls++;
    var unasked = gpu && !asked();
    R.recent.push({ kind: kind, px: px, t: Math.round(t), unasked: unasked });
    if (R.recent.length > 24) R.recent.shift();
    if (!unasked) return;
    R.unasked++;
    if (px > R.largestUnasked) R.largestUnasked = px;
    if (R.unasked <= 40) {
      // Where from, for the report of check:jank.
      var at = '';
      try { at = (new Error().stack.split('\n')[3] || '').replace(/^\s*at\s+/, '').replace(location.origin, ''); } catch (e) {}
      R.by[kind + ' ' + at] = (R.by[kind + ' ' + at] || 0) + 1;
    }
    var second = Math.floor(t / 1000);
    if (second !== lastSecond) { lastSecond = second; R.unaskedSeconds++; }
    if (R.unaskedSeconds >= 4 && !R.timed) {
      R.timed = true;
      send('timed-readback', kind + ' from a GPU canvas in four different seconds with no tap', { summary: summary() });
      console.warn('context-guard: this page reads pixels back from a GPU canvas on a timer or in a frame loop (' + kind + '). Read back on a tap, or from a 2D canvas made with willReadFrequently.');
    }
  }
  function onCPU(canvas) { var i = canvas && info.get(canvas); return !!(i && i.cpu); }
  function patch(proto, name, describe) {
    if (!proto || !proto[name]) return;
    var original = proto[name];
    proto[name] = function () {
      try { var d = describe.apply(this, arguments); read(name, d[0], d[1]); } catch (e) {}
      return original.apply(this, arguments);
    };
  }
  function patchReads() {
    var g = window;
    var image = function (x, y, w, h, settings) { var px = Math.abs(w * h) || 0; return [settings && settings.pixelFormat === 'rgba-float16' ? px * 2 : px, !onCPU(this.canvas)]; };
    if (g.CanvasRenderingContext2D) patch(CanvasRenderingContext2D.prototype, 'getImageData', image);
    if (g.OffscreenCanvasRenderingContext2D) patch(OffscreenCanvasRenderingContext2D.prototype, 'getImageData', image);
    var pixels = function (x, y, w, h) { return [Math.abs(w * h) || 0, true]; };
    if (g.WebGLRenderingContext) patch(WebGLRenderingContext.prototype, 'readPixels', pixels);
    if (g.WebGL2RenderingContext) patch(WebGL2RenderingContext.prototype, 'readPixels', pixels);
    if (g.GPUBuffer) patch(GPUBuffer.prototype, 'mapAsync', function () { return [Math.round((this.size || 0) / 4), true]; });
    var whole = function () { return [this.width * this.height, !onCPU(this)]; };
    patch(HTMLCanvasElement.prototype, 'toDataURL', whole);
    patch(HTMLCanvasElement.prototype, 'toBlob', whole);
    if (g.OffscreenCanvas) patch(OffscreenCanvas.prototype, 'convertToBlob', whole);
    // One WebGPU device for the page: count the devices asked for.
    if (g.GPUAdapter) {
      var request = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = function () {
        G.devices = (G.devices || 0) + 1;
        var p = request.apply(this, arguments);
        p.then(function (device) {
          liveDevices++;
          if (liveDevices > G.peakDevices) G.peakDevices = liveDevices;
          device.lost.then(function () { liveDevices--; });
        }, function () {});
        return p;
      };
    }
  }
  var liveDevices = 0;

  // loseContext() has crashed the renderer in Chromium 157 when the canvas is
  // a drawable one still in the page, when the canvas is removed in the same
  // task, and when the canvas has an iframe child. So a context is only taken
  // from a canvas that was seen out of the page by an earlier timer tick (a
  // different task) and has no iframe inside it.
  function drop(canvas) {
    var i = info.get(canvas);
    if (!i || i.lost || !isGL(i.type) || canvas.isConnected) return false;
    // A bare canvas that was never in the page (a probe) can be given back at once.
    if (!i.goneAt && (i.wasConnected || canvas.firstChild)) return false;
    try { if (canvas.querySelector('iframe')) return false; } catch (e) { return false; }
    i.lost = true;
    i.released = true;
    try { var ext = i.ctx.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) {}
    G.released++;
    return true;
  }

  function release(root) {
    var n = 0;
    gl.forEach(function (ref) {
      var c = ref.deref();
      if (!c || (root ? c !== root && !composedContains(root, c) : !info.get(c).goneAt)) return;
      if (drop(c)) n++;
    });
    prune();
    return n;
  }

  // A canvas made off the page, put in and taken out again between two WebGL
  // context creations would never be seen in the page. Look four times a second
  // while any WebGL context is alive.
  var watching = 0;
  function watch() {
    if (watching) return;
    watching = setInterval(function () {
      prune();
      if (!gl.size) { clearInterval(watching); watching = 0; }
    }, 250);
  }

  function composedContains(root, node) {
    for (var n = node; n; n = n.parentNode || n.host) if (n === root) return true;
    return false;
  }

  // Before a new WebGL context that would reach the limit: take the context
  // of removed canvases, the ones removed longest ago first, until there is room.
  function sweep() {
    prune();
    if (gl.size + 1 < GL_LIMIT) return;
    var gone = [];
    gl.forEach(function (ref) { var c = ref.deref(); if (c && info.get(c).goneAt) gone.push(c); });
    gone.sort(function (a, b) { return info.get(a).goneAt - info.get(b).goneAt; });
    for (var k = 0; k < gone.length && gl.size + 1 >= GL_LIMIT; k++) if (drop(gone[k])) prune();
  }

  function wrap(proto, where) {
    var original = proto.getContext;
    if (!original) return;
    proto.getContext = function (type) {
      var known = info.get(this);
      if (!known && isGL(type)) sweep();
      var ctx = original.apply(this, arguments);
      if (!ctx || known) return ctx;
      var attrs = arguments[1] || {};
      var entry = { type: type, ctx: ctx, where: where, wasConnected: !!this.isConnected, goneAt: 0, lost: false, note: null, losses: [],
        float: attrs.colorType === 'float16', cpu: type === '2d' && attrs.willReadFrequently === true, antialias: isGL(type) && attrs.antialias !== false };
      try { if (entry.float && ctx.getContextAttributes && ctx.getContextAttributes().colorType !== 'float16') entry.float = false; } catch (e) {}
      info.set(this, entry);
      all.add(new WeakRef(this));
      tick();
      G.made.push({ type: type, t: now(), where: where });
      if (isGL(type)) {
        gl.add(new WeakRef(this));
        watch();
        var n = G.active();
        if (n > G.peak) G.peak = n;
        if (n > GL_LIMIT && !G.warned) {
          G.warned = true;
          console.warn('context-guard: ' + n + ' WebGL contexts are alive on this page; this browser keeps ' + GL_LIMIT + ' and takes the oldest away.');
        }
      }
      if (type === 'webgpu' && where === 'canvas') gpuCanvases.add(new WeakRef(this));
      if (where === 'canvas') listen(this, entry);
      return ctx;
    };
  }

  function listen(canvas, entry) {
    var onLost = function (e) {
      if (entry.released) return;
      if (e && e.isTrusted === false) return; // a page testing its own fallback
      entry.lost = true;
      var t = performance.now(), m = memory();
      // What was read back in the second before, and how much the canvases held.
      var before = G.reads.recent.filter(function (r) { return t - r.t < 1000; }).map(function (r) { return r.kind + ' ' + r.px + ' px ' + Math.round(t - r.t) + ' ms before'; });
      G.lost.push({ type: entry.type, t: now(), connected: canvas.isConnected, w: canvas.width, h: canvas.height, why: (e && e.statusMessage) || '', float: entry.float, mb: +mb(m.bytes), reads: before.slice(-3) });
      prune();
      record();
      send('context-lost', (entry.float ? 'float16 ' : '') + label(entry.type) + ' context lost' + (canvas.isConnected ? '' : ' (canvas not in the page)'),
        { w: canvas.width, h: canvas.height, id: canvas.id || '', why: (e && e.statusMessage) || '', reads: before.slice(-3), summary: summary() }, true);
      entry.losses.push(t);
      while (entry.losses.length && t - entry.losses[0] > 30000) entry.losses.shift();
      if (entry.losses.length >= 3 && canvas.isConnected) halt(canvas, entry);
      setTimeout(function () { if (entry.lost && !G.halted) note(canvas, entry, 'lost its ' + label(entry.type) + ' context and the page did not get it back'); }, 1500);
    };
    var onRestored = function (e) {
      if (e && e.isTrusted === false) return;
      entry.lost = false;
      if (G.halted) return;
      unnote(entry);
      if (isGL(entry.type)) { gl.add(new WeakRef(canvas)); watch(); return; }
      // A restored 2D canvas is empty. Pages draw in a paint handler, so ask for one.
      try { if (canvas.requestPaint && canvas.isConnected) canvas.requestPaint(); } catch (e) {}
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('contextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    canvas.addEventListener('contextrestored', onRestored);
  }

  // Three losses of one canvas in 30 seconds: each redraw is losing the
  // context again. On the test phone such a loop ended with a white tab.
  // Stop every paint handler on the page (a listener in the capture phase on
  // the window runs before the page's own) and say what happened.
  function halt(canvas, entry) {
    if (G.halted) return;
    G.halted = true;
    addEventListener('paint', function (e) { e.stopImmediatePropagation(); }, true);
    unnote(entry);
    send('draw-stopped', label(entry.type) + ' context lost ' + entry.losses.length + ' times in 30 s; paint events stopped', { summary: summary() }, true);
    note(canvas, entry, 'lost its ' + label(entry.type) + ' context ' + entry.losses.length + ' times in ' + Math.round((entry.losses[entry.losses.length - 1] - entry.losses[0]) / 1000) + ' seconds. Drawing on this page has been stopped so that the tab does not crash', true);
    record();
  }

  function label(type) { return isGL(type) ? 'WebGL' : type === 'webgpu' ? 'WebGPU' : type === 'bitmaprenderer' ? 'bitmap' : '2D'; }

  // /shared/backend.js announces a lost WebGPU device with this event. A
  // library that handles it moves to a new canvas; a canvas still showing a
  // WebGPU context after that is frozen on its last frame or blank.
  addEventListener('webgpulost', function (e) {
    var why = (e.detail && (e.detail.message || e.detail.reason)) || '';
    G.lost.push({ type: 'webgpu-device', t: now(), connected: true, w: 0, h: 0, why: why });
    setTimeout(function () {
      gpuCanvases.forEach(function (ref) {
        var c = ref.deref();
        if (!c) { gpuCanvases.delete(ref); return; }
        var i = info.get(c);
        if (c.isConnected) note(c, i, 'is on a WebGPU device that was lost and the page did not get it back');
      });
    }, 1500);
  });

  function summary() {
    var by = {};
    for (var k = 0; k < G.made.length; k++) by[label(G.made[k].type)] = (by[label(G.made[k].type)] || 0) + 1;
    var parts = Object.keys(by).map(function (key) { return by[key] + ' ' + key; });
    var m = memory(), R = G.reads;
    // Losses at the same moment are one line: "7 2D at 3.1 s".
    var groups = [];
    G.lost.forEach(function (l) {
      var name = (l.float ? 'float16 ' : '') + label(l.type === 'webgpu-device' ? 'webgpu' : l.type) + (l.type === 'webgpu-device' ? ' device' : '');
      var last = groups[groups.length - 1];
      if (last && last.name === name && Math.abs(last.t - l.t) < 250) { last.n++; return; }
      groups.push({ name: name, t: l.t, n: 1, why: l.why, mb: l.mb, reads: l.reads || [] });
    });
    var shown = groups.slice(-8).map(function (g) {
      return (g.n > 1 ? g.n + ' ' : '') + g.name + ' at ' + (g.t / 1000).toFixed(1) + ' s' + (g.why ? ' (' + g.why + ')' : '') + (g.reads.length ? ' after ' + g.reads.join(', ') : '');
    });
    return 'Contexts made: ' + (parts.join(', ') || 'none') + '. WebGL alive: ' + G.active() + ' of ' + GL_LIMIT + ' (peak ' + G.peak + ', ' + G.released + ' given back). ' +
      'Canvas memory, estimated: ' + mb(m.bytes) + ' MB in ' + m.canvases + ' canvases (peak ' + mb(G.peakBytes) + ' MB, budget ' + mb(BUDGET.bytes) + ' MB), largest ' + mp(m.largest) + ' megapixels, ' + mb(m.removed) + ' MB in removed canvases, ' + G.freed + ' freed. ' +
      (G.snapshots.made ? 'Snapshots: ' + G.snapshots.made + ' made, ' + G.snapshots.open + ' open (peak ' + G.snapshots.peak + '). ' : '') +
      'Readbacks: ' + R.calls + ', ' + R.unasked + ' unasked' + (R.timed ? ' (on a timer)' : '') + '. ' +
      'Lost: ' + (groups.length > 8 ? (groups.length - 8) + ' earlier; ' : '') + (shown.join('; ') || 'none') + (G.halted ? '. Drawing stopped by the guard' : '') + '.';
  }

  // ----------------------------------------------------------------- reports
  // One endpoint for every copy of the site. A preview is static and has no
  // Worker, so it posts to the production host. window.__gfxReportTo lets a
  // test name another URL; an empty string turns sending off.
  var REPORT_URL = window.__gfxReportTo !== undefined ? window.__gfxReportTo
    : /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:' ? '' : 'https://html-in-canvas.page/api/reports';
  var VISIT = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  var queue = [], flushing = 0, perKey = {};
  var inFrame = false;
  try { inFrame = window.top !== window; } catch (e) { inFrame = true; }

  // At most 80 reports for one page load, and 3 with the same type and message.
  function send(type, message, body, now_, url) {
    try {
      message = String(message == null ? '' : message).slice(0, 600);
      var key = type + '|' + message;
      perKey[key] = (perKey[key] || 0) + 1;
      if (perKey[key] > 3 || G.reports.length >= 80) return;
      G.reports.push({ type: type, message: message });
      queue.push({ type: type, url: url || location.origin + location.pathname + location.search.slice(0, 80), source: 'guard', message: message, body: body || {}, visit: VISIT, frame: inFrame, t: Date.now() });
      if (now_) flush();
      else if (!flushing) flushing = setTimeout(flush, 1000);
    } catch (e) {}
  }
  function flush() {
    clearTimeout(flushing);
    flushing = 0;
    if (!queue.length) return;
    var batch = queue.splice(0, 25), t = Date.now();
    batch.forEach(function (r) { r.age = t - r.t; delete r.t; });
    if (!REPORT_URL) return;
    try {
      // text/plain needs no preflight, so the report leaves in one request
      // even when the tab is about to go.
      var text = JSON.stringify(batch);
      if (navigator.sendBeacon && navigator.sendBeacon(REPORT_URL, new Blob([text], { type: 'text/plain' }))) return;
      fetch(REPORT_URL, { method: 'POST', body: text, keepalive: true, mode: 'no-cors', credentials: 'omit' }).catch(function () {});
    } catch (e) {}
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  var short = function (stack) { return String(stack || '').replace(new RegExp(location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').split('\n').slice(0, 6).join('\n').slice(0, 900); };
  addEventListener('error', function (e) {
    if (!e || e.target !== window && e.target) return; // a resource that failed to load is not a script error
    send('error', e.message || 'error', { at: String(e.filename || '').replace(location.origin, '') + ':' + e.lineno + ':' + e.colno, stack: short(e.error && e.error.stack) });
  });
  addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    send('unhandledrejection', (r && (r.name ? r.name + ': ' : '') + (r.message || '')) || String(r), { stack: short(r && r.stack) });
  });
  try {
    if (window.ReportingObserver) {
      new ReportingObserver(function (list) {
        list.forEach(function (r) {
          var b = {};
          try { b = r.body && r.body.toJSON ? r.body.toJSON() : {}; } catch (e) {}
          send(r.type, b.message || b.id || r.type, b);
        });
      }, { types: ['intervention', 'deprecation'], buffered: true }).observe();
    }
  } catch (e) {}

  // --------------------------------------------------------------- snapshots
  // captureElementImage() returns an ElementImage. It holds a picture on the
  // GPU until close() is called or it is collected, and a page with no
  // allocation pressure in script may not be collected for a long time.
  (function () {
    var S = G.snapshots, proto = HTMLCanvasElement.prototype, original = proto.captureElementImage;
    if (!original) return;
    var collected = window.FinalizationRegistry ? new FinalizationRegistry(function (state) { if (!state.closed) { state.closed = true; S.open--; } }) : null;
    // A picture transferred to a worker or a port is no longer held here:
    // the receiver closes it.
    var states = new WeakMap();
    var handOver = function (proto) {
      var post = proto && proto.postMessage;
      if (!post) return;
      proto.postMessage = function (message, second, third) {
        try {
          var list = Array.isArray(second) ? second : second && second.transfer ? second.transfer : Array.isArray(third) ? third : null;
          if (list) for (var k = 0; k < list.length; k++) { var st = states.get(list[k]); if (st && !st.closed) { st.closed = true; S.open--; S.sent = (S.sent || 0) + 1; } }
        } catch (e) {}
        return post.apply(this, arguments);
      };
    };
    handOver(window.Worker && Worker.prototype);
    handOver(window.MessagePort && MessagePort.prototype);
    handOver(window.Window && Window.prototype);
    proto.captureElementImage = function () {
      var image = original.apply(this, arguments);
      try {
        if (image && typeof image.close === 'function') {
          var state = { closed: false }, close = image.close;
          image.close = function () { if (!state.closed) { state.closed = true; S.open--; } return close.apply(this, arguments); };
          S.made++;
          if (++S.open > S.peak) S.peak = S.open;
          states.set(image, state);
          if (collected) collected.register(image, state);
          if (S.open === 25 && !S.warned) {
            S.warned = true;
            console.warn('context-guard: 25 captureElementImage() pictures are open on this page. Call close() on each when it has been drawn for the last time.');
            send('snapshots-open', '25 captureElementImage() pictures open and not closed', { summary: summary() });
          }
        }
      } catch (e) {}
      return image;
    };
  })();

  // ------------------------------------------------------------ visit record
  // sessionStorage belongs to the tab and outlives a crashed page. The record
  // says "open" while the page is showing. A page loaded in the same tab that
  // finds an "open" record follows a page that never closed.
  var KEY = 'gfx-visit', lastRecord = '';
  var store = null;
  try { store = window.top === window ? sessionStorage : null; } catch (e) {}
  function record(state) {
    if (!store) return;
    try {
      var text = JSON.stringify({ href: location.pathname, at: Date.now(), state: state || (document.hidden ? 'closed' : 'open'), lost: G.lost.length, died: died, summary: summary() });
      if (text.replace(/"at":\d+/, '') === lastRecord.replace(/"at":\d+/, '')) return;
      lastRecord = text;
      store.setItem(KEY, text);
    } catch (e) {}
  }
  var previous = null, died = 0;
  try { previous = store && JSON.parse(store.getItem(KEY) || 'null'); } catch (e) {}
  // The page before this one died while it was showing, a short time ago.
  var afterCrash = !!(previous && previous.state === 'open' && Date.now() - previous.at < 30 * 60000);
  if (afterCrash) {
    send('tab-died', 'the page stopped without closing (a crashed or killed tab); found by the next page load', { summary: previous.summary, secondsAgo: Math.round((Date.now() - previous.at) / 1000), times: (previous.died || 0) + 1, next: location.pathname }, true, location.origin + previous.href);
    // The same page again within ten minutes: hold its drawing.
    if (previous.href === location.pathname && Date.now() - previous.at < 10 * 60000 && !window.__gfxNoHold) {
      died = (previous.died || 0) + 1;
      hold();
    }
  }
  if (store) {
    addEventListener('pagehide', function () { record('closed'); });
    document.addEventListener('visibilitychange', function () { record(); });
    record();
    if (previous && (previous.state === 'open' || previous.lost) && Date.now() - previous.at < 30 * 60000) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { report(previous); });
      else report(previous);
    }
  }

  // Point 10. `paint` events are stopped in the capture phase on the window,
  // before any handler of the page. "Draw anyway" lets them through and asks
  // every drawable canvas for a paint.
  function stopPaint(e) { e.stopImmediatePropagation(); }
  function hold() {
    G.held = true;
    addEventListener('paint', stopPaint, true);
  }
  function unhold() {
    if (!G.held) return;
    G.held = false;
    removeEventListener('paint', stopPaint, true);
    send('draw-anyway', 'drawing started by hand after the page died ' + died + ' time' + (died === 1 ? '' : 's'), {}, true);
    var list = document.querySelectorAll('canvas');
    for (var k = 0; k < list.length; k++) { try { if (list[k].requestPaint) list[k].requestPaint(); } catch (e) {} }
  }

  // A bar fixed to the bottom of the window. It covers the page and moves nothing.
  function report(p) {
    if (!document.body) return;
    var crashed = p.state === 'open';
    var bar = document.createElement('div');
    bar.className = 'context-visit-report';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147482500;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;max-height:45vh;overflow:auto;padding:8px 10px;background:#10131af2;color:#e8ebf2;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 180px;min-width:0';
    text.textContent = crashed
      ? (G.held
        ? 'This page stopped without closing ' + Math.max(1, Math.round((Date.now() - p.at) / 1000)) + ' seconds ago' + (died > 1 ? ' (' + died + ' times in a row)' : '') + ', which is what a crashed tab leaves behind. Its canvases are not being drawn, so that it does not happen again on every reload.' + (REPORT_URL ? ' A report was sent.' : '')
        : 'The page before this one in this tab (' + p.href + ') stopped without closing. That is what a crashed tab leaves behind.' + (REPORT_URL ? ' A report was sent.' : ''))
      : 'The page before this one in this tab (' + p.href + ') lost a canvas context ' + p.lost + ' time' + (p.lost === 1 ? '' : 's') + '.';
    var detail = document.createElement('small');
    detail.style.cssText = 'flex:1 1 100%;opacity:.75;font-size:11px;overflow-wrap:anywhere';
    detail.textContent = p.summary;
    var button = function (name, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.style.cssText = 'font:inherit;min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid #ffffff40;background:transparent;color:inherit;cursor:pointer;';
      b.addEventListener('click', fn);
      return b;
    };
    var copy = button('Copy', function () {
      var all = text.textContent + ' ' + p.summary + ' ' + navigator.userAgent;
      try { navigator.clipboard.writeText(all).then(function () { copy.textContent = 'Copied'; }, function () { copy.textContent = 'Could not copy'; }); } catch (e) { copy.textContent = 'Could not copy'; }
    });
    bar.append(text);
    if (G.held) bar.append(button('Draw anyway', function () { unhold(); bar.remove(); }));
    bar.append(copy, button('Dismiss', function () { bar.remove(); }), detail);
    document.body.appendChild(bar);
  }

  // ---------------------------------------------------------------- the note
  // An absolutely positioned bar over the top of the canvas, appended to
  // <body>, so nothing in the page moves. Not shown in a frame (a tile or a
  // check fixture) or for a canvas nobody can see.
  var notes = new Set();
  var timer = 0;

  function visible(canvas) {
    if (!canvas.isConnected || window.top !== window) return false;
    for (var n = canvas; n; n = n.parentNode || n.host) {
      if (n.nodeType === 1 && /^(test-stage|check-bench|fixtures)$/.test(n.id)) return false;
    }
    var r = canvas.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) return false;
    try { if (canvas.checkVisibility && !canvas.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false; } catch (e) {}
    return true;
  }

  // True when the page already shows its own message over this canvas.
  function saysSo(canvas) {
    var r = canvas.getBoundingClientRect();
    var alerts = document.querySelectorAll('[role=alert]:not(.context-lost-note)');
    for (var k = 0; k < alerts.length; k++) {
      var a = alerts[k].getBoundingClientRect();
      if (a.width && a.height && a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top) return true;
    }
    return false;
  }

  function note(canvas, entry, what, always) {
    if (!entry || entry.note || !document.body) return;
    if (!always && (!visible(canvas) || saysSo(canvas))) return;
    G.noted++;
    var box = document.createElement('div');
    box.className = 'context-lost-note';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:absolute;z-index:2147482000;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:8px 10px;background:#10131af2;color:#e8ebf2;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;border-radius:0 0 8px 8px;';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 180px;min-width:0';
    text.textContent = 'This canvas ' + what + '.';
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload the page';
    button.style.cssText = 'font:inherit;min-height:36px;padding:6px 12px;border-radius:8px;border:0;background:#d2491f;color:#fff;cursor:pointer;';
    button.addEventListener('click', function () { location.reload(); });
    var detail = document.createElement('small');
    detail.style.cssText = 'flex:1 1 100%;opacity:.75;font-size:11px;overflow-wrap:anywhere';
    detail.textContent = summary();
    box.append(text, button, detail);
    document.body.appendChild(box);
    entry.note = { box: box, canvas: canvas };
    notes.add(entry);
    place();
    if (!timer) timer = setInterval(place, 500);
  }

  function unnote(entry) {
    if (!entry.note) return;
    entry.note.box.remove();
    entry.note = null;
    notes.delete(entry);
    if (!notes.size) { clearInterval(timer); timer = 0; }
  }

  // Keep each note over its canvas, and take it away when the canvas has gone
  // (a library replaced it) or its context is back.
  function place() {
    notes.forEach(function (entry) {
      var c = entry.note.canvas;
      var back = !G.halted && entry.type !== 'webgpu' && entry.ctx.isContextLost && !entry.ctx.isContextLost();
      if (!c.isConnected || back) { if (back) entry.lost = false; unnote(entry); return; }
      var r = c.getBoundingClientRect();
      var s = entry.note.box.style;
      s.left = Math.max(0, r.left + scrollX) + 'px';
      s.top = r.top + scrollY + 'px';
      s.width = Math.min(r.width, document.documentElement.clientWidth - Math.max(0, r.left)) + 'px';
    });
  }

  patchReads();
  wrap(HTMLCanvasElement.prototype, 'canvas');
  if (typeof OffscreenCanvas !== 'undefined') wrap(OffscreenCanvas.prototype, 'offscreen');
})();
