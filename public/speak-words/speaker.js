// Speak a text and report each word as it is spoken.
//
//   import { speaker, wordAt, estimateWords } from './speaker.js';
//
//   const s = speaker({ onword, onstate });
//   s.speak(text, { from: 0, voice, rate: 1 });
//   s.stop();
//
// onword({ index, length, source, elapsed }) gives the word's position in the
// text passed to speak(). `source` is "boundary" when the word came from a
// SpeechSynthesis boundary event and "estimate" when it came from a timer.
//
// Some voices fire no boundary events. If none has arrived 0.7 s after the
// `start` event, or the utterance fails, the words are stepped by a timer whose
// length per word is guessed from the number of letters and the rate.

/** The word that starts at or covers `index`: { index, length }. */
export function wordAt(text, index) {
  let start = Math.min(Math.max(0, index), text.length);
  while (start > 0 && /\S/.test(text[start - 1]) && /\S/.test(text[start] ?? '')) start--;
  while (start < text.length && /\s/.test(text[start])) start++;
  let end = start;
  while (end < text.length && /\S/.test(text[end])) end++;
  return { index: start, length: end - start };
}

/** Guessed start time in seconds of every word of `text` at `rate`: [{ index, length, at }]. */
export function estimateWords(text, rate = 1) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(/\S+/g)) {
    out.push({ index: m.index, length: m[0].length, at });
    at += (0.17 + 0.052 * m[0].replace(/[^\p{L}\p{N}]/gu, '').length + (/[.!?]$/.test(m[0]) ? 0.4 : /[,;:]$/.test(m[0]) ? 0.2 : 0)) / rate;
  }
  return out;
}

// #region speaker
export function speaker({ onword = () => {}, onstate = () => {}, synth = globalThis.speechSynthesis, silent = false } = {}) {
  const me = { utterance: null, stats: null, speak, stop, speaking: false };
  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };

  function estimate(text, from, rate, elapsed = 0) {
    // Step the words by a timer, starting from the one that would be spoken `elapsed` seconds in.
    me.stats.source = 'estimate';
    const words = estimateWords(text, rate);
    for (const w of words) {
      if (w.at + 0.05 < elapsed) continue;
      timers.push(setTimeout(() => onword({ index: from + w.index, length: w.length, source: 'estimate', elapsed: w.at }), (w.at - elapsed) * 1000));
    }
    const end = (words.at(-1)?.at ?? 0) + 0.6 - elapsed;
    timers.push(setTimeout(() => finish('end'), end * 1000));
  }

  function finish(state, detail = '') {
    if (!me.speaking) return;
    me.speaking = false;
    clear();
    me.stats.total = (performance.now() - me.stats.asked) / 1000;
    onstate(state, detail, me.stats);
  }

  function speak(text, { from = 0, voice = null, rate = 1, volume = 1 } = {}) {
    stop();
    const rest = text.slice(from);
    const u = new SpeechSynthesisUtterance(rest);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate;
    u.volume = volume;
    const stats = { asked: performance.now(), startAfter: null, boundaries: 0, withLength: 0, sentences: 0, source: 'boundary', error: '', total: 0 };
    me.utterance = u;
    me.stats = stats;
    me.speaking = true;

    u.addEventListener('start', () => {
      stats.startAfter = performance.now() - stats.asked;
      onstate('speaking', '', stats);
      // No boundary event soon after the start means this voice sends none.
      timers.push(setTimeout(() => { if (!stats.boundaries && me.utterance === u && me.speaking) estimate(rest, from, rate, 0.7); }, 700));
    });
    u.addEventListener('boundary', (e) => {
      if (me.utterance !== u) return;
      if (e.name === 'sentence') { stats.sentences++; return; }
      if (!stats.boundaries && stats.source === 'estimate') { clear(); stats.source = 'boundary'; }
      stats.boundaries++;
      // charLength is missing or 0 in some engines. Then the word is read from the text.
      const length = e.charLength > 0 ? (stats.withLength++, e.charLength) : wordAt(rest, e.charIndex).length;
      onword({ index: from + e.charIndex, length, source: 'boundary', elapsed: e.elapsedTime });
    });
    u.addEventListener('end', () => { if (me.utterance === u && stats.source === 'boundary') finish('end'); });
    u.addEventListener('error', (e) => {
      if (me.utterance !== u || e.error === 'interrupted' || e.error === 'canceled') return;
      stats.error = e.error;
      onstate('error', e.error, stats);
      // Show the words anyway, without sound.
      if (stats.source === 'boundary' && !stats.boundaries) estimate(rest, from, rate);
    });

    if (silent) return u; // for checks: events are dispatched on the utterance by hand
    if (!synth) { stats.error = 'no speechSynthesis'; onstate('error', stats.error, stats); estimate(rest, from, rate); return u; }
    synth.cancel();
    synth.speak(u);
    // Neither start nor error within 4 s: the engine is not answering.
    timers.push(setTimeout(() => { if (me.utterance === u && me.speaking && stats.startAfter === null && !stats.error) { stats.error = 'no start event in 4 s'; onstate('error', stats.error, stats); estimate(rest, from, rate); } }, 4000));
    return u;
  }

  function stop() {
    const was = me.speaking;
    me.utterance = null;
    clear();
    if (!silent) synth?.cancel();
    if (was) { me.speaking = false; onstate('stopped', '', me.stats); }
  }
  return me;
}
// #endregion speaker
