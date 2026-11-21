// Live captions: words in, a caption element and WebVTT out.
//
//   import { captionBox, listen, replayCues, translatorFor, toVtt, Recognition } from './captions.js';
//
//   const box = captionBox(element);                       // element holds .heard and .translated
//   box.feed({ text: 'the page reads', final: false });    // an interim result
//   box.feed({ text: 'The page reads the cues.', final: true });
//
// feed() is the one way in. SpeechRecognition results, the recorded transcript
// and the checks all go through it, so the page behaves the same in a browser
// with no recognition service.

export const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// #region box
/**
 * Show interim and final text in `root`. Words are <span> elements. When an
 * interim result changes, only the words that differ are replaced, so a word
 * the recogniser has revised is a new element and runs its CSS animation again.
 * options.ontext({ text, final }) is called after each change.
 */
export function captionBox(root, { ontext = () => {}, clock = () => performance.now() / 1000 } = {}) {
  const heard = root.querySelector('.heard'), translated = root.querySelector('.translated');
  const log = []; // finished captions: { start, end, text, translation }
  let started = null; // time the current utterance began
  let shown = []; // the words on screen

  function show(text, final) {
    const words = text.split(/\s+/).filter(Boolean);
    words.forEach((word, i) => {
      let span = heard.children[i];
      if (!span || shown[i] !== word) {
        const fresh = document.createElement('span');
        fresh.textContent = word;
        if (span && shown[i] !== undefined) fresh.className = 'revised';
        if (span) span.replaceWith(fresh); else heard.append(fresh);
        span = fresh;
      }
      // A text node with a space after each word, so the line wraps.
      if (!span.nextSibling || span.nextSibling.nodeType !== Node.TEXT_NODE) span.after(' ');
    });
    while (heard.children.length > words.length) { heard.lastElementChild.nextSibling?.remove(); heard.lastElementChild.remove(); }
    shown = words;
    heard.dataset.state = final ? 'final' : 'interim';
  }

  function feed({ text, final = false, at = clock() }) {
    text = text.trim();
    if (!text) return;
    // A new caption starts with no words. The last translation stays until a new one replaces it.
    if (started === null) { started = at; heard.replaceChildren(); shown = []; }
    show(text, final);
    const entry = final ? { start: started, end: Math.max(at, started + 0.2), text, translation: '' } : null;
    if (entry) { log.push(entry); started = null; }
    ontext({ text, final, entry });
    return entry;
  }

  /** Put a translation under the caption. `entry` is the log entry it belongs to, when the caption is final. */
  function translate(text, { final = false, entry = null } = {}) {
    translated.textContent = text;
    translated.dataset.state = final ? 'final' : 'interim';
    if (entry) entry.translation = text;
  }

  function clear() {
    heard.replaceChildren();
    translated.textContent = '';
    shown = [];
    started = null;
  }
  return { feed, translate, clear, log, get words() { return shown.slice(); } };
}
// #endregion box

// #region vtt
const stamp = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}`;
/** The finished captions as a WebVTT file. `field` is "text" or "translation". */
export function toVtt(log, field = 'text') {
  const cues = log.filter((e) => e[field]).map((e, i) => `${i + 1}\n${stamp(e.start)} --> ${stamp(e.end)}\n${e[field].replace(/-->/g, '→').replace(/\n+/g, ' ')}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
// #endregion vtt

// #region listen
/**
 * Run SpeechRecognition and pass its results to `feed`.
 *   track    a MediaStreamTrack to recognise instead of the microphone (for example a video's sound)
 *   local    set processLocally, so the audio stays on the device
 *   onevent  called with (name, detail) for every recognition event, for an on-page log
 * Returns { stop() }. Recognition is started again when it ends by itself.
 */
export function listen({ feed, lang = 'en-US', track = null, local = false, onevent = () => {}, clock } = {}) {
  if (!Recognition) throw new Error('SpeechRecognition is missing');
  let active = true, r = null, restarts = 0;
  function start() {
    r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    if (local && 'processLocally' in r) r.processLocally = true;
    for (const name of ['start', 'audiostart', 'speechstart', 'speechend', 'audioend', 'nomatch']) r.addEventListener(name, () => onevent(name, ''));
    r.onerror = (e) => { onevent('error', e.error + (e.message ? `: ${e.message}` : '')); if (['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture'].includes(e.error)) active = false; };
    r.onresult = (e) => {
      // Results before resultIndex have not changed. Final ones are complete sentences. The rest together are the interim text.
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) { feed({ text: result[0].transcript, final: true, at: clock?.() }); onevent('result', `final, confidence ${result[0].confidence.toFixed(2)}`); }
        else interim += result[0].transcript;
      }
      if (interim.trim()) { feed({ text: interim, final: false, at: clock?.() }); onevent('result', 'interim'); }
    };
    r.onend = () => {
      onevent('end', active ? 'starting again' : '');
      if (active && restarts++ < 20 && (!track || track.readyState === 'live')) setTimeout(() => { if (active) { try { start(); } catch (err) { onevent('error', err.message); } } }, 250);
    };
    // start(track) recognises that track. With no argument the browser opens the microphone.
    if (track) r.start(track); else r.start();
  }
  start();
  return { stop() { active = false; try { r.stop(); } catch { /* not started */ } } };
}
// #endregion listen

// #region replay
/**
 * Feed the cues of a text track as if they were being recognised: each word as an interim
 * result at its time stamp, and the whole sentence as a final result at the end of the cue.
 * Call the returned function with the media time, once per frame.
 */
export function replayCues(track, feed) {
  const plain = (cue) => {
    // "<v Ada>This <00:00:00.649>clip" → [{ t: start, word: 'This' }, { t: 0.649, word: 'clip' }]
    const out = [];
    let t = cue.startTime;
    for (const part of cue.text.replace(/<\/?[a-z][^>]*>/gi, '').split(/(<[\d:.]+>)/)) {
      const m = /^<(?:(\d+):)?(\d+):([\d.]+)>$/.exec(part);
      if (m) t = (Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3]);
      else for (const word of part.split(/\s+/).filter(Boolean)) out.push({ t, word });
    }
    return out;
  };
  const done = new Map(); // cue → number of words fed, or Infinity once final
  let last = -1;
  return (time) => {
    if (time < last - 0.5) done.clear(); // the video looped or was moved back
    last = time;
    for (const cue of track.cues ?? []) {
      if (time < cue.startTime || done.get(cue) === Infinity) continue;
      const words = plain(cue);
      // The spoken part of the cue ends about 0.4 s before the cue does.
      if (time >= cue.endTime - 0.4) {
        // Only a sentence that was being shown is finished. One the video jumped past is left out.
        if (done.has(cue)) feed({ text: words.map((w) => w.word).join(' '), final: true, at: Math.min(time, cue.endTime) });
        done.set(cue, Infinity);
        continue;
      }
      const n = words.filter((w) => w.t <= time).length;
      if (n && n !== done.get(cue)) { done.set(cue, n); feed({ text: words.slice(0, n).map((w) => w.word).join(' '), final: false, at: time }); }
    }
  };
}
// #endregion replay

// Translations of the six sentences of /media/talk.webm, written by a language model for this
// page and not checked by a speaker. Used only when the Translator API cannot be used.
export const RECORDED = {
  es: ['Este clip fue creado por un sintetizador de voz.', 'Cada frase es una entrada de una pista de texto.', 'La página lee las entradas activas y construye los subtítulos como elementos.', 'Un canvas los dibuja aparte del fotograma del vídeo.', 'Toca una palabra para llevar el vídeo hasta ella.', 'El clip vuelve a empezar después de esta frase.'],
  fr: ['Ce clip a été créé par un synthétiseur vocal.', 'Chaque phrase est une réplique dans une piste de texte.', 'La page lit les répliques actives et construit les sous-titres sous forme d’éléments.', 'Un canvas les dessine à l’écart de l’image vidéo.', 'Touchez un mot pour déplacer la vidéo jusqu’à lui.', 'Le clip recommence après cette phrase.'],
  de: ['Dieser Clip wurde von einem Sprachsynthesizer erzeugt.', 'Jeder Satz ist ein Eintrag in einer Textspur.', 'Die Seite liest die aktiven Einträge und baut die Untertitel als Elemente auf.', 'Ein Canvas zeichnet sie getrennt vom Videobild.', 'Tippe auf ein Wort, um das Video dorthin zu bewegen.', 'Der Clip beginnt nach diesem Satz von vorn.'],
  ja: ['このクリップは音声合成で作られました。', '一つの文がテキストトラックの一つのキューです。', 'ページはアクティブなキューを読み取り、字幕を要素として組み立てます。', 'キャンバスは字幕を映像フレームとは別に描画します。', '単語をタップすると、動画がその位置に移動します。', 'この文のあと、クリップは最初から再生されます。'],
};
const SOURCE = ['This clip was made by a speech synthesizer.', 'Each sentence is one cue in a text track.', 'The page reads the active cues and builds the captions as elements.', 'A canvas draws them apart from the video frame.', 'Tap a word to move the video to it.', 'The clip starts again after this sentence.'];
const key = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

// #region translate
/** What Translator says about a language pair, without hanging: availability() never settled in headless Chromium 157. */
export async function translatorState(target, source = 'en') {
  if (!('Translator' in globalThis)) return 'missing';
  try {
    return await Promise.race([Translator.availability({ sourceLanguage: source, targetLanguage: target }), new Promise((r) => setTimeout(r, 3000, 'no answer'))]);
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/**
 * A translator for captions. Uses the Translator API when the pair can be used, which may start a
 * model download (allowed only after a tap). Otherwise falls back to the recorded sentences.
 * Returns { kind: 'Translator' | 'recorded', translate(text, { final }) → Promise<string>, lastMs }.
 */
export async function translatorFor(target, { source = 'en', onprogress = () => {}, allowDownload = true } = {}) {
  const state = await translatorState(target, source);
  if (state === 'available' || ((state === 'downloadable' || state === 'downloading') && allowDownload)) {
    const model = await Translator.create({ sourceLanguage: source, targetLanguage: target, monitor: (m) => m.addEventListener('downloadprogress', (e) => onprogress(e.loaded)) });
    const me = {
      kind: 'Translator', state, lastMs: 0,
      async translate(text) { const t0 = performance.now(); const out = await model.translate(text); me.lastMs = performance.now() - t0; return out; },
      close() { model.destroy?.(); },
    };
    return me;
  }
  return {
    kind: 'recorded', state, lastMs: 0,
    // Only whole sentences of the clip are known, so interim text gets no translation.
    async translate(text, { final = false } = {}) { const i = SOURCE.map(key).indexOf(key(text)); return final && i >= 0 ? RECORDED[target]?.[i] ?? '' : ''; },
    close() {},
  };
}

/** Run translations one at a time and drop requests that were overtaken, so an old interim result never replaces a newer one. */
export function latestOnly(run) {
  const finals = [];
  let interim = null, busy = false;
  async function pump() {
    busy = true;
    for (let job; (job = finals.shift() ?? interim); ) {
      if (job === interim) interim = null;
      try { await run(job); } catch { /* reported by run */ }
    }
    busy = false;
  }
  // Every final caption is translated. Of the interim ones, only the newest waits.
  return (job) => { if (job.final) { finals.push(job); interim = null; } else interim = job; if (!busy) pump(); };
}
// #endregion translate
