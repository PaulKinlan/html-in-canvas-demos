// wear-layer.js: marks that build up on a control with use. Chips, scuffs and fingerprints are drawn into
// plain canvases the size of the element, and the page composites them with the element's picture.
// Used by /worn-controls/.
//
//   const chips = wearLayer(220, 72);            a transparent plain canvas, 2 pixels per CSS pixel
//   chip(chips.ctx, x, y, radius, rand);         an irregular filled patch
//   scuff(layer.ctx, x, y, radius);              a soft pale blotch
//   fingerprint(layer.ctx, x, y, size, angle, rand);
//   const rand = rng(seed);                      the same seed draws the same mark, so wear can be saved as a list
//
// A wear canvas is never read. The page draws it with drawImage().

// A small seeded generator (mulberry32). Math.random() can't replay a mark after a reload.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wearLayer(width, height, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);                       // marks are placed in CSS pixels
  return { canvas, ctx, width, height, clear() { ctx.clearRect(0, 0, width, height); } };
}

// #region marks
// A chip of paint: a polygon with 7 to 10 corners at uneven distances from its centre.
export function chip(ctx, x, y, radius, rand) {
  const corners = 7 + Math.floor(rand() * 4), turn = rand() * Math.PI * 2;
  ctx.beginPath();
  for (let i = 0; i < corners; i++) {
    const a = turn + (i / corners) * Math.PI * 2, r = radius * (0.45 + rand() * 0.75);
    ctx.lineTo(x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#000';                        // only the alpha is used
  ctx.fill();
}

export function scuff(ctx, x, y, radius) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, 'rgb(255 255 255 / .09)'); g.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

// A fingerprint: arches near the tip, loops round a core lower down, clipped to the oval of a fingertip.
export function fingerprint(ctx, x, y, size, angle, rand) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.ellipse(0, 0, size * 0.72, size, 0, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = `rgb(255 255 255 / ${0.1 + rand() * 0.08})`;
  ctx.lineWidth = Math.max(0.8, size / 30);
  const coreY = size * (0.1 + rand() * 0.2), lean = (rand() - 0.5) * 0.5, gap = size / 11;
  for (let r = gap * 0.6; r < size * 1.9; r += gap) {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * (1 + i / 40) + lean * (i / 40 - 0.5);          // the upper half of an oval
      const wob = 1 + 0.05 * Math.sin(i * 0.9 + r);
      ctx.lineTo(Math.cos(a) * r * 0.8 * wob, coreY + Math.sin(a) * r * 1.15 * wob);
    }
    if (r < size * 0.55) {                                                // near the core the ridges close into loops
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * (i / 20);
        ctx.lineTo(Math.cos(a) * r * 0.8, coreY + Math.sin(a) * r * 0.5);
      }
    } else {                                                              // further out they run down the sides
      ctx.moveTo(-r * 0.8, coreY); ctx.lineTo(-r * 0.8 - lean * 6, size);
      ctx.moveTo(r * 0.8, coreY); ctx.lineTo(r * 0.8 - lean * 6, size);
    }
    ctx.stroke();
  }
  ctx.restore();
}
// #endregion marks
