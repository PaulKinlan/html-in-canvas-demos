import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

// #region envelope
export function createBleedState() {
  return {
    progress: 0,
    invert: false,
    originX: 0.5,
    originY: 0.5,
    feather: 1.0,
    turbulence: 1.0,
    anim: {
      active: false,
      startMs: 0,
      durationMs: 1350,
      fromProgress: 0,
      toProgress: 1,
    },
  };
}

export function launchBleed(bleedState, {
  originX = bleedState.originX,
  originY = bleedState.originY,
  targetProgress = 1,
  tMs = 0,
  durationMs = 1350,
  reduced = false,
} = {}) {
  bleedState.originX = clamp(originX, 0.04, 0.96);
  bleedState.originY = clamp(originY, 0.04, 0.96);
  const to = clamp(targetProgress, 0, 1);

  if (reduced) {
    bleedState.progress = to;
    bleedState.anim.active = false;
    bleedState.anim.startMs = tMs;
    bleedState.anim.durationMs = durationMs;
    bleedState.anim.fromProgress = to;
    bleedState.anim.toProgress = to;
    return { active: false, progress: to, envelope: 0 };
  }

  bleedState.anim.active = true;
  bleedState.anim.startMs = tMs;
  bleedState.anim.durationMs = Math.max(120, durationMs);
  bleedState.anim.fromProgress = bleedState.progress;
  bleedState.anim.toProgress = to;
  return {
    active: true,
    progress: bleedState.progress,
    envelope: Math.sin(Math.PI * bleedState.progress),
  };
}

export function stepBleed(bleedState, tMs, reduced = false) {
  if (!bleedState.anim.active) {
    return {
      active: false,
      progress: bleedState.progress,
      envelope: Math.sin(Math.PI * bleedState.progress),
    };
  }
  if (reduced) {
    bleedState.progress = bleedState.anim.toProgress;
    bleedState.anim.active = false;
    return { active: false, progress: bleedState.progress, envelope: 0 };
  }

  const raw = clamp((tMs - bleedState.anim.startMs) / Math.max(1, bleedState.anim.durationMs), 0, 1);
  const eased = 1 - Math.pow(1 - raw, 2.15);
  bleedState.progress = lerp(bleedState.anim.fromProgress, bleedState.anim.toProgress, eased);
  if (raw >= 1) {
    bleedState.progress = bleedState.anim.toProgress;
    bleedState.anim.active = false;
  }
  return {
    active: bleedState.anim.active,
    progress: bleedState.progress,
    envelope: Math.sin(Math.PI * bleedState.progress),
  };
}
// #endregion envelope

// #region shader
export const INK_BLEED_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;       // Scene A (Cream Paper Notebook)
uniform sampler2D uSceneBTex; // Scene B (Midnight Obsidian Studio)
uniform vec2 uSize;
uniform float uTime;
uniform float uProgress;      // 0 = Scene A, 1 = Scene B
uniform float uInvert;        // 0 = A -> B from origin, 1 = B -> A from origin
uniform vec2 uOrigin;         // Normalized tap origin (ox, oy) in 0..1
uniform float uFeather;       // 0.2 .. 2.0
uniform float uTurbulence;    // 0.0 .. 2.0
uniform float uReduced;       // 1.0 when reduced motion is active

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = rot * p * 2.03 + vec2(13.1, 7.7);
    amp *= 0.5;
  }
  return sum;
}

vec3 unpremul(vec4 c) {
  return c.a > 0.002 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0);
}

void sampleDomField(sampler2D tex, vec2 uv, vec2 texel, out float lumC, out float edgeMag) {
  vec3 cC = unpremul(texture(tex, clamp(uv, vec2(0.0), vec2(1.0))));
  vec3 cE = unpremul(texture(tex, clamp(uv + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))));
  vec3 cW = unpremul(texture(tex, clamp(uv - vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))));
  vec3 cN = unpremul(texture(tex, clamp(uv - vec2(0.0, texel.y), vec2(0.0), vec2(1.0))));
  vec3 cS = unpremul(texture(tex, clamp(uv + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))));
  vec3 lumaW = vec3(0.299, 0.587, 0.114);
  lumC = dot(cC, lumaW);
  float dx = abs(dot(cE - cW, lumaW));
  float dy = abs(dot(cN - cS, lumaW));
  edgeMag = clamp((dx + dy) * 2.4, 0.0, 1.0);
}

void main() {
  if (uProgress <= 0.0005) {
    outColor = texture(uTex, clamp(vUv, vec2(0.0), vec2(1.0)));
    return;
  }
  if (uProgress >= 0.9995) {
    outColor = texture(uSceneBTex, clamp(vUv, vec2(0.0), vec2(1.0)));
    return;
  }

  float bleed = uInvert > 0.5 ? (1.0 - uProgress) : uProgress;
  vec4 aRaw = texture(uTex, clamp(vUv, vec2(0.0), vec2(1.0)));
  vec4 bRaw = texture(uSceneBTex, clamp(vUv, vec2(0.0), vec2(1.0)));
  vec4 srcRaw = uInvert > 0.5 ? bRaw : aRaw;
  vec4 dstRaw = uInvert > 0.5 ? aRaw : bRaw;

  vec2 texel = 1.5 / max(uSize, vec2(1.0));
  float srcLum = 0.5;
  float domEdge = 0.0;
  if (uInvert > 0.5) {
    sampleDomField(uSceneBTex, vUv, texel, srcLum, domEdge);
  } else {
    sampleDomField(uTex, vUv, texel, srcLum, domEdge);
  }

  vec2 pCss = vUv * max(uSize, vec2(1.0));
  vec2 origCss = clamp(uOrigin, vec2(0.0), vec2(1.0)) * max(uSize, vec2(1.0));
  float maxDist = max(
    max(length(origCss), length(vec2(uSize.x - origCss.x, origCss.y))),
    max(length(vec2(origCss.x, uSize.y - origCss.y)), length(uSize - origCss))
  ) + 12.0;
  float distNorm = length(pCss - origCss) / max(1.0, maxDist);

  float activeEnv = smoothstep(0.0, 0.06, bleed) * smoothstep(1.0, 0.88, bleed);

  // Domain-warped multi-octave FBM paper-fibre permeability
  vec2 fibreUv = pCss * 0.022;
  float creep = (1.0 - uReduced) * sin(uTime * 0.9) * 0.04;
  vec2 warp = vec2(
    fbm(fibreUv * 1.15 + vec2(1.7 + creep, 9.2)),
    fbm(fibreUv * 1.15 + vec2(8.3, 2.8 - creep))
  );
  float macroFbm = fbm(fibreUv + (warp - 0.5) * 1.65);
  float threadX = fbm(vec2(pCss.x * 0.015, pCss.y * 0.085) + warp * 0.85);
  float threadY = fbm(vec2(pCss.x * 0.085, pCss.y * 0.015) - warp * 0.85);
  float microVein = fbm(pCss * 0.075 + warp * 2.1);
  float fibrePerm = (macroFbm - 0.5) * 0.62
                  + (max(threadX, threadY) - 0.5) * 0.24
                  + (microVein - 0.5) * 0.22;

  // Bright open paper margins bleed slightly faster; DOM luminance edges wick ink along lines
  float marginBias = (srcLum - 0.5) * 0.055 + domEdge * 0.048;
  float frontPos = mix(-0.18, 1.24, bleed);
  float signedFront = frontPos - distNorm + fibrePerm * 0.24 * uTurbulence * activeEnv + marginBias * activeEnv;

  float fScale = clamp(uFeather, 0.15, 2.2);
  float dampW = 0.062 * fScale;
  float rimCenter = 0.014 * fScale;
  float rimHalf = 0.024 * fScale;

  // Damp moisture fringe immediately ahead of the advancing pigment boundary
  float dampFringe = smoothstep(-dampW, 0.0, signedFront) * (1.0 - smoothstep(0.0, rimCenter, signedFront));
  vec3 srcRgb = unpremul(srcRaw);
  vec3 dstRgb = unpremul(dstRaw);
  vec3 dampTint = uInvert > 0.5 ? vec3(0.56, 0.70, 0.84) : vec3(0.75, 0.70, 0.61);
  vec3 srcDampened = srcRgb * mix(vec3(1.0), dampTint, dampFringe * 0.56 * activeEnv);

  // Crisp target scene revealed inside the wet rim
  float reveal = smoothstep(rimCenter - 0.006 * fScale, rimCenter + 0.036 * fScale, signedFront);
  vec3 baseRgb = mix(srcDampened, dstRgb, reveal);

  // Dark wet sumi-indigo capillary pigment rim, strictly darker than both Scene A and Scene B
  float rimMask = exp(-pow((signedFront - rimCenter) / max(0.006, rimHalf), 2.0)) * activeEnv;
  vec3 wetPigment = vec3(0.008, 0.012, 0.020);
  float pigmentAlpha = clamp(rimMask * 0.97, 0.0, 0.97);
  vec3 finalRgb = mix(baseRgb, wetPigment, pigmentAlpha);

  // Faint iridescent cyan-indigo capillary sheen trailing the wet crest
  float innerSheen = smoothstep(rimCenter + 0.008 * fScale, rimCenter + 0.024 * fScale, signedFront)
                   * (1.0 - smoothstep(rimCenter + 0.024 * fScale, rimCenter + 0.058 * fScale, signedFront))
                   * activeEnv;
  finalRgb = mix(finalRgb, finalRgb + vec3(0.02, 0.14, 0.20), innerSheen * 0.34);

  float outAlpha = max(mix(srcRaw.a, dstRaw.a, reveal), pigmentAlpha * max(srcRaw.a, dstRaw.a));
  outColor = vec4(clamp(finalRgb, 0.0, 1.0) * outAlpha, outAlpha);
}`;
// #endregion shader

function mountInkBleed() {
  banner();

  const stageBox = document.getElementById('ib-stage');
  const viewportEl = document.getElementById('ib-viewport');
  let canvas = document.getElementById('ib-canvas');
  const sceneA = document.getElementById('ib-scene-a');
  const sceneB = document.getElementById('ib-scene-b');
  const plainHost = document.getElementById('plain-host');

  // Scene A live controls
  const aNoteInput = document.getElementById('ib-a-note');
  const aStampBtn = document.getElementById('ib-a-stamp');
  const aBookmarkBtn = document.getElementById('ib-a-bookmark');
  const aBadgeEl = document.getElementById('ib-a-badge');
  const aEchoEl = document.getElementById('ib-a-echo');

  // Scene B live controls
  const bTitleInput = document.getElementById('ib-b-title');
  const bDropBtn = document.getElementById('ib-b-drop');
  const bGridBtn = document.getElementById('ib-b-grid');
  const bReturnBtn = document.getElementById('ib-b-return');
  const bBadgeEl = document.getElementById('ib-b-badge');
  const bEchoEl = document.getElementById('ib-b-echo');

  // External controls
  const pourBtn = document.getElementById('ib-pour');
  const invertCheck = document.getElementById('ib-invert');
  const reducedCheck = document.getElementById('ib-reduced');
  const scrubInput = document.getElementById('ib-scrub');
  const scrubOut = document.getElementById('ib-scrub-out');
  const featherInput = document.getElementById('ib-feather');
  const featherOut = document.getElementById('ib-feather-out');
  const turbInput = document.getElementById('ib-turb');
  const turbOut = document.getElementById('ib-turb-out');
  const noticeEl = document.getElementById('ib-notice');
  const statusEl = document.getElementById('ib-status');
  const testsBody = document.getElementById('tests');

  const reducedQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  if (reducedQuery.matches) reducedCheck.checked = true;

  const bleed = createBleedState();
  const dirtyScenes = new Set([sceneA, sceneB]);
  const viewTextures = new Map();

  const state = {
    mode: 'init', // 'webgl' | '2d' | 'plain'
    hasPainted: false,
    onScreen: true,
    stamps: 0,
    bookmarked: false,
    drops: 0,
    studioGrid: false,
    uploads: 0,
    paints: 0,
    rafId: 0,
    unitCache: { key: '', unit: 1 },
    lastGeoKey: '',
    tapPointer: null,
  };

  let stage = null;
  let ctx2d = null;

  const isReducedMotion = () => Boolean(reducedCheck.checked || reducedQuery.matches);

  function showNotice(text) {
    noticeEl.hidden = !text;
    noticeEl.textContent = text || '';
  }

  function getViewportSize() {
    const cw = Math.max(120, Math.round(canvas.clientWidth || viewportEl.clientWidth || 360));
    const ch = Math.max(120, Math.round(canvas.clientHeight || viewportEl.clientHeight || 440));
    return { cw, ch };
  }

  function syncSceneSizes(cw, ch) {
    if (state.mode === 'plain') {
      for (const el of [sceneA, sceneB]) {
        if (el.style.width) el.style.width = '';
        if (el.style.height) el.style.height = '';
      }
      return;
    }
    const w = `${cw}px`;
    const h = `${ch}px`;
    for (const el of [sceneA, sceneB]) {
      if (el.style.width !== w) el.style.width = w;
      if (el.style.height !== h) el.style.height = h;
    }
  }

  function syncSceneContentDOM() {
    aStampBtn.textContent = `Stamp folio (${state.stamps})`;
    aBookmarkBtn.setAttribute('aria-pressed', String(state.bookmarked));
    aBookmarkBtn.textContent = state.bookmarked ? 'Bookmarked' : 'Bookmark';
    const stampLabel = `${state.stamps} ${state.stamps === 1 ? 'stamp' : 'stamps'}`;
    aBadgeEl.textContent = state.bookmarked ? `Saved · ${stampLabel}` : stampLabel;
    aEchoEl.textContent = `Note: ${aNoteInput.value || '(empty)'}`;

    bDropBtn.textContent = `Tint cyan (${state.drops})`;
    bGridBtn.setAttribute('aria-pressed', String(state.studioGrid));
    sceneB.classList.toggle('has-grid', state.studioGrid);
    const dropLabel = `${state.drops} ${state.drops === 1 ? 'drop' : 'drops'}`;
    bBadgeEl.textContent = `Cyan #38E8FF · ${dropLabel}`;
    bEchoEl.textContent = `Plate: ${bTitleInput.value || '(untitled)'}`;
  }

  function updateControlsUI() {
    const pct = Math.round(bleed.progress * 100);
    scrubInput.value = String(pct);
    scrubOut.textContent = `${pct}%`;
    invertCheck.checked = bleed.invert;
    featherOut.textContent = `${bleed.feather.toFixed(2)}x`;
    turbOut.textContent = `${bleed.turbulence.toFixed(2)}x`;
    pourBtn.textContent = bleed.invert ? 'Pour ink (B -> A)' : 'Pour ink (A -> B)';
  }

  function updateStatus() {
    const routeLabel = state.mode === 'webgl'
      ? 'WebGL 2 ElementGL'
      : state.mode === '2d'
        ? '2D drawElementImage()'
        : 'Plain HTML';
    const pct = Math.round(bleed.progress * 100);
    const activeLabel = pct <= 1
      ? 'Scene A (Paper)'
      : pct >= 99
        ? 'Scene B (Studio)'
        : `${bleed.invert ? 'B -> A' : 'A -> B'} ${pct}%`;
    const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
    const ox = Math.round(bleed.originX * 100);
    const oy = Math.round(bleed.originY * 100);
    statusEl.textContent =
      `${routeLabel} · ${activeLabel} · origin (${ox}%, ${oy}%) · ${canvas.width}x${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
  }

  function markSceneDirty(sceneEl) {
    dirtyScenes.add(sceneEl);
    if (state.mode !== 'plain') {
      canvas.requestPaint?.();
    }
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

  function syncSceneGeometry(force = false) {
    if (state.mode === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;
    const { cw, ch } = getViewportSize();
    const settledA = bleed.progress <= 0.01 && !bleed.anim.active;
    const settledB = bleed.progress >= 0.99 && !bleed.anim.active;

    if (sceneA.inert !== !settledA) sceneA.inert = !settledA;
    if (sceneB.inert !== !settledB) sceneB.inert = !settledB;
    const peA = settledA ? 'auto' : 'none';
    const peB = settledB ? 'auto' : 'none';
    if (sceneA.style.pointerEvents !== peA) sceneA.style.pointerEvents = peA;
    if (sceneB.style.pointerEvents !== peB) sceneB.style.pointerEvents = peB;

    if (!state.hasPainted) return;
    const geoKey = `${cw}x${ch}|${settledA ? 1 : 0}|${settledB ? 1 : 0}`;
    if (!force && geoKey === state.lastGeoKey) return;
    state.lastGeoKey = geoKey;

    const refEl = settledB ? sceneB : sceneA;
    const u = cachedUnit(cw, refEl);
    const mat = new DOMMatrix().scale(u, u);
    canvas.updateElementGeometry(sceneA, { canvasTransform: mat });
    canvas.updateElementGeometry(sceneB, { canvasTransform: mat });
    sceneA.dataset.hitTick = sceneA.dataset.hitTick === '1' ? '0' : '1';
    sceneB.dataset.hitTick = sceneB.dataset.hitTick === '1' ? '0' : '1';
  }
  // #endregion geometry-sync

  // #region gl-upload
  function tryUploadScene(el) {
    if (!state.hasPainted || !stage || stage.lost) return null;
    try {
      const tex = stage.upload(el);
      if (tex) {
        viewTextures.set(el, tex);
        dirtyScenes.delete(el);
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

  function renderWebGL(changedSet = null) {
    if (!state.hasPainted || !stage || stage.lost) return;
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);

    if (!stage.begin([0, 0, 0, 0])) return;

    if (changedSet || dirtyScenes.size > 0 || !viewTextures.has(sceneA) || !viewTextures.has(sceneB)) {
      for (const el of [sceneA, sceneB]) {
        if ((changedSet && changedSet.has(el)) || dirtyScenes.has(el) || !viewTextures.has(el)) {
          tryUploadScene(el);
        }
      }
    }

    const texA = viewTextures.get(sceneA);
    const texB = viewTextures.get(sceneB);
    if (!texA || !texB) return;

    stage.quad(sceneA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB.tex);
      gl.uniform1i(loc('uSceneBTex'), 1);
      gl.uniform1f(loc('uProgress'), bleed.progress);
      gl.uniform1f(loc('uInvert'), bleed.invert ? 1.0 : 0.0);
      gl.uniform2f(loc('uOrigin'), bleed.originX, bleed.originY);
      gl.uniform1f(loc('uFeather'), bleed.feather);
      gl.uniform1f(loc('uTurbulence'), bleed.turbulence);
      gl.uniform1f(loc('uReduced'), isReducedMotion() ? 1.0 : 0.0);
    });

    syncSceneGeometry(false);
    state.paints++;
    updateStatus();
  }
  // #endregion gl-upload

  // #region fallback-2d
  function traceOrganicPool(ctx, ox, oy, radius, turb, feather) {
    const steps = 48;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const lobe = 1 + turb * 0.14 * (Math.sin(a * 5 + 0.8) + 0.55 * Math.cos(a * 11 - 1.3));
      const r = Math.max(0, radius * lobe + feather * 4);
      const px = ox + Math.cos(a) * r;
      const py = oy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function render2DFallback() {
    if (!state.hasPainted || !ctx2d) return;
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    const p = clamp(bleed.progress, 0, 1);
    const inv = bleed.invert;
    const bleedFrac = inv ? 1 - p : p;
    const baseEl = inv ? sceneB : sceneA;
    const revealEl = inv ? sceneA : sceneB;

    ctx2d.save();
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, cw, ch);

    if (bleedFrac <= 0.001) {
      ctx2d.drawElementImage(baseEl, 0, 0, cw, ch);
    } else if (bleedFrac >= 0.999) {
      ctx2d.drawElementImage(revealEl, 0, 0, cw, ch);
    } else {
      ctx2d.drawElementImage(baseEl, 0, 0, cw, ch);

      const ox = bleed.originX * cw;
      const oy = bleed.originY * ch;
      const maxR = Math.max(
        Math.hypot(ox, oy),
        Math.hypot(cw - ox, oy),
        Math.hypot(ox, ch - oy),
        Math.hypot(cw - ox, ch - oy)
      ) + 16;
      const r = maxR * bleedFrac;

      ctx2d.save();
      traceOrganicPool(ctx2d, ox, oy, r, bleed.turbulence, bleed.feather);
      ctx2d.clip();
      ctx2d.drawElementImage(revealEl, 0, 0, cw, ch);
      ctx2d.restore();

      const rimW = 8 * clamp(bleed.feather, 0.3, 2.0);
      ctx2d.save();
      traceOrganicPool(ctx2d, ox, oy, r, bleed.turbulence, bleed.feather);
      ctx2d.lineWidth = rimW;
      ctx2d.strokeStyle = 'rgba(4, 7, 13, 0.92)';
      ctx2d.stroke();
      ctx2d.lineWidth = rimW * 2.1;
      ctx2d.strokeStyle = inv ? 'rgba(56, 232, 255, 0.16)' : 'rgba(62, 48, 30, 0.20)';
      ctx2d.stroke();
      ctx2d.restore();
    }

    ctx2d.restore();
    syncSceneGeometry(false);
    state.paints++;
    updateStatus();
  }

  function enterPlainFallback(reason) {
    state.mode = 'plain';
    stopLoop();
    stageBox.classList.add('is-plain');
    for (const el of [sceneA, sceneB]) {
      if (el.parentElement !== plainHost) plainHost.append(el);
    }
    syncSceneSizes(0, 0);
    const showB = bleed.progress >= 0.5;
    sceneA.dataset.active = String(!showB);
    sceneB.dataset.active = String(showB);
    sceneA.inert = showB;
    sceneB.inert = !showB;
    sceneA.style.pointerEvents = showB ? 'none' : 'auto';
    sceneB.style.pointerEvents = showB ? 'auto' : 'none';
    showNotice(reason);
    updateControlsUI();
    updateStatus();
  }

  function exitPlainFallback() {
    stageBox.classList.remove('is-plain');
    for (const el of [sceneA, sceneB]) {
      delete el.dataset.active;
      if (el.parentElement !== canvas) canvas.append(el);
    }
    showNotice('');
  }
  // #endregion fallback-2d

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function drawCurrentFrame(forcePaint = false) {
    if (state.mode === 'plain') {
      enterPlainFallback(noticeEl.textContent || '');
      return;
    }
    if (!state.hasPainted) {
      canvas.requestPaint?.();
      return;
    }
    if (state.mode === 'webgl' && stage && !stage.lost) {
      if (!forcePaint && viewTextures.size === 2 && dirtyScenes.size === 0) {
        renderWebGL(null);
      } else {
        canvas.requestPaint?.();
      }
      return;
    }
    if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  }

  function tick(nowMs) {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.mode === 'plain') return;
    const step = stepBleed(bleed, nowMs, isReducedMotion());
    updateControlsUI();
    syncSceneGeometry(false);
    drawCurrentFrame(false);
    if (step.active) {
      state.rafId = requestAnimationFrame(tick);
    } else {
      syncSceneGeometry(true);
      drawCurrentFrame(false);
    }
  }

  function startLoop() {
    if (state.rafId || !bleed.anim.active || !state.onScreen || document.hidden || state.mode === 'plain') return;
    state.rafId = requestAnimationFrame(tick);
  }

  function triggerPour({ ox = bleed.originX, oy = bleed.originY, direction = null, tMs = performance.now() } = {}) {
    if (direction === 'b-to-a') bleed.invert = true;
    else if (direction === 'a-to-b') bleed.invert = false;

    const target = bleed.invert ? 0 : 1;
    if (!bleed.invert && bleed.progress >= 0.99) bleed.progress = 0;
    if (bleed.invert && bleed.progress <= 0.01) bleed.progress = 1;

    if (state.mode === 'plain') {
      bleed.originX = clamp(ox, 0.04, 0.96);
      bleed.originY = clamp(oy, 0.04, 0.96);
      bleed.progress = target;
      bleed.anim.active = false;
      enterPlainFallback(noticeEl.textContent || '');
      return;
    }

    launchBleed(bleed, {
      originX: ox,
      originY: oy,
      targetProgress: target,
      tMs,
      durationMs: 1350,
      reduced: isReducedMotion(),
    });
    updateControlsUI();
    syncSceneGeometry(true);
    drawCurrentFrame(false);
    startLoop();
  }

  function normalizedTapPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ox: 0.5, oy: 0.5 };
    return {
      ox: clamp((clientX - rect.left) / rect.width, 0.04, 0.96),
      oy: clamp((clientY - rect.top) / rect.height, 0.04, 0.96),
    };
  }

  function shouldIgnoreStageTap(target) {
    return Boolean(target?.closest?.('button, input, textarea, select, a, label'));
  }

  // Prevent browser selection highlight when tapping or dragging on non-input stage chrome
  viewportEl.addEventListener('selectstart', (e) => {
    if (!e.target?.closest?.('input, textarea')) {
      e.preventDefault();
    }
  });

  viewportEl.addEventListener('pointerdown', (e) => {
    if (state.mode === 'plain') return;
    if (shouldIgnoreStageTap(e.target)) {
      state.tapPointer = null;
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      const { ox, oy } = normalizedTapPoint(e.clientX, e.clientY);
      const dir = bleed.progress >= 0.5 ? 'b-to-a' : 'a-to-b';
      triggerPour({ ox, oy, direction: dir });
      return;
    }
    state.tapPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });

  viewportEl.addEventListener('pointerup', (e) => {
    const tp = state.tapPointer;
    if (!tp || e.pointerId !== tp.id) return;
    state.tapPointer = null;
    if (shouldIgnoreStageTap(e.target)) return;
    if (Math.hypot(e.clientX - tp.x, e.clientY - tp.y) > 14) return;
    const { ox, oy } = normalizedTapPoint(e.clientX, e.clientY);
    const dir = bleed.progress >= 0.5 ? 'b-to-a' : 'a-to-b';
    triggerPour({ ox, oy, direction: dir });
  });

  viewportEl.addEventListener('pointercancel', () => {
    state.tapPointer = null;
  });

  // Live Scene A DOM events
  aNoteInput.addEventListener('input', () => {
    syncSceneContentDOM();
    markSceneDirty(sceneA);
  });
  aStampBtn.addEventListener('click', () => {
    state.stamps++;
    syncSceneContentDOM();
    markSceneDirty(sceneA);
  });
  aBookmarkBtn.addEventListener('click', () => {
    state.bookmarked = !state.bookmarked;
    syncSceneContentDOM();
    markSceneDirty(sceneA);
  });

  // Live Scene B DOM events
  bTitleInput.addEventListener('input', () => {
    syncSceneContentDOM();
    markSceneDirty(sceneB);
  });
  bDropBtn.addEventListener('click', () => {
    state.drops++;
    syncSceneContentDOM();
    markSceneDirty(sceneB);
  });
  bGridBtn.addEventListener('click', () => {
    state.studioGrid = !state.studioGrid;
    syncSceneContentDOM();
    markSceneDirty(sceneB);
  });
  bReturnBtn.addEventListener('click', () => {
    const r = bReturnBtn.getBoundingClientRect();
    const { ox, oy } = normalizedTapPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
    triggerPour({ ox, oy, direction: 'b-to-a' });
  });

  // External controls
  pourBtn.addEventListener('click', () => {
    triggerPour({
      ox: bleed.originX,
      oy: bleed.originY,
      direction: bleed.invert ? 'b-to-a' : 'a-to-b',
    });
  });

  invertCheck.addEventListener('change', () => {
    bleed.invert = invertCheck.checked;
    updateControlsUI();
    drawCurrentFrame(false);
  });

  reducedCheck.addEventListener('change', () => {
    if (isReducedMotion() && bleed.anim.active) {
      stepBleed(bleed, performance.now(), true);
      stopLoop();
      updateControlsUI();
      syncSceneGeometry(true);
      drawCurrentFrame(false);
    }
  });

  reducedQuery.addEventListener?.('change', () => {
    reducedCheck.checked = reducedQuery.matches;
    if (isReducedMotion() && bleed.anim.active) {
      stepBleed(bleed, performance.now(), true);
      stopLoop();
      updateControlsUI();
      syncSceneGeometry(true);
      drawCurrentFrame(false);
    }
  });

  scrubInput.addEventListener('input', () => {
    stopLoop();
    bleed.anim.active = false;
    bleed.progress = clamp(Number(scrubInput.value) / 100, 0, 1);
    updateControlsUI();
    if (state.mode === 'plain') {
      enterPlainFallback(noticeEl.textContent || '');
      return;
    }
    syncSceneGeometry(true);
    drawCurrentFrame(false);
  });

  featherInput.addEventListener('input', () => {
    bleed.feather = clamp(Number(featherInput.value) / 100, 0.2, 2.0);
    updateControlsUI();
    drawCurrentFrame(false);
  });

  turbInput.addEventListener('input', () => {
    bleed.turbulence = clamp(Number(turbInput.value) / 100, 0.0, 2.0);
    updateControlsUI();
    drawCurrentFrame(false);
  });

  function wireCanvasEvents(cv) {
    cv.addEventListener('paint', (e) => {
      state.hasPainted = true;
      const changed = e?.changedElements?.length ? new Set(e.changedElements) : null;
      if (state.mode === 'webgl' && stage && !stage.lost) {
        renderWebGL(changed);
      } else if (state.mode === '2d' && ctx2d) {
        render2DFallback();
      }
    });
    cv.addEventListener('contextlost', (e) => {
      e.preventDefault();
      if (state.mode === '2d') {
        enterPlainFallback('The 2D canvas context was lost. Showing both views as plain HTML.');
      }
    });
    cv.addEventListener('contextrestored', () => {
      if (state.mode === 'plain' && ctx2d) {
        state.mode = '2d';
        state.hasPainted = false;
        exitPlainFallback();
        const { cw, ch } = getViewportSize();
        syncSceneSizes(cw, ch);
        cv.requestPaint?.();
      }
    });
  }

  function initBackend() {
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);
    syncSceneContentDOM();
    updateControlsUI();

    const forceRoute = new URLSearchParams(location.search).get('route');

    if (hicSupported && glSupported && forceRoute !== '2d') {
      try {
        stage = new ElementGL(canvas, {
          fragment: INK_BLEED_FRAG,
          onLost: () => {
            viewTextures.clear();
            enterPlainFallback('The WebGL 2 context was lost. Moved both views to plain HTML until restored.');
          },
          onRestored: () => {
            viewTextures.clear();
            dirtyScenes.add(sceneA);
            dirtyScenes.add(sceneB);
            stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            state.mode = 'webgl';
            state.hasPainted = false;
            state.unitCache.key = '';
            state.lastGeoKey = '';
            exitPlainFallback();
            const size = getViewportSize();
            syncSceneSizes(size.cw, size.ch);
            canvas.requestPaint?.();
          },
        });
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.mode = 'webgl';
        wireCanvasEvents(canvas);
        syncSceneGeometry(true);
        canvas.requestPaint?.();
        return;
      } catch (err) {
        stage = null;
        const fresh = document.createElement('canvas');
        fresh.id = 'ib-canvas';
        fresh.setAttribute('content', 'drawable');
        fresh.setAttribute('layoutsubtree', '');
        fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
        fresh.append(sceneA, sceneB);
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
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D radial fallback.');
        }
        wireCanvasEvents(canvas);
        syncSceneGeometry(true);
        canvas.requestPaint?.();
        return;
      }
    }

    enterPlainFallback('HTML-in-canvas is not available in this browser, so both views are shown as plain HTML.');
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(([entry]) => {
      state.onScreen = Boolean(entry && entry.isIntersecting);
      if (!state.onScreen) {
        stopLoop();
      } else if (state.mode !== 'plain') {
        if (bleed.anim.active) startLoop();
        else if (state.hasPainted) drawCurrentFrame(false);
      }
    }, { threshold: 0.01 }).observe(stageBox);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (state.onScreen && state.mode !== 'plain') {
      if (bleed.anim.active) startLoop();
      else if (state.hasPainted) drawCurrentFrame(false);
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (state.mode === 'plain') return;
      state.unitCache.key = '';
      state.lastGeoKey = '';
      const { cw, ch } = getViewportSize();
      syncSceneSizes(cw, ch);
      dirtyScenes.add(sceneA);
      dirtyScenes.add(sceneB);
      if (state.hasPainted) canvas.requestPaint?.();
    }).observe(viewportEl);
  }

  initBackend();

  // ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------

  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  async function settleGfx(baseActive) {
    if (!window.__gfx?.active) return;
    const deadline = performance.now() + 800;
    while (window.__gfx.active() > baseActive && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  function readCssPx(gl, cv, cssX, cssY) {
    const sx = cv.width / (cv.clientWidth || 1);
    const sy = cv.height / (cv.clientHeight || 1);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  function makeDualFixtureCanvas(w = 260, h = 160, {
    bgA = '#f8f2e4',
    bgB = '#1089a8',
    htmlA = '',
    htmlB = '',
  } = {}) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;

    const a = document.createElement('section');
    a.setAttribute('drawable', '');
    a.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;background:${bgA};color:#1e1a15;`;
    a.innerHTML = htmlA;

    const b = document.createElement('section');
    b.setAttribute('drawable', '');
    b.inert = true;
    b.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;background:${bgB};color:#e8f4ff;pointer-events:none;`;
    b.innerHTML = htmlB;

    cv.append(a, b);
    return { cv, a, b };
  }

  function drawFixtureBlend(g, cv, a, b, texB, w, h, opts) {
    g.begin([0, 0, 0, 0]);
    g.quad(a, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB.tex);
      gl.uniform1i(loc('uSceneBTex'), 1);
      gl.uniform1f(loc('uProgress'), opts.progress);
      gl.uniform1f(loc('uInvert'), opts.invert ?? 0);
      gl.uniform2f(loc('uOrigin'), opts.ox ?? 0.5, opts.oy ?? 0.5);
      gl.uniform1f(loc('uFeather'), opts.feather ?? 1.0);
      gl.uniform1f(loc('uTurbulence'), opts.turbulence ?? 1.0);
      gl.uniform1f(loc('uReduced'), opts.reduced ?? 0.0);
    });
  }

  const tests = [
    {
      name: 'ElementGL dual-scene upload and explicit tMs bleed envelope pass with gl.getError() === 0',
      expect: 'pass',
      why: 'Gating upload on hasPainted inside paint, calling stage.begin() before upload() with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, and stepping tMs = 0, 450, 1350 ms.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 240;
        const H = 140;
        const { cv, a, b } = makeDualFixtureCanvas(W, H, { bgA: '#f8f2e4', bgB: '#112236' });
        testStage().append(cv);
        let g = null;
        let hasPaint = false;
        let texA = null;
        let texB = null;
        try {
          g = new ElementGL(cv, { fragment: INK_BLEED_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPaint = true;
            if (!g.begin([0, 0, 0, 0])) return;
            texA = g.upload(a);
            texB = g.upload(b);
          }, { once: true });
          await nextPaint(cv);
          if (!hasPaint || !texA || !texB) throw new Error('paint event did not upload both scenes');

          const env = createBleedState();
          launchBleed(env, { originX: 0.25, originY: 0.5, targetProgress: 1, tMs: 0, durationMs: 1350 });
          const mid = stepBleed(env, 450, false);
          const end = stepBleed(env, 1350, false);

          const snap = createBleedState();
          launchBleed(snap, { originX: 0.5, originY: 0.5, targetProgress: 1, tMs: 0, durationMs: 1350, reduced: true });

          drawFixtureBlend(g, cv, a, b, texB, W, H, { progress: mid.progress, ox: 0.25, oy: 0.5 });
          const err = g.gl.getError();

          return need(
            err === g.gl.NO_ERROR &&
            texA.w > 0 && texB.w > 0 &&
            mid.progress > 0.35 && mid.progress < 0.75 && mid.active &&
            end.progress === 1 && !end.active &&
            snap.progress === 1 && !snap.anim.active,
            `glErr=${err}, texA=${texA.w}x${texA.h}, texB=${texB.w}x${texB.h}, t450=${mid.progress.toFixed(2)}, t1350=${end.progress.toFixed(2)}, reducedSnap=${snap.progress}.`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Tap origin shifts revealed Scene B pixels between left and right sides',
      expect: 'pass',
      why: 'Renders progress = 0.35 first from left origin (0.14, 0.50) and then from right origin (0.86, 0.50), sampling readPixels() on both flanks.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 260;
        const H = 150;
        const { cv, a, b } = makeDualFixtureCanvas(W, H, { bgA: '#f8f2e4', bgB: '#0c98b8' });
        testStage().append(cv);
        let g = null;
        let texB = null;
        try {
          g = new ElementGL(cv, { fragment: INK_BLEED_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            if (!g.begin([0, 0, 0, 0])) return;
            g.upload(a);
            texB = g.upload(b);
          }, { once: true });
          await nextPaint(cv);
          if (!texB) throw new Error('fixture textures failed to upload');

          drawFixtureBlend(g, cv, a, b, texB, W, H, {
            progress: 0.35, ox: 0.14, oy: 0.5, feather: 0.8, turbulence: 0.25,
          });
          const leftOriginLeftPx = readCssPx(g.gl, cv, 34, 75);
          const leftOriginRightPx = readCssPx(g.gl, cv, 226, 75);

          drawFixtureBlend(g, cv, a, b, texB, W, H, {
            progress: 0.35, ox: 0.86, oy: 0.5, feather: 0.8, turbulence: 0.25,
          });
          const rightOriginLeftPx = readCssPx(g.gl, cv, 34, 75);
          const rightOriginRightPx = readCssPx(g.gl, cv, 226, 75);

          const isCyanB = (p) => p[2] > p[0] + 55;
          const isCreamA = (p) => p[0] > 210 && p[1] > 200;

          return need(
            isCyanB(leftOriginLeftPx) && isCreamA(leftOriginRightPx) &&
            isCreamA(rightOriginLeftPx) && isCyanB(rightOriginRightPx),
            `origin(0.14): L=[${leftOriginLeftPx.slice(0, 3)}] R=[${leftOriginRightPx.slice(0, 3)}]; origin(0.86): L=[${rightOriginLeftPx.slice(0, 3)}] R=[${rightOriginRightPx.slice(0, 3)}].`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Wet capillary pigment rim dips strictly darker than both Scene A and Scene B along the advancing contour',
      expect: 'pass',
      why: 'Samples dry Scene A paper, revealed Scene B obsidian slate, and scans readPixels() across the capillary front at progress = 0.45.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 260;
        const H = 140;
        const { cv, a, b } = makeDualFixtureCanvas(W, H, { bgA: '#f8f2e4', bgB: '#16253b' });
        testStage().append(cv);
        let g = null;
        let texB = null;
        try {
          g = new ElementGL(cv, { fragment: INK_BLEED_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            if (!g.begin([0, 0, 0, 0])) return;
            g.upload(a);
            texB = g.upload(b);
          }, { once: true });
          await nextPaint(cv);
          if (!texB) throw new Error('fixture textures failed to upload');

          drawFixtureBlend(g, cv, a, b, texB, W, H, {
            progress: 0.45, ox: 0.14, oy: 0.5, feather: 1.0, turbulence: 0.5,
          });
          const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
          const pxB = readCssPx(g.gl, cv, 24, 70);
          const pxA = readCssPx(g.gl, cv, 244, 70);
          const lumB = lum(pxB);
          const lumA = lum(pxA);

          let minRimLum = 255;
          let minRimX = -1;
          for (let x = 36; x <= 230; x += 2) {
            const l = lum(readCssPx(g.gl, cv, x, 70));
            if (l < minRimLum) {
              minRimLum = l;
              minRimX = x;
            }
          }

          return need(
            lumA > 200 && lumB > 20 && minRimLum < lumA - 120 && minRimLum < lumB - 8,
            `SceneA lum=${lumA.toFixed(1)}, SceneB lum=${lumB.toFixed(1)}, wet rim min lum=${minRimLum.toFixed(1)} at x=${minRimX} px.`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'updateElementGeometry() and inert swap route live DOM clicks to Scene A at 0% and Scene B at 100%',
      expect: 'pass',
      why: 'Applies geometryUnit()-scaled updateElementGeometry() + data-hit-tick on a dual-scene fixture, checking elementsFromPoint() and real button clicks at 0% and 100%.',
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available.');
        }
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 250;
        const H = 160;
        const { cv, a, b } = makeDualFixtureCanvas(W, H, {
          bgA: '#f8f2e4',
          bgB: '#111b2b',
          htmlA: '<button id="fx-a-btn" type="button" style="position:absolute;left:20px;top:24px;width:110px;height:44px">A Action</button><input id="fx-a-input" type="text" inputmode="none" aria-label="Fixture paper note" value="Rag paper" style="position:absolute;left:20px;top:84px;width:140px;height:38px;box-sizing:border-box">',
          htmlB: '<button id="fx-b-btn" type="button" style="position:absolute;left:110px;top:86px;width:116px;height:44px">B Action</button>',
        });
        const btnA = a.querySelector('#fx-a-btn');
        const inputA = a.querySelector('#fx-a-input');
        const btnB = b.querySelector('#fx-b-btn');
        let hitsA = 0;
        let hitsB = 0;
        btnA.addEventListener('click', () => { hitsA++; });
        btnB.addEventListener('click', () => { hitsB++; });

        testStage().append(cv);
        let g = null;
        let ctx = null;
        let texB = null;
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: INK_BLEED_FRAG });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.addEventListener('paint', () => {
              if (!g.begin([0, 0, 0, 0])) return;
              g.upload(a);
              texB = g.upload(b);
            }, { once: true });
          } else {
            ctx = cv.getContext('2d');
          }
          await nextPaint(cv);

          const syncState = (showB) => {
            a.inert = showB;
            b.inert = !showB;
            a.style.pointerEvents = showB ? 'none' : 'auto';
            b.style.pointerEvents = showB ? 'auto' : 'none';
            if (g && texB) {
              drawFixtureBlend(g, cv, a, b, texB, W, H, { progress: showB ? 1 : 0 });
              const u = geometryUnit(cv, showB ? b : a, W);
              const m = new DOMMatrix().scale(u, u);
              cv.updateElementGeometry(a, { canvasTransform: m });
              cv.updateElementGeometry(b, { canvasTransform: m });
              a.dataset.hitTick = a.dataset.hitTick === '1' ? '0' : '1';
              b.dataset.hitTick = b.dataset.hitTick === '1' ? '0' : '1';
            } else if (ctx) {
              ctx.reset();
              ctx.drawElementImage(showB ? b : a, 0, 0, W, H);
            }
          };

          const centerHits = (el) => {
            const r = el.getBoundingClientRect();
            return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
          };

          syncState(false);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const hitA = centerHits(btnA);
          const hitInputA = centerHits(inputA);
          const aHitOk = hitA.includes(btnA) && !hitA.includes(btnB) && hitInputA.includes(inputA);
          btnA.click();

          syncState(true);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const hitB = centerHits(btnB);
          const bHitOk = hitB.includes(btnB) && !hitB.includes(btnA);
          btnB.click();

          return need(
            aHitOk && bHitOk && hitsA === 1 && hitsB === 1,
            `0% btnA+input hit=${aHitOk} clicks=${hitsA}; 100% btnB hit=${bHitOk} clicks=${hitsB}.`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'webglcontextlost/restored rescues to plain HTML and 5-arg 2D fallback clips Scene B inside Scene A',
      expect: 'pass',
      why: 'Dispatches synthetic cancelable webglcontextlost/restored events (preserving UNPACK_PREMULTIPLY_ALPHA_WEBGL) and checks 5-argument drawElementImage() radial clipping via a plain copy canvas.',
      run: async () => {
        if (!hicSupported) throw new Error('HTML-in-canvas is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 220;
        const H = 130;

        // Part A: Synthetic context loss & restoration without calling loseContext()
        let glRescueOk = false;
        let errAfter = 0;
        if (glSupported) {
          const wrap = document.createElement('div');
          const plain = document.createElement('div');
          plain.hidden = true;
          const { cv, a, b } = makeDualFixtureCanvas(W, H, { bgA: '#f8f2e4', bgB: '#111b2b' });
          wrap.append(cv, plain);
          testStage().append(wrap);
          let g = null;
          let lostFired = false;
          let restoredFired = false;
          try {
            g = new ElementGL(cv, {
              fragment: INK_BLEED_FRAG,
              onLost: () => {
                lostFired = true;
                plain.hidden = false;
                plain.append(a, b);
              },
              onRestored: () => {
                restoredFired = true;
                g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                plain.hidden = true;
                cv.append(a, b);
              },
            });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            await nextPaint(cv);

            const lostEv = new Event('webglcontextlost', { cancelable: true });
            cv.dispatchEvent(lostEv);
            const inPlain = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(a) && plain.contains(b);

            cv.dispatchEvent(new Event('webglcontextrestored'));
            await nextPaint(cv);
            if (!g.begin([0, 0, 0, 0])) throw new Error('begin() failed after restore');
            const tA = g.upload(a);
            const tB = g.upload(b);
            drawFixtureBlend(g, cv, a, b, tB, W, H, { progress: 0.5 });
            errAfter = g.gl.getError();
            glRescueOk = inPlain && restoredFired && !g.lost && cv.contains(a) && cv.contains(b) && tA?.w > 0 && errAfter === g.gl.NO_ERROR;
          } finally {
            g?.dispose();
            wrap.remove();
            window.__gfx?.retire?.(cv);
            await settleGfx(baseActive);
          }
        } else {
          glRescueOk = true;
        }

        // Part B: 5-arg 2D drawElementImage() radial mask fallback read via a plain copy canvas
        const { cv: cv2, a: a2, b: b2 } = makeDualFixtureCanvas(W, H, { bgA: '#f8f2e4', bgB: '#0c98b8' });
        testStage().append(cv2);
        const copy = document.createElement('canvas');
        try {
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          const bw = Math.max(1, Math.round(W * dpr));
          const bh = Math.max(1, Math.round(H * dpr));
          const c2 = cv2.getContext('2d');
          cv2.width = bw;
          cv2.height = bh;
          await nextPaint(cv2);
          c2.save();
          c2.setTransform(dpr, 0, 0, dpr, 0, 0);
          c2.drawElementImage(a2, 0, 0, W, H);
          c2.save();
          c2.beginPath();
          c2.arc(44, H * 0.5, 48, 0, Math.PI * 2);
          c2.clip();
          c2.drawElementImage(b2, 0, 0, W, H);
          c2.restore();
          c2.restore();

          copy.width = bw;
          copy.height = bh;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2, 0, 0);
          const inPool = cc.getImageData(Math.round(44 * dpr), Math.round(H * 0.5 * dpr), 1, 1).data;
          const outPool = cc.getImageData(Math.round(188 * dpr), Math.round(H * 0.5 * dpr), 1, 1).data;
          const twoDOk = inPool[2] > inPool[0] + 50 && outPool[0] > 210;

          return need(
            glRescueOk && twoDOk,
            `glRescue=${glRescueOk} (err=${errAfter}), 2D 5-arg radial pool=[${inPool.slice(0, 3)}] outside=[${outPool.slice(0, 3)}] at ${dpr.toFixed(2)}x.`
          );
        } finally {
          copy.width = 0;
          copy.height = 0;
          cv2.remove();
          window.__gfx?.retire?.(cv2);
        }
      },
    },
    stillDrawn(() => [
      {
        name: 'ink-bleed stage',
        ink: async () => {
          if (state.mode === 'plain') return null;
          if (state.mode === 'webgl') {
            if (!stage || stage.lost || !state.hasPainted || viewTextures.size < 2) return 0;
            const mp = (canvas.width * canvas.height) / 1e6;
            if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
            return state.paints > 0 ? 1 : 0;
          }
          return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
        },
        rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
      },
    ]),
  ];

  runTests(testsBody, tests);
}

if (typeof document !== 'undefined' && document.getElementById('ib-canvas')) {
  mountInkBleed();
}
