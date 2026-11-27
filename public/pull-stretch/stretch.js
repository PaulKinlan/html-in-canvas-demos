import { banner, supported as hicSupported, runTests, nextPaint, testStage } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const MAX_PULL = 120;
export const REFRESH_THRESHOLD = 78;
export const RUBBER_K = 56;
const STRETCH_ALPHA = 0.65;
const STRETCH_DECAY = 3.2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// #region overscroll-physics
/** Logarithmic rubber-band curve matching damped mobile overscroll resistance. */
export function rubberBand(rawDrag, maxPull = MAX_PULL) {
  if (!rawDrag) return 0;
  const sign = rawDrag < 0 ? -1 : 1;
  const dist = Math.abs(rawDrag);
  return sign * Math.min(maxPull, RUBBER_K * Math.log1p(dist / RUBBER_K));
}

/** Inverse of rubberBand() so wheel/programmatic nudges stay continuous. */
export function inverseRubberBand(pullPx, maxPull = MAX_PULL) {
  if (!pullPx) return 0;
  const sign = pullPx < 0 ? -1 : 1;
  const p = Math.min(Math.abs(pullPx), maxPull * 0.999);
  return sign * RUBBER_K * (Math.exp(p / RUBBER_K) - 1);
}

/**
 * Sample texture Y in [0, 1] for normalised screen Y in [0, 1].
 * Positive pullPx stretches top rows (y -> 0) and lightly compresses distant rows.
 * Negative pullPx mirrors the same curve from the bottom edge (y -> 1).
 */
export function stretchTexY(y, pullPx, mode = 'android') {
  const yc = clamp(y, 0, 1);
  if (Math.abs(pullPx) < 0.001) return yc;
  const s = clamp(Math.abs(pullPx) / MAX_PULL, 0, 1);
  if (mode === 'uniform') {
    const scale = 1 + 0.42 * s;
    return pullPx >= 0 ? yc / scale : 1 - (1 - yc) / scale;
  }
  const amp = STRETCH_ALPHA * s;
  if (pullPx >= 0) {
    return yc - amp * yc * (1 - yc) * Math.exp(-STRETCH_DECAY * yc);
  }
  const ym = 1 - yc;
  return 1 - (ym - amp * ym * (1 - ym) * Math.exp(-STRETCH_DECAY * ym));
}

/** Local vertical strain (dy_screen / dy_tex - 1) at normalised Y. */
export function stretchStrain(y, pullPx, mode = 'android') {
  const eps = 0.0005;
  const y0 = clamp(y - eps, 0, 1);
  const y1 = clamp(y + eps, 0, 1);
  const dv = stretchTexY(y1, pullPx, mode) - stretchTexY(y0, pullPx, mode);
  if (dv <= 1e-6) return 0;
  return (y1 - y0) / dv - 1;
}

/** Find normalised screen Y that samples texture coordinate vTarget. */
export function screenYForTexY(vTarget, pullPx, mode = 'android') {
  const vt = clamp(vTarget, 0, 1);
  if (Math.abs(pullPx) < 0.05) return vt;
  if (mode === 'uniform') {
    const s = clamp(Math.abs(pullPx) / MAX_PULL, 0, 1);
    const scale = 1 + 0.42 * s;
    return pullPx >= 0 ? clamp(vt * scale, 0, 1) : clamp(1 - (1 - vt) * scale, 0, 1);
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) * 0.5;
    if (stretchTexY(mid, pullPx, mode) < vt) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/** Shared overscroll + snap + refresh state machine for both demo and fixtures. */
export function createPullState({ onRefresh = () => {}, isReduced = () => false } = {}) {
  const s = {
    mode: 'android',
    rawDrag: 0,
    pullPx: 0,
    pullVel: 0,
    dragging: false,
    refreshing: false,
    refreshElapsed: 0,
    refreshCount: 0,
    snap: 0,
    retract: 0,
    dropOffset: -10,
    armed: false,
    autoSeq: null,
  };

  function release() {
    s.dragging = false;
    s.rawDrag = 0;
    if (s.pullPx >= REFRESH_THRESHOLD && !s.refreshing) {
      s.refreshing = true;
      s.refreshElapsed = 0;
      s.snap = 1;
      s.retract = 0;
      s.armed = true;
    }
    if (isReduced()) {
      s.pullPx = 0;
      s.pullVel = 0;
    }
  }

  function step(dt) {
    let moving = false;
    const clampedDt = Math.min(dt, 0.05);

    if (s.autoSeq) {
      s.autoSeq.t += clampedDt;
      const seq = s.autoSeq;
      if (seq.kind === 'refresh') {
        if (isReduced()) {
          s.rawDrag = 0;
          s.pullPx = 0;
          s.pullVel = 0;
          s.refreshing = true;
          s.refreshElapsed = 0.04;
          s.snap = 1;
          s.autoSeq = null;
          moving = true;
        } else if (seq.t < 0.42) {
          const p = seq.t / 0.42;
          const ease = 1 - Math.pow(1 - p, 2);
          s.dragging = true;
          s.rawDrag = ease * 240;
          s.pullPx = rubberBand(s.rawDrag);
          moving = true;
        } else {
          s.autoSeq = null;
          release();
          moving = true;
        }
      } else if (seq.kind === 'bottom') {
        if (isReduced()) {
          if (seq.t < 0.42) {
            s.dragging = true;
            s.rawDrag = 0;
            s.pullPx = -76;
            s.pullVel = 0;
            moving = true;
          } else {
            s.autoSeq = null;
            s.dragging = false;
            s.rawDrag = 0;
            s.pullPx = 0;
            s.pullVel = 0;
          }
        } else if (seq.t < 0.36) {
          const p = seq.t / 0.36;
          const ease = 1 - Math.pow(1 - p, 2);
          s.dragging = true;
          s.rawDrag = -ease * 235;
          s.pullPx = rubberBand(s.rawDrag);
          moving = true;
        } else if (seq.t < 0.54) {
          s.dragging = true;
          s.pullPx = rubberBand(-235);
          moving = true;
        } else {
          s.autoSeq = null;
          s.dragging = false;
          s.rawDrag = 0;
          moving = true;
        }
      }
    }

    if (!s.dragging && Math.abs(s.pullPx) > 0.01) {
      if (isReduced()) {
        s.pullPx = 0;
        s.pullVel = 0;
      } else {
        // Sub-step critically damped spring so slow frames never overshoot.
        const stepSize = 1 / 120;
        for (let rem = clampedDt; rem > 1e-6; rem -= stepSize) {
          const h = Math.min(rem, stepSize);
          const acc = -240 * s.pullPx - 24 * s.pullVel;
          s.pullVel += acc * h;
          s.pullPx += s.pullVel * h;
        }
        if (Math.abs(s.pullPx) < 0.12 && Math.abs(s.pullVel) < 0.6) {
          s.pullPx = 0;
          s.pullVel = 0;
        } else {
          moving = true;
        }
      }
    }

    // Snap & droplet lifecycle for Android metaball mode.
    const pullPos = Math.max(0, s.pullPx);
    if (s.dragging && pullPos >= REFRESH_THRESHOLD) {
      s.armed = true;
      s.snap = isReduced() ? 1 : Math.min(1, s.snap + clampedDt * 9);
      if (s.snap < 1) moving = true;
    } else if (s.dragging) {
      s.armed = false;
      s.snap = isReduced() ? 0 : Math.max(0, s.snap - clampedDt * 10);
      if (s.snap > 0) moving = true;
    }

    if (s.refreshing) {
      s.refreshElapsed += clampedDt;
      const spinWindow = isReduced() ? 0.14 : 0.72;
      const totalWindow = isReduced() ? 0.18 : 0.92;
      if (s.refreshElapsed >= spinWindow && !s.committedThisCycle) {
        s.committedThisCycle = true;
        s.refreshCount += 1;
        onRefresh(s.refreshCount);
      }
      if (s.refreshElapsed > spinWindow) {
        s.retract = clamp((s.refreshElapsed - spinWindow) / Math.max(0.01, totalWindow - spinWindow), 0, 1);
      }
      if (s.refreshElapsed >= totalWindow) {
        s.refreshing = false;
        s.committedThisCycle = false;
        s.refreshElapsed = 0;
        s.snap = 0;
        s.retract = 0;
        s.armed = false;
      } else {
        moving = true;
      }
    }

    return moving;
  }

  return { s, release, step };
}
// #endregion overscroll-physics

// #region stretch-shader
const STRETCH_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform float uPullPx;
uniform float uMaxPull;
uniform float uThreshold;
uniform int uStretchMode;
uniform float uHeaderEdgeY;
uniform float uSnap;
uniform float uRefreshActive;
uniform float uRefreshPhase;
uniform float uRetract;
uniform float uReducedMotion;

in vec2 vUv;
out vec4 outColor;

// Non-uniform Android 12+ inverse UV stretch curve: elongates near pulled edge,
// compresses lightly further down so both edges remain pinned at [0, 1].
float stretchCurve(float y, float pullPx) {
  float yc = clamp(y, 0.0, 1.0);
  if (abs(pullPx) < 0.001) return yc;
  float s = clamp(abs(pullPx) / max(uMaxPull, 1.0), 0.0, 1.0);
  if (uStretchMode == 1) {
    float scale = 1.0 + 0.42 * s;
    return pullPx >= 0.0 ? yc / scale : 1.0 - (1.0 - yc) / scale;
  }
  float amp = 0.65 * s;
  float k = 3.2;
  if (pullPx >= 0.0) {
    return yc - amp * yc * (1.0 - yc) * exp(-k * yc);
  }
  float ym = 1.0 - yc;
  return 1.0 - (ym - amp * ym * (1.0 - ym) * exp(-k * ym));
}

vec4 overPremul(vec4 dst, vec3 srcRgb, float srcA) {
  float a = clamp(srcA, 0.0, 1.0);
  return vec4(srcRgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

// #region metaball-sdf
// Analytic 2D metaball SDF: 1/d1 + 1/d2 > threshold necks the droplet cleanly
// out of the sticky header until the threshold pull snaps the liquid bridge.
vec4 compositeMetaball(vec4 baseCol, vec2 pCss, float headerY) {
  float pullPos = max(uPullPx, 0.0);
  float t = clamp(pullPos / max(uThreshold, 1.0), 0.0, 1.0);
  float activeAmt = max(t, uRefreshActive);
  if (uStretchMode != 0 || activeAmt < 0.015) return baseCol;

  float cx = uCanvasSize.x * 0.5;
  float dropOffset = uRefreshActive > 0.5
    ? mix(48.0, -14.0, uRetract * uRetract)
    : mix(-8.0, 44.0, t) + max(0.0, pullPos - uThreshold) * 0.24 + uSnap * 13.0;
  float dropY = headerY + dropOffset;

  vec2 neckCenter = vec2(cx, headerY - 2.0);
  vec2 dropCenter = vec2(cx, dropY);

  float neckScale = uRefreshActive > 0.5 ? 0.0 : max(0.0, 1.0 - uSnap);
  float r1 = mix(11.5, 8.2, t) * neckScale;
  float r2 = uRefreshActive > 0.5
    ? mix(17.5, 3.0, uRetract)
    : mix(9.5, 17.2, smoothstep(0.04, 0.65, t));

  float d1 = max(length(pCss - neckCenter), 0.75);
  float d2 = max(length(pCss - dropCenter), 0.75);
  float flareAmp = 0.28 * (1.0 - smoothstep(0.55, 1.0, t)) * neckScale;
  float flare = flareAmp * exp(-max(0.0, pCss.y - headerY) / 7.5)
    * max(0.0, 1.0 - abs(pCss.x - cx) / 30.0);

  // Core analytic 2D metaball field: r1/d1 + r2/d2 > 1.0.
  float field = (r1 / d1) + (r2 / d2) + flare;
  float belowHeader = smoothstep(headerY - 1.2, headerY + 0.8, pCss.y);
  float bodyMask = smoothstep(0.95, 1.05, field) * belowHeader;

  // Soft shadow cast onto the stretched feed beneath the liquid droplet.
  float d1S = max(length(pCss - vec2(0.0, 4.0) - neckCenter), 1.0);
  float d2S = max(length(pCss - vec2(0.0, 4.5) - dropCenter), 1.0);
  float shadowField = (r1 / d1S) + (r2 / d2S) + flare * 0.6;
  float shadowMask = smoothstep(0.70, 1.08, shadowField) * belowHeader * (1.0 - bodyMask);
  vec4 outC = overPremul(baseCol, vec3(0.03, 0.04, 0.08), shadowMask * 0.28 * (1.0 - uRetract));

  if (bodyMask > 0.002) {
    // Analytic surface normal of the 1/d1 + 1/d2 scalar field for glossy rim shading.
    vec2 grad = -(r1 * (pCss - neckCenter) / (d1 * d1 * d1) + r2 * (pCss - dropCenter) / (d2 * d2 * d2));
    float gLen = length(grad);
    vec2 norm2d = gLen > 1e-5 ? grad / gLen : vec2(0.0, -1.0);
    float spec = pow(max(0.0, dot(norm2d, normalize(vec2(-0.55, -0.83)))), 5.0);
    float rim = smoothstep(1.38, 1.0, field);

    vec3 slateBase = vec3(0.106, 0.133, 0.196); // matches #1b2232 sticky header
    vec3 armedTint = vec3(0.824, 0.286, 0.122); // #d2491f accent glow on threshold
    float ready = max(uSnap, uRefreshActive);
    vec3 bodyRgb = slateBase + vec3(0.18, 0.22, 0.30) * spec * 0.72;
    bodyRgb = mix(bodyRgb, mix(slateBase, armedTint, 0.38), rim * ready * 0.85);

    // Circular spinner progress arc inside the droplet bulb.
    vec2 rel = pCss - dropCenter;
    float ringR = r2 * 0.50;
    float ringDist = abs(d2 - ringR);
    float ringMask = (1.0 - smoothstep(1.35, 2.25, ringDist)) * step(5.0, r2);
    float ang = atan(rel.y, rel.x); // [-pi, pi]
    float arcAlpha = 0.0;

    if (uRefreshActive > 0.5) {
      float spinStart = uReducedMotion > 0.5 ? -1.57 : (uRefreshPhase * 6.2 + sin(uRefreshPhase * 3.0) * 0.85);
      float arcLen = uReducedMotion > 0.5 ? 4.4 : (2.15 + 1.05 * sin(uRefreshPhase * 2.5));
      float delta = mod(ang - spinStart + 6.2831853, 6.2831853);
      arcAlpha = (1.0 - smoothstep(arcLen - 0.15, arcLen + 0.15, delta)) * (1.0 - uRetract);
    } else if (t > 0.12) {
      float sweep = mix(0.35, 5.15, clamp((t - 0.12) / 0.88, 0.0, 1.0));
      float spinTilt = t * 1.45;
      float delta = mod(ang - (-1.5707963 + spinTilt) + 6.2831853, 6.2831853);
      arcAlpha = 1.0 - smoothstep(sweep - 0.15, sweep + 0.15, delta);
    }

    vec3 arcRgb = ready > 0.5 ? vec3(1.0, 0.478, 0.302) : vec3(0.95, 0.96, 1.0);
    bodyRgb = mix(bodyRgb, arcRgb, ringMask * arcAlpha);
    outC = overPremul(outC, bodyRgb, bodyMask);
  }
  return outC;
}
// #endregion metaball-sdf

void main() {
  vec2 pCss = vUv * uCanvasSize;
  float vy = stretchCurve(vUv.y, uPullPx);

  vec4 feedCol = vec4(0.0);
  if (vy >= 0.0 && vy <= 1.0) {
    feedCol = texture(uTex, vec2(vUv.x, vy));
  } else {
    feedCol = vec4(0.08, 0.09, 0.12, 1.0);
  }

  // Subtle Android-style edge sheen at the pulled boundary.
  if (uStretchMode == 0 && abs(uPullPx) > 1.0) {
    float s = clamp(abs(uPullPx) / max(uMaxPull, 1.0), 0.0, 1.0);
    float edgeDist = uPullPx >= 0.0 ? pCss.y : max(0.0, uCanvasSize.y - pCss.y);
    float sheen = exp(-edgeDist / 36.0) * 0.08 * s;
    feedCol.rgb += vec3(0.35, 0.42, 0.58) * sheen * feedCol.a;
  }

  outColor = compositeMetaball(feedCol, pCss, uHeaderEdgeY);
}`;
// #endregion stretch-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('stretch-stage');
const phoneViewport = document.getElementById('phone-viewport');
const canvas = document.getElementById('stretch-canvas');
const feedEl = document.getElementById('feed-scroll');
const topbarEl = document.getElementById('feed-topbar');
const feedCountEl = document.getElementById('feed-count');
const feedStatePill = document.getElementById('feed-state-pill');
const feedList = document.getElementById('feed-list');
const feedCompose = document.getElementById('feed-compose');
const feedInput = document.getElementById('feed-input');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('stage-notice');
const hudEl = document.getElementById('stage-hud');
const testsBody = document.getElementById('tests');

const modeBtns = Array.from(document.querySelectorAll('button[data-mode]'));
const triggerRefreshBtn = document.getElementById('btn-trigger-refresh');
const overscrollBottomBtn = document.getElementById('btn-overscroll-bottom');
const reducedCheck = document.getElementById('ctl-reduced');
const chipBtns = Array.from(document.querySelectorAll('.feed-chip[data-filter]'));

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

// ---------------------------------------------------------------- Live DOM feed manager
let activeFilter = 'all';
let userNoteCounter = 0;

const REFRESH_NOTES = [
  { topic: 'shaders', tag: 'Shaders', title: 'Metaball neck pinch telemetry', body: 'Neck radius crosses zero right at 78 px when r1/d1 + r2/d2 falls below 1.0.' },
  { topic: 'scroll', tag: 'Scroll', title: 'Boundary handoff check', body: 'overscroll-behavior-y: contain holds the outer page still while the feed stretches.' },
  { topic: 'shaders', tag: 'Shaders', title: 'Strain profile across rows', body: 'Top rows stretch up to 2.6x while lower cards compress slightly inside [0, 1].' },
  { topic: 'scroll', tag: 'Scroll', title: 'Hit-box alignment check', body: 'updateElementGeometry() tracks geometryUnit() so Like and Bookmark taps still land.' },
];

export function prependFeedItem(list, { topic, tag, title, body, timeLabel, fresh = false }) {
  const art = document.createElement('article');
  art.className = `feed-item${fresh ? ' is-fresh' : ''}`;
  art.dataset.topic = topic;
  art.dataset.saved = 'false';

  const meta = document.createElement('div');
  meta.className = 'feed-meta';
  const badge = document.createElement('span');
  badge.className = `feed-tag t-${topic}`;
  badge.textContent = tag;
  const time = document.createElement('span');
  time.className = 'feed-time';
  time.textContent = timeLabel;
  meta.append(badge, time);

  const h3 = document.createElement('h3');
  h3.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;

  const actions = document.createElement('div');
  actions.className = 'feed-actions';
  const likeBtn = document.createElement('button');
  likeBtn.type = 'button';
  likeBtn.className = 'btn-like';
  likeBtn.dataset.likes = '0';
  likeBtn.textContent = '+1 Like (0)';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-save';
  saveBtn.setAttribute('aria-pressed', 'false');
  saveBtn.textContent = 'Bookmark';
  actions.append(likeBtn, saveBtn);

  art.append(meta, h3, p, actions);
  list.prepend(art);
  return art;
}

function updateFeedCounts() {
  const items = Array.from(feedList.querySelectorAll('.feed-item'));
  let shown = 0;
  let savedCount = 0;
  for (const item of items) {
    const isSaved = item.dataset.saved === 'true';
    if (isSaved) savedCount++;
    const match = activeFilter === 'all'
      || (activeFilter === 'saved' ? isSaved : item.dataset.topic === activeFilter);
    item.hidden = !match;
    if (match) shown++;
  }
  feedCountEl.textContent = `${shown} ${shown === 1 ? 'item' : 'items'}`;
  const savedChip = chipBtns.find((b) => b.dataset.filter === 'saved');
  if (savedChip) savedChip.textContent = `Saved (${savedCount})`;
}

feedList.addEventListener('click', (e) => {
  if (performance.now() < suppressClickUntil) return;
  const likeBtn = e.target.closest('.btn-like');
  if (likeBtn) {
    const next = (Number(likeBtn.dataset.likes) || 0) + 1;
    likeBtn.dataset.likes = String(next);
    likeBtn.textContent = `+1 Like (${next})`;
    markTextureDirty();
    return;
  }
  const saveBtn = e.target.closest('.btn-save');
  if (saveBtn) {
    const item = saveBtn.closest('.feed-item');
    const next = saveBtn.getAttribute('aria-pressed') !== 'true';
    saveBtn.setAttribute('aria-pressed', String(next));
    saveBtn.textContent = next ? 'Saved' : 'Bookmark';
    if (item) item.dataset.saved = String(next);
    updateFeedCounts();
    markTextureDirty();
  }
});

for (const chip of chipBtns) {
  chip.addEventListener('click', () => {
    if (performance.now() < suppressClickUntil) return;
    activeFilter = chip.dataset.filter;
    for (const b of chipBtns) b.setAttribute('aria-pressed', String(b === chip));
    updateFeedCounts();
    markTextureDirty();
  });
}

feedCompose.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = feedInput.value.trim();
  if (!text) return;
  userNoteCounter += 1;
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  prependFeedItem(feedList, {
    topic: 'scroll',
    tag: 'Note',
    title: `Dispatch #${userNoteCounter}`,
    body: text,
    timeLabel: stamp,
    fresh: true,
  });
  feedInput.value = '';
  if (activeFilter !== 'all' && activeFilter !== 'scroll') {
    activeFilter = 'all';
    for (const b of chipBtns) b.setAttribute('aria-pressed', String(b.dataset.filter === 'all'));
  }
  updateFeedCounts();
  feedEl.scrollTop = 0;
  markTextureDirty();
});

// ---------------------------------------------------------------- Overscroll state & backend
let stage = null;
let ctx2d = null;
let plainBuffer = null;
let plainBufferCtx = null;
let backend = 'none';
let hasPainted = false;
let textureDirty = true;
let rafId = 0;
let lastFrameTime = 0;
let isVisible = true;
let lostTimer = 0;
let lastGeoSig = '';
let suppressClickUntil = 0;
let wheelReleaseTimer = 0;

const pullCtrl = createPullState({
  isReduced,
  onRefresh: (count) => {
    const template = REFRESH_NOTES[(count - 1) % REFRESH_NOTES.length];
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    prependFeedItem(feedList, {
      ...template,
      title: `Refresh #${count}: ${template.title}`,
      timeLabel: `Refreshed ${stamp}`,
      fresh: true,
    });
    if (activeFilter === 'saved') {
      activeFilter = 'all';
      for (const b of chipBtns) b.setAttribute('aria-pressed', String(b.dataset.filter === 'all'));
    }
    updateFeedCounts();
    markTextureDirty();
  },
});
const state = pullCtrl.s;

function markTextureDirty() {
  textureDirty = true;
  canvas.requestPaint?.();
  scheduleLoop();
}

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  }
}

function switchToPlain(reason) {
  backend = 'plain';
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.add('plain');
  if (feedEl.parentElement !== plainHost) {
    plainHost.append(feedEl);
  }
  showNotice(reason);
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('plain');
  if (feedEl.parentElement !== canvas) {
    canvas.append(feedEl);
  }
  showNotice('');
  markTextureDirty();
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend !== 'webgl' || !hasPainted) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const fw = feedEl.offsetWidth;
  const fh = feedEl.offsetHeight;
  if (!cw || !ch || !fw || !fh) return;

  const unit = geometryUnit(canvas, feedEl, fw);
  let ty = 0;
  let sy = 1;
  if (Math.abs(state.pullPx) > 0.25) {
    const s = clamp(Math.abs(state.pullPx) / MAX_PULL, 0, 1);
    if (state.mode === 'uniform') {
      const scale = 1 + 0.42 * s;
      sy = scale;
      ty = state.pullPx >= 0 ? 0 : fh * (1 - scale);
    } else {
      // Shift hit box gently with the pulled edge while preserving exact identity at rest.
      const edgeShift = state.pullPx >= 0 ? s * 6 : -s * 6;
      ty = edgeShift;
    }
  }
  const sig = `${unit.toFixed(4)}:${ty.toFixed(1)}:${sy.toFixed(3)}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const cssMat = new DOMMatrix().translate(0, ty).scale(1, sy, 1);
  const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
  canvas.updateElementGeometry?.(feedEl, { canvasTransform: scaled });
  feedEl.dataset.hitTick = feedEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function updateHud() {
  const cleanZero = (v, eps = 0.005) => (Math.abs(v) < eps ? 0 : v);
  const pullShown = cleanZero(state.pullPx, 0.05);
  const topStrain = cleanZero(stretchStrain(0.02, state.pullPx, state.mode));
  const botStrain = cleanZero(stretchStrain(0.98, state.pullPx, state.mode));
  const maxScroll = Math.max(0, Math.round(feedEl.scrollHeight - feedEl.clientHeight));
  const st = Math.round(feedEl.scrollTop);
  const pill = state.refreshing
    ? 'Refreshing'
    : state.pullPx >= REFRESH_THRESHOLD
      ? 'Release to refresh'
      : state.pullPx > 1
        ? `Pull ${Math.round(state.pullPx)} px`
        : state.pullPx < -1
          ? `Bottom ${Math.round(Math.abs(state.pullPx))} px`
          : st <= 1
            ? 'At top'
            : st >= maxScroll - 1
              ? 'At bottom'
              : `${st} / ${maxScroll} px`;
  if (feedStatePill.textContent !== pill) {
    feedStatePill.textContent = pill;
    feedStatePill.dataset.ready = String(state.pullPx >= REFRESH_THRESHOLD || state.refreshing);
    textureDirty = true;
  }
  const routeName = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  hudEl.textContent =
    `Route: ${routeName} · Mode: ${state.mode === 'android' ? 'Android stretch + metaball' : 'Uniform scale'} · ` +
    `scrollTop: ${st}/${maxScroll} px · pullPx: ${pullShown.toFixed(1)} px · ` +
    `strain(y=0): ${Math.round(topStrain * 100)}% · strain(y=1): ${Math.round(botStrain * 100)}% · refreshes: ${state.refreshCount}`;
}

function currentHeaderEdgeY(ch) {
  const h = topbarEl.offsetHeight || 54;
  if (ch <= 0) return h;
  return screenYForTexY(h / ch, state.pullPx, state.mode) * ch;
}

// #region fallback-2d
function draw2DFallback(cw, ch) {
  if (!ctx2d || !hasPainted) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);

  if (Math.abs(state.pullPx) < 0.25 && !state.refreshing) {
    ctx2d.drawElementImage(feedEl, 0, 0, cw, ch);
    return;
  }

  // Copy a plain 2D snapshot (never a willReadFrequently drawable canvas) to slice strips.
  if (!plainBuffer) {
    plainBuffer = document.createElement('canvas');
    plainBufferCtx = plainBuffer.getContext('2d');
  }
  if (plainBuffer.width !== bw || plainBuffer.height !== bh) {
    plainBuffer.width = bw;
    plainBuffer.height = bh;
  }
  ctx2d.drawElementImage(feedEl, 0, 0, cw, ch);
  plainBufferCtx.clearRect(0, 0, bw, bh);
  plainBufferCtx.drawImage(canvas, 0, 0);

  ctx2d.clearRect(0, 0, cw, ch);
  const strip = 4;
  for (let y = 0; y < ch; y += strip) {
    const h = Math.min(strip, ch - y);
    const v0 = stretchTexY(y / ch, state.pullPx, state.mode);
    const v1 = stretchTexY((y + h) / ch, state.pullPx, state.mode);
    if (v1 <= 0 || v0 >= 1) continue;
    const sy = clamp(v0, 0, 0.999) * bh;
    const sh = Math.max(1, (clamp(v1, 0, 1) - clamp(v0, 0, 0.999)) * bh);
    ctx2d.drawImage(plainBuffer, 0, sy, bw, sh, 0, y, cw, h);
  }

  if (state.mode === 'android' && (state.pullPx > 1 || state.refreshing)) {
    const hy = currentHeaderEdgeY(ch);
    const t = clamp(Math.max(0, state.pullPx) / REFRESH_THRESHOLD, 0, 1);
    const dropY = state.refreshing ? hy + 46 : hy + mixVal(-6, 44, t);
    const r = state.refreshing ? 17 * (1 - state.retract) : mixVal(9, 17, t);
    if (r > 1) {
      ctx2d.save();
      ctx2d.fillStyle = '#1b2232';
      ctx2d.beginPath();
      ctx2d.arc(cw * 0.5, dropY, r, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = state.armed || state.refreshing ? '#ff7a4d' : '#eef2ff';
      ctx2d.lineWidth = 2.4;
      ctx2d.beginPath();
      const start = state.refreshing ? state.refreshElapsed * 6 : -Math.PI * 0.5;
      const span = state.refreshing ? Math.PI * 1.15 : t * Math.PI * 1.65;
      ctx2d.arc(cw * 0.5, dropY, r * 0.52, start, start + span);
      ctx2d.stroke();
      ctx2d.restore();
    }
  }
}
// #endregion fallback-2d

const mixVal = (a, b, t) => a + (b - a) * t;

function drawFrame() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch || !hasPainted) return;

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (textureDirty || !stage.has(feedEl)) {
        stage.upload(feedEl);
        textureDirty = false;
      }
      const headerEdgeY = currentHeaderEdgeY(ch);
      stage.quad(feedEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.uniform2f(loc('uCanvasSize'), cw, ch);
        gl.uniform1f(loc('uPullPx'), state.pullPx);
        gl.uniform1f(loc('uMaxPull'), MAX_PULL);
        gl.uniform1f(loc('uThreshold'), REFRESH_THRESHOLD);
        gl.uniform1i(loc('uStretchMode'), state.mode === 'uniform' ? 1 : 0);
        gl.uniform1f(loc('uHeaderEdgeY'), headerEdgeY);
        gl.uniform1f(loc('uSnap'), state.snap);
        gl.uniform1f(loc('uRefreshActive'), state.refreshing ? 1 : 0);
        gl.uniform1f(loc('uRefreshPhase'), state.refreshElapsed);
        gl.uniform1f(loc('uRetract'), state.retract);
        gl.uniform1f(loc('uReducedMotion'), isReduced() ? 1 : 0);
      });
      syncGeometry();
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        textureDirty = true;
        canvas.requestPaint?.();
      } else {
        throw err;
      }
    }
  } else if (backend === '2d') {
    draw2DFallback(cw, ch);
  }
  updateHud();
}

function tick(now) {
  rafId = 0;
  if (!isVisible || backend === 'plain' || backend === 'none') return;
  const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1 / 60;
  lastFrameTime = now;

  const stillAnimating = pullCtrl.step(dt);
  drawFrame();

  if (stillAnimating || state.dragging) {
    rafId = requestAnimationFrame(tick);
  } else {
    lastFrameTime = 0;
  }
}

function scheduleLoop() {
  if (!isVisible || backend === 'plain' || backend === 'none') return;
  if (!rafId) {
    rafId = requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------- Scroll, touch, mouse & wheel input
feedEl.addEventListener('scroll', () => {
  textureDirty = true;
  scheduleLoop();
}, { passive: true });

let touchId = null;
let touchLastY = 0;
let touchOverscroll = false;

feedEl.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  touchId = t.identifier;
  touchLastY = t.clientY;
  touchOverscroll = Math.abs(state.pullPx) > 0.5;
  state.autoSeq = null;
  state.pullVel = 0;
  if (touchOverscroll) {
    state.dragging = true;
    state.rawDrag = inverseRubberBand(state.pullPx);
  }
}, { passive: true });

feedEl.addEventListener('touchmove', (e) => {
  if (touchId === null) return;
  const t = Array.from(e.touches).find((item) => item.identifier === touchId);
  if (!t) return;
  const dy = t.clientY - touchLastY;
  touchLastY = t.clientY;
  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  const atTop = feedEl.scrollTop <= 0.5;
  const atBottom = feedEl.scrollTop >= maxScroll - 0.5;

  if (touchOverscroll) {
    const prevSign = state.rawDrag >= 0 ? 1 : -1;
    const nextRaw = state.rawDrag + dy;
    if ((prevSign > 0 && nextRaw <= 0) || (prevSign < 0 && nextRaw >= 0)) {
      state.rawDrag = 0;
      state.pullPx = 0;
      state.dragging = false;
      touchOverscroll = false;
      feedEl.scrollTop = clamp(feedEl.scrollTop - nextRaw, 0, maxScroll);
      markTextureDirty();
      return;
    }
    state.rawDrag = nextRaw;
    state.pullPx = rubberBand(state.rawDrag);
    state.dragging = true;
    if (e.cancelable) e.preventDefault();
    scheduleLoop();
    return;
  }

  if ((atTop && dy > 0.5) || (atBottom && dy < -0.5)) {
    touchOverscroll = true;
    state.dragging = true;
    state.rawDrag = dy;
    state.pullPx = rubberBand(state.rawDrag);
    if (e.cancelable) e.preventDefault();
    scheduleLoop();
  }
}, { passive: false });

function endTouch() {
  if (touchId === null) return;
  touchId = null;
  if (touchOverscroll || state.dragging) {
    touchOverscroll = false;
    pullCtrl.release();
    scheduleLoop();
  }
}
feedEl.addEventListener('touchend', endTouch, { passive: true });
feedEl.addEventListener('touchcancel', endTouch, { passive: true });

// Desktop mouse drag inside the feed (preserves text selection in inputs and button clicks).
let mouseActive = false;
let mouseDragged = false;
let mouseStartY = 0;
let mouseLastY = 0;

feedEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest('input, textarea, select')) return;
  mouseActive = true;
  mouseDragged = false;
  mouseStartY = e.clientY;
  mouseLastY = e.clientY;
  state.autoSeq = null;
  state.pullVel = 0;
});

window.addEventListener('pointermove', (e) => {
  if (!mouseActive || e.pointerType !== 'mouse') return;
  const dy = e.clientY - mouseLastY;
  mouseLastY = e.clientY;
  if (!mouseDragged && Math.abs(e.clientY - mouseStartY) > 6) {
    mouseDragged = true;
  }
  if (!mouseDragged) return;

  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  if (state.rawDrag > 0) {
    const next = state.rawDrag + dy;
    if (next <= 0) {
      state.rawDrag = 0;
      state.pullPx = 0;
      state.dragging = false;
      feedEl.scrollTop = clamp(-next, 0, maxScroll);
    } else {
      state.rawDrag = next;
      state.pullPx = rubberBand(state.rawDrag);
      state.dragging = true;
    }
    markTextureDirty();
    return;
  }
  if (state.rawDrag < 0) {
    const next = state.rawDrag + dy;
    if (next >= 0) {
      state.rawDrag = 0;
      state.pullPx = 0;
      state.dragging = false;
      feedEl.scrollTop = clamp(maxScroll - next, 0, maxScroll);
    } else {
      state.rawDrag = next;
      state.pullPx = rubberBand(state.rawDrag);
      state.dragging = true;
    }
    markTextureDirty();
    return;
  }

  const prevTop = feedEl.scrollTop;
  const targetTop = prevTop - dy;
  if (targetTop < 0) {
    feedEl.scrollTop = 0;
    state.rawDrag = -targetTop;
    state.pullPx = rubberBand(state.rawDrag);
    state.dragging = true;
  } else if (targetTop > maxScroll) {
    feedEl.scrollTop = maxScroll;
    state.rawDrag = maxScroll - targetTop;
    state.pullPx = rubberBand(state.rawDrag);
    state.dragging = true;
  } else {
    feedEl.scrollTop = targetTop;
  }
  markTextureDirty();
});

function endMouse() {
  if (!mouseActive) return;
  mouseActive = false;
  if (mouseDragged) {
    suppressClickUntil = performance.now() + 90;
    mouseDragged = false;
    pullCtrl.release();
    scheduleLoop();
  }
}
window.addEventListener('pointerup', endMouse);
window.addEventListener('pointercancel', endMouse);

// Wheel overscroll listener sits on the canvas (cancelable unlike inner scroller wheel).
function onCanvasWheel(e) {
  if (backend === 'plain' || backend === 'none') return;
  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  const delta = e.deltaY;
  if (Math.abs(delta) < 0.01) return;

  const scheduleWheelRelease = () => {
    clearTimeout(wheelReleaseTimer);
    wheelReleaseTimer = setTimeout(() => {
      if (!touchOverscroll && !mouseActive) {
        pullCtrl.release();
        scheduleLoop();
      }
    }, 150);
  };

  if (state.rawDrag > 0) {
    const next = state.rawDrag - delta * 0.65;
    if (next <= 0) {
      state.rawDrag = 0;
      state.pullPx = 0;
      state.dragging = false;
      feedEl.scrollTop = clamp(-next, 0, maxScroll);
    } else {
      state.rawDrag = next;
      state.pullPx = rubberBand(state.rawDrag);
      state.dragging = true;
      scheduleWheelRelease();
    }
    if (e.cancelable) e.preventDefault();
    scheduleLoop();
    return;
  }

  if (state.rawDrag < 0) {
    const next = state.rawDrag - delta * 0.65;
    if (next >= 0) {
      state.rawDrag = 0;
      state.pullPx = 0;
      state.dragging = false;
      feedEl.scrollTop = clamp(maxScroll - next, 0, maxScroll);
    } else {
      state.rawDrag = next;
      state.pullPx = rubberBand(state.rawDrag);
      state.dragging = true;
      scheduleWheelRelease();
    }
    if (e.cancelable) e.preventDefault();
    scheduleLoop();
    return;
  }

  if (feedEl.scrollTop <= 0.5 && delta < 0) {
    state.autoSeq = null;
    state.dragging = true;
    state.rawDrag = -delta * 0.65;
    state.pullPx = rubberBand(state.rawDrag);
    if (e.cancelable) e.preventDefault();
    scheduleWheelRelease();
    scheduleLoop();
  } else if (feedEl.scrollTop >= maxScroll - 0.5 && delta > 0) {
    state.autoSeq = null;
    state.dragging = true;
    state.rawDrag = -delta * 0.65;
    state.pullPx = rubberBand(state.rawDrag);
    if (e.cancelable) e.preventDefault();
    scheduleWheelRelease();
    scheduleLoop();
  }
}
canvas.addEventListener('wheel', onCanvasWheel, { passive: false });

// ---------------------------------------------------------------- Toolbar controls
for (const btn of modeBtns) {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b === btn));
    lastGeoSig = '';
    syncGeometry(true);
    scheduleLoop();
  });
}

triggerRefreshBtn.addEventListener('click', () => {
  feedEl.scrollTop = 0;
  if (backend === 'plain') {
    const next = state.refreshCount + 1;
    state.refreshCount = next;
    const template = REFRESH_NOTES[(next - 1) % REFRESH_NOTES.length];
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    prependFeedItem(feedList, {
      ...template,
      title: `Refresh #${next}: ${template.title}`,
      timeLabel: `Refreshed ${stamp}`,
      fresh: true,
    });
    updateFeedCounts();
    updateHud();
    return;
  }
  state.autoSeq = { kind: 'refresh', t: 0 };
  markTextureDirty();
});

overscrollBottomBtn.addEventListener('click', () => {
  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  feedEl.scrollTop = maxScroll;
  if (backend === 'plain') {
    updateHud();
    return;
  }
  state.autoSeq = { kind: 'bottom', t: 0 };
  markTextureDirty();
});

reducedCheck.addEventListener('change', () => {
  if (isReduced()) {
    state.pullPx = 0;
    state.pullVel = 0;
  }
  scheduleLoop();
});

// ---------------------------------------------------------------- Backend startup & visibility
function startBackend() {
  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so the scrollable feed is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    hasPainted = true;
    textureDirty = true;
    if (!rafId && isVisible) drawFrame();
  });

  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: STRETCH_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so the scrollable feed moved to plain HTML.');
            }
          }, 1200);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          restoreFromPlain();
          backend = 'webgl';
          lastGeoSig = '';
          hasPainted = true;
          textureDirty = true;
          scheduleLoop();
        },
      });
      backend = 'webgl';
    } catch {
      stage = null;
    }
  }

  if (backend === 'none') {
    ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      switchToPlain('Canvas rendering is unavailable here, so the feed is shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so the feed moved to plain HTML.');
        }
      }, 1200);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = true;
      textureDirty = true;
      scheduleLoop();
    });
  }

  canvas.requestPaint?.();
}

if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver((entries) => {
    const entry = entries[0];
    const nowVisible = Boolean(entry && entry.isIntersecting);
    if (nowVisible === isVisible) return;
    isVisible = nowVisible;
    if (isVisible) {
      markTextureDirty();
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }, { threshold: 0.01 });
  io.observe(phoneViewport);
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    lastGeoSig = '';
    textureDirty = true;
    scheduleLoop();
  });
  ro.observe(phoneViewport);
}

updateFeedCounts();
startBackend();
updateHud();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, msg) => { if (!ok) throw new Error(msg); return msg; };

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() renders non-uniform UV stretch cleanly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), uploads a striped scrollable child via texElementSubImage2D(), draws at rest and at 90 px overscroll, and checks gl.getError() === 0 plus pixel shift.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 180;
      const ch = 160;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block`;

      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = `width:${cw}px;height:${ch}px;display:flex;flex-direction:column;background:#ffffff`;
      for (const hex of ['#1b2232', '#d2491f', '#f4ecd8', '#1f7a3a', '#2b5bd1']) {
        const band = document.createElement('div');
        band.style.cssText = `flex:1;background:${hex}`;
        child.append(band);
      }
      cv.append(child);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: STRETCH_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        const uploaded = g.upload(child);

        const drawAndSample = (pullVal) => {
          g.begin([0, 0, 0, 0]);
          g.quad(child, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform1f(loc('uPullPx'), pullVal);
            gl.uniform1f(loc('uMaxPull'), MAX_PULL);
            gl.uniform1f(loc('uThreshold'), REFRESH_THRESHOLD);
            gl.uniform1i(loc('uStretchMode'), 0);
            gl.uniform1f(loc('uHeaderEdgeY'), 32);
            gl.uniform1f(loc('uSnap'), pullVal >= REFRESH_THRESHOLD ? 1 : 0);
            gl.uniform1f(loc('uRefreshActive'), 0);
            gl.uniform1f(loc('uRefreshPhase'), 0);
            gl.uniform1f(loc('uRetract'), 0);
            gl.uniform1f(loc('uReducedMotion'), 1);
          });
          const err = g.gl.getError();
          const colBuf = new Uint8Array(4 * cv.height);
          const sampleX = Math.max(0, Math.floor(cv.width * 0.2));
          g.gl.readPixels(sampleX, 0, 1, cv.height, g.gl.RGBA, g.gl.UNSIGNED_BYTE, colBuf);
          return { err, colBuf };
        };

        const rest = drawAndSample(0);
        const stretched = drawAndSample(90);
        let diffSum = 0;
        const rows = Math.min(rest.colBuf.length, stretched.colBuf.length) / 4;
        for (let i = 0; i < rows * 4; i += 4) {
          diffSum += Math.abs(rest.colBuf[i] - stretched.colBuf[i])
            + Math.abs(rest.colBuf[i + 1] - stretched.colBuf[i + 1])
            + Math.abs(rest.colBuf[i + 2] - stretched.colBuf[i + 2]);
        }
        const meanDiff = diffSum / Math.max(1, rows);
        return need(
          rest.err === g.gl.NO_ERROR && stretched.err === g.gl.NO_ERROR && uploaded && meanDiff > 12,
          `gl.getError()=${stretched.err}, uploaded ${uploaded?.w}x${uploaded?.h}, rest vs stretched pixel delta ${meanDiff.toFixed(1)}/px.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Pulling past threshold commits a refresh cycle, prepends a new live DOM row, and springs pullPx back to 0',
    expect: 'pass',
    why: 'Drives createPullState() on an isolated fixture feed list past 78 px, releases to trigger the snap and refresh timer, verifies a new DOM item is prepended, and steps the spring until pullPx settles to 0.',
    run: async () => {
      const box = document.createElement('div');
      box.style.cssText = 'width:260px;height:140px;overflow:hidden;background:#fff;color:#111;padding:6px;box-sizing:border-box';
      const list = document.createElement('div');
      prependFeedItem(list, {
        topic: 'scroll',
        tag: 'Scroll',
        title: 'Initial item',
        body: 'Existing row before refresh.',
        timeLabel: '00:00:00',
      });
      box.append(list);
      testStage().append(box);

      const ctrl = createPullState({
        isReduced: () => false,
        onRefresh: (n) => {
          prependFeedItem(list, {
            topic: 'shaders',
            tag: 'Shaders',
            title: `Refreshed #${n}`,
            body: 'Prepended after threshold release.',
            timeLabel: 'Now',
            fresh: true,
          });
        },
      });

      const initialCount = list.children.length;
      ctrl.s.dragging = true;
      ctrl.s.rawDrag = 240;
      ctrl.s.pullPx = rubberBand(ctrl.s.rawDrag);
      const peakPull = ctrl.s.pullPx;
      ctrl.step(1 / 60);
      const armedAtPeak = ctrl.s.armed && ctrl.s.snap > 0;
      ctrl.release();

      for (let i = 0; i < 120; i++) {
        ctrl.step(1 / 60);
      }

      const settledPull = Math.abs(ctrl.s.pullPx);
      const firstTitle = list.firstElementChild?.querySelector('h3')?.textContent ?? '';
      return need(
        peakPull >= REFRESH_THRESHOLD && armedAtPeak && ctrl.s.refreshCount === 1
          && list.children.length === initialCount + 1
          && firstTitle.startsWith('Refreshed #1')
          && settledPull < 0.01,
        `peak=${peakPull.toFixed(1)} px (>= ${REFRESH_THRESHOLD}), rows ${initialCount} -> ${list.children.length} ("${firstTitle}"), settled pullPx=${ctrl.s.pullPx.toFixed(4)} px.`
      );
    },
  },
  {
    name: 'Non-uniform stretch curve increases strain near y = 0 relative to y = 1',
    expect: 'pass',
    why: 'Measures stretchStrain() near y = 0 and y = 1 for Android non-uniform mode vs uniform CSS-like scale, and confirms top-band elongation vs distant compression.',
    run: async () => {
      const pull = 96;
      const topStrain = stretchStrain(0.02, pull, 'android');
      const midStrain = stretchStrain(0.45, pull, 'android');
      const botStrain = stretchStrain(0.98, pull, 'android');
      const uniTop = stretchStrain(0.02, pull, 'uniform');
      const uniBot = stretchStrain(0.98, pull, 'uniform');
      const bottomPullBotStrain = stretchStrain(0.98, -pull, 'android');
      const bottomPullTopStrain = stretchStrain(0.02, -pull, 'android');

      const ok = topStrain > 0.6
        && topStrain > midStrain
        && midStrain < 0
        && botStrain < 0
        && topStrain > botStrain
        && Math.abs(uniTop - uniBot) < 0.001
        && bottomPullBotStrain > bottomPullTopStrain;

      return need(
        ok,
        `android(+96 px): y=0.02 +${(topStrain * 100).toFixed(1)}%, y=0.45 ${(midStrain * 100).toFixed(1)}%, y=0.98 ${(botStrain * 100).toFixed(1)}%; uniform: +${(uniTop * 100).toFixed(1)}% everywhere.`
      );
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() lands elementsFromPoint() on a live feed button',
    expect: 'pass',
    why: 'Mounts an isolated ElementGL scrollable feed fixture on testStage(), scrolls inside it, syncs updateElementGeometry() via geometryUnit(), and checks document.elementsFromPoint() hits the button.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 260;
      const ch = 190;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block;position:relative`;

      const scroller = document.createElement('div');
      scroller.setAttribute('drawable', '');
      scroller.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;overflow-y:auto;overscroll-behavior-y:contain;background:#f6f4ef;color:#1d1c1a;padding:12px;box-sizing:border-box`;

      const spacer = document.createElement('div');
      spacer.style.cssText = 'height:70px';
      const targetBtn = document.createElement('button');
      targetBtn.type = 'button';
      targetBtn.textContent = '+1 Like (0)';
      targetBtn.style.cssText = 'display:block;width:140px;height:40px;border:1px solid #1d1c1a;border-radius:8px;background:#ffffff;color:#1d1c1a;font:600 14px system-ui';
      const tailSpacer = document.createElement('div');
      tailSpacer.style.cssText = 'height:180px';

      scroller.append(spacer, targetBtn, tailSpacer);
      cv.append(scroller);
      testStage().append(cv);

      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: STRETCH_FRAG });
          g.begin([0, 0, 0, 0]);
        }
        await nextPaint(cv);
        scroller.scrollTop = 40;
        await nextPaint(cv);

        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(scroller);
          g.quad(scroller, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform1f(loc('uPullPx'), 0);
            gl.uniform1f(loc('uMaxPull'), MAX_PULL);
            gl.uniform1f(loc('uThreshold'), REFRESH_THRESHOLD);
            gl.uniform1i(loc('uStretchMode'), 0);
            gl.uniform1f(loc('uHeaderEdgeY'), 0);
            gl.uniform1f(loc('uSnap'), 0);
            gl.uniform1f(loc('uRefreshActive'), 0);
            gl.uniform1f(loc('uRefreshPhase'), 0);
            gl.uniform1f(loc('uRetract'), 0);
            gl.uniform1f(loc('uReducedMotion'), 1);
          });
        }

        const unit = geometryUnit(cv, scroller, cw);
        const m = new DOMMatrix().scale(unit, unit, 1);
        cv.updateElementGeometry(scroller, { canvasTransform: m });
        scroller.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const cRect = cv.getBoundingClientRect();
        const bRect = targetBtn.getBoundingClientRect();
        const probeX = bRect.left + bRect.width * 0.5;
        const probeY = bRect.top + bRect.height * 0.5;
        const hits = document.elementsFromPoint(probeX, probeY);
        const insideCanvas = probeX >= cRect.left && probeX <= cRect.right && probeY >= cRect.top && probeY <= cRect.bottom;
        const hitOk = hits.includes(targetBtn);

        return need(
          insideCanvas && hitOk,
          `scrollTop=${scroller.scrollTop} px, elementsFromPoint(${Math.round(probeX)}, ${Math.round(probeY)}) hit <button> with geometryUnit=${unit.toFixed(3)}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
];

runTests(testsBody, tests);
