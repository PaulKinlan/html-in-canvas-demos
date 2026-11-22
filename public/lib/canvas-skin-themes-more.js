// canvas-skin-themes-more.js: skins for <canvas-skin> that are drawn with 2D canvas calls and SVG filters.
// Thermal camera, neon sign, embroidery, Christmas, seaside. A skin is described at the top of canvas-skin-themes.js, and the
// shapes of each kind of element come from parts() in canvas-skin-draw.js.

import { TAU, clamp, lerp, smooth, rng, rr, circle, line, knobX, parts, grab, cells, maskTile } from './canvas-skin-draw.js';

// ------------------------------------------------------------------------------------------ thermal
// #region thermal
// The "ironbow" palette of a thermal camera: 0 is cold, 1 is hot.
const IRON = [[0, [5, 3, 26]], [0.18, [42, 10, 107]], [0.38, [138, 26, 143]], [0.58, [224, 64, 47]], [0.76, [255, 154, 31]], [0.9, [255, 225, 74]], [1, [255, 255, 255]]];
function ironRgb(t) {
  t = clamp(t);
  for (let i = 1; i < IRON.length; i++) {
    if (t <= IRON[i][0]) {
      const [t0, a] = IRON[i - 1], [t1, b] = IRON[i], k = (t - t0) / (t1 - t0);
      return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    }
  }
  return [255, 255, 255];
}
const iron = (t, alpha = 1) => { const [r, g, b] = ironRgb(t); return `rgb(${r | 0} ${g | 0} ${b | 0} / ${alpha})`; };
const ironTable = (channel) => Array.from({ length: 13 }, (_, i) => (ironRgb(i / 12)[channel] / 255).toFixed(3)).join(' ');

// Where the page was touched in the last few seconds, in page coordinates. A touch leaves heat that fades.
const COOL_MS = 4500;
const touches = [];
let listening = false;
function listenForTouches() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  const add = (event) => {
    const now = performance.now(), x = event.clientX + scrollX, y = event.clientY + scrollY, down = event.type === 'pointerdown' || event.buttons > 0 || event.pointerType !== 'mouse';
    const last = touches.at(-1);
    if (event.type === 'pointermove' && last && Math.hypot(last.x - x, last.y - y) < 14) return;
    while (touches.length && now - touches[0].time > COOL_MS) touches.shift();
    if (touches.length > 40) touches.shift();
    touches.push({ x, y, time: now, heat: down ? 0.5 : 0.22 });
    const wrapper = event.target?.closest?.('canvas-skin');
    if (wrapper?.getAttribute('now') === 'thermal') wrapper.request?.();
  };
  document.addEventListener('pointerdown', add, { passive: true });
  document.addEventListener('pointermove', add, { passive: true });
}
// The fading marks of recent touches that lie on this element, over a surface at temperature T.
function touchHeat(ctx, f, T) {
  const now = performance.now();
  let box = null;
  for (const p of touches) {
    const age = (now - p.time) / COOL_MS;
    if (age >= 1) continue;
    box ??= f.el.getBoundingClientRect();
    const x = p.x - scrollX - box.left, y = p.y - scrollY - box.top, R = 26 + 26 * age;   // the mark spreads as it cools
    if (x < -R || y < -R || x > f.width + R || y > f.height + R) continue;
    const heat = p.heat * (1 - age) ** 1.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, iron(T + heat)); g.addColorStop(0.45, iron(T + heat * 0.55, 0.85)); g.addColorStop(1, iron(T, 0));
    ctx.fillStyle = g; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
    f.again = true;
  }
}
// Each element's own temperature, eased: it warms quickly and cools slowly.
const warmth = new WeakMap();
const THERMAL_TYPE = 'color: #fff3c4; color-scheme: dark; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;';

const thermal = {
  label: 'Thermal camera',
  type: THERMAL_TYPE,
  root: `${THERMAL_TYPE} background-color: #070318; background-image: radial-gradient(60% 40% at 20% 10%, rgb(70 20 120 / .5), rgb(70 20 120 / 0)), radial-gradient(50% 35% at 85% 70%, rgb(50 14 110 / .45), rgb(50 14 110 / 0));`,
  css: 'caret-color: #fff; & ::placeholder { color: rgb(255 243 196 / .55); } &[kind="button"] > .primary { color: #1a0030; }',
  filters: `
    <filter id="thermal-map" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.6"/>
      <feColorMatrix type="matrix" values=".3 .59 .11 0 0  .3 .59 .11 0 0  .3 .59 .11 0 0  0 0 0 1 0"/>
      <feComponentTransfer><feFuncR type="table" tableValues="${ironTable(0)}"/><feFuncG type="table" tableValues="${ironTable(1)}"/><feFuncB type="table" tableValues="${ironTable(2)}"/></feComponentTransfer>
    </filter>`,

  paint(ctx, f) {
    listenForTouches();
    const { width: w, height: h, kind, state: s } = f;
    const base = { button: f.primary ? 0.74 : 0.5, field: 0.22, card: 0.13, check: 0.3 + 0.5 * s.on, radio: 0.3 + 0.5 * s.on, switch: 0.28 + 0.4 * s.on, range: 0.3, bar: 0.3 }[kind] ?? 0;
    const target = base + (s.hover ? 0.07 : 0) + (s.active ? 0.22 : 0) + (s.focus ? 0.1 : 0);
    let T = warmth.get(f.el) ?? target;
    T += (target - T) * (target > T ? 0.2 : 0.04);
    if (Math.abs(target - T) > 0.004) f.again = true; else T = target;
    warmth.set(f.el, T);
    T *= smooth(f.t);                                   // an element starts cold when the skin arrives
    const glow = 9 * f.scale;
    const hot = (path, t, clip = true) => {
      ctx.save();
      path(); ctx.shadowColor = iron(t, 0.9); ctx.shadowBlur = glow;
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, iron(t - 0.05)); g.addColorStop(0.5, iron(t + 0.04)); g.addColorStop(1, iron(t - 0.07));
      ctx.fillStyle = g; ctx.fill();
      if (clip) { ctx.shadowBlur = 0; ctx.clip(); touchHeat(ctx, f, t); }
      ctx.restore();
    };
    const role = { body: 0, primary: 0, well: 0, frame: 0, track: -0.1, fill: 0.3, knob: 0.22 + 0.35 * (kind === 'range' ? s.value : s.on), dot: 0.5 };
    const what = parts(ctx, f, (path, r) => {
      if (r === 'mark') { ctx.save(); path(); ctx.strokeStyle = kind === 'check' ? iron(0.04) : iron(0.9); ctx.lineWidth = kind === 'check' ? 3.5 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); return; }
      if (r === 'fill' && (kind === 'range' || kind === 'bar')) {
        // The filled part is a thermometer: cold at the start, as hot as the value at the end.
        ctx.save(); path(); const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, iron(0.3)); g.addColorStop(1, iron(0.3 + 0.7 * 1));
        ctx.shadowColor = iron(0.3 + 0.6 * s.value, 0.8); ctx.shadowBlur = glow; ctx.fillStyle = g; ctx.fill(); ctx.restore(); return;
      }
      hot(path, T + role[r], r !== 'knob' && r !== 'dot');
    });
    if (what === 'media') f.draw({ filter: 'url(#thermal-map)' });
    else if (what === 'text') { ctx.save(); rr(ctx, -5, -3, w + 10, h + 6, 8); ctx.clip(); touchHeat(ctx, f, 0.02); ctx.restore(); f.draw({ alpha: 0.35 + 0.65 * f.t }); }
    else if (what === 'picture') f.draw();
    if (s.focus) {
      // The spot meter of a thermal camera: corner brackets and a reading.
      ctx.save(); ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
      for (const [x, y, dx, dy] of [[-4, -4, 1, 1], [w + 4, -4, -1, 1], [w + 4, h + 4, -1, -1], [-4, h + 4, 1, -1]]) { ctx.beginPath(); ctx.moveTo(x + dx * 9, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * 9); ctx.stroke(); }
      if (w > 70) { ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillText(`${(19 + T * 19).toFixed(1)}°`, w - 8, -5); }
      ctx.restore();
    }
  },
};
// #endregion thermal

// --------------------------------------------------------------------------------------------- neon
// #region neon
const NEON = { pink: '#ff3fb4', cyan: '#34e6ff', amber: '#ffb52e', green: '#5dff7a', violet: '#a97bff', off: '#4b4453' };
const NEON_TYPE = 'color: #d9d2e6; color-scheme: dark; font-family: "Arial Rounded MT Bold", "Varela Round", Nunito, "Trebuchet MS", system-ui, sans-serif;';
const BRICKS = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='48'%3E%3Crect width='64' height='48' fill='%231c1016'/%3E%3Cpath d='M0 1h64M0 25h64M1 0v24M33 24v24' stroke='%23000' stroke-opacity='.55' stroke-width='2'/%3E%3Cpath d='M3 3h28v1H3zM35 3h28v1H35zM3 27h28v1H3zM35 27h28v1H35z' fill='%23fff' fill-opacity='.05'/%3E%3C/svg%3E\")";
const neonGlow = (id, color) => `
    <filter id="${id}" x="-15%" y="-40%" width="130%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="wide"/>
      <feFlood flood-color="${color}"/><feComposite in2="wide" operator="in" result="halo"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="near"/>
      <feFlood flood-color="${color}"/><feComposite in2="near" operator="in" result="core"/>
      <feMerge><feMergeNode in="halo"/><feMergeNode in="core"/><feMergeNode in="core"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
// How bright a tube is while it starts: off, a few flickers, then steady.
function strike(f) {
  if (f.t >= 1) return 1;
  if (f.t < 0.12) return 0;
  if (f.t > 0.8) return 1;
  return rng(f.seed + Math.floor(f.t * 16))() > 0.42 ? 1 : 0.12;
}
// A glass tube along the current path: grey glass, then the gas, its glow on the wall, and a white core.
function tube(ctx, f, path, color, lit = 1, width = 3) {
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = NEON.off; ctx.lineWidth = width; ctx.stroke();
  if (lit > 0.01) {
    ctx.globalAlpha *= lit;
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 11 * f.scale; ctx.stroke();
    ctx.shadowBlur = 4 * f.scale; ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.globalAlpha *= 0.85; ctx.lineWidth = width * 0.38; ctx.stroke();
  }
  ctx.restore();
}

const neon = {
  label: 'Neon sign',
  type: NEON_TYPE,
  root: `${NEON_TYPE} background-color: #1c1016; background-image: radial-gradient(90% 60% at 50% 30%, rgb(255 63 180 / .1), rgb(0 0 0 / .35)), ${BRICKS};`,
  css: `caret-color: ${NEON.amber}; color: #fff; & ::placeholder { color: rgb(255 255 255 / .45); } &[kind="text"] > :not(h1, h2, h3, h4) { color: #d9d2e6; }`,
  filters: `${neonGlow('neon-pink', NEON.pink)}${neonGlow('neon-cyan', NEON.cyan)}${neonGlow('neon-amber', NEON.amber)}
    <filter id="neon-edges" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="grey"/>
      <feConvolveMatrix in="grey" order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edge"/>
      <feColorMatrix in="edge" type="matrix" values="0 0 0 0 .2  0 0 0 0 .9  0 0 0 0 1  3 3 3 0 0" result="lines"/>
      <feGaussianBlur in="lines" stdDeviation="2.5" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="lines"/></feMerge>
    </filter>`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const on = s.disabled ? 0 : strike(f);              // a disabled control is a tube that has gone out
    const bright = on * (s.active ? 1 : s.hover ? 0.95 : 0.9);
    const color = { button: f.primary ? NEON.pink : NEON.cyan, field: NEON.amber, card: NEON.violet, check: NEON.green, radio: NEON.green, switch: NEON.pink, range: NEON.cyan, bar: NEON.amber }[kind] ?? NEON.pink;
    const what = parts(ctx, f, (path, role) => {
      switch (role) {
        case 'primary': tube(ctx, f, path, color, bright); tube(ctx, f, () => rr(ctx, 6, 6, w - 12, h - 12, h / 2), color, bright * 0.7, 1.6); break;
        case 'body': tube(ctx, f, path, color, bright); break;
        // A field's outline is unlit glass until the field has focus. Its underline is always lit.
        case 'well': if (kind === 'field') { tube(ctx, f, path, color, s.focus ? bright : 0, 2.4); tube(ctx, f, () => { ctx.beginPath(); ctx.moveTo(12, h - 7); ctx.lineTo(w - 12, h - 7); }, color, bright, 2.4); } else tube(ctx, f, path, color, bright * (0.35 + 0.65 * s.on)); break;
        case 'frame': tube(ctx, f, path, color, bright * 0.8, 2.4); break;
        case 'track': tube(ctx, f, path, color, kind === 'switch' ? bright * 0.15 : 0, kind === 'switch' ? 3 : 2.4); break;
        case 'fill': tube(ctx, f, kind === 'switch' || kind === 'check' ? path : () => { ctx.beginPath(); ctx.moveTo(2, h / 2); ctx.lineTo(Math.max(2, (kind === 'range' ? knobX(f, s.value) : w * s.value) - 2), h / 2); }, color, bright, kind === 'bar' ? 5 : 3); break;
        case 'knob': ctx.save(); path(); ctx.fillStyle = '#1c1016'; ctx.fill(); ctx.restore(); tube(ctx, f, () => circle(ctx, knobX(f, kind === 'range' ? s.value : s.on), h / 2, h / 2 - (kind === 'range' ? 4 : 7)), kind === 'range' ? NEON.pink : '#fff', bright); break;
        case 'dot': ctx.save(); path(); ctx.fillStyle = '#fff'; ctx.shadowColor = color; ctx.shadowBlur = 10 * f.scale; ctx.globalAlpha *= on; ctx.fill(); ctx.restore(); break;
        default: tube(ctx, f, path, kind === 'check' ? '#fff' : color, bright, 2.6);
      }
      if ((role === 'body' || role === 'primary') && (s.active || s.hover)) { ctx.save(); path(); ctx.globalAlpha *= s.active ? 0.22 : 0.09; ctx.fillStyle = color; ctx.fill(); ctx.restore(); }
    }, { pill: true, radius: 10 });
    const alpha = 0.25 + 0.75 * on;
    if (what === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, 12); ctx.fillStyle = 'rgb(10 6 14 / .7)'; ctx.fill(); ctx.clip(); f.draw({ filter: 'url(#neon-edges)', alpha }); ctx.restore(); tube(ctx, f, () => rr(ctx, 0, 0, w, h, 12), NEON.pink, bright); }
    else if (what === 'text') f.draw(f.heading ? { filter: 'url(#neon-pink)', alpha } : { alpha: 0.4 + 0.6 * f.t });
    else if (what === 'picture') f.draw({ filter: kind === 'field' ? 'url(#neon-amber)' : kind === 'card' ? null : f.primary ? 'url(#neon-pink)' : 'url(#neon-cyan)', alpha });
    if (s.focus && kind !== 'field') tube(ctx, f, () => rr(ctx, -5, -5, w + 10, h + 10, kind === 'button' ? h / 2 + 5 : 9), '#fff', 0.8, 1.4);
    if (f.t < 1) f.again = true;
  },
};
// #endregion neon

// --------------------------------------------------------------------------------------- embroidery
// #region embroidery
const THREAD = { red: '#b3243a', navy: '#1f3a6e', mustard: '#d49a1a', green: '#2f6b4a', cream: '#fbf5e6', linen: '#e8dcc3' };
const SEW_TYPE = `color: ${THREAD.navy}; color-scheme: light; font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;`;
// One cross stitch, and the light on its upper thread, as tiles for cells().
const crossTile = () => maskTile('cross', (x) => { x.lineCap = 'round'; x.lineWidth = 0.3; x.beginPath(); x.moveTo(0.2, 0.2); x.lineTo(0.8, 0.8); x.moveTo(0.8, 0.2); x.lineTo(0.2, 0.8); x.stroke(); });
const crossShine = () => maskTile('cross-shine', (x) => {
  x.lineCap = 'round'; x.lineWidth = 0.3; x.strokeStyle = 'rgb(0 0 0 / .22)'; x.beginPath(); x.moveTo(0.2, 0.2); x.lineTo(0.8, 0.8); x.stroke();
  x.lineWidth = 0.09; x.strokeStyle = 'rgb(255 255 255 / .5)'; x.beginPath(); x.moveTo(0.74, 0.2); x.lineTo(0.2, 0.74); x.stroke();
});
// Stitches along the current path: a shadow under the thread, the thread, and a line of light on it.
function stitch(ctx, path, color, { len = 7, gap = 4, width = 2.2 } = {}) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.setLineDash([len, gap + width]); ctx.lineWidth = width;
  ctx.translate(0, 0.9); path(); ctx.strokeStyle = 'rgb(40 25 10 / .35)'; ctx.stroke();
  ctx.translate(0, -0.9); path(); ctx.strokeStyle = color; ctx.stroke();
  ctx.translate(0, -0.45); path(); ctx.strokeStyle = 'rgb(255 255 255 / .35)'; ctx.lineWidth = width * 0.3; ctx.stroke();
  ctx.restore();
}
// A piece of felt sewn on: the current path filled, lifted off the cloth by a shadow.
function felt(ctx, f, path, color, lift = 1) {
  ctx.save(); path();
  ctx.shadowColor = 'rgb(50 32 12 / .45)'; ctx.shadowBlur = 4 * lift * f.scale; ctx.shadowOffsetY = 1.6 * lift * f.scale;
  ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
// A shirt button with four holes and a cross of thread.
function sewnButton(ctx, f, x, y, r, thread) {
  felt(ctx, f, () => circle(ctx, x, y, r), '#f7f0df');
  ctx.save();
  circle(ctx, x, y, r * 0.72); ctx.strokeStyle = 'rgb(120 96 60 / .5)'; ctx.lineWidth = 1; ctx.stroke();
  const o = r * 0.28;
  ctx.fillStyle = '#5b4630'; for (const [dx, dy] of [[-o, -o], [o, -o], [o, o], [-o, o]]) { circle(ctx, x + dx, y + dy, r * 0.12); ctx.fill(); }
  ctx.strokeStyle = thread; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round'; line(ctx, x - o, y - o, x + o, y + o); line(ctx, x + o, y - o, x - o, y + o);
  ctx.restore();
}

const embroidery = {
  label: 'Embroidery',
  type: SEW_TYPE,
  root: `${SEW_TYPE} background-color: ${THREAD.linen}; background-image: repeating-linear-gradient(0deg, rgb(120 96 60 / .16) 0 1px, rgb(120 96 60 / 0) 1px 3px), repeating-linear-gradient(90deg, rgb(120 96 60 / .16) 0 1px, rgb(120 96 60 / 0) 1px 3px);`,
  css: `caret-color: ${THREAD.red}; & ::placeholder { color: rgb(31 58 110 / .5); } &[kind="button"] > .primary { color: ${THREAD.cream}; } &[kind="text"] > :is(h1, h2, h3, h4) { color: ${THREAD.red}; }`,
  filters: `
    <filter id="thread" x="-5%" y="-15%" width="110%" height="130%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="1.1 .09" numOctaves="1" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.5 0 0 0 .3" result="grain"/>
      <feComposite in="SourceGraphic" in2="grain" operator="in" result="ink"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation=".8" result="a"/>
      <feSpecularLighting in="a" surfaceScale="2" specularConstant=".6" specularExponent="14" lighting-color="#fff" result="light"><feDistantLight azimuth="235" elevation="52"/></feSpecularLighting>
      <feComposite in="light" in2="SourceAlpha" operator="in" result="lit"/>
      <feOffset in="SourceAlpha" dy="1" result="o"/><feGaussianBlur in="o" stdDeviation=".7" result="soft"/>
      <feColorMatrix in="soft" type="matrix" values="0 0 0 0 .2  0 0 0 0 .12  0 0 0 0 .05  0 0 0 .5 0" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/><feMergeNode in="ink"/><feMergeNode in="lit"/></feMerge>
    </filter>`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s, bleed: b } = f;
    const t = f.t;
    // A picture is cross-stitched: the element's picture becomes a grid of crosses, made row by row
    // while the skin arrives.
    if (kind === 'media') {
      const shot = grab(ctx, f);
      cells(ctx, f, shot, 4.5, crossTile(), { shine: crossShine(), rows: t, boost: 1 });
      {
        ctx.save(); ctx.globalCompositeOperation = 'destination-over';
        rr(ctx, -3, -3, w + 6, h + 6, 4); ctx.fillStyle = THREAD.cream; ctx.fill(); ctx.restore();
        stitch(ctx, () => rr(ctx, -3, -3, w + 6, h + 6, 4), THREAD.red, { len: 6, gap: 3 });
      }
      if (t < 1) { const y = -b + (h + 2 * b) * t; ctx.save(); ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; const x = w * (0.5 + 0.5 * Math.sin(t * 40)); line(ctx, x, y, x + 14, y - 12); ctx.restore(); }
      return;
    }
    if (t < 1) { ctx.beginPath(); ctx.rect(-b, -b, w + 2 * b, (h + 2 * b) * t); ctx.clip(); }
    const what = parts(ctx, f, (path, role) => {
      switch (role) {
        case 'primary': felt(ctx, f, path, THREAD.red, s.active ? 0.3 : 1); stitch(ctx, () => rr(ctx, 4, 4, w - 8, h - 8, 7), THREAD.cream); break;
        case 'body': felt(ctx, f, path, s.active ? '#efe6cf' : THREAD.cream, s.active ? 0.3 : 1); stitch(ctx, () => rr(ctx, 4, 4, w - 8, h - 8, 7), THREAD.navy); break;
        case 'well':
          ctx.save(); path(); ctx.fillStyle = 'rgb(251 245 230 / .75)'; ctx.fill(); ctx.restore();
          stitch(ctx, path, s.focus ? THREAD.red : THREAD.navy, { len: 6, gap: 0.5, width: kind === 'field' ? 2 : 2.4 });
          break;
        case 'frame': stitch(ctx, () => rr(ctx, 3, 3, w - 6, h - 6, 8), THREAD.mustard, { len: 8, gap: 5 }); break;
        case 'track':
          if (kind === 'switch') { felt(ctx, f, path, '#cbbf9f', 0.5); stitch(ctx, () => rr(ctx, 3, 5, w - 6, h - 10, h / 2), THREAD.navy, { len: 4, gap: 3, width: 1.6 }); }
          else if (kind === 'range') stitch(ctx, () => { ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); }, 'rgb(31 58 110 / .45)', { len: 6, gap: 3, width: 1.8 });
          break;
        case 'fill':
          if (kind === 'check') stitch(ctx, path, THREAD.navy, { len: 6, gap: 0.5, width: 2.4 });
          else if (kind === 'switch') { felt(ctx, f, path, THREAD.green, 0.5); stitch(ctx, () => rr(ctx, 3, 5, w - 6, h - 10, h / 2), THREAD.cream, { len: 4, gap: 3, width: 1.6 }); }
          else if (kind === 'range') stitch(ctx, () => { ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(knobX(f, s.value), h / 2); }, THREAD.red, { len: 8, gap: 1, width: 4 });
          break;
        case 'knob': sewnButton(ctx, f, knobX(f, kind === 'range' ? s.value : s.on), h / 2, h / 2 - (kind === 'range' ? 1 : 3), THREAD.red); break;
        case 'dot': {
          // Satin stitch: a disc of thread, lines of light across it.
          felt(ctx, f, path, THREAD.red, 0.4); ctx.save(); path(); ctx.clip(); ctx.strokeStyle = 'rgb(255 255 255 / .3)'; ctx.lineWidth = 0.8;
          for (let y = 2; y < h; y += 2.4) line(ctx, 0, y, w, y - 3); ctx.restore(); break;
        }
        default:
          if (kind === 'check') {
            // The tick is one large cross stitch, the second thread laid after the first.
            const m = 7, a = clamp(s.on * 2), c = clamp(s.on * 2 - 1);
            stitch(ctx, () => { ctx.beginPath(); ctx.moveTo(m, m); ctx.lineTo(lerp(m, w - m, a), lerp(m, h - m, a)); }, THREAD.red, { len: 40, gap: 0, width: 4 });
            if (c > 0) stitch(ctx, () => { ctx.beginPath(); ctx.moveTo(w - m, m); ctx.lineTo(lerp(w - m, m, c), lerp(m, h - m, c)); }, THREAD.red, { len: 40, gap: 0, width: 4 });
          } else stitch(ctx, path, THREAD.navy, { len: 40, gap: 0, width: 2 });
      }
    }, { radius: 9 });
    if (kind === 'bar') {
      // A row of cross stitches, sewn up to the value. The rest of the row is the holes in the cloth.
      ctx.clearRect(-b, -b, w + 2 * b, h + 2 * b);
      const n = Math.max(4, Math.floor(w / 11)), cw = w / n, size = Math.min(cw, h + 6) * 0.36, done = Math.round(n * s.value);
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * cw, y = h / 2;
        if (i < done) { stitch(ctx, () => { ctx.beginPath(); ctx.moveTo(x - size, y - size); ctx.lineTo(x + size, y + size); }, THREAD.green, { len: 40, gap: 0, width: 2.6 }); stitch(ctx, () => { ctx.beginPath(); ctx.moveTo(x + size, y - size); ctx.lineTo(x - size, y + size); }, THREAD.green, { len: 40, gap: 0, width: 2.6 }); }
        else { ctx.save(); ctx.fillStyle = 'rgb(90 70 40 / .45)'; for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { circle(ctx, x + dx * size, y + dy * size, 0.9); ctx.fill(); } ctx.restore(); }
      }
    }
    if (kind === 'radio') {
      // The ring is a circle of knots.
      ctx.save(); ctx.fillStyle = s.focus ? THREAD.red : THREAD.navy;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; circle(ctx, w / 2 + Math.cos(a) * (h / 2 - 2), h / 2 + Math.sin(a) * (h / 2 - 2), 1.7); ctx.fill(); }
      ctx.restore();
    }
    if (what === 'picture' || what === 'text') f.draw({ filter: 'url(#thread)' });
    if (s.focus && kind !== 'field' && kind !== 'radio') stitch(ctx, () => rr(ctx, -4, -4, w + 8, h + 8, 10), THREAD.mustard, { len: 5, gap: 3, width: 2 });
  },
};
// #endregion embroidery

// ---------------------------------------------------------------------------------------- christmas
// #region christmas
const XMAS = { red: '#b01e28', green: '#1f7a4a', pine: '#0f3a2e', gold: '#e8b923', cream: '#fff8ea' };
const XMAS_TYPE = `color: ${XMAS.cream}; color-scheme: dark; font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;`;
const BULBS = ['#ff4d4d', '#ffd24d', '#4dd17a', '#4da6ff'];
// Snow lying on the top edge from x0 to x1: a row of mounds, as deep as `depth`.
function snowCap(ctx, f, x0, x1, y, depth) {
  if (depth < 0.3 || x1 - x0 < 10) return;
  const rand = rng(f.seed + 11);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(x0, y + 2);
  let x = x0;
  while (x < x1) { const step = Math.min(x1 - x, 9 + rand() * 14), top = y - depth * (0.55 + rand() * 0.6); ctx.quadraticCurveTo(x + step / 2, top - depth * 0.5, x + step, y - depth * 0.25 + (x + step >= x1 ? 2 + depth * 0.25 : 0)); x += step; }
  // The lower edge hangs over the front in drips.
  while (x > x0) { const step = Math.min(x - x0, 8 + rand() * 12); ctx.quadraticCurveTo(x - step / 2, y + 2 + depth * (0.2 + rand() * 0.5), x - step, y + 2); x -= step; }
  ctx.closePath();
  ctx.shadowColor = 'rgb(0 20 40 / .35)'; ctx.shadowBlur = 3 * f.scale; ctx.shadowOffsetY = 1 * f.scale;
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}
// A glass ball on a tree: a sphere, a point of light, a gold cap.
function bauble(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
  g.addColorStop(0, '#fff'); g.addColorStop(0.25, color); g.addColorStop(1, '#3a0a10');
  circle(ctx, x, y, r); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = XMAS.gold; ctx.fillRect(x - r * 0.22, y - r - 2, r * 0.44, 3.5);
}

const christmas = {
  label: 'Christmas',
  type: XMAS_TYPE,
  root: `${XMAS_TYPE} background-color: ${XMAS.pine}; background-image: radial-gradient(circle at 20px 30px, rgb(255 255 255 / .55) 0 1.4px, rgb(255 255 255 / 0) 2px), radial-gradient(circle at 70px 80px, rgb(255 255 255 / .4) 0 1px, rgb(255 255 255 / 0) 1.6px), radial-gradient(circle at 100px 14px, rgb(255 255 255 / .3) 0 1.8px, rgb(255 255 255 / 0) 2.4px), linear-gradient(180deg, #164a3a, #0a2a20); background-size: 120px 120px, 120px 120px, 120px 120px, auto;`,
  css: `caret-color: ${XMAS.gold}; & ::placeholder { color: rgb(255 248 234 / .55); } &[kind="button"] > .primary { color: #2a1a00; }`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s } = f;
    const depth = 7 * smooth(f.t);                     // the snow settles while the skin arrives
    const what = parts(ctx, f, (path, role) => {
      ctx.save();
      switch (role) {
        case 'primary': case 'body': {
          path(); ctx.shadowColor = 'rgb(0 0 0 / .4)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = (s.active ? 1 : 3) * f.scale;
          ctx.fillStyle = role === 'primary' ? XMAS.gold : XMAS.red; ctx.fill(); ctx.shadowColor = 'transparent';
          // A parcel: a ribbon down the left and across the middle.
          ctx.clip(); ctx.fillStyle = role === 'primary' ? XMAS.red : XMAS.gold; ctx.globalAlpha *= 0.9; ctx.fillRect(14, 0, 6, h); ctx.fillRect(0, h - 9, w, 3);
          break;
        }
        case 'well':
          // A frosted window: pale glass, frost in the corners.
          path(); ctx.fillStyle = 'rgb(200 228 255 / .16)'; ctx.fill(); ctx.strokeStyle = s.focus ? XMAS.gold : 'rgb(255 255 255 / .7)'; ctx.lineWidth = s.focus ? 2.5 : 1.5; ctx.stroke(); ctx.clip();
          for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) { const g = ctx.createRadialGradient(x, y, 0, x, y, 26); g.addColorStop(0, 'rgb(255 255 255 / .6)'); g.addColorStop(1, 'rgb(255 255 255 / 0)'); ctx.fillStyle = g; ctx.fillRect(x - 26, y - 26, 52, 52); }
          break;
        case 'frame': path(); ctx.fillStyle = 'rgb(0 0 0 / .18)'; ctx.fill(); ctx.strokeStyle = 'rgb(255 248 234 / .35)'; ctx.lineWidth = 1; ctx.stroke(); break;
        case 'track': path(); ctx.fillStyle = '#082019'; ctx.fill(); ctx.strokeStyle = 'rgb(255 255 255 / .35)'; ctx.lineWidth = 1; ctx.stroke(); break;
        case 'fill':
          path();
          if (kind === 'check' || kind === 'switch') { ctx.fillStyle = XMAS.green; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
          else { ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip(); ctx.strokeStyle = '#d3202c'; ctx.lineWidth = 5; for (let x = -h; x < w + h; x += 13) line(ctx, x, h + 2, x + h + 4, -2); }   // a candy cane
          break;
        case 'knob': bauble(ctx, knobX(f, kind === 'range' ? s.value : s.on), h / 2 + 1, h / 2 - (kind === 'range' ? 2 : 5), kind === 'range' || s.on > 0.5 ? '#e0242f' : '#8fa3b5'); break;
        case 'dot': bauble(ctx, w / 2, h / 2 + 1, (h / 2 - 6) * s.on, '#e0242f'); break;
        default: path(); ctx.strokeStyle = '#fff'; ctx.lineWidth = kind === 'check' ? 3 : 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke();
      }
      ctx.restore();
    }, { radius: 8 });
    if (what === 'media') { ctx.save(); rr(ctx, 0, 0, w, h, 8); ctx.clip(); f.draw(); ctx.restore(); }
    else if (what !== 'control') f.draw();
    if (kind === 'button' || kind === 'field' || kind === 'media') snowCap(ctx, f, 5, w - 5, 0, depth);
    if (kind === 'card') {
      // A string of lights along the top. Every other lamp is lit, and they change places.
      const n = Math.max(3, Math.floor(w / 30)), phase = Math.floor(f.time / 0.7) % 2;
      ctx.save(); ctx.strokeStyle = '#06140f'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(4, 0);
      for (let i = 0; i < n; i++) ctx.quadraticCurveTo(4 + (i + 0.5) * ((w - 8) / n), 9, 4 + (i + 1) * ((w - 8) / n), 0);
      ctx.stroke();
      for (let i = 0; i < n; i++) {
        const x = 4 + (i + 0.5) * ((w - 8) / n), lit = i % 2 === phase, color = BULBS[i % 4];
        ctx.save(); circle(ctx, x, 7, 3.4); ctx.fillStyle = color; ctx.globalAlpha *= lit ? 1 : 0.35; if (lit) { ctx.shadowColor = color; ctx.shadowBlur = 8 * f.scale; } ctx.fill(); ctx.restore();
      }
      ctx.restore();
      f.wait = 700;
    }
    if (f.t < 1) {
      // Flakes fall past the element while its snow settles.
      const rand = rng(f.seed + 5); ctx.save(); ctx.fillStyle = '#fff';
      for (let i = 0; i < 6; i++) { const x = rand() * w, y = -10 + (h + 20) * ((f.t * (0.6 + rand()) + rand()) % 1); circle(ctx, x + Math.sin(f.t * 6 + i) * 4, y, 1 + rand() * 1.4); ctx.globalAlpha = 0.9 * (1 - f.t); ctx.fill(); }
      ctx.restore();
    }
    if (s.focus && kind !== 'field') { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 11); ctx.strokeStyle = XMAS.gold; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
  },
};
// #endregion christmas

// ------------------------------------------------------------------------------------------ seaside
// #region seaside
const SAND = { dry: '#ead9b0', wet: '#b99a63', ink: '#4f3b22', sea: '#2aa7c9', deep: '#1877a8', coral: '#f2685a', foam: '#ffffff' };
const SEASIDE_TYPE = `color: ${SAND.ink}; color-scheme: light; font-family: "Avenir Next", Nunito, "Trebuchet MS", "Segoe UI", system-ui, sans-serif;`;
// A beach ball at x, y, turned by `turn` radians.
function beachBall(ctx, f, x, y, r, turn) {
  ctx.save(); circle(ctx, x, y, r); ctx.shadowColor = 'rgb(80 50 10 / .4)'; ctx.shadowBlur = 3 * f.scale; ctx.shadowOffsetY = 1.5 * f.scale; ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
  ctx.save(); circle(ctx, x, y, r); ctx.clip();
  const colors = ['#e8413a', '#fff', '#2a7fd6', '#fff', '#f5c531', '#fff'];
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r + 1, turn + (i / 6) * TAU, turn + ((i + 1) / 6) * TAU); ctx.closePath(); ctx.fillStyle = colors[i]; ctx.fill(); }
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, 0, x, y, r); g.addColorStop(0, 'rgb(255 255 255 / .6)'); g.addColorStop(0.5, 'rgb(255 255 255 / 0)'); g.addColorStop(1, 'rgb(0 0 0 / .22)');
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.restore();
}
// A starfish with its arms out by `open` (0..1).
function starfish(ctx, x, y, r, open) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rad = i % 2 ? r * 0.42 : r * (0.42 + 0.58 * open); ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fillStyle = '#f08a3c'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#c9601d'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
}
// Water in the current clip up to x, with a moving surface at its right-hand edge and a line of foam.
function tide(ctx, f, x, h, top = 0) {
  const time = f.time;
  ctx.beginPath(); ctx.moveTo(0, top);
  for (let y = top; y <= top + h; y += 2) ctx.lineTo(x + Math.sin(y * 0.5 + time * 3) * 2.2 + Math.sin(y * 0.21 - time * 1.7) * 1.6, y);
  ctx.lineTo(0, top + h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, Math.max(1, x), 0); g.addColorStop(0, SAND.deep); g.addColorStop(1, '#6fd3e0');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = SAND.foam; ctx.lineWidth = 2.2; ctx.beginPath();
  for (let y = top; y <= top + h; y += 2) ctx.lineTo(x + Math.sin(y * 0.5 + time * 3) * 2.2 + Math.sin(y * 0.21 - time * 1.7) * 1.6, y);
  ctx.stroke();
}

const seaside = {
  label: 'Seaside',
  type: SEASIDE_TYPE,
  root: `${SEASIDE_TYPE} background-color: ${SAND.dry}; background-image: radial-gradient(circle at 7px 9px, rgb(120 90 40 / .22) 0 .8px, rgb(120 90 40 / 0) 1.3px), radial-gradient(circle at 19px 23px, rgb(255 255 255 / .5) 0 .8px, rgb(255 255 255 / 0) 1.3px), linear-gradient(180deg, #2aa7c9 0, #7fd6de 34px, #ffffff 44px, #cdb27c 52px, ${SAND.dry} 96px); background-size: 31px 29px, 37px 41px, auto;`,
  css: `caret-color: ${SAND.deep}; & ::placeholder { color: rgb(79 59 34 / .5); } &[kind="button"] > .primary { color: #fff; }`,

  paint(ctx, f) {
    const { width: w, height: h, kind, state: s, bleed: b } = f;
    // A wave runs down over the element as the skin arrives, and the element is what it leaves behind.
    const front = lerp(-b - 6, h + b + 6, f.t);
    if (f.t < 1) { ctx.save(); ctx.beginPath(); ctx.rect(-b, -b, w + 2 * b, front + b); ctx.clip(); }
    const what = parts(ctx, f, (path, role) => {
      ctx.save();
      switch (role) {
        case 'primary': case 'body': {
          // A beach towel: a plain middle and striped ends.
          const base = role === 'primary' ? SAND.deep : '#fff8ea', stripe = role === 'primary' ? '#fff' : SAND.coral;
          path(); ctx.shadowColor = 'rgb(90 60 20 / .4)'; ctx.shadowBlur = 4 * f.scale; ctx.shadowOffsetY = (s.active ? 0.5 : 2) * f.scale; ctx.fillStyle = base; ctx.fill(); ctx.shadowColor = 'transparent';
          ctx.clip(); ctx.fillStyle = stripe; for (const x of [4, 10, w - 7, w - 13]) ctx.fillRect(x, 0, 3, h);
          if (s.active) { ctx.fillStyle = 'rgb(0 0 0 / .1)'; ctx.fillRect(0, 0, w, h); }
          break;
        }
        case 'well': {
          // Damp sand pressed flat, darker along the top where the edge casts a shadow.
          path(); ctx.fillStyle = 'rgb(150 115 60 / .3)'; ctx.fill(); ctx.clip();
          const g = ctx.createLinearGradient(0, 0, 0, 9); g.addColorStop(0, 'rgb(70 45 10 / .35)'); g.addColorStop(1, 'rgb(70 45 10 / 0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, 9);
          if (s.focus) { path(); ctx.strokeStyle = SAND.deep; ctx.lineWidth = 5; ctx.stroke(); }
          break;
        }
        case 'frame': path(); ctx.setLineDash([7, 4]); ctx.strokeStyle = '#a07a45'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke(); break;   // a rope
        case 'track': path(); ctx.fillStyle = kind === 'switch' ? 'rgb(150 115 60 / .45)' : 'rgb(150 115 60 / .3)'; ctx.fill(); break;
        case 'fill':
          if (kind === 'check') { path(); ctx.fillStyle = 'rgb(150 115 60 / .3)'; ctx.fill(); }
          else if (kind === 'switch') { path(); ctx.fillStyle = SAND.sea; ctx.fill(); }
          else if (kind === 'bar') { rr(ctx, 0, 0, w, h, h / 2); ctx.clip(); tide(ctx, f, w * s.value * smooth(f.t), h); f.wait = 90; }
          else { path(); ctx.fillStyle = SAND.sea; ctx.fill(); }
          break;
        case 'knob': { const v = kind === 'range' ? s.value : s.on, x = knobX(f, v); beachBall(ctx, f, x, h / 2, h / 2 - (kind === 'range' ? 1 : 3), (x / (h / 2)) ); break; }   // it rolls
        case 'dot': { const g = ctx.createRadialGradient(w / 2 - 2, h / 2 - 2, 0, w / 2, h / 2, h / 2 - 6); g.addColorStop(0, '#fff'); g.addColorStop(1, '#e7b9c9'); path(); ctx.fillStyle = g; ctx.fill(); break; }   // a pearl
        default:
          if (kind === 'check') starfish(ctx, w / 2, h / 2 + 1, h / 2 + 1, s.on);
          else { path(); ctx.strokeStyle = SAND.ink; ctx.lineWidth = 2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(); }
      }
      ctx.restore();
    }, { radius: 10 });
    if (what === 'media') {
      // A postcard: a white border, turned a little.
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.014); ctx.translate(-w / 2, -h / 2);
      ctx.save(); ctx.shadowColor = 'rgb(90 60 20 / .45)'; ctx.shadowBlur = 5 * f.scale; ctx.shadowOffsetY = 2 * f.scale; ctx.fillStyle = '#fff'; ctx.fillRect(-5, -5, w + 10, h + 10); ctx.restore();
      f.draw(); ctx.restore();
    } else if (what !== 'control') f.draw();
    if (s.focus && kind !== 'field') { ctx.save(); rr(ctx, -4, -4, w + 8, h + 8, 12); ctx.strokeStyle = SAND.deep; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    if (f.t < 1) {
      ctx.restore();
      // The front of the wave: water behind a line of foam.
      ctx.save(); ctx.globalAlpha = 0.85 * (1 - f.t * f.t);
      ctx.beginPath(); ctx.moveTo(-b, front - 12);
      for (let x = -b; x <= w + b; x += 4) ctx.lineTo(x, front + Math.sin(x * 0.09 + f.seed) * 3);
      ctx.lineTo(w + b, front - 12); ctx.closePath(); ctx.fillStyle = 'rgb(110 205 220 / .7)'; ctx.fill();
      ctx.beginPath(); for (let x = -b; x <= w + b; x += 4) ctx.lineTo(x, front + Math.sin(x * 0.09 + f.seed) * 3);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    }
  },
};
// #endregion seaside

export const skins = { thermal, neon, embroidery, christmas, seaside };
