// Speech for a panel of controls: press a control by saying its name.
//
//   const panel = voicePanel(element);          // any element holding buttons
//   panel.labels()                              // names of the controls shown now
//   panel.feed(['desk', 'lamp'], { source })    // words in, presses out
//   const session = await listen(panel, { onstate });   // SpeechRecognition
//   session.stop();
//
// feed() is the one way in. Recognition results, the typed box and the sample
// sentence all go through it, so the page behaves the same without a microphone.

export const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

/** The accessible name of a control: aria-label, else its text. */
export const nameOf = (el) => (el.getAttribute('aria-label') || el.textContent).trim().replace(/\s+/g, ' ');
const norm = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// One pair of highlights for the page. Each panel adds ranges over its own transcript.
const spoken = globalThis.Highlight ? new Highlight() : null;
const heard = globalThis.Highlight ? new Highlight() : null;
if (spoken) {
  CSS.highlights.set('voice-spoken', spoken);
  CSS.highlights.set('voice-heard', heard);
}

/**
 * What this browser's speech recognition can do. Never throws.
 * available() is only called when `ask` is true: in headless Chromium 157 the
 * call crashes the tab, so the page waits for a tap before making it.
 */
export async function speechState(lang = 'en-US', { ask = false } = {}) {
  const out = { api: !!Recognition, onDevice: 'missing', phrases: false, timestamps: false };
  if (!Recognition) return out;
  out.phrases = 'phrases' in Recognition.prototype && 'SpeechRecognitionPhrase' in globalThis;
  out.timestamps = 'SpeechRecognitionResult' in globalThis && 'speechStartTime' in SpeechRecognitionResult.prototype;
  if (typeof Recognition.available !== 'function') out.onDevice = 'no available() method';
  else if (!ask) out.onDevice = 'not asked yet';
  else {
    try {
      out.onDevice = await Promise.race([Recognition.available({ langs: [lang], processLocally: true }), new Promise((r) => setTimeout(r, 3000, 'no answer'))]);
    } catch (err) {
      out.onDevice = 'error: ' + err.message;
    }
  }
  return out;
}

export function voicePanel(root, { transcript = root.querySelector('[data-transcript]'), onpress = () => {} } = {}) {
  const words = []; // { text, at, hit }
  let text = null;
  let cursor = null; // range of the newest word
  const marks = new Set();

  // #region labels
  // The controls that are drawn now: buttons that are not hidden. Their names
  // are the phrases given to speech recognition and the words feed() looks for.
  const controls = () => [...root.querySelectorAll('button')].filter((b) => !b.closest('[hidden]') && !b.disabled);
  const labels = () => controls().map(nameOf);
  // #endregion labels

  // #region match
  /**
   * Take new words. When the last words spoken spell the name of a control
   * that is drawn now, click it. Longer names are tried first, so "desk lamp"
   * is not taken for "lamp".
   */
  function feed(list, { source = 'typed', at = performance.now() } = {}) {
    const pressed = [];
    for (const raw of list) {
      const word = { text: raw, key: norm(raw), at, hit: false };
      if (!word.key) continue;
      words.push(word);
      const named = controls().map((el) => ({ el, keys: nameOf(el).split(' ').map(norm) })).sort((a, b) => b.keys.length - a.keys.length);
      for (const { el, keys } of named) {
        const tail = words.slice(-keys.length);
        if (tail.length < keys.length || tail.some((w, i) => w.key !== keys[i] && w.key !== keys[i] + 's')) continue;
        if (tail.some((w) => w.hit)) continue;
        for (const w of tail) w.hit = true;
        press(el, source);
        pressed.push(nameOf(el));
        break;
      }
    }
    show();
    return pressed;
  }

  function press(el, source) {
    el.click();
    // Centre of the control inside the panel, from layout.
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let n = el; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    root.closest('fx-surface')?.poke?.(x, y);
    onpress(el, { x, y, source });
  }
  // #endregion match

  // #region transcript
  // The transcript is one text node inside the panel, so the canvas draws it.
  // Custom highlights mark the newest word and the words that pressed a
  // control. Highlights are painted into the element's picture.
  function show() {
    if (!transcript) return;
    const shown = words.slice(-14);
    transcript.textContent = shown.map((w) => w.text).join(' ') || ' ';
    text = transcript.firstChild;
    for (const r of marks) { spoken?.delete(r); heard?.delete(r); }
    marks.clear();
    if (!spoken || !shown.length) return;
    let offset = 0;
    shown.forEach((w, i) => {
      const r = new Range();
      r.setStart(text, offset);
      r.setEnd(text, offset + w.text.length);
      offset += w.text.length + 1;
      if (w.hit) { heard.add(r); marks.add(r); }
      if (i === shown.length - 1) { spoken.add(r); marks.add(r); cursor = r; }
    });
  }
  /** Highlight each word again at the time it arrived. Resolves when done. */
  async function replay() {
    const shown = words.slice(-14);
    if (!spoken || !shown.length || !text) return 0;
    if (cursor) spoken.delete(cursor);
    let offset = 0;
    const t0 = shown[0].at;
    for (const w of shown) {
      const r = new Range();
      r.setStart(text, offset);
      r.setEnd(text, offset + w.text.length);
      offset += w.text.length + 1;
      await new Promise((done) => setTimeout(done, Math.min(900, Math.max(0, w.at - t0 - (performance.now() - start)))));
      if (cursor) { spoken.delete(cursor); marks.delete(cursor); }
      spoken.add(r);
      marks.add(r);
      cursor = r;
    }
    return shown.length;
  }
  let start = 0;
  // #endregion transcript

  return {
    root, controls, labels, feed, words,
    replay: () => { start = performance.now(); return replay(); },
    clear: () => { words.length = 0; show(); },
    /** Give the newest words the times a final result reports (seconds from the start of the audio). */
    retime(count, t0, t1) {
      const slice = words.slice(-count);
      slice.forEach((w, i) => (w.at = (t0 + ((t1 - t0) * (i + 0.5)) / slice.length) * 1000));
    },
  };
}

// #region listen
/**
 * Start speech recognition and feed its words to a panel.
 * On-device recognition is used when the browser says it is available; the
 * names of the controls then go in as phrases, which bias the recogniser
 * towards them. The phrase list is rebuilt whenever the controls change.
 */
export async function listen(panel, { lang = 'en-US', onstate = () => {} } = {}) {
  if (!Recognition) throw new Error('SpeechRecognition is missing');
  const state = await speechState(lang, { ask: true });
  const rec = new Recognition();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  const local = state.onDevice === 'available';
  if (local) rec.processLocally = true;
  let phrases = [];
  const bias = () => {
    if (!local || !state.phrases) return;
    phrases = panel.labels();
    try { rec.phrases = phrases.map((p) => new SpeechRecognitionPhrase(p, 6)); } catch (err) { onstate({ note: `phrases were refused: ${err.message}` }); }
  };
  bias();

  // Words already taken from each result, so an interim result is not fed twice.
  const taken = [];
  let stopped = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const all = result[0].transcript.trim().split(/\s+/).filter(Boolean);
      const fresh = all.slice(taken[i] ?? 0);
      taken[i] = all.length;
      if (fresh.length) {
        const pressed = panel.feed(fresh, { source: local ? 'on-device recognition' : 'recognition service' });
        if (pressed.length) bias(); // a press may have changed which controls are shown
      }
      // Chrome 159: a final result says when its speech started and ended.
      if (result.isFinal && typeof result.speechStartTime === 'number') {
        panel.retime(all.length, result.speechStartTime, result.speechEndTime);
        onstate({ timed: { start: result.speechStartTime, end: result.speechEndTime, words: all.length } });
      }
    }
    onstate({ heard: true });
  };
  rec.onerror = (e) => {
    // "no-speech" and "aborted" are a pause. The rest will not get better by starting again.
    if (!['no-speech', 'aborted'].includes(e.error)) stopped = true;
    onstate({ error: e.error + (e.message ? `: ${e.message}` : '') });
  };
  rec.onstart = () => onstate({ listening: true, local, phrases });
  // Recognition ends by itself after a pause. Start it again until stop() is called.
  rec.onend = () => {
    if (stopped) return onstate({ listening: false });
    taken.length = 0;
    try { rec.start(); } catch { onstate({ listening: false }); }
  };
  rec.start();
  onstate({ state });
  return { local, state, get phrases() { return phrases; }, stop() { stopped = true; rec.stop(); } };
}
// #endregion listen
