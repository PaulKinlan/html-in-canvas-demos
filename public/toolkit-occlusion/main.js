// The page script for /toolkit-occlusion/.
import { banner, runTests } from '/shared/support.js';
import { startToolkitOcclusion } from '/toolkit-occlusion/start.js';
import { ROUTES } from '/toolkit-occlusion/routes.js';

banner();
const $ = (id) => document.getElementById(id);
const canvas = $('occlusion-app'), stage = $('stage'), msg = $('msg'), outline = $('outline');
const say = (text) => { msg.textContent = text; msg.hidden = !text; };
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : 'none');
const LABEL = { name: 'input', notes: 'textarea', country: 'select', terms: 'p + link' };

for (const [id, r] of Object.entries(ROUTES)) $('route').add(new Option(r.label, id));

// #region table
// Filled when a window stops moving, when the route changes and once at the start.
// Never from a frame loop.
function show(occ) {
  const m = occ.measure();
  const rows = [...m.fields, { ...m.total, name: 'all' }];
  $('numbers').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    const guard = m.route === 'guard' && r.wrong ? `${r.wrong} (${r.reach} get through)` : String(r.wrong);
    const cells = [r.name === 'all' ? 'All four' : LABEL[r.name], `${r.covered}/${r.points}`, guard, String(r.lost), pct(r.visible - r.lost, r.visible)];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if ((i === 2 && r.reach) || (i === 3 && r.lost)) td.className = 'n-bad';
      tr.append(td);
    });
    if (r.reach || r.lost) tr.className = 'bad';
    return tr;
  }));
  const move = occ.lastMove, t = m.total;
  const covered = m.fields.filter((r) => r.covered).map((r) => `${LABEL[r.name]} ${r.bounds[2]} by ${r.bounds[3]} at ${r.bounds[0]}, ${r.bounds[1]}`);
  $('cost').textContent =
    `Route: ${ROUTES[m.route].label}. Script that asks ImGui what is on top at each pointer event: ${ROUTES[m.route].eventScript ? 'yes' : 'no'}. ` +
    (move ? `The last move took ${move.frames} ImGui frames, ${move.paints} paint events, ${move.uploads} texture uploads, ${move.geometry} updateElementGeometry() calls and ${move.styleWrites} style writes. ` : 'No window has been moved yet. ') +
    (covered.length ? `getBoundingClientRect() of the covered fields: ${covered.join('; ')}. ` : '') +
    (t.unsampled ? `${t.unsampled} sample points are outside the viewport and were not tested.` : '');
  if (!outline.hasAttribute('hidden')) drawOutline(m);
}
// #endregion table

// #region outline
// One dot per sample point, in an SVG over the canvas with pointer-events: none.
function drawOutline(m) {
  const dot = (s) => {
    if (s.reach && s.covered) return `<circle cx="${s.x}" cy="${s.y}" r="3.2" fill="#ff5a4d"/>`;
    if (s.hit && s.covered) return `<circle cx="${s.x}" cy="${s.y}" r="2.6" fill="none" stroke="#ff5a4d" stroke-width="1.4"/>`;
    if (s.hit) return `<circle cx="${s.x}" cy="${s.y}" r="2.4" fill="#5fe08a"/>`;
    if (s.lost) return `<circle cx="${s.x}" cy="${s.y}" r="2.6" fill="none" stroke="#ffc233" stroke-width="1.4"/>`;
    return '';
  };
  outline.setAttribute('viewBox', `0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);
  outline.innerHTML = m.samples.map(dot).join('');
}
// #endregion outline

startToolkitOcclusion(canvas, stage).then(({ module, app, occ }) => {
  const started = performance.now();
  let first = true;
  // Wait for the first uploads, then fill the table once.
  const ready = setInterval(() => {
    if (app.stats.uploads >= 4 && first) { first = false; say(''); clearInterval(ready); show(occ); }
    else if (performance.now() - started > 8000) { clearInterval(ready); say(`The app started but no element was drawn. ${app.stats.error || 'HTML-in-canvas may be off in this browser.'}`); }
  }, 250);
  window.__occ = Object.assign(occ, { app, module });   // for the console on a device
  occ.onMoveStart = () => { outline.innerHTML = ''; };
  occ.onSettled = () => show(occ);
  // Points outside the viewport cannot be hit tested, so measure again when more of the canvas comes into view.
  new IntersectionObserver(() => { if (!first) show(occ); }, { threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(canvas);
  $('route').addEventListener('change', (event) => {
    occ.setRoute(event.target.value);
    // A style change repaints the field. Measure after the frames that follow.
    setTimeout(() => show(occ), 300);
  });
  for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => occ.preset(button.dataset.preset));
  $('show-outline').addEventListener('change', (event) => {
    outline.toggleAttribute('hidden', !event.target.checked);   // an SVG element has no hidden property
    if (event.target.checked) show(occ);
  });
}, (err) => say(`The app did not start: ${err.message}`));
// A lost WebGL context leaves the canvas blank. The app does not rebuild its textures.
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  say('The canvas lost its WebGL context. Reload the page to start the app again.');
});

// ---------------------------------------------------------------- live checks
// The checks load a second copy of the app in a frame. Focus is only ever moved inside that frame.
let frame = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (test()) return true; await sleep(50); } return false; };
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:360px;height:560px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:360px;height:560px';
  f.tabIndex = -1;
  f.src = '/toolkit-occlusion/fixture.html';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  await until(() => win.__app || win.__error, 8000);
  if (!win.__app) throw new Error(win.__error ?? 'the app did not start');
  const { module, app, occ } = win.__app;
  await until(() => app.stats.uploads >= 4, 5000);
  // Settled: no new ImGui frame for 100 ms. ImGui draws on every animation frame while it has work.
  const settle = async () => {
    let last = -1, same = 0;
    for (let i = 0; i < 200 && same < 4; i++) { await sleep(25); if (app.stats.frames === last) same++; else { same = 0; last = app.stats.frames; } }
  };
  await settle();
  frame = { holder, win, doc: f.contentDocument, canvas: app.canvas, module, app, occ, settle };
  return frame;
}

const SCENES = ['full', 'side', 'middle', 'corner'];
// Measure one route with window A in four positions over the textarea.
async function measureRoute(id) {
  const { occ, settle } = await fixture();
  occ.setRoute(id);
  const out = { parts: [], wrong: 0, reach: 0, lost: 0, visible: 0, covered: 0, others: 0 };
  for (const scene of SCENES) {
    occ.pointerAway();
    occ.preset(scene);
    await settle();
    const m = occ.measure(), r = m.fields.find((x) => x.name === 'notes');
    out.parts.push(`${scene}: ${r.wrong} of ${r.covered} covered points hit the field, ${r.lost} of ${r.visible} visible points lost`);
    for (const k of ['wrong', 'reach', 'lost', 'visible', 'covered']) out[k] += r[k];
    out.others += m.total.wrong + m.total.lost - r.wrong - r.lost;
  }
  occ.preset('apart');
  occ.setRoute('none');
  await settle();
  out.text = `Textarea, 96 points, window A in four positions. ${out.parts.join('. ')}. Visible points that take the pointer: ${pct(out.visible - out.lost, out.visible)}.`;
  if (out.others) out.text += ` ${out.others} wrong or lost points on the other fields.`;
  return out;
}
const routeCheck = (id, name, why, expect) => ({
  name, why, expect, timeout: 30000,
  run: async () => {
    const r = await measureRoute(id);
    if (r.reach || r.lost || r.others) throw new Error(r.text);
    return r.text + (r.wrong ? ` The browser's hit test still answers the field at all ${r.wrong} covered points. The guard gives an event there to ImGui.` : '');
  },
});

// Five points across the input at half height: 10, 30, 45, 55 and 90 percent of its width.
async function hitPattern(name = 'name') {
  const { doc, app, canvas: c, win } = await fixture();
  c.toggleAttribute('data-geometry-tick');
  await new Promise((r) => win.requestAnimationFrame(r));
  const f = app.items[name], [x, y, w, h] = f.rect;
  return [0.1, 0.3, 0.45, 0.55, 0.9].map((u) => { const t = doc.elementFromPoint(x + u * w, y + h / 2); return t === f.el ? 1 : 0; }).join('');
}
let clipProbe = null;
// #region clip-probe
// What canvasClip accepts. Before each try the clip is the right half of the input (00011).
// The try asks for the left half (11100), or the two outer parts (11001) for a list.
async function probeClip() {
  if (clipProbe) return clipProbe;
  const { occ, app, canvas: c, win, settle } = await fixture();
  occ.setRoute('none'); occ.preset('apart'); await settle();
  const f = app.items.name, [x, y, w, h] = f.rect;
  const place = (clip) => c.updateElementGeometry(f.el, clip === undefined ? { canvasTransform: occ.matrix(x, y) } : { canvasTransform: occ.matrix(x, y), canvasClip: clip });
  const path = new win.Path2D(); path.rect(0, 0, w / 2, h);
  const cases = [
    ['a DOMRect', new win.DOMRect(0, 0, w / 2, h)],
    ['a plain object {x, y, width, height}', { x: 0, y: 0, width: w / 2, height: h }],
    ['an array of two DOMRects', [new win.DOMRect(0, 0, w * 0.4, h), new win.DOMRect(w * 0.6, 0, w * 0.4, h)]],
    ['an array of four numbers', [0, 0, w / 2, h]],
    ['a Path2D', path],
    ['a DOMRectList from getClientRects()', f.el.getClientRects()],
    ['a DOMQuad', new win.DOMQuad({ x: 0, y: 0 }, { x: w / 2, y: 0 }, { x: w / 2, y: h }, { x: 0, y: h })],
    ['a rectangle with radii: [20]', { x: 0, y: 0, width: w / 2, height: h, radii: [20] }],
    ['a CSS string inset(0 50% 0 0)', 'inset(0 50% 0 0)'],
    ['a number', 5],
    ['null', null],
    ['an empty object', {}],
    ['a zero-size rectangle', new win.DOMRect(0, 0, 0, 0)],
    ['a zero-width rectangle', new win.DOMRect(0, 0, 0, h)],
    ['a negative width (w/2, 0, -w/2, h)', new win.DOMRect(w / 2, 0, -w / 2, h)],
    ['a NaN x', new win.DOMRect(NaN, 0, w / 2, h)],
    ['an Infinity width', new win.DOMRect(0, 0, Infinity, h)],
    ['no canvasClip member', undefined],
  ];
  const means = { '11100': 'used as the left half', '00011': 'ignored, the earlier clip stays', '00000': 'read as an empty rectangle, no hit box left', '11001': 'used as two rectangles', '11111': 'clip removed' };
  const results = [];
  for (const [label, value] of cases) {
    place(new win.DOMRect(w / 2, 0, w / 2, h));
    let thrown = '';
    try { place(value); } catch (e) { thrown = e.name; }
    const pattern = await hitPattern();
    results.push({ label, pattern, thrown, text: `${label}: ${thrown ? `throws ${thrown}, ` : ''}${means[pattern] ?? `pattern ${pattern}`}` });
  }
  // A rounded corner: with radii honoured, the point 1 px inside the corner would miss.
  place({ x: 0, y: 0, width: w, height: h, radii: [20] });
  c.toggleAttribute('data-geometry-tick');
  await sleep(50);
  const corner = f.el.ownerDocument.elementFromPoint(x + 1, y + 1) === f.el;
  occ.reset();
  clipProbe = { results, corner, by: (label) => results.find((r) => r.label.startsWith(label)) };
  return clipProbe;
}
// #endregion clip-probe

const rgba = (v) => (v < 0 ? 'unreadable' : `rgba(${Math.floor(v / 16777216)}, ${Math.floor(v / 65536) % 256}, ${Math.floor(v / 256) % 256}, ${v % 256})`);
// Field numbers in the app: 0 input, 1 textarea, 2 select, 3 paragraph.
const texel = (module, index, u, v) => module._ui_texel(index, u, v);

const tests = [
  {
    name: 'The app starts and uploads its four DOM fields as textures',
    why: 'texElementSubImage2D() into textures made in C++, each drawn with one ImGui::ImageWithBg() call.',
    timeout: 30000,
    run: async () => {
      const { app, occ } = await fixture();
      if (app.stats.uploads < 4) throw new Error(`${app.stats.uploads} uploads. ${app.stats.error}`);
      const m = occ.measure();
      if (m.total.lost || m.total.wrong) throw new Error(`with nothing covered, ${m.total.lost} points are lost and ${m.total.wrong} are wrong`);
      return `${app.stats.uploads} uploads after ${app.stats.paints} paint events. With no window over a field, ${m.total.visible} of ${m.total.points} sample points hit their field`;
    },
  },
  routeCheck('none', 'Route 1, no handling: a covered field does not take the pointer', 'The baseline. The browser hit tests the field wherever its geometry is, and knows nothing of what ImGui drew over it.', 'fail'),
  routeCheck('guard', 'Route 2, the guard: a covered field does not take the pointer', 'A capture listener asks ImGui (FindHoveredWindowEx) at every pointer event on a field, and gives the event to ImGui if a window is on top.'),
  {
    name: 'Route 2, the guard: a synthetic press on a covered point does not reach the field',
    why: 'A pointerdown is dispatched on the element the browser finds under a covered point of the textarea, in the fixture frame.',
    timeout: 30000,
    run: async () => {
      const { occ, app, doc, win, settle } = await fixture();
      occ.pointerAway(); occ.setRoute('guard'); occ.preset('full'); await settle();
      const f = app.items.notes, [x, y, w, h] = f.rect, px = x + w / 2, py = y + h / 2;
      const target = doc.elementFromPoint(px, py);
      let reached = 0;
      const seen = () => { reached++; };
      f.el.addEventListener('pointerdown', seen);
      const before = occ.stats.guardQueries;
      const event = new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, pointerType: 'mouse' });
      target.dispatchEvent(event);
      target.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, clientX: px, clientY: py, pointerId: 1, pointerType: 'mouse' }));
      f.el.removeEventListener('pointerdown', seen);
      await settle();
      const after = doc.elementFromPoint(px, py);
      const queries = occ.stats.guardQueries - before;
      occ.pointerAway(); occ.preset('apart'); occ.setRoute('none'); await settle();
      if (target !== f.el) throw new Error(`the browser found <${target?.localName}> there before the guard ran`);
      if (reached || !event.defaultPrevented) throw new Error(`the field's listener ran ${reached} times, defaultPrevented ${event.defaultPrevented}`);
      return `the browser's target was the textarea; the guard asked ImGui ${queries} times for 2 events, stopped the press and parked the field: the same point then hits <${after?.localName}>`;
    },
  },
  routeCheck('rect', 'Route 3, canvasClip as the largest visible rectangle: every visible point still takes the pointer', 'One rectangle cannot be the two halves of a field split by a window, or an L shape.', 'fail'),
  {
    name: 'Route 4: canvasClip accepts a list of rectangles or a path',
    why: 'An array of two DOMRects, a Path2D, a DOMRectList and a DOMQuad are passed as canvasClip.',
    expect: 'fail', timeout: 30000,
    run: async () => {
      const p = await probeClip();
      const many = ['an array of two', 'a Path2D', 'a DOMRectList', 'a DOMQuad', 'an array of four'].map((l) => p.by(l));
      const text = many.map((r) => r.text).join('. ');
      if (many.some((r) => r.pattern === '11001')) return text;
      throw new Error(text);
    },
  },
  {
    name: 'Route 4: canvasClip is one DOMRectInit, and other values do not throw',
    why: 'The dictionary reads x, y, width and height. An object without them is an empty rectangle.',
    timeout: 30000,
    run: async () => {
      const p = await probeClip();
      const rest = p.results.filter((r) => !['an array of two', 'a Path2D', 'a DOMRectList', 'a DOMQuad', 'an array of four'].some((l) => r.label.startsWith(l)));
      const text = `${rest.map((r) => r.text).join('. ')}. With radii: [20] on the whole field, the point 1 px inside its corner ${p.corner ? 'still hits the field, so the radius is not read' : 'misses the field'}`;
      if (p.by('a DOMRect').pattern !== '11100' || p.by('a plain object').pattern !== '11100') throw new Error(text);
      return text;
    },
  },
  routeCheck('clipPath', 'Route 5a, CSS clip-path on the field: covered points miss, visible points hit', 'clip-path: path() made of the visible rectangles, written when a window moves. No script runs at event time.'),
  {
    name: 'Route 5a: clip-path also cuts the texture, and leaves the uncovered part unchanged',
    why: 'One texel in the covered corner of the textarea and one in the uncovered part are read back, with no clip and with the clip. polygon() and path(evenodd) with a hole are tried on the input.',
    timeout: 30000,
    run: async () => {
      const { occ, app, module, settle } = await fixture();
      occ.setRoute('none'); occ.preset('corner'); await settle();
      const plain = [texel(module, 1, 0.9, 0.9), texel(module, 1, 0.1, 0.2)];
      const before = occ.snapshot();
      occ.setRoute('clipPath'); await settle();
      const cost = occ.since(before);
      const cut = [texel(module, 1, 0.9, 0.9), texel(module, 1, 0.1, 0.2)];
      occ.setRoute('none'); occ.preset('apart'); await settle();
      // The two CSS forms, set by hand on the input: a hole from 40% to 60% of its width.
      const f = app.items.name, [, , w, h] = f.rect, forms = [];
      for (const [label, value] of [
        ['path(evenodd) with a hole', `path(evenodd, "M0 0H${w}V${h}H0Z M${w * 0.4} 0H${w * 0.6}V${h}H${w * 0.4}Z")`],
        ['polygon() around the left half', `polygon(0 0, ${w / 2}px 0, ${w / 2}px ${h}px, 0 ${h}px)`],
      ]) {
        f.el.style.clipPath = value;
        await settle();
        forms.push(`${label}: hit pattern ${await hitPattern()}`);
      }
      f.el.style.clipPath = '';
      await settle();
      const text = `covered corner texel ${rgba(plain[0])} without the clip, ${rgba(cut[0])} with it. Uncovered texel ${rgba(plain[1])} and ${rgba(cut[1])}. Turning the clip on cost ${cost.paints} paint event(s) and ${cost.uploads} upload(s). ${forms.join('. ')} (five points across the input: 11001 is a hole from 40% to 60%, 11100 the left half)`;
      if (plain[0] < 0) throw new Error(`the texture could not be read. ${text}`);
      if (cut[0] % 256 !== 0 || cut[1] !== plain[1]) throw new Error(text);
      return text;
    },
  },
  routeCheck('mask', 'Route 5b, CSS mask on the field: covered points miss', 'The same shape as a mask of linear-gradient layers. A mask changes what is painted. Hit testing in CSS does not read it.', 'fail'),
  routeCheck('blocker', 'Route 6, a blocker element per window: covered points miss, visible points hit', 'An empty 1 by 1 px drawable div, scaled to the window\'s rectangle with updateElementGeometry() after the fields are placed.'),
  {
    name: 'Route 6: where two hit boxes overlap, the element placed last takes the pointer',
    why: 'The input and a blocker over it are placed in both orders, with z-index on either, and with the blocker first or last in the DOM.',
    timeout: 30000,
    run: async () => {
      const { occ, app, doc, canvas: c, win, settle } = await fixture();
      occ.setRoute('none'); occ.preset('apart'); await settle();
      const f = app.items.name, b = occ.blockers[0].el, [x, y, w, h] = f.rect;
      const field = () => c.updateElementGeometry(f.el, { canvasTransform: occ.matrix(x, y) });
      const block = () => c.updateElementGeometry(b, { canvasTransform: occ.matrix(x, y, w, h) });
      const top = async () => {
        c.toggleAttribute('data-geometry-tick');
        await new Promise((r) => win.requestAnimationFrame(r));
        const t = doc.elementFromPoint(x + w / 2, y + h / 2);
        return t === b ? 'blocker' : t === f.el ? 'field' : `<${t?.localName}>`;
      };
      const rows = [], expect = [];
      const tryOrder = async (label, calls, want) => { for (const call of calls) call(); const got = await top(); rows.push(`${label}: ${got}`); expect.push(got === want); };
      await tryOrder('field then blocker', [field, block], 'blocker');
      await tryOrder('blocker then field', [block, field], 'field');
      await tryOrder('field, blocker, then the same field call again', [field, block, field], 'field');
      f.el.style.zIndex = '9';
      await sleep(100);
      await tryOrder('z-index 9 on the field, field then blocker', [field, block], 'blocker');
      f.el.style.zIndex = ''; b.style.zIndex = '9';
      await sleep(100);
      await tryOrder('z-index 9 on the blocker, blocker then field', [block, field], 'field');
      b.style.zIndex = '';
      c.prepend(b);
      await sleep(150);
      await tryOrder('blocker first in the DOM, field then blocker', [field, block], 'blocker');
      await tryOrder('blocker first in the DOM, blocker then field', [block, field], 'field');
      c.append(b);
      await sleep(150);
      await tryOrder('blocker last in the DOM, blocker then field', [block, field], 'field');
      // A repaint of the field must not bring it back above the blocker.
      field(); block();
      f.el.value = 'An input, repainted';
      await settle();
      const afterPaint = await top();
      rows.push(`field then blocker, then the field repaints: ${afterPaint}`);
      expect.push(afterPaint === 'blocker');
      f.el.value = 'An input';
      c.updateElementGeometry(b, { canvasTransform: new win.DOMMatrix().translate(-100000, -100000) });
      occ.reset();
      await settle();
      const text = rows.join('. ');
      if (expect.includes(false)) throw new Error(text);
      return `${text}. The order of the calls decides. z-index and DOM order do not`;
    },
  },
  routeCheck('inert', 'Route 7a, inert while any part is covered: every visible point still takes the pointer', 'The whole field stops taking the pointer when a window touches it.', 'fail'),
  routeCheck('pointerEvents', 'Route 7b, pointer-events: none while covered: every visible point still takes the pointer', 'The same coarse switch in CSS.', 'fail'),
  {
    name: 'Route 7c: one element can have two hit boxes',
    why: 'updateElementGeometry() is called twice for the input, 20 px apart. A point only in the first box and a point only in the second are tested.',
    expect: 'fail', timeout: 30000,
    run: async () => {
      const { occ, app, doc, canvas: c, win, settle } = await fixture();
      occ.setRoute('none'); occ.preset('apart'); await settle();
      const f = app.items.name, [x, y, w, h] = f.rect;
      c.updateElementGeometry(f.el, { canvasTransform: occ.matrix(x, y) });
      c.updateElementGeometry(f.el, { canvasTransform: occ.matrix(x, y + 20) });
      c.toggleAttribute('data-geometry-tick');
      await new Promise((r) => win.requestAnimationFrame(r));
      const first = doc.elementFromPoint(x + w / 2, y + 8) === f.el, second = doc.elementFromPoint(x + w / 2, y + h + 10) === f.el;
      occ.reset();
      await settle();
      const text = `first box: ${first ? 'hit' : 'not hit'}. Second box: ${second ? 'hit' : 'not hit'}. The second call replaces the first`;
      if (first && second) return text;
      throw new Error(text);
    },
  },
  routeCheck('overlay', 'Route 8, a plain element above the canvas: covered points miss, visible points hit', 'An absolutely positioned div outside the canvas, at the window\'s rectangle. It uses no canvas API.'),
  {
    name: 'Cost of ten window moves on each route',
    why: 'Window A is moved 4 px at a time across the textarea. Blocker and canvasClip must cost no upload, and only the guard may ask ImGui at event time. The guard parks the field after its first question, so later events at that point go to the canvas.',
    timeout: 60000,
    run: async () => {
      const { occ, app, module, doc, win, settle } = await fixture();
      const rows = [], cost = {};
      for (const id of Object.keys(ROUTES)) {
        occ.pointerAway(); occ.setRoute(id); occ.preset('side'); await settle();
        const N = app.items.notes.rect, start = occ.snapshot();
        for (let i = 1; i <= 10; i++) {
          const frames = app.stats.frames;
          module._ui_set_cover(0, N[0] + N[2] * 0.55 - 4 * i, N[1] - 8, N[2] * 0.45 + 8, N[3] + 16);
          await until(() => app.stats.frames > frames, 1000);
          await settle();
        }
        const moved = occ.since(start);
        // Ten pointer moves over a covered point of the textarea, sent to whatever the browser finds there.
        const px = N[0] + N[2] * 0.8, py = N[1] + N[3] / 2, q = occ.stats.guardQueries;
        for (let i = 0; i < 10; i++) doc.elementFromPoint(px, py)?.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, clientX: px + i * 0.1, clientY: py, pointerId: 1, pointerType: 'mouse' }));
        const queries = occ.stats.guardQueries - q;
        occ.pointerAway();
        await settle();
        cost[id] = { ...moved, queries };
        rows.push(`${ROUTES[id].label}: ${moved.paints} paint events, ${moved.uploads} uploads, ${moved.geometry} geometry calls, ${moved.styleWrites} style writes, ${queries} questions to ImGui in 10 pointer events`);
      }
      occ.setRoute('none'); occ.preset('apart'); await settle();
      const text = rows.join('. ');
      if (cost.blocker.uploads || cost.rect.uploads || cost.overlay.uploads) throw new Error(`a route that should not repaint the field uploaded a texture. ${text}`);
      if (Object.entries(cost).some(([id, c]) => (id === 'guard') !== (c.queries > 0))) throw new Error(`the questions to ImGui are not as expected. ${text}`);
      return text;
    },
  },
  {
    name: 'A fully covered field: focus() and getBoundingClientRect() on each route',
    why: 'Window A covers the whole textarea. focus() is called inside the fixture frame. Only inert is expected to stop it.',
    timeout: 60000,
    run: async () => {
      const { occ, app, doc, canvas: c, settle } = await fixture();
      const rows = [], wrong = [];
      for (const id of Object.keys(ROUTES)) {
        occ.pointerAway(); occ.setRoute(id); occ.preset('full'); await settle();
        const f = app.items.notes, box = c.getBoundingClientRect(), r = f.el.getBoundingClientRect();
        f.el.focus({ preventScroll: true });
        const focused = doc.activeElement === f.el;
        f.el.blur();
        const moved = Math.abs(r.x - box.x - f.rect[0]) > 1 || Math.abs(r.y - box.y - f.rect[1]) > 1;
        rows.push(`${ROUTES[id].label}: focus() ${focused ? 'works' : 'refused'}, bounds ${moved ? `at ${Math.round(r.x - box.x)}, ${Math.round(r.y - box.y)}` : 'where ImGui drew it'}`);
        if (focused === (id === 'inert')) wrong.push(id);
      }
      occ.setRoute('none'); occ.preset('apart'); await settle();
      const text = rows.join('. ');
      if (wrong.length) throw new Error(`not as expected on ${wrong.join(', ')}. ${text}`);
      return text;
    },
  },
];

runTests($('results'), tests).then(() => {
  if (!frame) return;
  const used = frame.canvas;
  frame.holder.remove();
  window.__gfx?.retire(used);
  frame = null;
});
