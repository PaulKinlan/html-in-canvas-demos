// Other readers' selections, drawn by the canvas of a <selection-fx>.
//
// A selection travels as two character offsets into the article's text. The
// receiver turns them back into a Range, asks for its rectangles and draws
// them. Nothing is added to the DOM and the receiver's own selection is not
// touched.

import { defineSelectionEffect } from '/lib/selection-fx.js';
import { offsetsOf, rangeAt, localRects, roundPath } from '/lib/selection-tools.js';

export const COLOURS = ['#2f6fed', '#d2491f', '#1f9d6b', '#a23bd1', '#c98a00', '#d13b7a'];

// #region effect
// el.peers is a Map of id -> { name, color, start, end }. The rectangles are
// measured on every draw, so they follow a resize or a font change.
defineSelectionEffect('peers', {
  color: COLOURS[0],
  draw(ctx, s, el) {
    const article = el.querySelector('[data-peers-text]') ?? el;
    const drawn = [];
    ctx.fillStyle = s.color.alpha(0.28);
    for (const r of s.rects) { roundPath(ctx, r, 1, 4); ctx.fill(); }
    for (const p of el.peers?.values() ?? []) {
      if (p.end <= p.start) continue;
      const rects = localRects(el, rangeAt(article, p.start, p.end));
      p.rects = rects;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = p.color;
      for (const r of rects) { roundPath(ctx, r, 1, 4); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (rects.length) drawn.push([p, rects.at(-1)]);
    }
    el.drawContent(ctx);
    // A bar at the moving end of each reader's selection and a flag with the name.
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const [p, r] of drawn) {
      const x = r.x + r.w;
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 1, r.y - 2, 2, r.h + 4);
      const w = ctx.measureText(p.name).width + 10;
      const fx = Math.max(0, Math.min(s.width - w, x - 1));
      ctx.beginPath();
      ctx.roundRect(fx, r.y - 17, w, 16, [4, 4, 4, 0]);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, fx + 5, r.y - 8.5);
    }
  },
});
// #endregion effect

// #region room
/** Join a room: send this reader's selection and collect everyone else's in el.peers. */
export function join(el, article, { room = 'selection-peers', name, color, onchange = () => {} } = {}) {
  const id = Math.random().toString(36).slice(2, 10);
  const channel = new BroadcastChannel(room);
  const peers = (el.peers = new Map());
  let mine = { start: 0, end: 0 };
  const changed = () => { el.invalidate(); onchange(peers); };
  const say = (type = 'selection') => channel.postMessage({ type, id, name, color, ...mine });

  channel.onmessage = ({ data }) => {
    if (!data || data.id === id) return;
    if (data.type === 'bye') peers.delete(data.id);
    else {
      peers.set(data.id, { name: String(data.name).slice(0, 24), color: data.color, start: data.start | 0, end: data.end | 0, seen: Date.now() });
      if (data.type === 'hello') say(); // tell the newcomer what is selected here
    }
    changed();
  };
  // The element reports every change of the selection inside it.
  el.addEventListener('selectionfx', () => {
    const selection = getSelection();
    const o = selection.rangeCount && !selection.isCollapsed ? offsetsOf(article, selection.getRangeAt(0)) : null;
    mine = o ?? { start: 0, end: 0 };
    say();
  });
  addEventListener('pagehide', () => say('bye'));
  say('hello');
  return {
    id, peers, channel, changed,
    rename(n) { name = n; say(); },
    leave() { say('bye'); channel.close(); },
  };
}
// #endregion room

// #region bots
/** Two simulated readers that select one sentence after another. */
export function bots(el, article, changed) {
  const text = article.textContent;
  const sentences = [...text.matchAll(/[^.!?\s][^.!?]*[.!?]/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const readers = [
    { id: 'bot-ada', name: 'Ada (simulated)', color: COLOURS[2], at: 1 },
    { id: 'bot-lin', name: 'Lin (simulated)', color: COLOURS[3], at: 4 },
  ];
  let timer = 0;
  function step(reader) {
    const target = sentences[reader.at % sentences.length];
    reader.at += 2;
    const began = performance.now();
    const peer = { name: reader.name, color: reader.color, start: target.start, end: target.start };
    el.peers.set(reader.id, peer);
    const grow = () => {
      const k = still ? 1 : Math.min(1, (performance.now() - began) / 700);
      peer.end = target.start + Math.round((target.end - target.start) * (1 - (1 - k) ** 2));
      changed();
      if (k < 1 && el.peers.get(reader.id) === peer) requestAnimationFrame(grow);
    };
    grow();
  }
  return {
    start() {
      if (timer) return;
      let n = 0;
      readers.forEach(step);
      timer = setInterval(() => { if (!document.hidden) step(readers[n++ % readers.length]); }, 2200);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      for (const r of readers) el.peers.delete(r.id);
      changed();
    },
  };
}
// #endregion bots
