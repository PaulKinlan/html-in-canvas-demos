import { banner, supported, runTests, testStage, nextPaint, stillDrawn, inkFraction } from '/shared/support.js';

banner();

const $ = (id) => document.getElementById(id);
const hasEditContext = typeof EditContext === 'function';

const INITIAL_CODE = [
  '// Wave strip config',
  'const tint = "#ff6b35";',
  'const speed = 1.4;',
  'const mode = "sine";',
  'const bars = 18;',
  '// Type here, drag, or Tab',
  '',
].join('\n');

const MODES = new Set(['sine', 'pulse', 'stripes', 'rings']);
const KEYWORDS = new Set(['const', 'let', 'var', 'return', 'if', 'else', 'function', 'true', 'false']);

// Safe pixel readback: copy into a plain off-DOM 2D canvas made with willReadFrequently.
// Never call getImageData() directly on a drawable canvas.
function readCanvasCopy(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(canvas, 0, 0);
  const img = cc.getImageData(0, 0, copy.width, copy.height);
  copy.width = 0;
  copy.height = 0;
  return img;
}

// Observe canvas backing-store size in device pixels without clearing unnecessarily.
function observeCanvasSize(canvas, onResize) {
  const apply = (w, h) => {
    const iw = Math.max(1, Math.round(w));
    const ih = Math.max(1, Math.round(h));
    if (canvas.width !== iw) canvas.width = iw;
    if (canvas.height !== ih) canvas.height = ih;
    onResize();
  };
  const ro = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const dp = entry.devicePixelContentBoxSize?.[0];
    if (dp) {
      apply(dp.inlineSize, dp.blockSize);
    } else {
      const dpr = window.devicePixelRatio || 1;
      const rect = entry.contentRect;
      apply(rect.width * dpr, rect.height * dpr);
    }
  });
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(canvas);
  }
  return ro;
}

// ---- Feature status strip ----
function renderFeatureStrip() {
  const el = $('ec-status');
  if (!el) return;
  const parts = [];
  if (hasEditContext) {
    parts.push('EditContext is available.');
  } else {
    parts.push('EditContext is not available in this browser, so text editing on the canvas is disabled.');
  }
  if (supported) {
    parts.push('drawElementImage() is available, so the inline widgets are drawn inside the canvas.');
  } else {
    parts.push('drawElementImage() is not available here, so the widgets are shown in a fallback row below.');
  }
  el.textContent = parts.join(' ');
  el.className = `status-banner ${hasEditContext && supported ? 'ok' : 'warn'}`;
}

renderFeatureStrip();

// ---- Event trace log ----
const traceLines = [];
const MAX_TRACE = 14;
const traceT0 = performance.now();

function logEvent(kind, detail) {
  const t = ((performance.now() - traceT0) / 1000).toFixed(2).padStart(6, ' ');
  traceLines.unshift(`${t}s  ${kind.padEnd(20, ' ')} ${detail}`);
  if (traceLines.length > MAX_TRACE) traceLines.length = MAX_TRACE;
  const box = $('event-trace');
  if (box) box.textContent = traceLines.join('\n');
}

// ---- Main hybrid canvas editor ----
const canvas = $('editor-canvas');
const ctx = canvas.getContext('2d');
const wColor = $('w-color');
const wSpeed = $('w-speed');
const wMode = $('w-mode');
const wInsert = $('w-insert');
const widgets = [
  { el: wColor, id: 'w-color', kind: 'color', label: '<input type="color">' },
  { el: wSpeed, id: 'w-speed', kind: 'speed', label: '<input type="range">' },
  { el: wMode, id: 'w-mode', kind: 'mode', label: '<select>' },
  { el: wInsert, id: 'w-insert', kind: 'insert', label: '<button>' },
];

// If HTML-in-canvas is unavailable, move the widgets into a visible fallback toolbar.
if (!supported) {
  const fallbackHost = $('fallback-widgets');
  if (fallbackHost) {
    fallbackHost.hidden = false;
    for (const w of widgets) fallbackHost.append(w.el);
  }
}

const state = {
  text: INITIAL_CODE,
  selStart: 23,
  selEnd: 23,
  composing: false,
  formats: [],
  scrollLines: 0,
  focused: false,
  caretVisible: true,
  blinkTimer: 0,
  paints: 0,
  phase: 0.4,
  stampCount: 0,
  dragging: false,
  dragAnchor: 0,
  contextLost: false,
  lastWidgetPos: new WeakMap(),
  controlBounds: null,
  selectionBounds: null,
};

function requestRedraw() {
  if (state.contextLost) return;
  if (supported && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  } else {
    paintEditor();
  }
}

// ---- Text layout helpers ----
function getLayoutMetrics() {
  const cssW = canvas.clientWidth || 354;
  const cssH = canvas.clientHeight || 376;
  const narrow = cssW < 500;
  const fontSize = narrow ? 12.5 : 13.5;
  const lineHeight = 34;
  const padTop = 14;
  const gutterW = narrow ? 30 : 36;
  const codeLeft = gutterW + 10;
  const previewH = 54;
  const previewPad = 12;
  const previewY = cssH - previewH - previewPad;
  const visibleLines = Math.max(1, Math.floor((previewY - 10 - padTop) / lineHeight));
  const font = `${fontSize}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
  return { cssW, cssH, narrow, fontSize, lineHeight, padTop, gutterW, codeLeft, previewH, previewPad, previewY, visibleLines, font };
}

function getLines(text) {
  const lines = text.split('\n');
  const starts = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }
  return { lines, starts };
}

function offsetToLineCol(text, offset) {
  const clamped = Math.max(0, Math.min(text.length, offset));
  const { lines, starts } = getLines(text);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (clamped >= starts[i]) return { line: i, col: clamped - starts[i], lines, starts };
  }
  return { line: 0, col: 0, lines, starts };
}

function lineColToOffset(text, lineIdx, col) {
  const { lines, starts } = getLines(text);
  const li = Math.max(0, Math.min(lines.length - 1, lineIdx));
  const c = Math.max(0, Math.min(lines[li].length, col));
  return starts[li] + c;
}

function ensureCaretVisible() {
  const { visibleLines } = getLayoutMetrics();
  const { line, lines } = offsetToLineCol(state.text, state.selEnd);
  if (line < state.scrollLines) state.scrollLines = line;
  if (line >= state.scrollLines + visibleLines) state.scrollLines = line - visibleLines + 1;
  const maxScroll = Math.max(0, lines.length - visibleLines);
  state.scrollLines = Math.max(0, Math.min(maxScroll, state.scrollLines));
}

function parseConfig(text) {
  const hexMatch = text.match(/#[0-9a-fA-F]{6}\b/);
  const speedMatch = text.match(/\bspeed\s*=\s*(-?\d+(?:\.\d+)?)/);
  const modeMatch = text.match(/\bmode\s*=\s*["']([^"']+)["']/);
  const barsMatch = text.match(/\bbars\s*=\s*(\d+)/);

  const tint = hexMatch ? hexMatch[0].toLowerCase() : '#ff6b35';
  const rawSpeed = speedMatch ? Number(speedMatch[1]) : 1.4;
  const speed = Number.isFinite(rawSpeed) ? Math.max(0.1, Math.min(6, rawSpeed)) : 1.4;
  const rawMode = modeMatch ? modeMatch[1].toLowerCase() : 'sine';
  const mode = MODES.has(rawMode) ? rawMode : 'sine';
  const rawBars = barsMatch ? parseInt(barsMatch[1], 10) : 18;
  const bars = Number.isFinite(rawBars) ? Math.max(4, Math.min(48, rawBars)) : 18;
  return { tint, speed, mode, bars };
}

function syncWidgetsFromCode() {
  const cfg = parseConfig(state.text);
  if (document.activeElement !== wColor && wColor.value.toLowerCase() !== cfg.tint) {
    wColor.value = cfg.tint;
  }
  const clampedSpeed = Math.max(0.2, Math.min(4.0, cfg.speed)).toFixed(1);
  if (document.activeElement !== wSpeed && Number(wSpeed.value).toFixed(1) !== clampedSpeed) {
    wSpeed.value = clampedSpeed;
  }
  if (document.activeElement !== wMode && wMode.value !== cfg.mode) {
    wMode.value = cfg.mode;
  }
}

// #region attach
// Attach EditContext to the drawable canvas so the browser routes text input
// and IME composition to our buffer without creating a hidden textarea.
let editContext = null;

if (hasEditContext) {
  editContext = new EditContext({
    text: state.text,
    selectionStart: state.selStart,
    selectionEnd: state.selEnd,
  });
  canvas.editContext = editContext;

  editContext.addEventListener('textupdate', (e) => {
    state.text = editContext.text;
    state.selStart = e.selectionStart;
    state.selEnd = e.selectionEnd;
    state.phase += 0.25;
    ensureCaretVisible();
    syncWidgetsFromCode();
    syncBounds();
    updateReadout();
    logEvent(
      'textupdate',
      `[${e.updateRangeStart}..${e.updateRangeEnd}] ${JSON.stringify(e.text)} -> sel ${e.selectionStart}..${e.selectionEnd}`
    );
    resetBlink();
    requestRedraw();
  });

  editContext.addEventListener('textformatupdate', (e) => {
    const fmts = typeof e.getTextFormats === 'function' ? e.getTextFormats() : [];
    state.formats = fmts.map((f) => ({
      rangeStart: f.rangeStart,
      rangeEnd: f.rangeEnd,
      underlineStyle: f.underlineStyle || 'solid',
      underlineThickness: f.underlineThickness || 'thin',
    }));
    logEvent('textformatupdate', `${state.formats.length} format range(s)`);
    requestRedraw();
  });

  editContext.addEventListener('compositionstart', () => {
    state.composing = true;
    updateReadout();
    logEvent('compositionstart', `at offset ${state.selStart}`);
    requestRedraw();
  });

  editContext.addEventListener('compositionend', () => {
    state.composing = false;
    state.formats = [];
    updateReadout();
    logEvent('compositionend', `at offset ${state.selEnd}`);
    requestRedraw();
  });

  editContext.addEventListener('characterboundsupdate', (e) => {
    const rects = computeCharacterBounds(e.rangeStart, e.rangeEnd);
    editContext.updateCharacterBounds(e.rangeStart, rects);
    logEvent('characterbounds', `[${e.rangeStart}..${e.rangeEnd}] (${rects.length} rects)`);
  });
}
// #endregion attach

// #region bounds
// Report the canvas box, the caret box, and per-character boxes in viewport
// coordinates so the OS places IME candidate windows next to the caret.
function measurePrefixWidth(lineStr, col) {
  const m = getLayoutMetrics();
  ctx.save();
  ctx.font = m.font;
  const w = ctx.measureText(lineStr.slice(0, col)).width;
  ctx.restore();
  return w;
}

function caretCssRect() {
  const m = getLayoutMetrics();
  const { line, col, lines } = offsetToLineCol(state.text, state.selEnd);
  const row = line - state.scrollLines;
  const x = m.codeLeft + measurePrefixWidth(lines[line] ?? '', col);
  const y = m.padTop + Math.max(0, row) * m.lineHeight + 5;
  let w = 2;
  if (state.selStart !== state.selEnd) {
    const startInfo = offsetToLineCol(state.text, state.selStart);
    if (startInfo.line === line) {
      const x0 = m.codeLeft + measurePrefixWidth(lines[line] ?? '', startInfo.col);
      w = Math.max(2, Math.abs(x - x0));
      return { x: Math.min(x, x0), y, w, h: m.lineHeight - 10 };
    }
  }
  return { x, y, w, h: m.lineHeight - 10 };
}

function syncBounds() {
  if (!editContext) return;
  const rect = canvas.getBoundingClientRect();
  const controlRect = new DOMRect(rect.left, rect.top, rect.width, rect.height);
  const c = caretCssRect();
  const selRect = new DOMRect(rect.left + c.x, rect.top + c.y, c.w, c.h);
  editContext.updateControlBounds(controlRect);
  editContext.updateSelectionBounds(selRect);
  state.controlBounds = controlRect;
  state.selectionBounds = selRect;
  const el = $('bounds-readout');
  if (el) {
    el.textContent =
      `controlBounds: ${Math.round(controlRect.x)},${Math.round(controlRect.y)} ${Math.round(controlRect.width)}x${Math.round(controlRect.height)} | ` +
      `selectionBounds: ${Math.round(selRect.x)},${Math.round(selRect.y)} ${Math.round(selRect.width)}x${Math.round(selRect.height)}`;
  }
}

function computeCharacterBounds(rangeStart, rangeEnd) {
  const m = getLayoutMetrics();
  const rect = canvas.getBoundingClientRect();
  const { lines, starts } = getLines(state.text);
  const out = [];
  ctx.save();
  ctx.font = m.font;
  for (let i = rangeStart; i < rangeEnd; i++) {
    let li = 0;
    for (let k = lines.length - 1; k >= 0; k--) {
      if (i >= starts[k]) { li = k; break; }
    }
    const lineStr = lines[li] ?? '';
    const col = Math.max(0, i - starts[li]);
    const row = li - state.scrollLines;
    const x0 = m.codeLeft + ctx.measureText(lineStr.slice(0, col)).width;
    const x1 = col < lineStr.length
      ? m.codeLeft + ctx.measureText(lineStr.slice(0, col + 1)).width
      : x0 + 7;
    const y = m.padTop + row * m.lineHeight + 5;
    out.push(new DOMRect(rect.left + x0, rect.top + y, Math.max(1, x1 - x0), m.lineHeight - 10));
  }
  ctx.restore();
  return out;
}
// #endregion bounds

// ---- Programmatic buffer edits & selection helpers ----
function setSelection(start, end, source) {
  const len = state.text.length;
  state.selStart = Math.max(0, Math.min(len, start));
  state.selEnd = Math.max(0, Math.min(len, end));
  if (editContext) {
    editContext.updateSelection(state.selStart, state.selEnd);
  }
  ensureCaretVisible();
  syncBounds();
  updateReadout();
  if (source) logEvent(source, `sel ${state.selStart}..${state.selEnd}`);
  resetBlink();
  requestRedraw();
}

function applyProgrammaticEdit(rangeStart, rangeEnd, newText, source) {
  const lo = Math.max(0, Math.min(state.text.length, rangeStart));
  const hi = Math.max(lo, Math.min(state.text.length, rangeEnd));
  const delta = newText.length - (hi - lo);
  state.text = state.text.slice(0, lo) + newText + state.text.slice(hi);

  const shift = (pos) => {
    if (pos <= lo) return pos;
    if (pos >= hi) return pos + delta;
    return lo + newText.length;
  };
  state.selStart = shift(state.selStart);
  state.selEnd = shift(state.selEnd);

  if (editContext) {
    editContext.updateText(lo, hi, newText);
    editContext.updateSelection(state.selStart, state.selEnd);
  }
  state.phase += 0.35;
  ensureCaretVisible();
  syncWidgetsFromCode();
  syncBounds();
  updateReadout();
  logEvent(source, `updateText(${lo}, ${hi}, ${JSON.stringify(newText)})`);
  requestRedraw();
}

// #region sync-widgets
// Two-way binding: changing an inline drawable widget rewrites the matching
// literal in the code buffer and pushes the change into EditContext.
function replacePattern(regex, makeReplacement, fallbackLine, source) {
  const m = regex.exec(state.text);
  if (m) {
    const start = m.index;
    const end = m.index + m[0].length;
    applyProgrammaticEdit(start, end, makeReplacement(m), source);
  } else {
    applyProgrammaticEdit(0, 0, `${fallbackLine}\n`, source);
  }
}

wColor.addEventListener('input', () => {
  const hex = wColor.value.toLowerCase();
  replacePattern(/#[0-9a-fA-F]{6}\b/, () => hex, `const tint = "${hex}";`, 'widget:color');
});

wSpeed.addEventListener('input', () => {
  const val = Number(wSpeed.value).toFixed(1);
  replacePattern(/(\bspeed\s*=\s*)(-?\d+(?:\.\d+)?)/, (m) => `${m[1]}${val}`, `const speed = ${val};`, 'widget:speed');
});

wMode.addEventListener('change', () => {
  const val = wMode.value;
  replacePattern(/(\bmode\s*=\s*["'])([^"']*)(["'])/, (m) => `${m[1]}${val}${m[3]}`, `const mode = "${val}";`, 'widget:mode');
});

wInsert.addEventListener('click', () => {
  const cfg = parseConfig(state.text);
  state.stampCount += 1;
  const line = `// stamp #${state.stampCount}: ${cfg.mode} @ ${cfg.speed.toFixed(1)}`;
  const existing = /^\/\/ stamp #\d+:.*$/m.exec(state.text);
  if (existing) {
    applyProgrammaticEdit(existing.index, existing.index + existing[0].length, line, 'widget:button');
  } else {
    const prefix = state.text.endsWith('\n') ? '' : '\n';
    applyProgrammaticEdit(state.text.length, state.text.length, `${prefix}${line}`, 'widget:button');
  }
});

// Keydown routing: only intercept navigation and Enter when the canvas itself
// owns focus. Keystrokes inside an inline widget pass straight through.
canvas.addEventListener('keydown', (e) => {
  if (e.target !== canvas) {
    logEvent('keydown(child)', `${e.key} -> #${e.target.id || e.target.localName}`);
    return;
  }
  if (e.key === 'Tab') {
    logEvent('keydown(Tab)', 'leaving canvas in natural Tab order');
    return;
  }
  if (state.composing || e.isComposing || !hasEditContext) return;

  const { lines, line, col } = offsetToLineCol(state.text, state.selEnd);
  const shift = e.shiftKey;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    setSelection(0, state.text.length, 'select-all');
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const lo = Math.min(state.selStart, state.selEnd);
    const hi = Math.max(state.selStart, state.selEnd);
    applyProgrammaticEdit(lo, hi, '\n', 'keydown:Enter');
    setSelection(lo + 1, lo + 1);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const next = (!shift && state.selStart !== state.selEnd)
      ? Math.min(state.selStart, state.selEnd)
      : Math.max(0, state.selEnd - 1);
    setSelection(shift ? state.selStart : next, next);
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const next = (!shift && state.selStart !== state.selEnd)
      ? Math.max(state.selStart, state.selEnd)
      : Math.min(state.text.length, state.selEnd + 1);
    setSelection(shift ? state.selStart : next, next);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const next = line > 0 ? lineColToOffset(state.text, line - 1, col) : 0;
    setSelection(shift ? state.selStart : next, next);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = line < lines.length - 1 ? lineColToOffset(state.text, line + 1, col) : state.text.length;
    setSelection(shift ? state.selStart : next, next);
    return;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    const next = lineColToOffset(state.text, line, 0);
    setSelection(shift ? state.selStart : next, next);
    return;
  }
  if (e.key === 'End') {
    e.preventDefault();
    const next = lineColToOffset(state.text, line, (lines[line] ?? '').length);
    setSelection(shift ? state.selStart : next, next);
  }
});
// #endregion sync-widgets

// Clipboard support when the canvas itself is focused.
canvas.addEventListener('copy', (e) => {
  if (document.activeElement !== canvas) return;
  const lo = Math.min(state.selStart, state.selEnd);
  const hi = Math.max(state.selStart, state.selEnd);
  if (lo === hi) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', state.text.slice(lo, hi));
  logEvent('copy', `${hi - lo} chars`);
});

canvas.addEventListener('cut', (e) => {
  if (document.activeElement !== canvas || !hasEditContext) return;
  const lo = Math.min(state.selStart, state.selEnd);
  const hi = Math.max(state.selStart, state.selEnd);
  if (lo === hi) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', state.text.slice(lo, hi));
  applyProgrammaticEdit(lo, hi, '', 'cut');
});

canvas.addEventListener('paste', (e) => {
  if (document.activeElement !== canvas || !hasEditContext) return;
  const clip = e.clipboardData?.getData('text/plain');
  if (!clip) return;
  e.preventDefault();
  const lo = Math.min(state.selStart, state.selEnd);
  const hi = Math.max(state.selStart, state.selEnd);
  applyProgrammaticEdit(lo, hi, clip, 'paste');
  setSelection(lo + clip.length, lo + clip.length);
});

// ---- Pointer selection on the canvas (never stealing clicks from inline widgets) ----
function pointToOffset(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const m = getLayoutMetrics();
  const { lines, starts } = getLines(state.text);
  const row = Math.floor((y - m.padTop) / m.lineHeight);
  const li = Math.max(0, Math.min(lines.length - 1, state.scrollLines + Math.max(0, row)));
  const lineStr = lines[li] ?? '';
  ctx.save();
  ctx.font = m.font;
  let bestCol = lineStr.length;
  let prevX = m.codeLeft;
  for (let c = 0; c < lineStr.length; c++) {
    const nextX = m.codeLeft + ctx.measureText(lineStr.slice(0, c + 1)).width;
    if (x < (prevX + nextX) / 2) {
      bestCol = c;
      break;
    }
    prevX = nextX;
  }
  ctx.restore();
  return starts[li] + bestCol;
}

canvas.addEventListener('pointerdown', (e) => {
  // If Chromium hit-tested an inline drawable child, let that control own the interaction.
  if (e.target !== canvas) return;
  const offset = pointToOffset(e.clientX, e.clientY);
  state.dragging = true;
  state.dragAnchor = offset;
  canvas.focus({ preventScroll: true });
  setSelection(e.shiftKey ? state.selStart : offset, offset, 'pointerdown');
});

window.addEventListener('pointermove', (e) => {
  if (!state.dragging) return;
  const offset = pointToOffset(e.clientX, e.clientY);
  if (offset !== state.selEnd) {
    setSelection(state.dragAnchor, offset);
  }
});

window.addEventListener('pointerup', () => {
  state.dragging = false;
});

// ---- Focus tracking & caret blink (only active while canvas has focus) ----
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

function stopBlink() {
  if (state.blinkTimer) {
    clearInterval(state.blinkTimer);
    state.blinkTimer = 0;
  }
}

function resetBlink() {
  stopBlink();
  state.caretVisible = true;
  if (!state.focused || reducedMotion?.matches) return;
  state.blinkTimer = setInterval(() => {
    state.caretVisible = !state.caretVisible;
    requestRedraw();
  }, 530);
}

function describeActiveElement(el) {
  if (!el || el === document.body) return 'none (outside editor)';
  if (el === canvas) return '#editor-canvas (EditContext)';
  const w = widgets.find((item) => item.el === el);
  if (w) return `#${w.id} (${w.label})`;
  if (el.id === 'ce-child') return '#ce-child (contenteditable)';
  return `<${el.localName}${el.id ? '#' + el.id : ''}>`;
}

function updateReadout() {
  const focusEl = $('focus-readout');
  const caretEl = $('caret-readout');
  const imeEl = $('ime-readout');
  const paintsEl = $('paint-readout');
  if (focusEl) focusEl.textContent = describeActiveElement(document.activeElement);
  if (caretEl) {
    const { line, col } = offsetToLineCol(state.text, state.selEnd);
    caretEl.textContent = state.selStart === state.selEnd
      ? `line ${line + 1}, col ${col + 1} (offset ${state.selEnd})`
      : `sel ${Math.min(state.selStart, state.selEnd)}..${Math.max(state.selStart, state.selEnd)} (${Math.abs(state.selEnd - state.selStart)} chars)`;
  }
  if (imeEl) imeEl.textContent = state.composing ? 'composing' : 'idle';
  if (paintsEl) paintsEl.textContent = String(state.paints);
}

document.addEventListener('focusin', (e) => {
  const wasFocused = state.focused;
  state.focused = e.target === canvas;
  if (state.focused) {
    syncBounds();
    resetBlink();
  } else if (wasFocused) {
    stopBlink();
  }
  if (e.target === canvas || canvas.contains(e.target) || e.target?.id === 'ce-child') {
    logEvent('focusin', describeActiveElement(e.target));
  }
  updateReadout();
  requestRedraw();
});

document.addEventListener('focusout', (e) => {
  if (e.target === canvas) {
    state.focused = false;
    stopBlink();
    requestRedraw();
  }
  queueMicrotask(updateReadout);
});

window.addEventListener('scroll', () => {
  if (state.focused) syncBounds();
}, { passive: true });

// ---- Syntax tokeniser ----
const TOKEN_RE = /(\/\/[^\n]*)|("(?:\\.|[^"])*"|'(?:\\.|[^'])*')|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b|([{}()[\];,=]+)/g;

function drawHighlightedLine(lineStr, x, baselineY) {
  let cursor = 0;
  let drawX = x;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(lineStr))) {
    if (m.index > cursor) {
      const plain = lineStr.slice(cursor, m.index);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(plain, drawX, baselineY);
      drawX += ctx.measureText(plain).width;
    }
    const tok = m[0];
    if (m[1]) ctx.fillStyle = '#8b949e';
    else if (m[2]) ctx.fillStyle = '#7ee787';
    else if (m[3]) ctx.fillStyle = '#f2cc60';
    else if (m[4]) ctx.fillStyle = KEYWORDS.has(tok) ? '#ff8b66' : '#d2e2f2';
    else ctx.fillStyle = '#9aa8b8';
    ctx.fillText(tok, drawX, baselineY);
    drawX += ctx.measureText(tok).width;
    cursor = m.index + tok.length;
  }
  if (cursor < lineStr.length) {
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(lineStr.slice(cursor), drawX, baselineY);
  }
}

// ---- Live wave preview bar inside the editor canvas ----
function drawPreviewStrip(m, cfg) {
  const x = 12;
  const y = m.previewY;
  const w = m.cssW - 24;
  const h = m.previewH;

  ctx.fillStyle = '#0d1117';
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  // Header label inside preview strip
  ctx.font = `11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
  ctx.fillStyle = '#8b949e';
  ctx.fillText(`live preview: ${cfg.mode} | ${cfg.tint} | speed ${cfg.speed.toFixed(1)} | ${cfg.bars} bars`, x + 10, y + 15);

  // Colour swatch chip
  ctx.fillStyle = cfg.tint;
  ctx.fillRect(x + w - 22, y + 7, 12, 10);

  // Procedural bars / rings / stripes / pulse driven by parsed code values
  const plotX = x + 10;
  const plotY = y + 22;
  const plotW = Math.max(40, w - 20);
  const plotH = h - 28;
  const count = cfg.bars;
  const gap = 3;
  const barW = Math.max(2, (plotW - gap * (count - 1)) / count);

  ctx.save();
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    let amp = 0.5;
    if (cfg.mode === 'sine') {
      amp = 0.25 + 0.72 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * cfg.speed + state.phase));
    } else if (cfg.mode === 'pulse') {
      const wave = Math.sin(t * Math.PI * cfg.speed + state.phase);
      amp = 0.2 + 0.78 * Math.pow(Math.abs(wave), 2);
    } else if (cfg.mode === 'stripes') {
      amp = ((Math.floor(i * cfg.speed + state.phase * 2) % 2) === 0) ? 0.92 : 0.28;
    } else if (cfg.mode === 'rings') {
      const dist = Math.abs(t - 0.5) * 2;
      amp = 0.22 + 0.75 * (0.5 + 0.5 * Math.cos(dist * Math.PI * 2.5 * cfg.speed - state.phase));
    }
    const bh = Math.max(3, plotH * amp);
    ctx.globalAlpha = 0.45 + 0.55 * amp;
    ctx.fillStyle = cfg.tint;
    ctx.fillRect(plotX + i * (barW + gap), plotY + plotH - bh, barW, bh);
  }
  ctx.restore();
}

// #region draw-widgets
// Locate the anchor line for each inline HTML widget and draw it with explicit
// CSS dimensions so it stays sharp and hit-testable at any devicePixelRatio.
function findWidgetLine(lines, kind) {
  if (kind === 'color') return lines.findIndex((l) => /#[0-9a-fA-F]{6}\b/.test(l));
  if (kind === 'speed') return lines.findIndex((l) => /\bspeed\s*=/.test(l));
  if (kind === 'mode') return lines.findIndex((l) => /\bmode\s*=/.test(l));
  if (kind === 'insert') {
    const idx = lines.findIndex((l) => /\bbars\s*=/.test(l));
    return idx >= 0 ? idx : Math.min(4, lines.length - 1);
  }
  return -1;
}

function drawInlineWidgets(m, lines) {
  if (!supported) return;
  ctx.save();
  ctx.font = m.font;
  for (const w of widgets) {
    const lineIdx = findWidgetLine(lines, w.kind);
    const row = lineIdx - state.scrollLines;
    const el = w.el;
    const ew = el.offsetWidth;
    const eh = el.offsetHeight;
    if (lineIdx < 0 || row < 0 || row >= m.visibleLines || !ew || !eh) {
      // A drawable child that is not painted is still a Tab stop unless inert.
      el.inert = true;
      continue;
    }
    el.inert = false;
    const textW = ctx.measureText(lines[lineIdx]).width;
    const wx = Math.round(Math.min(m.cssW - ew - 10, Math.max(m.codeLeft + textW + 10, m.codeLeft + 10)));
    const wy = Math.round(m.padTop + row * m.lineHeight + (m.lineHeight - eh) / 2);

    ctx.drawElementImage(el, wx, wy, ew, eh);

    // Clear Chromium's hit-test cache whenever a widget moves to new coordinates.
    const prev = state.lastWidgetPos.get(el);
    if (!prev || prev.x !== wx || prev.y !== wy) {
      state.lastWidgetPos.set(el, { x: wx, y: wy });
      if (prev) el.dataset.hit = el.dataset.hit === '1' ? '0' : '1';
    }
  }
  ctx.restore();
}
// #endregion draw-widgets

// ---- Main 2D canvas paint ----
function paintEditor() {
  if (state.contextLost) return;
  const m = getLayoutMetrics();
  const dpr = canvas.width / m.cssW;
  const { lines, starts } = getLines(state.text);
  const cfg = parseConfig(state.text);

  ctx.reset();
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = '#141920';
  ctx.fillRect(0, 0, m.cssW, m.cssH);

  // Gutter
  ctx.fillStyle = '#10151b';
  ctx.fillRect(0, 0, m.gutterW, m.previewY - 6);
  ctx.fillStyle = '#252f3d';
  ctx.fillRect(m.gutterW, 0, 1, m.previewY - 6);

  // Active line highlight
  const caretInfo = offsetToLineCol(state.text, state.selEnd);
  const caretRow = caretInfo.line - state.scrollLines;
  if (caretRow >= 0 && caretRow < m.visibleLines) {
    ctx.fillStyle = state.focused ? 'rgba(255, 122, 77, 0.10)' : 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(m.gutterW + 1, m.padTop + caretRow * m.lineHeight, m.cssW - m.gutterW - 1, m.lineHeight);
  }

  ctx.font = m.font;
  ctx.textBaseline = 'alphabetic';

  const selLo = Math.min(state.selStart, state.selEnd);
  const selHi = Math.max(state.selStart, state.selEnd);

  // Lines, selection highlights, IME underlines
  for (let r = 0; r < m.visibleLines; r++) {
    const li = state.scrollLines + r;
    if (li >= lines.length) break;
    const lineStr = lines[li];
    const lineStart = starts[li];
    const lineEnd = lineStart + lineStr.length;
    const yTop = m.padTop + r * m.lineHeight;
    const baselineY = yTop + Math.round(m.lineHeight * 0.64);

    // Line number
    ctx.fillStyle = li === caretInfo.line && state.focused ? '#ff8b66' : '#637082';
    const numStr = String(li + 1);
    const numW = ctx.measureText(numStr).width;
    ctx.fillText(numStr, m.gutterW - numW - 6, baselineY);

    // Selection highlight on this line
    if (selHi > selLo && selHi > lineStart && selLo <= lineEnd) {
      const sCol = Math.max(0, selLo - lineStart);
      const eCol = Math.min(lineStr.length, selHi - lineStart);
      const sx0 = m.codeLeft + ctx.measureText(lineStr.slice(0, sCol)).width;
      const sx1 = m.codeLeft + ctx.measureText(lineStr.slice(0, eCol)).width + (selHi > lineEnd ? 6 : 0);
      ctx.fillStyle = state.focused ? 'rgba(255, 122, 77, 0.34)' : 'rgba(148, 163, 184, 0.22)';
      ctx.fillRect(sx0, yTop + 5, Math.max(4, sx1 - sx0), m.lineHeight - 10);
    }

    // Syntax-highlighted code text
    drawHighlightedLine(lineStr, m.codeLeft, baselineY);

    // IME composition underlines from textformatupdate
    for (const fmt of state.formats) {
      if (fmt.rangeEnd <= lineStart || fmt.rangeStart >= lineEnd) continue;
      const fStart = Math.max(0, fmt.rangeStart - lineStart);
      const fEnd = Math.min(lineStr.length, fmt.rangeEnd - lineStart);
      const ux0 = m.codeLeft + ctx.measureText(lineStr.slice(0, fStart)).width;
      const ux1 = m.codeLeft + ctx.measureText(lineStr.slice(0, fEnd)).width;
      const uy = baselineY + 4;
      ctx.save();
      ctx.strokeStyle = '#f2cc60';
      ctx.lineWidth = fmt.underlineThickness === 'thick' ? 2.5 : 1.5;
      if (fmt.underlineStyle === 'dotted') ctx.setLineDash([2, 2]);
      else if (fmt.underlineStyle === 'dashed') ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(ux0, uy);
      ctx.lineTo(ux1, uy);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Caret
  if (caretRow >= 0 && caretRow < m.visibleLines && (state.caretVisible || !state.focused)) {
    const cx = m.codeLeft + ctx.measureText((lines[caretInfo.line] ?? '').slice(0, caretInfo.col)).width;
    const cy = m.padTop + caretRow * m.lineHeight + 6;
    ctx.fillStyle = state.focused ? '#ff7a4d' : 'rgba(255, 122, 77, 0.38)';
    ctx.fillRect(Math.round(cx), cy, state.focused ? 2 : 1.5, m.lineHeight - 12);
  }

  // IME status pill in top-right corner when composing
  if (state.composing) {
    ctx.fillStyle = '#f2cc60';
    ctx.beginPath();
    ctx.roundRect(m.cssW - 58, 8, 48, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#141920';
    ctx.font = `700 11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
    ctx.fillText('IME', m.cssW - 44, 22);
  }

  // Inline drawable HTML widgets
  drawInlineWidgets(m, lines);

  // Live wave preview driven by the edited code
  drawPreviewStrip(m, cfg);
}

canvas.addEventListener('paint', () => {
  state.paints += 1;
  paintEditor();
  updateReadout();
});

canvas.addEventListener('contextlost', (e) => {
  e.preventDefault();
  state.contextLost = true;
  const note = $('canvas-lost-note');
  if (note) note.hidden = false;
  logEvent('contextlost', '2D context lost on #editor-canvas');
});

canvas.addEventListener('contextrestored', () => {
  state.contextLost = false;
  const note = $('canvas-lost-note');
  if (note) note.hidden = true;
  logEvent('contextrestored', '2D context restored');
  requestRedraw();
});

observeCanvasSize(canvas, () => {
  syncBounds();
  requestRedraw();
});

// ---- Action buttons under the editor ----
$('btn-focus-canvas')?.addEventListener('click', () => {
  canvas.focus({ preventScroll: true });
});

$('btn-reset-code')?.addEventListener('click', () => {
  state.stampCount = 0;
  applyProgrammaticEdit(0, state.text.length, INITIAL_CODE, 'reset');
  setSelection(23, 23);
});

$('btn-clear-trace')?.addEventListener('click', () => {
  traceLines.length = 0;
  const box = $('event-trace');
  if (box) box.textContent = 'Cleared. Click the canvas, type, or use an inline widget.';
});

// ---- Side-by-side comparison: drawable contenteditable child ----
const cmpCanvas = $('compare-canvas');
const cmpCtx = cmpCanvas?.getContext('2d');
const ceChild = $('ce-child');
const cmpState = { paints: 0, inputs: 0, compositions: 0 };

function updateCompareReadout() {
  const el = $('compare-readout');
  if (!el) return;
  el.textContent = `paint events: ${cmpState.paints} | input events: ${cmpState.inputs} | compositionstart: ${cmpState.compositions}`;
}

if (cmpCanvas && cmpCtx && ceChild) {
  const paintCompare = () => {
    const cssW = cmpCanvas.clientWidth || 320;
    const cssH = cmpCanvas.clientHeight || 156;
    const dpr = cmpCanvas.width / cssW;
    cmpCtx.reset();
    cmpCtx.scale(dpr, dpr);
    cmpCtx.fillStyle = '#141920';
    cmpCtx.fillRect(0, 0, cssW, cssH);
    if (supported && ceChild.offsetWidth && ceChild.offsetHeight) {
      cmpCtx.drawElementImage(ceChild, 12, 12, ceChild.offsetWidth, ceChild.offsetHeight);
    } else {
      cmpCtx.fillStyle = '#9aa8b8';
      cmpCtx.font = `13px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
      cmpCtx.fillText('drawElementImage() unavailable here.', 14, 34);
    }
  };

  cmpCanvas.addEventListener('paint', () => {
    cmpState.paints += 1;
    paintCompare();
    updateCompareReadout();
  });

  ceChild.addEventListener('input', () => {
    cmpState.inputs += 1;
    updateCompareReadout();
  });

  ceChild.addEventListener('compositionstart', () => {
    cmpState.compositions += 1;
    updateCompareReadout();
  });

  $('cmp-manual-caret')?.addEventListener('change', (e) => {
    ceChild.style.caretAnimation = e.target.checked ? 'manual' : 'auto';
    if (supported) cmpCanvas.requestPaint();
  });

  observeCanvasSize(cmpCanvas, () => {
    if (supported && typeof cmpCanvas.requestPaint === 'function') cmpCanvas.requestPaint();
    else paintCompare();
  });
  updateCompareReadout();
}

updateReadout();
syncWidgetsFromCode();

// #region live-checks
// Live checks run only after the user taps "Run these checks" (<meta name="checks" content="tap">),
// so they never steal focus or shift the page during load.
const tests = [
  {
    name: 'EditContext constructor is available',
    why: 'Checks typeof EditContext === "function" and constructs an instance.',
    run: async () => {
      if (typeof EditContext !== 'function') throw new Error('EditContext is not defined in this browser');
      const ec = new EditContext({ text: 'hello', selectionStart: 0, selectionEnd: 5 });
      if (ec.text !== 'hello' || ec.selectionEnd !== 5) {
        throw new Error(`unexpected initial state: "${ec.text}" (${ec.selectionStart}..${ec.selectionEnd})`);
      }
      return `EditContext available; text="${ec.text}", selection=${ec.selectionStart}..${ec.selectionEnd}`;
    },
  },
  {
    name: 'Assigning canvas.editContext succeeds on a layoutsubtree drawable canvas',
    why: 'Attaches an EditContext to a <canvas content="drawable" layoutsubtree tabindex="0"> fixture.',
    run: async () => {
      if (typeof EditContext !== 'function') throw new Error('EditContext unavailable');
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.tabIndex = 0;
      c.width = 240;
      c.height = 80;
      c.style.cssText = 'display:block;width:240px;height:80px';
      testStage().append(c);
      const ec = new EditContext({ text: 'alpha' });
      c.editContext = ec;
      if (c.editContext !== ec) throw new Error('canvas.editContext did not retain the EditContext');
      const attached = typeof ec.attachedElements === 'function' ? ec.attachedElements() : [];
      const hasCanvas = attached.length ? attached.includes(c) : true;
      if (!hasCanvas) throw new Error('attachedElements() did not list the canvas');
      return `attached to drawable canvas (${attached.length ? 'attachedElements() confirmed' : 'property confirmed'})`;
    },
  },
  {
    name: 'updateText(), updateSelection() and updateControlBounds() work alongside drawElementImage()',
    why: 'Draws a drawable <button> inside a canvas that has an EditContext, updates text and IME bounds, and checks drawn pixels via a plain canvas copy.',
    run: async () => {
      if (!supported) throw new Error('drawElementImage() unavailable');
      if (typeof EditContext !== 'function') throw new Error('EditContext unavailable');
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.tabIndex = 0;
      c.width = 260;
      c.height = 90;
      c.style.cssText = 'display:block;width:260px;height:90px';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Inline';
      btn.setAttribute('drawable', '');
      btn.style.cssText = 'padding:4px 10px;background:#d2491f;color:#fff;border:0;border-radius:4px';
      c.append(btn);
      testStage().append(c);

      const ec = new EditContext({ text: '' });
      c.editContext = ec;
      const g = c.getContext('2d');
      c.onpaint = () => {
        g.reset();
        g.fillStyle = '#141920';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#e6edf3';
        g.font = '14px monospace';
        g.fillText(ec.text, 10, 30);
        if (btn.offsetWidth && btn.offsetHeight) {
          g.drawElementImage(btn, 140, 12, btn.offsetWidth, btn.offsetHeight);
        }
      };

      await nextPaint(c);
      ec.updateText(0, 0, 'tint = #ff6b35');
      ec.updateSelection(7, 14);
      const r = c.getBoundingClientRect();
      ec.updateControlBounds(new DOMRect(r.left, r.top, r.width, r.height));
      ec.updateSelectionBounds(new DOMRect(r.left + 60, r.top + 16, 48, 18));
      ec.updateCharacterBounds(0, [new DOMRect(r.left + 10, r.top + 16, 8, 18)]);
      await nextPaint(c);

      if (ec.text !== 'tint = #ff6b35' || ec.selectionStart !== 7 || ec.selectionEnd !== 14) {
        throw new Error(`EditContext state mismatch: "${ec.text}" ${ec.selectionStart}..${ec.selectionEnd}`);
      }
      const img = readCanvasCopy(c);
      const ink = img ? inkFraction(img) : 0;
      if (ink < 0.05) throw new Error(`canvas looked blank after drawElementImage() (ink=${ink.toFixed(3)})`);
      return `text="${ec.text}", sel=${ec.selectionStart}..${ec.selectionEnd}, drawn ink ${(ink * 100).toFixed(0)}%`;
    },
  },
  {
    name: 'Focus moves from canvas (EditContext) to a drawable <input> child and back without dropping paint events',
    why: 'Moves focus canvas -> inline input -> canvas and confirms each transition keeps paint events firing.',
    run: async () => {
      if (!supported) throw new Error('drawElementImage() unavailable');
      if (typeof EditContext !== 'function') throw new Error('EditContext unavailable');
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.tabIndex = 0;
      c.width = 260;
      c.height = 90;
      c.style.cssText = 'display:block;width:260px;height:90px';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = 'hi';
      inp.setAttribute('aria-label', 'Inline check input');
      inp.setAttribute('drawable', '');
      inp.style.cssText = 'width:110px;height:28px';
      c.append(inp);
      testStage().append(c);

      c.editContext = new EditContext({ text: 'code' });
      const g = c.getContext('2d');
      let paints = 0;
      c.onpaint = () => {
        paints += 1;
        g.reset();
        g.fillStyle = '#141920';
        g.fillRect(0, 0, c.width, c.height);
        if (inp.offsetWidth && inp.offsetHeight) {
          g.drawElementImage(inp, 16, 20, inp.offsetWidth, inp.offsetHeight);
        }
      };

      await nextPaint(c);
      c.focus({ preventScroll: true });
      if (document.activeElement !== c) throw new Error(`expected canvas focus, got ${document.activeElement?.localName}`);

      inp.focus({ preventScroll: true });
      if (document.activeElement !== inp) throw new Error(`expected input focus, got ${document.activeElement?.localName}`);
      await nextPaint(c);

      c.focus({ preventScroll: true });
      if (document.activeElement !== c) throw new Error(`expected canvas focus on return, got ${document.activeElement?.localName}`);
      await nextPaint(c);

      c.blur();
      return `focus moved canvas -> input -> canvas cleanly; ${paints} paint events fired`;
    },
  },
  {
    name: 'Typing into an inline drawable <input> does not fire textupdate on the parent canvas EditContext',
    why: 'Focuses the inline <input>, inserts text through the editing pipeline, and verifies the parent EditContext stays untouched.',
    run: async () => {
      if (!supported) throw new Error('drawElementImage() unavailable');
      if (typeof EditContext !== 'function') throw new Error('EditContext unavailable');
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.tabIndex = 0;
      c.width = 260;
      c.height = 90;
      c.style.cssText = 'display:block;width:260px;height:90px';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = 'ab';
      inp.setAttribute('aria-label', 'Routing check input');
      inp.setAttribute('drawable', '');
      inp.style.cssText = 'width:110px;height:28px';
      c.append(inp);
      testStage().append(c);

      const ec = new EditContext({ text: 'parent' });
      c.editContext = ec;
      let parentUpdates = 0;
      ec.addEventListener('textupdate', () => { parentUpdates += 1; });

      const g = c.getContext('2d');
      c.onpaint = () => {
        g.reset();
        g.fillStyle = '#141920';
        g.fillRect(0, 0, c.width, c.height);
        if (inp.offsetWidth && inp.offsetHeight) {
          g.drawElementImage(inp, 16, 20, inp.offsetWidth, inp.offsetHeight);
        }
      };

      await nextPaint(c);
      inp.focus({ preventScroll: true });
      inp.setSelectionRange(2, 2);
      const inserted = document.execCommand('insertText', false, 'c');
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
      if (!inserted) {
        inp.value = 'abc';
        inp.dispatchEvent(new InputEvent('input', { data: 'c', inputType: 'insertText', bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 60));
      inp.blur();

      if (parentUpdates !== 0) throw new Error(`parent EditContext fired ${parentUpdates} textupdate event(s)`);
      if (ec.text !== 'parent') throw new Error(`parent EditContext text changed to "${ec.text}"`);
      if (inp.value !== 'abc') throw new Error(`inline input value was "${inp.value}", expected "abc"`);
      return `input.value="${inp.value}", parent EditContext text="${ec.text}", parent textupdate count=0`;
    },
  },
  {
    name: 'Comparison fixture: drawable contenteditable child paints inside a canvas',
    why: 'Verifies the comparison approach (<div contenteditable drawable>) paints pixels into a canvas via drawElementImage().',
    run: async () => {
      if (!supported) throw new Error('drawElementImage() unavailable');
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.width = 240;
      c.height = 80;
      c.style.cssText = 'display:block;width:240px;height:80px';
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.setAttribute('drawable', '');
      div.textContent = 'Editable child';
      div.style.cssText = 'width:200px;padding:6px;background:#1d2430;color:#fff;font:14px monospace';
      c.append(div);
      testStage().append(c);

      const g = c.getContext('2d');
      c.onpaint = () => {
        g.reset();
        if (div.offsetWidth && div.offsetHeight) {
          g.drawElementImage(div, 10, 10, div.offsetWidth, div.offsetHeight);
        }
      };
      await nextPaint(c);
      const img = readCanvasCopy(c);
      const ink = img ? inkFraction(img) : 0;
      if (ink < 0.05) throw new Error(`contenteditable fixture looked blank (ink=${ink.toFixed(3)})`);
      return `contenteditable child painted (${(ink * 100).toFixed(0)}% ink)`;
    },
  },
  stillDrawn(() => [
    {
      name: 'editor canvas',
      ink: async () => {
        const img = readCanvasCopy(canvas);
        return img ? inkFraction(img) : 0;
      },
      rescue: () => {
        const note = $('canvas-lost-note');
        if (note) note.hidden = false;
      },
    },
    ...(cmpCanvas ? [{
      name: 'comparison canvas',
      ink: async () => {
        const img = readCanvasCopy(cmpCanvas);
        return img ? inkFraction(img) : 0;
      },
    }] : []),
  ]),
];

runTests($('tests'), tests);
// #endregion live-checks
