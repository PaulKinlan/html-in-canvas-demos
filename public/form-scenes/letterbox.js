import { put, park, smooth, lerp, clamp, reducedMotion } from '/lib/stage-2d.js';
import { scene, seeded } from './scene.js';

export default function start() {
  const canvas = document.getElementById('lbCanvas');
  const input = document.getElementById('lbInput');
  const out = document.getElementById('lbOut');
  const W = 380, H = 480, SLOT_Y = 124, FLOOR = 452, MOST = 12;
  const random = seeded(7);

  // #region letterbox-items
  // One element for each chosen file: a button that holds a small copy of the picture, or the file
  // name on an envelope. The button is a child of the canvas, so it can be drawn, tapped and focused.
  const items = new Map();      // key of a file -> { el, file, from, x, angle, slot, leaving }
  const keyOf = (f) => `${f.name}|${f.size}|${f.lastModified}`;

  // A copy at most 176 pixels wide, so a 12 megapixel photo is not decoded at full size for a 88 pixel print.
  async function small(file) {
    if (!file.type.startsWith('image/')) return null;
    try {
      const bitmap = await createImageBitmap(file, { resizeWidth: 176, resizeQuality: 'medium' });
      const copy = new OffscreenCanvas(bitmap.width, bitmap.height);
      copy.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      return URL.createObjectURL(await copy.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
    } catch {
      return file.size < 1e6 ? URL.createObjectURL(file) : null;   // an SVG, for example
    }
  }

  async function make(file) {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('drawable', '');
    el.setAttribute('aria-label', `Take ${file.name} out of the box`);
    const url = await small(file);
    if (url) {
      const img = new Image();
      img.alt = '';
      img.src = url;
      try { await img.decode(); el.className = 'lb-print'; el.append(img); el.dataset.url = url; } catch { URL.revokeObjectURL(url); }
    }
    if (!el.firstChild) { el.className = 'lb-letter'; el.textContent = file.name; }
    return el;
  }

  // Make the scene match input.files: new files drop in, files that are gone fly back out.
  let run = 0;
  async function sync() {
    const mine = ++run;
    const files = [...input.files];
    const keys = new Set(files.map(keyOf));
    const t = performance.now();
    for (const [key, item] of items) if (!keys.has(key) && !item.leaving) item.leaving = t;
    let order = 0;
    for (const file of files.slice(0, MOST)) {
      const key = keyOf(file);
      if (items.has(key)) { items.get(key).leaving = 0; continue; }
      const el = await make(file);
      if (mine !== run || ![...input.files].some((f) => keyOf(f) === key)) { if (el.dataset.url) URL.revokeObjectURL(el.dataset.url); continue; }
      // After a fallback to plain HTML the canvas is hidden and its children are in the box after it.
      (canvas.hidden ? canvas.nextElementSibling : canvas).append(el);
      const n = items.size;
      items.set(key, { el, file, from: performance.now() + order++ * 170, slot: 120 + random() * 140, x: 62 + (n * 97) % 256, lift: (n % 3) * 12 + random() * 8, angle: (random() - 0.5) * 0.9, leaving: 0 });
    }
    report();
  }
  // #endregion letterbox-items

  // #region letterbox-draw
  const bounce = (q) => { const n = 7.5625, d = 2.75; if (q < 1 / d) return n * q * q; if (q < 2 / d) return n * (q -= 1.5 / d) * q + 0.75; if (q < 2.5 / d) return n * (q -= 2.25 / d) * q + 0.9375; return n * (q -= 2.625 / d) * q + 0.984375; };

  const stage = scene(canvas, W, H, (ctx, t) => {
    // The inside of a door, a brass plate, a mat.
    ctx.fillStyle = '#2f5d50'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#244a40'; ctx.lineWidth = 2;
    for (let x = 76; x < W; x += 76) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.fillStyle = '#6d4c2f'; ctx.fillRect(16, FLOOR - 8, W - 32, H - FLOOR + 8);
    ctx.strokeStyle = '#5a3d24';
    for (let x = 28; x < W - 20; x += 12) { ctx.beginPath(); ctx.moveTo(x, FLOOR - 4); ctx.lineTo(x, H); ctx.stroke(); }
    const brass = ctx.createLinearGradient(0, 62, 0, 140);
    brass.addColorStop(0, '#e6c869'); brass.addColorStop(1, '#9c7a1c');
    ctx.fillStyle = brass;
    ctx.beginPath(); ctx.roundRect(48, 62, 284, 78, 10); ctx.fill();
    ctx.fillStyle = '#5c470f';
    for (const x of [60, 320]) { ctx.beginPath(); ctx.arc(x, 101, 4, 0, 7); ctx.fill(); }

    // The file input is the slot. Its button and its "3 files" text are the browser's own.
    put(ctx, input, (W - input.offsetWidth) / 2, SLOT_Y - input.offsetHeight);

    let more = false;
    for (const [key, item] of items) {
      const { el } = item;
      const w = el.offsetWidth, h = el.offsetHeight;
      const rest = FLOOR - h / 2 - item.lift, free = SLOT_Y + h / 2 + 6;
      let x = item.slot, y, angle = 0, inSlot = false;
      if (item.leaving) {
        // Back up to the slot, then up through it.
        const p = reducedMotion() ? 2 : (t - item.leaving) / 320;
        if (p >= 2) { el.remove(); if (el.dataset.url) URL.revokeObjectURL(el.dataset.url); items.delete(key); continue; }
        const q = smooth(clamp(p));
        x = lerp(item.x, item.slot, q); y = lerp(rest, free, q); angle = item.angle * (1 - q);
        if (p > 1) { y = lerp(free, SLOT_Y - h / 2, smooth(p - 1)); inSlot = true; }
        more = true;
      } else {
        const age = reducedMotion() ? 1e9 : t - item.from;
        if (age < 0) { park(canvas, el, W / 2, SLOT_Y); more = true; continue; }       // not posted yet
        if (age < 380) { y = lerp(SLOT_Y - h / 2, free, smooth(age / 380)); inSlot = true; more = true; } else {
          const q = clamp((age - 380) / 800);
          y = lerp(free, rest, bounce(q)); x = lerp(item.slot, item.x, smooth(q)); angle = item.angle * smooth(q);
          if (q < 1) more = true;
        }
      }
      ctx.save();
      if (inSlot) { ctx.beginPath(); ctx.rect(0, SLOT_Y - 3, W, H); ctx.clip(); }       // it comes out from behind the plate
      ctx.translate(x, y); ctx.rotate(angle);
      ctx.fillStyle = '#0000003a'; ctx.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
      put(ctx, el, -w / 2, -h / 2);                                                     // the button is hit where it lies, turned
      ctx.restore();
    }
    return more;
  });
  // #endregion letterbox-draw

  // #region letterbox-events
  const size = (n) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1000))} kB` : `${(n / 1e6).toFixed(1)} MB`);
  function report() {
    const files = [...input.files];
    out.textContent = files.length
      ? `input.files: ${files.length} (${size(files.reduce((n, f) => n + f.size, 0))}): ${files.map((f) => f.name).join(', ')}${files.length > MOST ? `. Only the first ${MOST} are drawn.` : ''}`
      : 'input.files is empty. Tap the slot, or drop files on it.';
    stage.request();
  }
  input.addEventListener('change', sync);

  // input.files can be written with the list of a DataTransfer. That is how a file is taken out again.
  function setFiles(files) {
    const list = new DataTransfer();
    for (const f of files) list.items.add(f);
    input.files = list.files;
    sync();
  }
  canvas.addEventListener('click', (e) => {
    const el = e.target.closest?.('.lb-print, .lb-letter');
    if (!el) return;
    const item = [...items.values()].find((i) => i.el === el);
    if (item) setFiles([...input.files].filter((f) => f !== item.file && keyOf(f) !== keyOf(item.file)));
  });
  // #endregion letterbox-events

  // Sample files, for a device with nothing to choose. They are made from text, not read from a canvas.
  const picture = (name, body) => new File([`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">${body}</svg>`], name, { type: 'image/svg+xml', lastModified: 1 });
  const samples = () => [
    picture('sun.svg', '<rect width="240" height="180" fill="#8fd3ff"/><circle cx="170" cy="60" r="34" fill="#ffd34d"/><path d="M0 140 Q60 100 120 140 T240 130 V180 H0Z" fill="#3c9a5f"/>'),
    picture('boat.svg', '<rect width="240" height="180" fill="#ffe2c2"/><rect y="120" width="240" height="60" fill="#2b6cb0"/><path d="M60 120 H180 L160 145 H80Z" fill="#7b3f1d"/><path d="M120 40 V118 H170Z" fill="#fff"/>'),
    picture('night.svg', '<rect width="240" height="180" fill="#1b2340"/><circle cx="70" cy="60" r="26" fill="#f4f1de"/><circle cx="82" cy="52" r="24" fill="#1b2340"/><path d="M0 180 L70 110 L120 150 L170 90 L240 180Z" fill="#0f1529"/>'),
    new File(['Back on Tuesday.'], 'note.txt', { type: 'text/plain', lastModified: 1 }),
  ];
  document.getElementById('lbSamples').addEventListener('click', () => {
    const have = new Set([...input.files].map(keyOf));
    setFiles([...input.files, ...samples().filter((f) => !have.has(keyOf(f)))]);
  });
  document.getElementById('lbEmpty').addEventListener('click', () => { input.value = ''; sync(); });
  report();
  return { stage, setFiles, items };
}
