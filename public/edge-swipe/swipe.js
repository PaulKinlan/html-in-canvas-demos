import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const GUTTER_THRESHOLD_PX = 32;
const PARALLAX_FRACTION = 0.24;

// Thread data kept in sync between #view-list and #view-detail
const THREADS = [
  {
    id: 0,
    tag: 'Gutter',
    title: 'Gutter threshold 28 px',
    body: 'All buttons and inputs sit 38 px from the left edge, leaving a 28 px inset swipe rail inside the margin so taps hit controls cleanly and gutter drags peel the whole sheet.',
    note: 'Checked at 2.625 DPR on phone',
    read: false,
    pin: false,
    acks: 0,
  },
  {
    id: 1,
    tag: 'Shader',
    title: 'Cylinder fold normal',
    body: 'The rolling cylinder lifts #view-detail from left to right, shades the curved cream paper underside with directional specular highlight, and drops a soft shadow onto the inbox below.',
    note: 'Radius tapers to 0 px at rest and full peel',
    read: false,
    pin: true,
    acks: 2,
  },
  {
    id: 2,
    tag: 'Parallax',
    title: 'Parallax depth -24%',
    body: 'While you scrub across the screen, #view-list glides from -24% to 0% horizontally underneath the rising fold so both live HTML layers stay visually anchored.',
    note: 'Update #view-list hit box alongside the shader',
    read: true,
    pin: false,
    acks: 1,
  },
  {
    id: 3,
    tag: 'Spring',
    title: 'Mid-swipe spring settle',
    body: 'Releasing past 42% progress or with a quick rightward flick completes navigation to the inbox. Shorter pulls spring smoothly back to the detail view.',
    note: 'Reduced motion snaps straight to target',
    read: false,
    pin: false,
    acks: 0,
  },
  {
    id: 4,
    tag: 'Hit-test',
    title: 'Hit-box sync check',
    body: 'Settling flips inert and pointer-events between views, scales matrices by geometryUnit(), calls updateElementGeometry(), and toggles dataset.hitTick.',
    note: 'Verified with elementsFromPoint()',
    read: true,
    pin: false,
    acks: 3,
  },
];

// DOM references
const stageBox = document.getElementById('swipe-stage');
const viewportEl = document.getElementById('phone-viewport');
let canvas = document.getElementById('swipe-canvas');
const viewList = document.getElementById('view-list');
const viewDetail = document.getElementById('view-detail');
const swipeGutter = document.getElementById('swipe-gutter');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('swipe-notice');
const statusEl = document.getElementById('swipe-status');
const testsBody = document.getElementById('tests');

// List view widgets
const unreadOnlyBtn = document.getElementById('btn-unread-only');
const listSearchInput = document.getElementById('list-search');
const inboxListEl = document.getElementById('inbox-list');
const listRows = Array.from(inboxListEl.querySelectorAll('.inbox-row'));
const listSummaryEl = document.getElementById('list-summary');

// Detail view widgets
const detailBackBtn = document.getElementById('detail-back');
const detailTagEl = document.getElementById('detail-tag');
const detailTitleEl = document.getElementById('detail-title');
const detailBodyEl = document.getElementById('detail-body');
const detailNoteInput = document.getElementById('detail-note');
const detailReadCheck = document.getElementById('detail-read');
const detailPinCheck = document.getElementById('detail-pin');
const detailCounterBtn = document.getElementById('detail-counter');
const detailMetaEl = document.getElementById('detail-meta');

// External controls
const toggleViewBtn = document.getElementById('btn-toggle-view');
const scrubSlider = document.getElementById('scrub-slider');
const scrubOut = document.getElementById('scrub-out');
const anyXToggle = document.getElementById('any-x-toggle');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region peel-shader
export function peelParameters(w, h, progress, tilt = 0) {
  const p = Math.max(0, Math.min(1, progress));
  const clampedTilt = Math.max(-0.22, Math.min(0.22, tilt));
  const len = Math.hypot(1, clampedTilt);
  const dirX = 1 / len;
  const dirY = clampedTilt / len;
  const sHalf = 0.5 * w * dirX + 0.5 * h * Math.abs(dirY);
  const baseR = Math.min(34, w * 0.095);
  const env = Math.pow(Math.sin(Math.PI * p), 0.72);
  const foldS = -sHalf + p * (2 * sHalf + baseR * 0.25);
  const avail = Math.max(0, foldS + sHalf);
  const radius = p <= 0.0005 || p >= 0.9995
    ? 0
    : Math.min(baseR * env, Math.max(0.001, avail * 0.55));
  return { p, dirX, dirY, sHalf, foldS, radius };
}

export const SWIPE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;     // #view-detail (top sheet)
uniform sampler2D uListTex; // #view-list (underlying sheet)
uniform vec2 uCanvasSize;
uniform float uProgress;
uniform float uFoldS;
uniform float uRadius;
uniform vec2 uDir;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec3 sampleOpaque(sampler2D tex, vec2 uv) {
  vec4 s = texture(tex, clamp(uv, vec2(0.0), vec2(1.0)));
  return s.a > 0.002 ? clamp(s.rgb / s.a, 0.0, 1.0) : vec3(1.0);
}

vec3 creamPaperBack(vec2 uv, float edgeFade) {
  vec3 front = sampleOpaque(uTex, uv);
  vec3 cream = vec3(0.968, 0.945, 0.892);
  vec3 paper = mix(front, cream, 0.86);
  // Crisp thin paper border along the peeled rim
  paper *= mix(0.86, 1.0, edgeFade);
  return paper;
}

void main() {
  const float PI = 3.14159265359;
  vec2 pCss = vUv * uCanvasSize;
  vec2 halfBox = uCanvasSize * 0.5 - vec2(0.5);
  float screenSd = sdRoundBox(pCss - uCanvasSize * 0.5, halfBox, 21.5);
  float screenMask = 1.0 - smoothstep(-0.75, 0.75, screenSd);
  if (screenMask <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  // Fast flat paths at rest (0%) and settled back (100%)
  if (uProgress <= 0.0005) {
    vec3 detailCol = sampleOpaque(uTex, vUv);
    outColor = vec4(detailCol * screenMask, screenMask);
    return;
  }
  if (uProgress >= 0.9995) {
    vec3 listCol = sampleOpaque(uListTex, vUv);
    outColor = vec4(listCol * screenMask, screenMask);
    return;
  }

  // Underlying #view-list glides from -24% to 0% parallax
  vec2 listUv = vUv + vec2(${PARALLAX_FRACTION.toFixed(2)} * (1.0 - uProgress), 0.0);
  float depthDim = mix(0.82, 1.0, uProgress);
  vec3 listBase = sampleOpaque(uListTex, listUv) * depthDim;

  vec2 origin = uCanvasSize * 0.5;
  float s = dot(pCss - origin, uDir);
  float d = s - uFoldS;
  float R = max(uRadius, 0.001);
  float env = smoothstep(0.0, 0.08, uProgress) * smoothstep(1.0, 0.92, uProgress);
  vec3 col = listBase;

  if (d >= 0.0) {
    // Unpeeled flat #view-detail on the right, possibly under the turned-over cream flap
    vec3 flatDetail = sampleOpaque(uTex, vUv);
    float creaseAo = 1.0 - 0.18 * exp(-d / max(10.0, R * 0.6)) * env;

    vec2 qFlap = pCss + uDir * (2.0 * uFoldS - PI * R - 2.0 * s);
    float flapSd = sdRoundBox(qFlap - origin, halfBox, 21.5);
    float flapMask = 1.0 - smoothstep(-0.75, 0.75, flapSd);
    float flapShadow = 0.28 * (1.0 - smoothstep(-2.0, 18.0, flapSd)) * env;

    col = flatDetail * creaseAo * (1.0 - flapShadow);
    if (flapMask > 0.001) {
      float foldShade = mix(0.84, 1.0, smoothstep(0.0, max(16.0, R * 0.8), d));
      float rimEdge = smoothstep(-1.8, -0.3, -flapSd);
      vec3 back = creamPaperBack(qFlap / uCanvasSize, rimEdge) * foldShade;
      col = mix(col, back, flapMask);
    }
  } else if (d > -R) {
    // Inside the 3D cylinder curl band [foldS - R, foldS]
    float u = clamp(-d / R, 0.0, 1.0);
    float theta = asin(u);

    vec2 qNear = pCss + uDir * (uFoldS - R * theta - s);
    float nearSd = sdRoundBox(qNear - origin, halfBox, 21.5);
    float nearMask = 1.0 - smoothstep(-0.75, 0.75, nearSd);

    vec2 qFar = pCss + uDir * (uFoldS - R * (PI - theta) - s);
    float farSd = sdRoundBox(qFar - origin, halfBox, 21.5);
    float farMask = 1.0 - smoothstep(-0.75, 0.75, farSd);

    float underShadow = 1.0 - 0.38 * (1.0 - 0.35 * u) * env;
    col = listBase * underShadow;

    if (nearMask > 0.001) {
      float nearShade = mix(0.96, 0.56, u);
      vec3 nearCol = sampleOpaque(uTex, qNear / uCanvasSize) * nearShade;
      col = mix(col, nearCol, nearMask);
    }
    if (farMask > 0.001) {
      float nz = sqrt(max(0.0, 1.0 - u * u));
      vec3 N = normalize(vec3(-u * uDir.x, -u * uDir.y, nz));
      vec3 L = normalize(vec3(-0.34, -0.26, 0.90));
      vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
      float ndotl = max(dot(N, L), 0.0);
      float diffuse = 0.64 + 0.36 * ndotl;
      float spec = pow(max(dot(N, H), 0.0), 18.0) * 0.22;
      float rimEdge = smoothstep(-1.8, -0.3, -farSd);
      vec3 paper = creamPaperBack(qFar / uCanvasSize, rimEdge);
      vec3 lit = clamp(paper * diffuse + vec3(1.0, 0.98, 0.94) * spec, 0.0, 1.0);
      col = mix(col, lit, farMask);
    }
  } else {
    // Revealed #view-list to the left of the roll, with soft cast shadow
    vec2 qCrest = pCss + uDir * (uFoldS - R * 0.5 * PI - s);
    float crestSd = sdRoundBox(qCrest - origin, halfBox, 21.5);
    float rollAbove = 1.0 - smoothstep(-2.0, 14.0, crestSd);
    float shadowDist = -(d + R);
    float castShadow = 0.44 * exp(-shadowDist / max(15.0, R * 0.95)) * rollAbove * env;
    col = listBase * (1.0 - castShadow);
  }

  outColor = vec4(col * screenMask, screenMask);
}`;
// #endregion peel-shader

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  activeView: 'detail', // 'detail' | 'list'
  selectedId: 0,
  unreadOnly: false,
  searchQuery: '',
  progress: 0, // 0 = detail flat on top, 1 = list flat on top
  velocity: 0, // progress units / s
  target: null, // null when idle/scrubbing, 0 or 1 when spring animating
  tilt: 0,
  anyX: false,
  reducedOverride: reducedToggle.checked,
  onScreen: true,
  uploads: 0,
  paints: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  lastTime: 0,
  rafId: 0,
};

let stage = null;
let ctx2d = null;
const viewTextures = new Map();
let drag = null;
let suppressNextClick = false;

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 340);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 488);
  return { cw, ch };
}

function syncScreenSizes(cw, ch) {
  if (state.mode === 'plain') {
    for (const v of [viewList, viewDetail]) {
      if (v.style.width) v.style.width = '';
      if (v.style.height) v.style.height = '';
    }
    return;
  }
  const w = `${cw}px`;
  const h = `${ch}px`;
  for (const v of [viewList, viewDetail]) {
    if (v.style.width !== w) v.style.width = w;
    if (v.style.height !== h) v.style.height = h;
  }
}

function syncListUI() {
  let visibleCount = 0;
  let unreadCount = 0;
  const q = state.searchQuery.trim().toLowerCase();
  for (const t of THREADS) {
    if (!t.read) unreadCount++;
    const btn = listRows[t.id];
    btn.dataset.read = String(t.read);
    btn.dataset.pin = String(t.pin);
    btn.classList.toggle('is-selected', t.id === state.selectedId);
    const pinBadge = btn.querySelector('.row-pin');
    if (pinBadge) pinBadge.hidden = !t.pin;
    const matchText = `${t.title} ${t.body} ${t.tag}`.toLowerCase();
    const matchesQuery = !q || matchText.includes(q);
    const matchesUnread = !state.unreadOnly || !t.read;
    const show = matchesQuery && matchesUnread;
    btn.hidden = !show;
    if (show) visibleCount++;
  }
  unreadOnlyBtn.setAttribute('aria-pressed', String(state.unreadOnly));
  listSummaryEl.textContent = `${visibleCount} of ${THREADS.length} threads · ${unreadCount} unread`;
}

function syncDetailUI() {
  const t = THREADS[state.selectedId] ?? THREADS[0];
  detailTagEl.textContent = t.tag;
  detailTitleEl.textContent = t.title;
  detailBodyEl.textContent = t.body;
  if (detailNoteInput.value !== t.note) detailNoteInput.value = t.note;
  detailReadCheck.checked = t.read;
  detailPinCheck.checked = t.pin;
  detailCounterBtn.textContent = `Acknowledge (${t.acks})`;
  detailMetaEl.textContent = `${t.read ? 'Read' : 'Unread'} · ${t.acks} ${t.acks === 1 ? 'ack' : 'acks'}`;
}

function updateControlsUI() {
  const pct = Math.round(state.progress * 100);
  scrubSlider.value = String(pct);
  scrubOut.textContent = `${pct}%`;
  toggleViewBtn.textContent = state.activeView === 'detail' ? 'Peel back to Inbox' : 'Open thread detail';
  swipeGutter.style.pointerEvents = (state.mode !== 'plain' && state.activeView === 'detail' && !drag && state.progress <= 0.02)
    ? 'auto'
    : 'none';
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const viewLabel = state.progress <= 0.01
    ? 'Detail view'
    : state.progress >= 0.99
      ? 'Inbox list'
      : `Peeling ${(state.progress * 100).toFixed(0)}%`;
  const pxOffset = (-PARALLAX_FRACTION * 100 * (1 - state.progress)).toFixed(1);
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent =
    `${routeLabel} · ${viewLabel} · parallax ${pxOffset}% · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
}

// #region geometry-sync
function cachedUnit(cw, refEl) {
  const zoom = refEl.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${cw}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, refEl, cw);
    state.unitCache.key = key;
    state.lastGeoKey = '';
  }
  return state.unitCache.unit;
}

export function syncViewGeometry(force = false) {
  if (state.mode === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch } = getViewportSize();
  const settledDetail = state.progress <= 0.01 && state.target === null && !drag;
  const settledList = state.progress >= 0.99 && state.target === null && !drag;
  const parallaxX = -PARALLAX_FRACTION * cw * (1 - state.progress);

  // While mid-curl or animating, mark both views inert so covered controls don't grab taps.
  const detailInteractive = settledDetail;
  const listInteractive = settledList;
  if (viewDetail.inert !== !detailInteractive) viewDetail.inert = !detailInteractive;
  if (viewList.inert !== !listInteractive) viewList.inert = !listInteractive;
  const detailPe = detailInteractive ? 'auto' : 'none';
  const listPe = listInteractive ? 'auto' : 'none';
  if (viewDetail.style.pointerEvents !== detailPe) viewDetail.style.pointerEvents = detailPe;
  if (viewList.style.pointerEvents !== listPe) viewList.style.pointerEvents = listPe;

  if (state.mode !== 'webgl') return;
  const geoKey = `${cw}x${ch}|${detailInteractive ? 1 : 0}|${listInteractive ? 1 : 0}|${parallaxX.toFixed(1)}`;
  if (!force && geoKey === state.lastGeoKey) return;
  state.lastGeoKey = geoKey;

  const refEl = detailInteractive ? viewDetail : viewList;
  const u = cachedUnit(cw, refEl);
  canvas.updateElementGeometry(viewList, {
    canvasTransform: new DOMMatrix().translate(parallaxX * u, 0).scale(u, u),
  });
  canvas.updateElementGeometry(viewDetail, {
    canvasTransform: new DOMMatrix().scale(u, u),
  });
  viewList.dataset.hitTick = viewList.dataset.hitTick === '1' ? '0' : '1';
  viewDetail.dataset.hitTick = viewDetail.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function tryUploadView(el) {
  if (!stage || stage.lost) return null;
  try {
    const tex = stage.upload(el);
    if (tex) {
      viewTextures.set(el, tex);
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return viewTextures.get(el) ?? null;
    }
    throw err;
  }
}

function renderWebGL(uploadMissing = false, changedSet = null) {
  if (!stage || stage.lost) return;
  const { cw, ch } = getViewportSize();
  syncScreenSizes(cw, ch);

  if (changedSet) {
    for (const el of [viewList, viewDetail]) {
      if (changedSet.has(el) || !viewTextures.has(el)) tryUploadView(el);
    }
  } else if (uploadMissing || viewTextures.size < 2) {
    if (!viewTextures.has(viewList)) tryUploadView(viewList);
    if (!viewTextures.has(viewDetail)) tryUploadView(viewDetail);
  }

  const listTex = viewTextures.get(viewList);
  const detailTex = viewTextures.get(viewDetail);
  if (!listTex || !detailTex) return;

  if (!stage.begin([0, 0, 0, 0])) return;
  syncViewGeometry(false);

  const params = peelParameters(cw, ch, state.progress, state.tilt);
  stage.quad(viewDetail, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, listTex.tex);
    gl.uniform1i(loc('uListTex'), 1);
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform1f(loc('uProgress'), params.p);
    gl.uniform1f(loc('uFoldS'), params.foldS);
    gl.uniform1f(loc('uRadius'), params.radius);
    gl.uniform2f(loc('uDir'), params.dirX, params.dirY);
  });

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!ctx2d) return;
  const { cw, ch } = getViewportSize();
  syncScreenSizes(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const p = Math.max(0, Math.min(1, state.progress));
  const parallaxX = -PARALLAX_FRACTION * cw * (1 - p);
  const foldX = p * cw;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);

  // Underlying #view-list with sliding parallax (5-argument drawElementImage)
  if (p > 0.001) {
    ctx2d.drawElementImage(viewList, parallaxX, 0, cw, ch);
    const shadowW = Math.min(36, Math.max(10, foldX * 0.25));
    const leftGrad = ctx2d.createLinearGradient(foldX - shadowW, 0, foldX, 0);
    leftGrad.addColorStop(0, 'rgb(0 0 0 / 0)');
    leftGrad.addColorStop(1, `rgb(0 0 0 / ${(0.34 * Math.sin(Math.PI * p)).toFixed(3)})`);
    ctx2d.fillStyle = leftGrad;
    ctx2d.fillRect(Math.max(0, foldX - shadowW), 0, shadowW, ch);
  }

  // Remaining unpeeled #view-detail slice on the right (5-arg at rest, 9-arg mid-peel)
  if (p <= 0.001) {
    ctx2d.drawElementImage(viewDetail, 0, 0, cw, ch);
  } else if (p < 0.999) {
    const remW = Math.max(1, cw - foldX);
    ctx2d.drawElementImage(viewDetail, foldX, 0, remW, ch, foldX, 0, remW, ch);

    // Cream paper curl strip beside the fold boundary
    const lipW = Math.min(30, remW, 44 * Math.sin(Math.PI * p));
    if (lipW > 1) {
      const lipGrad = ctx2d.createLinearGradient(foldX, 0, foldX + lipW, 0);
      lipGrad.addColorStop(0, '#e6dfd0');
      lipGrad.addColorStop(0.42, '#fbf7ee');
      lipGrad.addColorStop(1, '#e8e0cf');
      ctx2d.fillStyle = lipGrad;
      ctx2d.fillRect(foldX, 0, lipW, ch);
    }
  }

  ctx2d.restore();
  syncViewGeometry(false);
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.target = null;
  state.velocity = 0;
  state.progress = state.activeView === 'list' ? 1 : 0;
  stageBox.classList.add('is-plain');
  for (const v of [viewList, viewDetail]) {
    if (v.parentElement !== plainHost) plainHost.append(v);
  }
  syncScreenSizes(0, 0);
  const showDetail = state.activeView === 'detail';
  viewDetail.dataset.active = String(showDetail);
  viewList.dataset.active = String(!showDetail);
  viewDetail.inert = !showDetail;
  viewList.inert = showDetail;
  viewDetail.style.pointerEvents = showDetail ? 'auto' : 'none';
  viewList.style.pointerEvents = !showDetail ? 'auto' : 'none';
  showNotice(reason);
  updateControlsUI();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const v of [viewList, viewDetail]) {
    delete v.dataset.active;
    if (v.parentElement !== canvas) canvas.append(v);
  }
  showNotice('');
}
// #endregion fallback-2d

function drawCurrentFrame(forcePaint = false) {
  if (state.mode === 'plain') {
    enterPlainFallback(noticeEl.textContent || '');
    return;
  }
  if (!forcePaint && state.mode === 'webgl' && stage && !stage.lost && viewTextures.size === 2) {
    renderWebGL(false);
    return;
  }
  canvas.requestPaint?.();
}

function settleTo(targetView, { moveFocus = false } = {}) {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.target = null;
  state.velocity = 0;
  state.tilt = 0;
  state.activeView = targetView;
  state.progress = targetView === 'list' ? 1 : 0;
  state.lastGeoKey = '';
  syncViewGeometry(true);
  updateControlsUI();
  drawCurrentFrame();

  if (moveFocus) {
    if (targetView === 'list' && viewDetail.contains(document.activeElement)) {
      (listRows[state.selectedId] || listSearchInput)?.focus({ preventScroll: true });
    } else if (targetView === 'detail' && viewList.contains(document.activeElement)) {
      detailBackBtn.focus({ preventScroll: true });
    }
  }
}

// #region gutter-spring
export function isGutterStart(x, anyX = false) {
  return Boolean(anyX || x <= GUTTER_THRESHOLD_PX);
}

export function shouldCommitSwipe(progress, velocityPxPerSec) {
  return progress > 0.42 || (progress > 0.1 && velocityPxPerSec > 420);
}

function stepSpring(now) {
  state.rafId = 0;
  if (state.target === null || !state.onScreen || state.mode === 'plain') return;

  const dt = Math.min(0.032, Math.max(0.001, (now - state.lastTime) / 1000));
  state.lastTime = now;

  // Critically / lightly damped spring (stiffness 260, damping 30)
  const disp = state.target - state.progress;
  const accel = 260 * disp - 30 * state.velocity;
  state.velocity += accel * dt;
  state.progress = Math.max(0, Math.min(1, state.progress + state.velocity * dt));
  if (state.progress <= 0 && state.velocity < 0) { state.progress = 0; state.velocity = 0; }
  if (state.progress >= 1 && state.velocity > 0) { state.progress = 1; state.velocity = 0; }
  state.tilt *= Math.exp(-10 * dt);

  updateControlsUI();

  if (Math.abs(state.target - state.progress) < 0.0018 && Math.abs(state.velocity) < 0.012) {
    const endView = state.target >= 0.5 ? 'list' : 'detail';
    const focusAfter = Boolean(state.moveFocusOnSettle);
    state.moveFocusOnSettle = false;
    settleTo(endView, { moveFocus: focusAfter });
    return;
  }

  drawCurrentFrame();
  state.rafId = requestAnimationFrame(stepSpring);
}

function animateTo(target, initialVelocity = 0, { moveFocus = false } = {}) {
  const endView = target >= 0.5 ? 'list' : 'detail';
  if (isReducedMotion() || state.mode === 'plain') {
    settleTo(endView, { moveFocus });
    return;
  }
  cancelAnimationFrame(state.rafId);
  state.target = target;
  state.velocity = initialVelocity;
  state.moveFocusOnSettle = moveFocus;
  state.lastTime = performance.now();
  syncViewGeometry(true);
  state.rafId = requestAnimationFrame(stepSpring);
}

function finishDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;

  if (!d.locked) {
    updateControlsUI();
    return;
  }

  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);

  const commit = shouldCommitSwipe(state.progress, d.vx);
  const target = commit ? 1 : 0;
  const { cw } = getViewportSize();
  const vProg = Math.max(-4, Math.min(5, d.vx / Math.max(180, cw)));
  animateTo(target, vProg);
}

function startGutterDrag(e, lockedImmediate) {
  if (e.button !== 0 || state.mode === 'plain' || state.activeView !== 'detail') return;
  if (!lockedImmediate && e.target.closest('input, textarea, select')) return;

  const rect = viewportEl.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  if (!isGutterStart(localX, state.anyX)) return;

  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.target = null;
  state.velocity = 0;

  drag = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastT: performance.now(),
    vx: 0,
    locked: lockedImmediate,
    captureEl: lockedImmediate ? swipeGutter : viewportEl,
  };

  if (lockedImmediate) {
    swipeGutter.setPointerCapture(e.pointerId);
    syncViewGeometry(true);
  }
}

swipeGutter.addEventListener('pointerdown', (e) => {
  startGutterDrag(e, true);
});

viewportEl.addEventListener('pointerdown', (e) => {
  if (e.target === swipeGutter || !state.anyX) return;
  startGutterDrag(e, false);
});

addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;

  if (!drag.locked) {
    if (dx > 10 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      drag.locked = true;
      try { drag.captureEl.setPointerCapture(drag.id); } catch {}
      syncViewGeometry(true);
    } else if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
      drag = null;
      return;
    } else {
      return;
    }
  }

  const now = performance.now();
  const dt = Math.max(0.004, (now - drag.lastT) / 1000);
  const instVx = (e.clientX - drag.lastX) / dt;
  drag.vx = drag.vx * 0.45 + instVx * 0.55;
  drag.lastX = e.clientX;
  drag.lastT = now;

  const { cw, ch } = getViewportSize();
  const span = Math.max(160, cw - 36);
  state.progress = Math.max(0, Math.min(1, dx / span));
  state.tilt = Math.max(-0.22, Math.min(0.22, (dy / Math.max(200, ch)) * 0.7)) * Math.sin(Math.PI * state.progress);
  updateControlsUI();
  drawCurrentFrame();
});

addEventListener('pointerup', finishDrag);
addEventListener('pointercancel', finishDrag);
// #endregion gutter-spring

// Suppress stray click after an Any-x drag finishes over a control
viewportEl.addEventListener('click', (e) => {
  if (suppressNextClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

function openThread(id, { moveFocus = false } = {}) {
  state.selectedId = id;
  syncDetailUI();
  syncListUI();
  animateTo(0, -1.8, { moveFocus });
}

// App view interactions
detailBackBtn.addEventListener('click', () => {
  animateTo(1, 1.5, { moveFocus: true });
});

detailNoteInput.addEventListener('input', () => {
  THREADS[state.selectedId].note = detailNoteInput.value;
  drawCurrentFrame(true);
});

detailReadCheck.addEventListener('change', () => {
  THREADS[state.selectedId].read = detailReadCheck.checked;
  syncDetailUI();
  syncListUI();
  drawCurrentFrame(true);
});

detailPinCheck.addEventListener('change', () => {
  THREADS[state.selectedId].pin = detailPinCheck.checked;
  syncDetailUI();
  syncListUI();
  drawCurrentFrame(true);
});

detailCounterBtn.addEventListener('click', () => {
  THREADS[state.selectedId].acks++;
  syncDetailUI();
  drawCurrentFrame(true);
});

unreadOnlyBtn.addEventListener('click', () => {
  state.unreadOnly = !state.unreadOnly;
  syncListUI();
  drawCurrentFrame(true);
});

listSearchInput.addEventListener('input', () => {
  state.searchQuery = listSearchInput.value;
  syncListUI();
  drawCurrentFrame(true);
});

inboxListEl.addEventListener('click', (e) => {
  const row = e.target.closest('.inbox-row');
  if (!row) return;
  openThread(Number(row.dataset.id), { moveFocus: true });
});

// External inspection controls
toggleViewBtn.addEventListener('click', () => {
  if (state.activeView === 'detail') animateTo(1, 1.4);
  else animateTo(0, -1.6);
});

scrubSlider.addEventListener('input', () => {
  if (state.mode === 'plain') return;
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.target = null;
  state.velocity = 0;
  state.tilt = 0;
  state.progress = Number(scrubSlider.value) / 100;
  state.activeView = state.progress >= 0.5 ? 'list' : 'detail';
  scrubOut.textContent = `${Math.round(state.progress * 100)}%`;
  toggleViewBtn.textContent = state.activeView === 'detail' ? 'Peel back to Inbox' : 'Open thread detail';
  swipeGutter.style.pointerEvents = (state.activeView === 'detail' && state.progress <= 0.02) ? 'auto' : 'none';
  syncViewGeometry(true);
  drawCurrentFrame();
});

anyXToggle.addEventListener('change', () => {
  state.anyX = anyXToggle.checked;
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion() && state.target !== null) {
    settleTo(state.target >= 0.5 ? 'list' : 'detail');
  }
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
});

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(true, changed);
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  });
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the views in plain HTML.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      exitPlainFallback();
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: SWIPE_FRAG,
        onLost: () => {
          viewTextures.clear();
          enterPlainFallback('The WebGL 2 context was lost. Showing the views in plain HTML until restored.');
        },
        onRestored: () => {
          viewTextures.clear();
          state.mode = 'webgl';
          exitPlainFallback();
          state.lastGeoKey = '';
          syncViewGeometry(true);
          canvas.requestPaint?.();
        },
      });
      state.mode = 'webgl';
      wireCanvasEvents(canvas);
      syncViewGeometry(true);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'swipe-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(viewList, viewDetail);
      canvas.replaceWith(fresh);
      window.__gfx?.retire?.(canvas);
      canvas = fresh;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      if (noticeEl.hidden) {
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
      }
      wireCanvasEvents(canvas);
      syncViewGeometry(true);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so both screens are shown as plain HTML.');
}

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else if (state.mode !== 'plain') {
    if (state.target !== null && !state.rafId) {
      state.lastTime = performance.now();
      state.rafId = requestAnimationFrame(stepSpring);
    } else {
      drawCurrentFrame();
    }
  }
}).observe(stageBox);

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKey = '';
    const { cw, ch } = getViewportSize();
    syncScreenSizes(cw, ch);
    syncViewGeometry(true);
    drawCurrentFrame(true);
  }
}).observe(viewportEl);

// Initialise UI and rendering backend
syncListUI();
syncDetailUI();
updateControlsUI();
initBackend();

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function makeFixtureCanvas(w = 240, h = 300) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const listFix = document.createElement('section');
  listFix.setAttribute('drawable', '');
  listFix.inert = true;
  listFix.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:14px;box-sizing:border-box;pointer-events:none;` +
    'background:linear-gradient(90deg,#38bdf8 0%,#38bdf8 34%,#34d399 34%,#34d399 100%);color:#0f172a;font:700 13px system-ui';
  const search = document.createElement('input');
  search.type = 'search';
  search.setAttribute('inputmode', 'none');
  search.setAttribute('aria-label', 'Fixture search');
  search.value = 'parallax';
  search.style.cssText = 'display:block;width:160px;height:36px;margin-bottom:10px;box-sizing:border-box';
  const rowBtn = document.createElement('button');
  rowBtn.type = 'button';
  rowBtn.textContent = 'Open item';
  rowBtn.style.cssText = 'display:block;width:160px;height:40px';
  listFix.append(search, rowBtn);

  const detailFix = document.createElement('section');
  detailFix.setAttribute('drawable', '');
  detailFix.inert = false;
  detailFix.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;padding:14px 14px 14px 40px;box-sizing:border-box;pointer-events:auto;` +
    'background:#ffffff;color:#18181b;font:700 13px system-ui';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.textContent = 'Back';
  backBtn.style.cssText = 'display:block;width:120px;height:38px;margin-bottom:10px';
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.setAttribute('inputmode', 'none');
  noteInput.setAttribute('aria-label', 'Fixture note');
  noteInput.value = 'Detail note';
  noteInput.style.cssText = 'display:block;width:160px;height:36px;box-sizing:border-box';
  detailFix.append(backBtn, noteInput);

  cv.append(listFix, detailFix);
  return { cv, listFix, detailFix, search, rowBtn, backBtn, noteInput };
}

runTests(testsBody, [
  {
    name: 'ElementGL uploads both #view-list and #view-detail via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), uploads both drawable views with texElementSubImage2D(), draws one frame and checks gl.getError().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const { cv, listFix, detailFix } = makeFixtureCanvas(220, 280);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SWIPE_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const tList = g.upload(listFix);
        const tDetail = g.upload(detailFix);
        const p = peelParameters(220, 280, 0, 0);
        g.begin([0, 0, 0, 0]);
        g.quad(detailFix, ElementGL.rect(cv, 0, 0, 220, 280), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tList.tex);
          gl.uniform1i(loc('uListTex'), 1);
          gl.uniform2f(loc('uCanvasSize'), 220, 280);
          gl.uniform1f(loc('uProgress'), p.p);
          gl.uniform1f(loc('uFoldS'), p.foldS);
          gl.uniform1f(loc('uRadius'), p.radius);
          gl.uniform2f(loc('uDir'), p.dirX, p.dirY);
        });
        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR && tList?.w > 0 && tDetail?.w > 0,
          `gl.getError()=${err}, #view-list ${tList?.w}x${tList?.h}, #view-detail ${tDetail?.w}x${tDetail?.h}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Inset gutter threshold distinguishes edge-swipe start (x <= 32) from central tap controls cleanly',
    expect: 'pass',
    why: 'Checks isGutterStart(x, anyX) across boundary x values and verifies on a testStage() fixture that x=16 lands in the gutter while controls at x >= 40 stay clear.',
    run: async () => {
      const { cv, detailFix, backBtn, noteInput } = makeFixtureCanvas(240, 280);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:240px;height:280px';
      const gutter = document.createElement('div');
      gutter.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:32px;z-index:2;touch-action:none';
      wrap.append(cv, gutter);
      testStage().append(wrap);
      let g = null;
      try {
        if (hicSupported && glSupported) {
          g = new ElementGL(cv, { fragment: SWIPE_FRAG });
          await nextPaint(cv);
          g.upload(detailFix);
          const u = geometryUnit(cv, detailFix, 240);
          cv.updateElementGeometry?.(detailFix, { canvasTransform: new DOMMatrix().scale(u, u) });
          detailFix.dataset.hitTick = '1';
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = wrap.getBoundingClientRect();
        const gutterOk = isGutterStart(0, false) && isGutterStart(32, false) && !isGutterStart(33, false) && isGutterStart(120, true);
        const gutterHit = document.elementsFromPoint(r.left + 16, r.top + 80);
        const backR = backBtn.getBoundingClientRect();
        const noteR = noteInput.getBoundingClientRect();
        const backLocalX = backR.left - r.left + backR.width * 0.5;
        const noteLocalX = noteR.left - r.left + noteR.width * 0.5;
        const backHits = document.elementsFromPoint(backR.left + backR.width * 0.5, backR.top + backR.height * 0.5);
        const noteHits = document.elementsFromPoint(noteR.left + noteR.width * 0.5, noteR.top + noteR.height * 0.5);
        return need(
          gutterOk &&
          gutterHit.includes(gutter) &&
          !isGutterStart(backLocalX, false) &&
          !isGutterStart(noteLocalX, false) &&
          backHits.includes(backBtn) &&
          noteHits.includes(noteInput),
          `x<=32=${isGutterStart(32, false)}, x=33=${isGutterStart(33, false)}, Back at x=${backLocalX.toFixed(0)} px, Note at x=${noteLocalX.toFixed(0)} px.`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Cylindrical page-curl fold draws underside shadow and parallax underlying view cleanly at progress = 0.5',
    expect: 'pass',
    why: 'Renders the two-view shader at progress=0.5 on testStage() and samples readPixels() across the parallaxed underlying band, the cast shadow, the cream underside flap and flat detail.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240, H = 300;
      const { cv, listFix, detailFix } = makeFixtureCanvas(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SWIPE_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const tList = g.upload(listFix);
        g.upload(detailFix);
        const params = peelParameters(W, H, 0.5, 0);
        g.begin([0, 0, 0, 0]);
        g.quad(detailFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tList.tex);
          gl.uniform1i(loc('uListTex'), 1);
          gl.uniform2f(loc('uCanvasSize'), W, H);
          gl.uniform1f(loc('uProgress'), params.p);
          gl.uniform1f(loc('uFoldS'), params.foldS);
          gl.uniform1f(loc('uRadius'), params.radius);
          gl.uniform2f(loc('uDir'), params.dirX, params.dirY);
        });
        const err = g.gl.getError();
        const scaleX = cv.width / W;
        const py = Math.floor(cv.height * 0.5);
        const sampleX = (cssX) => {
          const px = new Uint8Array(4);
          const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * scaleX)));
          g.gl.readPixels(rx, py, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, px);
          return px;
        };
        const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

        // foldX in [0..W] = params.sHalf + params.foldS
        const foldX = params.sHalf + params.foldS;
        const leftSky = sampleX(20); // listUv.x ~ 0.203 (sky blue #38bdf8)
        const midParallax = sampleX(64); // listUv.x ~ 0.387 (shifted past 34% split into emerald #34d399)
        const castShadow = sampleX(foldX - params.radius - 4); // emerald darkened by cylinder cast shadow
        const creamFlap = sampleX(foldX + 16); // turned-over cream paper underside
        const flatDetail = sampleX(218); // flat white #view-detail

        const parallaxShiftOk = leftSky[2] > leftSky[1] && midParallax[1] > midParallax[2];
        const shadowOk = lum(castShadow) < lum(midParallax) - 22;
        const creamOk = creamFlap[0] > 180 && creamFlap[1] > 170 && creamFlap[2] > 150;
        const flatOk = flatDetail[0] > 230 && flatDetail[1] > 230 && flatDetail[2] > 230;
        return need(
          err === g.gl.NO_ERROR && parallaxShiftOk && shadowOk && creamOk && flatOk,
          `sky=[${leftSky.slice(0, 3)}], parallax=[${midParallax.slice(0, 3)}], shadowLum=${lum(castShadow).toFixed(0)}<${lum(midParallax).toFixed(0)}, cream=[${creamFlap.slice(0, 3)}], flat=[${flatDetail.slice(0, 3)}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps active screen controls clickable via elementsFromPoint() before and after navigating back',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled updateElementGeometry() and inert toggling on a fixture with #view-detail active first, then #view-list after navigating back, verifying hits on buttons and inputs.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 240, H = 300;
      const { cv, listFix, detailFix, search, rowBtn, backBtn, noteInput } = makeFixtureCanvas(W, H);
      testStage().append(cv);
      let g = null;
      let ctx = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: SWIPE_FRAG });
        } else {
          ctx = cv.getContext('2d');
        }
        await nextPaint(cv);
        const syncFix = (showList) => {
          listFix.inert = !showList;
          detailFix.inert = showList;
          listFix.style.pointerEvents = showList ? 'auto' : 'none';
          detailFix.style.pointerEvents = !showList ? 'auto' : 'none';
          if (g) {
            const tList = g.upload(listFix);
            const tDetail = g.upload(detailFix);
            const p = peelParameters(W, H, showList ? 1 : 0, 0);
            g.begin([0, 0, 0, 0]);
            g.quad(detailFix, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, tList.tex);
              gl.uniform1i(loc('uListTex'), 1);
              gl.uniform2f(loc('uCanvasSize'), W, H);
              gl.uniform1f(loc('uProgress'), p.p);
              gl.uniform1f(loc('uFoldS'), p.foldS);
              gl.uniform1f(loc('uRadius'), p.radius);
              gl.uniform2f(loc('uDir'), p.dirX, p.dirY);
            });
            const u = geometryUnit(cv, showList ? listFix : detailFix, W);
            cv.updateElementGeometry(listFix, { canvasTransform: new DOMMatrix().scale(u, u) });
            cv.updateElementGeometry(detailFix, { canvasTransform: new DOMMatrix().scale(u, u) });
            listFix.dataset.hitTick = listFix.dataset.hitTick === '1' ? '0' : '1';
            detailFix.dataset.hitTick = detailFix.dataset.hitTick === '1' ? '0' : '1';
          } else if (ctx) {
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawElementImage(showList ? listFix : detailFix, 0, 0, W, H);
          }
        };

        const centerHit = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };

        // Step A: Detail view on top
        syncFix(false);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const beforeBackOk = centerHit(backBtn).includes(backBtn);
        const beforeNoteOk = centerHit(noteInput).includes(noteInput);

        // Step B: Navigated back to Inbox list
        syncFix(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const afterSearchHits = centerHit(search);
        const afterRowHits = centerHit(rowBtn);
        const afterSearchOk = afterSearchHits.includes(search) && !afterSearchHits.includes(backBtn);
        const afterRowOk = afterRowHits.includes(rowBtn) && !afterRowHits.includes(noteInput);

        return need(
          beforeBackOk && beforeNoteOk && afterSearchOk && afterRowOk,
          `before(Back=${beforeBackOk}, Note=${beforeNoteOk}); after(Search=${afterSearchOk}, Row=${afterRowOk}).`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'edge-swipe stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || viewTextures.size < 2) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
]);
