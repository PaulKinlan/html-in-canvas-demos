import { mount, put, hitOnly, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('planCanvas');
  const img = document.getElementById('planImg');
  const out = document.getElementById('planOut');
  const areas = [...canvas.querySelectorAll('area')];
  const rooms = areas.map((area) => {
    const [x1, y1, x2, y2] = area.coords.split(',').map(Number);
    return { area, x: x1, y: y1, w: x2 - x1, h: y2 - y1, name: area.alt, fill: area.dataset.fill };
  });
  // The picture is an SVG made from the same coordinates as the <area> elements.
  img.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" font-family="system-ui,sans-serif" font-size="15" font-weight="600">`
    + rooms.map((r) => `<rect x="${r.x + 2}" y="${r.y + 2}" width="${r.w - 4}" height="${r.h - 4}" fill="${r.fill}" stroke="#3a3733" stroke-width="3"/><text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 + 5}" text-anchor="middle" fill="#1d1c1a">${r.name}</text>`).join('') + '</svg>');
  let chosen = null, lift = 0;

  // #region plan
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas);
    const k = Math.min(1, (w - 16) / 366);
    // The floor: the image turned 45 degrees and squashed to half height. Still one affine transform.
    const floor = (up = 0) => { ctx.translate(w / 2 - 35 * k, 26 * k - up + 20); ctx.scale(k, k * 0.5); ctx.rotate(Math.PI / 4); };
    ctx.save(); floor(); put(ctx, img, 0, 0); ctx.restore();
    lift += ((chosen ? 18 : 0) - lift) * 0.25;
    const room = chosen ?? stage.last;
    if (room && lift > 0.3) {
      // The chosen room, raised: a stack of filled outlines for the walls, then that part of the image on top.
      for (let up = 0; up < lift; up++) {
        ctx.save(); floor(up); ctx.fillStyle = c.fg; ctx.fillRect(room.x, room.y, room.w, room.h); ctx.restore();
      }
      ctx.save(); floor(lift);
      ctx.beginPath(); ctx.rect(room.x, room.y, room.w, room.h); ctx.clip();
      put(ctx, img, 0, 0);
      ctx.restore();
    }
    const focused = rooms.find((r) => r.area === document.activeElement && r.area.matches(':focus-visible'));
    if (focused) { ctx.save(); floor(focused === chosen ? lift : 0); ctx.strokeStyle = c.accent; ctx.lineWidth = 5; ctx.strokeRect(focused.x, focused.y, focused.w, focused.h); ctx.restore(); }
    // The image and its areas take taps on the floor, not on the raised copy.
    ctx.save(); floor(); hitOnly(ctx, img, 0, 0); ctx.restore();
    return Math.abs((chosen ? 18 : 0) - lift) > 0.3;
  });
  // #endregion plan

  canvas.addEventListener('click', (e) => {
    const room = rooms.find((r) => r.area === e.target);
    if (!room) return;
    e.preventDefault();
    chosen = chosen === room ? null : room;
    if (chosen) stage.last = chosen;
    out.textContent = chosen ? `${room.name}: ${(room.w * room.h / 1000).toFixed(1)} m² (click came from <area alt="${room.name}">)` : 'No room chosen';
    stage.request();
  });
  canvas.addEventListener('focusin', stage.request);
  canvas.addEventListener('focusout', stage.request);
}
