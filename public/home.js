// Progressive enhancement for the demo index.
// Without HTML-in-canvas (Safari, Firefox, Chrome without the flag) nothing
// here runs and the page is a plain CSS grid of links.
// With it, the same <a> elements are slotted into a canvas in a shadow root
// and drawn with a pointer-driven tilt, glare and a reactive dot field.
// They remain real links: hover, focus, Tab, Enter, middle-click, context menu.

const supported =
  'drawElementImage' in CanvasRenderingContext2D.prototype &&
  !new URLSearchParams(location.search).has('plain');

const mode = document.getElementById('mode');
mode.hidden = false;

// Build the index from the shared list: for each group, one or more grids of links.
// With the API, each grid becomes one canvas, so a grid holds a whole number of rows: a grid of four cards in
// three columns left the fourth card alone in a row with two empty cells. One row per canvas from three
// columns up. In one column on a phone a group of 20 cards was a canvas 8,500 device pixels tall and
// 9 megapixels, more than a phone GPU takes as one texture, so a narrow page gets a few cards per canvas.
// Without the API there is no canvas and a group is one CSS grid.
const GAP = 16, MIN_CARD = 270;
const root = document.getElementById('demos');
const columns = () => Math.max(1, Math.floor((root.clientWidth + GAP) / (MIN_CARD + GAP)));
const perCanvas = (cols) => (!supported ? Infinity : cols === 1 ? 3 : cols === 2 ? 4 : cols);
let grids = [];
let builtFor = 0;
function build() {
  builtFor = perCanvas(columns());
  for (const g of grids) window.__gfx?.retire(g.shadowRoot?.querySelector('canvas') ?? g);
  grids = [];
  root.replaceChildren();
  const demos = window.DEMOS ?? [];
  let n = 0;
  for (const [key, label] of window.DEMO_GROUPS ?? []) {
    if (key === 'start') continue; // the tutorial has its own section below the list
    const items = demos.filter((d) => d.group === key);
    if (!items.length) continue;
    const h = document.createElement('h2');
    h.className = 'group-title';
    h.textContent = label;
    const group = document.createElement('nav');
    group.setAttribute('aria-label', label);
    let grid = null;
    for (const d of items) {
      if (!grid || grid.childElementCount >= builtFor) {
        grid = document.createElement('div');
        grid.className = 'demos';
        group.append(grid);
        grids.push(grid);
      }
      const a = document.createElement('a');
      a.className = 'demo';
      a.href = d.href;
      const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      a.innerHTML = `<span class="num">${String(++n).padStart(2, '0')}</span><h2>${esc(d.title)}</h2><p>${d.blurb ?? ''}</p><span class="tags">${(d.tags ?? []).map((t) => `<span>${esc(t)}</span>`).join('')}</span>`;
      grid.append(a);
    }
    root.append(h, group);
  }
  if (supported) grids.forEach(enhance);
}
build();
// When the window is resized to a different number of columns, group the cards again.
if (supported) {
  let timer = 0;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (perCanvas(columns()) === builtFor || root.contains(document.activeElement)) return;
      const height = root.offsetHeight;
      root.style.minHeight = height + 'px'; // hold the page height while the cards are grouped again
      build();
      requestAnimationFrame(() => (root.style.minHeight = ''));
    }, 200);
  });
}

// The table of API calls and the experiments that use them, from /shared/learn.js.
// It runs before the first paint (nav.js holds the page until the scripts have built it).
{
  const body = document.getElementById('uses');
  const titles = new Map((window.DEMOS ?? []).map((d) => [d.href, d.title]));
  const rows = (window.LEARN?.uses ?? []).map((u) => {
    const tr = document.createElement('tr');
    const call = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = u.call;
    call.append(code);
    const what = document.createElement('td');
    what.innerHTML = u.what;
    const pages = document.createElement('td');
    for (const href of u.pages) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = titles.get(href) ?? href;
      pages.append(a, ' ');
    }
    tr.append(call, what, pages);
    return tr;
  });
  if (body && rows.length) body.replaceChildren(...rows);
}

if (!supported) {
  const forced = new URLSearchParams(location.search).has('plain');
  mode.innerHTML = forced
    ? '<span><b>Plain HTML mode.</b> The canvas index is switched off.</span> <a href="/">Turn it back on</a>'
    : '<span><b>Plain HTML mode.</b> This browser has no HTML-in-canvas, so the index is a normal grid of links. The demos need Chrome with <code>chrome://flags/#canvas-draw-element</code>: <a href="/start/#enable">how to turn it on</a>.</span>';
} else {
  mode.innerHTML =
    '<span><b>Canvas mode.</b> These cards are real links drawn into a canvas with <code>drawElementImage()</code>. Tab through them.</span> <a href="/?plain">See the plain HTML version</a>';
}

function enhance(nav) {
  const cards = [...nav.querySelectorAll('.demo')];
  const root = nav.attachShadow({ mode: 'open' });
  root.innerHTML = `<canvas content="drawable" layoutsubtree style="display:block;width:100%"><slot></slot></canvas>`;
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  for (const c of cards) c.setAttribute('drawable', '');
  nav.classList.add('enhanced');

  const PAD = 28; // room for tilt and shadows; .enhanced has a matching negative margin
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = cards.map(() => ({ x: 0, y: 0, w: 0, h: 0, hover: 0, target: 0, enter: 0 }));
  let dpr = devicePixelRatio;
  let pointer = null; // canvas-local CSS px
  let pointerEase = { x: 0, y: 0, on: 0 };
  let running = false;
  const t0 = performance.now();

  function layout() {
    const W = nav.clientWidth - PAD * 2;
    const cols = Math.max(1, Math.floor((W + GAP) / (MIN_CARD + GAP)));
    const cw = Math.floor((W - GAP * (cols - 1)) / cols);
    nav.style.setProperty('--cw', cw + 'px');
    // Read heights after the width applies.
    let y = PAD;
    for (let i = 0; i < cards.length; i += cols) {
      const row = cards.slice(i, i + cols);
      const h = Math.max(...row.map((c) => c.offsetHeight));
      row.forEach((c, j) => Object.assign(state[i + j], { x: PAD + j * (cw + GAP), y, w: cw, h: c.offsetHeight }));
      y += h + GAP;
    }
    const height = y - GAP + PAD;
    canvas.style.height = height + 'px';
  }

  new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    layout();
    dpr = box ? box.inlineSize / Math.max(1, entry.contentRect.width) : devicePixelRatio;
    size();
  }).observe(nav, { box: 'device-pixel-content-box' });

  // The canvas has pixels only while it is within one screen of the viewport. Further away it is 0 by 0 and
  // holds no memory. All the grids together would hold over 200 MB on a phone.
  let near = (() => { const r = nav.getBoundingClientRect(); return r.top < innerHeight * 2 && r.bottom > -innerHeight; })();
  function size() {
    const r = canvas.getBoundingClientRect();
    const w = near ? Math.round(r.width * dpr) : 0, h = near ? Math.round(r.height * dpr) : 0;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (near) kick();
  }
  new IntersectionObserver(([entry]) => { near = entry.isIntersecting; size(); }, { rootMargin: '100% 0px' }).observe(nav);

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    return { accent: cs.getPropertyValue('--accent').trim(), muted: cs.getPropertyValue('--muted').trim(), dark: matchMedia('(prefers-color-scheme: dark)').matches };
  };
  let palette = colors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { palette = colors(); kick(); });

  function draw() {
    const now = performance.now();
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.reset();
    ctx.scale(dpr, dpr);

    // Ease pointer and hover values.
    let moving = false;
    const k = reduced ? 1 : 0.16;
    if (pointer) {
      pointerEase.x += (pointer.x - pointerEase.x) * (pointerEase.on < 0.05 ? 1 : k * 1.6);
      pointerEase.y += (pointer.y - pointerEase.y) * (pointerEase.on < 0.05 ? 1 : k * 1.6);
    }
    const onTarget = pointer ? 1 : 0;
    pointerEase.on += (onTarget - pointerEase.on) * k;
    if (Math.abs(onTarget - pointerEase.on) > 0.005 || (pointer && Math.hypot(pointer.x - pointerEase.x, pointer.y - pointerEase.y) > 0.3)) moving = true;

    // Dot field that swells toward the pointer.
    const step = 22;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const d = Math.hypot(x - pointerEase.x, y - pointerEase.y);
        const f = pointerEase.on * Math.max(0, 1 - d / 190);
        ctx.globalAlpha = 0.16 + f * 0.75;
        ctx.fillStyle = f > 0.02 ? palette.accent : palette.muted;
        const r = 1 + f * f * 3.2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    cards.forEach((card, i) => {
      const s = state[i];
      s.hover += (s.target - s.hover) * k;
      if (Math.abs(s.target - s.hover) > 0.004) moving = true;
      // Staggered entrance.
      const e = reduced ? 1 : Math.min(1, Math.max(0, (now - t0 - i * 70) / 520));
      s.enter = 1 - Math.pow(1 - e, 3);
      if (e < 1) moving = true;

      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      // Pointer position relative to the card centre, -1..1.
      const px = Math.max(-1, Math.min(1, (pointerEase.x - cx) / (s.w / 2)));
      const py = Math.max(-1, Math.min(1, (pointerEase.y - cy) / (s.h / 2)));
      const tilt = reduced ? 0 : s.hover;

      ctx.save();
      ctx.globalAlpha = s.enter;
      ctx.translate(cx, cy + (1 - s.enter) * 26 - tilt * 5);
      // A cheap perspective tilt: opposite shears plus a slight squeeze.
      ctx.transform(1 - Math.abs(px) * 0.025 * tilt, py * px * 0.035 * tilt, px * py * 0.035 * tilt, 1 - Math.abs(py) * 0.03 * tilt, 0, 0);
      ctx.rotate(px * 0.012 * tilt);
      ctx.scale(1 + 0.035 * tilt, 1 + 0.035 * tilt);
      ctx.translate(-s.w / 2, -s.h / 2);

      ctx.shadowColor = `rgba(0,0,0,${(palette.dark ? 0.5 : 0.16) * (0.35 + tilt * 0.65)})`;
      ctx.shadowBlur = 10 + tilt * 26;
      ctx.shadowOffsetY = (3 + tilt * 14) * dpr;
      try {
        // Updates the link's geometry too, so hit testing and focus rings follow.
        ctx.drawElementImage(card, 0, 0, s.w, s.h);
      } catch {
        moving = true; // no snapshot yet; try again next frame
      }
      ctx.shadowColor = 'transparent';

      // Glare that tracks the pointer, clipped to the card.
      if (tilt > 0.01) {
        ctx.beginPath();
        ctx.roundRect(0, 0, s.w, s.h, 14);
        ctx.clip();
        const gx = s.w / 2 + px * s.w / 2, gy = s.h / 2 + py * s.h / 2;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, s.w * 0.75);
        g.addColorStop(0, `rgba(255,255,255,${(palette.dark ? 0.1 : 0.4) * tilt})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s.w, s.h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = palette.accent;
        ctx.globalAlpha = tilt * s.enter;
        ctx.beginPath();
        ctx.roundRect(0.75, 0.75, s.w - 1.5, s.h - 1.5, 13.5);
        ctx.stroke();
      }
      ctx.restore();
    });
    return moving;
  }

  // The paint event fires when a card's rendering changes (focus ring, fonts
  // loading, theme) or when we ask for it while animating.
  canvas.addEventListener('paint', () => {
    if (!canvas.width || !canvas.height) return;
    const moving = draw();
    if (moving && !running) {
      running = true;
      requestAnimationFrame(() => {
        running = false;
        canvas.requestPaint();
      });
    }
  });
  const kick = () => canvas.requestPaint();

  nav.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.x, y: e.clientY - r.y };
    const over = e.target.closest?.('.demo');
    cards.forEach((c, i) => (state[i].target = c === over ? 1 : 0));
    kick();
  });
  nav.addEventListener('pointerleave', () => {
    pointer = null;
    state.forEach((s) => (s.target = 0));
    kick();
  });
  // Keyboard users get the same lift on focus.
  nav.addEventListener('focusin', (e) => {
    if (!e.target.matches?.(':focus-visible')) return;
    cards.forEach((c, i) => (state[i].target = c === e.target ? 1 : 0));
    const s = state[cards.indexOf(e.target)];
    if (s) pointer = { x: s.x + s.w * 0.7, y: s.y + s.h * 0.3 };
    kick();
  });
  nav.addEventListener('focusout', () => {
    state.forEach((s) => (s.target = 0));
    pointer = null;
    kick();
  });

  layout();
  kick();
  window.__enhanced = true;
}
