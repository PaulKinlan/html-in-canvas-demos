// routes.js: the occlusion routes of /toolkit-occlusion/.
// The ImGui app (app/main.cpp) reports, after each frame, where it drew every DOM field and which
// rectangle each window above the fields claims. This module turns that report into
// updateElementGeometry() calls, CSS on the field, or extra elements, one way per route. It also
// sends the pointer to ImGui and measures what the browser's hit test answers.

// Rectangles are [x, y, width, height] in CSS px from the canvas's top left corner.
const intersect = (a, b) => {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  const r = Math.min(a[0] + a[2], b[0] + b[2]), bt = Math.min(a[1] + a[3], b[1] + b[3]);
  return r > x && bt > y ? [x, y, r - x, bt - y] : null;
};
const inside = (r, x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const edges = (vis, covers, axis) => {
  const lo = vis[axis], hi = vis[axis] + vis[axis + 2], out = new Set([lo, hi]);
  for (const c of covers) for (const v of [c[axis], c[axis] + c[axis + 2]]) if (v > lo && v < hi) out.add(v);
  return [...out].sort((a, b) => a - b);
};

// #region largest
// Route "rect": the largest rectangle of the field that no covering window overlaps.
// Every edge of the answer lies on an edge of the field or of a window, so all pairs are tried.
export function largestVisibleRect(vis, covers) {
  const xs = edges(vis, covers, 0), ys = edges(vis, covers, 1);
  let best = null, area = 0;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++)
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      const r = [xs[i], ys[k], xs[j] - xs[i], ys[l] - ys[k]];
      if (r[2] * r[3] > area && !covers.some((c) => intersect(c, r))) { best = r; area = r[2] * r[3]; }
    }
  return best;
}
// #endregion largest

// #region visible-rects
// The visible part of a field as rectangles that do not overlap: one row of cells between each
// pair of horizontal edges, cells joined along the row. Used by the clip-path and mask routes.
export function visibleRects(vis, covers) {
  const xs = edges(vis, covers, 0), ys = edges(vis, covers, 1), out = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    let run = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[k] + ys[k + 1]) / 2;
      if (covers.some((c) => inside(c, cx, cy))) { run = null; continue; }
      if (run) run[2] = xs[i + 1] - run[0];
      else out.push(run = [xs[i], ys[k], xs[i + 1] - xs[i], ys[k + 1] - ys[k]]);
    }
  }
  return out;
}
// #endregion visible-rects

const n = (v) => Math.round(v * 100) / 100;

// #region routes
// A route changes what one field asks for. `want` starts as: placed where ImGui drew it, clipped
// to its window, no CSS. `vis` is the field's rectangle inside its window and `over` the windows
// that overlap it.
export const ROUTES = {
  none: { label: '1. No handling', field() {} },
  guard: {
    label: '2. Guard: ask ImGui at event time', eventScript: true,
    // The field is parked off the canvas while the pointer is on a covered part of it.
    field(want, f, vis, over, ctx) {
      const p = ctx.pointer;
      if (p && inside(f.rect, p[0], p[1]) && !ctx.visibleAt(p[0], p[1])) want.park = true;
    },
  },
  rect: {
    label: '3. canvasClip: largest visible rectangle',
    field(want, f, vis, over) {
      if (!over.length) return;
      const r = largestVisibleRect(vis, over);
      // Fully covered: a zero-size clip leaves no hit box and keeps the field's bounds in place.
      want.clip = r ?? [vis[0], vis[1], 0, 0];
    },
  },
  clipPath: {
    label: '5a. CSS clip-path on the field',
    field(want, f, vis, over) {
      if (!over.length) return;
      const rects = visibleRects(vis, over), [x, y] = f.rect;
      if (!rects.length) { want.clip = [vis[0], vis[1], 0, 0]; return; }
      const d = rects.map((r) => `M${n(r[0] - x)} ${n(r[1] - y)}h${n(r[2])}v${n(r[3])}h${n(-r[2])}Z`).join('');
      want.clipPath = `path("${d}")`;
    },
  },
  mask: {
    label: '5b. CSS mask on the field',
    field(want, f, vis, over) {
      if (!over.length) return;
      const rects = visibleRects(vis, over), [x, y] = f.rect;
      want.mask = rects.length
        ? rects.map((r) => `linear-gradient(#000,#000) ${n(r[0] - x)}px ${n(r[1] - y)}px / ${n(r[2])}px ${n(r[3])}px no-repeat`).join(',')
        : 'linear-gradient(#000,#000) 0 0 / 0 0 no-repeat';
    },
  },
  blocker: { label: '6. Blocker element per window', blockers: true, field() {} },
  inert: { label: '7a. inert while any part is covered', field(want, f, vis, over) { want.inert = over.length > 0; } },
  pointerEvents: { label: '7b. pointer-events: none while covered', field(want, f, vis, over) { want.pointerEvents = over.length ? 'none' : ''; } },
  overlay: { label: '8. Plain element above the canvas', overlays: true, field() {} },
};
// #endregion routes

export function createOcclusion({ canvas, stage, module, app }) {
  const stats = { geometry: 0, styleWrites: 0, guardQueries: 0 };
  const fields = Object.values(app.items);
  for (const f of fields) { f.gkey = ''; f.css = {}; }
  const blockers = [...canvas.querySelectorAll('[data-occ-blocker]')].map((el) => ({ el, key: '' }));
  const overlays = [...stage.querySelectorAll('[data-occ-overlay]')].map((el) => ({ el, key: '' }));
  const visibleAt = (x, y) => !!module._ui_visible_at(x, y);
  const ctx = { pointer: null, visibleAt };
  let routeId = 'none', route = ROUTES.none, unit = { key: '', value: 1 }, touched = false;
  const api = { stats, fields, blockers, overlays, onSettled: null, onMoveStart: null, lastMove: null };

  const off = () => new DOMMatrix().translate(-100000, -100000);
  const matrix = (x, y, sx = 1, sy = 1) => new DOMMatrix().scale(unit.value).translate(x, y).scale(sx, sy);
  // #region geometry
  function geometry(el, options) {
    canvas.updateElementGeometry(el, options);
    stats.geometry++;
    touched = true;
  }
  // canvasTransform has been seen in CSS px on some canvases and in buffer px on others: measure.
  function measureUnit(el) {
    const key = `${canvas.width}/${canvas.clientWidth}/${el.offsetWidth}`;
    if (unit.key === key || !el.offsetWidth) return;
    canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix() });
    const measured = el.getBoundingClientRect().width;
    if (measured > 0) unit = { key, value: el.offsetWidth * (el.currentCSSZoom || 1) / measured };
  }
  function css(f, prop, value) {
    if ((f.css[prop] ?? '') === value) return;
    f.css[prop] = value;
    if (prop === 'inert') f.el.inert = value === '1';
    else f.el.style[prop] = value;
    stats.styleWrites++;
    touched = true;
  }

  // Called after every ImGui frame, and when the route changes.
  function apply() {
    let raised = false;
    const covers = app.covers;
    for (const f of fields) {
      if (!f.rect) continue;
      const vis = f.clip && intersect(f.rect, f.clip);
      const want = { park: !vis, clip: vis, clipPath: '', mask: '', inert: false, pointerEvents: '' };
      if (vis) route.field(want, f, vis, covers.filter((c) => intersect(c, vis)), ctx);
      const gkey = want.park ? 'off' : [...f.rect, ...want.clip].map(n).join();
      if (f.gkey !== gkey) {
        f.gkey = gkey;
        raised = true;
        if (want.park) geometry(f.el, { canvasTransform: off() });
        else {
          measureUnit(f.el);
          const [x, y] = f.rect, c = want.clip;
          // canvasClip is in the element's own coordinates, before the transform.
          geometry(f.el, { canvasTransform: matrix(x, y), canvasClip: new DOMRect(c[0] - x, c[1] - y, c[2], c[3]) });
        }
      }
      css(f, 'clipPath', want.clipPath);
      css(f, 'mask', want.mask);
      css(f, 'pointerEvents', want.pointerEvents);
      css(f, 'inert', want.inert ? '1' : '');
    }
    // #region blocker
    // One empty 1 by 1 px drawable element per covering window, scaled to the window's rectangle.
    // Where two hit boxes overlap, the element whose updateElementGeometry() call was the most
    // recent takes the pointer. So after any field was placed, every blocker is placed again,
    // back to front.
    blockers.forEach((b, i) => {
      const c = route.blockers ? covers[i] : null;
      const key = c ? c.map(n).join() : 'off';
      if (b.key === key && !(c && raised)) return;
      b.key = key;
      geometry(b.el, { canvasTransform: c ? matrix(c[0], c[1], c[2], c[3]) : off() });
    });
    // #endregion blocker
    // #region overlay
    // Route 8 uses no canvas API: an ordinary element above the canvas, outside it.
    overlays.forEach((o, i) => {
      const c = route.overlays ? covers[i] : null;
      const key = c ? c.map(n).join() : 'off';
      if (o.key === key) return;
      o.key = key;
      o.el.hidden = !c;
      if (c) o.el.style.cssText = `left:${n(c[0])}px;top:${n(c[1])}px;width:${n(c[2])}px;height:${n(c[3])}px`;
      stats.styleWrites++;
    });
    // #endregion overlay
    // Chromium 157 keeps a stale hit-test answer until something on the canvas changes.
    if (touched) { touched = false; canvas.toggleAttribute('data-geometry-tick'); }
  }
  // #endregion geometry

  // #region pointer
  // ImGui has no platform backend here: the page sends it the pointer. An event the browser
  // gave to a field stays with the field. Everything else on the stage (the canvas, a blocker,
  // an overlay) goes to ImGui. Only the guard route asks ImGui anything here.
  const at = (event) => { const r = canvas.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top]; };
  let away = true;
  function onPointer(event) {
    const [x, y] = at(event);
    const el = event.target?.closest?.('[data-occ]');
    let own = !!el;
    if (el && route.eventScript) {
      stats.guardQueries++;
      if (!visibleAt(x, y)) {
        // An ImGui window is over the field here. ImGui takes the event and the field is parked.
        own = false;
        event.stopPropagation();
        if (event.type === 'pointerdown') event.preventDefault();
        const f = app.items[el.dataset.occ];
        if (f.gkey !== 'off') { f.gkey = 'off'; geometry(f.el, { canvasTransform: off() }); touched = false; canvas.toggleAttribute('data-geometry-tick'); }
      }
    }
    ctx.pointer = event.type === 'pointerup' && event.pointerType !== 'mouse' ? null : [x, y];
    if (own) {
      if (!away) { away = true; module._ui_pointer(-1e4, -1e4, -1); }
      return;
    }
    away = false;
    if (event.type === 'pointerdown') {
      try { (el ? canvas : event.target).setPointerCapture(event.pointerId); } catch {}
      module._ui_pointer(x, y, 1);
    } else if (event.type === 'pointerup') {
      module._ui_pointer(x, y, 0);
      if (event.pointerType !== 'mouse') { away = true; module._ui_pointer(-1e4, -1e4, -1); }
    } else module._ui_pointer(x, y, -1);
  }
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) stage.addEventListener(type, onPointer, true);
  stage.addEventListener('pointercancel', () => { ctx.pointer = null; away = true; module._ui_pointer(-1e4, -1e4, 0); }, true);
  stage.addEventListener('pointerleave', () => { ctx.pointer = null; if (!module._ui_busy()) { away = true; module._ui_pointer(-1e4, -1e4, -1); } });
  // #endregion pointer

  // A window "stopped moving" when no frame has reported a move for a quarter of a second and
  // nothing in ImGui is held.
  let timer = 0, start = null;
  const snapshot = () => ({ frames: app.stats.frames, paints: app.stats.paints, uploads: app.stats.uploads, geometry: stats.geometry, styleWrites: stats.styleWrites, guardQueries: stats.guardQueries });
  const since = (s) => { const now = snapshot(), out = {}; for (const k in now) out[k] = now[k] - s[k]; return out; };
  function settle() {
    if (module._ui_busy()) { timer = setTimeout(settle, 250); return; }
    api.lastMove = since(start);
    start = null;
    api.onSettled?.();
  }
  app.onFrame = (moved) => {
    if (moved && !start) { start = snapshot(); api.onMoveStart?.(); }
    apply();
    if (moved) { clearTimeout(timer); timer = setTimeout(settle, 250); }
  };

  api.matrix = matrix;
  api.snapshot = snapshot;
  api.since = since;
  api.apply = apply;
  api.visibleAt = visibleAt;
  api.route = () => routeId;
  api.setRoute = (id) => {
    if (!ROUTES[id]) throw new Error(`no route named ${id}`);
    routeId = id; route = ROUTES[id];
    apply();
    module._ui_wake();
  };
  // Forget what was sent, so the next apply() sends every field's geometry again.
  api.reset = () => { for (const f of fields) f.gkey = ''; for (const b of blockers) b.key = ''; apply(); };
  api.pointerAway = () => { ctx.pointer = null; away = true; module._ui_pointer(-1e4, -1e4, -1); };

  // Positions for the two covering windows, relative to the textarea and the input.
  api.preset = (name) => {
    const N = app.items.notes?.rect, I = app.items.name?.rect, H = canvas.clientHeight, W = canvas.clientWidth;
    if (!N || !I) return false;
    const set = (i, r) => module._ui_set_cover(i, r[0], r[1], r[2], r[3]);
    const homeA = [8, H - 116, 150, 104], homeB = [W - 158, H - 116, 150, 104];
    const places = {
      apart: [homeA, homeB],
      full: [[N[0], N[1], N[2], N[3]], homeB],
      side: [[N[0] + N[2] * 0.55, N[1] - 8, N[2] * 0.45 + 8, N[3] + 16], homeB],
      middle: [[N[0] + N[2] * 0.4, N[1] - 8, N[2] * 0.2, N[3] + 16], homeB],
      corner: [[N[0] + N[2] * 0.55, N[1] + N[3] * 0.45, N[2] * 0.45 + 8, N[3] * 0.55 + 8], homeB],
      two: [[N[0] + N[2] * 0.55, N[1] + N[3] * 0.45, N[2] * 0.45 + 8, N[3] * 0.55 + 8], [I[0] + I[2] * 0.35, I[1] - 30, I[2] * 0.25, I[3] + 44]],
    };
    if (!places[name]) return false;
    places[name].forEach((r, i) => set(i, r));
    return true;
  };

  // #region measure
  // A grid of sample points over each field. ImGui says whether a window above the form takes
  // the pointer at the point; the browser says which element its hit test finds there.
  //   wrong hit:  covered by a window, and the browser still answers the field
  //   lost hit:   not covered, inside the field's window, and the browser does not answer the field
  //   reach:      a wrong hit that the route would also let through to the field. Only the guard
  //               differs here: it stops the event in script after the browser's hit test.
  api.measure = ({ cols = 16, rows = 6 } = {}) => {
    canvas.toggleAttribute('data-geometry-tick');
    const box = canvas.getBoundingClientRect(), root = canvas.getRootNode();
    const view = root.defaultView ?? window;
    const out = { route: routeId, fields: [], samples: [], total: { points: 0, covered: 0, visible: 0, wrong: 0, reach: 0, lost: 0, unsampled: 0 } };
    for (const f of fields) {
      if (!f.rect) continue;
      const row = { name: f.name, points: 0, covered: 0, visible: 0, wrong: 0, reach: 0, lost: 0, unsampled: 0 };
      const [fx, fy, fw, fh] = f.rect;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = fx + (i + 0.5) * fw / cols, y = fy + (j + 0.5) * fh / rows;
        const px = box.left + x, py = box.top + y;
        if (px < 0 || py < 0 || px >= view.innerWidth || py >= view.innerHeight) { row.unsampled++; continue; }
        const covered = !!module._ui_covered_at(x, y), shown = !!f.clip && inside(f.clip, x, y);
        const target = root.elementFromPoint(px, py);
        const hit = !!target && (target === f.el || f.el.contains(target));
        const reach = hit && !(route.eventScript && !visibleAt(x, y));
        row.points++;
        if (covered) { row.covered++; if (hit) row.wrong++; if (reach) row.reach++; }
        else if (shown) { row.visible++; if (!hit) row.lost++; }
        out.samples.push({ x, y, covered, hit, reach, lost: !covered && shown && !hit });
      }
      const b = f.el.getBoundingClientRect();
      row.bounds = [b.x - box.left, b.y - box.top, b.width, b.height].map((v) => Math.round(v));
      out.fields.push(row);
      for (const k in out.total) out.total[k] += row[k];
    }
    return out;
  };
  // #endregion measure

  apply();
  return api;
}
