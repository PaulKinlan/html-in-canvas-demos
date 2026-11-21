// ui.js: the browser side of ui.c. It gives the C program its imports: a 2D canvas to draw on,
// the DOM elements inside that canvas, the pointer, and wait_event(), the one import that suspends.

export const hasJSPI = typeof WebAssembly === 'object'
  && typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function';

/**
 * Start ui.wasm on a <canvas content="drawable">. Its [data-ui] descendants are the program's
 * DOM elements, numbered in document order. Resolves once the program has drawn its first frame.
 */
export async function startToolkit(canvas, { onReport = () => {}, onStop = () => {}, url = '/wasm-ui/ui.wasm' } = {}) {
  if (!hasJSPI) throw new Error('This browser has no JavaScript Promise Integration (WebAssembly.Suspending).');
  const ctx = canvas.getContext('2d');
  if (!ctx?.drawElementImage) throw new Error('This browser has no drawElementImage().');

  const els = [...canvas.querySelectorAll('[data-ui]')];
  const state = els.map(() => ({ clicked: false, rect: null, shown: null, text: null }));
  const stats = { frames: 0, waits: 0, nested: 0, paints: 0, resumes: 0, failures: 0, lastError: '' };
  const pointer = { x: -1e4, y: -1e4, down: 0 };
  const queue = [];        // pointer states the program has not seen yet, oldest first
  let wake = null;         // resolves the promise that wait_event() is suspended on
  let cause = 0;           // EV_PAINT 0, EV_POINTER 1, EV_DOM 2, EV_RESIZE 3
  let scale = 1;

  const ask = (kind) => { cause = cause || kind; canvas.requestPaint?.(); };

  // #region wait
  // The program calls wait_event() and stops there. The promise is settled by the next paint
  // event, so every frame the program draws is drawn inside a paint event.
  function waitEvent() {
    return new Promise((resolve) => {
      wake = resolve;
      if (queue.length) canvas.requestPaint(); // more pointer states to show the program
    });
  }
  canvas.addEventListener('paint', () => {
    stats.paints++;
    if (!wake) return;
    if (queue.length) Object.assign(pointer, queue.shift());
    const resolve = wake, kind = cause;
    wake = null;
    cause = 0;
    stats.resumes++;
    resolve(kind);                              // run() continues from inside wait_event()
  });
  // #endregion wait

  // #region pointer
  // The toolkit's own widgets (slider, button) read the pointer. Each state change is queued so
  // that a quick tap is not lost between two frames: the program sees down, then up.
  const push = (event, type) => {
    const r = canvas.getBoundingClientRect();
    const next = type === 'gone'
      ? { x: -1e4, y: -1e4, down: 0, type }
      : { x: event.clientX - r.left, y: event.clientY - r.top, down: type === 'up' ? 0 : type === 'down' ? 1 : (queue.at(-1) ?? pointer).down, type };
    if (type === 'move' && queue.at(-1)?.type === 'move') queue[queue.length - 1] = next;
    else queue.push(next);
    ask(1);
  };
  canvas.addEventListener('pointerdown', (e) => {
    // Keep a slider drag that leaves the canvas. A synthetic event has no pointer to capture.
    if (e.target === canvas) try { canvas.setPointerCapture(e.pointerId); } catch {}
    push(e, 'down');
  });
  canvas.addEventListener('pointermove', (e) => push(e, 'move'));
  canvas.addEventListener('pointerup', (e) => push(e, 'up'));
  canvas.addEventListener('pointercancel', (e) => push(e, 'gone'));
  canvas.addEventListener('pointerleave', (e) => push(e, 'gone'));
  // #endregion pointer

  for (const [id, el] of els.entries()) {
    el.addEventListener('click', () => { state[id].clicked = true; ask(2); });
  }
  canvas.addEventListener('input', () => ask(2));
  canvas.addEventListener('change', () => ask(2));
  canvas.addEventListener('contextrestored', () => ask(3));

  // The buffer has one pixel per device pixel. Assigning width or height clears the canvas,
  // so assign only when the number changed.
  const fit = (w, h) => {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    scale = canvas.width / (canvas.clientWidth || 1);
    ask(3);
  };
  new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    if (box) fit(box.inlineSize, box.blockSize);
    else fit(Math.round(entry.contentRect.width * devicePixelRatio), Math.round(entry.contentRect.height * devicePixelRatio));
  }).observe(canvas);
  fit(Math.round(canvas.clientWidth * devicePixelRatio), Math.round(canvas.clientHeight * devicePixelRatio));

  const colour = (rgba) => `#${(rgba >>> 0).toString(16).padStart(8, '0')}`;

  // #region imports
  const env = {
    wait_event: new WebAssembly.Suspending(waitEvent),   // the only import that may suspend
    canvas_w: () => canvas.clientWidth,
    canvas_h: () => canvas.clientHeight,
    pointer_x: () => pointer.x,
    pointer_y: () => pointer.y,
    pointer_down: () => pointer.down,

    fill_rect(x, y, w, h, radius, rgba) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = colour(rgba);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();
    },

    // Layout goes both ways: the program gives a width, the browser answers with the height.
    dom_height(id, width) {
      const el = els[id], px = `${Math.round(width)}px`;
      if (el.style.width !== px) el.style.width = px;
      return el.offsetHeight;
    },

    // Draw the element where the program put it. In a 2D canvas drawElementImage() also moves the
    // element's hit box, caret and accessibility bounds there. An element the program does not
    // draw, or draws under its modal dialog, is made inert so that it takes no pointer or focus.
    dom_draw(id, x, y, w, h, alpha, interactive) {
      const el = els[id], s = state[id];
      const shown = w > 0 && h > 0;
      const inert = !shown || !interactive;
      if (el.inert !== inert) el.inert = inert;
      if (shown && interactive && s.shown === false) el.querySelector('[data-first]')?.focus({ preventScroll: true });
      s.shown = shown && !!interactive;
      s.rect = shown ? { x, y, w, h } : null;
      if (!shown) return;
      try {
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.drawElementImage(el, x, y, w, h);
        stats.failures = 0;
      } catch (err) {
        // "No cached paint record": the browser has not painted the element yet. Ask again.
        stats.lastError = `${err.name}: ${err.message}`;
        if (++stats.failures < 200) ask(0);
      } finally {
        ctx.globalAlpha = 1;
      }
    },

    dom_clicked(id) {
      const was = state[id].clicked;
      state[id].clicked = false;
      return was ? 1 : 0;
    },

    // Show a number from the program in the element's <output>. data-words turns the values
    // -2, -1, 0, 1… into words. Written only when it changed, so it does not cause a paint by itself.
    dom_set_number(id, value) {
      const out = els[id].querySelector('output');
      const words = els[id].dataset.words?.split('|');
      const text = words ? (words[value + 2] ?? String(value)) : String(value);
      if (out && state[id].text !== text) out.textContent = state[id].text = text;
    },

    report(frames, waits, nested) {
      Object.assign(stats, { frames, waits, nested });
      onReport({ ...stats, inDialog: !!state.find((s, i) => els[i].dataset.ui === 'dialog')?.shown });
    },
  };
  // #endregion imports

  // #region start
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), { env });
  const run = WebAssembly.promising(instance.exports.run);
  // run() is an endless loop in C. Called through promising() it returns a promise at the
  // first wait_event() and the page carries on. The promise settles only if the program traps.
  const first = new Promise((resolve) => canvas.addEventListener('paint', resolve, { once: true }));
  canvas.requestPaint?.();
  await first;                       // the elements have paint records now
  run().then(() => onStop('run() returned'), (err) => onStop(`${err.name}: ${err.message}`));
  // #endregion start

  return {
    stats: () => ({ ...stats, queued: queue.length, waiting: !!wake }),
    element: (name) => els.find((el) => el.dataset.ui === name),
    rect: (name) => state[els.findIndex((el) => el.dataset.ui === name)]?.rect ?? null,
    scale: () => scale,
    exports: instance.exports,
    ctx,
  };
}
