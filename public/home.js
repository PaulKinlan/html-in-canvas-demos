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
const nav = document.getElementById('demos');
mode.hidden = false;

if (!supported) {
  const forced = new URLSearchParams(location.search).has('plain');
  mode.innerHTML = forced
    ? '<span><b>Plain HTML mode.</b> The canvas index is switched off.</span> <a href="/">Turn it back on</a>'
    : '<span><b>Plain HTML mode.</b> This browser has no HTML-in-canvas, so the index is a normal grid of links. The demos need Chrome with <code>chrome://flags/#canvas-draw-element</code>.</span>';
} else {
  mode.innerHTML =
    '<span><b>Canvas mode.</b> These cards are real links drawn into a canvas with <code>drawElementImage()</code>. Tab through them.</span> <a href="/?plain">See the plain HTML version</a>';
  enhance();
}

function enhance() {
  const cards = [...nav.querySelectorAll('.demo')];
  const root = nav.attachShadow({ mode: 'open' });
  root.innerHTML = `<canvas content="drawable" layoutsubtree style="display:block;width:100%"><slot></slot></canvas>`;
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  for (const c of cards) c.setAttribute('drawable', '');
  nav.classList.add('enhanced');

  const PAD = 28; // room for tilt and shadows; .enhanced has a matching negative margin
  const GAP = 16;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = cards.map(() => ({ x: 0, y: 0, w: 0, h: 0, hover: 0, target: 0, enter: 0 }));
  let dpr = devicePixelRatio;
  let pointer = null; // canvas-local CSS px
  let pointerEase = { x: 0, y: 0, on: 0 };
  let running = false;
  const t0 = performance.now();

  function layout() {
    const W = nav.clientWidth - PAD * 2;
    const cols = Math.max(1, Math.floor((W + GAP) / (270 + GAP)));
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
    const r = canvas.getBoundingClientRect();
    dpr = box ? box.inlineSize / Math.max(1, entry.contentRect.width) : devicePixelRatio;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    kick();
  }).observe(nav, { box: 'device-pixel-content-box' });

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
