import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const PALETTE = [
  { fill: '#2563eb', rgb: [0.145, 0.388, 0.922], accent: [0.576, 0.773, 0.992], hex: '#2563eb' },
  { fill: '#ea580c', rgb: [0.918, 0.345, 0.047], accent: [0.992, 0.729, 0.455], hex: '#ea580c' },
  { fill: '#059669', rgb: [0.020, 0.588, 0.412], accent: [0.431, 0.906, 0.718], hex: '#059669' },
  { fill: '#7c3aed', rgb: [0.486, 0.227, 0.929], accent: [0.769, 0.710, 0.992], hex: '#7c3aed' },
  { fill: '#db2777', rgb: [0.859, 0.153, 0.467], accent: [0.976, 0.659, 0.831], hex: '#db2777' },
  { fill: '#0891b2', rgb: [0.031, 0.569, 0.698], accent: [0.404, 0.910, 0.976], hex: '#0891b2' },
];

const INITIAL_EVENTS = [
  { id: 1, title: 'Design review', startMin: 9 * 60, endMin: 11 * 60, colorIdx: 0 },
  { id: 2, title: 'Shader sync', startMin: 13 * 60, endMin: 15 * 60 + 15, colorIdx: 1 },
  { id: 3, title: 'Deep work', startMin: 16 * 60 + 30, endMin: 19 * 60 + 30, colorIdx: 2 },
];

const EXTRA_TITLES = ['Focus sprint', 'Prototype check', 'Evening read'];
const MAX_EVENTS = 6;
const SNAP_MINUTES = 15;
const STRIP_W = 138;
const STRIP_H = 40;

// DOM references
const wrapEl = document.getElementById('clock-wrap');
let canvas = document.getElementById('clock-canvas');
const dialGrip = document.getElementById('clock-dial-grip');
const faceDom = document.getElementById('clock-face-dom');
const inspectorEl = document.getElementById('clock-inspector');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('clock-notice');
const statusEl = document.getElementById('clock-status');
const hintEl = document.getElementById('clock-hint');
const testsBody = document.getElementById('tests');

// Inspector controls inside the canvas
const inspDot = document.getElementById('insp-dot');
const inspBadge = document.getElementById('insp-badge');
const prevBtn = document.getElementById('btn-prev-ev');
const nextBtn = document.getElementById('btn-next-ev');
const titleInput = document.getElementById('ev-title-input');
const startInput = document.getElementById('ev-start');
const endInput = document.getElementById('ev-end');
const durationOut = document.getElementById('ev-duration');

// Controls outside the canvas
const mode24Btn = document.getElementById('btn-mode-24');
const mode12Btn = document.getElementById('btn-mode-12');
const addBlockBtn = document.getElementById('btn-add-block');
const resetBtn = document.getElementById('btn-reset-day');
const showHitToggle = document.getElementById('ctl-show-hit');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

// #region polar-shader
export const CLOCK_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;          // 0=dial+face, 1=event wedge, 2=needle+hitOverlay, 3=inspector
uniform vec2 uCanvasSize;
uniform vec2 uDialCenter;
uniform float uDialR;
uniform float uRingInner;
uniform float uRingOuter;
uniform int uIs12h;
uniform int uShowHit;

uniform float uStartAngle;
uniform float uSpanAngle;
uniform float uLaneInner;
uniform float uLaneOuter;
uniform vec3 uEventColor;
uniform vec3 uEventAccent;
uniform int uIsActive;
uniform mat3 uHitInv;

uniform float uNowAngle;
uniform vec2 uStartKnobPos;
uniform vec2 uEndKnobPos;
uniform int uHasKnobs;
uniform mat3 uInspHitInv;

in vec2 vUv;
out vec4 outColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

vec4 over(vec4 under, vec4 topPremul) {
  return topPremul + under * (1.0 - topPremul.a);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

float hitBoxBorder(vec2 pCss, mat3 invMat) {
  vec3 qh = invMat * vec3(pCss, 1.0);
  vec2 quv = qh.xy / max(abs(qh.z), 1e-5);
  if (qh.z <= 0.0 || quv.x < 0.0 || quv.x > 1.0 || quv.y < 0.0 || quv.y > 1.0) return 0.0;
  float edge = min(min(quv.x, 1.0 - quv.x), min(quv.y, 1.0 - quv.y));
  float fw = max(length(fwidth(quv)), 0.004);
  return 1.0 - smoothstep(fw * 0.9, fw * 2.2, edge);
}

void main() {
  vec2 pCss = vUv * uCanvasSize;

  if (uPass == 3) {
    // Flat interactive inspector card drawn 1:1 in the dock
    vec4 texCol = texture(uTex, vUv);
    outColor = texCol;
    return;
  }

  vec2 d = pCss - uDialCenter;
  float r = length(d);
  float theta = atan(d.x, -d.y); // 0 = 12 o'clock top, +clockwise

  if (uPass == 0) {
    float bgDist = clamp(length(pCss - vec2(uCanvasSize.x * 0.5, uDialCenter.y)) / max(uCanvasSize.y * 0.72, 1.0), 0.0, 1.0);
    vec3 rgb = mix(vec3(0.086, 0.110, 0.165), vec3(0.047, 0.063, 0.098), bgDist);

    // Dial plate
    float plateSd = r - uDialR;
    float plateMask = 1.0 - smoothstep(-0.8, 0.8, plateSd);
    if (plateMask > 0.001) {
      vec3 plate = mix(vec3(0.114, 0.145, 0.212), vec3(0.075, 0.098, 0.149), clamp(r / max(uDialR, 1.0), 0.0, 1.0));
      float outerRim = (1.0 - smoothstep(0.0, 1.4, abs(plateSd + 0.8))) * 0.55;
      plate = mix(plate, vec3(0.24, 0.30, 0.42), outerRim);

      // Recessed donut track groove
      float trackIn = uRingInner - 2.5;
      float trackOut = uRingOuter + 2.5;
      float groove = smoothstep(trackIn - 1.5, trackIn + 1.5, r) * (1.0 - smoothstep(trackOut - 1.5, trackOut + 1.5, r));
      plate = mix(plate, vec3(0.055, 0.071, 0.110), groove * 0.85);
      float gEdge1 = 1.0 - smoothstep(0.0, 1.2, abs(r - trackIn));
      float gEdge2 = 1.0 - smoothstep(0.0, 1.2, abs(r - trackOut));
      plate = mix(plate, vec3(0.22, 0.28, 0.40), (gEdge1 + gEdge2) * 0.42);

      // Subtle inner AM/PM day-night ring
      float ampIn = uRingInner - 9.5;
      float ampOut = uRingInner - 5.0;
      float ampMask = smoothstep(ampIn - 0.8, ampIn + 0.8, r) * (1.0 - smoothstep(ampOut - 0.8, ampOut + 0.8, r));
      if (ampMask > 0.001) {
        float dayness = uIs12h == 1 ? 0.35 : smoothstep(0.18, -0.18, cos(theta));
        vec3 ampCol = mix(vec3(0.24, 0.31, 0.56), vec3(0.88, 0.56, 0.22), dayness);
        plate = mix(plate, ampCol, ampMask * 0.48);
      }

      // Hour & 15-minute perimeter ticks
      float tNorm = mod(theta / TAU + 1.0, 1.0);
      float nMajor = uIs12h == 1 ? 12.0 : 24.0;
      float nMinor = nMajor * 4.0;
      float tickBase = uRingOuter + 4.5;
      float minorPhase = abs(fract(tNorm * nMinor + 0.5) - 0.5) / nMinor * TAU * max(r, 1.0);
      float majorPhase = abs(fract(tNorm * nMajor + 0.5) - 0.5) / nMajor * TAU * max(r, 1.0);
      float quarterPhase = abs(fract(tNorm * (nMajor / 3.0) + 0.5) - 0.5) / (nMajor / 3.0) * TAU * max(r, 1.0);

      float minorBand = smoothstep(tickBase - 0.6, tickBase + 0.6, r) * (1.0 - smoothstep(tickBase + 3.5, tickBase + 4.7, r));
      float majorBand = smoothstep(tickBase - 0.6, tickBase + 0.6, r) * (1.0 - smoothstep(tickBase + 8.0, tickBase + 9.4, r));
      float minorHit = (1.0 - smoothstep(0.45, 1.15, minorPhase)) * minorBand * 0.28;
      float majorHit = (1.0 - smoothstep(0.65, 1.45, majorPhase)) * majorBand * 0.58;
      float qtrHit = (1.0 - smoothstep(0.85, 1.75, quarterPhase)) * majorBand * 0.88;
      plate = mix(plate, vec3(0.75, 0.82, 0.95), max(minorHit, max(majorHit, qtrHit)));

      // Inner hub border
      float hubRim = 1.0 - smoothstep(0.0, 1.3, abs(r - (uRingInner - 14.0)));
      plate = mix(plate, vec3(0.24, 0.30, 0.43), hubRim * 0.45);

      rgb = mix(rgb, plate, plateMask);
    }

    // Live HTML dial numerals + center hub readout
    vec2 dialOrigin = uDialCenter - vec2(uDialR);
    vec2 faceUv = (pCss - dialOrigin) / max(2.0 * uDialR, 1.0);
    if (faceUv.x >= 0.0 && faceUv.x <= 1.0 && faceUv.y >= 0.0 && faceUv.y <= 1.0) {
      vec4 faceCol = texture(uTex, faceUv);
      rgb = faceCol.rgb + rgb * (1.0 - faceCol.a);
    }

    outColor = vec4(rgb, 1.0);
    return;
  }

  if (uPass == 1) {
    // Polar-warped live HTML event strip along a rounded donut wedge
    vec4 accum = vec4(0.0);
    float midAngle = uStartAngle + 0.5 * uSpanAngle;
    float halfSpan = 0.5 * uSpanAngle;
    float delta = mod(theta - midAngle + PI, TAU) - PI;
    float rMid = 0.5 * (uLaneInner + uLaneOuter);
    float rHalf = 0.5 * (uLaneOuter - uLaneInner);

    float radSd = abs(r - rMid) - rHalf;
    float angSd = (abs(delta) - halfSpan) * clamp(r, uLaneInner, uLaneOuter);
    float cr = min(7.0, min(rHalf * 0.72, max(halfSpan * rMid * 0.6, 1.0)));
    vec2 q = vec2(angSd + cr, radSd + cr);
    float wedgeSd = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - cr;

    if (uIsActive == 1 && wedgeSd > 0.0 && wedgeSd < 9.0) {
      float halo = exp(-wedgeSd * 0.44) * 0.36;
      accum = over(accum, vec4(uEventAccent * halo, halo));
    }

    float wedgeMask = 1.0 - smoothstep(-0.75, 0.75, wedgeSd);
    if (wedgeMask > 0.001) {
      float radNorm = clamp((r - uLaneInner) / max(uLaneOuter - uLaneInner, 1.0), 0.0, 1.0);
      vec3 base = mix(uEventColor * 0.74, uEventColor * 1.05, radNorm);
      float rim = (1.0 - smoothstep(-2.2, -0.35, wedgeSd)) * (uIsActive == 1 ? 0.55 : 0.18);
      base = mix(base, uEventAccent, rim);

      float flip = cos(midAngle) < 0.0 ? -1.0 : 1.0;
      float arcLen = max(uSpanAngle * rMid, 1.0);
      float bandH = max(uLaneOuter - uLaneInner, 1.0);
      float naturalW = bandH * (uSize.x / max(uSize.y, 1.0));
      float fitW = max(arcLen, naturalW * 0.54);
      float u = 0.5 + (flip * delta * rMid) / fitW;
      float v = flip > 0.0 ? (uLaneOuter - r) / bandH : (r - uLaneInner) / bandH;

      if (u > 0.01 && u < 0.99 && v > 0.02 && v < 0.98) {
        vec4 texCol = texture(uTex, vec2(u, v));
        float edgeFade = smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.95, u);
        texCol *= edgeFade;
        base = texCol.rgb + base * (1.0 - texCol.a);
      }

      float wAlpha = wedgeMask * (uIsActive == 1 ? 0.96 : 0.84);
      accum = over(accum, vec4(base * wAlpha, wAlpha));
    }

    if (uIsActive == 1) {
      float endAngle = uStartAngle + uSpanAngle;
      for (int k = 0; k < 2; k++) {
        float ang = k == 0 ? uStartAngle : endAngle;
        vec2 kPos = uDialCenter + vec2(sin(ang), -cos(ang)) * rMid;
        float dk = length(pCss - kPos);
        if (dk < 13.0) {
          float shadow = exp(-max(dk - 8.5, 0.0) * 0.7) * 0.45;
          accum = over(accum, vec4(vec3(0.02, 0.03, 0.05) * shadow, shadow));
          float disc = 1.0 - smoothstep(8.2, 9.4, dk);
          if (disc > 0.001) {
            vec3 kCol = k == 0 ? vec3(0.96, 0.98, 1.0) : uEventAccent;
            float innerPip = 1.0 - smoothstep(3.2, 4.2, dk);
            vec3 pipCol = k == 0 ? uEventColor : vec3(0.08, 0.11, 0.17);
            vec3 finalK = mix(kCol, pipCol, innerPip);
            accum = over(accum, vec4(finalK * disc, disc));
          }
        }
      }
    }

    if (uShowHit == 1) {
      float border = hitBoxBorder(pCss, uHitInv);
      if (border > 0.001) {
        vec3 hc = uIsActive == 1 ? vec3(0.14, 0.95, 0.98) : vec3(0.45, 0.78, 0.95);
        accum = over(accum, vec4(hc * border * 0.9, border * 0.9));
      }
    }

    outColor = accum;
    return;
  }

  // Pass 2: live time hand sweep + inspector & handle hit-test wireframes
  vec4 overlay = vec4(0.0);
  vec2 handDir = vec2(sin(uNowAngle), -cos(uNowAngle));
  vec2 handTip = uDialCenter + handDir * (uRingOuter + 10.0);
  vec2 handTail = uDialCenter + handDir * max(uRingInner - 13.0, 8.0);
  float sdHand = sdSegment(pCss, handTail, handTip);
  float handMask = 1.0 - smoothstep(0.7, 1.7, sdHand);
  if (handMask > 0.001) {
    overlay = over(overlay, vec4(vec3(0.98, 0.42, 0.25) * handMask, handMask));
  }
  float capMask = 1.0 - smoothstep(2.8, 4.0, length(pCss - handTail));
  if (capMask > 0.001) {
    overlay = over(overlay, vec4(vec3(0.98, 0.42, 0.25) * capMask, capMask));
  }

  if (uShowHit == 1) {
    float inspBorder = hitBoxBorder(pCss, uInspHitInv);
    if (inspBorder > 0.001) {
      overlay = over(overlay, vec4(vec3(0.14, 0.95, 0.98) * inspBorder * 0.95, inspBorder * 0.95));
    }
    if (uHasKnobs == 1) {
      for (int k = 0; k < 2; k++) {
        vec2 kp = k == 0 ? uStartKnobPos : uEndKnobPos;
        float dk = abs(length(pCss - kp) - 22.0);
        float ring = 1.0 - smoothstep(0.8, 2.0, dk);
        if (ring > 0.001) {
          overlay = over(overlay, vec4(vec3(1.0, 0.62, 0.16) * ring * 0.9, ring * 0.9));
        }
      }
    }
  }

  outColor = overlay;
}
`;
// #endregion polar-shader

// #region polar-hit
export function snapMinutes(mins, snap = SNAP_MINUTES) {
  return Math.round(mins / snap) * snap;
}

export function minutesToAngle(mins, is12h = false) {
  const cycle = is12h ? 720 : 1440;
  const wrapped = ((mins % cycle) + cycle) % cycle;
  return (wrapped / cycle) * Math.PI * 2;
}

export function angleToMinutes(theta, is12h = false, snap = SNAP_MINUTES) {
  const cycle = is12h ? 720 : 1440;
  const tau = Math.PI * 2;
  const norm = ((theta % tau) + tau) % tau;
  const raw = (norm / tau) * cycle;
  return snapMinutes(raw, snap) % cycle;
}

export function pointToMinutes(px, py, dial, is12h = false, snap = SNAP_MINUTES) {
  const dx = px - dial.cx;
  const dy = py - dial.cy;
  const theta = Math.atan2(dx, -dy);
  return angleToMinutes(theta, is12h, snap);
}

export function wrapDeltaPi(d) {
  const tau = Math.PI * 2;
  return ((((d + Math.PI) % tau) + tau) % tau) - Math.PI;
}

export function formatTime24(mins) {
  const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatTimeLabel(mins, is12h = false) {
  const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  if (!is12h) return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const suffix = h24 >= 12 ? 'p' : 'a';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatDuration(startMin, endMin) {
  const diff = Math.max(0, Math.round(endMin - startMin));
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h && m) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (h) return `${h}h 00m`;
  return `${m}m`;
}

export function parseHHMM(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getSiblingBounds(ev, events) {
  let minBound = 0;
  let maxBound = 1439;
  for (const other of events) {
    if (other.id === ev.id) continue;
    // Only constrain against siblings that don't already overlap this event
    if (other.endMin <= ev.startMin && other.endMin > minBound) {
      minBound = other.endMin;
    }
    if (other.startMin >= ev.endMin && other.startMin < maxBound) {
      maxBound = other.startMin;
    }
  }
  return { minBound, maxBound };
}

export function applyHandleDrag(ev, mode, targetMin, events, origDuration = 60, bounds = null) {
  const { minBound, maxBound } = bounds ?? getSiblingBounds(ev, events);
  const snap = (v) => {
    if (v >= 1432) return 1439;
    return snapMinutes(v, SNAP_MINUTES);
  };

  if (mode === 'start') {
    const nextStart = Math.max(minBound, Math.min(ev.endMin - SNAP_MINUTES, snap(targetMin)));
    ev.startMin = nextStart;
  } else if (mode === 'end') {
    const nextEnd = Math.max(ev.startMin + SNAP_MINUTES, Math.min(maxBound, snap(targetMin)));
    ev.endMin = nextEnd;
  } else if (mode === 'move') {
    const dur = Math.max(SNAP_MINUTES, origDuration);
    const maxStart = Math.max(minBound, maxBound - dur);
    const nextStart = Math.max(minBound, Math.min(maxStart, snap(targetMin)));
    ev.startMin = nextStart;
    ev.endMin = Math.min(maxBound, nextStart + dur);
  }
  return ev;
}

function computeLanes(events, is12h) {
  const cycle = is12h ? 720 : 1440;
  const lanes = new Map();
  if (!is12h) {
    for (const ev of events) lanes.set(ev.id, { lane: 0, count: 1 });
    return lanes;
  }
  // In 12h mode, split AM vs PM into two lanes only if intervals collide modulo 12h
  const intervals = events.map((ev) => {
    const s = ev.startMin % cycle;
    const len = Math.min(cycle - 1, Math.max(SNAP_MINUTES, ev.endMin - ev.startMin));
    return { ev, s, e: s + len };
  });
  const collides = (a, b) => {
    const segs = (x) => (x.e <= cycle ? [[x.s, x.e]] : [[x.s, cycle], [0, x.e - cycle]]);
    for (const [sa, ea] of segs(a)) {
      for (const [sb, eb] of segs(b)) {
        if (Math.min(ea, eb) > Math.max(sa, sb)) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < intervals.length; i++) {
    let hasCollision = false;
    for (let j = 0; j < intervals.length; j++) {
      if (i !== j && collides(intervals[i], intervals[j])) {
        hasCollision = true;
        break;
      }
    }
    if (!hasCollision) {
      lanes.set(intervals[i].ev.id, { lane: 0, count: 1 });
    } else {
      const isPm = intervals[i].ev.startMin >= 720;
      lanes.set(intervals[i].ev.id, { lane: isPm ? 1 : 0, count: 2 });
    }
  }
  return lanes;
}

export function eventLaneRadii(ev, layout, lanes, is12h) {
  const info = lanes.get(ev.id) ?? { lane: 0, count: 1 };
  if (info.count === 1) return { rInner: layout.rInner, rOuter: layout.rOuter };
  const mid = 0.5 * (layout.rInner + layout.rOuter);
  const gap = 2;
  return info.lane === 0
    ? { rInner: layout.rInner, rOuter: mid - gap }
    : { rInner: mid + gap, rOuter: layout.rOuter };
}

export function eventAngles(ev, is12h) {
  const cycle = is12h ? 720 : 1440;
  const startAngle = minutesToAngle(ev.startMin, is12h);
  const dur = Math.max(SNAP_MINUTES, ev.endMin - ev.startMin);
  const spanAngle = Math.min(Math.PI * 1.94, (dur / cycle) * Math.PI * 2);
  return { startAngle, spanAngle, endAngle: startAngle + spanAngle };
}

export function hitTestDial(px, py, layout, events, activeId, is12h) {
  const lanes = computeLanes(events, is12h);
  const activeEv = events.find((e) => e.id === activeId) ?? events[0];
  if (activeEv) {
    const { rInner, rOuter } = eventLaneRadii(activeEv, layout, lanes, is12h);
    const rMid = 0.5 * (rInner + rOuter);
    const { startAngle, endAngle } = eventAngles(activeEv, is12h);
    const sx = layout.cx + rMid * Math.sin(startAngle);
    const sy = layout.cy - rMid * Math.cos(startAngle);
    const ex = layout.cx + rMid * Math.sin(endAngle);
    const ey = layout.cy - rMid * Math.cos(endAngle);
    const ds = Math.hypot(px - sx, py - sy);
    const de = Math.hypot(px - ex, py - ey);
    if (ds <= 26 || de <= 26) {
      return { kind: ds <= de ? 'start' : 'end', event: activeEv };
    }
  }

  const dx = px - layout.cx;
  const dy = py - layout.cy;
  const r = Math.hypot(dx, dy);
  if (r < layout.rInner - 12 || r > layout.rOuter + 14) return null;
  const theta = Math.atan2(dx, -dy);

  for (const ev of events) {
    const { rInner, rOuter } = eventLaneRadii(ev, layout, lanes, is12h);
    if (r < rInner - 8 || r > rOuter + 8) continue;
    const { startAngle, spanAngle } = eventAngles(ev, is12h);
    const mid = startAngle + 0.5 * spanAngle;
    const delta = Math.abs(wrapDeltaPi(theta - mid));
    if (delta <= 0.5 * spanAngle + 0.08) {
      return { kind: 'move', event: ev };
    }
  }
  return null;
}
// #endregion polar-hit

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  is12h: false,
  showHit: false,
  events: INITIAL_EVENTS.map((e) => ({ ...e })),
  activeId: 1,
  nextId: 4,
  hasPainted: false,
  onScreen: true,
  uploads: 0,
  paints: 0,
  dirtySet: new Set(),
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  rafId: 0,
  minuteTimer: 0,
};

let stage = null;
let ctx2d = null;
let drag = null;
const textures = new Map();
const inspHitInvMat3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const stripHitInvMats = new Map();

function activeEvent() {
  return state.events.find((e) => e.id === state.activeId) ?? state.events[0];
}

function showNotice(msg) {
  noticeEl.hidden = !msg;
  noticeEl.textContent = msg || '';
}

function computeLayout() {
  const cw = Math.max(280, canvas.clientWidth || wrapEl.clientWidth || 354);
  const ch = Math.max(430, canvas.clientHeight || 520);
  const pad = cw < 420 ? 10 : 16;
  const dockW = Math.max(248, Math.min(520, cw - pad * 2));
  const dockH = cw < 430 ? 148 : 128;
  const dockX = Math.round((cw - dockW) * 0.5);
  const dockY = ch - dockH - pad;
  const dialRegionH = Math.max(220, dockY - pad);
  const dialSize = Math.floor(Math.min(cw - pad * 2, dialRegionH));
  const dialR = dialSize * 0.5;
  const cx = Math.round(cw * 0.5);
  const cy = Math.round(pad * 0.5 + dialRegionH * 0.5);
  const rOuter = dialR * 0.755;
  const rInner = dialR * 0.475;
  return {
    cw,
    ch,
    pad,
    dockX,
    dockY,
    dockW,
    dockH,
    dialSize,
    dialR,
    cx,
    cy,
    rOuter,
    rInner,
    rMid: 0.5 * (rOuter + rInner),
  };
}

function syncFaceDom(layout) {
  const size = `${layout.dialSize}px`;
  if (faceDom.style.width !== size) faceDom.style.width = size;
  if (faceDom.style.height !== size) faceDom.style.height = size;

  const rNum = layout.dialR * 0.895;
  const hours = state.is12h
    ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    : [0, 3, 6, 9, 12, 15, 18, 21];
  const cycle = state.is12h ? 12 : 24;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ev = activeEvent();
  const hubSpan = ev ? `${formatTimeLabel(ev.startMin, state.is12h)}-${formatTimeLabel(ev.endMin, state.is12h)}` : '';
  const hubSize = Math.max(76, Math.round(layout.rInner * 1.48));

  const numsHtml = hours.map((h) => {
    const a = (h / cycle) * Math.PI * 2;
    const x = layout.dialR + rNum * Math.sin(a);
    const y = layout.dialR - rNum * Math.cos(a);
    const label = state.is12h ? String(h) : String(h).padStart(2, '0');
    const isMajor = state.is12h ? h % 3 === 0 : h % 6 === 0;
    return `<span class="dial-num${isMajor ? ' major' : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${label}</span>`;
  }).join('');

  const hubHtml = `
    <div class="dial-hub" style="width:${hubSize}px;height:${hubSize}px">
      <span class="hub-mode">${state.is12h ? '12H DIAL' : '24H DIAL'}</span>
      <strong class="hub-time">${hh}:${mm}</strong>
      <span class="hub-span">${hubSpan}</span>
    </div>
  `;
  const nextHtml = numsHtml + hubHtml;
  if (faceDom.dataset.key !== `${layout.dialSize}:${state.is12h}:${hh}:${mm}:${hubSpan}`) {
    faceDom.dataset.key = `${layout.dialSize}:${state.is12h}:${hh}:${mm}:${hubSpan}`;
    faceDom.innerHTML = nextHtml;
    markDirty(faceDom);
  }
}

function createStripElement(ev) {
  const el = document.createElement('div');
  el.className = 'ev-strip';
  el.setAttribute('drawable', '');
  el.dataset.evId = String(ev.id);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ev-hit';
  btn.innerHTML = '<span class="ev-dot" aria-hidden="true"></span><span class="ev-text"><span class="ev-title"></span><output class="ev-time"></output></span>';
  btn.addEventListener('click', () => {
    if (ev.id !== state.activeId) {
      state.activeId = ev.id;
      syncAllUI();
      syncClockGeometry(true);
      requestDraw();
    }
  });
  el.append(btn);
  ev.el = el;
  ev.btn = btn;
  ev.titleEl = btn.querySelector('.ev-title');
  ev.timeEl = btn.querySelector('.ev-time');
  return el;
}

function mountMissingStrips() {
  const targetParent = state.mode === 'plain' ? plainHost : canvas;
  for (const ev of state.events) {
    if (!ev.el) createStripElement(ev);
    if (ev.el.parentElement !== targetParent) {
      if (targetParent === canvas) canvas.insertBefore(ev.el, inspectorEl);
      else plainHost.insertBefore(ev.el, inspectorEl);
    }
  }
}

function syncEventStripsUI() {
  mountMissingStrips();
  for (const ev of state.events) {
    const pal = PALETTE[ev.colorIdx % PALETTE.length];
    const isAct = ev.id === state.activeId;
    ev.el.classList.toggle('is-active', isAct);
    ev.el.style.setProperty('--ev-bg', pal.fill);
    ev.btn.setAttribute('aria-pressed', String(isAct));
    const timeText = `${formatTimeLabel(ev.startMin, state.is12h)}-${formatTimeLabel(ev.endMin, state.is12h)}`;
    if (ev.titleEl.textContent !== ev.title) {
      ev.titleEl.textContent = ev.title;
      markDirty(ev.el);
    }
    if (ev.timeEl.textContent !== timeText) {
      ev.timeEl.textContent = timeText;
      markDirty(ev.el);
    }
  }
}

function syncInspectorUI(layout) {
  let changed = false;
  if (state.mode !== 'plain' && layout) {
    const w = `${layout.dockW}px`;
    const h = `${layout.dockH}px`;
    if (inspectorEl.style.width !== w) { inspectorEl.style.width = w; changed = true; }
    if (inspectorEl.style.height !== h) { inspectorEl.style.height = h; changed = true; }
    const wide = layout.dockW >= 440;
    if (inspectorEl.classList.contains('is-wide') !== wide) {
      inspectorEl.classList.toggle('is-wide', wide);
      changed = true;
    }
  } else {
    if (inspectorEl.style.width) { inspectorEl.style.width = ''; changed = true; }
    if (inspectorEl.style.height) { inspectorEl.style.height = ''; changed = true; }
    if (inspectorEl.classList.contains('is-wide')) {
      inspectorEl.classList.remove('is-wide');
      changed = true;
    }
  }

  const ev = activeEvent();
  if (!ev) return;
  const idx = state.events.findIndex((e) => e.id === ev.id);
  const pal = PALETTE[ev.colorIdx % PALETTE.length];
  if (inspDot.dataset.color !== pal.fill) {
    inspDot.dataset.color = pal.fill;
    inspDot.style.background = pal.fill;
    changed = true;
  }
  const badgeText = `${idx + 1} of ${state.events.length}`;
  if (inspBadge.textContent !== badgeText) { inspBadge.textContent = badgeText; changed = true; }
  if (document.activeElement !== titleInput && titleInput.value !== ev.title) {
    titleInput.value = ev.title;
    changed = true;
  }
  const sVal = formatTime24(ev.startMin);
  const eVal = formatTime24(ev.endMin);
  if (document.activeElement !== startInput && startInput.value !== sVal) {
    startInput.value = sVal;
    changed = true;
  }
  if (document.activeElement !== endInput && endInput.value !== eVal) {
    endInput.value = eVal;
    changed = true;
  }
  const durText = formatDuration(ev.startMin, ev.endMin);
  if (durationOut.textContent !== durText) { durationOut.textContent = durText; changed = true; }
  const dis = state.events.length < 2;
  if (prevBtn.disabled !== dis) { prevBtn.disabled = dis; changed = true; }
  if (nextBtn.disabled !== dis) { nextBtn.disabled = dis; changed = true; }
  if (changed) markDirty(inspectorEl);
}

function updateControlsUI() {
  mode24Btn.setAttribute('aria-pressed', String(!state.is12h));
  mode12Btn.setAttribute('aria-pressed', String(state.is12h));
  addBlockBtn.disabled = state.events.length >= MAX_EVENTS;
  const ev = activeEvent();
  if (ev) {
    hintEl.textContent = `Selected: ${ev.title} (${formatTimeLabel(ev.startMin, state.is12h)}-${formatTimeLabel(ev.endMin, state.is12h)}) · drag ring knobs to adjust`;
  }
}

function updateStatus() {
  const route = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent = `${route} · ${state.is12h ? '12h' : '24h'} dial · ${state.events.length} blocks · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads`;
}

function syncAllUI(layout = computeLayout()) {
  syncFaceDom(layout);
  syncEventStripsUI();
  syncInspectorUI(layout);
  updateControlsUI();
  updateStatus();
}

function markDirty(el) {
  if (el) state.dirtySet.add(el);
}

// #region geometry-sync
function makeHitInvMat3(m, w, h, out = new Float32Array(9)) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-8) return out;
  const invX = 1 / (det * Math.max(w, 1));
  const invY = 1 / (det * Math.max(h, 1));
  out[0] = m.d * invX;
  out[1] = -m.b * invY;
  out[2] = 0;
  out[3] = -m.c * invX;
  out[4] = m.a * invY;
  out[5] = 0;
  out[6] = (m.c * m.f - m.d * m.e) * invX;
  out[7] = (m.b * m.e - m.a * m.f) * invY;
  out[8] = 1;
  return out;
}

function cachedUnit(layout) {
  const zoom = inspectorEl.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${layout.dockW}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, inspectorEl, layout.dockW);
    state.unitCache.key = key;
    state.lastGeoKey = '';
  }
  return state.unitCache.unit;
}

export function syncClockGeometry(force = false, layout = computeLayout()) {
  if (state.mode === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;

  const lanes = computeLanes(state.events, state.is12h);
  const gripSize = Math.round((layout.rOuter + 18) * 2);
  const gripS = `${gripSize}px`;
  if (dialGrip.style.width !== gripS) dialGrip.style.width = gripS;
  if (dialGrip.style.height !== gripS) dialGrip.style.height = gripS;

  const geoParts = [
    layout.cw, layout.ch, layout.dockX, layout.dockY, layout.dockW, layout.dockH,
    state.is12h ? 1 : 0, state.activeId,
    ...state.events.map((e) => `${e.id}:${e.startMin}-${e.endMin}`),
  ];
  const geoKey = geoParts.join('|');
  if (!force && geoKey === state.lastGeoKey) return;
  state.lastGeoKey = geoKey;

  const u = cachedUnit(layout);

  // Circular dial touch-drag grip
  const gripLeft = layout.cx - gripSize * 0.5;
  const gripTop = layout.cy - gripSize * 0.5;
  canvas.updateElementGeometry(dialGrip, {
    canvasTransform: new DOMMatrix().translate(gripLeft * u, gripTop * u).scale(u, u),
  });
  dialGrip.dataset.hitTick = dialGrip.dataset.hitTick === '1' ? '0' : '1';

  // Flat inspector dock
  const inspMat = new DOMMatrix().translate(layout.dockX, layout.dockY);
  canvas.updateElementGeometry(inspectorEl, {
    canvasTransform: new DOMMatrix().scale(u).multiply(inspMat),
  });
  inspectorEl.dataset.hitTick = inspectorEl.dataset.hitTick === '1' ? '0' : '1';
  makeHitInvMat3(inspMat, layout.dockW, layout.dockH, inspHitInvMat3);

  // Tangent rotated hotspots on each event wedge midpoint
  for (const ev of state.events) {
    if (!ev.el) continue;
    const { rInner, rOuter } = eventLaneRadii(ev, layout, lanes, state.is12h);
    const rMid = 0.5 * (rInner + rOuter);
    const { startAngle, spanAngle } = eventAngles(ev, state.is12h);
    const midAngle = startAngle + 0.5 * spanAngle;
    const midX = layout.cx + rMid * Math.sin(midAngle);
    const midY = layout.cy - rMid * Math.cos(midAngle);
    const rotRad = Math.cos(midAngle) < 0 ? midAngle - Math.PI : midAngle;
    const sx = Math.min(1, Math.max(0.28, (spanAngle * rMid) / STRIP_W));
    const sy = Math.min(1, Math.max(0.45, (rOuter - rInner) / STRIP_H));

    const m = new DOMMatrix()
      .translate(midX, midY)
      .rotate((rotRad * 180) / Math.PI)
      .scale(sx, sy)
      .translate(-STRIP_W * 0.5, -STRIP_H * 0.5);

    canvas.updateElementGeometry(ev.el, {
      canvasTransform: new DOMMatrix().scale(u).multiply(m),
    });
    ev.el.dataset.hitTick = ev.el.dataset.hitTick === '1' ? '0' : '1';

    let inv = stripHitInvMats.get(ev.id);
    if (!inv) {
      inv = new Float32Array(9);
      stripHitInvMats.set(ev.id, inv);
    }
    makeHitInvMat3(m, STRIP_W, STRIP_H, inv);
  }
}
// #endregion geometry-sync

function tryUpload(el) {
  if (!stage || stage.lost || !state.hasPainted) return false;
  try {
    const tex = stage.upload(el);
    if (tex) {
      textures.set(el, tex);
      state.uploads++;
      return true;
    }
    return false;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return false;
    }
    throw err;
  }
}

function nowAngleForDial() {
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return minutesToAngle(mins, state.is12h);
}

function renderWebGL(changedSet = null) {
  if (!stage || stage.lost || !state.hasPainted) return;
  const layout = computeLayout();
  syncFaceDom(layout);
  syncInspectorUI(layout);

  const targets = [faceDom, inspectorEl, ...state.events.map((e) => e.el).filter(Boolean)];
  for (const el of targets) {
    const needUpload = !textures.has(el) || state.dirtySet.has(el) || (changedSet && changedSet.has(el));
    if (needUpload && tryUpload(el)) {
      state.dirtySet.delete(el);
    }
  }

  if (!textures.has(faceDom) || !textures.has(inspectorEl)) return;
  if (!stage.begin([0.047, 0.063, 0.098, 1])) return;
  syncClockGeometry(false, layout);

  const fullRect = ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch);
  const lanes = computeLanes(state.events, state.is12h);
  const active = activeEvent();

  // Pass 0: clock face + dial numerals
  stage.quad(faceDom, fullRect, (gl, loc) => {
    gl.uniform1i(loc('uPass'), 0);
    gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    gl.uniform2f(loc('uDialCenter'), layout.cx, layout.cy);
    gl.uniform1f(loc('uDialR'), layout.dialR);
    gl.uniform1f(loc('uRingInner'), layout.rInner);
    gl.uniform1f(loc('uRingOuter'), layout.rOuter);
    gl.uniform1i(loc('uIs12h'), state.is12h ? 1 : 0);
    gl.uniform1i(loc('uShowHit'), state.showHit ? 1 : 0);
  });

  // Pass 1: one polar wedge draw per live event strip
  for (const ev of state.events) {
    if (!ev.el || !textures.has(ev.el)) continue;
    const pal = PALETTE[ev.colorIdx % PALETTE.length];
    const { rInner, rOuter } = eventLaneRadii(ev, layout, lanes, state.is12h);
    const { startAngle, spanAngle } = eventAngles(ev, state.is12h);
    const invMat = stripHitInvMats.get(ev.id) ?? inspHitInvMat3;

    stage.quad(ev.el, fullRect, (gl, loc) => {
      gl.uniform1i(loc('uPass'), 1);
      gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
      gl.uniform2f(loc('uDialCenter'), layout.cx, layout.cy);
      gl.uniform1f(loc('uDialR'), layout.dialR);
      gl.uniform1f(loc('uRingInner'), layout.rInner);
      gl.uniform1f(loc('uRingOuter'), layout.rOuter);
      gl.uniform1i(loc('uIs12h'), state.is12h ? 1 : 0);
      gl.uniform1i(loc('uShowHit'), state.showHit ? 1 : 0);
      gl.uniform1f(loc('uStartAngle'), startAngle);
      gl.uniform1f(loc('uSpanAngle'), spanAngle);
      gl.uniform1f(loc('uLaneInner'), rInner);
      gl.uniform1f(loc('uLaneOuter'), rOuter);
      gl.uniform3f(loc('uEventColor'), pal.rgb[0], pal.rgb[1], pal.rgb[2]);
      gl.uniform3f(loc('uEventAccent'), pal.accent[0], pal.accent[1], pal.accent[2]);
      gl.uniform1i(loc('uIsActive'), ev.id === state.activeId ? 1 : 0);
      gl.uniformMatrix3fv(loc('uHitInv'), false, invMat);
    });
  }

  // Pass 2: live time hand sweep + hit-test wireframes
  let hasKnobs = 0;
  let sx = -20, sy = -20, ex = -20, ey = -20;
  if (active) {
    const { rInner, rOuter } = eventLaneRadii(active, layout, lanes, state.is12h);
    const rMid = 0.5 * (rInner + rOuter);
    const { startAngle, endAngle } = eventAngles(active, state.is12h);
    sx = layout.cx + rMid * Math.sin(startAngle);
    sy = layout.cy - rMid * Math.cos(startAngle);
    ex = layout.cx + rMid * Math.sin(endAngle);
    ey = layout.cy - rMid * Math.cos(endAngle);
    hasKnobs = 1;
  }
  stage.quad(inspectorEl, fullRect, (gl, loc) => {
    gl.uniform1i(loc('uPass'), 2);
    gl.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    gl.uniform2f(loc('uDialCenter'), layout.cx, layout.cy);
    gl.uniform1f(loc('uRingInner'), layout.rInner);
    gl.uniform1f(loc('uRingOuter'), layout.rOuter);
    gl.uniform1i(loc('uShowHit'), state.showHit ? 1 : 0);
    gl.uniform1f(loc('uNowAngle'), nowAngleForDial());
    gl.uniform2f(loc('uStartKnobPos'), sx, sy);
    gl.uniform2f(loc('uEndKnobPos'), ex, ey);
    gl.uniform1i(loc('uHasKnobs'), hasKnobs);
    gl.uniformMatrix3fv(loc('uInspHitInv'), false, inspHitInvMat3);
  });

  // Pass 3: live inspector card drawn 1:1 in the bottom dock
  stage.quad(inspectorEl, ElementGL.rect(canvas, layout.dockX, layout.dockY, layout.dockW, layout.dockH), (gl, loc) => {
    gl.uniform1i(loc('uPass'), 3);
  });

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!ctx2d || !state.hasPainted) return;
  const layout = computeLayout();
  syncFaceDom(layout);
  syncInspectorUI(layout);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#0d1118';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);

  // Clock plate
  ctx2d.beginPath();
  ctx2d.arc(layout.cx, layout.cy, layout.dialR, 0, Math.PI * 2);
  ctx2d.fillStyle = '#151b28';
  ctx2d.fill();
  ctx2d.strokeStyle = '#313d56';
  ctx2d.lineWidth = 1.5;
  ctx2d.stroke();

  // Groove
  ctx2d.beginPath();
  ctx2d.arc(layout.cx, layout.cy, layout.rMid, 0, Math.PI * 2);
  ctx2d.strokeStyle = '#0c1018';
  ctx2d.lineWidth = layout.rOuter - layout.rInner + 4;
  ctx2d.stroke();

  // Draw live HTML numerals + hub via 5-argument drawElementImage()
  ctx2d.drawElementImage(faceDom, layout.cx - layout.dialR, layout.cy - layout.dialR, layout.dialSize, layout.dialSize);

  const lanes = computeLanes(state.events, state.is12h);
  for (const ev of state.events) {
    const pal = PALETTE[ev.colorIdx % PALETTE.length];
    const { rInner, rOuter } = eventLaneRadii(ev, layout, lanes, state.is12h);
    const rMid = 0.5 * (rInner + rOuter);
    const { startAngle, spanAngle, endAngle } = eventAngles(ev, state.is12h);
    const a0 = startAngle - Math.PI * 0.5;
    const a1 = endAngle - Math.PI * 0.5;

    ctx2d.beginPath();
    ctx2d.arc(layout.cx, layout.cy, rMid, a0, a1);
    ctx2d.strokeStyle = pal.fill;
    ctx2d.lineWidth = rOuter - rInner;
    ctx2d.lineCap = 'butt';
    ctx2d.stroke();

    if (ev.id === state.activeId) {
      for (const ang of [startAngle, endAngle]) {
        ctx2d.beginPath();
        ctx2d.arc(layout.cx + rMid * Math.sin(ang), layout.cy - rMid * Math.cos(ang), 8, 0, Math.PI * 2);
        ctx2d.fillStyle = '#ffffff';
        ctx2d.fill();
      }
    }

    if (ev.el) {
      const midAngle = startAngle + 0.5 * spanAngle;
      const mx = layout.cx + rMid * Math.sin(midAngle);
      const my = layout.cy - rMid * Math.cos(midAngle);
      const rot = Math.cos(midAngle) < 0 ? midAngle - Math.PI : midAngle;
      const sx = Math.min(1, Math.max(0.35, (spanAngle * rMid) / STRIP_W));
      const sy = Math.min(1, Math.max(0.45, (rOuter - rInner) / STRIP_H));
      ctx2d.save();
      ctx2d.translate(mx, my);
      ctx2d.rotate(rot);
      ctx2d.scale(sx, sy);
      ctx2d.drawElementImage(ev.el, -STRIP_W * 0.5, -STRIP_H * 0.5, STRIP_W, STRIP_H);
      ctx2d.restore();
    }
  }

  // Live time needle starting at the hub bezel so center digits stay clear
  const na = nowAngleForDial();
  const tailR = Math.max(layout.rInner - 13, 8);
  ctx2d.beginPath();
  ctx2d.moveTo(layout.cx + tailR * Math.sin(na), layout.cy - tailR * Math.cos(na));
  ctx2d.lineTo(layout.cx + (layout.rOuter + 8) * Math.sin(na), layout.cy - (layout.rOuter + 8) * Math.cos(na));
  ctx2d.strokeStyle = '#fa6b40';
  ctx2d.lineWidth = 2;
  ctx2d.stroke();

  // Live inspector card in dock via 5-argument drawElementImage()
  ctx2d.drawElementImage(inspectorEl, layout.dockX, layout.dockY, layout.dockW, layout.dockH);
  ctx2d.restore();
  syncClockGeometry(false, layout);
  state.dirtySet.clear();
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  stopSweepLoop();
  wrapEl.classList.add('plain');
  mountMissingStrips();
  if (inspectorEl.parentElement !== plainHost) plainHost.append(inspectorEl);
  syncAllUI();
  showNotice(reason);
}

function exitPlainFallback() {
  wrapEl.classList.remove('plain');
  mountMissingStrips();
  if (inspectorEl.parentElement !== canvas) canvas.append(inspectorEl);
  showNotice('');
  state.lastGeoKey = '';
  syncClockGeometry(true);
  requestDraw(true);
}
// #endregion fallback-2d

function requestDraw(markAllDirty = false) {
  if (markAllDirty) {
    markDirty(faceDom);
    markDirty(inspectorEl);
    for (const ev of state.events) markDirty(ev.el);
  }
  if (state.mode === 'plain') {
    syncAllUI();
    return;
  }
  if (state.hasPainted && state.mode === 'webgl' && stage && !stage.lost && !state.dirtySet.size && textures.has(inspectorEl) && textures.has(faceDom)) {
    renderWebGL(null);
    return;
  }
  canvas.requestPaint?.();
}

function startSweepLoop() {
  if (!state.onScreen || document.hidden || state.mode === 'plain') return;
  if (reducedQuery.matches) {
    if (!state.minuteTimer) {
      state.minuteTimer = setInterval(() => {
        if (state.onScreen && !document.hidden) requestDraw(false);
      }, 30000);
    }
    return;
  }
  if (state.rafId) return;
  let lastDraw = 0;
  const tick = (now) => {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.mode === 'plain' || reducedQuery.matches) return;
    if (now - lastDraw >= 950) {
      lastDraw = now;
      if (state.hasPainted && state.mode === 'webgl' && stage && !stage.lost && textures.has(inspectorEl) && textures.has(faceDom)) {
        renderWebGL(null);
      } else {
        canvas.requestPaint?.();
      }
    }
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function stopSweepLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  if (state.minuteTimer) {
    clearInterval(state.minuteTimer);
    state.minuteTimer = 0;
  }
}

function wireCanvas(cv) {
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
      enterPlainFallback('The 2D canvas context was lost. Controls are shown as plain HTML until restored.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      exitPlainFallback();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: CLOCK_FRAG,
        onLost: () => {
          textures.clear();
          state.hasPainted = false;
          enterPlainFallback('WebGL 2 context lost. Showing the planner as plain HTML until the browser restores it.');
        },
        onRestored: () => {
          textures.clear();
          state.hasPainted = false;
          state.mode = 'webgl';
          exitPlainFallback();
          startSweepLoop();
        },
      });
      state.mode = 'webgl';
      wireCanvas(canvas);
      syncAllUI();
      syncClockGeometry(true);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'clock-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(dialGrip, faceDom, inspectorEl);
      canvas.replaceWith(fresh);
      window.__gfx?.retire?.(canvas);
      canvas = fresh;
      mountMissingStrips();
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
      wireCanvas(canvas);
      syncAllUI();
      syncClockGeometry(true);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the planner is shown as plain HTML.');
}

// Inspector & control listeners
titleInput.addEventListener('input', () => {
  const ev = activeEvent();
  if (!ev) return;
  ev.title = titleInput.value || 'Untitled';
  syncEventStripsUI();
  updateControlsUI();
  markDirty(inspectorEl);
  markDirty(ev.el);
  requestDraw();
});

function handleTimeEdit(which, isFinal) {
  const ev = activeEvent();
  if (!ev) return;
  const input = which === 'start' ? startInput : endInput;
  const mins = parseHHMM(input.value);
  if (mins === null) return;
  if (which === 'start') {
    ev.startMin = Math.min(1424, mins);
    if (ev.endMin <= ev.startMin + SNAP_MINUTES - 1) {
      ev.endMin = Math.min(1439, ev.startMin + SNAP_MINUTES);
    }
  } else {
    if (mins > ev.startMin + 4) {
      ev.endMin = mins;
    } else if (isFinal) {
      ev.endMin = Math.min(1439, ev.startMin + SNAP_MINUTES);
      endInput.value = formatTime24(ev.endMin);
    }
  }
  syncAllUI();
  syncClockGeometry(true);
  requestDraw(true);
}

startInput.addEventListener('input', () => handleTimeEdit('start', false));
startInput.addEventListener('change', () => handleTimeEdit('start', true));
endInput.addEventListener('input', () => handleTimeEdit('end', false));
endInput.addEventListener('change', () => handleTimeEdit('end', true));

function stepActiveEvent(delta) {
  if (!state.events.length) return;
  const idx = state.events.findIndex((e) => e.id === state.activeId);
  const nextIdx = ((idx < 0 ? 0 : idx) + delta + state.events.length) % state.events.length;
  state.activeId = state.events[nextIdx].id;
  syncAllUI();
  syncClockGeometry(true);
  requestDraw(true);
}

prevBtn.addEventListener('click', () => stepActiveEvent(-1));
nextBtn.addEventListener('click', () => stepActiveEvent(1));

mode24Btn.addEventListener('click', () => {
  if (!state.is12h) return;
  state.is12h = false;
  syncAllUI();
  syncClockGeometry(true);
  requestDraw(true);
});

mode12Btn.addEventListener('click', () => {
  if (state.is12h) return;
  state.is12h = true;
  syncAllUI();
  syncClockGeometry(true);
  requestDraw(true);
});

function findOpenSlot(events) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin);
  const candidates = [];
  let cursor = 6 * 60;
  for (const ev of sorted) {
    if (ev.startMin - cursor >= 60) candidates.push([cursor, Math.min(ev.startMin, cursor + 90)]);
    cursor = Math.max(cursor, ev.endMin);
  }
  if (1425 - cursor >= 60) candidates.push([cursor, Math.min(1425, cursor + 90)]);
  if (sorted.length && sorted[0].startMin >= 60) candidates.push([Math.max(0, sorted[0].startMin - 90), sorted[0].startMin]);
  if (candidates.length) {
    candidates.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    return candidates[0];
  }
  // Fall back to any 30-minute open gap across [0..1425]
  cursor = 0;
  for (const ev of sorted) {
    if (ev.startMin - cursor >= 30) return [cursor, Math.min(ev.startMin, cursor + 60)];
    cursor = Math.max(cursor, ev.endMin);
  }
  if (1425 - cursor >= 30) return [cursor, Math.min(1425, cursor + 60)];
  return null;
}

addBlockBtn.addEventListener('click', () => {
  if (state.events.length >= MAX_EVENTS) return;
  const slot = findOpenSlot(state.events);
  const [s, e] = slot ?? [20 * 60, 21 * 60 + 30];
  const colorIdx = (state.nextId - 1) % PALETTE.length;
  const title = EXTRA_TITLES[(state.nextId - 4) % EXTRA_TITLES.length] ?? `Block ${state.nextId}`;
  const ev = { id: state.nextId++, title, startMin: s, endMin: e, colorIdx };
  state.events.push(ev);
  state.activeId = ev.id;
  syncAllUI();
  syncClockGeometry(true);
  requestDraw(true);
});

resetBtn.addEventListener('click', () => {
  for (const ev of state.events) {
    if (ev.el) {
      stage?.forget(ev.el);
      textures.delete(ev.el);
      ev.el.remove();
    }
  }
  stripHitInvMats.clear();
  state.events = INITIAL_EVENTS.map((e) => ({ ...e }));
  state.activeId = 1;
  state.nextId = 4;
  syncAllUI();
  syncClockGeometry(true);
  requestDraw(true);
});

showHitToggle.addEventListener('change', () => {
  state.showHit = showHitToggle.checked;
  requestDraw(false);
});

// Ring handle dragging (start/end knobs and block sliding)
function canvasLocalXY(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function dialAngleAt(x, y, layout) {
  return Math.atan2(x - layout.cx, -(y - layout.cy));
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode === 'plain' || e.button !== 0) return;
  if (e.target instanceof Element && e.target.closest('#clock-inspector')) return;

  const layout = computeLayout();
  const { x, y } = canvasLocalXY(e);
  if (y >= layout.dockY - 4) return;

  const hit = hitTestDial(x, y, layout, state.events, state.activeId, state.is12h);
  if (!hit) return;

  e.preventDefault();
  const ev = hit.event;
  if (ev.id !== state.activeId) {
    state.activeId = ev.id;
    syncAllUI(layout);
    syncClockGeometry(true, layout);
    requestDraw(true);
  }

  const origAnchor = hit.kind === 'end' ? ev.endMin : ev.startMin;
  const origDuration = ev.endMin - ev.startMin;
  const bounds = getSiblingBounds(ev, state.events);

  drag = {
    pointerId: e.pointerId,
    ev,
    kind: hit.kind,
    origAnchor,
    origDuration,
    bounds,
    lastAngle: dialAngleAt(x, y, layout),
    accumAngle: 0,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
  canvas.classList.add('dragging-handle');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
}, { capture: true });

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
    drag.moved = true;
  }
  const layout = computeLayout();
  const { x, y } = canvasLocalXY(e);
  const curAngle = dialAngleAt(x, y, layout);
  drag.accumAngle += wrapDeltaPi(curAngle - drag.lastAngle);
  drag.lastAngle = curAngle;

  const cycle = state.is12h ? 720 : 1440;
  const targetMin = drag.origAnchor + (drag.accumAngle / (Math.PI * 2)) * cycle;
  const prevStart = drag.ev.startMin;
  const prevEnd = drag.ev.endMin;

  applyHandleDrag(drag.ev, drag.kind, targetMin, state.events, drag.origDuration, drag.bounds);
  if (drag.ev.startMin !== prevStart || drag.ev.endMin !== prevEnd) {
    syncAllUI(layout);
    syncClockGeometry(true, layout);
    requestDraw(true);
    startInput.dispatchEvent(new Event('input', { bubbles: true }));
    endInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const finished = drag;
  drag = null;
  canvas.classList.remove('dragging-handle');
  if (finished.moved) {
    startInput.dispatchEvent(new Event('change', { bubbles: true }));
    endInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Lifecycle observers
new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (state.onScreen) {
    startSweepLoop();
    requestDraw(false);
  } else {
    stopSweepLoop();
  }
}).observe(wrapEl);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSweepLoop();
  else if (state.onScreen) {
    startSweepLoop();
    requestDraw(false);
  }
});

reducedQuery.addEventListener?.('change', () => {
  stopSweepLoop();
  startSweepLoop();
  requestDraw(false);
});

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKey = '';
    syncAllUI();
    syncClockGeometry(true);
    requestDraw(true);
  }
}).observe(wrapEl);

initBackend();
startSweepLoop();

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

async function retireFixture(cv) {
  cv.remove();
  window.__gfx?.retire?.(cv);
  if (!window.__gfx?.active) return;
  const baseline = state.mode === 'webgl' ? 1 : 0;
  for (let i = 0; i < 10; i++) {
    if (window.__gfx.active() <= baseline && window.__gfx.memory().removed === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function makeFixtureClock(w = 240, h = 320) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const strip = document.createElement('div');
  strip.setAttribute('drawable', '');
  strip.style.cssText = `position:absolute;left:0;top:0;width:${STRIP_W}px;height:${STRIP_H}px;display:flex;align-items:center;padding:0 10px;box-sizing:border-box;color:#fff;font:700 12px system-ui`;
  const hitBtn = document.createElement('button');
  hitBtn.type = 'button';
  hitBtn.textContent = 'Fixture block 09:00-11:00';
  hitBtn.style.cssText = 'width:100%;height:100%;border:0;background:transparent;color:#fff;font:700 12px system-ui';
  strip.append(hitBtn);

  const insp = document.createElement('section');
  insp.setAttribute('drawable', '');
  insp.style.cssText = `position:absolute;left:0;top:0;width:${w - 20}px;height:96px;padding:8px;box-sizing:border-box;background:#161c28;color:#fff;border-radius:10px;display:grid;gap:6px`;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center';
  const nextB = document.createElement('button');
  nextB.type = 'button';
  nextB.textContent = 'Next';
  nextB.style.cssText = 'min-height:34px;padding:4px 10px';
  const tIn = document.createElement('input');
  tIn.type = 'time';
  tIn.setAttribute('step', '60');
  tIn.setAttribute('inputmode', 'none');
  tIn.setAttribute('aria-label', 'Fixture start time');
  tIn.value = '09:00';
  tIn.style.cssText = 'min-height:34px;flex:1;min-width:0';
  const eIn = document.createElement('input');
  eIn.type = 'time';
  eIn.setAttribute('step', '60');
  eIn.setAttribute('inputmode', 'none');
  eIn.setAttribute('aria-label', 'Fixture end time');
  eIn.value = '11:00';
  eIn.style.cssText = 'min-height:34px;flex:1;min-width:0';
  const durOut = document.createElement('output');
  durOut.textContent = '2h 00m';
  row.append(nextB, tIn, eIn);
  insp.append(row, durOut);

  cv.append(strip, insp);
  return { cv, strip, hitBtn, insp, nextB, tIn, eIn, durOut };
}

runTests(testsBody, [
  {
    name: 'ElementGL uploads dial, event strip and inspector via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Creates an isolated ElementGL fixture on testStage(), waits for nextPaint(), renders the polar wedge pass and inspector pass, and checks gl.getError() === 0 plus readPixels() inside the wedge.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240, H = 320;
      const { cv, strip, insp } = makeFixtureClock(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CLOCK_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const gl = g.gl;
        while (gl.getError() !== gl.NO_ERROR) {}
        const tStrip = g.upload(strip);
        const tInsp = g.upload(insp);
        g.begin([0.05, 0.06, 0.1, 1]);
        const rect = ElementGL.rect(cv, 0, 0, W, H);
        // Pass 1 polar wedge spanning 06:00 (pi/2) to 12:00 (pi) around (120, 105)
        g.quad(strip, rect, (lgl, loc) => {
          lgl.uniform1i(loc('uPass'), 1);
          lgl.uniform2f(loc('uCanvasSize'), W, H);
          lgl.uniform2f(loc('uDialCenter'), 120, 105);
          lgl.uniform1f(loc('uDialR'), 95);
          lgl.uniform1f(loc('uRingInner'), 46);
          lgl.uniform1f(loc('uRingOuter'), 74);
          lgl.uniform1i(loc('uIs12h'), 0);
          lgl.uniform1i(loc('uShowHit'), 0);
          lgl.uniform1f(loc('uStartAngle'), Math.PI * 0.5);
          lgl.uniform1f(loc('uSpanAngle'), Math.PI * 0.5);
          lgl.uniform1f(loc('uLaneInner'), 46);
          lgl.uniform1f(loc('uLaneOuter'), 74);
          lgl.uniform3f(loc('uEventColor'), 0.145, 0.388, 0.922);
          lgl.uniform3f(loc('uEventAccent'), 0.576, 0.773, 0.992);
          lgl.uniform1i(loc('uIsActive'), 1);
        });
        g.quad(insp, ElementGL.rect(cv, 10, 212, W - 20, 96), (lgl, loc) => {
          lgl.uniform1i(loc('uPass'), 3);
        });
        const err = gl.getError();
        // Sample inside the 09:00 wedge (theta = 3*pi/4 -> lower-right at r = 60)
        const dpr = cv.width / W;
        const sx = Math.round((120 + 60 * Math.sin(Math.PI * 0.75)) * dpr);
        const sy = Math.round((H - (105 - 60 * Math.cos(Math.PI * 0.75))) * dpr);
        const px = new Uint8Array(4);
        gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return need(
          err === gl.NO_ERROR && tStrip?.w > 0 && tInsp?.w > 0 && px[2] > 140,
          `gl.getError()=${err}, strip ${tStrip?.w}x${tStrip?.h}, insp ${tInsp?.w}x${tInsp?.h}, wedge rgb(${px[0]}, ${px[1]}, ${px[2]}).`
        );
      } finally {
        g?.dispose();
        await retireFixture(cv);
      }
    },
  },
  {
    name: 'Polar pointToMinutes() maps angles to 24h and 12h clock times with 15-minute snap rounding',
    expect: 'pass',
    why: 'Probes top, right, bottom, left and off-grid pointer positions around the clock center and checks 15-minute snap rounding.',
    run: async () => {
      const dial = { cx: 180, cy: 180 };
      const t24 = pointToMinutes(180, 80, dial, false, 15);
      const r24 = pointToMinutes(280, 180, dial, false, 15);
      const b24 = pointToMinutes(180, 280, dial, false, 15);
      const l24 = pointToMinutes(80, 180, dial, false, 15);
      const r12 = pointToMinutes(280, 180, dial, true, 15);
      // 09:07 in 24h is angle 136.75 deg -> snaps to 09:00 (540); 09:08 -> 137.0 deg -> snaps to 09:15 (555)
      const a0907 = (547 / 1440) * Math.PI * 2;
      const a0908 = (548 / 1440) * Math.PI * 2;
      const snapDown = pointToMinutes(180 + 100 * Math.sin(a0907), 180 - 100 * Math.cos(a0907), dial, false, 15);
      const snapUp = pointToMinutes(180 + 100 * Math.sin(a0908), 180 - 100 * Math.cos(a0908), dial, false, 15);
      const ok = t24 === 0 && r24 === 360 && b24 === 720 && l24 === 1080 && r12 === 180 && snapDown === 540 && snapUp === 555;
      return need(ok, `24h=[${t24},${r24},${b24},${l24}], 12h@3=${r12}, snap(09:07)=${formatTime24(snapDown)}, snap(09:08)=${formatTime24(snapUp)}.`);
    },
  },
  {
    name: 'Dragging end handle updates <input type="time"> values and expands rendered arc pixels',
    expect: 'pass',
    why: 'Renders a 09:00-11:00 block, samples readPixels() at 12:00 (initially dial dark), drags end handle to 13:00, updates <input type="time"> and verifies the 12:00 pixel turns orange.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240, H = 320;
      const { cv, strip, insp, tIn, eIn, durOut } = makeFixtureClock(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: CLOCK_FRAG, attributes: { preserveDrawingBuffer: true } });
        const ev = { id: 1, startMin: 540, endMin: 660 };
        const drawEv = () => {
          const { startAngle, spanAngle } = eventAngles(ev, false);
          g.upload(strip);
          g.upload(insp);
          g.begin([0.05, 0.06, 0.1, 1]);
          g.quad(strip, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.uniform1i(loc('uPass'), 1);
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform2f(loc('uDialCenter'), 120, 105);
            gl.uniform1f(loc('uDialR'), 95);
            gl.uniform1f(loc('uRingInner'), 46);
            gl.uniform1f(loc('uRingOuter'), 74);
            gl.uniform1i(loc('uIs12h'), 0);
            gl.uniform1i(loc('uShowHit'), 0);
            gl.uniform1f(loc('uStartAngle'), startAngle);
            gl.uniform1f(loc('uSpanAngle'), spanAngle);
            gl.uniform1f(loc('uLaneInner'), 46);
            gl.uniform1f(loc('uLaneOuter'), 74);
            gl.uniform3f(loc('uEventColor'), 0.918, 0.345, 0.047);
            gl.uniform3f(loc('uEventAccent'), 0.992, 0.729, 0.455);
            gl.uniform1i(loc('uIsActive'), 1);
          });
        };

        await nextPaint(cv);
        drawEv();
        const dpr = cv.width / W;
        // 12:00 in 24h mode is straight down (120, 105 + 60 = 165)
        const sx = Math.round(120 * dpr);
        const sy = Math.round((H - 165) * dpr);
        const beforePx = new Uint8Array(4);
        g.gl.readPixels(sx, sy, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, beforePx);

        // Drag end handle from 11:00 (660) to 13:00 (780)
        applyHandleDrag(ev, 'end', 780, [ev]);
        tIn.value = formatTime24(ev.startMin);
        eIn.value = formatTime24(ev.endMin);
        durOut.textContent = formatDuration(ev.startMin, ev.endMin);
        await nextPaint(cv);
        drawEv();
        const afterPx = new Uint8Array(4);
        g.gl.readPixels(sx, sy, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, afterPx);

        return need(
          beforePx[0] < 40 && afterPx[0] > 170 && tIn.value === '09:00' && eIn.value === '13:00' && durOut.textContent === '4h 00m',
          `before 12:00 rgb(${beforePx[0]},${beforePx[1]},${beforePx[2]}) -> after rgb(${afterPx[0]},${afterPx[1]},${afterPx[2]}), inputs ${tIn.value}-${eIn.value} (${durOut.textContent}).`
        );
      } finally {
        g?.dispose();
        await retireFixture(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps active <input type="time">, <button> and tangent hotspot clickable',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled updateElementGeometry() with dataset.hitTick to both the flat dock and rotated tangent event hotspot and verifies document.elementsFromPoint() hits.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 240, H = 320;
      const { cv, strip, hitBtn, insp, nextB, tIn } = makeFixtureClock(W, H);
      testStage().append(cv);
      let g = null;
      let ctx = null;
      try {
        if (glSupported) g = new ElementGL(cv, { fragment: CLOCK_FRAG });
        else ctx = cv.getContext('2d');
        await nextPaint(cv);
        if (g) {
          g.upload(strip);
          g.upload(insp);
          g.begin([0.05, 0.06, 0.1, 1]);
          g.quad(insp, ElementGL.rect(cv, 10, 210, W - 20, 96), (gl, loc) => { gl.uniform1i(loc('uPass'), 3); });
        } else if (ctx) {
          ctx.drawElementImage(insp, 10, 210, W - 20, 96);
          ctx.drawElementImage(strip, 40, 60, STRIP_W * 0.65, STRIP_H);
        }

        const u = geometryUnit(cv, insp, W - 20);
        cv.updateElementGeometry(insp, {
          canvasTransform: new DOMMatrix().scale(u).translate(10, 210),
        });
        insp.dataset.hitTick = '1';

        const stripMat = new DOMMatrix().translate(145, 76).rotate(25).scale(0.65, 0.9).translate(-STRIP_W * 0.5, -STRIP_H * 0.5);
        cv.updateElementGeometry(strip, {
          canvasTransform: new DOMMatrix().scale(u).multiply(stripMat),
        });
        strip.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hitCenter = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };
        const timeOk = hitCenter(tIn).includes(tIn);
        const btnOk = hitCenter(nextB).includes(nextB);
        const stripOk = hitCenter(hitBtn).includes(hitBtn);
        return need(
          timeOk && btnOk && stripOk,
          `elementsFromPoint hits: <input type="time">=${timeOk}, Next button=${btnOk}, rotated hotspot=${stripOk}.`
        );
      } finally {
        g?.dispose();
        await retireFixture(cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'clock-calendar stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !textures.has(inspectorEl) || !textures.has(faceDom)) return 0;
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
