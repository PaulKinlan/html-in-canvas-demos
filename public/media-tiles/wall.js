import { mount, piece, place, colors, clamp, lerp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('wallCanvas');
  const video = document.getElementById('wallVideo');
  const out = document.getElementById('wallOut');
  const grids = { '3 by 2': [3, 2], '4 by 3': [4, 3], '6 by 4': [6, 4], '8 by 5': [8, 5] };
  let cols = 4, rows = 3;
  let apart = true;          // what the buttons ask for
  let held = -1e9;           // time of the last touch on the wall: it closes up while it is used
  let spread = 0, last = 0, paints = 0, burst = 0;

  // #region wall
  // One <video controls> element, drawn once per tile with the nine-argument form of drawElementImage():
  // a source rectangle of the video's picture and a destination rectangle under the tile's own transform.
  // A playing video raises `paint` for each new frame, so there is no frame loop while the wall is closed.
  const stage = mount(canvas, (ctx, w, h, t) => {
    paints++;
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const vw = video.offsetWidth, vh = video.offsetHeight;
    const k = Math.min(1, (w - 24) / vw);                       // the closed wall fits the canvas
    const x0 = (w - vw * k) / 2, y0 = (h - vh * k) / 2;
    // The wall closes up while the reader is using it, and for 4 s after, so the controls are in one piece.
    const want = apart && t - held > 4000 ? 1 : 0;
    spread += (want - spread) * (1 - Math.exp(-dt * (want ? 2.2 : 7)));
    if (Math.abs(want - spread) < 0.002) spread = want;
    burst *= Math.exp(-dt * 2.5);

    ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, w, h);
    const tw = vw / cols, th = vh / rows, s = t / 1000;
    // Far tiles first: each tile has a depth, and deeper tiles are drawn smaller and darker.
    const tiles = [];
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const n = r * cols + q;
      const depth = Math.sin(n * 12.9898) * 0.5 + 0.5;          // fixed per tile, 0 to 1
      tiles.push({ q, r, n, z: Math.sin(s * 0.5 + depth * 6.283) * spread });
    }
    tiles.sort((a, b) => a.z - b.z);
    for (const { q, r, n, z } of tiles) {
      const ux = (q + 0.5) / cols - 0.5, uy = (r + 0.5) / rows - 0.5;   // -0.5 to 0.5 from the middle
      const push = spread * (0.1 + burst);
      const cx = x0 + (q + 0.5) * tw * k + (ux * vw * push + Math.sin(s * 0.7 + n * 1.7) * 7 * spread) * k;
      const cy = y0 + (r + 0.5) * th * k + (uy * vh * push * 1.6 + Math.cos(s * 0.6 + n * 2.3) * 6 * spread) * k;
      const size = k * (1 + z * 0.14 - spread * 0.16);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((Math.sin(s * 0.4 + n) * 0.09 + ux * burst * 0.8) * spread);
      ctx.scale(size, size);
      if (spread > 0.01) { ctx.shadowColor = '#000c'; ctx.shadowBlur = 14 * spread; ctx.shadowOffsetY = 6 * spread; }
      // Half a pixel of overlap hides the joins between tiles when the wall is closed.
      const o = spread < 0.01 ? 0.5 : 0;
      piece(ctx, video, q * tw - o, r * th - o, tw + o * 2, th + o * 2, -tw / 2 - o, -th / 2 - o, tw + o * 2, th + o * 2);
      ctx.shadowColor = 'transparent';
      if (z < 0) { ctx.fillStyle = `rgb(0 0 0 / ${-z * 0.45})`; ctx.fillRect(-tw / 2, -th / 2, tw, th); }
      ctx.restore();
    }
    // Each source-rectangle draw moved the video's hit region to its tile. A whole draw that is clipped
    // away puts it back on the closed wall, so the one set of controls answers there.
    ctx.save(); ctx.translate(x0, y0); ctx.scale(k, k); place(ctx, video, 0, 0); ctx.restore();

    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    if (apart && spread < 0.5) ctx.fillText('Closed while you use the controls', w / 2, h - 10);
    const q = video.getVideoPlaybackQuality?.();
    out.textContent = `${cols * rows} tiles from 1 <video>, ${cols * rows} draws per paint. ${video.paused ? 'Paused' : 'Playing'} at ${video.currentTime.toFixed(1)} s`
      + `${q ? `, ${q.totalVideoFrames} frames decoded` : ''}. Paint events: ${paints}.`;
    // Ask for frames only while tiles are moving. A playing video asks for its own.
    return spread > 0 || want > 0;
  });
  // #endregion wall

  // #region wall-touch
  // Any pointer on the canvas closes the wall, so that a tap lands on controls that are in one piece.
  const touch = () => { held = performance.now(); stage.request(); };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'focusin']) canvas.addEventListener(type, touch);
  for (const type of ['play', 'pause', 'seeked', 'volumechange']) video.addEventListener(type, () => stage.request());
  // #endregion wall-touch

  const apartButton = document.getElementById('wallApart');
  const setApart = (on) => { apart = on; held = -1e9; apartButton.setAttribute('aria-pressed', String(on)); apartButton.textContent = on ? 'Close up' : 'Drift apart'; stage.request(); };
  apartButton.addEventListener('click', () => setApart(!apart));
  document.getElementById('wallBurst').addEventListener('click', () => { burst = 0.9; if (!apart) setApart(true); held = -1e9; stage.request(); });
  const play = document.getElementById('wallPlay');
  const label = () => { play.textContent = video.paused ? 'Play' : 'Pause'; };
  play.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  video.addEventListener('play', label); video.addEventListener('pause', label);
  const grid = document.getElementById('wallGrid');
  grid.addEventListener('change', () => { [cols, rows] = grids[grid.value] ?? [4, 3]; stage.request(); });

  // The clip is loaded as a blob so that the timeline can seek on a server with no Range support.
  // It plays muted while the wall is on screen and pauses when it leaves.
  let byPage = false, byReader = false;
  video.addEventListener('pause', () => { if (byPage) byPage = false; else byReader = true; });
  video.addEventListener('play', () => { byReader = false; });
  fetch(video.dataset.src).then((r) => r.blob()).then((blob) => {
    video.src = URL.createObjectURL(blob);
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!byReader) video.play().catch(() => {}); } else if (!video.paused) { byPage = true; video.pause(); }
    }).observe(canvas);
  }).catch((err) => { out.textContent = `The clip did not load: ${err.message}`; });
  label();
  return { stage };
}
