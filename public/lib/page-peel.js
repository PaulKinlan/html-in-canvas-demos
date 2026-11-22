// page-peel.js: peel an element back from its top right corner, like a sheet of paper, to show what is under it.
//
//   import { pagePeel } from '/lib/page-peel.js';
//   <div id="desk">                      position: relative; a fixed height
//     <div id="under">…</div>            position: absolute; inset: 0   (what the peel shows)
//     <div id="sheet" fx="page-peel">…</div>
//   </div>
//   const peel = pagePeel(sheet, { under, onChange: ({ state, amount }) => {} });
//   peel.open()   peel.away()   peel.close()   peel.state   'rest' | 'held' | 'open' | 'away'
//
// 'away' leaves the roll in the bottom left corner. Pressing it, or the round button, brings the sheet back.
//
// The sheet is drawn by the fx library (/lib/shader-fx.js): `page-peel` is an effect, in GLSL and in WGSL, that
// rolls the paper round a cylinder and lays it back over the sheet. Where the paper is gone the effect writes
// clear pixels, so the layer under the sheet shows through the canvas.
//
// This file adds what a shader cannot do:
//   - the corner follows a finger: two CSS properties, --fx-x and --fx-y, hold where the corner is, in pixels;
//   - input is split along the roll: a clip-path on the sheet's canvas host stops the sheet from taking taps
//     where the paper is gone, so the layer under it scrolls, selects and takes clicks there;
//   - the paper that lies on top of the sheet is covered by a button with the same outline, so a tap on the
//     back of the paper does not reach the part of the sheet that the paper hides. That button is the handle.
//
// Without the fx library, or when its canvas is lost, the same clip-path is put on the sheet itself: the corner
// is cut off along a straight line instead of rolled, and everything else works the same way.

import { defineEffect } from './effects.js';

/** The largest radius of the roll, in CSS pixels. The shader and the geometry below must agree on it. */
export const ROLL = 34;
/** The roll's radius as a share of the distance the corner has travelled, until it reaches ROLL. */
export const TIGHT = 0.22;

// #region shader
// p is a point of the canvas in CSS pixels. u_xy is where the corner of the paper is now.
// Along the direction the corner travelled, `along` measures from the corner's home:
//   along > D            flat paper, with the peeled part lying mirrored on top of it
//   D - R < along < D    the roll: the far side of the cylinder over the near side
//   along < D - R        no paper: clear, apart from the shadow of the roll
const GLSL = `
float pp_box(vec2 q) { vec2 d = abs(q - u_size * 0.5) - u_size * 0.5; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
vec4 pp_back(vec2 q, float shade) {
  vec4 c = tex(q);
  vec3 paper = mix(c.rgb, vec3(0.96, 0.95, 0.92) * c.a, 0.84);
  return vec4(paper * shade, c.a) * clamp(0.5 - pp_box(q), 0.0, 1.0);
}
vec4 fx(vec2 p) {
  const float PI = 3.14159265;
  vec2 home = vec2(u_size.x, 0.0);
  vec2 v = u_xy - home;
  float dist = length(v);
  if (dist < 0.5) return tex(p);
  vec2 dir = v / dist;
  float R = min(${ROLL.toFixed(1)}, dist * ${TIGHT});
  float D = (dist + PI * R) * 0.5;
  float along = dot(p - home, dir);
  float d = along - D;
  if (d >= 0.0) {
    vec4 col = tex(p);
    vec2 q = p + dir * (D - PI * R - d - along);
    float sd = pp_box(q);
    col.rgb *= 1.0 - 0.34 * (1.0 - smoothstep(0.0, 16.0, sd)) - 0.2 * exp(-d / (R * 0.7 + 1.0));
    vec4 back = pp_back(q, 1.0 - 0.3 * exp(-d / (R * 0.8 + 1.0)));
    return back + col * (1.0 - back.a);
  }
  if (d > -R) {
    float s = -d / R;
    vec4 col = vec4(0.0);
    vec4 near = tex(p + dir * (D - R * asin(s) - along));
    col = vec4(near.rgb * (1.0 - 0.5 * s), near.a);
    vec4 far = pp_back(p + dir * (D - R * (PI - asin(s)) - along), 0.7 + 0.3 * sqrt(1.0 - s * s) - 0.12 * s);
    return far + col * (1.0 - far.a);
  }
  vec2 edge = p + dir * (D - R * PI * 0.5 - along);
  float shadow = 0.42 * exp((d + R) / 9.0) * clamp(0.5 - pp_box(edge), 0.0, 1.0);
  return vec4(0.0, 0.0, 0.0, shadow);
}`;

const WGSL = `
fn pp_box(q: vec2f) -> f32 { let d = abs(q - u.size * 0.5) - u.size * 0.5; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn pp_back(q: vec2f, shade: f32) -> vec4f {
  let c = tex(q);
  let paper = mix(c.rgb, vec3f(0.96, 0.95, 0.92) * c.a, 0.84);
  return vec4f(paper * shade, c.a) * clamp(0.5 - pp_box(q), 0.0, 1.0);
}
fn fx(p: vec2f) -> vec4f {
  let PI = 3.14159265;
  let home = vec2f(u.size.x, 0.0);
  let v = u.xy - home;
  let dist = length(v);
  if (dist < 0.5) { return tex(p); }
  let dir = v / dist;
  let R = min(${ROLL.toFixed(1)}, dist * ${TIGHT});
  let D = (dist + PI * R) * 0.5;
  let along = dot(p - home, dir);
  let d = along - D;
  if (d >= 0.0) {
    var col = tex(p);
    let q = p + dir * (D - PI * R - d - along);
    let sd = pp_box(q);
    col = vec4f(col.rgb * (1.0 - 0.34 * (1.0 - smoothstep(0.0, 16.0, sd)) - 0.2 * exp(-d / (R * 0.7 + 1.0))), col.a);
    let back = pp_back(q, 1.0 - 0.3 * exp(-d / (R * 0.8 + 1.0)));
    return back + col * (1.0 - back.a);
  }
  if (d > -R) {
    let s = -d / R;
    let near = tex(p + dir * (D - R * asin(s) - along));
    let col = vec4f(near.rgb * (1.0 - 0.5 * s), near.a);
    let far = pp_back(p + dir * (D - R * (PI - asin(s)) - along), 0.7 + 0.3 * sqrt(1.0 - s * s) - 0.12 * s);
    return far + col * (1.0 - far.a);
  }
  let edge = p + dir * (D - R * PI * 0.5 - along);
  let shadow = 0.42 * exp((d + R) / 9.0) * clamp(0.5 - pp_box(edge), 0.0, 1.0);
  return vec4f(0.0, 0.0, 0.0, shadow);
}`;

defineEffect('page-peel', { glsl: GLSL, wgsl: WGSL, animated: false });
// #endregion shader

// #region geometry
/**
 * The same roll as the shader, as outlines. `corner` is where the paper's corner is, in pixels from the top
 * left of a sheet `w` by `h`. Returns three polygons (arrays of [x, y]):
 *   kept   where the sheet still takes input: everything from the roll onwards
 *   flap   the peeled paper lying on the sheet
 *   roll   the strip the cylinder covers
 * and `gone`, the share of the sheet's area that shows the layer under it.
 */
export function peelOutline(w, h, corner, margin = 0) {
  const rect = [[0, 0], [w, 0], [w, h], [0, h]];
  const vx = corner.x - w, vy = corner.y;
  const dist = Math.hypot(vx, vy);
  if (dist < 0.5) return { kept: rect, flap: [], roll: [], gone: 0, dist: 0, R: 0, D: 0 };
  const dx = vx / dist, dy = vy / dist;
  const R = Math.min(ROLL, dist * TIGHT);
  const D = (dist + Math.PI * R) / 2;
  const along = ([x, y]) => (x - w) * dx + y * dy;
  // Sutherland-Hodgman: the part of a convex polygon where sign * (along - limit) >= 0.
  const cut = (poly, limit, sign) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = sign * (along(a) - limit), db = sign * (along(b) - limit);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  };
  const kept = cut(rect, D - R - margin, 1);
  const roll = cut(cut(rect, D - R, 1), D, -1);
  // Paper that has gone all the way round lies flat again, mirrored: a point `s` along lands at 2D - πR - s.
  const flap = cut(rect, D - Math.PI * R, -1).map((q) => { const k = 2 * D - Math.PI * R - 2 * along(q); return [q[0] + dx * k, q[1] + dy * k]; });
  const area = (poly) => Math.abs(poly.reduce((sum, a, i) => { const b = poly[(i + 1) % poly.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  return { kept, flap, roll, gone: 1 - area(cut(rect, D - R, 1)) / (w * h), dist, R, D };
}
// #endregion geometry

const polygon = (points) => (points.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${points.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`);
const reduced = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

const STYLE = `
.page-peel-handle { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: clip; }
.page-peel-handle > * { position: absolute; pointer-events: auto; touch-action: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
.page-peel-handle > :active { cursor: grabbing; }
.page-peel-handle > div { inset: 0; }
.page-peel-handle > button { left: 0; top: 0; width: 52px; height: 52px; margin: -26px 0 0 -26px; padding: 0; border: 0; border-radius: 50%; background: none; }
.page-peel-handle > button:focus-visible { outline: 3px solid var(--accent, #d2491f); outline-offset: -3px; background: color-mix(in srgb, var(--accent, #d2491f) 18%, transparent); }
`;

/**
 * Make `sheet` peel. `under` is the layer below it (made inert while the sheet is at rest).
 * Options: rest (how far the corner is turned when nothing holds it, px), label, onChange.
 */
export function pagePeel(sheet, { under = null, rest = null, label = 'Peel the page back', onChange = () => {} } = {}) {
  const desk = sheet.closest('[data-peel-desk]') ?? sheet.parentElement;
  if (!document.getElementById('page-peel-style')) {
    const style = document.createElement('style');
    style.id = 'page-peel-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  // Three parts take the pointer: the paper lying on the sheet, the roll, and a round button on the paper's
  // corner. The button is the one a keyboard and a screen reader find. It also makes the corner large enough
  // for a finger while the paper is only turned a little.
  const handle = document.createElement('div');
  handle.className = 'page-peel-handle';
  handle.innerHTML = '<div data-part="flap"></div><div data-part="roll"></div><button type="button"></button>';
  const [flapPart, rollPart, grip] = handle.children;
  grip.setAttribute('aria-label', label);
  grip.setAttribute('aria-expanded', 'false');
  desk.append(handle);

  let w = 0, h = 0;
  let corner = { x: 0, y: 0 };
  let state = 'rest';
  let tween = 0;
  let outline = null;

  const restBy = () => rest ?? Math.max(30, Math.min(52, w * 0.075));
  const poses = {
    rest: () => ({ x: w - restBy(), y: restBy() }),
    // On a narrow window the paper comes down to the left and uncovers the top. On a wide one it goes
    // mostly sideways and uncovers a column on the right.
    open: () => (w > 700 ? { x: w - Math.min(w * 0.85, 1000), y: h * 0.34 } : { x: w * 0.2, y: Math.min(h * 0.86, w * 0.8 + h * 0.3) }),
    // Nearly all of the sheet has gone round the roll. A piece about 60 px deep stays in the bottom left
    // corner, with the roll on it, so that there is still something to press to bring the sheet back.
    away: () => { const k = Math.hypot(w, h); const dist = 2 * (k - 60) - Math.PI * ROLL; return { x: w - (w / k) * dist, y: (h / k) * dist }; },
  };

  // #region apply
  // The sheet's host is the <fx-surface> the fx library wrapped it in. Before that, and after a lost canvas, it is the sheet.
  const host = () => (sheet.parentElement?.localName === 'fx-surface' && sheet.parentElement.live ? sheet.parentElement : null);
  function apply() {
    if (!w || !h) return;
    outline = peelOutline(w, h, corner, 10);
    // The shader reads these two numbers.
    sheet.style.setProperty('--fx-x', corner.x.toFixed(1));
    sheet.style.setProperty('--fx-y', corner.y.toFixed(1));
    const surface = host();
    // Where the paper is gone the sheet must not take input. On the canvas host the clip only cuts clear
    // pixels (and the last 10 px of the roll's shadow). On a plain sheet it is the whole effect.
    const clip = polygon(surface ? outline.kept : peelOutline(w, h, corner, -outline.R).kept);
    if (surface) { surface.style.clipPath = clip; sheet.style.clipPath = ''; }
    else {
      sheet.style.clipPath = clip;
      // A host that has given up its canvas keeps the sheet as its child. Its old clip must not stay.
      if (sheet.parentElement?.localName === 'fx-surface') sheet.parentElement.style.clipPath = '';
    }
    flapPart.style.clipPath = polygon(surface ? outline.flap : []);
    rollPart.style.clipPath = polygon(surface ? outline.roll : []);
    grip.style.transform = `translate(${Math.max(26, Math.min(w - 26, corner.x)).toFixed(1)}px, ${Math.max(26, Math.min(h - 26, corner.y)).toFixed(1)}px)`;
  }
  // #endregion apply

  function setState(next) {
    if (state !== next) {
      state = next;
      grip.setAttribute('aria-expanded', String(next !== 'rest'));
      // At rest only a thumbnail-sized corner of the lower layer shows. Keep it out of the tab order and the accessibility tree.
      if (under) under.inert = next === 'rest';
      sheet.inert = next === 'away';
    }
    onChange({ state, amount: outline?.gone ?? 0, corner: { ...corner } });
  }

  function moveTo(target, next, ms = 520) {
    cancelAnimationFrame(tween);
    const from = { ...corner };
    const start = performance.now();
    if (reduced.matches || ms <= 0) { corner = target; apply(); setState(next); return; }
    if (next !== 'rest') setState('held');
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      corner = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      apply();
      if (t < 1) { onChange({ state, amount: outline.gone, corner: { ...corner } }); tween = requestAnimationFrame(step); }
      else setState(next);
    };
    tween = requestAnimationFrame(step);
  }

  // #region drag
  // The handle is the peeled paper itself. Pointer capture keeps the drag when the finger leaves the paper,
  // and touch-action: none on the handle stops the page scrolling under it. Everything else scrolls as usual.
  let drag = null;
  const local = (e) => { const r = desk.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e) => {
    if (e.button) return;
    cancelAnimationFrame(tween);
    const p = local(e);
    drag = { id: e.pointerId, dx: corner.x - p.x, dy: corner.y - p.y, moved: 0, from: p, was: state };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = local(e);
    drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.from.x, p.y - drag.from.y));
    if (drag.moved < 5) return;
    // The corner cannot go above or to the right of where it started.
    corner = { x: Math.min(w, p.x + drag.dx), y: Math.max(0, p.y + drag.dy) };
    apply();
    setState('held');
  };
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, was } = drag;
    drag = null;
    if (moved < 5) return toggle(was);
    const travelled = Math.hypot(corner.x - w, corner.y) / Math.hypot(w, h);
    if (travelled < 0.16) moveTo(poses.rest(), 'rest', 260);
    else if (travelled > 0.8) moveTo(poses.away(), 'away', 420);
    else setState('open');
  };
  for (const button of [flapPart, rollPart, grip]) {
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointermove', move);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
  }
  // #endregion drag

  const toggle = (from = state) => (from === 'rest' ? moveTo(poses.open(), 'open') : moveTo(poses.rest(), 'rest'));
  // A keyboard press arrives as a click with no pointer events before it.
  grip.addEventListener('click', (e) => { if (e.detail === 0) toggle(); });
  grip.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state !== 'rest') moveTo(poses.rest(), 'rest'); });

  // The sheet keeps its place when the desk changes size: rest and away are poses, a held corner keeps its share of the width and height.
  new ResizeObserver(() => {
    const nw = desk.clientWidth, nh = desk.clientHeight;
    if (!nw || !nh || (nw === w && nh === h)) return;
    const first = !w;
    const share = first ? null : { x: corner.x / w, y: corner.y / h };
    w = nw; h = nh;
    if (first || state === 'rest') corner = poses.rest();
    else if (state === 'away') corner = poses.away();
    else corner = { x: share.x * w, y: share.y * h };
    apply();
    if (first) { if (under) under.inert = true; onChange({ state, amount: outline.gone, corner: { ...corner } }); }
  }).observe(desk);
  // The fx library wraps the sheet a moment after this runs, and may hand it back later: move the clip with it.
  new MutationObserver(apply).observe(desk, { childList: true });
  sheet.addEventListener('surfacefallback', () => queueMicrotask(apply));
  addEventListener('surfacefallback', () => queueMicrotask(apply));

  return {
    handle,
    get state() { return state; },
    get corner() { return { ...corner }; },
    get outline() { return outline; },
    get drawn() { return !!host(); },
    open: () => moveTo(poses.open(), 'open'),
    away: () => moveTo(poses.away(), 'away'),
    close: () => moveTo(poses.rest(), 'rest'),
    set(x, y) { cancelAnimationFrame(tween); corner = { x, y }; apply(); setState('held'); },
    refresh: apply,
  };
}
