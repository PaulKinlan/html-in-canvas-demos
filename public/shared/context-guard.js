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
//
// window.__gfx:
//   made        every context made: { type, t, where }
//   lost        every loss: { type, t, connected, w, h, why }
//   active()    WebGL contexts that are alive and count towards the limit
//   peak        the largest active() seen
//   noted       how many notes (point 4) were shown
//   release(x)  take the WebGL context of every removed canvas under x (a
//               canvas or an element), or of every removed canvas
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

  var G = (window.__gfx = {
    limit: GL_LIMIT,
    made: [],
    lost: [],
    released: 0,
    noted: 0,
    peak: 0,
    active: function () { prune(); return gl.size; },
    release: release,
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

  // loseContext() has crashed the renderer in Chromium 157 when the canvas is
  // a drawable one still in the page, when the canvas is removed in the same
  // task, and when the canvas has an iframe child. So a context is only taken
  // from a canvas that was seen out of the page by an earlier timer tick (a
  // different task) and has no iframe inside it.
  function drop(canvas) {
    var i = info.get(canvas);
    if (!i || i.lost || !isGL(i.type) || canvas.isConnected || !i.goneAt) return false;
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
      if (c && (!root || c === root || composedContains(root, c)) && drop(c)) n++;
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
      var entry = { type: type, ctx: ctx, wasConnected: !!this.isConnected, goneAt: 0, lost: false, note: null };
      info.set(this, entry);
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
      entry.lost = true;
      G.lost.push({ type: entry.type, t: now(), connected: canvas.isConnected, w: canvas.width, h: canvas.height, why: (e && e.statusMessage) || '' });
      prune();
      setTimeout(function () { if (entry.lost) note(canvas, entry, 'lost its ' + label(entry.type) + ' context'); }, 1500);
    };
    var onRestored = function () {
      entry.lost = false;
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
        if (c.isConnected) note(c, i, 'is on a WebGPU device that was lost');
      });
    }, 1500);
  });

  function summary() {
    var by = {};
    for (var k = 0; k < G.made.length; k++) by[label(G.made[k].type)] = (by[label(G.made[k].type)] || 0) + 1;
    var parts = Object.keys(by).map(function (key) { return by[key] + ' ' + key; });
    return 'Contexts made: ' + (parts.join(', ') || 'none') + '. WebGL alive: ' + G.active() + ' of ' + GL_LIMIT + ' (peak ' + G.peak + ', ' + G.released + ' given back). Lost: ' +
      (G.lost.map(function (l) { return label(l.type === 'webgpu-device' ? 'webgpu' : l.type) + (l.type === 'webgpu-device' ? ' device' : '') + ' at ' + (l.t / 1000).toFixed(1) + ' s' + (l.why ? ' (' + l.why + ')' : ''); }).join('; ') || 'none') + '.';
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

  function note(canvas, entry, what) {
    if (!entry || entry.note || !visible(canvas) || !document.body || saysSo(canvas)) return;
    G.noted++;
    var box = document.createElement('div');
    box.className = 'context-lost-note';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:absolute;z-index:2147482000;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:8px 10px;background:#10131af2;color:#e8ebf2;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;border-radius:0 0 8px 8px;';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 180px;min-width:0';
    text.textContent = 'This canvas ' + what + ' and the page did not get it back.';
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
      var back = entry.type !== 'webgpu' && entry.ctx.isContextLost && !entry.ctx.isContextLost();
      if (!c.isConnected || back) { if (back) entry.lost = false; unnote(entry); return; }
      var r = c.getBoundingClientRect();
      var s = entry.note.box.style;
      s.left = Math.max(0, r.left + scrollX) + 'px';
      s.top = r.top + scrollY + 'px';
      s.width = Math.min(r.width, document.documentElement.clientWidth - Math.max(0, r.left)) + 'px';
    });
  }

  wrap(HTMLCanvasElement.prototype, 'canvas');
  if (typeof OffscreenCanvas !== 'undefined') wrap(OffscreenCanvas.prototype, 'offscreen');
})();
