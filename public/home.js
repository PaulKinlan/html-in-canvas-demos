// Progressive enhancement, topic filters and search for the demo index.
// Without HTML-in-canvas (Safari, Firefox, Chrome without the API) every card
// is a plain CSS grid of links. With it, the links in each open group are
// slotted into a canvas in a shadow root and drawn with a pointer-driven tilt,
// glare and dot field while staying real links (hover, focus, Tab, middle-click).

const supported =
  'drawElementImage' in CanvasRenderingContext2D.prototype &&
  !new URLSearchParams(location.search).has('plain');

const mode = document.getElementById('mode');
const root = document.getElementById('demos');
const chipsEl = document.getElementById('cat-chips');
const filterEl = document.getElementById('filter');
const toggleBtn = document.getElementById('toggle-groups');
const emptyEl = document.getElementById('empty');
mode.hidden = false;

const GAP = 16, MIN_CARD = 260;
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const stripHtml = (t) => String(t ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

const allGroups = (window.DEMO_GROUPS ?? []).filter(([key]) => key !== 'start');
const allDemos = (window.DEMOS ?? []).filter((d) => d.group !== 'start');
const numbered = new Map(allDemos.map((d, i) => [d.href, i + 1]));

let activeGroup = 'all';
let query = '';
let grids = []; // { grid, fold, enhanced, resize, repaint, destroy }
let builtFor = 0;
let filterTimer = 0;

const MAX_CANVAS_PX = 3_600_000;
const darkMql = matchMedia('(prefers-color-scheme: dark)');
const reducedMql = matchMedia('(prefers-reduced-motion: reduce)');
const readPalette = () => {
  const cs = getComputedStyle(document.documentElement);
  return { accent: cs.getPropertyValue('--accent').trim(), muted: cs.getPropertyValue('--muted').trim(), dark: darkMql.matches };
};
let palette = readPalette();
darkMql.addEventListener('change', () => {
  palette = readPalette();
  for (const entry of grids) entry.repaint?.();
});

const columns = () => Math.max(1, Math.floor((Math.max(260, root.clientWidth - 32) + GAP) / (MIN_CARD + GAP)));
// Keep at most 2 cards per canvas in a single column on phones, and 1 row per canvas in wider layouts.
const perCanvas = (cols) => (!supported ? Infinity : cols === 1 ? 2 : cols);

function matches(d, terms) {
  if (activeGroup !== 'all' && d.group !== activeGroup) return false;
  if (!terms.length) return true;
  const hay = (d.title + ' ' + d.href + ' ' + stripHtml(d.blurb) + ' ' + (d.tags ?? []).join(' ')).toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function buildChips() {
  if (!chipsEl) return;
  const counts = new Map();
  for (const d of allDemos) counts.set(d.group, (counts.get(d.group) ?? 0) + 1);
  const make = (key, label, count) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.group = key;
    b.setAttribute('aria-pressed', String(key === activeGroup));
    b.innerHTML = `${esc(label)} <span class="n">${count}</span>`;
    b.addEventListener('click', () => {
      activeGroup = key;
      for (const c of chipsEl.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c.dataset.group === activeGroup));
      build();
    });
    return b;
  };
  const nodes = [make('all', 'All', allDemos.length)];
  for (const [key, label] of allGroups) {
    const n = counts.get(key) ?? 0;
    if (n) nodes.push(make(key, label, n));
  }
  chipsEl.replaceChildren(...nodes);
}

function updateToggleButton() {
  if (!toggleBtn) return;
  const folds = [...root.querySelectorAll('details.group-fold')];
  const allOpen = folds.length > 0 && folds.every((f) => f.open);
  toggleBtn.textContent = allOpen ? 'Collapse all groups' : 'Expand all groups';
  toggleBtn.hidden = folds.length <= 1;
}

function build() {
  clearTimeout(filterTimer);
  filterTimer = 0;
  builtFor = perCanvas(columns());
  for (const entry of grids) {
    entry.destroy?.();
    window.__gfx?.retire(entry.grid.shadowRoot?.querySelector('canvas') ?? entry.grid);
  }
  grids = [];
  root.replaceChildren();

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let totalShown = 0;

  for (const [key, label] of allGroups) {
    const items = allDemos.filter((d) => d.group === key && matches(d, terms));
    if (!items.length) continue;
    totalShown += items.length;

    const fold = document.createElement('details');
    fold.className = 'group-fold';
    fold.dataset.group = key;
    fold.open = true;

    const summary = document.createElement('summary');
    summary.innerHTML = `<span class="g-name">${esc(label)}</span><span class="g-count">${items.length}</span>`;
    const body = document.createElement('div');
    body.className = 'group-body';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', label);

    const foldGrids = [];
    let grid = null;
    for (const d of items) {
      if (!grid || grid.childElementCount >= builtFor) {
        grid = document.createElement('div');
        grid.className = 'demos';
        nav.append(grid);
        const entry = { grid, fold, enhanced: false, resize: null, repaint: null, destroy: null };
        grids.push(entry);
        foldGrids.push(entry);
      }
      const a = document.createElement('a');
      a.className = 'demo';
      a.href = d.href;
      const num = numbered.get(d.href) ?? 0;
      a.innerHTML = `<span class="num">${String(num).padStart(2, '0')}</span><h3>${esc(d.title)}</h3><p>${d.blurb ?? ''}</p><span class="tags">${(d.tags ?? []).map((t) => `<span>${esc(t)}</span>`).join('')}</span>`;
      grid.append(a);
    }

    body.append(nav);
    fold.append(summary, body);
    root.append(fold);

    if (supported) {
      const activate = () => {
        for (const entry of foldGrids) {
          if (!entry.enhanced) {
            entry.enhanced = true;
            Object.assign(entry, enhance(entry.grid, fold));
          } else {
            entry.resize?.();
          }
        }
      };
      if (fold.open) activate();
      fold.addEventListener('toggle', () => {
        updateToggleButton();
        if (fold.open) activate();
        else for (const entry of foldGrids) entry.resize?.();
      });
    } else {
      fold.addEventListener('toggle', updateToggleButton);
    }
  }

  if (emptyEl) emptyEl.hidden = totalShown > 0;
  updateToggleButton();
}

buildChips();
build();

if (filterEl) {
  filterEl.addEventListener('input', () => {
    query = filterEl.value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(build, 100);
  });
}

if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    const folds = [...root.querySelectorAll('details.group-fold')];
    const wantOpen = !folds.every((f) => f.open);
    for (const f of folds) f.open = wantOpen;
    updateToggleButton();
  });
}

// When the window is resized to a different number of columns, group the cards again.
if (supported) {
  let timer = 0;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (perCanvas(columns()) === builtFor || root.contains(document.activeElement)) return;
      const height = root.offsetHeight;
      root.style.minHeight = height + 'px';
      build();
      requestAnimationFrame(() => (root.style.minHeight = ''));
    }, 200);
  });
}

// The table of API calls and the experiments that use them, from /shared/learn.js.
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
    : '<span><b>Plain HTML mode.</b> This browser has no HTML-in-canvas, so the index is a normal grid of links. <a href="/start/#enable">How to enable it</a>.</span>';
} else {
  mode.innerHTML =
    '<span><b>Canvas mode.</b> Cards below are real links drawn into a canvas with <code>drawElementImage()</code>. Tab through them.</span> <a href="/?plain">See the plain HTML version</a>';
}

function enhance(nav, fold) {
  const cards = [...nav.querySelectorAll('.demo')];
  const shadow = nav.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<canvas content="drawable" layoutsubtree style="display:block;width:100%"><slot></slot></canvas>`;
  const canvas = shadow.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  for (const c of cards) c.setAttribute('drawable', '');
  nav.classList.add('enhanced');

  const PAD = 16; // room for tilt and shadows; .enhanced has a matching negative margin
  const reduced = reducedMql.matches;
  const state = cards.map(() => ({ x: 0, y: 0, w: 0, h: 0, hover: 0, target: 0, enter: 0 }));
  let dpr = devicePixelRatio;
  let renderDpr = dpr;
  let pointer = null; // canvas-local CSS px
  let pointerEase = { x: 0, y: 0, on: 0 };
  let rafId = 0;
  let destroyed = false;
  let dotPath = null, dotW = 0, dotH = 0;
  const t0 = performance.now();

  function getDotPath(W, H) {
    if (dotPath && dotW === W && dotH === H) return dotPath;
    const path = new Path2D();
    const step = 22;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        path.moveTo(x + 1, y);
        path.arc(x, y, 1, 0, 6.2832);
      }
    }
    dotPath = path;
    dotW = W;
    dotH = H;
    return path;
  }

  function layout() {
    if (destroyed || !fold.open) return;
    const W = nav.clientWidth - PAD * 2;
    if (W <= 0) return;
    const cols = Math.max(1, Math.floor((W + GAP) / (MIN_CARD + GAP)));
    const cw = Math.floor((W - GAP * (cols - 1)) / cols);
    nav.style.setProperty('--cw', cw + 'px');
    let y = PAD;
    for (let i = 0; i < cards.length; i += cols) {
      let rowH = 0;
      const end = Math.min(i + cols, cards.length);
      for (let k = i; k < end; k++) {
        const ch = cards[k].offsetHeight;
        if (ch > rowH) rowH = ch;
        const s = state[k];
        s.x = PAD + (k - i) * (cw + GAP);
        s.y = y;
        s.w = cw;
        s.h = ch;
      }
      y += rowH + GAP;
    }
    const height = y - GAP + PAD;
    canvas.style.height = height + 'px';
  }

  const ro = new ResizeObserver(([entry]) => {
    if (destroyed || !fold.open) return;
    const box = entry.devicePixelContentBoxSize?.[0];
    layout();
    dpr = box ? box.inlineSize / Math.max(1, entry.contentRect.width) : devicePixelRatio;
    size();
  });
  try {
    ro.observe(nav, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(nav);
  }

  // The canvas has pixels only while its group is open and within half a screen of the viewport.
  let near = (() => { const r = nav.getBoundingClientRect(); return r.top < innerHeight * 1.5 && r.bottom > -innerHeight * 0.5; })();
  function size() {
    if (destroyed) return;
    const active = near && fold.open;
    const r = active ? canvas.getBoundingClientRect() : null;
    let w = 0, h = 0;
    if (active && r.width > 0 && r.height > 0) {
      const area = r.width * r.height;
      renderDpr = Math.min(dpr, Math.sqrt(MAX_CANVAS_PX / area));
      w = Math.max(1, Math.floor(r.width * renderDpr));
      h = Math.max(1, Math.floor(r.height * renderDpr));
    }
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (active && w && h) kick();
  }
  const io = new IntersectionObserver(([entry]) => {
    if (destroyed) return;
    near = entry.isIntersecting;
    size();
  }, { rootMargin: '50% 0px' });
  io.observe(nav);

  function draw() {
    const now = performance.now();
    const W = canvas.width / renderDpr, H = canvas.height / renderDpr;
    ctx.reset();
    ctx.scale(renderDpr, renderDpr);

    let moving = false;
    const k = reduced ? 1 : 0.16;
    if (pointer) {
      pointerEase.x += (pointer.x - pointerEase.x) * (pointerEase.on < 0.05 ? 1 : k * 1.6);
      pointerEase.y += (pointer.y - pointerEase.y) * (pointerEase.on < 0.05 ? 1 : k * 1.6);
    }
    const onTarget = pointer ? 1 : 0;
    pointerEase.on += (onTarget - pointerEase.on) * k;
    if (Math.abs(onTarget - pointerEase.on) > 0.005 || (pointer && Math.hypot(pointer.x - pointerEase.x, pointer.y - pointerEase.y) > 0.3)) moving = true;

    const step = 22;
    const R = 190;
    const px0 = pointerEase.x, py0 = pointerEase.y, pon = pointerEase.on;
    const hiR = pon > 0.02 ? R * (1 - 0.02 / pon) : 0;
    const hiR2 = hiR * hiR;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = palette.muted;
    if (hiR <= 0) {
      ctx.fill(getDotPath(W, H));
    } else {
      ctx.beginPath();
      for (let y = step / 2; y < H; y += step) {
        const dy = y - py0, dy2 = dy * dy;
        for (let x = step / 2; x < W; x += step) {
          const dx = x - px0;
          if (dx * dx + dy2 >= hiR2) {
            ctx.moveTo(x + 1, y);
            ctx.arc(x, y, 1, 0, 6.2832);
          }
        }
      }
      ctx.fill();

      ctx.fillStyle = palette.accent;
      const x0 = Math.max(0, Math.floor((px0 - hiR - step / 2) / step)) * step + step / 2;
      const x1 = Math.min(W, px0 + hiR);
      const y0 = Math.max(0, Math.floor((py0 - hiR - step / 2) / step)) * step + step / 2;
      const y1 = Math.min(H, py0 + hiR);
      for (let y = y0; y < y1; y += step) {
        const dy = y - py0, dy2 = dy * dy;
        for (let x = x0; x < x1; x += step) {
          const dx = x - px0, d2 = dx * dx + dy2;
          if (d2 >= hiR2) continue;
          const f = pon * (1 - Math.sqrt(d2) / R);
          ctx.globalAlpha = 0.16 + f * 0.75;
          const r = 1 + f * f * 3.2;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 6.2832);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    cards.forEach((card, i) => {
      const s = state[i];
      s.hover += (s.target - s.hover) * k;
      if (Math.abs(s.target - s.hover) > 0.004) moving = true;
      const e = reduced ? 1 : Math.min(1, Math.max(0, (now - t0 - i * 70) / 520));
      s.enter = 1 - Math.pow(1 - e, 3);
      if (e < 1) moving = true;

      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const px = Math.max(-1, Math.min(1, (pointerEase.x - cx) / (s.w / 2)));
      const py = Math.max(-1, Math.min(1, (pointerEase.y - cy) / (s.h / 2)));
      const tilt = reduced ? 0 : s.hover;

      ctx.save();
      ctx.globalAlpha = s.enter;
      ctx.translate(cx, cy + (1 - s.enter) * 26 - tilt * 5);
      ctx.transform(1 - Math.abs(px) * 0.025 * tilt, py * px * 0.035 * tilt, px * py * 0.035 * tilt, 1 - Math.abs(py) * 0.03 * tilt, 0, 0);
      ctx.rotate(px * 0.012 * tilt);
      ctx.scale(1 + 0.035 * tilt, 1 + 0.035 * tilt);
      ctx.translate(-s.w / 2, -s.h / 2);

      ctx.shadowColor = `rgba(0,0,0,${(palette.dark ? 0.5 : 0.16) * (0.35 + tilt * 0.65)})`;
      ctx.shadowBlur = 10 + tilt * 26;
      ctx.shadowOffsetY = (3 + tilt * 14) * renderDpr;
      try {
        ctx.drawElementImage(card, 0, 0, s.w, s.h);
      } catch {
        moving = true;
      }
      ctx.shadowColor = 'transparent';

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

  canvas.addEventListener('paint', () => {
    if (destroyed || !canvas.width || !canvas.height) return;
    const moving = draw();
    if (moving && !rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!destroyed) canvas.requestPaint();
      });
    }
  });
  const kick = () => { if (!destroyed) canvas.requestPaint(); };

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
  size();
  window.__enhanced = true;
  return {
    resize: () => {
      if (destroyed) return;
      layout();
      size();
    },
    repaint: () => {
      if (!destroyed && canvas.width && canvas.height) kick();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(rafId);
      rafId = 0;
      ro.disconnect();
      io.disconnect();
      dotPath = null;
      canvas.width = 0;
      canvas.height = 0;
      window.__gfx?.retire(canvas);
    },
  };
}
