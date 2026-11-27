import { banner, isBench, nextPaint, runTests, supported, testStage } from '/shared/support.js';

banner();

const params = new URLSearchParams(location.search);
const isWing = params.get('role') === 'wing';
if (isWing) document.body.classList.add('is-wing');

const myId = `${isWing ? 'wing' : 'hub'}-${Math.random().toString(36).slice(2, 8)}`;
const channelName = isBench ? 'hic-multi-window-bench' : 'hic-multi-window';

const stageEl = document.getElementById('demo-stage');
const stageWrap = document.getElementById('stage-wrap');
const fallbackNote = document.getElementById('fallback-note');
const plainSlot = document.getElementById('plain-fallback-slot');

const canvasA = document.getElementById('canvas-a');
const canvasB = document.getElementById('canvas-b');
const bezelGapEl = document.getElementById('bezel-gap');
const bezelLabelEl = document.getElementById('bezel-label');

const paneATitle = document.getElementById('pane-a-title');
const paneARole = document.getElementById('pane-a-role');
const paneBTitle = document.getElementById('pane-b-title');
const paneBRole = document.getElementById('pane-b-role');

const liveCard = document.getElementById('card-live');
const mirrorCard = document.getElementById('card-mirror');

const modeSplitBtn = document.getElementById('mode-split');
const modeMultiBtn = document.getElementById('mode-multi');
const openWingBtn = document.getElementById('open-wing');
const readScreensBtn = document.getElementById('read-screens');
const bezelWrap = document.getElementById('bezel-wrap');
const bezelRange = document.getElementById('bezel-range');
const bezelVal = document.getElementById('bezel-val');
const presetStraddleBtn = document.getElementById('preset-straddle');
const presetClipLeftBtn = document.getElementById('preset-clip-left');
const presetCenterBtn = document.getElementById('preset-center');
const probeEdgeBtn = document.getElementById('probe-edge');
const optOverlay = document.getElementById('opt-overlay');
const optMoveBefore = document.getElementById('opt-movebefore');
const moveBeforeWrap = document.getElementById('movebefore-wrap');

const hudAuthority = document.getElementById('hud-authority');
const hudPos = document.getElementById('hud-pos');
const hudClip = document.getElementById('hud-clip');
const hudHandoff = document.getElementById('hud-handoff');
const hudPeers = document.getElementById('hud-peers');
const topologySummary = document.getElementById('topology-summary');
const topologySvg = document.getElementById('topology-svg');
const screensOutput = document.getElementById('screens-output');
const probeOutput = document.getElementById('probe-output');

const hasMoveBefore = typeof Element !== 'undefined' && typeof Element.prototype.moveBefore === 'function';
if (!hasMoveBefore) {
  optMoveBefore.checked = false;
  optMoveBefore.disabled = true;
  moveBeforeWrap.title = 'Element.prototype.moveBefore() is not available in this browser.';
}

const ctxA = canvasA.getContext('2d');
const ctxB = canvasB.getContext('2d');

let mode = isWing ? 'multi' : 'split';
let bezelGap = Number(bezelRange.value) || 18;
let stageVisible = true;
let inFallback = false;
let screenDetails = null;
let lastHandoffRoute = hasMoveBefore ? 'ready (moveBefore)' : 'ready (state sync)';
let lastScreenRectKey = '';
let watcherRaf = 0;
let broadcastRaf = 0;
let lastBroadcastTs = 0;

// Track which card element currently sits inside each canvas.
const panes = {
  A: { id: 'A', label: 'Window A', canvas: canvasA, ctx: ctxA, cardEl: liveCard, lastDrawKey: '' },
  B: { id: 'B', label: 'Window B', canvas: canvasB, ctx: ctxB, cardEl: mirrorCard, lastDrawKey: '' },
};

// Peer windows discovered over BroadcastChannel in multi-window mode.
const peers = new Map();

const state = {
  rev: 1,
  authoritySplit: 'A', // 'A' or 'B' in split-bezel mode
  authorityMulti: myId, // window id in multi-window mode
  cardX: 60,
  cardY: 46,
  text: 'Across the bezel',
  selStart: 16,
  selEnd: 16,
  hue: 18,
  clicks: 0,
  dragging: false,
  handoffCount: 0,
  hasInitializedPos: false,
};

let channel = null;
let channelOpen = false;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel(channelName);
    channelOpen = true;
  } catch {
    channel = null;
    channelOpen = false;
  }
}

function safePost(ch, open, msg) {
  if (!ch || !open) return false;
  try {
    ch.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

function sendBroadcast(msg) {
  return safePost(channel, channelOpen, msg);
}

function getCardFields(card) {
  return {
    badge: card.querySelector('[data-role="badge"]'),
    text: card.querySelector('[data-role="text"]'),
    hue: card.querySelector('[data-role="hue"]'),
    hueOut: card.querySelector('[data-role="hue-out"]'),
    ping: card.querySelector('[data-role="ping"]'),
    clipPill: card.querySelector('[data-role="clip-pill"]'),
  };
}

function getCardSize() {
  const activeCard = getAuthoritativeCard();
  const compactSplit = mode === 'split' && window.innerWidth <= 540;
  const w = activeCard.offsetWidth || (compactSplit ? 156 : 256);
  const h = activeCard.offsetHeight || (compactSplit ? 186 : 194);
  return { w, h };
}

function getAuthoritativeCard() {
  if (mode === 'split') return panes[state.authoritySplit].cardEl;
  return panes.A.cardEl;
}

function isThisWindowAuthority() {
  return mode === 'split' || state.authorityMulti === myId;
}

// #region projection
function getMyScreenViewRect() {
  const rect = canvasA.getBoundingClientRect();
  const widthDiff = Math.max(0, Math.round(window.outerWidth - window.innerWidth));
  // On macOS, a wide horizontal chrome delta (>16 px) is typically a left vertical-tab sidebar rather than symmetric borders.
  const chromeLeft = widthDiff > 16 && /Mac/i.test(navigator.userAgent)
    ? widthDiff
    : Math.round(widthDiff / 2);
  const chromeTop = Math.max(0, Math.round(window.outerHeight - window.innerHeight));
  return {
    x: Math.round(window.screenX + chromeLeft + rect.left),
    y: Math.round(window.screenY + chromeTop + rect.top),
    w: Math.max(1, Math.round(rect.width)),
    h: Math.max(1, Math.round(rect.height)),
  };
}

function getSplitPaneRects() {
  const wA = Math.max(1, canvasA.clientWidth);
  const hA = Math.max(1, canvasA.clientHeight);
  const wB = Math.max(1, canvasB.clientWidth);
  const hB = Math.max(1, canvasB.clientHeight);
  return {
    A: { x: 0, y: 0, w: wA, h: hA },
    B: { x: wA + bezelGap, y: 0, w: wB, h: hB },
  };
}

function overlapFraction(cardRect, viewRect) {
  const ix = Math.max(0, Math.min(cardRect.x + cardRect.w, viewRect.x + viewRect.w) - Math.max(cardRect.x, viewRect.x));
  const iy = Math.max(0, Math.min(cardRect.y + cardRect.h, viewRect.y + viewRect.h) - Math.max(cardRect.y, viewRect.y));
  const area = cardRect.w * cardRect.h;
  return area > 0 ? (ix * iy) / area : 0;
}

function getThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: get('--bg', '#f6f4ef'),
    fg: get('--fg', '#1d1c1a'),
    muted: get('--muted', '#6b6760'),
    line: get('--line', '#ddd8cf'),
    accent: get('--accent', '#d2491f'),
    ok: get('--ok', '#1f7a3a'),
    warn: get('--warn', '#8a6100'),
    card: get('--card', '#ffffff'),
  };
}

function drawWorldGrid(ctx, view, colors) {
  const step = 40;
  const major = 120;
  const startX = Math.floor(view.x / step) * step;
  const startY = Math.floor(view.y / step) * step;

  ctx.save();
  ctx.lineWidth = 1;
  for (let gx = startX; gx <= view.x + view.w; gx += step) {
    const lx = Math.round(gx - view.x) + 0.5;
    const isMajor = gx % major === 0;
    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = isMajor ? 0.85 : 0.35;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, view.h);
    ctx.stroke();

    if (isMajor && lx > 6 && lx < view.w - 30) {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = colors.muted;
      ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`x=${gx}`, lx + 4, 13);
    }
  }
  for (let gy = startY; gy <= view.y + view.h; gy += step) {
    const ly = Math.round(gy - view.y) + 0.5;
    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = gy % major === 0 ? 0.75 : 0.3;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(view.w, ly);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEdgeClipOverlay(ctx, view, localX, localY, cardW, cardH, colors) {
  if (!optOverlay.checked) return;
  const clippedLeft = localX < 0 ? -localX : 0;
  const clippedRight = localX + cardW > view.w ? (localX + cardW) - view.w : 0;
  const clippedTop = localY < 0 ? -localY : 0;
  const clippedBottom = localY + cardH > view.h ? (localY + cardH) - view.h : 0;
  if (!clippedLeft && !clippedRight && !clippedTop && !clippedBottom) return;

  ctx.save();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);

  const y0 = Math.max(0, localY);
  const y1 = Math.min(view.h, localY + cardH);
  const x0 = Math.max(0, localX);
  const x1 = Math.min(view.w, localX + cardW);

  const drawPill = (text, px, py) => {
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = '700 10px ui-monospace, Menlo, Consolas, monospace';
    const tw = ctx.measureText(text).width + 10;
    const bx = Math.max(4, Math.min(view.w - tw - 4, px));
    const by = Math.max(18, Math.min(view.h - 20, py));
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw, 17, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, bx + 5, by + 12);
    ctx.restore();
  };

  if (clippedLeft > 0 && y1 > y0) {
    ctx.beginPath();
    ctx.moveTo(1.5, y0);
    ctx.lineTo(1.5, y1);
    ctx.stroke();
    drawPill(`CLIP L x=${localX.toFixed(1)}`, 6, Math.max(20, y0 - 20));
  }
  if (clippedRight > 0 && y1 > y0) {
    ctx.beginPath();
    ctx.moveTo(view.w - 1.5, y0);
    ctx.lineTo(view.w - 1.5, y1);
    ctx.stroke();
    drawPill(`CLIP R +${clippedRight.toFixed(1)}px`, view.w - 116, Math.max(20, y0 - 20));
  }
  if (clippedTop > 0 && x1 > x0) {
    ctx.beginPath();
    ctx.moveTo(x0, 1.5);
    ctx.lineTo(x1, 1.5);
    ctx.stroke();
  }
  if (clippedBottom > 0 && x1 > x0) {
    ctx.beginPath();
    ctx.moveTo(x0, view.h - 1.5);
    ctx.lineTo(x1, view.h - 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOffscreenIndicator(ctx, view, localX, localY, cardW, cardH, colors) {
  const dirX = localX + cardW <= 0 ? -1 : localX >= view.w ? 1 : 0;
  const dist = dirX < 0 ? Math.round(-localX - cardW) : dirX > 0 ? Math.round(localX - view.w) : Math.round(Math.abs(localY));
  const label = dirX < 0 ? `<- Card ${dist} px left` : dirX > 0 ? `Card ${dist} px right ->` : `Card ${dist} px off edge`;
  ctx.save();
  ctx.font = '600 12px ui-monospace, Menlo, Consolas, monospace';
  const tw = ctx.measureText(label).width + 18;
  const px = dirX < 0 ? 10 : dirX > 0 ? view.w - tw - 10 : Math.max(10, (view.w - tw) / 2);
  const py = Math.max(28, Math.min(view.h - 36, localY + cardH / 2 - 14));
  ctx.fillStyle = colors.card;
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px, py, tw, 28, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.muted;
  ctx.fillText(label, px + 9, py + 18);
  ctx.restore();
}

function drawPane(paneKey) {
  if (inFallback || !supported) return;
  const pane = panes[paneKey];
  const { canvas, ctx, cardEl } = pane;
  if (!ctx || !canvas.width || !canvas.height || !canvas.clientWidth || !canvas.clientHeight) return;

  const view = mode === 'split' ? getSplitPaneRects()[paneKey] : getMyScreenViewRect();
  const dpr = canvas.width / canvas.clientWidth;
  const colors = getThemeColors();
  const { w: cardW, h: cardH } = getCardSize();
  const localX = state.cardX - view.x;
  const localY = state.cardY - view.y;

  ctx.reset();
  ctx.scale(dpr, dpr);

  // Subtle background and world-aligned grid.
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawWorldGrid(ctx, view, colors);

  // World-space alignment tether from this viewport's centre to the card's centre.
  const cardCx = localX + cardW / 2;
  const cardCy = localY + cardH / 2;
  ctx.save();
  ctx.strokeStyle = `hsla(${state.hue}, 72%, 45%, 0.28)`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(view.w / 2, view.h / 2);
  ctx.lineTo(cardCx, cardCy);
  ctx.stroke();
  ctx.restore();

  const visible = localX + cardW > 0 && localX < view.w && localY + cardH > 0 && localY < view.h;
  if (visible) {
    ctx.save();
    ctx.shadowColor = state.dragging ? 'rgba(0, 0, 0, 0.26)' : 'rgba(0, 0, 0, 0.14)';
    ctx.shadowBlur = state.dragging ? 24 : 12;
    ctx.shadowOffsetY = state.dragging ? 10 : 4;
    // Always 5 arguments so scaled HiDPI contexts draw and hit-test at CSS size.
    ctx.drawElementImage(cardEl, localX, localY, cardW, cardH);
    ctx.restore();

    drawEdgeClipOverlay(ctx, view, localX, localY, cardW, cardH, colors);
  } else {
    drawOffscreenIndicator(ctx, view, localX, localY, cardW, cardH, colors);
  }
}
// #endregion projection

function requestBothPaints() {
  if (inFallback || !supported) return;
  if (canvasA.width && canvasA.height) canvasA.requestPaint();
  if (mode === 'split' && canvasB.width && canvasB.height) canvasB.requestPaint();
}

function clearHitTestCacheIfMoved() {
  const { w: cardW, h: cardH } = getCardSize();
  const activeKey = mode === 'split' ? state.authoritySplit : 'A';
  const pane = panes[activeKey];
  const view = mode === 'split' ? getSplitPaneRects()[activeKey] : getMyScreenViewRect();
  const key = `${Math.round((state.cardX - view.x) * 2)},${Math.round((state.cardY - view.y) * 2)},${cardW},${cardH}`;
  if (pane.lastDrawKey !== key) {
    pane.lastDrawKey = key;
    pane.cardEl.toggleAttribute('data-moved');
  }
}

function applyCardStyleAndValues(card, isAuth, badgeText, clippedPct) {
  card.style.setProperty('--card-hue', String(state.hue));
  card.classList.toggle('is-authority', isAuth);
  card.classList.toggle('is-mirror', !isAuth);
  card.inert = !isAuth;
  if (isAuth) card.removeAttribute('aria-hidden');
  else card.setAttribute('aria-hidden', 'true');

  const f = getCardFields(card);
  if (f.badge) f.badge.textContent = badgeText;
  if (f.text && f.text.value !== state.text) {
    f.text.value = state.text;
  }
  if (f.hue && String(f.hue.value) !== String(state.hue)) {
    f.hue.value = String(state.hue);
  }
  if (f.hueOut) f.hueOut.textContent = `${state.hue} deg`;
  if (f.ping) f.ping.textContent = `Clicks: ${state.clicks}`;
  if (f.clipPill) f.clipPill.textContent = `${clippedPct}% clipped`;

  const focusables = card.querySelectorAll('input, button');
  for (const el of focusables) {
    if (isAuth) el.removeAttribute('tabindex');
    else el.setAttribute('tabindex', '-1');
  }
}

// #region handoff
function syncDomCards() {
  const { w: cardW, h: cardH } = getCardSize();
  const cardRect = { x: state.cardX, y: state.cardY, w: cardW, h: cardH };

  if (mode === 'split') {
    const rects = getSplitPaneRects();
    const fracA = overlapFraction(cardRect, rects.A);
    const fracB = overlapFraction(cardRect, rects.B);
    const aIsAuth = state.authoritySplit === 'A';
    const clipA = Math.round((1 - fracA) * 100);
    const clipB = Math.round((1 - fracB) * 100);

    applyCardStyleAndValues(panes.A.cardEl, aIsAuth, aIsAuth ? 'LIVE A' : 'MIRROR A', clipA);
    applyCardStyleAndValues(panes.B.cardEl, !aIsAuth, !aIsAuth ? 'LIVE B' : 'MIRROR B', clipB);

    paneATitle.textContent = 'Window A (left)';
    paneARole.textContent = aIsAuth ? 'LIVE AUTHORITY' : 'PEER MIRROR';
    paneARole.className = `role-tag ${aIsAuth ? 'live' : 'mirror'}`;
    paneBTitle.textContent = 'Window B (right)';
    paneBRole.textContent = !aIsAuth ? 'LIVE AUTHORITY' : 'PEER MIRROR';
    paneBRole.className = `role-tag ${!aIsAuth ? 'live' : 'mirror'}`;
  } else {
    const view = getMyScreenViewRect();
    const frac = overlapFraction(cardRect, view);
    const isAuth = state.authorityMulti === myId;
    const clipPct = Math.round((1 - frac) * 100);
    const tag = isWing ? 'B' : 'A';
    applyCardStyleAndValues(panes.A.cardEl, isAuth, isAuth ? `LIVE ${tag}` : `MIRROR ${tag}`, clipPct);

    paneATitle.textContent = isWing ? 'Window B (wing viewport)' : 'Window A (primary viewport)';
    paneARole.textContent = isAuth ? 'LIVE AUTHORITY' : 'PEER MIRROR';
    paneARole.className = `role-tag ${isAuth ? 'live' : 'mirror'}`;
  }
}

function transferSplitAuthority(nextSide) {
  if (state.authoritySplit === nextSide) return;
  const prevSide = state.authoritySplit;
  const oldAuthCard = panes[prevSide].cardEl;
  const oldInput = getCardFields(oldAuthCard).text;
  const wasFocused = document.activeElement === oldInput;
  if (oldInput && typeof oldInput.selectionStart === 'number') {
    state.selStart = oldInput.selectionStart;
    state.selEnd = oldInput.selectionEnd;
  }

  state.authoritySplit = nextSide;
  state.handoffCount++;

  let usedMoveBefore = false;
  if (optMoveBefore.checked && hasMoveBefore && !inFallback) {
    try {
      const targetCanvas = panes[nextSide].canvas;
      const otherCanvas = panes[prevSide].canvas;
      const incomingLive = panes[prevSide].cardEl;
      const outgoingMirror = panes[nextSide].cardEl;
      targetCanvas.moveBefore(incomingLive, null);
      otherCanvas.moveBefore(outgoingMirror, null);
      panes[nextSide].cardEl = incomingLive;
      panes[prevSide].cardEl = outgoingMirror;
      usedMoveBefore = true;
      lastHandoffRoute = `moveBefore() #${state.handoffCount}`;
    } catch {
      usedMoveBefore = false;
    }
  }

  syncDomCards();

  if (!usedMoveBefore) {
    lastHandoffRoute = `state sync #${state.handoffCount}`;
    if (wasFocused) {
      const newInput = getCardFields(panes[nextSide].cardEl).text;
      if (newInput) {
        newInput.focus({ preventScroll: true });
        try { newInput.setSelectionRange(state.selStart, state.selEnd); } catch {}
      }
    }
  }
}

function evaluateAuthority() {
  const { w: cardW, h: cardH } = getCardSize();
  const cardRect = { x: state.cardX, y: state.cardY, w: cardW, h: cardH };

  if (mode === 'split') {
    const rects = getSplitPaneRects();
    const fracA = overlapFraction(cardRect, rects.A);
    const fracB = overlapFraction(cardRect, rects.B);
    if (fracA > 0.5 && state.authoritySplit !== 'A') {
      transferSplitAuthority('A');
    } else if (fracB > 0.5 && state.authoritySplit !== 'B') {
      transferSplitAuthority('B');
    }
    return;
  }

  // Multi-window mode: compare overlap across this window and all known peers.
  const myView = getMyScreenViewRect();
  let bestId = state.authorityMulti;
  let bestFrac = 0;

  const candidates = [{ id: myId, rect: myView }];
  const now = Date.now();
  for (const [peerId, info] of peers.entries()) {
    if (now - info.ts > 8000) {
      peers.delete(peerId);
      continue;
    }
    candidates.push({ id: peerId, rect: info.rect });
  }

  for (const c of candidates) {
    const frac = overlapFraction(cardRect, c.rect);
    if (frac > 0.5 && frac > bestFrac) {
      bestFrac = frac;
      bestId = c.id;
    }
  }

  if (bestId !== state.authorityMulti) {
    const wasLocal = state.authorityMulti === myId;
    const oldInput = getCardFields(panes.A.cardEl).text;
    if (wasLocal && oldInput && typeof oldInput.selectionStart === 'number') {
      state.selStart = oldInput.selectionStart;
      state.selEnd = oldInput.selectionEnd;
    }
    state.authorityMulti = bestId;
    state.handoffCount++;
    lastHandoffRoute = `BroadcastChannel #${state.handoffCount}`;
    syncDomCards();
    if (bestId === myId && !wasLocal) {
      const inp = getCardFields(panes.A.cardEl).text;
      if (inp) {
        try { inp.setSelectionRange(state.selStart, state.selEnd); } catch {}
      }
    }
    scheduleBroadcast(true);
  }
}

function buildStatePacket() {
  return {
    type: 'state',
    from: myId,
    rev: ++state.rev,
    authority: state.authorityMulti,
    cardX: state.cardX,
    cardY: state.cardY,
    text: state.text,
    selStart: state.selStart,
    selEnd: state.selEnd,
    hue: state.hue,
    clicks: state.clicks,
    dragging: state.dragging,
    handoffCount: state.handoffCount,
    ts: Date.now(),
  };
}

function scheduleBroadcast(immediate = false) {
  if (mode !== 'multi' || !channelOpen) return;
  if (immediate) {
    lastBroadcastTs = performance.now();
    sendBroadcast(buildStatePacket());
    return;
  }
  if (broadcastRaf) return;
  broadcastRaf = requestAnimationFrame(() => {
    broadcastRaf = 0;
    lastBroadcastTs = performance.now();
    sendBroadcast(buildStatePacket());
  });
}
// #endregion handoff

function updateHudAndTopology() {
  const { w: cardW, h: cardH } = getCardSize();
  const cardRect = { x: state.cardX, y: state.cardY, w: cardW, h: cardH };

  hudPos.textContent = `${state.cardX.toFixed(1)}, ${state.cardY.toFixed(1)}`;
  hudHandoff.textContent = lastHandoffRoute;

  if (mode === 'split') {
    const rects = getSplitPaneRects();
    const fracA = overlapFraction(cardRect, rects.A);
    const fracB = overlapFraction(cardRect, rects.B);
    const pctA = Math.round(fracA * 100);
    const pctB = Math.round(fracB * 100);
    hudAuthority.textContent = state.authoritySplit === 'A' ? `Window A (${pctA}% / ${pctB}%)` : `Window B (${pctB}% / ${pctA}%)`;

    const activeView = rects[state.authoritySplit];
    const lx = state.cardX - activeView.x;
    const clipMsgs = [];
    if (lx < 0) clipMsgs.push(`L ${lx.toFixed(1)} px`);
    if (lx + cardW > activeView.w) clipMsgs.push(`R +${(lx + cardW - activeView.w).toFixed(1)} px`);
    hudClip.textContent = clipMsgs.length ? clipMsgs.join(', ') : 'inside active pane';
    hudPeers.textContent = `split mode (${bezelGap} px bezel)`;
    topologySummary.textContent = `Simulated bezel: Pane A (0..${rects.A.w}) + ${bezelGap} px gap + Pane B (${rects.B.x}..${rects.B.x + rects.B.w}).`;
    renderTopologySvg([
      { label: 'Pane A', rect: rects.A, active: state.authoritySplit === 'A' },
      { label: 'Pane B', rect: rects.B, active: state.authoritySplit === 'B' },
    ], cardRect, []);
  } else {
    const myView = getMyScreenViewRect();
    const myPct = Math.round(overlapFraction(cardRect, myView) * 100);
    const ownerTag = state.authorityMulti === myId ? (isWing ? 'Window B (this)' : 'Window A (this)') : `Peer ${state.authorityMulti}`;
    hudAuthority.textContent = `${ownerTag} (${myPct}% here)`;

    const lx = state.cardX - myView.x;
    const clipMsgs = [];
    if (lx < 0) clipMsgs.push(`L ${lx.toFixed(1)} px`);
    if (lx + cardW > myView.w) clipMsgs.push(`R +${(lx + cardW - myView.w).toFixed(1)} px`);
    hudClip.textContent = clipMsgs.length ? clipMsgs.join(', ') : 'inside viewport';
    hudPeers.textContent = `${peers.size} peer window${peers.size === 1 ? '' : 's'} connected`;

    const views = [{ label: isWing ? 'Window B' : 'Window A', rect: myView, active: state.authorityMulti === myId }];
    for (const [peerId, info] of peers.entries()) {
      views.push({ label: info.role === 'wing' ? 'Window B' : 'Window A', rect: info.rect, active: state.authorityMulti === peerId });
    }
    const screens = screenDetails
      ? screenDetails.screens.map((s) => ({ label: s.label || 'Screen', rect: { x: s.left, y: s.top, w: s.width, h: s.height } }))
      : [{ label: 'Screen', rect: { x: screen.availLeft || 0, y: screen.availTop || 0, w: screen.width, h: screen.height } }];

    topologySummary.textContent = `Desktop screen space: this canvas at (${myView.x}, ${myView.y}) ${myView.w}×${myView.h}.`;
    renderTopologySvg(views, cardRect, screens);
  }
}

function renderTopologySvg(views, cardRect, screens) {
  const all = [...screens.map((s) => s.rect), ...views.map((v) => v.rect), cardRect];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of all) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const pad = 16;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const svgW = 600;
  const svgH = 92;
  const scale = Math.min((svgW - pad * 2) / worldW, (svgH - pad * 2) / worldH);
  const ox = (svgW - worldW * scale) / 2 - minX * scale;
  const oy = (svgH - worldH * scale) / 2 - minY * scale;

  const mapX = (x) => (x * scale + ox).toFixed(1);
  const mapY = (y) => (y * scale + oy).toFixed(1);
  const mapS = (v) => Math.max(2, v * scale).toFixed(1);

  const parts = [];
  for (const s of screens) {
    parts.push(`<rect x="${mapX(s.rect.x)}" y="${mapY(s.rect.y)}" width="${mapS(s.rect.w)}" height="${mapS(s.rect.h)}" rx="4" fill="none" stroke="var(--line)" stroke-dasharray="4 3" />`);
  }
  for (const v of views) {
    const stroke = v.active ? 'var(--ok)' : 'var(--muted)';
    const fill = v.active ? 'color-mix(in srgb, var(--ok) 12%, transparent)' : 'color-mix(in srgb, var(--muted) 8%, transparent)';
    parts.push(`<rect x="${mapX(v.rect.x)}" y="${mapY(v.rect.y)}" width="${mapS(v.rect.w)}" height="${mapS(v.rect.h)}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`);
    parts.push(`<text x="${(Number(mapX(v.rect.x)) + 5).toFixed(1)}" y="${(Number(mapY(v.rect.y)) + 13).toFixed(1)}" fill="var(--muted)" font-size="10" font-family="var(--mono)">${v.label}</text>`);
  }
  parts.push(`<rect x="${mapX(cardRect.x)}" y="${mapY(cardRect.y)}" width="${mapS(cardRect.w)}" height="${mapS(cardRect.h)}" rx="3" fill="hsl(${state.hue} 72% 45% / 0.35)" stroke="hsl(${state.hue} 72% 45%)" stroke-width="2" />`);

  topologySvg.innerHTML = parts.join('');
}

function updateAll(broadcast = false) {
  evaluateAuthority();
  syncDomCards();
  clearHitTestCacheIfMoved();
  updateHudAndTopology();
  requestBothPaints();
  if (broadcast) scheduleBroadcast(false);
}

// Keep liveCard back in canvasA when entering multi-window mode.
function ensureLiveCardInCanvasA() {
  if (panes.A.cardEl === liveCard) return;
  if (hasMoveBefore) {
    try {
      canvasA.moveBefore(liveCard, null);
      canvasB.moveBefore(mirrorCard, null);
    } catch {
      canvasA.append(liveCard);
      canvasB.append(mirrorCard);
    }
  } else {
    canvasA.append(liveCard);
    canvasB.append(mirrorCard);
  }
  panes.A.cardEl = liveCard;
  panes.B.cardEl = mirrorCard;
  state.authoritySplit = 'A';
}

function setMode(nextMode, { reposition = true } = {}) {
  if (mode === nextMode && state.hasInitializedPos) return;
  mode = nextMode;
  stageWrap.classList.toggle('is-multi', mode === 'multi');
  modeSplitBtn.setAttribute('aria-pressed', String(mode === 'split'));
  modeMultiBtn.setAttribute('aria-pressed', String(mode === 'multi'));
  bezelWrap.hidden = mode === 'multi';
  moveBeforeWrap.hidden = mode === 'multi';

  if (mode === 'multi') {
    ensureLiveCardInCanvasA();
    // Free hidden pane B's backing store to keep GPU memory low.
    if (canvasB.width !== 0) canvasB.width = 0;
    if (canvasB.height !== 0) canvasB.height = 0;
    const view = getMyScreenViewRect();
    if (reposition && (!isWing || !peers.size)) {
      const { w: cardW, h: cardH } = getCardSize();
      state.cardX = Math.round(view.x + Math.max(12, (view.w - cardW) / 2));
      state.cardY = Math.round(view.y + Math.max(16, (view.h - cardH) / 2));
      state.authorityMulti = myId;
    }
    sendBroadcast({ type: 'hello', from: myId, role: isWing ? 'wing' : 'hub', rect: view, ts: Date.now() });
    if (isWing) sendBroadcast({ type: 'request-state', from: myId });
    startScreenWatcher();
  } else {
    stopScreenWatcher();
    if (reposition) snapStraddleBezel();
  }
  state.hasInitializedPos = true;
  updateAll(mode === 'multi');
}

function snapStraddleBezel() {
  const { w: cardW, h: cardH } = getCardSize();
  if (mode === 'split') {
    const rects = getSplitPaneRects();
    // Place slightly left of exact 50% (Window A starts with authority) straddling the bezel gap.
    state.cardX = Math.round((rects.A.w + bezelGap / 2 - cardW / 2) - 8);
    state.cardY = Math.round(Math.max(18, (rects.A.h - cardH) / 2));
  } else {
    const myView = getMyScreenViewRect();
    const firstPeer = peers.values().next().value;
    if (firstPeer) {
      const leftRect = myView.x <= firstPeer.rect.x ? myView : firstPeer.rect;
      const rightRect = myView.x <= firstPeer.rect.x ? firstPeer.rect : myView;
      const seamX = (leftRect.x + leftRect.w + rightRect.x) / 2;
      state.cardX = Math.round(seamX - cardW / 2 - 6);
      // Centre vertically in the overlapping Y band of both canvases when they overlap vertically.
      const bandTop = Math.max(leftRect.y, rightRect.y);
      const bandBottom = Math.min(leftRect.y + leftRect.h, rightRect.y + rightRect.h);
      if (bandBottom - bandTop >= 40) {
        state.cardY = Math.round((bandTop + bandBottom) / 2 - cardH / 2);
      } else {
        state.cardY = Math.round(Math.max(myView.y + 18, (myView.y + myView.h / 2) - cardH / 2));
      }
    } else {
      state.cardX = Math.round(myView.x + myView.w - cardW / 2);
      state.cardY = Math.round(myView.y + Math.max(18, (myView.h - cardH) / 2));
    }
  }
  updateAll(true);
}

function snapClipLeft() {
  const { w: cardW, h: cardH } = getCardSize();
  const view = mode === 'split' ? getSplitPaneRects().A : getMyScreenViewRect();
  // Half-pixel offset (-cardW/2 - 0.5) makes sub-pixel edge clipping easy to inspect.
  state.cardX = view.x - Math.round(cardW / 2) + 0.5;
  state.cardY = Math.round(view.y + Math.max(18, (view.h - cardH) / 2));
  updateAll(true);
}

function snapCenter() {
  const { w: cardW, h: cardH } = getCardSize();
  const view = mode === 'split' ? getSplitPaneRects().A : getMyScreenViewRect();
  state.cardX = Math.round(view.x + Math.max(8, (view.w - cardW) / 2));
  state.cardY = Math.round(view.y + Math.max(18, (view.h - cardH) / 2));
  updateAll(true);
}

// ---- Pointer dragging (captured on stationary stageWrap so handoff never breaks drag) ----
let dragPointerId = null;
let grabOffsetX = 0;
let grabOffsetY = 0;

function pointerToWorld(e) {
  const rectA = canvasA.getBoundingClientRect();
  if (mode === 'split') {
    return {
      x: e.clientX - rectA.left,
      y: e.clientY - rectA.top,
    };
  }
  const view = getMyScreenViewRect();
  return {
    x: view.x + (e.clientX - rectA.left),
    y: view.y + (e.clientY - rectA.top),
  };
}

stageWrap.addEventListener('pointerdown', (e) => {
  if (inFallback || !supported) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('input, button, select, textarea, a, label')) return;

  const pt = pointerToWorld(e);
  const { w: cardW, h: cardH } = getCardSize();
  const insideCard =
    pt.x >= state.cardX - 12 &&
    pt.x <= state.cardX + cardW + 12 &&
    pt.y >= state.cardY - 12 &&
    pt.y <= state.cardY + cardH + 12;

  dragPointerId = e.pointerId;
  state.dragging = true;
  canvasA.classList.add('is-dragging');
  canvasB.classList.add('is-dragging');

  if (insideCard) {
    grabOffsetX = pt.x - state.cardX;
    grabOffsetY = pt.y - state.cardY;
  } else {
    grabOffsetX = cardW / 2;
    grabOffsetY = cardH / 2;
    state.cardX = pt.x - grabOffsetX;
    state.cardY = pt.y - grabOffsetY;
  }

  try { stageWrap.setPointerCapture(e.pointerId); } catch {}
  updateAll(true);
});

stageWrap.addEventListener('pointermove', (e) => {
  if (dragPointerId !== e.pointerId) return;
  const pt = pointerToWorld(e);
  const { w: cardW, h: cardH } = getCardSize();
  let nx = pt.x - grabOffsetX;
  let ny = pt.y - grabOffsetY;

  if (mode === 'split') {
    const rects = getSplitPaneRects();
    const maxX = rects.B.x + rects.B.w - 16;
    const minX = -cardW + 16;
    const maxY = Math.max(rects.A.h, rects.B.h) - 24;
    nx = Math.max(minX, Math.min(maxX, nx));
    ny = Math.max(-cardH + 28, Math.min(maxY, ny));
  }

  state.cardX = nx;
  state.cardY = ny;
  updateAll(true);
});

function endDrag(e) {
  if (dragPointerId !== e.pointerId) return;
  dragPointerId = null;
  state.dragging = false;
  canvasA.classList.remove('is-dragging');
  canvasB.classList.remove('is-dragging');
  try { stageWrap.releasePointerCapture(e.pointerId); } catch {}
  updateAll(true);
}

stageWrap.addEventListener('pointerup', endDrag);
stageWrap.addEventListener('pointercancel', endDrag);

// ---- Card form event bindings (attached to both liveCard and mirrorCard) ----
function bindCardEvents(card) {
  card.addEventListener('submit', (e) => e.preventDefault());
  const f = getCardFields(card);
  f.text.addEventListener('input', () => {
    if (card.inert) return;
    state.text = f.text.value;
    state.selStart = f.text.selectionStart ?? state.text.length;
    state.selEnd = f.text.selectionEnd ?? state.text.length;
    syncDomCards();
    requestBothPaints();
    scheduleBroadcast(false);
  });
  f.text.addEventListener('select', () => {
    if (card.inert) return;
    state.selStart = f.text.selectionStart ?? 0;
    state.selEnd = f.text.selectionEnd ?? 0;
  });
  f.hue.addEventListener('input', () => {
    if (card.inert) return;
    state.hue = Number(f.hue.value);
    syncDomCards();
    updateHudAndTopology();
    requestBothPaints();
    scheduleBroadcast(false);
  });
  f.ping.addEventListener('click', () => {
    if (card.inert) return;
    state.clicks++;
    syncDomCards();
    requestBothPaints();
    scheduleBroadcast(true);
  });
}

bindCardEvents(liveCard);
bindCardEvents(mirrorCard);

// ---- BroadcastChannel listener ----
if (channel) {
  channel.onmessage = (e) => {
    const msg = e.data;
    if (!msg || msg.from === myId) return;

    if (msg.type === 'hello' || msg.type === 'peer-rect') {
      const isNewPeer = !peers.has(msg.from);
      peers.set(msg.from, { role: msg.role || 'peer', rect: msg.rect, ts: Date.now() });

      // If a wing window just connected while we are in split mode, switch into multi-window mode so both windows align immediately.
      if (isNewPeer && mode === 'split' && !isWing) {
        setMode('multi', { reposition: false });
        snapStraddleBezel();
      }
      if (msg.type === 'hello') {
        sendBroadcast({ type: 'peer-rect', from: myId, role: isWing ? 'wing' : 'hub', rect: getMyScreenViewRect(), ts: Date.now() });
        if (isThisWindowAuthority()) sendBroadcast(buildStatePacket());
      }
      updateAll(false);
      return;
    }

    if (msg.type === 'request-state') {
      if (isThisWindowAuthority() || !isWing) {
        sendBroadcast({ type: 'peer-rect', from: myId, role: isWing ? 'wing' : 'hub', rect: getMyScreenViewRect(), ts: Date.now() });
        sendBroadcast(buildStatePacket());
      }
      return;
    }

    if (msg.type === 'bye') {
      peers.delete(msg.from);
      if (state.authorityMulti === msg.from) {
        state.authorityMulti = myId;
      }
      updateAll(false);
      return;
    }

    if (msg.type === 'state') {
      if (mode !== 'multi') return;
      state.rev = Math.max(state.rev, msg.rev || 0);
      state.authorityMulti = msg.authority || state.authorityMulti;
      state.cardX = msg.cardX;
      state.cardY = msg.cardY;
      state.text = msg.text ?? state.text;
      state.selStart = msg.selStart ?? state.selStart;
      state.selEnd = msg.selEnd ?? state.selEnd;
      state.hue = msg.hue ?? state.hue;
      state.clicks = msg.clicks ?? state.clicks;
      state.dragging = Boolean(msg.dragging);
      state.handoffCount = Math.max(state.handoffCount, msg.handoffCount || 0);
      lastHandoffRoute = `BroadcastChannel #${state.handoffCount}`;
      syncDomCards();
      clearHitTestCacheIfMoved();
      updateHudAndTopology();
      requestBothPaints();
    }
  };
}

// ---- Multi-window screen-coordinate watcher (only active in multi-window mode while visible) ----
function pollWindowRect() {
  watcherRaf = 0;
  if (mode !== 'multi' || !stageVisible || document.hidden) return;
  const view = getMyScreenViewRect();
  const key = `${view.x},${view.y},${view.w},${view.h}`;
  const now = performance.now();
  if (key !== lastScreenRectKey || now - lastBroadcastTs > 1500) {
    lastScreenRectKey = key;
    lastBroadcastTs = now;
    sendBroadcast({ type: 'peer-rect', from: myId, role: isWing ? 'wing' : 'hub', rect: view, ts: Date.now() });
    updateAll(false);
  }
  watcherRaf = requestAnimationFrame(pollWindowRect);
}

function startScreenWatcher() {
  if (watcherRaf || mode !== 'multi' || !stageVisible || document.hidden) return;
  watcherRaf = requestAnimationFrame(pollWindowRect);
}

function stopScreenWatcher() {
  if (watcherRaf) {
    cancelAnimationFrame(watcherRaf);
    watcherRaf = 0;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScreenWatcher();
  else if (mode === 'multi') startScreenWatcher();
});

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver((entries) => {
    stageVisible = Boolean(entries[0]?.isIntersecting);
    if (stageVisible && mode === 'multi') startScreenWatcher();
    else stopScreenWatcher();
  }, { threshold: 0.05 }).observe(stageEl);
}

// ---- Canvas paint handlers, ResizeObserver and context-loss fallback ----
canvasA.addEventListener('paint', () => drawPane('A'));
canvasB.addEventListener('paint', () => drawPane('B'));

function observeCanvas(canvas, paneKey) {
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      let w = 0;
      let h = 0;
      if (entry.devicePixelContentBoxSize?.[0]) {
        w = Math.round(entry.devicePixelContentBoxSize[0].inlineSize);
        h = Math.round(entry.devicePixelContentBoxSize[0].blockSize);
      } else {
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        w = Math.round(r.width * dpr);
        h = Math.round(r.height * dpr);
      }
      if (w > 0 && h > 0) {
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        if (!state.hasInitializedPos && paneKey === 'A') {
          state.hasInitializedPos = true;
          if (mode === 'split') snapStraddleBezel();
          else snapCenter();
        } else {
          updateAll(false);
        }
      }
    }
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); }
  catch { ro.observe(canvas); }
}

observeCanvas(canvasA, 'A');
observeCanvas(canvasB, 'B');

function enterPlainFallback(reason) {
  inFallback = true;
  stopScreenWatcher();
  fallbackNote.textContent = reason;
  stageEl.classList.add('is-plain');
  liveCard.inert = false;
  liveCard.removeAttribute('aria-hidden');
  liveCard.classList.add('is-authority');
  liveCard.classList.remove('is-mirror');
  plainSlot.append(liveCard);
}

function exitPlainFallback() {
  if (!inFallback || !supported) return;
  inFallback = false;
  stageEl.classList.remove('is-plain');
  canvasA.append(liveCard);
  panes.A.cardEl = liveCard;
  if (mode === 'multi') startScreenWatcher();
  updateAll(false);
}

for (const c of [canvasA, canvasB]) {
  c.addEventListener('contextlost', (e) => {
    e.preventDefault();
    enterPlainFallback('A 2D canvas lost its context, so the card switched to plain HTML.');
  });
  c.addEventListener('contextrestored', () => exitPlainFallback());
}

if (!supported) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the form card is shown as plain HTML below.');
}

// ---- Toolbar controls ----
modeSplitBtn.addEventListener('click', () => setMode('split', { reposition: true }));
modeMultiBtn.addEventListener('click', () => setMode('multi', { reposition: true }));

bezelRange.addEventListener('input', () => {
  bezelGap = Number(bezelRange.value);
  bezelVal.textContent = `${bezelGap} px`;
  bezelGapEl.style.flexBasis = `${bezelGap}px`;
  bezelGapEl.style.width = `${bezelGap}px`;
  bezelLabelEl.textContent = bezelGap >= 14 ? `${bezelGap}px` : '';
  updateAll(false);
});

presetStraddleBtn.addEventListener('click', snapStraddleBezel);
presetClipLeftBtn.addEventListener('click', snapClipLeft);
presetCenterBtn.addEventListener('click', snapCenter);
optOverlay.addEventListener('change', () => requestBothPaints());

openWingBtn.addEventListener('click', () => {
  const w = Math.min(620, Math.max(480, Math.round(window.outerWidth * 0.55)));
  const h = Math.min(820, Math.max(560, Math.round(window.outerHeight * 0.9)));
  let left = window.screenX + window.outerWidth + 8;
  let top = window.screenY;

  if (screenDetails?.screens?.length > 1) {
    const other = screenDetails.screens.find((s) => s !== screenDetails.currentScreen);
    if (other) {
      left = other.availLeft + 24;
      top = other.availTop + 24;
    }
  } else {
    const availRight = (screen.availLeft || 0) + screen.availWidth;
    if (left + w > availRight) {
      left = Math.max(screen.availLeft || 0, availRight - w - 12);
    }
  }

  // Use noopener so the popup starts with a clean sessionStorage and does not inherit
  // this window's context-guard heartbeat (which otherwise looks like a crashed tab).
  window.open(
    '/multi-window/?role=wing',
    '_blank',
    `popup,noopener,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`
  );
  screensOutput.textContent = 'Opened Window B (waiting for BroadcastChannel handshake; allow popups if nothing appeared).';
  setMode('multi', { reposition: false });
});

readScreensBtn.addEventListener('click', async () => {
  if (typeof window.getScreenDetails !== 'function') {
    screensOutput.textContent = 'window.getScreenDetails() is not available here. Using window.screenX/Y and screen.width/height.';
    return;
  }
  try {
    screenDetails = await window.getScreenDetails();
    const list = screenDetails.screens.map((s, idx) =>
      `#${idx + 1} ${s.label || 'Display'}: (${s.left}, ${s.top}) ${s.width}×${s.height} @${s.devicePixelRatio}x${s.isPrimary ? ' [primary]' : ''}`
    );
    screensOutput.textContent = `${screenDetails.screens.length} display${screenDetails.screens.length === 1 ? '' : 's'} detected: ${list.join(' | ')}`;
    screenDetails.addEventListener('screenschange', () => updateHudAndTopology());
    screenDetails.addEventListener('currentscreenchange', () => updateHudAndTopology());
    updateHudAndTopology();
  } catch (err) {
    screensOutput.textContent = `getScreenDetails() denied or failed: ${err?.message ?? err}`;
  }
});

// #region edge-probe
function sampleEdgePixels() {
  if (inFallback || !supported) {
    probeOutput.textContent = 'Edge probe needs an active drawable canvas.';
    return;
  }
  const activeKey = mode === 'split' ? state.authoritySplit : 'A';
  const canvas = panes[activeKey].canvas;
  const view = mode === 'split' ? getSplitPaneRects()[activeKey] : getMyScreenViewRect();
  const { w: cardW, h: cardH } = getCardSize();
  const localX = state.cardX - view.x;
  const localY = state.cardY - view.y;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);

  const clippedLeft = localX < 0;
  const clippedRight = localX + cardW > view.w;
  if (!clippedLeft && !clippedRight) {
    probeOutput.textContent = `Card is fully inside ${panes[activeKey].label} (x=${localX.toFixed(1)}). Press "Straddle bezel" or "Clip left (-50%)" first, then sample again.`;
    return;
  }

  // Copy into a plain 2D canvas with willReadFrequently: true. Never read a drawable canvas directly.
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(canvas, 0, 0);

  const sampleY = Math.max(2, Math.min(copy.height - 3, Math.round((localY + cardH * 0.5) * dpr)));
  const edgeX = clippedLeft ? 1 : copy.width - 2;
  const innerX = clippedLeft
    ? Math.min(copy.width - 2, Math.round(Math.max(4, (localX + cardW) * dpr - 4)))
    : Math.max(1, Math.round(Math.min(copy.width - 5, localX * dpr + 4)));
  const outsideX = clippedLeft
    ? Math.min(copy.width - 2, Math.round((localX + cardW + 14) * dpr))
    : Math.max(1, Math.round((localX - 14) * dpr));

  const edgePx = Array.from(cc.getImageData(edgeX, sampleY, 1, 1).data);
  const innerPx = Array.from(cc.getImageData(innerX, sampleY, 1, 1).data);
  const outPx = Array.from(cc.getImageData(outsideX, sampleY, 1, 1).data);

  // Release the temporary copy canvas immediately.
  copy.width = 0;
  copy.height = 0;
  window.__gfx?.retire(copy);

  const side = clippedLeft ? `left edge (x=${localX.toFixed(1)})` : `right edge (overflow +${(localX + cardW - view.w).toFixed(1)} px)`;
  probeOutput.textContent = `Sampled ${panes[activeKey].label} ${side} at y=${Math.round(sampleY / dpr)} CSS px: edge rgba(${edgePx.join(',')}), inside card rgba(${innerPx.join(',')}), 14 px outside card rgba(${outPx.join(',')}).`;
}
// #endregion edge-probe

probeEdgeBtn.addEventListener('click', sampleEdgePixels);

window.addEventListener('pagehide', () => {
  stopScreenWatcher();
  if (broadcastRaf) {
    cancelAnimationFrame(broadcastRaf);
    broadcastRaf = 0;
  }
  sendBroadcast({ type: 'bye', from: myId });
  channelOpen = false;
  try { channel?.close(); } catch {}
});

if (isWing) {
  setMode('multi', { reposition: false });
}

// ---- Live checks (isolated on testStage(), wait for tap via <meta name="checks" content="tap">) ----
const resultsBody = document.getElementById('results');

runTests(resultsBody, [
  {
    name: 'window.getScreenDetails() API availability',
    why: 'Window Management exposes multi-monitor screen rects. Feature detection only; permission is never requested on load.',
    run: async () => {
      const avail = typeof window.getScreenDetails === 'function';
      const extended = 'isExtended' in screen ? `, screen.isExtended=${screen.isExtended}` : '';
      const base = `screenX=${window.screenX}, screenY=${window.screenY}, outer=${window.outerWidth}×${window.outerHeight}, screen=${screen.width}×${screen.height}${extended}`;
      if (!avail) throw new Error(`getScreenDetails not present (${base})`);
      return `available (${base})`;
    },
  },
  {
    name: 'BroadcastChannel loopback and latency',
    why: 'Verifies peer state messages round-trip cleanly and both channels close without throwing.',
    run: async () => {
      if (typeof BroadcastChannel === 'undefined') throw new Error('BroadcastChannel is not available');
      const name = `hic-mw-loop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tx = new BroadcastChannel(name);
      const rx = new BroadcastChannel(name);
      let txOpen = true;
      let rxOpen = true;
      try {
        const t0 = performance.now();
        const got = new Promise((resolve, reject) => {
          rx.onmessage = (ev) => resolve(ev.data);
          rx.onmessageerror = () => reject(new Error('messageerror on BroadcastChannel'));
        });
        const sent = safePost(tx, txOpen, { type: 'ping', seq: 1, x: 312.5, y: 84, text: 'bezel-check' });
        if (!sent) throw new Error('postMessage failed');
        const msg = await got;
        const ms = (performance.now() - t0).toFixed(2);
        if (msg?.text !== 'bezel-check' || msg?.x !== 312.5) throw new Error(`unexpected payload: ${JSON.stringify(msg)}`);
        return `received seq=${msg.seq} x=${msg.x} in ${ms} ms`;
      } finally {
        txOpen = false;
        rxOpen = false;
        try { tx.close(); } catch {}
        try { rx.close(); } catch {}
      }
    },
  },
  {
    name: 'Negative-offset drawElementImage(el, -w/2, y, w, h) clips cleanly',
    why: 'When a card straddles a bezel, the right-hand canvas draws from a negative x offset and the left-hand canvas overflows width.',
    run: async () => {
      if (!supported) throw new Error('drawElementImage() is not available');
      const stage = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:200px;height:100px';
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(200 * dpr);
      c.height = Math.round(100 * dpr);

      // Left 60 px red, right 60 px blue. At x = -60, only the blue right half should appear in x = 0..60.
      const card = document.createElement('div');
      card.setAttribute('drawable', '');
      card.style.cssText = 'display:flex;width:120px;height:60px;margin:0;padding:0';
      const leftHalf = document.createElement('div');
      leftHalf.style.cssText = 'width:60px;height:60px;background:#e03131';
      const rightHalf = document.createElement('div');
      rightHalf.style.cssText = 'width:60px;height:60px;background:#1971c2';
      card.append(leftHalf, rightHalf);
      c.append(card);
      stage.append(c);

      const ctx = c.getContext('2d');
      c.addEventListener('paint', () => {
        ctx.reset();
        ctx.scale(dpr, dpr);
        const w = card.offsetWidth || 120;
        const h = card.offsetHeight || 60;
        ctx.drawElementImage(card, -w / 2, 20, w, h);
      });

      await nextPaint(c);

      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      const cc = copy.getContext('2d', { willReadFrequently: true });
      cc.drawImage(c, 0, 0);

      const yMid = Math.round(50 * dpr);
      const bluePx = Array.from(cc.getImageData(Math.round(16 * dpr), yMid, 1, 1).data);
      const clearPx = Array.from(cc.getImageData(Math.round(90 * dpr), yMid, 1, 1).data);

      copy.width = 0;
      copy.height = 0;
      window.__gfx?.retire(copy);

      if (bluePx[3] < 200 || bluePx[2] <= bluePx[0]) {
        throw new Error(`expected blue protruding right half at x=16, got rgba(${bluePx.join(',')})`);
      }
      if (clearPx[3] !== 0) {
        throw new Error(`expected transparent pixels past x=60, got rgba(${clearPx.join(',')}) at x=90`);
      }
      return `x=-60 drew blue half rgba(${bluePx.join(',')}) at x=16, transparent rgba(${clearPx.join(',')}) at x=90`;
    },
  },
  {
    name: 'State and authority handoff round-trip preserves input value',
    why: 'Crossing the 50% overlap midpoint flips authority from Peer A to Peer B and carries input value, selection and slider state.',
    run: async () => {
      if (typeof BroadcastChannel === 'undefined') throw new Error('BroadcastChannel is not available');
      const stage = testStage();
      const box = document.createElement('div');
      box.innerHTML =
        '<form data-p="a"><input value="Straddle test 42"><input type="range" min="0" max="360" value="210"></form>' +
        '<form data-p="b" inert><input value=""><input type="range" min="0" max="360" value="0"></form>';
      stage.append(box);

      const formA = box.querySelector('[data-p="a"]');
      const formB = box.querySelector('[data-p="b"]');
      const inputA = formA.querySelector('input[type="text"], input:not([type])');
      const rangeA = formA.querySelector('input[type="range"]');
      const inputB = formB.querySelector('input[type="text"], input:not([type])');
      const rangeB = formB.querySelector('input[type="range"]');

      const viewA = { x: 0, y: 0, w: 300, h: 200 };
      const viewB = { x: 318, y: 0, w: 300, h: 200 };
      const before = { x: 80, y: 40, w: 200, h: 120 };
      const after = { x: 260, y: 40, w: 200, h: 120 };

      const fA0 = overlapFraction(before, viewA);
      const fB1 = overlapFraction(after, viewB);
      if (!(fA0 > 0.5 && fB1 > 0.5)) {
        throw new Error(`unexpected overlaps before=${fA0.toFixed(2)}, after=${fB1.toFixed(2)}`);
      }

      const name = `hic-mw-handoff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const chA = new BroadcastChannel(name);
      const chB = new BroadcastChannel(name);
      let openA = true;
      try {
        const received = new Promise((resolve) => {
          chB.onmessage = (ev) => resolve(ev.data);
        });
        safePost(chA, openA, {
          authority: 'B',
          value: inputA.value,
          selStart: 9,
          selEnd: 13,
          hue: rangeA.value,
          clicks: 4,
        });
        const pkt = await received;
        formA.inert = true;
        formB.inert = false;
        inputB.value = pkt.value;
        rangeB.value = pkt.hue;

        if (inputB.value !== 'Straddle test 42' || rangeB.value !== '210' || !formA.inert || formB.inert) {
          throw new Error(`handoff mismatch: value="${inputB.value}", range="${rangeB.value}"`);
        }
        return `A(${Math.round(fA0 * 100)}%) -> B(${Math.round(fB1 * 100)}%), value="${inputB.value}", hue=${rangeB.value}, moveBefore=${hasMoveBefore ? 'available' : 'unavailable'}`;
      } finally {
        openA = false;
        try { chA.close(); } catch {}
        try { chB.close(); } catch {}
      }
    },
  },
]);
