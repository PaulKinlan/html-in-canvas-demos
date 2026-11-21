// Put one HTML element inside a drawable canvas and measure what happens.
//
// Each element is measured twice:
//   inside  the element sits in a <div drawable> wrapper, and the wrapper is drawn
//   direct  the element itself is the canvas child with the `drawable` attribute
//
// Measurements are taken by looking only: nothing is clicked or focused, and the fixtures sit in
// a small fixed box in the corner of the viewport, so the page does not move while they run.

export const FIX_W = 300, FIX_H = 150, DX = 6, DY = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// Custom elements used by two of the entries.
if (!customElements.get('el-probe-custom')) {
  customElements.define('el-probe-custom', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-block;padding:4px;border:1px dashed #888}</style><button part="b">Shadow button</button> <slot>custom element</slot>';
    }
  });
  customElements.define('el-probe-builtin', class extends HTMLButtonElement {}, { extends: 'button' });
}

/**
 * Where fixtures go: a shadow root on a small fixed box in the corner of the viewport, all but invisible.
 * The shadow root keeps the page's stylesheet away from the test markup, so the numbers are the same on
 * any page. The box is on screen because an off-screen canvas has no paint record and no hit testing.
 */
export function stage() {
  let host = document.getElementById('el-probe-stage');
  if (!host) {
    host = document.createElement('div');
    host.id = 'el-probe-stage';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `all:initial;position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:${FIX_W}px;height:${FIX_H}px;overflow:hidden;background:#fff`;
    host.attachShadow({ mode: 'open' });
    document.body.append(host);
  }
  return host.shadowRoot;
}

// #region build
/** Build the test markup for an entry. Returns the node to put in the canvas and the element under test. */
export function build(entry, assets) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:max-content;max-width:${FIX_W - 2 * DX}px;font:14px/1.3 system-ui,sans-serif;color:#111`;
  if (entry.make) {
    const made = document.createElement(entry.make);
    made.textContent = entry.text;
    wrap.append(made);
  } else {
    wrap.innerHTML = entry.html.replace(/\{\{(\w+)\}\}/g, (_, key) => assets[key] ?? '');
  }
  const target = wrap.querySelector(entry.sel ?? entry.make ?? entry.tag);
  prepare(wrap);
  return { wrap, target };
}

// A plain inner canvas gets a picture, and a nested drawable canvas gets its own paint handler.
export function prepare(root) {
  for (const c of root.querySelectorAll('canvas[data-fill]')) {
    const g = c.getContext('2d');
    g.fillStyle = '#7b2cbf'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.font = '700 14px system-ui'; g.fillText('2D canvas', 10, 36);
  }
  for (const c of root.querySelectorAll('canvas[data-nested]')) {
    const g = c.getContext('2d');
    c.onpaint = () => {
      g.reset(); g.fillStyle = '#ffe8a3'; g.fillRect(0, 0, c.width, c.height);
      try { g.drawElementImage(c.firstElementChild, 6, 14); } catch (err) { c.dataset.error = err.message; }
    };
  }
}
// #endregion build

function loaded(root) {
  const waits = [];
  const sel = 'img, iframe, embed, object, video, audio, input[type=image]';
  for (const el of [...(root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)]) {
    if (el.localName === 'img' && el.complete) continue;
    const ev = el.localName === 'video' || el.localName === 'audio' ? 'loadeddata' : 'load';
    waits.push(new Promise((resolve) => { el.addEventListener(ev, resolve, { once: true }); el.addEventListener('error', resolve, { once: true }); }));
  }
  return Promise.race([Promise.all(waits), sleep(1500)]);
}

/** Remove a fixture. Media elements keep playing after removal unless they are stopped, and Chromium limits how many can play. */
export function discard(root) {
  for (const m of [...(root.matches('video, audio') ? [root] : []), ...root.querySelectorAll('video, audio')]) { m.pause(); m.removeAttribute('src'); m.load(); }
  root.remove();
}

// #region measure
/**
 * Put `node` in a new drawable canvas, draw it at (DX, DY) and measure `target` (node or a descendant).
 * Returns { error, box, ink, hit, selfPaints, canvas }.
 */
export async function measure(node, target, { idle = 350, keep = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = FIX_W; canvas.height = FIX_H;
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${FIX_W}px;height:${FIX_H}px;font:14px/1.3 system-ui,sans-serif;color:#111`;
  node.setAttribute('drawable', '');
  canvas.append(node);
  const ctx = canvas.getContext('2d');
  const out = { error: null, box: null, ink: 0, hit: null, selfPaints: 0 };
  let paints = 0;
  const draw = () => {
    ctx.reset();
    try { ctx.drawElementImage(node, DX, DY); out.error = null; } catch (err) { out.error = err.message; }
  };
  canvas.addEventListener('paint', () => { paints++; draw(); });
  stage().append(canvas);
  await loaded(node);

  // First picture: ask for a paint, and give elements that are not ready (no paint record yet) a few tries.
  for (let i = 0; i < 6; i++) {
    canvas.requestPaint?.();
    await frame(); await frame();
    if (paints && !out.error) break;
    if (!paints) draw();
    if (!out.error) break;
    await sleep(60);
  }

  if (target) {
    const a = node.getBoundingClientRect(), b = target.getBoundingClientRect();
    const box = { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
    out.box = [Math.round(box.w), Math.round(box.h)];
    out.display = getComputedStyle(target).display;

    // Ink: the share of the element's box that has any drawn pixel.
    if (!out.error && box.w >= 1 && box.h >= 1) {
      const x = Math.max(0, Math.floor(DX + box.x)), y = Math.max(0, Math.floor(DY + box.y));
      const w = Math.min(FIX_W - x, Math.ceil(box.w)), h = Math.min(FIX_H - y, Math.ceil(box.h));
      if (w > 0 && h > 0) {
        try {
          const d = ctx.getImageData(x, y, w, h).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
          out.ink = +(n / (w * h)).toFixed(3);
        } catch (err) { out.readback = err.message; }
      }
    }

    // Hit test: which element does the browser report at the centre of where the element was drawn?
    if (!out.error && box.w >= 1 && box.h >= 1) {
      await frame();
      const c = canvas.getBoundingClientRect();
      const px = c.left + DX + box.x + box.w / 2, py = c.top + DY + box.y + box.h / 2;
      const mine = canvas.getRootNode().elementsFromPoint(px, py).find((el) => el === canvas || canvas.contains(el));
      out.hit = !mine || mine === canvas ? 'canvas' : mine === target ? 'self' : target.contains(mine) ? 'descendant' : mine.contains(target) ? `ancestor <${mine.localName}>` : `<${mine.localName}>`;
    }
  }

  // Does the element make the canvas repaint when nothing touches it (animation, video frames, caret)?
  const before = paints;
  await sleep(idle);
  out.selfPaints = paints - before;

  if (keep) out.canvas = canvas; else discard(canvas);
  return out;
}
// #endregion measure

// #region probe
/** Measure one catalogue entry both ways. */
export async function probe(entry, assets, opts) {
  if (entry.needsOther && !assets.other) return { skipped: 'needs the second origin, which this host does not have' };
  const result = {};
  {
    const { wrap, target } = build(entry, assets);
    if (!target) return { skipped: 'the parser did not create the element' };
    result.unknown = target instanceof HTMLUnknownElement;
    result.inside = await measure(wrap, target, opts);
    // No box (display: none or contents)? Try again with a display value forced on.
    if (!result.inside.error && result.inside.box[0] * result.inside.box[1] === 0) {
      const again = build(entry, assets);
      again.target.style.display = 'block';
      result.forced = await measure(again.wrap, again.target, opts);
    }
  }
  {
    const { target } = build(entry, assets);
    target.remove();
    result.direct = await measure(target, target, opts);
  }
  return result;
}

/** Measure a list of entries, a few at a time. `each(entry, result)` is called as results land. */
export async function probeAll(entries, assets, each = () => {}, { jobs = 6, ...opts } = {}) {
  const results = {};
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      try { results[entry.tag] = await probe(entry, assets, opts); } catch (err) { results[entry.tag] = { crashed: err.message }; }
      each(entry, results[entry.tag]);
    }
  }));
  return results;
}
// #endregion probe
