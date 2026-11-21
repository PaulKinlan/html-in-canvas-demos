// What a canvas may not see: content the browser protects, placed in a
// <canvas content="drawable"> and measured three ways.
//
//   drawn   are its pixels in the picture that drawElementImage() makes?
//   read    can script get those pixels back with getImageData()?
//   works   does it still do its job when it is a canvas child?
//
// Each value is 'yes', 'no', 'n/a', 'person' (someone has to try it) or
// 'unsupported' (this browser does not have the feature). `detail` is one or
// two sentences with the numbers.

import { otherOrigin } from '/lib/live-origins.js';

const W = 300, H = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A second origin that serves this site: the other local port, or the second deployment. */
export const OTHER = otherOrigin() ?? 'https://html-in-canvas-remote.kinlan-test.workers.dev';

// #region fixture
// One 300 x 200 canvas with one drawable child that fills it. draw() paints the
// child with a transform and resolves when the paint event has run.
function fixture(rig, html) {
  rig.innerHTML =
    `<canvas content="drawable" layoutsubtree width="${W}" height="${H}" style="width:${W}px;height:${H}px;display:block">` +
    `<div drawable style="position:relative;width:${W}px;height:${H}px;overflow:hidden">${html}</div></canvas>`;
  const canvas = rig.firstElementChild;
  const el = canvas.firstElementChild;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let paints = 0, place = { dx: 0, dy: 0, rotate: 0 };
  canvas.addEventListener('paint', () => {
    paints++;
    ctx.reset();
    ctx.translate(place.dx, place.dy);
    ctx.rotate(place.rotate);
    // The returned matrix puts the element's hit-test box where it was drawn.
    const m = ctx.drawElementImage(el, 0, 0, W, H);
    el.style.transform = m && !m.isIdentity ? m.toString() : '';
  });
  const draw = async (dx = 0, dy = 0, rotate = 0) => {
    place = { dx, dy, rotate };
    const before = paints;
    canvas.requestPaint();
    for (let i = 0; i < 60 && paints === before; i++) await sleep(16);
    await sleep(40);
  };
  // Pixels of the whole picture, or an error name when the canvas refuses.
  const pixels = () => {
    try { return { data: ctx.getImageData(0, 0, W, H).data }; } catch (err) { return { error: err.name }; }
  };
  // Count the pixels inside one child's box that are not transparent.
  const ink = (child = el, test = (r, g, b, a) => a > 0) => {
    const p = pixels();
    if (p.error) return { error: p.error, n: 0 };
    const c = canvas.getBoundingClientRect(), b = child.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor(b.left - c.left)), y0 = Math.max(0, Math.floor(b.top - c.top));
    const x1 = Math.min(W, Math.ceil(b.right - c.left)), y1 = Math.min(H, Math.ceil(b.bottom - c.top));
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (test(p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3])) n++;
    }
    return { n, area: Math.max(0, x1 - x0) * Math.max(0, y1 - y0) };
  };
  const client = (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + x, r.top + y]; };
  return { canvas, el, ctx, draw, pixels, ink, client };
}
// #endregion fixture

const loaded = (node, ms = 4000) => new Promise((res) => {
  const done = () => res();
  for (const ev of ['load', 'error', 'loadeddata']) node.addEventListener(ev, done, { once: true });
  setTimeout(done, ms);
});
const isRed = (r, g, b, a) => a > 200 && r > 200 && g < 70 && b < 70;
const isBlue = (r, g, b, a) => a > 200 && b > 200 && r < 70 && g < 70;
const yesNo = (v) => (v ? 'yes' : 'no');

// #region permission
// A permission element (<geolocation>, <camera> …) checks that nothing covers or
// distorts it before it accepts a click. Draw it in a canvas at three places and
// ask it. Then put the same element over a canvas, outside it, for comparison.
function permissionCase(name, features) {
  return {
    id: name, group: 'Permission elements', title: `<${name}> as a canvas child`, features,
    async run(rig, auto) {
      const f = fixture(rig, `<${name} style="display:inline-block;margin:12px"></${name}>`);
      const e = f.el.firstElementChild;
      if (e instanceof HTMLUnknownElement) return { drawn: 'unsupported', read: 'unsupported', works: 'unsupported', detail: `This browser has no <${name}> element.` };
      const events = [];
      for (const ev of ['promptaction', 'promptdismiss', 'location', 'stream', 'track', 'click']) e.addEventListener(ev, () => events.push(ev));
      const state = () => ('isValid' in e ? `${e.isValid ? 'valid' : `invalid (${e.invalidReason || 'no reason'})`}` : null);
      await f.draw(); await sleep(700);
      const inkAt = f.ink(e);
      const inPlace = state();
      // A real click needs the recording script or a person.
      let clicked = null;
      if (auto?.click) {
        const b = e.getBoundingClientRect();
        await auto.click(b.left + b.width / 2, b.top + b.height / 2);
        await sleep(900);
        clicked = events.slice();
      }
      await f.draw(30, 20); await sleep(700);
      const moved = state();
      await f.draw(30, 20, 0.2); await sleep(700);
      const rotated = state();

      // The same element outside any canvas.
      rig.innerHTML = `<${name} style="display:inline-block;margin:12px"></${name}>`;
      const plain = rig.firstElementChild;
      const plainEvents = [];
      for (const ev of ['promptaction', 'promptdismiss', 'location', 'stream', 'track', 'click']) plain.addEventListener(ev, () => plainEvents.push(ev));
      await sleep(900);
      const outside = 'isValid' in plain ? (plain.isValid ? 'valid' : `invalid (${plain.invalidReason || 'no reason'})`) : null;
      let plainClicked = null;
      if (auto?.click) {
        const b = plain.getBoundingClientRect();
        await auto.click(b.left + b.width / 2, b.top + b.height / 2);
        await sleep(900);
        plainClicked = plainEvents.slice();
      }

      const parts = [`${inkAt.n} of its ${inkAt.area} pixels are drawn and getImageData() returns them.`];
      let works = 'person';
      if (inPlace !== null) {
        parts.push(`Drawn over its own box: ${inPlace}. Drawn 30 px away: ${moved}. Rotated: ${rotated}. Outside a canvas: ${outside}.`);
        if (!e.isValid && inPlace.startsWith('invalid')) works = 'no';
      } else {
        parts.push('This element has no isValid property, so only a click shows whether it works.');
      }
      if (clicked) {
        const prompt = (list) => (list.some((x) => x.startsWith('prompt')) ? 'the browser opened its prompt' : 'no prompt');
        parts.push(`A real click in the canvas: events ${clicked.join(', ') || 'none'}, ${prompt(clicked)}. A real click outside: events ${plainClicked.join(', ') || 'none'}, ${prompt(plainClicked)}.`);
        if (clicked.some((x) => x.startsWith('prompt'))) works = 'yes';
        else if (plainClicked.some((x) => x.startsWith('prompt'))) works = 'no';
      }
      return { drawn: yesNo(inkAt.n > 0), read: yesNo(inkAt.n > 0 && !inkAt.error), works, detail: parts.join(' ') };
    },
  };
}
// #endregion permission

// #region cross-origin
// Content from another origin, loaded without CORS, as part of a drawn element.
// The measurement is the same for each kind: how many of its pixels are in the
// picture, and does the canvas still let script read it.
function crossOriginCase({ id, title, html, wait = true, features = [], baseline }) {
  return {
    id, group: 'Content from another origin', title, features,
    async run(rig) {
      const measure = async (markup) => {
        const f = fixture(rig, markup);
        const node = f.el.firstElementChild;
        if (wait) await loaded(node);
        await sleep(400);
        await f.draw();
        const ink = f.ink(node);
        let url = 'ok';
        try { f.canvas.toDataURL(); } catch (err) { url = err.name; }
        return { ink, url };
      };
      const own = baseline ? await measure(baseline) : null;
      const other = await measure(html);
      const drawn = other.ink.n > other.ink.area * 0.02;
      const readable = !other.ink.error && other.url === 'ok';
      const detail = [
        `${other.ink.n} of ${other.ink.area} pixels of its box are drawn${own ? ` (${own.ink.n} for the same content from this origin)` : ''}.`,
        readable ? 'getImageData() and toDataURL() do not throw, so the canvas is not tainted.' : `Reading throws ${other.ink.error ?? other.url}.`,
        drawn ? '' : 'The browser leaves it out of the picture, and that is why the canvas stays readable.',
      ].join(' ').trim();
      return { drawn: yesNo(drawn), read: drawn ? yesNo(readable) : 'n/a', works: 'n/a', detail };
    },
  };
}
// #endregion cross-origin

const THUMB = '/shared/thumbs/capture.jpg';

export const CASES = [
  permissionCase('geolocation', [5125006551416832]),
  permissionCase('camera', [5153829504024576]),
  permissionCase('microphone', [5153829504024576]),
  permissionCase('usermedia', [4926233538330624]),
  permissionCase('install', []),

  // #region visited
  {
    id: 'visited', group: 'History', title: 'A link to a visited page, with a :visited colour', features: [5101991698628608],
    async run(rig, auto) {
      // This page's own address is in history by definition.
      const link = `<a class="pv" href="${location.pathname}" style="font:bold 28px sans-serif;text-decoration:none">XXXXXXXX</a>`;
      const f = fixture(rig, `<style>a.pv:link{color:#00f}a.pv:visited{color:#f00}</style>${link}`);
      await f.draw();
      const red = f.ink(f.el, isRed).n, blue = f.ink(f.el, isBlue).n;
      const computed = getComputedStyle(f.el.querySelector('a')).color;
      let screen = null;
      if (auto?.shot) {
        rig.innerHTML = `<style>a.pv:link{color:#00f}a.pv:visited{color:#f00}</style>${link}`;
        await sleep(200);
        const b = rig.querySelector('a').getBoundingClientRect();
        screen = await auto.shot(b.left, b.top, b.width, b.height);
      }
      const parts = [`The picture has ${red} pixels in the :visited colour and ${blue} in the :link colour. getComputedStyle() reports ${computed}, the :link colour, as it does for every link.`];
      if (screen) parts.push(screen.red > 20 ? `A screenshot of the same link outside a canvas has ${screen.red} pixels in the :visited colour.` : `A screenshot of the same link outside a canvas has ${screen.red} pixels in the :visited colour, so this browser profile keeps no history and the row says nothing.`);
      else parts.push('Compare with the link under "Try it by hand", which the screen shows in its real colour.');
      if (red > 20) return { drawn: 'yes', read: 'yes', works: 'n/a', detail: `${parts.join(' ')} Script can read one bit of history per link.` };
      return { drawn: screen && screen.red <= 20 ? 'person' : 'no', read: 'no', works: 'n/a', detail: `${parts.join(' ')} The canvas gets the link drawn as unvisited.` };
    },
  },
  // #endregion visited

  // #region system
  {
    id: 'system-colours', group: 'The person\'s settings', title: 'System colours (AccentColor, Highlight, …)', features: [5068127364186112, 6207138742534144],
    async run(rig) {
      const names = ['AccentColor', 'AccentColorText', 'Highlight', 'HighlightText', 'SelectedItem', 'Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ButtonFace', 'Field', 'Mark'];
      const f = fixture(rig, names.map((n, i) => `<div style="position:absolute;left:${i * 20}px;top:0;width:20px;height:20px;background:${n}"></div>`).join(''));
      await f.draw();
      const p = f.pixels();
      const rows = names.map((n, i) => {
        const o = (10 * W + i * 20 + 10) * 4;
        const px = p.error ? p.error : `rgb(${p.data[o]}, ${p.data[o + 1]}, ${p.data[o + 2]})`;
        return { n, px, css: getComputedStyle(f.el.children[i]).backgroundColor };
      });
      const same = rows.filter((r) => r.css.replace(/rgba?\(|\)|\s/g, '').split(',').slice(0, 3).join() === r.px.replace(/rgb\(|\)|\s/g, '')).length;
      return {
        drawn: 'yes', read: yesNo(!p.error), works: 'n/a',
        detail: `${rows.map((r) => `${r.n} ${r.px}`).join('; ')}. ${same} of ${rows.length} match what getComputedStyle() already reports, so the picture adds nothing script could not read before.`,
      };
    },
  },
  {
    id: 'accent-control', group: 'The person\'s settings', title: 'A checked checkbox with the default accent colour', features: [5068127364186112],
    async run(rig) {
      const f = fixture(rig, '<input type="checkbox" checked style="position:absolute;left:0;top:0;width:40px;height:40px;margin:0"><div style="position:absolute;left:60px;top:0;width:20px;height:20px;background:AccentColor"></div>');
      await f.draw();
      const p = f.pixels();
      if (p.error) return { drawn: 'yes', read: 'no', works: 'n/a', detail: `Reading throws ${p.error}.` };
      const at = (x, y) => { const o = (y * W + x) * 4; return `rgb(${p.data[o]}, ${p.data[o + 1]}, ${p.data[o + 2]})`; };
      return { drawn: 'yes', read: 'yes', works: 'n/a', detail: `The box of the control reads back as ${at(5, 20)}; AccentColor reads back as ${at(70, 10)}. In the test browser both are the default blue. On a device with a custom accent colour the picture would carry it.` };
    },
  },
  {
    id: 'scrollbar', group: 'The person\'s settings', title: 'The scrollbar of a drawn scroller',
    async run(rig) {
      const f = fixture(rig, '<div style="width:200px;height:120px;overflow:scroll;background:#fff"><div style="height:500px"></div></div>');
      await f.draw();
      const s = f.el.firstElementChild;
      const width = s.offsetWidth - s.clientWidth;
      const p = f.pixels();
      let marked = 0;
      if (!p.error) for (let y = 0; y < 120; y++) for (let x = 184; x < 200; x++) { const o = (y * W + x) * 4; if (p.data[o] < 250 || p.data[o + 1] < 250 || p.data[o + 2] < 250) marked++; }
      return { drawn: yesNo(marked > 0), read: marked > 0 ? yesNo(!p.error) : 'n/a', works: 'n/a', detail: `The scrollbar takes ${width} px of layout width. ${marked} pixels of the 16 px strip at the right edge differ from the white background.${width === 0 && !marked ? ' This browser uses overlay scrollbars, which are hidden until the scroller moves.' : ''}` };
    },
  },
  // #endregion system

  // #region typing
  {
    id: 'spelling', group: 'What the person types', title: 'Spelling markers in a text field', features: [],
    async run(rig) {
      const area = (on) => `<textarea spellcheck="${on}" lang="en" inputmode="none" style="display:block;width:280px;height:60px;margin:0;font:20px sans-serif;color:#000;background:#fff;border:0;outline:0;resize:none">Teh qwick brwon fox</textarea>`;
      const f = fixture(rig, `<style>::spelling-error{background:#f00;color:#000}</style>${area(true)}${area(false)}`);
      const [on, off] = f.el.querySelectorAll('textarea');
      const had = document.activeElement;
      // The browser checks a field once it has been focused and edited.
      for (const t of [on, off]) { t.focus({ preventScroll: true }); t.setSelectionRange(3, 3); document.execCommand?.('insertText', false, ' '); await sleep(350); }
      on.blur(); off.blur(); had?.focus?.({ preventScroll: true });
      await sleep(300);
      await f.draw();
      const red = f.ink(on, isRed).n;
      const p = f.pixels();
      let differ = 0;
      if (!p.error) for (let y = 0; y < 60; y++) for (let x = 0; x < 280; x++) { const a = (y * W + x) * 4, b = ((y + 60) * W + x) * 4; if (p.data[a] !== p.data[b] || p.data[a + 1] !== p.data[b + 1] || p.data[a + 2] !== p.data[b + 2]) differ++; }
      if (!differ) return { drawn: 'person', read: 'person', works: 'n/a', detail: 'The picture of a field with spellcheck on is identical to one with spellcheck off, so this browser marked nothing. The test browser has no dictionary. Try the field under "Try it by hand".' };
      return { drawn: 'yes', read: yesNo(!p.error), works: 'n/a', detail: `${differ} pixels differ between a field with spellcheck on and the same field with it off, and ${red} are in the ::spelling-error colour the page set. Script can find which words the person's dictionary rejects.` };
    },
  },
  {
    id: 'password', group: 'What the person types', title: 'The value of a password field',
    async run(rig) {
      const field = (v) => `<input type="password" value="${v}" style="display:block;width:280px;height:40px;margin:0;box-sizing:border-box;font:20px monospace;color:#000;background:#fff;border:0;outline:0">`;
      const f = fixture(rig, field('hunter2') + field('abcdefg') + field('hunter22'));
      await f.draw();
      const p = f.pixels();
      if (p.error) return { drawn: 'yes', read: 'no', works: 'n/a', detail: `Reading throws ${p.error}.` };
      const diff = (rowA, rowB) => { let n = 0; for (let y = 0; y < 40; y++) for (let x = 0; x < 280; x++) { const a = ((y + rowA) * W + x) * 4, b = ((y + rowB) * W + x) * 4; if (p.data[a] !== p.data[b]) n++; } return n; };
      const same = diff(0, 40), longer = diff(0, 80);
      return { drawn: 'yes', read: 'yes', works: 'n/a', detail: `The dots are drawn. Two different passwords of seven characters differ in ${same} pixels, and a password of eight characters differs in ${longer}. The picture gives the length, which input.value.length already gives the page.` };
    },
  },
  {
    id: 'autofill', group: 'What the person types', title: 'An autofill suggestion before it is accepted', features: [],
    async run() {
      return { drawn: 'person', read: 'person', works: 'person', detail: 'A script cannot open the autofill list. Use the form under "Try it by hand": it reports the field values, the :autofill matches and the pixels of the picture while a suggestion is previewed.' };
    },
  },
  // #endregion typing

  crossOriginCase({ id: 'iframe-cross', title: 'An <iframe> from another origin', baseline: '<iframe src="/protected/frame.html" style="width:280px;height:160px;border:0"></iframe>', html: `<iframe src="${OTHER}/protected/frame.html" style="width:280px;height:160px;border:0"></iframe>`, features: [] }),
  crossOriginCase({ id: 'img-cross', title: 'An <img> from another origin, no CORS', baseline: `<img src="${THUMB}" style="width:200px;height:120px">`, html: `<img src="${OTHER}${THUMB}" style="width:200px;height:120px">` }),
  crossOriginCase({ id: 'img-cors', title: 'An <img crossorigin> from another origin that allows it', html: `<img crossorigin="anonymous" src="${OTHER}/capture/swatch.svg" style="width:200px;height:120px">` }),
  crossOriginCase({ id: 'background-cross', title: 'A CSS background-image from another origin', wait: false, baseline: `<div style="width:200px;height:120px;background:url(${THUMB})"></div>`, html: `<div style="width:200px;height:120px;background:url(${OTHER}${THUMB})"></div>` }),
  crossOriginCase({ id: 'video-cross', title: 'A <video> from another origin, no CORS', baseline: '<video src="/media/clip.webm" muted playsinline preload="auto" style="width:200px;height:120px"></video>', html: `<video src="${OTHER}/media/clip.webm" muted playsinline preload="auto" style="width:200px;height:120px"></video>` }),
  // #region webgl
  {
    id: 'iframe-webgl', group: 'Content from another origin', title: 'A cross-origin <iframe> uploaded as a WebGL texture',
    async run(rig) {
      // One canvas and one WebGL context for both uploads. Read the texture back
      // through a framebuffer. The context is not released with loseContext():
      // in Chromium 157 that call on a drawable canvas that is then removed
      // crashes the tab.
      rig.innerHTML = `<canvas content="drawable" layoutsubtree width="${W}" height="${H}" style="width:${W}px;height:${H}px;display:block"><div drawable style="width:${W}px;height:${H}px"><iframe style="width:280px;height:160px;border:0"></iframe></div></canvas>`;
      const canvas = rig.firstElementChild, el = canvas.firstElementChild, frame = el.firstElementChild;
      const gl = canvas.getContext('webgl2');
      if (!gl || !gl.texElementSubImage2D) return { drawn: 'unsupported', read: 'unsupported', works: 'n/a', detail: 'No WebGL 2 context with texElementSubImage2D().' };
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const upload = async (src) => {
        frame.src = src;
        await loaded(frame); await sleep(400);
        return new Promise((done) => {
          canvas.addEventListener('paint', () => {
            try {
              gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, el);
              const px = new Uint8Array(W * H * 4);
              gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
              let n = 0;
              for (let i = 3; i < px.length; i += 4) if (px[i]) n++;
              done({ n, glError: gl.getError() });
            } catch (err) { done({ error: `${err.name}: ${err.message}` }); }
          }, { once: true });
          canvas.requestPaint();
          setTimeout(() => done({ error: 'no paint event' }), 1500);
        });
      };
      const own = await upload('/protected/frame.html');
      if (own.error) return { drawn: 'unsupported', read: 'unsupported', works: 'n/a', detail: own.error };
      const other = await upload(`${OTHER}/protected/frame.html`);
      await sleep(100);
      if (other.error) return { drawn: 'no', read: 'no', works: 'n/a', detail: `The upload fails: ${other.error}` };
      return { drawn: yesNo(other.n > 0), read: other.n > 0 ? 'yes' : 'n/a', works: 'n/a', detail: `readPixels() of the texture returns ${other.n} non-transparent pixels for the cross-origin frame and ${own.n} for the same page from this origin. GL error ${other.glError}. A shader gets the same empty picture a 2D context gets.` };
    },
  },
  // #endregion webgl

  // #region top-layer
  {
    id: 'popover', group: 'Top layer and hit testing', title: 'An open popover inside a drawn element', features: [5073251081912320],
    async run(rig) {
      const f = fixture(rig, '<div popover="manual" style="position:fixed;inset:auto;margin:0;width:100px;height:60px;background:#f00;border:0"></div><p>in flow</p>');
      const pop = f.el.firstElementChild;
      // An open popover is positioned against the viewport. Put it over the canvas.
      const [left, top] = f.client(10, 10);
      pop.style.left = `${left}px`; pop.style.top = `${top}px`;
      try { pop.showPopover(); } catch {}
      await sleep(100);
      await f.draw();
      const red = f.ink(f.el, isRed).n;
      const hit = document.elementFromPoint(left + 40, top + 30) === pop;
      pop.hidePopover?.();
      return { drawn: yesNo(red > 100), read: red > 100 ? 'yes' : 'n/a', works: yesNo(hit), detail: `The popover is 100 by 60 px and open over the canvas. ${red} of its pixels are in the picture. The browser draws it in the top layer, above the canvas, where it ${hit ? 'takes' : 'does not take'} the hit test. A canvas cannot draw, bend or read an open popover.` };
    },
  },
  {
    id: 'dialog', group: 'Top layer and hit testing', title: 'A modal <dialog> inside a drawn element',
    async run(rig) {
      const f = fixture(rig, '<dialog style="position:fixed;inset:auto;margin:0;width:100px;height:60px;padding:0;background:#f00;border:0"></dialog><p>in flow</p>');
      const d = f.el.firstElementChild;
      const [left, top] = f.client(10, 10);
      d.style.left = `${left}px`; d.style.top = `${top}px`;
      const had = document.activeElement;
      try { d.showModal(); } catch (err) { return { drawn: 'no', read: 'n/a', works: 'no', detail: `showModal() throws ${err.name}.` }; }
      await sleep(100);
      await f.draw();
      const red = f.ink(f.el, isRed).n;
      const hit = document.elementFromPoint(left + 40, top + 30) === d;
      d.close(); had?.focus?.({ preventScroll: true });
      return { drawn: yesNo(red > 100), read: red > 100 ? 'yes' : 'n/a', works: yesNo(hit), detail: `showModal() opens it over the canvas and ${red} of its pixels are in the picture. Like a popover it is drawn by the browser in the top layer, and it ${hit ? 'takes' : 'does not take'} the hit test there.` };
    },
  },
  {
    id: 'inert', group: 'Top layer and hit testing', title: 'interactivity: inert on a drawn element', features: [5107436833472512],
    async run(rig) {
      if (!CSS.supports('interactivity', 'inert')) return { drawn: 'unsupported', read: 'unsupported', works: 'unsupported', detail: 'This browser does not parse interactivity: inert.' };
      const f = fixture(rig, '<button style="position:absolute;left:10px;top:10px;width:100px;height:40px;background:#f00;border:0;interactivity:inert">inert</button>');
      await f.draw();
      const b = f.el.firstElementChild;
      const red = f.ink(b, isRed).n;
      const [x, y] = f.client(50, 30);
      const hit = document.elementFromPoint(x, y) === b;
      return { drawn: yesNo(red > 100), read: yesNo(red > 100), works: yesNo(!hit), detail: `${red} pixels of the button are drawn and elementFromPoint() ${hit ? 'still returns it' : 'does not return it'}. This is the opposite case to the rows above: painted, and deliberately not usable.` };
    },
  },
  // #endregion top-layer
];

/** Run the cases one after another in `rig`. `auto` holds real input from the recording script. */
export async function runCases(rig, { auto = null, only = null, onResult } = {}) {
  const results = [];
  for (const c of CASES) {
    if (only && !only.includes(c.id)) continue;
    let r;
    try { r = await c.run(rig, auto); } catch (err) { r = { drawn: 'error', read: 'error', works: 'error', detail: `${err.name}: ${err.message}` }; }
    rig.innerHTML = '';
    const result = { id: c.id, title: c.title, ...r };
    results.push(result);
    onResult?.(result);
    await sleep(30);
  }
  return results;
}
