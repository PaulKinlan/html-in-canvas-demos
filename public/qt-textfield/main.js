// The page script for /qt-textfield/.
import { banner, runTests } from '/shared/support.js';
import { startQtTextField } from '/qt-textfield/start.js';

banner();
const $ = (id) => document.getElementById(id);
const msg = $('msg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (test()) return true; await sleep(50); } return false; };

// ---------------------------------------------------------------- the event log
// #region log
const logs = { qt: [], dom: [] };
const t0 = performance.now();
const stamp = () => ((performance.now() - t0) / 1000).toFixed(2).padStart(7);
function log(side, text) {
  const line = `${stamp()}  ${text}`;
  logs[side].push(line);
  const box = $(`log-${side}`);
  box.textContent += (box.textContent ? '\n' : '') + line;
  box.scrollTop = box.scrollHeight; // scrolls the log box only, not the page
}
const quote = (s) => (s == null ? 'null' : JSON.stringify(s));

// The element that has focus, looking through shadow roots.
function deepActive(doc = document) {
  let a = doc.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

// What the browser has to go on for the keyboard and for autofill: the element's own attributes.
export function describe(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const root = el.getRootNode();
  return {
    element: `<${el.localName}${el.className ? ` class="${el.className}"` : ''}>`,
    type: el.getAttribute('type'),
    inputmode: el.getAttribute('inputmode'),
    autocomplete: el.getAttribute('autocomplete'),
    name: el.getAttribute('name'),
    autocapitalize: el.getAttribute('autocapitalize'),
    enterkeyhint: el.getAttribute('enterkeyhint'),
    contenteditable: el.getAttribute('contenteditable'),
    label: el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent ?? null,
    form: el.form ? 'in a <form>' : 'no <form>',
    box: `${Math.round(r.width)} by ${Math.round(r.height)} px at ${Math.round(r.x)}, ${Math.round(r.y)}`,
    shadow: root.host ? `in the shadow root of <${root.host.localName}${root.host.id ? ` id="${root.host.id}"` : ''}>` : 'in the document',
    parent: `<${el.parentElement?.localName}${el.parentElement?.className ? ` class="${el.parentElement.className}"` : ''}>`,
    autofilled: el.matches(':autofill') ? 'matches :autofill' : 'does not match :autofill',
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}

function showFacts(side, el, app) {
  const d = describe(el);
  const p = app.dom.probe();
  const c = app.canvas.getBoundingClientRect();
  // Where Qt drew the field that has Qt's focus, in page coordinates.
  let drawn = null;
  if (side === 'qt') {
    const f = Object.values(p.qt).find((x) => x.activeFocus);
    if (f) drawn = { x: c.x + f.cursorRect.x, y: c.y + f.cursorRect.y, what: 'Qt drew its caret at' };
  } else {
    const f = p.dom[el.dataset.qt];
    if (f) drawn = { x: c.x + f.rect.x, y: c.y + f.rect.y, what: 'Qt drew the field at' };
  }
  const rows = [
    ['element', d.element], ['type', d.type], ['inputmode', d.inputmode], ['autocomplete', d.autocomplete], ['name', d.name],
    ['autocapitalize', d.autocapitalize], ['enterkeyhint', d.enterkeyhint], ['label', d.label], ['form', d.form],
    ['box', d.box], [drawn?.what ?? 'Qt drew it at', drawn ? `${Math.round(drawn.x)}, ${Math.round(drawn.y)} (${Math.round(Math.hypot(drawn.x - d.rect.x, drawn.y - d.rect.y))} px from the element's box)` : 'no Qt field has focus'],
    ['where', `${d.shadow}, child of ${d.parent}`], [':autofill', d.autofilled],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v === null ? 'not set' : v}`);
  $(`facts-${side}`).replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th'), td = document.createElement('td');
    th.textContent = k; td.textContent = v === null ? 'not set' : v;
    tr.append(th, td);
    return tr;
  }));
  facts[side] = text;
  log(side, `focus on ${d.element} type=${d.type} inputmode=${d.inputmode} autocomplete=${d.autocomplete} name=${d.name}; box ${d.box}`);
}
const facts = { qt: [], dom: [] };

function watch(app) {
  const { root, dom } = app;
  const sideOf = (el) => (el?.dataset?.qt ? 'dom' : el?.getRootNode?.() === root ? 'qt' : null);
  const secret = (el) => el.type === 'password';
  const data = (e, el) => (e.data == null ? 'null' : secret(el) ? `(${e.data.length} characters)` : quote(e.data));
  let last = { qt: '', dom: '' };
  // After an event, say what the QML side holds. This is the text the rest of the Qt UI reads.
  const qml = (side, el) => setTimeout(() => {
    const p = dom.probe();
    const f = side === 'qt' ? Object.values(p.qt).find((x) => x.activeFocus) : p.dom[el.dataset.qt];
    if (!f) return;
    const hide = secret(el);
    const text = side === 'qt'
      ? `TextField.text=${hide ? `(${f.text.length})` : quote(f.text)} preeditText=${hide ? `(${f.preedit.length})` : quote(f.preedit)} cursor=${f.cursor}`
      : `DomTextField.text=${hide ? `(${f.text.length})` : quote(f.text)} selection=${el.selectionStart}..${el.selectionEnd}`;
    if (text !== last[side]) { last[side] = text; log(side, `  QML: ${text}`); }
  }, 30);
  const on = (type, format) => window.addEventListener(type, (e) => {
    const el = e.composedPath()[0], side = sideOf(el);
    if (!side) return;
    log(side, `${type} ${format(e, el)}`);
    qml(side, el);
  }, true); // capture on window: runs before DomItem stops the event at the element
  on('keydown', (e, el) => `key=${secret(el) && e.key.length === 1 ? '(hidden)' : quote(e.key)} code=${secret(el) ? '(hidden)' : quote(e.code)} keyCode=${secret(el) ? '(hidden)' : e.keyCode} isComposing=${e.isComposing}`);
  on('beforeinput', (e, el) => `inputType=${e.inputType} data=${data(e, el)} isComposing=${e.isComposing}`);
  on('input', (e, el) => `inputType=${e.inputType ?? 'undefined'} data=${data(e, el)} isComposing=${e.isComposing ?? 'undefined'} ${el.matches(':autofill') ? ':autofill' : 'not :autofill'}`);
  on('compositionstart', (e, el) => `data=${data(e, el)}`);
  on('compositionupdate', (e, el) => `data=${data(e, el)}`);
  on('compositionend', (e, el) => `data=${data(e, el)}`);
  on('change', (e, el) => `${el.matches(':autofill') ? ':autofill' : 'not :autofill'}`);
  // Focus events between two elements of one shadow root do not leave that root, so listen on it.
  root.addEventListener('focusin', (e) => {
    const el = e.target, side = sideOf(el);
    if (!side || el.classList.contains('qt-window-focus-helper')) return;
    setTimeout(() => { if (deepActive() === el) showFacts(side, el, app); }, 60); // after Qt has set the attributes
  }, true);
  root.addEventListener('focusout', (e) => {
    const el = e.target, side = sideOf(el);
    if (side && !el.classList.contains('qt-window-focus-helper')) log(side, 'blur');
  }, true);
  // The keyboard changes the visual viewport. The line goes to the log of the field that has focus.
  let height = Math.round(visualViewport.height);
  visualViewport.addEventListener('resize', () => {
    const now = Math.round(visualViewport.height);
    if (now === height) return;
    const side = sideOf(deepActive());
    for (const s of side ? [side] : ['qt', 'dom']) log(s, `visualViewport height ${height} to ${now} px (window.innerHeight ${innerHeight})`);
    height = now;
  });
  // Autofill can arrive with no key event. Look once a second and log a change.
  const filled = new Map();
  setInterval(() => {
    for (const el of root.querySelectorAll('input')) {
      const now = el.matches(':autofill');
      if (now !== (filled.get(el) ?? false)) { filled.set(el, now); log(sideOf(el), `<${el.localName} name=${el.getAttribute('name')}> ${now ? 'now matches' : 'no longer matches'} :autofill`); }
    }
  }, 1000);
}
// #endregion log

function reportText() {
  const p = app ? app.dom.probe() : null;
  return [
    `/qt-textfield/ log, ${new Date().toISOString()}`,
    navigator.userAgent,
    `window ${innerWidth} by ${innerHeight}, devicePixelRatio ${devicePixelRatio}, visualViewport ${Math.round(visualViewport.width)} by ${Math.round(visualViewport.height)}`,
    p ? `QML: ${p.helloQt} | ${p.helloDom} | Qt button ${p.qtButton ? 'enabled' : 'disabled'}, DOM button ${p.domButton ? 'enabled' : 'disabled'} | ${p.result}` : 'The Qt app is not loaded.',
    '', '== Qt TextField: the element Qt focuses ==', ...facts.qt, '', '== Qt TextField: events ==', ...logs.qt,
    '', '== DomTextField: the focused input ==', ...facts.dom, '', '== DomTextField: events ==', ...logs.dom,
  ].join('\n');
}
$('copy').addEventListener('click', async () => {
  const text = reportText();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* shown below */ }
  $('copied').textContent = ok ? 'Copied.' : 'Copy failed. Select the text below.';
  if (!ok) { $('copy-text').hidden = false; $('copy-text').value = text; }
});
$('clear').addEventListener('click', () => {
  for (const s of ['qt', 'dom']) { logs[s].length = 0; $(`log-${s}`).textContent = ''; }
  $('copied').textContent = '';
});

// ---------------------------------------------------------------- the app
let app = null;
$('load').addEventListener('click', async () => {
  msg.textContent = 'Loading Qt (23 MB)…';
  try {
    app = await startQtTextField($('screen'), { onExit: (exit) => { msg.hidden = false; msg.textContent = `Qt stopped${exit?.text ? `: ${exit.text}` : ''}`; } });
    msg.hidden = true;
    watch(app);
    $('state').textContent = 'The app is loaded. Tap a field and type. The tables and logs below fill in as you do.';
    app.canvas.addEventListener('webglcontextlost', () => { msg.hidden = false; msg.textContent = 'The Qt window lost its WebGL context, so the fields are not drawn. Reload the page to start the app again.'; });
  } catch (err) {
    msg.textContent = `Qt did not start: ${err.message ?? err}`;
    throw err;
  }
}, { once: true });

// ---------------------------------------------------------------- live checks
// The checks load the app a second time in a frame of its own. The frame is opened with
// ?nofocus: element.focus() in it is recorded and not run, so nothing takes focus from the page.
let frame = null;
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:360px;height:560px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.tabIndex = -1;
  f.style.cssText = 'display:block;border:0;width:360px;height:560px';
  f.src = '/qt-textfield/fixture.html?nofocus';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  const win = f.contentWindow;
  await until(() => win.__app || win.__error, 60000);
  if (!win.__app) throw new Error(win.__error ?? 'the app did not start in 60 s');
  const { dom, root, canvas } = win.__app;
  await until(() => dom.stats.uploads >= 3 && dom.probe().dom?.email.rect.w > 0, 5000);
  await sleep(300);
  frame = { holder, win, dom, root, canvas, el: (name) => dom.items[name].el };
  return frame;
}
// What Qt called focus() on, after giving a Qt TextField Qt's active focus.
async function qtFocus(field) {
  const { win, dom } = await fixture();
  dom.command('unfocus');
  await sleep(100);
  win.__focusCalls.length = 0;
  dom.command(`focus:${field}`);
  if (!await until(() => win.__focusCalls.some((el) => el.localName === 'input'), 2000)) throw new Error(`Qt did not call focus() on an input. It called it on: ${win.__focusCalls.map((el) => `<${el.localName} class="${el.className}">`).join(', ') || 'nothing'}`);
  await sleep(100);
  const el = win.__focusCalls.findLast((x) => x.localName === 'input');
  return { el, d: describe(el), p: dom.probe() };
}

const tests = [
  {
    name: 'Each DOM field is a real input with its type, name and autocomplete',
    why: 'These attributes are what the browser reads to pick a keyboard and to offer autofill. DomItem moved the inputs into Qt\'s canvas.',
    timeout: 90000,
    run: async () => {
      const { el, canvas } = await fixture();
      const out = [];
      for (const [name, want] of Object.entries({ email: ['email', 'email', null], password: ['password', 'current-password', null], code: ['text', 'one-time-code', 'numeric'] })) {
        const e = el(name);
        if (e.parentElement !== canvas) throw new Error(`${name} is not a child of Qt's canvas`);
        if (e.type !== want[0] || e.autocomplete !== want[1] || (e.getAttribute('inputmode') ?? null) !== want[2] || e.name !== name) throw new Error(`${name}: type ${e.type}, autocomplete ${e.autocomplete}, inputmode ${e.getAttribute('inputmode')}, name ${e.name}`);
        out.push(`${name}: type=${e.type} autocomplete=${e.autocomplete}${want[2] ? ` inputmode=${want[2]}` : ''} name=${e.name}`);
      }
      return `${out.join('; ')}. Each is a child of canvas.qt-window-canvas`;
    },
  },
  {
    name: 'QML writes DomTextField.text and the input\'s value changes',
    why: 'The setter of the text property assigns element.value.',
    run: async () => {
      const { dom, el } = await fixture();
      dom.command('set:domEmail', 'ada@example.com');
      if (el('email').value !== 'ada@example.com') throw new Error(`the input holds "${el('email').value}"`);
      return 'domEmail.text = "ada@example.com" in QML; input.value is "ada@example.com"';
    },
  },
  {
    name: 'Typing in the input changes DomTextField.text, a Label bound to it and a Button\'s enabled state',
    why: 'An input event makes DomItem read element.value and emit textChanged. The check sets the value and dispatches the input event that typing would.',
    run: async () => {
      const { dom, el } = await fixture();
      const type = (name, value) => { el(name).value = value; el(name).dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value })); };
      type('password', '');
      type('email', 'grace@example.com');
      const a = dom.probe();
      if (a.helloDom !== 'Hello, grace@example.com') throw new Error(`the Label reads "${a.helloDom}"`);
      if (a.domButton) throw new Error('the Button is enabled with an empty password');
      type('password', 'hunter2');
      const b = dom.probe();
      if (!b.domButton) throw new Error('the Button is still disabled');
      const before = dom.stats.uploads;
      await until(() => dom.stats.uploads > before, 1500);
      return `Label: "${a.helloDom}". Button: disabled with an empty password, enabled after one was entered. texElementSubImage2D() has run ${dom.stats.uploads} times`;
    },
  },
  {
    name: 'The browser hit tests each DOM field where Qt drew it',
    why: 'updateElementGeometry() gets the matrix from QQuickItem::itemTransform(). A tap, the caret, the IME window and the autofill popup all use this box.',
    run: async () => {
      const { dom, root, canvas, el } = await fixture();
      const p = dom.probe(), c = canvas.getBoundingClientRect(), out = [];
      for (const name of ['email', 'password', 'code']) {
        const q = p.dom[name].rect, r = el(name).getBoundingClientRect();
        const hit = root.elementFromPoint(c.x + q.x + q.w / 2, c.y + q.y + q.h / 2);
        if (hit !== el(name)) throw new Error(`${name}: the point hits <${hit?.localName}>`);
        const off = Math.hypot(r.x - (c.x + q.x), r.y - (c.y + q.y));
        if (off > 1.5) throw new Error(`${name}: the box is ${off.toFixed(1)} px from where Qt drew it`);
        out.push(`${name} at ${Math.round(q.x)}, ${Math.round(q.y)}`);
      }
      return `Qt drew ${out.join('; ')}. elementFromPoint() at each centre returns that input, and each box is within 1.5 px`;
    },
  },
  {
    name: 'A point on Qt\'s own TextField hits the canvas, not an input',
    why: 'Qt draws its TextField as pixels. The browser has no element there until Qt focuses its hidden input.',
    run: async () => {
      const { dom, root, canvas } = await fixture();
      const q = dom.probe().qt.email.rect, c = canvas.getBoundingClientRect();
      const hit = root.elementFromPoint(c.x + q.x + q.w / 2, c.y + q.y + q.h / 2);
      if (hit !== canvas) throw new Error(`the point hits <${hit?.localName}>`);
      return `the centre of the Qt email field (${Math.round(q.x + q.w / 2)}, ${Math.round(q.y + q.h / 2)}) hits <canvas class="${canvas.className}">`;
    },
  },
  {
    name: 'Qt focuses one hidden input for its TextField and sets inputmode from inputMethodHints',
    why: 'Qt.ImhEmailCharactersOnly should become inputmode="email", Qt.ImhDigitsOnly a numeric mode, and echoMode Password type="password".',
    run: async () => {
      const a = await qtFocus('qtEmail');
      const email = `${a.d.element} type=${a.d.type} inputmode=${a.d.inputmode}`;
      const b = await qtFocus('qtPassword');
      const password = `type=${b.d.type} inputmode=${b.d.inputmode}`;
      const c = await qtFocus('qtCode');
      const code = `type=${c.d.type} inputmode=${c.d.inputmode}`;
      if (a.el !== b.el || b.el !== c.el) throw new Error('Qt used different elements for its three fields');
      if (a.d.inputmode !== 'email' && !/email/.test(email)) throw new Error(`email field: ${email}`);
      return `one element for all three Qt fields. Email: ${email}. Password: ${password}. Code: ${code}. ${a.d.shadow}`;
    },
  },
  {
    name: 'Qt\'s hidden input has an autocomplete or a name attribute for autofill',
    expect: 'fail',
    why: 'Autofill and password managers read autocomplete, name, id and the label. QML\'s TextField has no property for any of them.',
    run: async () => {
      const { d, el } = await qtFocus('qtEmail');
      const have = ['autocomplete', 'name', 'id', 'aria-label'].filter((k) => el.getAttribute(k));
      if (!have.length) throw new Error(`${d.element} has no autocomplete, name, id or label. Its attributes: ${[...el.attributes].filter((x) => x.name !== 'style').map((x) => `${x.name}="${x.value}"`).join(' ')}`);
      return `it has ${have.join(', ')}`;
    },
  },
  {
    name: 'Qt\'s hidden input is at the caret of the focused TextField',
    expect: 'fail',
    why: 'The browser anchors the IME candidate window, the autofill popup and the scroll into view on the focused element\'s box.',
    run: async () => {
      const { d, p } = await qtFocus('qtCode');
      const { canvas } = await fixture();
      const c = canvas.getBoundingClientRect(), f = p.qt.code;
      const off = Math.hypot(d.rect.x - (c.x + f.cursorRect.x), d.rect.y - (c.y + f.cursorRect.y));
      if (off > 24) throw new Error(`the input's box is ${d.box}. Qt drew the caret of the code field at ${Math.round(c.x + f.cursorRect.x)}, ${Math.round(c.y + f.cursorRect.y)}: ${Math.round(off)} px away`);
      return `the input's box is ${d.box}, ${Math.round(off)} px from the caret`;
    },
  },
  {
    name: 'A focused DOM field\'s box is the field: 0 px from where Qt drew it',
    why: 'The same measurement as the row above, for the DOM email field.',
    run: async () => {
      const { dom, canvas, el } = await fixture();
      const q = dom.probe().dom.email.rect, c = canvas.getBoundingClientRect(), r = el('email').getBoundingClientRect();
      const off = Math.hypot(r.x - (c.x + q.x), r.y - (c.y + q.y));
      if (off > 1.5) throw new Error(`${off.toFixed(1)} px away`);
      return `box ${Math.round(r.width)} by ${Math.round(r.height)} px at ${Math.round(r.x)}, ${Math.round(r.y)}; Qt drew it at ${Math.round(c.x + q.x)}, ${Math.round(c.y + q.y)}`;
    },
  },
  {
    name: 'Tab in a DOM field moves Qt\'s focus to the next Qt item',
    why: 'DomItem handles the Tab keydown and asks Qt for nextItemInFocusChain(). The check dispatches the keydown.',
    run: async () => {
      const { win, dom, el } = await fixture();
      dom.command('focus:domEmail');
      await sleep(100);
      const asked = win.__focusCalls.includes(el('email'));
      win.__focusCalls.length = 0;
      el('email').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true }));
      await sleep(150);
      const p = dom.probe();
      if (!p.qt.password.activeFocus) throw new Error(`Qt's focus is on ${p.focusItem}`);
      el('password').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, composed: true, cancelable: true }));
      await sleep(150);
      const back = dom.probe();
      if (!back.qt.password.activeFocus) throw new Error(`Shift+Tab from the DOM password field: Qt's focus is on ${back.focusItem}`);
      return `Qt's Tab reached the DOM email field${asked ? ' and DomItem called focus() on the input' : ''}. Tab there gave the Qt password field Qt's focus. Shift+Tab from the DOM password field gave it back to the Qt password field`;
    },
  },
];

runTests($('results'), tests).then(() => {
  if (!frame) return;
  const { holder, canvas } = frame;
  frame = null;
  holder.remove();
  window.__gfx?.retire(canvas);
  window.__gfx?.retire(holder);
});
