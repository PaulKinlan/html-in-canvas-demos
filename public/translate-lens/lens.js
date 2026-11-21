// The drawing half of the translate lens: one 2D canvas that draws an element
// everywhere and a converted copy of it inside a circle.
//
//   const view = twinLens(canvas, original, copy, twin);   // twin is a TextTwin
//   view.moveTo(x, y);  view.align = 'fit' | 'top' | 'none';  view.zoom = 1.2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const still = matchMedia('(prefers-reduced-motion: reduce)');

/** Layout box of `el` inside `root` (an offsetParent of it), in CSS px. */
export function boxWithin(el, root) {
  let x = 0, y = 0;
  for (let n = el; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function twinLens(canvas, original, copy, twin, { radius = 96, zoom = 1.15, align = 'fit', label = () => '' } = {}) {
  const ctx = canvas.getContext('2d');
  const view = {
    x: 0, y: 0, tx: 0, ty: 0, radius, zoom, align, on: true, drift: false, lost: false,
    frames: 0,
    /** Where a block of the copy was drawn last, for checks: [{ top, scale }] by block index. */
    placed: [],
    moveTo(x, y, jump = false) {
      view.tx = x; view.ty = y;
      if (jump) { view.x = x; view.y = y; }
      wake();
    },
    refresh: wake,
  };

  // #region size
  // Canvas pixels follow the device pixel size of the box, so text is sharp.
  new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize[0];
    if (canvas.width !== box.inlineSize) canvas.width = box.inlineSize;
    if (canvas.height !== box.blockSize) canvas.height = box.blockSize;
    wake();
  }).observe(canvas, { box: 'device-pixel-content-box' });
  // #endregion size

  // Box of a block inside the sheet it belongs to, in CSS px, from layout.
  // getBoundingClientRect() would not do: for a child of a drawable canvas it
  // reports where the element was last drawn, and the copy is drawn shifted.
  const within = boxWithin;

  // #region paint
  canvas.addEventListener('paint', () => {
    if (!canvas.clientWidth) return;
    const dpr = canvas.width / canvas.clientWidth;
    const W = original.offsetWidth, H = original.offsetHeight;
    const now = performance.now();
    ctx.reset();
    ctx.scale(dpr, dpr);

    // 1. The original, at its layout position. This is also where it takes clicks.
    ctx.drawElementImage(original, 0, 0, W, H);
    view.frames++;
    if (!view.on) return;

    // 2. The copy, only inside the lens circle, magnified about the lens centre.
    const { x, y, radius: r, zoom: z } = view;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale(z, z);
    ctx.translate(-x, -y);
    ctx.fillStyle = getComputedStyle(copy).backgroundColor;
    ctx.fillRect(0, 0, W, H);
    const cw = copy.offsetWidth, ch = copy.offsetHeight;
    view.placed = [];
    if (view.align === 'own') {
      // Each block of the copy has the drawable attribute, so it is drawn by
      // itself at the place of the original block: one small draw per block.
      twin.blocks.forEach((b, i) => {
        if (!b.dst?.isConnected) return;
        const o = within(b.src, original);
        if (o.y + o.h < y - r / z || o.y > y + r / z) return;
        const tw = b.dst.offsetWidth, th = b.dst.offsetHeight;
        const s = th > o.h ? o.h / th : 1;
        view.placed[i] = { top: o.y, scale: s };
        ctx.drawElementImage(b.dst, o.x, o.y, tw * s, th * s);
        mark(b, o, now, W);
      });
    } else if (view.align === 'none') {
      // No alignment: the copy's own layout. Lines drift as soon as a
      // translated paragraph wraps differently from the original.
      ctx.drawElementImage(copy, 0, 0, cw, ch);
    } else {
      // Per block: draw the copy once for each block the lens touches, clipped
      // to the original block's rows and shifted so the copy's block starts
      // where the original's does. 'fit' also shrinks a block that came out
      // taller than the original, so it does not lose its last lines.
      twin.blocks.forEach((b, i) => {
        if (!b.dst?.isConnected) return;
        const o = within(b.src, original), t = within(b.dst, copy);
        if (o.y + o.h < y - r / z || o.y > y + r / z) return;
        const s = view.align === 'fit' && t.h > o.h ? o.h / t.h : 1;
        view.placed[i] = { top: o.y, scale: s };
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, o.y, W, o.h);
        ctx.clip();
        ctx.translate(o.x, o.y);
        ctx.scale(s, s);
        ctx.translate(-t.x, -t.y);
        ctx.drawElementImage(copy, 0, 0, cw, ch);
        ctx.restore();
        mark(b, o, now, W);
      });
    }
    ctx.restore();
    rim(x, y, r, now);
  });
  // #endregion paint

  // What the canvas adds over a block: a moving band while its text is on the
  // way, a short flash when it arrives, hatching when there is no text for it.
  function mark(b, o, now, W) {
    if (b.state === 'pending') {
      const p = (now / 900) % 1;
      const g = ctx.createLinearGradient(W * (p * 1.6 - 0.6), 0, W * (p * 1.6 - 0.2), 0);
      g.addColorStop(0, 'rgba(120,160,255,0)');
      g.addColorStop(0.5, 'rgba(120,160,255,0.45)');
      g.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, o.y, W, o.h);
      busy = true;
    } else if (b.state === 'done' && now - b.at < 500) {
      ctx.fillStyle = `rgba(255,190,60,${0.35 * (1 - (now - b.at) / 500)})`;
      ctx.fillRect(0, o.y, W, o.h);
      busy = true;
    } else if (b.state === 'missing' || b.state === 'error') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, o.y, W, o.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(200,60,40,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -o.h; k < W; k += 7) { ctx.moveTo(k, o.y + o.h); ctx.lineTo(k + o.h, o.y); }
      ctx.stroke();
      ctx.restore();
    }
  }

  function rim(x, y, r, now) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.lineWidth = 5;
    const g = ctx.createConicGradient(now / 2600, x, y);
    for (const [stop, c] of [[0, '#ffd27a'], [0.25, '#ff7a4d'], [0.5, '#7ab8ff'], [0.75, '#9af0c0'], [1, '#ffd27a']]) g.addColorStop(stop, c);
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 3.5, 0, Math.PI * 2);
    ctx.stroke();
    const text = label();
    if (text) {
      ctx.font = '600 12px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 16;
      const lx = clamp(x - w / 2, 4, canvas.clientWidth - w - 4);
      const ly = y + r + 8 + 22 > canvas.clientHeight ? y - r - 30 : y + r + 8;
      ctx.fillStyle = 'rgba(20,20,24,0.86)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx + 8, ly + 11.5);
    }
  }

  // #region loop
  // One frame is drawn when something changed. The loop keeps going only while
  // the lens is moving, drifting on its own, or a block is animating.
  let raf = 0, busy = false, visible = true;
  function wake() {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); }).observe(canvas);
  function frame(now) {
    raf = 0;
    if (view.drift && !still.matches) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      view.tx = w / 2 + Math.sin(now / 2300) * (w / 2 - view.radius * 0.55);
      view.ty = h / 2 + Math.sin(now / 3100 + 1) * (h / 2 - view.radius * 0.55);
    }
    const dx = view.tx - view.x, dy = view.ty - view.y;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.3;
    view.x += moving ? dx * 0.22 : dx;
    view.y += moving ? dy * 0.22 : dy;
    const wasBusy = busy;
    busy = false;
    canvas.requestPaint();
    if (moving || wasBusy || (view.drift && !still.matches)) wake();
  }
  twin.addEventListener('change', () => { busy = true; wake(); });
  // #endregion loop

  // #region lost
  // A 2D canvas can lose its context too (the GPU process restarting, memory
  // pressure on a phone). Say so, and draw again when it is back.
  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    view.lost = true;
    canvas.dispatchEvent(new CustomEvent('lenslost', { bubbles: true }));
  });
  canvas.addEventListener('contextrestored', () => {
    view.lost = false;
    canvas.dispatchEvent(new CustomEvent('lensrestored', { bubbles: true }));
    wake();
  });
  // #endregion lost

  // #region pointer
  // A mouse moves the lens by hovering. A finger drags it when the touch
  // starts on the lens (the lens is then drawn above the finger); a touch that
  // starts elsewhere scrolls the page, and a tap moves the lens there. Clicks
  // go to the original element under the pointer, through the lens.
  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const onLens = (p) => Math.hypot(p.x - view.x, p.y - view.y) < view.radius * 1.15;
  let dragging = false;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && !dragging) return;
    const p = local(e);
    view.drift = false;
    view.moveTo(p.x, e.pointerType === 'touch' ? p.y - view.radius * 0.8 : p.y);
  });
  canvas.addEventListener('touchstart', (e) => {
    const p = local(e.touches[0]);
    if (!view.on || !onLens(p)) return;
    e.preventDefault(); // this touch moves the lens instead of scrolling
    dragging = true;
    view.drift = false;
  }, { passive: false });
  for (const type of ['touchend', 'touchcancel']) canvas.addEventListener(type, () => (dragging = false));
  canvas.addEventListener('click', (e) => {
    if (e.target.closest?.('a,button,input,select,textarea,[contenteditable]')) return;
    const p = local(e);
    view.drift = false;
    view.moveTo(p.x, p.y);
  });
  // The lens follows keyboard focus, so Tab shows the focused control's copy.
  original.addEventListener('focusin', (e) => {
    if (!e.target.matches(':focus-visible')) return;
    const o = within(e.target, original);
    view.drift = false;
    view.moveTo(o.x + Math.min(o.w / 2, view.radius), o.y + o.h / 2);
  });
  // #endregion pointer

  wake();
  return view;
}
