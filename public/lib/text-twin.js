// TextTwin: a second copy of a subtree whose text has been translated,
// rewritten or summarised, kept in step with the original.
//
//   import { TextTwin, recorded, translator } from '/lib/text-twin.js';
//
//   const twin = new TextTwin(article, copy);          // copy is an empty element
//   await twin.convert(await translator({ source: 'en', target: 'fr' }));
//   twin.blocks  // [{ src, dst, state }], one per heading, paragraph, list item, button
//
// Both elements are children of one <canvas content="drawable">. The canvas
// draws the original everywhere and the copy inside a lens, so the page needs
// to know, for every block of the original, where the same block is in the
// copy. `blocks` pairs them up.
//
// A provider turns one string into another:
//
//   { key, unit: 'node' | 'block', label, convert(text, block) => string | null }
//
// unit 'node' converts each text node on its own, which keeps links, bold and
// other inline elements in place. unit 'block' converts a block's whole text
// and replaces the block's content with the plain result. Results are cached
// per provider key and text.

const BLOCKS = 'h1,h2,h3,h4,p,li,button,figcaption,summary,dt,dd';

export class TextTwin extends EventTarget {
  /** [{ src, dst, state }]; state is 'same' | 'pending' | 'done' | 'missing' | 'error'. */
  blocks = [];
  provider = null;
  /** True marks every block of the copy `drawable`, so the canvas can draw blocks one by one. */
  #own = false;
  #cache = new Map();
  #run = 0;
  #observer = null;
  #queued = false;

  constructor(source, twin, { blocks = BLOCKS } = {}) {
    super();
    this.source = source;
    this.twin = twin;
    this.selector = blocks;
    twin.inert = true;
    twin.setAttribute('aria-hidden', 'true');
    this.rebuild();
    // #region follow
    // The original is live: when its text or structure changes, copy it again
    // and convert the new text.
    this.#observer = new MutationObserver(() => {
      if (this.#queued) return;
      this.#queued = true;
      requestAnimationFrame(() => {
        this.#queued = false;
        this.rebuild();
        if (this.provider) this.convert(this.provider);
      });
    });
    this.#observer.observe(source, { subtree: true, childList: true, characterData: true });
    // #endregion follow
  }

  // #region clone
  /** Copy the original's children into the twin and pair up the blocks. */
  rebuild() {
    this.#run++;
    this.twin.replaceChildren(...[...this.source.childNodes].map((n) => n.cloneNode(true)));
    // The copy must not answer to the original's ids, labels or editing.
    for (const el of this.twin.querySelectorAll('[id],[for],[contenteditable]')) {
      el.removeAttribute('id');
      el.removeAttribute('for');
      el.removeAttribute('contenteditable');
    }
    const src = [...this.source.querySelectorAll(this.selector)];
    const dst = [...this.twin.querySelectorAll(this.selector)];
    this.blocks = src.map((el, i) => ({ src: el, dst: dst[i], state: 'same', at: 0 }));
    for (const b of this.blocks) b.dst?.toggleAttribute('drawable', this.#own);
    this.#changed();
  }
  // #endregion clone

  // #region own
  // A descendant with the drawable attribute can be passed to
  // drawElementImage() on its own. It is then left out of its ancestor's
  // picture, so a copy is drawn either whole or block by block, not both.
  get ownBlocks() {
    return this.#own;
  }
  set ownBlocks(on) {
    this.#own = !!on;
    for (const b of this.blocks) b.dst?.toggleAttribute('drawable', this.#own);
    this.#changed();
  }
  // #endregion own

  // #region convert
  /** Run every block of the copy through a provider. Pass null to show the original text. */
  async convert(provider) {
    const run = ++this.#run;
    this.provider = provider;
    if (!provider) return this.rebuild();
    for (const b of this.blocks) b.state = 'pending';
    this.#changed();
    await Promise.all(this.blocks.map(async (b) => {
      try {
        const ok = provider.unit === 'block' ? await this.#block(b, provider, run) : await this.#nodes(b, provider, run);
        if (run !== this.#run) return;
        b.state = ok ? 'done' : 'missing';
      } catch (err) {
        if (run !== this.#run) return;
        b.state = 'error';
        b.error = err.message;
      }
      b.at = performance.now();
      this.#changed();
    }));
  }

  // One text node at a time. Leading and trailing spaces stay where they were,
  // because they separate the node from its inline neighbours.
  async #nodes(b, provider, run) {
    const from = textNodes(b.src), to = textNodes(b.dst);
    let all = true;
    await Promise.all(from.map(async (node, i) => {
      const [, lead, body, tail] = node.data.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!body || !to[i]) return;
      const out = await this.#cached(provider, body, b);
      if (run !== this.#run) return;
      if (out == null) all = false;
      else to[i].data = lead + out + tail;
    }));
    return all;
  }

  // The whole block as one string. The result is plain text, so inline
  // elements in the block are lost.
  async #block(b, provider, run) {
    const text = b.src.textContent.replace(/\s+/g, ' ').trim();
    if (!text) return true;
    const out = await this.#cached(provider, text, b);
    if (run !== this.#run) return false;
    if (out == null) return false;
    b.dst.textContent = out;
    return true;
  }

  #cached(provider, text, b) {
    const key = provider.key + '\n' + text;
    if (!this.#cache.has(key)) {
      const p = Promise.resolve(provider.convert(text, b.src));
      this.#cache.set(key, p);
      p.catch(() => this.#cache.delete(key));
    }
    return this.#cache.get(key);
  }
  // #endregion convert

  #changed() {
    this.dispatchEvent(new Event('change'));
  }

  disconnect() {
    this.#observer?.disconnect();
  }
}

function textNodes(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) out.push(walk.currentNode);
  return out;
}

// ---------------------------------------------------------------------------
// Providers

const NAMES = ['Translator', 'LanguageDetector', 'Summarizer', 'Rewriter', 'LanguageModel'];

/**
 * What the browser says about each built-in AI interface:
 * 'missing' (no such global), 'unavailable', 'downloadable', 'downloading',
 * 'available', 'error: …', or 'no answer' when availability() has not settled
 * after 3 seconds (Translator did that in headless Chromium 157).
 * `options` holds the availability() arguments by name.
 */
export async function builtInAI(options = {}) {
  const out = {};
  await Promise.all(NAMES.map(async (name) => {
    const api = globalThis[name];
    if (!api) return (out[name] = 'missing');
    try {
      out[name] = await Promise.race([api.availability(options[name]), new Promise((r) => setTimeout(r, 3000, 'no answer'))]);
    } catch (err) {
      out[name] = 'error: ' + err.message;
    }
  }));
  return out;
}

const progress = (onprogress) => (m) => m.addEventListener('downloadprogress', (e) => onprogress?.(e.loaded));

// #region translator
/**
 * A provider that translates with the Translator API. Creating one may start a
 * model download, which needs a tap first. The source language comes from
 * LanguageDetector when there is one, else from `source`.
 */
export async function translator({ source = 'en', target, sample = '', onprogress } = {}) {
  if (!('Translator' in globalThis)) throw new Error('Translator is missing');
  let detected = '';
  if ('LanguageDetector' in globalThis && sample) {
    try {
      const detector = await LanguageDetector.create();
      const [best] = await detector.detect(sample);
      if (best?.detectedLanguage && best.detectedLanguage !== 'und') {
        source = best.detectedLanguage;
        detected = `${best.detectedLanguage} (${Math.round(best.confidence * 100)}%)`;
      }
    } catch {}
  }
  const model = await Translator.create({ sourceLanguage: source, targetLanguage: target, monitor: progress(onprogress) });
  return {
    key: `translator:${source}:${target}`,
    unit: 'node',
    label: `${source} to ${target}, Translator API`,
    source, target, detected,
    convert: (text) => model.translate(text),
  };
}
// #endregion translator

// #region rewrite
/** Simpler words for each block, with the Rewriter API. */
export async function rewriter({ onprogress } = {}) {
  if (!('Rewriter' in globalThis)) throw new Error('Rewriter is missing');
  const model = await Rewriter.create({ tone: 'more-casual', length: 'shorter', format: 'plain-text', sharedContext: 'Rewrite for a reader with a small vocabulary. Keep every number.', monitor: progress(onprogress) });
  return { key: 'rewriter', unit: 'block', label: 'simpler words, Rewriter API', convert: (text) => (text.split(' ').length < 4 ? text : model.rewrite(text)) };
}

/** One short sentence for each block, with the Summarizer API. */
export async function summarizer({ onprogress } = {}) {
  if (!('Summarizer' in globalThis)) throw new Error('Summarizer is missing');
  const model = await Summarizer.create({ type: 'tldr', length: 'short', format: 'plain-text', monitor: progress(onprogress) });
  return { key: 'summarizer', unit: 'block', label: 'summary, Summarizer API', convert: (text) => (text.split(' ').length < 8 ? text : model.summarize(text)) };
}
// #endregion rewrite

// #region recorded
/**
 * A provider that looks text up in a table made in advance. It is what the
 * page uses when the browser has no model. Digits are taken out before the
 * lookup and put back after it, so "High water: 06:12" and "High water: 18:40"
 * share one entry. Text that is not in the table gives null, and the block is
 * marked as missing.
 */
export function recorded(table, column, { unit = 'node', label = column } = {}) {
  const NUM = /\d+(?:[:.]\d+)*/g;
  return {
    key: `recorded:${column}`,
    unit,
    label: `${label}, recorded in advance`,
    recorded: true,
    convert(text) {
      const numbers = text.match(NUM) ?? [];
      const row = table[text.replace(NUM, '#')];
      const out = row?.[column];
      if (out == null) return null;
      let i = 0;
      return out.replace(/#/g, () => numbers[i++] ?? '');
    },
  };
}
// #endregion recorded
