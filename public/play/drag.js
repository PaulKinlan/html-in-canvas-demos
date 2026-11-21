import { mount, put, clamp, ease, fresh } from './kit.js';

export default function start() {
  const canvas = document.getElementById('dragCanvas');
  const tray = document.getElementById('dragTray');
  const ghost = document.getElementById('dragGhost');
  const out = document.getElementById('dragOut');
  const ownImage = document.getElementById('dragOwnImage');
  const TYPE = 'application/x-play-card';
  const CW = 124, CH = 150;

  const cards = () => [...canvas.querySelectorAll('.pcard')];
  const pose = new WeakMap();           // card → { x, y, r } as drawn, centre and rotation
  const count = { native: 0, pointer: 0, dropped: 0, last: 'none yet' };
  let lifted = null;                    // the card that is being dragged: it is not drawn
  let gapAt = -1;                       // index where the cards part while something is dragged over them
  let last = 0;

  const line = () => {
    out.textContent = `Drags started by the browser (dragstart): ${count.native}. Drags followed with pointer events: ${count.pointer}. ` +
      `Cards dropped on the tray: ${count.dropped}. Last drag: ${count.last}.`;
  };

  // #region drag-draw
  // The cards are a fanned hand. Each is drawn at its own rotation, left to right, so the hit regions
  // stack the same way as the pictures. The card being dragged is left out and the others close up.
  const target = (i, n, w, h) => {
    const mid = (n - 1) / 2, step = Math.min(64, (w - CW - 24) / Math.max(1, n - 1));
    const a = (i - mid) * 0.13;
    return { x: w / 2 + (i - mid) * step, y: h / 2 + 8 + Math.abs(i - mid) ** 2 * 5, r: a };
  };
  const drawCard = (ctx, card, p, lift = 0) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.scale(1 + lift * 0.06, 1 + lift * 0.06);
    ctx.shadowColor = `rgb(0 0 0 / ${0.28 + lift * 0.2})`;
    ctx.shadowBlur = 10 + lift * 16;
    ctx.shadowOffsetY = 3 + lift * 9;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.roundRect(-CW / 2 + 1, -CH / 2 + 1, CW - 2, CH - 2, 10); ctx.fill();
    ctx.shadowColor = 'transparent';
    put(ctx, card, -CW / 2, -CH / 2, CW, CH);
    ctx.restore();
  };
  const paint = (ctx, w, h, t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const shown = cards().filter((c) => c !== lifted);
    const slots = shown.length + (gapAt >= 0 ? 1 : 0);
    let moving = false;
    shown.forEach((card, i) => {
      const to = target(gapAt >= 0 && i >= gapAt ? i + 1 : i, slots, w, h);
      let p = pose.get(card);
      if (!p) { p = { x: to.x, y: h + CH, r: to.r }; pose.set(card, p); }
      p.x = ease(p.x, to.x, dt); p.y = ease(p.y, to.y, dt); p.r = ease(p.r, to.r, dt);
      if (Math.abs(p.x - to.x) + Math.abs(p.y - to.y) > 0.3) moving = true;
      drawCard(ctx, card, p);
    });
    if (!shown.length) {
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--muted'); ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Every card has left the scene.', w / 2, h / 2);
    }
    return moving;
  };
  const stage = mount(canvas, paint);
  // #endregion drag-draw

  // #region drag-image
  // The drag image is the card as the canvas draws it. An element's picture can only be drawn into its
  // own canvas, so the scene canvas is cleared, the one card is drawn alone, that region is copied into a
  // plain canvas with drawImage(), and the scene is drawn again. All of it happens in one task, inside
  // the dragstart or pointermove listener, so no frame shows the card alone.
  const PAD = 30;
  function copyCard(card) {
    if (stage.plain || stage.dead) return null;
    const p = pose.get(card), ctx = stage.ctx, k = canvas.width / canvas.clientWidth;
    const size = Math.ceil(Math.hypot(CW, CH) * 1.06) + PAD * 2;
    ctx.reset(); ctx.scale(k, k);
    drawCard(ctx, card, p, 1);
    ghost.width = Math.round(size * k); ghost.height = Math.round(size * k);
    ghost.style.width = ghost.style.height = `${size}px`;
    ghost.getContext('2d').drawImage(canvas, Math.round((p.x - size / 2) * k), Math.round((p.y - size / 2) * k), ghost.width, ghost.height, 0, 0, ghost.width, ghost.height);
    stage.now();
    return { size, half: size / 2 };
  }
  // #endregion drag-image

  const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  // What a card carries. The tray, in this window or another, builds its note from these.
  const payload = (card) => ({
    id: card.dataset.id,
    title: card.querySelector('h3').textContent,
    text: card.querySelector('p').textContent,
    hue: card.style.getPropertyValue('--hue'),
  });
  const makeCard = (d) => {
    const card = document.createElement('article');
    card.className = 'pcard'; card.setAttribute('drawable', ''); card.draggable = true; card.tabIndex = 0;
    card.dataset.id = d.id || `n${Date.now() % 100000}`;
    card.style.setProperty('--hue', d.hue || '210');
    const h = document.createElement('h3'), p = document.createElement('p');
    h.textContent = (d.title || 'Dropped text').slice(0, 40); p.textContent = (d.text || '').slice(0, 90);
    card.append(h, p);
    return card;
  };
  const insertAt = (card, index) => { const list = cards().filter((c) => c !== card); canvas.insertBefore(card, list[index] ?? null); fresh(card); };
  // The index in the hand under a point of the window.
  const indexAt = (clientX) => {
    const r = canvas.getBoundingClientRect(), list = cards().filter((c) => c !== lifted);
    let i = 0;
    while (i < list.length && (pose.get(list[i])?.x ?? 0) < clientX - r.left) i++;
    return i;
  };

  // #region drag-native
  // Route 1: the browser's drag and drop. The card is a `draggable` element that the canvas draws.
  canvas.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.pcard');
    if (!card) return;
    const d = payload(card);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TYPE, JSON.stringify(d));
    e.dataTransfer.setData('text/plain', `${d.title}\n${d.text}`);
    e.dataTransfer.setData('text/html', `<article><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p></article>`);
    if (!ownImage.checked) {
      const g = copyCard(card);
      // setDragImage() takes an element that is in the page. The copy is kept off screen for it.
      if (g) e.dataTransfer.setDragImage(ghost, g.half, g.half);
    }
    count.native++; count.last = 'started by the browser';
    // The card leaves the scene in the next frame, after the browser has taken the drag image.
    requestAnimationFrame(() => { lifted = card; stage.request(); });
    line();
  });
  canvas.addEventListener('dragend', (e) => {
    const card = e.target.closest?.('.pcard');
    if (!card) return;
    // dropEffect is "move" when a target took the card, in this window or another one.
    const taken = e.dataTransfer.dropEffect === 'move';
    count.last = taken ? 'the browser reported dropEffect "move", so the card was removed from the scene' : 'the browser reported no drop, so the card came back';
    requestAnimationFrame(() => {
      lifted = null; gapAt = -1;
      if (taken && card.dataset.kept !== '1') card.remove();
      delete card.dataset.kept;
      stage.request(); line();
    });
  });

  // The canvas is a drop target too: a card from the tray, a card of its own, or text from any page.
  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const i = indexAt(e.clientX);
    if (i !== gapAt) { gapAt = i; stage.request(); }
  });
  canvas.addEventListener('dragleave', (e) => { if (!canvas.contains(e.relatedTarget) && gapAt >= 0) { gapAt = -1; stage.request(); } });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const index = indexAt(e.clientX);
    const raw = e.dataTransfer.getData(TYPE), text = e.dataTransfer.getData('text/plain');
    const d = raw ? JSON.parse(raw) : { title: text.split('\n')[0], text: text.split('\n').slice(1).join(' ') };
    const own = cards().find((c) => c.dataset.id === d.id);
    if (own) { own.dataset.kept = '1'; insertAt(own, index); }            // moved inside the hand
    else if (cards().length < 7 && (d.title || d.text)) insertAt(makeCard(d), index);
    gapAt = -1; stage.request();
  });

  tray.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tray.classList.add('over'); });
  tray.addEventListener('dragleave', () => tray.classList.remove('over'));
  tray.addEventListener('drop', (e) => {
    e.preventDefault();
    tray.classList.remove('over');
    const raw = e.dataTransfer.getData(TYPE);
    accept(raw ? JSON.parse(raw) : { title: e.dataTransfer.getData('text/plain').split('\n')[0], text: '' }, [...e.dataTransfer.types]);
  });
  // #endregion drag-native

  // #region drag-pointer
  // Route 2, for touch and pen: pointer events. A long press did not start a native drag in the test
  // browser, so a finger that moves 8 px on a card starts this route. The same copied pixels follow the
  // finger as a fixed element, and the same payload goes to the tray. The cards have touch-action: none.
  // The rest of the canvas keeps pan-y, so the page still scrolls from anywhere but a card.
  let touch = null;
  canvas.addEventListener('pointerdown', (e) => {
    const card = e.target.closest?.('.pcard');
    if (!card || e.pointerType === 'mouse' || touch) return;
    touch = { id: e.pointerId, card, x: e.clientX, y: e.clientY, live: false, half: 0 };
    card.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    if (!touch.live) {
      if (Math.hypot(e.clientX - touch.x, e.clientY - touch.y) < 8) return;
      const g = copyCard(touch.card);
      if (!g) return;
      touch.live = true; touch.half = g.half;
      lifted = touch.card; ghost.classList.add('follow');
      count.pointer++; count.last = 'followed with pointer events'; line();
    }
    ghost.style.transform = `translate(${e.clientX - touch.half + 400}px, ${e.clientY - touch.half + 400}px)`;
    const overTray = inside(tray, e), overCanvas = inside(canvas, e);
    tray.classList.toggle('over', overTray);
    const i = overCanvas ? indexAt(e.clientX) : -1;
    if (i !== gapAt) gapAt = i;
    stage.request();
  });
  const endTouch = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const { card, live } = touch;
    touch = null;
    if (!live) return;
    ghost.classList.remove('follow'); ghost.style.transform = '';
    tray.classList.remove('over');
    if (e.type === 'pointerup' && inside(tray, e)) { accept(payload(card), [TYPE, 'text/plain', 'text/html']); card.remove(); count.last = 'followed with pointer events and dropped on the tray'; }
    else if (e.type === 'pointerup' && inside(canvas, e)) insertAt(card, indexAt(e.clientX));
    lifted = null; gapAt = -1; stage.request(); line();
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  const inside = (el, e) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
  // #endregion drag-pointer

  // The tray is plain HTML outside the canvas. A note in it can be dragged back or sent back with its button.
  function accept(d, types) {
    if (!d.title) return;
    tray.querySelector('.hint').hidden = true;
    const note = document.createElement('div');
    note.className = 'note'; note.draggable = true;
    note.style.setProperty('--hue', d.hue || '210');
    const b = document.createElement('b'), s = document.createElement('small'), back = document.createElement('button');
    b.textContent = d.title; s.textContent = `Arrived as ${types.join(', ')}`;
    back.type = 'button'; back.textContent = 'Put back';
    back.addEventListener('click', () => { if (cards().length < 7) { insertAt(makeCard(d), cards().length); note.remove(); emptied(); stage.request(); } });
    note.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(TYPE, JSON.stringify({ ...d, id: `${d.id}-b` })); e.dataTransfer.setData('text/plain', `${d.title}\n${d.text}`); });
    note.addEventListener('dragend', (e) => { if (e.dataTransfer.dropEffect === 'move') { note.remove(); emptied(); } });
    note.append(b, s, back);
    tray.append(note);
    count.dropped++; line();
  }
  const emptied = () => { if (!tray.querySelector('.note')) tray.querySelector('.hint').hidden = false; };

  // Keyboard: Enter on a focused card sends it to the tray.
  canvas.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.pcard');
    if (!card || e.key !== 'Enter') return;
    accept(payload(card), ['the keyboard']); card.remove(); stage.request();
  });
  document.getElementById('dragReset').addEventListener('click', () => {
    tray.querySelectorAll('.note').forEach((n) => n.remove()); emptied();
    cards().forEach((c) => c.remove());
    for (const d of START) canvas.append(makeCard(d));
    stage.request();
  });
  const START = cards().map(payload);
  line();
  return { stage };
}
