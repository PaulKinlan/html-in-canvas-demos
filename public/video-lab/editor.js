// editor.js: the title editor scene of /video-lab/. A list of shots (video clips
// and HTML title cards), each a drawable child of the canvas, played in order
// with a shader transition where two shots overlap, and exported frame by frame.

import { TRANSITIONS, place, park } from './gl.js';
import { exportFrames } from '/lib/video-export.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const CARD_LOOKS = ['dawn', 'ink', 'mint'];

export function createEditor(canvas, { onChange = () => {}, onTime = () => {}, shots = null } = {}) {
  const items = [];
  let starts = [], total = 0, t = 0, playing = false, clockAt = 0, near = false, stage = null;

  // ---- the shots ----
  function addClip(src, { from = 0, dur = 3, tr = 'ripple', label = 'Clip' } = {}, at = items.length) {
    const el = document.createElement('div');
    el.className = 'shot';
    el.setAttribute('drawable', '');
    // #region clip-markup
    el.innerHTML = '<video muted playsinline preload="auto"></video>';
    // #endregion clip-markup
    const video = el.firstChild;
    video.dataset.src = src;
    if (near) video.src = src;
    video.addEventListener('seeked', () => canvas.requestPaint());
    video.addEventListener('loadeddata', () => { layout(); sync(true); canvas.requestPaint(); });
    canvas.append(el);
    items.splice(at, 0, { kind: 'clip', el, video, from, dur, tr, label });
    layout();
  }
  function addCard(title, sub, { dur = 2.5, tr = 'fade', look = CARD_LOOKS[items.filter((i) => i.kind === 'card').length % CARD_LOOKS.length] } = {}, at = items.length) {
    const el = document.createElement('div');
    el.className = `shot card look-${look}`;
    el.setAttribute('drawable', '');
    // #region card-markup
    // A title card is HTML. Its text is edited on the canvas. --t is the card's own time, 0 to 1.
    el.innerHTML = '<div class="card-in"><h3 contenteditable="plaintext-only" spellcheck="false"></h3><i class="rule"></i><p contenteditable="plaintext-only" spellcheck="false"></p></div>';
    // #endregion card-markup
    el.querySelector('h3').textContent = title;
    el.querySelector('p').textContent = sub;
    el.addEventListener('input', () => onChange());
    canvas.append(el);
    items.splice(at, 0, { kind: 'card', el, dur, tr, look });
    layout();
  }
  function remove(item) {
    if (items.length < 2) return;
    items.splice(items.indexOf(item), 1);
    item.video?.pause();
    item.video?.removeAttribute('src');
    item.video?.load();
    stage?.gl.forget(item.el);
    item.el.remove();
    layout();
  }
  function move(item, by) {
    const i = items.indexOf(item), j = i + by;
    if (j < 0 || j >= items.length) return;
    items.splice(i, 1);
    items.splice(j, 0, item);
    layout();
  }

  // #region timeline
  // Two shots overlap for the length of the transition between them.
  const overlap = (i) => Math.min(0.7, items[i].dur / 2, items[i + 1].dur / 2);
  function layout() {
    let s = 0;
    starts = items.map((it, i) => { const at = s; s += it.dur - (i < items.length - 1 ? overlap(i) : 0); return at; });
    total = s;
    t = clamp(t, 0, total);
    onChange();
    canvas.requestPaint();
  }
  /** What is on screen at time `at`: one shot, or two and how far the transition is. */
  function shotsAt(at) {
    at = clamp(at, 0, Math.max(0, total - 1e-4));
    let i = 0;
    while (i + 1 < items.length && starts[i + 1] <= at) i++;
    const cur = { item: items[i], local: at - starts[i] };
    if (i > 0 && at < starts[i - 1] + items[i - 1].dur) {
      return { a: { item: items[i - 1], local: at - starts[i - 1] }, b: cur, progress: (at - starts[i]) / overlap(i - 1) };
    }
    return { a: cur, b: null, progress: 0 };
  }
  // #endregion timeline

  // Put every shot at its own time for timeline time t. `exact` seeks the videos; otherwise they play and are only corrected when they drift.
  function sync(exact) {
    const s = shotsAt(t), seeks = [];
    for (const it of items) {
      const on = s.a.item === it ? s.a : s.b?.item === it ? s.b : null;
      if (it.kind === 'card') { if (on) it.el.style.setProperty('--t', (on.local / it.dur).toFixed(4)); continue; }
      const v = it.video;
      if (!on || v.readyState < 1) { if (!v.paused) v.pause(); continue; }
      const want = clamp(it.from + on.local, 0, Math.max(0, (v.duration || 1e9) - 0.05));
      if (exact) {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 1e-3) {
          seeks.push(new Promise((r) => v.addEventListener('seeked', r, { once: true })));
          v.currentTime = want;
        }
      } else {
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
        if (v.paused) v.play().catch(() => {});
      }
    }
    return Promise.all(seeks);
  }

  const scene = {
    elements: () => items.map((i) => i.el),
    near() { near = true; for (const it of items) if (it.video && !it.video.src) it.video.src = it.video.dataset.src; },
    away() { pause(); },
    leave() { pause(); },
    enter() { sync(true); },
    animated() {
      if (!playing) return false;
      t = (performance.now() - clockAt) / 1000;
      if (t >= total) { t = total; pause(); } else sync(false);
      onTime(t, total);
      return true;
    },
    // #region editor-paint
    paint(view) {
      const s = shotsAt(t), full = view.full();
      const front = s.b && s.progress >= 0.5 ? s.b.item : s.a.item;
      // The shot in front takes taps, so a title card can be edited on the canvas. The others are moved away.
      for (const it of items) (it === front ? place(canvas, it.el, new DOMMatrix()) : park(canvas, it.el));
      if (!view.upload(s.a.item.el)) return;
      if (s.b && view.upload(s.b.item.el)) {
        view.quad(s.a.item.el, full, {
          mode: 1, kind: Math.max(0, TRANSITIONS.indexOf(s.b.item.tr)), second: s.b.item.el,
          set: (gl, u) => gl.uniform1f(u('progress'), s.progress),
        });
      } else {
        view.quad(s.a.item.el, full);
      }
    },
    // #endregion editor-paint
  };

  function play() {
    if (playing) return;
    if (t >= total - 0.05) t = 0;
    playing = true;
    clockAt = performance.now() - t * 1000;
    stage?.repaint();
    onTime(t, total);
  }
  function pause() {
    if (!playing) return;
    playing = false;
    for (const it of items) it.video?.pause();
    onTime(t, total);
  }
  /** Stop on timeline time `at` with every video on its exact frame. Resolves when they have all seeked. */
  async function seek(at) {
    playing = false;
    t = clamp(at, 0, total);
    await sync(true);
    onTime(t, total);
    canvas.requestPaint();
  }

  // #region export
  // exportFrames() drives one <video>: it sets currentTime and waits for "seeked". This object
  // has that much of a video's interface, and seeks the whole timeline instead.
  class TimelineClock extends EventTarget {
    paused = true;
    #time = t;
    get currentTime() { return this.#time; }
    set currentTime(value) { this.#time = value; seek(value).then(() => this.dispatchEvent(new Event('seeked'))); }
    pause() { pause(); }
    play() { return Promise.resolve(); }
  }
  /** Encode the timeline (or `seconds` of it from `from`) with WebCodecs, one painted frame at a time. */
  function exportTimeline({ from = 0, seconds = total - from, fps = 30, onframe = null, signal = null } = {}) {
    pause();
    return exportFrames(canvas, { video: new TimelineClock(), root: canvas, from, seconds, fps, onframe, signal });
  }
  // #endregion export

  for (const s of shots ?? [
    { card: ['Fractal zoom', 'A title card is a contenteditable element'], dur: 2.5 },
    { clip: '/media/clip.webm', from: 0.5, dur: 3, tr: 'ripple', label: 'Fractal clip' },
    { card: ['Tap this text and type', 'It is HTML in the canvas'], dur: 2.5, tr: 'pixelate' },
    { clip: '/media/talk.webm', from: 2, dur: 3, tr: 'swirl', label: 'Talk clip' },
    { card: ['The end', 'Export writes these frames to a WebM file'], dur: 2, tr: 'wipe' },
  ]) {
    if (s.card) addCard(s.card[0], s.card[1], s); else addClip(s.clip, s);
  }

  return {
    scene, items, addCard, addClip, remove, move, layout, play, pause, seek, shotsAt, exportTimeline,
    attach(s) { stage = s; },
    get total() { return total; },
    get time() { return t; },
    get playing() { return playing; },
    starts: () => starts.slice(),
    labelOf: (it) => (it.kind === 'card' ? it.el.querySelector('h3').textContent.trim() || 'Title card' : it.label),
  };
}

/** The list of shots and the transport, as plain HTML under the canvas. */
export function mountEditorUI(editor, root) {
  root.innerHTML = `
    <div class="transport">
      <button type="button" data-act="play" aria-pressed="false">Play</button>
      <input type="range" min="0" max="1000" value="0" aria-label="Position in the timeline">
      <output>0.0 / 0.0 s</output>
    </div>
    <ol class="shots" aria-label="Shots in order"></ol>
    <div class="transport">
      <button type="button" data-act="card">Add a title card</button>
      <button type="button" data-act="export">Export as WebM</button>
      <span class="note" data-role="export-note" role="status"></span>
    </div>
    <div class="exported" data-role="exported"></div>`;
  const playBtn = root.querySelector('[data-act=play]'), range = root.querySelector('input[type=range]'), out = root.querySelector('output');
  const list = root.querySelector('.shots'), note = root.querySelector('[data-role=export-note]'), exported = root.querySelector('[data-role=exported]');
  let busy = false;

  function time(t, total) {
    range.value = total ? Math.round((t / total) * 1000) : 0;
    out.textContent = `${t.toFixed(1)} / ${total.toFixed(1)} s`;
    playBtn.textContent = editor.playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(editor.playing));
  }
  function rows() {
    // Typing in a card only changes its label: the rows are not rebuilt, so a focused field keeps focus.
    if (list.children.length === editor.items.length && [...list.children].every((li, i) => li.item === editor.items[i])) {
      [...list.children].forEach((li) => (li.querySelector('.name').textContent = editor.labelOf(li.item)));
      time(editor.time, editor.total);
      return;
    }
    list.replaceChildren(...editor.items.map((it, i) => {
      const li = document.createElement('li');
      li.item = it;
      li.innerHTML = `<span class="kind">${it.kind === 'card' ? 'Title' : 'Clip'}</span><span class="name"></span>
        <label>s <input type="number" min="1" max="8" step="0.5" value="${it.dur}" aria-label="Length in seconds"></label>
        <label>in <select aria-label="Transition into this shot" ${i === 0 ? 'disabled' : ''}>${TRANSITIONS.map((n) => `<option${n === it.tr ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="acts"><button type="button" data-by="-1" aria-label="Move up">↑</button><button type="button" data-by="1" aria-label="Move down">↓</button><button type="button" data-del aria-label="Remove">✕</button></span>`;
      li.querySelector('.name').textContent = editor.labelOf(it);
      li.querySelector('input').addEventListener('change', (e) => { it.dur = Math.min(8, Math.max(1, Number(e.target.value) || 1)); editor.layout(); });
      li.querySelector('select').addEventListener('change', (e) => { it.tr = e.target.value; editor.layout(); });
      for (const b of li.querySelectorAll('[data-by]')) b.addEventListener('click', () => editor.move(it, Number(b.dataset.by)));
      li.querySelector('[data-del]').addEventListener('click', () => editor.remove(it));
      return li;
    }));
    time(editor.time, editor.total);
  }

  playBtn.addEventListener('click', () => (editor.playing ? editor.pause() : editor.play()));
  range.addEventListener('input', () => editor.seek((range.value / 1000) * editor.total));
  root.querySelector('[data-act=card]').addEventListener('click', () => {
    if (editor.items.length >= 8) { note.textContent = 'Eight shots is the limit here.'; return; }
    editor.addCard('New title', 'Tap to edit', { tr: 'fade' });
  });
  root.querySelector('[data-act=export]').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    note.textContent = 'Exporting: 0 %';
    const frames = Math.round(editor.total * 30);
    try {
      const r = await editor.exportTimeline({ onframe: (i) => { if (i % 10 === 0) note.textContent = `Exporting: ${Math.round((i / frames) * 100)} %`; } });
      const url = URL.createObjectURL(r.blob);
      note.textContent = `${r.frames} frames, ${r.codec}, ${(r.blob.size / 1024).toFixed(0)} KB, ${r.msPerFrame.toFixed(0)} ms per frame. No sound track.`;
      exported.innerHTML = '<video controls playsinline muted></video> <a download="title-editor.webm">Download the file</a>';
      for (const old of exported.querySelectorAll('video[src]')) URL.revokeObjectURL(old.src);
      exported.querySelector('video').src = url;
      exported.querySelector('a').href = url;
    } catch (err) {
      note.textContent = `Export failed: ${err.message}`;
      window.__gfx?.report?.('video-lab-export', err.message, {});
    }
    busy = false;
    editor.seek(1);
  });
  return { rows, time };
}
