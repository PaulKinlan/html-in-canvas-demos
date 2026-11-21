// cue-layer.js: the active cues of a text track as elements a canvas can draw.
//
//   import { cueLayer, cueElement, cuesAt } from '/lib/cue-layer.js';
//
//   const track = video.textTracks[0];
//   const layer = cueLayer(track, host);     // sets track.mode = 'hidden' when it is 'disabled'
//   layer.update(video.currentTime);         // marks each word past, now or future
//   layer.stop();
//
// The track stays hidden, so the video element draws no captions itself. The
// browser still parses the file and keeps track.activeCues up to date. On each
// `cuechange` the layer adds one element per active cue to `host` and removes
// the elements of cues that ended. `host` can be any element. Give it the
// `drawable` attribute inside a canvas and the captions can be drawn anywhere.
//
// A cue becomes <p class="cue" data-voice="Ada">. Each word is
// <span class="w" data-t="1.626">, where data-t is the time stamp in front of
// it in the WebVTT text, or the start of the cue. Tags in the cue (<b>, <i>,
// <c.name>, <v>, <lang>, <ruby>) are kept as the elements getCueAsHTML() makes.

const seconds = (stamp) => stamp.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);

// #region element
/** Build the element for one cue from the fragment VTTCue.getCueAsHTML() returns. */
export function cueElement(cue) {
  const p = document.createElement('p');
  p.className = 'cue';
  p.dataset.start = cue.startTime;
  p.dataset.end = cue.endTime;
  if (cue.id) p.dataset.id = cue.id;
  let at = cue.startTime;
  const copy = (from, to) => {
    for (const node of from.childNodes) {
      if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
        // <00:00:01.626> in the cue text arrives as <?timestamp 00:00:01.626?>.
        if (node.target === 'timestamp') at = seconds(node.data);
      } else if (node.nodeType === Node.TEXT_NODE) {
        for (const piece of node.data.split(/(\s+)/)) {
          if (!piece) continue;
          if (/^\s+$/.test(piece)) { to.append(' '); continue; }
          const word = document.createElement('span');
          word.className = 'w';
          word.dataset.t = at;
          word.textContent = piece;
          to.append(word);
        }
      } else {
        const el = node.cloneNode(false);
        // <v Ada> arrives as <span title="Ada">.
        if (el.localName === 'span' && el.title) p.dataset.voice ??= el.title;
        to.append(el);
        copy(node, el);
      }
    }
  };
  copy(cue.getCueAsHTML(), p);
  return p;
}
// #endregion element

/** The cues of `track` that cover `time`, by comparing times. Does not wait for the browser to update activeCues. */
export function cuesAt(track, time) {
  return [...(track.cues ?? [])].filter((cue) => cue.startTime <= time && time < cue.endTime);
}

// #region layer
/**
 * Keep one element in `host` for each active cue of `track`.
 * options.render(cue) makes the element (default cueElement).
 * options.onenter(element, cue) and options.onexit(element, cue) are called as cues come and go.
 */
export function cueLayer(track, host, { render = cueElement, onenter = null, onexit = null } = {}) {
  if (track.mode === 'disabled') track.mode = 'hidden';
  const shown = new Map(); // cue → element

  function show(cues) {
    for (const [cue, el] of shown) {
      if (cues.includes(cue)) continue;
      shown.delete(cue);
      el.remove();
      onexit?.(el, cue);
    }
    for (const cue of cues) {
      if (shown.has(cue)) continue;
      const el = render(cue);
      shown.set(cue, el);
      host.append(el);
      onenter?.(el, cue);
    }
  }
  const sync = () => show([...(track.activeCues ?? [])]);

  /**
   * Mark the words of each shown cue for `time`: data-state is "past", "now" or "future".
   * With { exact: true } the shown cues are also chosen by comparing times (cuesAt), for a
   * time the browser has not reached yet, such as the media time of a frame being exported.
   * Returns [{ cue, element, progress, word, words }].
   */
  function update(time, { exact = false } = {}) {
    if (exact) show(cuesAt(track, time));
    const out = [];
    for (const [cue, el] of shown) {
      const words = el.querySelectorAll('.w');
      let now = -1;
      words.forEach((w, i) => { if (Number(w.dataset.t) <= time) now = i; });
      words.forEach((w, i) => {
        const state = i < now ? 'past' : i === now ? 'now' : 'future';
        if (w.dataset.state !== state) w.dataset.state = state;
      });
      out.push({ cue, element: el, progress: Math.min(1, Math.max(0, (time - cue.startTime) / (cue.endTime - cue.startTime))), word: now, words: words.length });
    }
    return out;
  }

  track.addEventListener('cuechange', sync);
  sync();
  return {
    track, host, sync, update,
    get elements() { return [...shown.values()]; },
    get cues() { return [...shown.keys()]; },
    stop() { track.removeEventListener('cuechange', sync); show([]); },
  };
}
// #endregion layer
