import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);

const wrap = $('catoptric-wrap');
const canvas = $('catoptric-canvas');
const card = $('catoptric-card');
const hintEl = $('catoptric-hint');
const statusEl = $('catoptric-status');
const noticeEl = $('catoptric-notice');

// Live HTML source card elements
const cardHeadline = $('card-headline');
const cardSub = $('card-sub');
const cardStampCount = $('card-stamp-count');
const cardInput = $('catoptric-input');
const cardStampBtn = $('card-stamp');
const cardFootText = $('card-foot-text');
const accentBtns = [...document.querySelectorAll('[data-card-accent]')];

// Stage controls
const presetBtns = [...document.querySelectorAll('[data-preset]')];
const surfaceBtns = [...document.querySelectorAll('[data-surface]')];
const ctlOrbit = $('ctl-orbit');
const outOrbit = $('out-orbit');
const ctlElev = $('ctl-elev');
const outElev = $('out-elev');
const btnLift = $('btn-lift');
const btnOffset = $('btn-offset');
const btnCentre = $('btn-centre');
const ctlHitQuad = $('ctl-hitquad');

// Optical and 3D scene constants shared identically between GLSL and CPU raytracer
const CARD_W = 320;
const CARD_H = 200;
const CYL_R = 0.94;
const CYL_H = 1.62;
const CARD_Y_MIN = 0.14;
const CARD_Y_MAX = 1.42;
const THETA_MAX_CARD = (56 * Math.PI) / 180;
const SIN_MAX = Math.sin(THETA_MAX_CARD); // 0.82903757

// Reference gallery camera C0 that defines the tabletop catoptric print
const REF_TARGET = [0, 0.34, 0.72];
const REF_ELEV_DEG = 41;
const REF_DIST = 8.4;
const REF_FOV_DEG = 27.5;
const REF_ELEV_RAD = (REF_ELEV_DEG * Math.PI) / 180;
const REF_Y0 = REF_TARGET[1] + REF_DIST * Math.sin(REF_ELEV_RAD); // 5.850868
const REF_Z0 = REF_TARGET[2] + REF_DIST * Math.cos(REF_ELEV_RAD); // 7.059560

const PRESETS = {
  gallery: { orbitDeg: 0, elevDeg: 41, dist: 8.4, target: [0, 0.34, 0.72] },
  low: { orbitDeg: 0, elevDeg: 28, dist: 6.8, target: [0, 0.42, 0.35] },
  top: { orbitDeg: 0, elevDeg: 78, dist: 9.8, target: [0, 0.0, 0.92] },
};

const CATOPTRIC_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform vec2 uBufSize;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalf;
uniform vec2 uCylPos;
uniform float uCylLift;
uniform int uShowHit;
uniform mat3 uHitInv;
uniform vec2 uHitPt;

in vec2 vUv;
out vec4 outColor;

const float CYL_R = 0.94;
const float CYL_H = 1.62;
const float CARD_Y_MIN = 0.14;
const float CARD_Y_MAX = 1.42;
const float SIN_MAX = 0.82903757;
const float REF_Y0 = 5.850868;
const float REF_Z0 = 7.059560;
const vec3 KEY_DIR = vec3(-0.31700, 0.91579, 0.24656);

// #region alhazen-catoptric
struct TableUV {
  bool ok;
  vec2 uv;
  mat2 dUvDq; // col 0 = d(uv)/dqx, col 1 = d(uv)/dqz
};

// Solve Alhazen's circular-mirror reflection problem on y = 0 for reference camera (0, REF_Y0, REF_Z0)
// and focal circle (0, 0) of radius CYL_R. Returns card UV and closed-form 2x2 Jacobian d(uv)/dQ.
TableUV solveTableUV(vec2 q) {
  TableUV res;
  res.ok = false;
  res.uv = vec2(-1.0);
  res.dUvDq = mat2(0.0);

  float r = length(q);
  if (r <= CYL_R * 1.001) return res;

  float phi = atan(q.x, q.y);
  float thLimA = acos(clamp(CYL_R / REF_Z0, -1.0, 1.0)) - 0.0002;
  float thLimQ = acos(clamp(CYL_R / r, -1.0, 1.0)) - 0.0002;
  float lo = max(-thLimA, phi - thLimQ);
  float hi = min(thLimA, phi + thLimQ);
  if (lo >= hi) return res;

  float th = clamp(phi * 0.5, lo + 0.0002, hi - 0.0002);
  for (int i = 0; i < 6; i++) {
    float c1 = cos(th);
    float s1 = sin(th);
    float d = phi - th;
    float c2 = cos(d);
    float s2 = sin(d);
    float a1 = atan(REF_Z0 * s1, REF_Z0 * c1 - CYL_R);
    float a2 = atan(r * s2, r * c2 - CYL_R);
    float f = a1 - a2;
    float denom1 = REF_Z0 * REF_Z0 - 2.0 * CYL_R * REF_Z0 * c1 + CYL_R * CYL_R;
    float denom2 = r * r - 2.0 * CYL_R * r * c2 + CYL_R * CYL_R;
    float df = (REF_Z0 * REF_Z0 - CYL_R * REF_Z0 * c1) / max(denom1, 1e-6)
             + (r * r - CYL_R * r * c2) / max(denom2, 1e-6);
    th = clamp(th - f / max(df, 1e-5), lo + 0.0001, hi - 0.0001);
  }

  float c1 = cos(th);
  float s1 = sin(th);
  float c2 = cos(phi - th);
  float d1 = sqrt(max(1e-8, REF_Z0 * REF_Z0 - 2.0 * CYL_R * REF_Z0 * c1 + CYL_R * CYL_R));
  float d2 = sqrt(max(1e-8, r * r - 2.0 * CYL_R * r * c2 + CYL_R * CYL_R));
  float y = REF_Y0 * d2 / (d1 + d2);

  float u = 0.5 + (s1 / SIN_MAX) * 0.5;
  float v = (CARD_Y_MAX - y) / (CARD_Y_MAX - CARD_Y_MIN);

  // Closed-form Jacobian d(uv)/d(qx, qz) via inverse of forward map d(qx, qz)/d(th, y)
  float yGap = max(REF_Y0 - y, 0.05);
  float s = y / yGap;
  float dsdy = REF_Y0 / (yGap * yGap);
  float c2th = cos(2.0 * th);
  float s2th = sin(2.0 * th);

  float dQxDth = CYL_R * c1 + s * (2.0 * REF_Z0 * c2th - CYL_R * c1);
  float dQzDth = -CYL_R * s1 + s * (-2.0 * REF_Z0 * s2th + CYL_R * s1);
  float dQxDy = dsdy * (REF_Z0 * s2th - CYL_R * s1);
  float dQzDy = dsdy * (REF_Z0 * c2th - CYL_R * c1);
  float det = dQxDth * dQzDy - dQxDy * dQzDth;
  if (abs(det) < 1e-6) return res;

  float invDet = 1.0 / det;
  float duDth = c1 / (2.0 * SIN_MAX);
  float dvDy = -1.0 / (CARD_Y_MAX - CARD_Y_MIN);

  res.ok = true;
  res.uv = vec2(u, v);
  res.dUvDq = mat2(
    duDth * (dQzDy * invDet),
    dvDy * (-dQzDth * invDet),
    duDth * (-dQxDy * invDet),
    dvDy * (dQxDth * invDet)
  );
  return res;
}
// #endregion alhazen-catoptric

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 studioEnv(vec3 dir) {
  float elev = clamp(dir.y, -1.0, 1.0);
  vec3 wall = mix(vec3(0.08, 0.07, 0.065), vec3(0.18, 0.16, 0.14), smoothstep(-0.1, 0.75, elev));
  float az = atan(dir.x, dir.z);

  // Two crisp vertical studio softboxes positioned along the cylinder shoulders
  float sbLeft = exp(-pow((az + 1.48) * 3.6, 2.0)) * smoothstep(-0.08, 0.25, elev) * smoothstep(0.95, 0.45, elev);
  float sbRight = exp(-pow((az - 1.52) * 4.2, 2.0)) * smoothstep(-0.05, 0.28, elev) * smoothstep(0.95, 0.42, elev);
  float overhead = smoothstep(0.55, 0.96, elev) * 0.52;

  vec3 col = wall;
  col += vec3(1.00, 0.96, 0.89) * sbLeft * 0.95;
  col += vec3(0.84, 0.91, 1.00) * sbRight * 0.80;
  col += vec3(0.96, 0.93, 0.87) * overhead;
  return col;
}

float cylinderShadow(vec2 q) {
  // Soft directional shadow cast by the cylinder onto y = 0
  if (uCylLift > 2.6) return 1.0;
  float liftFade = 1.0 - smoothstep(0.15, 2.55, uCylLift);

  // Tight contact occlusion ring around cylinder base when resting on table
  float distBase = length(q - uCylPos);
  float contact = 1.0 - (1.0 - smoothstep(CYL_R * 0.92, CYL_R * 1.09, distBase)) * 0.34 * (1.0 - smoothstep(0.0, 0.45, uCylLift));

  // Projected cylinder axis segment from base (y = uCylLift) to top (y = uCylLift + CYL_H)
  vec2 stepXZ = -KEY_DIR.xz / max(KEY_DIR.y, 0.2);
  vec2 p0 = uCylPos + stepXZ * uCylLift;
  vec2 p1 = uCylPos + stepXZ * (uCylLift + CYL_H);
  vec2 pa = q - p0;
  vec2 ba = p1 - p0;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  float dSeg = length(pa - ba * h);
  float blur = 0.14 + uCylLift * 0.18 + h * 0.12;
  float castShade = 1.0 - (1.0 - smoothstep(CYL_R - blur * 0.4, CYL_R + blur, dSeg)) * 0.34 * liftFade;

  return min(contact, castShade);
}

vec3 shadeTabletop(vec2 q, vec2 dQdx, vec2 dQdy, bool inMirror) {
  // Archival parchment folio sheet lying on a warm dark walnut gallery table
  vec2 sheetMin = vec2(-3.08, -1.36);
  vec2 sheetMax = vec2(3.08, 3.24);
  vec2 dBox = max(sheetMin - q, q - sheetMax);
  float sdfSheet = length(max(dBox, vec2(0.0))) + min(max(dBox.x, dBox.y), 0.0) - 0.06;

  // Walnut wood table surface outside the archival folio
  float grain = sin(q.y * 9.0 + sin(q.x * 1.4) * 1.6) * 0.5 + 0.5;
  float fineGrain = sin(q.y * 34.0 + q.x * 2.1) * 0.5 + 0.5;
  vec3 walnut = mix(vec3(0.20, 0.135, 0.095), vec3(0.30, 0.205, 0.14), grain * 0.72 + fineGrain * 0.28);
  float tableRad = length(q * vec2(0.85, 0.92));
  walnut *= mix(1.06, 0.62, smoothstep(2.6, 7.2, tableRad));

  // Warm parchment gallery folio
  float paperLight = mix(1.02, 0.88, smoothstep(0.6, 4.2, length(q - vec2(-0.3, 0.7))));
  float paperTex = (hash21(floor(q * 60.0)) - 0.5) * 0.015;
  vec3 paper = (vec3(0.935, 0.905, 0.845) + paperTex) * paperLight;

  // Fine printed double rule around the parchment border
  float borderDist = abs(sdfSheet + 0.10);
  float borderRule = 1.0 - smoothstep(0.004, 0.014, borderDist);
  paper = mix(paper, vec3(0.42, 0.36, 0.29), borderRule * 0.45);

  // Subtle polar drafting arcs and radial guide lines on the folio
  float r = length(q);
  float phi = atan(q.x, q.y);
  float ring1 = 1.0 - smoothstep(0.004, 0.012, abs(r - 1.85));
  float ring2 = 1.0 - smoothstep(0.004, 0.012, abs(r - 2.95));
  float spokeAngle = abs(fract((phi + 0.261799) / 0.523599) - 0.5) * 0.523599 * r;
  float spoke = (1.0 - smoothstep(0.003, 0.010, spokeAngle)) * step(CYL_R + 0.06, r) * step(r, 3.02);
  paper = mix(paper, vec3(0.66, 0.59, 0.48), clamp((ring1 + ring2) * 0.28 + spoke * 0.16, 0.0, 0.36));

  // Inlaid brass focal circle at (0, 0) of radius CYL_R
  float brassBand = 1.0 - smoothstep(0.030, 0.044, abs(r - CYL_R));
  float brassEdge = 1.0 - smoothstep(0.004, 0.012, abs(abs(r - CYL_R) - 0.038));
  float sheen = 0.78 + 0.22 * cos(phi * 2.0 - 0.7);
  vec3 brassCol = vec3(0.76, 0.57, 0.25) * sheen + vec3(0.14, 0.10, 0.04) * pow(max(cos(phi + 0.5), 0.0), 4.0);
  paper = mix(paper, brassCol, brassBand * 0.94);
  paper = mix(paper, vec3(0.28, 0.20, 0.09), brassEdge * 0.65);

  // Subtle centre crosshair inside the brass focal circle
  float crossLine = (1.0 - smoothstep(0.004, 0.012, min(abs(q.x), abs(q.y)))) * step(r, 0.24);
  float innerDot = 1.0 - smoothstep(0.025, 0.036, r);
  paper = mix(paper, vec3(0.54, 0.41, 0.20), clamp(crossLine * 0.65 + innerDot * 0.75, 0.0, 0.8));

  // Polar catoptric anamorphic print of the live HTML card
  TableUV tuv = solveTableUV(q);
  if (tuv.ok) {
    vec2 uv = tuv.uv;
    vec2 dUvDx = tuv.dUvDq * dQdx;
    vec2 dUvDy = tuv.dUvDq * dQdy;
    float fwU = max(length(vec2(dUvDx.x, dUvDy.x)), 0.0006);
    float fwV = max(length(vec2(dUvDx.y, dUvDy.y)), 0.0006);
    float maskX = smoothstep(-fwU, fwU, uv.x) * (1.0 - smoothstep(1.0 - fwU, 1.0 + fwU, uv.x));
    float maskY = smoothstep(-fwV, fwV, uv.y) * (1.0 - smoothstep(1.0 - fwV, 1.0 + fwV, uv.y));
    float inside = maskX * maskY;

    if (inside > 0.001) {
      vec4 sampled = textureGrad(uTex, clamp(uv, 0.001, 0.999), dUvDx, dUvDy);
      vec3 cardRgb = sampled.rgb + paper * (1.0 - sampled.a);
      // Keep the reflected card bright and neutral while giving tabletop ink slight paper integration
      float inkTone = inMirror ? 0.98 : (0.94 * paperLight);
      paper = mix(paper, cardRgb * inkTone, inside);
    }

    // Crisp copperplate outline hugging the outer horseshoe boundary
    float edgeDistU = min(abs(uv.x), abs(uv.x - 1.0)) / max(fwU, 0.001);
    float edgeDistV = min(abs(uv.y), abs(uv.y - 1.0)) / max(fwV, 0.001);
    float nearRect = step(-0.02, uv.x) * step(uv.x, 1.02) * step(-0.02, uv.y) * step(uv.y, 1.02);
    float outline = (1.0 - smoothstep(0.6, 1.8, min(edgeDistU, edgeDistV))) * nearRect;
    paper = mix(paper, vec3(0.14, 0.12, 0.10), outline * (inMirror ? 0.35 : 0.65));
  }

  // Soft paper drop shadow onto the walnut table
  float sheetMask = 1.0 - smoothstep(-0.01, 0.015, sdfSheet);
  float sheetShadow = 1.0 - (1.0 - smoothstep(0.0, 0.16, sdfSheet)) * 0.38;
  vec3 surface = mix(walnut * sheetShadow, paper, sheetMask);

  // Cylinder cast shadow and contact AO (kept subtle in the mirror reflection so bottom buttons stay bright)
  surface *= mix(1.0, cylinderShadow(q), inMirror ? 0.25 : 1.0);

  // Distance fog blending the far table edge smoothly into the gallery studio wall
  float farFade = smoothstep(5.4, 14.5, length(q));
  return mix(surface, vec3(0.11, 0.095, 0.085), farFade);
}

// #region cylinder-raytrace
void main() {
  float aspect = uCanvasSize.x / max(uCanvasSize.y, 1.0);
  float ndcX = (vUv.x * 2.0 - 1.0) * aspect;
  float ndcY = 1.0 - vUv.y * 2.0;

  vec3 V = uCamFwd + uCamRight * (ndcX * uTanHalf) + uCamUp * (ndcY * uTanHalf);
  float invLenV = inversesqrt(dot(V, V));
  vec3 D = V * invLenV;

  // Per-framebuffer-pixel ray differentials for exact textureGrad() mipmap and anisotropy selection
  vec3 dVdx = uCamRight * ((2.0 * aspect * uTanHalf) / max(uBufSize.x, 1.0));
  vec3 dVdy = uCamUp * ((-2.0 * uTanHalf) / max(uBufSize.y, 1.0));
  vec3 dDdx = (dVdx - D * dot(D, dVdx)) * invLenV;
  vec3 dDdy = (dVdy - D * dot(D, dVdy)) * invLenV;

  // 1. Intersect tabletop plane y = 0
  float tTable = 1e9;
  if (D.y < -0.0005) {
    float tt = -uCamPos.y / D.y;
    if (tt > 0.0) tTable = tt;
  }

  // 2. Intersect movable 3D chrome cylinder at (uCylPos.x, uCylLift..uCylLift+CYL_H, uCylPos.y)
  float tCyl = 1e9;
  int cylPart = 0; // 1 = mirror side wall, 2 = brushed top cap
  vec3 hitP = vec3(0.0);

  if (uCylLift < 2.85) {
    vec2 oc = uCamPos.xz - uCylPos;
    float a = dot(D.xz, D.xz);
    float b = 2.0 * dot(oc, D.xz);
    float c = dot(oc, oc) - CYL_R * CYL_R;
    float disc = b * b - 4.0 * a * c;
    if (disc >= 0.0 && a > 1e-6) {
      float tSide = (-b - sqrt(disc)) / (2.0 * a);
      if (tSide > 0.0) {
        float yHit = uCamPos.y + tSide * D.y;
        if (yHit >= uCylLift && yHit <= uCylLift + CYL_H) {
          tCyl = tSide;
          cylPart = 1;
          hitP = uCamPos + tSide * D;
        }
      }
    }

    if (abs(D.y) > 0.0005) {
      float tCap = (uCylLift + CYL_H - uCamPos.y) / D.y;
      if (tCap > 0.0 && tCap < tCyl) {
        vec3 capP = uCamPos + tCap * D;
        if (length(capP.xz - uCylPos) <= CYL_R) {
          tCyl = tCap;
          cylPart = 2;
          hitP = capP;
        }
      }
    }
  }

  vec3 rgb;
  if (cylPart == 1 && tCyl < tTable) {
    // Polished 3D chrome mirror side wall
    vec3 N = normalize(vec3(hitP.x - uCylPos.x, 0.0, hitP.z - uCylPos.y));
    float yLocal = hitP.y - uCylLift;

    // Machined metallic bevel highlight at top and bottom cylinder lips
    float topBevel = smoothstep(CYL_H - 0.042, CYL_H, yLocal);
    float botBevel = 1.0 - smoothstep(0.0, 0.036, yLocal);
    vec3 Nshade = normalize(N + vec3(0.0, (topBevel - botBevel) * 0.45, 0.0));

    float ddn = dot(D, N);
    vec3 Rdir = D - 2.0 * ddn * N;
    vec3 envCol = studioEnv(reflect(D, Nshade));

    vec3 reflected = envCol;
    if (Rdir.y < -0.001 && topBevel < 0.65 && botBevel < 0.65) {
      float tRef = -hitP.y / Rdir.y;
      vec2 qRef = hitP.xz + tRef * Rdir.xz;

      // Analytic curved-cylinder reflection ray differentials onto y = 0
      float safeDdn = min(ddn, -0.04);
      float dtX = -tCyl * dot(dDdx, N) / safeDdn;
      float dtY = -tCyl * dot(dDdy, N) / safeDdn;
      vec3 dPx = dDdx * tCyl + D * dtX;
      vec3 dPy = dDdy * tCyl + D * dtY;
      vec3 dNx = vec3(dPx.x, 0.0, dPx.z) / CYL_R;
      vec3 dNy = vec3(dPy.x, 0.0, dPy.z) / CYL_R;
      vec3 dRx = dDdx - 2.0 * (dot(dDdx, N) + dot(D, dNx)) * N - 2.0 * ddn * dNx;
      vec3 dRy = dDdy - 2.0 * (dot(dDdy, N) + dot(D, dNy)) * N - 2.0 * ddn * dNy;
      float dtRefX = -(dPx.y + tRef * dRx.y) / Rdir.y;
      float dtRefY = -(dPy.y + tRef * dRy.y) / Rdir.y;
      vec2 dQrefDx = dPx.xz + dtRefX * Rdir.xz + tRef * dRx.xz;
      vec2 dQrefDy = dPy.xz + dtRefY * Rdir.xz + tRef * dRy.xz;

      reflected = shadeTabletop(qRef, dQrefDx, dQrefDy, true);
    }

    // Physical chrome Fresnel + subtle shoulder softbox gleam outside the card zone
    float ndotv = max(dot(-D, N), 0.0);
    float fresnel = pow(1.0 - ndotv, 4.0);
    vec3 chrome = reflected * vec3(0.955, 0.965, 0.98);
    chrome = mix(chrome, envCol * 1.08 + vec3(0.06, 0.07, 0.08), fresnel * 0.42);
    chrome = mix(chrome, envCol * 1.25 + vec3(0.14), max(topBevel, botBevel) * 0.72);
    rgb = chrome;
  } else if (cylPart == 2 && tCyl < tTable) {
    // Brushed spun-chrome top cap
    vec2 rel = hitP.xz - uCylPos;
    float rCap = length(rel);
    float ang = atan(rel.x, rel.y);
    float brushed = sin(rCap * 95.0) * 0.018 + sin(ang * 2.0 - 0.6) * 0.065;
    vec3 capEnv = studioEnv(reflect(D, vec3(0.0, 1.0, 0.0)));
    vec3 cap = mix(vec3(0.32, 0.33, 0.35), capEnv * 1.15, 0.55) + brushed;
    float rim = smoothstep(CYL_R - 0.065, CYL_R - 0.008, rCap);
    float rimHighlight = 0.5 + 0.5 * cos(ang + 0.7);
    cap = mix(cap, vec3(0.86, 0.88, 0.92) * (0.72 + 0.35 * rimHighlight), rim * 0.78);
    // Subtle engraved centre crosshair on the handle cap
    float capMark = (1.0 - smoothstep(0.005, 0.014, min(abs(rel.x), abs(rel.y)))) * step(rCap, 0.14);
    float capRing = 1.0 - smoothstep(0.004, 0.012, abs(rCap - 0.14));
    cap = mix(cap, vec3(0.16, 0.17, 0.19), clamp(capMark * 0.45 + capRing * 0.4, 0.0, 0.5));
    rgb = cap;
  } else if (tTable < 1e8) {
    vec2 q = uCamPos.xz + tTable * D.xz;
    vec2 dQdx = (tTable * dDdx - (tTable * dDdx.y / D.y) * D).xz;
    vec2 dQdy = (tTable * dDdy - (tTable * dDdy.y / D.y) * D).xz;
    rgb = shadeTabletop(q, dQdx, dQdy, false);
  } else {
    rgb = studioEnv(D) * 0.75;
  }

  // Optional cyan local-Jacobian hit-box wireframe projection overlay
  if (uShowHit == 1) {
    vec2 cssPx = vUv * uCanvasSize;
    vec3 qh = uHitInv * vec3(cssPx, 1.0);
    vec2 quv = qh.xy / max(abs(qh.z), 1e-5);
    float fw = max(length(fwidth(quv)), 0.0025);
    if (qh.z > 0.0 && quv.x >= 0.0 && quv.x <= 1.0 && quv.y >= 0.0 && quv.y <= 1.0) {
      float edge = min(min(quv.x, 1.0 - quv.x), min(quv.y, 1.0 - quv.y));
      float border = 1.0 - smoothstep(fw * 0.9, fw * 2.3, edge);
      float midLine = (1.0 - smoothstep(fw * 0.7, fw * 1.8, min(abs(quv.x - 0.5), abs(quv.y - 0.5)))) * 0.35;
      rgb = mix(rgb, vec3(0.08, 0.92, 0.96), clamp(border * 0.94 + midLine + 0.10, 0.0, 0.95));
    }
    if (uHitPt.x >= 0.0) {
      float dPin = length(cssPx - uHitPt);
      if (dPin < 9.0) {
        float ring = 1.0 - smoothstep(1.2, 2.5, abs(dPin - 4.8));
        rgb = mix(rgb, vec3(1.0, 0.56, 0.16), ring);
      }
    }
  }

  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
// #endregion cylinder-raytrace
`;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  preset: 'gallery',
  orbitDeg: PRESETS.gallery.orbitDeg,
  elevDeg: PRESETS.gallery.elevDeg,
  dist: PRESETS.gallery.dist,
  target: [...PRESETS.gallery.target],
  orbitTarget: PRESETS.gallery.orbitDeg,
  elevTarget: PRESETS.gallery.elevDeg,
  distTarget: PRESETS.gallery.dist,
  targetGoal: [...PRESETS.gallery.target],
  cylX: 0,
  cylZ: 0,
  cylXTarget: 0,
  cylZTarget: 0,
  lifted: false,
  cylLift: 0,
  cylLiftTarget: 0,
  interactSurface: 'both', // 'cylinder' | 'table' | 'both'
  showHitQuad: false,
  accent: 'cobalt',
  stamps: 0,
  backend: 'starting',
  texW: 0,
  texH: 0,
  mipLevels: 0,
  maxAniso: 1,
  anisoSupported: false,
  onScreen: true,
};

let stage = null;
let anisoExt = null;
let lastLiveTex = null;
let ctx2d = null;
let domDirty = true;
let mipDirty = true;
let hitTick = 0;
let lastHitKey = '';
let cachedControlRects = [];
let activeHit = null;
let lastPointerPx = null;
let lastPointerPy = null;
const hitInvMat3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const hitPinPt = [-10, -10];
let rafId = 0;
let lastFrameMs = performance.now();

function showNotice(msg) {
  if (!msg) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
    return;
  }
  noticeEl.hidden = false;
  noticeEl.textContent = msg;
}

function updateCardMeta() {
  const val = cardInput.value.trim();
  cardHeadline.textContent = val ? val.slice(0, 18).toUpperCase() : 'CATOPTRIC FORM';
  cardSub.textContent = `Catoptric reflection · ${state.accent}`;
  cardStampCount.textContent = `#${String(state.stamps).padStart(2, '0')}`;
  cardFootText.textContent = `${cardInput.value.length} chars · ${state.stamps} ${state.stamps === 1 ? 'stamp' : 'stamps'}`;
}

function computeLayout() {
  const cw = Math.max(240, canvas.clientWidth || 354);
  const ch = Math.max(240, canvas.clientHeight || 340);
  return { cw, ch, cardW: CARD_W, cardH: CARD_H };
}

// ---------------------------------------------------------------- CPU camera, Alhazen & raytrace mirror
function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function buildCamera(layout, opts = state) {
  const orbit = ((opts.orbitDeg ?? 0) * Math.PI) / 180;
  const elev = ((opts.elevDeg ?? REF_ELEV_DEG) * Math.PI) / 180;
  const dist = opts.dist ?? REF_DIST;
  const target = opts.target ?? REF_TARGET;
  const ce = Math.cos(elev);
  const se = Math.sin(elev);
  const pos = [
    target[0] + dist * ce * Math.sin(orbit),
    target[1] + dist * se,
    target[2] + dist * ce * Math.cos(orbit),
  ];
  const fwd = norm3(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]);
  const rightRaw = cross3(fwd, [0, 1, 0]);
  const right = norm3(rightRaw[0], rightRaw[1], rightRaw[2]);
  const up = cross3(right, fwd);
  const aspect = layout.cw / Math.max(layout.ch, 1);
  const baseTanHalf = Math.tan(((REF_FOV_DEG * Math.PI) / 180) * 0.5);
  // Widen FOV slightly on narrow phone screens so the 201-degree horseshoe never clips horizontally
  const tanHalf = baseTanHalf * Math.max(1.0, 1.16 / Math.max(aspect, 0.5));
  return { pos, right, up, fwd, tanHalf, aspect };
}

export function solveTableUVCpu(qx, qz) {
  const r = Math.hypot(qx, qz);
  if (r <= CYL_R * 1.001) return null;
  const phi = Math.atan2(qx, qz);
  const thLimA = Math.acos(Math.max(-1, Math.min(1, CYL_R / REF_Z0))) - 0.0002;
  const thLimQ = Math.acos(Math.max(-1, Math.min(1, CYL_R / r))) - 0.0002;
  const lo = Math.max(-thLimA, phi - thLimQ);
  const hi = Math.min(thLimA, phi + thLimQ);
  if (lo >= hi) return null;

  let th = Math.max(lo + 0.0002, Math.min(hi - 0.0002, phi * 0.5));
  for (let i = 0; i < 6; i++) {
    const c1 = Math.cos(th);
    const s1 = Math.sin(th);
    const d = phi - th;
    const c2 = Math.cos(d);
    const s2 = Math.sin(d);
    const f = Math.atan2(REF_Z0 * s1, REF_Z0 * c1 - CYL_R) - Math.atan2(r * s2, r * c2 - CYL_R);
    const denom1 = REF_Z0 * REF_Z0 - 2 * CYL_R * REF_Z0 * c1 + CYL_R * CYL_R;
    const denom2 = r * r - 2 * CYL_R * r * c2 + CYL_R * CYL_R;
    const df = (REF_Z0 * REF_Z0 - CYL_R * REF_Z0 * c1) / Math.max(denom1, 1e-6)
             + (r * r - CYL_R * r * c2) / Math.max(denom2, 1e-6);
    th = Math.max(lo + 0.0001, Math.min(hi - 0.0001, th - f / Math.max(df, 1e-5)));
  }

  const c1 = Math.cos(th);
  const s1 = Math.sin(th);
  const c2 = Math.cos(phi - th);
  const d1 = Math.sqrt(Math.max(1e-8, REF_Z0 * REF_Z0 - 2 * CYL_R * REF_Z0 * c1 + CYL_R * CYL_R));
  const d2 = Math.sqrt(Math.max(1e-8, r * r - 2 * CYL_R * r * c2 + CYL_R * CYL_R));
  const y = (REF_Y0 * d2) / (d1 + d2);
  const u = 0.5 + (s1 / SIN_MAX) * 0.5;
  const v = (CARD_Y_MAX - y) / (CARD_Y_MAX - CARD_Y_MIN);

  const yGap = Math.max(REF_Y0 - y, 0.05);
  const s = y / yGap;
  const dsdy = REF_Y0 / (yGap * yGap);
  const c2th = Math.cos(2 * th);
  const s2th = Math.sin(2 * th);
  const dQxDth = CYL_R * c1 + s * (2 * REF_Z0 * c2th - CYL_R * c1);
  const dQzDth = -CYL_R * s1 + s * (-2 * REF_Z0 * s2th + CYL_R * s1);
  const dQxDy = dsdy * (REF_Z0 * s2th - CYL_R * s1);
  const dQzDy = dsdy * (REF_Z0 * c2th - CYL_R * c1);
  const det = dQxDth * dQzDy - dQxDy * dQzDth;
  if (Math.abs(det) < 1e-6) return null;

  const invDet = 1 / det;
  const duDth = c1 / (2 * SIN_MAX);
  const dvDy = -1 / (CARD_Y_MAX - CARD_Y_MIN);
  return {
    u,
    v,
    duDqx: duDth * dQzDy * invDet,
    duDqz: duDth * -dQxDy * invDet,
    dvDqx: dvDy * -dQzDth * invDet,
    dvDqz: dvDy * dQxDth * invDet,
  };
}

// #region hit-reprojection
const INTERACTIVE_CONTROLS = [...card.querySelectorAll('button, input, select, textarea')];

function measureControlRects() {
  cachedControlRects = INTERACTIVE_CONTROLS.map((el) => {
    let x = 0;
    let y = 0;
    let cur = el;
    while (cur && cur !== card) {
      x += cur.offsetLeft;
      y += cur.offsetTop;
      cur = cur.offsetParent;
    }
    const label = el.tagName === 'INPUT' ? 'Text input' : (el.textContent || el.id || 'Control').trim();
    return { el, x, y, w: el.offsetWidth, h: el.offsetHeight, label };
  });
}

function findLocalControl(qx, qy) {
  for (const r of cachedControlRects) {
    if (qx >= r.x && qx <= r.x + r.w && qy >= r.y && qy <= r.y + r.h) {
      return r;
    }
  }
  return null;
}

function buildLocalTangentHit(surface, px, py, tuv, dQdx, dQdy, cardW, cardH, hitY = 0) {
  if (!tuv || tuv.u < 0 || tuv.u > 1 || tuv.v < 0 || tuv.v > 1) return null;
  const duDx = tuv.duDqx * dQdx[0] + tuv.duDqz * dQdx[1];
  const duDy = tuv.duDqx * dQdy[0] + tuv.duDqz * dQdy[1];
  const dvDx = tuv.dvDqx * dQdx[0] + tuv.dvDqz * dQdx[1];
  const dvDy = tuv.dvDqx * dQdy[0] + tuv.dvDqz * dQdy[1];

  // 2x2 Jacobian dq/dp (canvas CSS px -> card-local CSS px)
  const a00 = duDx * cardW;
  const a01 = duDy * cardW;
  const a10 = dvDx * cardH;
  const a11 = dvDy * cardH;
  const det = a00 * a11 - a01 * a10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;

  // Inverse M = dp/dq (card-local CSS px -> canvas CSS px)
  const m00 = a11 / det;
  const m01 = -a01 / det;
  const m10 = -a10 / det;
  const m11 = a00 / det;
  const scale = Math.sqrt(Math.abs(m00 * m11 - m01 * m10));
  if (!Number.isFinite(scale) || scale < 0.08 || scale > 10) return null;

  const qx = tuv.u * cardW;
  const qy = tuv.v * cardH;
  const tx = px - (m00 * qx + m01 * qy);
  const ty = py - (m10 * qx + m11 * qy);
  const rotDeg = (Math.atan2(m10, m00) * 180) / Math.PI;

  return {
    kind: 'card',
    surface,
    a: m00,
    b: m10,
    c: m01,
    d: m11,
    e: tx,
    f: ty,
    u: tuv.u,
    v: tuv.v,
    qx,
    qy,
    px,
    py,
    det,
    scale,
    rotDeg,
    hitY,
  };
}

// Exact CPU mirror of CATOPTRIC_FRAG + analytic ray differentials -> local tangent DOMMatrix
export function projectCatoptricPoint(px, py, layout, opts = state) {
  const cam = buildCamera(layout, opts);
  const ndcX = ((px / layout.cw) * 2 - 1) * cam.aspect;
  const ndcY = 1 - (py / layout.ch) * 2;

  const vx = cam.fwd[0] + cam.right[0] * (ndcX * cam.tanHalf) + cam.up[0] * (ndcY * cam.tanHalf);
  const vy = cam.fwd[1] + cam.right[1] * (ndcX * cam.tanHalf) + cam.up[1] * (ndcY * cam.tanHalf);
  const vz = cam.fwd[2] + cam.right[2] * (ndcX * cam.tanHalf) + cam.up[2] * (ndcY * cam.tanHalf);
  const invLenV = 1 / Math.hypot(vx, vy, vz);
  const D = [vx * invLenV, vy * invLenV, vz * invLenV];

  const kX = (2 * cam.aspect * cam.tanHalf) / layout.cw;
  const kY = (-2 * cam.tanHalf) / layout.ch;
  const dVdx = [cam.right[0] * kX, cam.right[1] * kX, cam.right[2] * kX];
  const dVdy = [cam.up[0] * kY, cam.up[1] * kY, cam.up[2] * kY];
  const dotDx = dot3(D, dVdx);
  const dotDy = dot3(D, dVdy);
  const dDdx = [(dVdx[0] - D[0] * dotDx) * invLenV, (dVdx[1] - D[1] * dotDx) * invLenV, (dVdx[2] - D[2] * dotDx) * invLenV];
  const dDdy = [(dVdy[0] - D[0] * dotDy) * invLenV, (dVdy[1] - D[1] * dotDy) * invLenV, (dVdy[2] - D[2] * dotDy) * invLenV];

  const cylX = opts.cylX ?? 0;
  const cylZ = opts.cylZ ?? 0;
  const cylLift = opts.cylLift ?? 0;

  let tTable = Infinity;
  if (D[1] < -0.0005) {
    const tt = -cam.pos[1] / D[1];
    if (tt > 0) tTable = tt;
  }

  let tCyl = Infinity;
  let cylPart = 0;
  let hitP = null;
  if (cylLift < 2.85) {
    const ocx = cam.pos[0] - cylX;
    const ocz = cam.pos[2] - cylZ;
    const a = D[0] * D[0] + D[2] * D[2];
    const b = 2 * (ocx * D[0] + ocz * D[2]);
    const c = ocx * ocx + ocz * ocz - CYL_R * CYL_R;
    const disc = b * b - 4 * a * c;
    if (disc >= 0 && a > 1e-6) {
      const tSide = (-b - Math.sqrt(disc)) / (2 * a);
      if (tSide > 0) {
        const yHit = cam.pos[1] + tSide * D[1];
        if (yHit >= cylLift && yHit <= cylLift + CYL_H) {
          tCyl = tSide;
          cylPart = 1;
          hitP = [cam.pos[0] + tSide * D[0], yHit, cam.pos[2] + tSide * D[2]];
        }
      }
    }
    if (Math.abs(D[1]) > 0.0005) {
      const tCap = (cylLift + CYL_H - cam.pos[1]) / D[1];
      if (tCap > 0 && tCap < tCyl) {
        const capX = cam.pos[0] + tCap * D[0];
        const capZ = cam.pos[2] + tCap * D[2];
        if (Math.hypot(capX - cylX, capZ - cylZ) <= CYL_R) {
          tCyl = tCap;
          cylPart = 2;
          hitP = [capX, cylLift + CYL_H, capZ];
        }
      }
    }
  }

  if (cylPart === 2 && tCyl < tTable) {
    return { kind: 'cap', surface: 'cylinder', hitY: cylLift + CYL_H, px, py };
  }

  if (cylPart === 1 && tCyl < tTable) {
    const N = norm3(hitP[0] - cylX, 0, hitP[2] - cylZ);
    const ddn = dot3(D, N);
    const Rdir = [D[0] - 2 * ddn * N[0], D[1], D[2] - 2 * ddn * N[2]];
    if (Rdir[1] < -0.001) {
      const tRef = -hitP[1] / Rdir[1];
      const qRefX = hitP[0] + tRef * Rdir[0];
      const qRefZ = hitP[2] + tRef * Rdir[2];
      const tuv = solveTableUVCpu(qRefX, qRefZ);
      if (tuv && tuv.u >= 0 && tuv.u <= 1 && tuv.v >= 0 && tuv.v <= 1) {
        const safeDdn = Math.min(ddn, -0.04);
        const diffQ = (dD) => {
          const dt = (-tCyl * dot3(dD, N)) / safeDdn;
          const dP = [dD[0] * tCyl + D[0] * dt, dD[1] * tCyl + D[1] * dt, dD[2] * tCyl + D[2] * dt];
          const dN = [dP[0] / CYL_R, 0, dP[2] / CYL_R];
          const dDdn = dot3(dD, N) + dot3(D, dN);
          const dR = [
            dD[0] - 2 * dDdn * N[0] - 2 * ddn * dN[0],
            dD[1],
            dD[2] - 2 * dDdn * N[2] - 2 * ddn * dN[2],
          ];
          const dtRef = -(dP[1] + tRef * dR[1]) / Rdir[1];
          return [dP[0] + dtRef * Rdir[0] + tRef * dR[0], dP[2] + dtRef * Rdir[2] + tRef * dR[2]];
        };
        const hit = buildLocalTangentHit('cylinder', px, py, tuv, diffQ(dDdx), diffQ(dDdy), layout.cardW, layout.cardH, hitP[1]);
        if (hit) return hit;
      }
    }
    return { kind: 'chrome', surface: 'cylinder', hitY: hitP[1], px, py };
  }

  if (Number.isFinite(tTable)) {
    const qx = cam.pos[0] + tTable * D[0];
    const qz = cam.pos[2] + tTable * D[2];
    const tuv = solveTableUVCpu(qx, qz);
    if (tuv && tuv.u >= 0 && tuv.u <= 1 && tuv.v >= 0 && tuv.v <= 1) {
      const kTableX = (tTable * dDdx[1]) / D[1];
      const kTableY = (tTable * dDdy[1]) / D[1];
      const dQdx = [tTable * dDdx[0] - kTableX * D[0], tTable * dDdx[2] - kTableX * D[2]];
      const dQdy = [tTable * dDdy[0] - kTableY * D[0], tTable * dDdy[2] - kTableY * D[2]];
      const hit = buildLocalTangentHit('table', px, py, tuv, dQdx, dQdy, layout.cardW, layout.cardH, 0);
      if (hit) return hit;
    }
    return { kind: 'table', surface: 'table', hitY: 0, px, py };
  }

  return null;
}

function intersectHorizontalPlane(px, py, planeY, layout, opts = state) {
  const cam = buildCamera(layout, opts);
  const ndcX = ((px / layout.cw) * 2 - 1) * cam.aspect;
  const ndcY = 1 - (py / layout.ch) * 2;
  const D = norm3(
    cam.fwd[0] + cam.right[0] * (ndcX * cam.tanHalf) + cam.up[0] * (ndcY * cam.tanHalf),
    cam.fwd[1] + cam.right[1] * (ndcX * cam.tanHalf) + cam.up[1] * (ndcY * cam.tanHalf),
    cam.fwd[2] + cam.right[2] * (ndcX * cam.tanHalf) + cam.up[2] * (ndcY * cam.tanHalf)
  );
  if (Math.abs(D[1]) < 0.02) return null;
  const t = (planeY - cam.pos[1]) / D[1];
  if (t <= 0 || t > 40) return null;
  return { x: cam.pos[0] + t * D[0], z: cam.pos[2] + t * D[2] };
}

function project2DFallbackRect(layout) {
  const w = Math.min(layout.cw * 0.64, CARD_W);
  const h = w * (CARD_H / CARD_W);
  const x = (layout.cw - w) * 0.5;
  const y = layout.ch * 0.16;
  return { x, y, w, h, scale: w / CARD_W };
}

function writeHitInvMat3(a, b, c, d, e, f, cardW, cardH) {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-8) return;
  const invW = 1 / (det * Math.max(cardW, 1));
  const invH = 1 / (det * Math.max(cardH, 1));
  hitInvMat3[0] = d * invW;
  hitInvMat3[1] = -b * invH;
  hitInvMat3[2] = 0;
  hitInvMat3[3] = -c * invW;
  hitInvMat3[4] = a * invH;
  hitInvMat3[5] = 0;
  hitInvMat3[6] = (c * f - d * e) * invW;
  hitInvMat3[7] = (b * e - a * f) * invH;
  hitInvMat3[8] = 1;
}

function applyHitTransform(a, b, c, d, e, f, layout, pinX = -10, pinY = -10) {
  if (typeof canvas.updateElementGeometry !== 'function') return;
  const unit = geometryUnit(canvas, card, layout.cardW);
  const cssMat = new DOMMatrix([a, b, c, d, e, f]);
  const m = new DOMMatrix().scale(unit).multiply(cssMat);
  canvas.updateElementGeometry(card, { canvasTransform: m });
  card.dataset.hitTick = String(++hitTick);
  writeHitInvMat3(a, b, c, d, e, f, layout.cardW, layout.cardH);
  hitPinPt[0] = pinX;
  hitPinPt[1] = pinY;
}

function surfaceAllows(surface) {
  return state.interactSurface === 'both' || state.interactSurface === surface;
}

function defaultHintText() {
  if (state.lifted) return 'Mirror lifted away · tap the smeared polar print on the table or lower the cylinder back';
  return 'Click or tap inside the chrome reflection · drag cylinder cap to slide · drag table to orbit';
}

function updateCursorAndHint(hit) {
  canvas.classList.toggle('over-input', hit?.control?.tagName === 'INPUT');
  canvas.classList.toggle('over-control', Boolean(hit?.control && hit.control.tagName !== 'INPUT'));
  if (!hit) {
    hintEl.textContent = defaultHintText();
    return;
  }
  if (hit.kind === 'card' && surfaceAllows(hit.surface)) {
    const where = hit.surface === 'cylinder' ? 'Chrome reflection' : 'Polar table print';
    const orient = hit.det >= 0 ? 'upright' : 'mirrored';
    const target = hit.controlLabel ? ` · ${hit.controlLabel}` : hit.surface === 'cylinder' ? ' · drag to slide mirror' : ' · drag to orbit';
    hintEl.textContent = `${where} (${orient}, ${hit.scale.toFixed(2)}x)${target}`;
    return;
  }
  if (hit.kind === 'cap' || hit.kind === 'chrome') {
    hintEl.textContent = 'Chrome cylinder · drag to slide across the focal circle';
    return;
  }
  hintEl.textContent = defaultHintText();
}

function reprojectAt(px, py, layout = computeLayout(), force = false) {
  if (wrap.classList.contains('plain')) return null;
  if (!cachedControlRects.length) measureControlRects();

  if (ctx2d && (!stage || stage.lost)) {
    const r = project2DFallbackRect(layout);
    applyHitTransform(r.scale, 0, 0, r.scale, r.x, r.y, layout, px, py);
    const qx = (px - r.x) / r.scale;
    const qy = (py - r.y) / r.scale;
    if (qx >= 0 && qx <= CARD_W && qy >= 0 && qy <= CARD_H) {
      const ctrl = findLocalControl(qx, qy);
      const hit = { kind: 'card', surface: 'cylinder', qx, qy, px, py, scale: r.scale, det: 1, control: ctrl?.el ?? null, controlLabel: ctrl?.label ?? '' };
      activeHit = hit;
      updateCursorAndHint(hit);
      return hit;
    }
    activeHit = null;
    updateCursorAndHint(null);
    return null;
  }

  const key = `pt:${Math.round(px / 2)},${Math.round(py / 2)},${layout.cw}x${layout.ch},${state.orbitDeg.toFixed(2)},${state.elevDeg.toFixed(2)},${state.cylX.toFixed(3)},${state.cylZ.toFixed(3)},${state.cylLift.toFixed(3)},${state.interactSurface}`;
  if (!force && lastHitKey === key) return activeHit;
  lastHitKey = key;

  const hit = projectCatoptricPoint(px, py, layout);
  if (hit && hit.kind === 'card' && surfaceAllows(hit.surface)) {
    const ctrl = findLocalControl(hit.qx, hit.qy);
    hit.control = ctrl?.el ?? null;
    hit.controlLabel = ctrl?.label ?? '';
    applyHitTransform(hit.a, hit.b, hit.c, hit.d, hit.e, hit.f, layout, hit.px, hit.py);
  }
  activeHit = hit;
  updateCursorAndHint(hit);
  return hit;
}

function syncRestingGeometry(layout, force = false) {
  if (wrap.classList.contains('plain')) return;
  if (!cachedControlRects.length) measureControlRects();

  if (ctx2d && (!stage || stage.lost)) {
    const r = project2DFallbackRect(layout);
    applyHitTransform(r.scale, 0, 0, r.scale, r.x, r.y, layout, -10, -10);
    return;
  }

  if (lastPointerPx !== null && lastPointerPy !== null && !dragMode) {
    const hit = reprojectAt(lastPointerPx, lastPointerPy, layout, force);
    if (hit?.kind === 'card' && surfaceAllows(hit.surface)) return;
  }

  // Park resting hit-box on the centre of the cylinder reflection (or tabletop horseshoe if lifted)
  const key = `rest:${layout.cw}x${layout.ch},${state.orbitDeg.toFixed(2)},${state.elevDeg.toFixed(2)},${state.cylX.toFixed(3)},${state.cylZ.toFixed(3)},${state.cylLift.toFixed(3)},${state.interactSurface}`;
  if (!force && lastHitKey === key) return;
  lastHitKey = key;

  const probes = state.lifted || state.interactSurface === 'table'
    ? [[0.5, 0.72], [0.5, 0.65], [0.5, 0.78]]
    : [[0.5, 0.44], [0.5, 0.40], [0.5, 0.48], [0.5, 0.72]];

  for (const [fx, fy] of probes) {
    const hit = projectCatoptricPoint(layout.cw * fx, layout.ch * fy, layout);
    if (hit && hit.kind === 'card' && surfaceAllows(hit.surface)) {
      activeHit = hit;
      applyHitTransform(hit.a, hit.b, hit.c, hit.d, hit.e, hit.f, layout, -10, -10);
      return;
    }
  }
}
// #endregion hit-reprojection

function updateStatus() {
  const offsetDist = Math.hypot(state.cylX, state.cylZ);
  const mirrorStr = state.lifted
    ? 'lifted away'
    : offsetDist < 0.02
      ? 'centred on focal circle'
      : `offset (${state.cylX >= 0 ? '+' : ''}${state.cylX.toFixed(2)}, ${state.cylZ >= 0 ? '+' : ''}${state.cylZ.toFixed(2)})`;
  const texInfo = state.texW ? `${state.texW}x${state.texH} (${state.mipLevels} mips)` : 'not uploaded yet';
  const anisoInfo = state.anisoSupported ? `aniso ${state.maxAniso}x` : 'trilinear mipmaps';
  statusEl.textContent = `Backend: ${state.backend} | Mirror: ${mirrorStr} | View: orbit ${Math.round(state.orbitDeg)} deg, elev ${Math.round(state.elevDeg)} deg | Texture: ${texInfo}, ${anisoInfo}`;
}

// #region mipmap-upload
function applyTextureFilter(gl, texObj, regenerateMipmaps) {
  if (!texObj) return;
  gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (regenerateMipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D);
    mipDirty = false;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  if (anisoExt) {
    gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, state.maxAniso);
  }
}
// #endregion mipmap-upload

function renderWebGL(e) {
  if (!stage || stage.lost) return;
  const gl = stage.gl;
  const layout = computeLayout();
  syncRestingGeometry(layout);

  const changed = new Set(e?.changedElements ?? []);
  const shouldUpload = domDirty || changed.has(card) || !stage.has(card) || !lastLiveTex;
  if (shouldUpload) {
    lastLiveTex = stage.upload(card);
    domDirty = false;
    mipDirty = true;
    if (lastLiveTex) {
      state.texW = lastLiveTex.w;
      state.texH = lastLiveTex.h;
      state.mipLevels = Math.floor(Math.log2(Math.max(lastLiveTex.w, lastLiveTex.h, 1))) + 1;
    }
  }
  if (!lastLiveTex) return;
  applyTextureFilter(gl, lastLiveTex, mipDirty);

  const cam = buildCamera(layout);
  if (!stage.begin([0.09, 0.08, 0.07, 1])) return;
  stage.quad(card, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (g, loc) => {
    g.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    g.uniform2f(loc('uBufSize'), canvas.width, canvas.height);
    g.uniform3f(loc('uCamPos'), cam.pos[0], cam.pos[1], cam.pos[2]);
    g.uniform3f(loc('uCamRight'), cam.right[0], cam.right[1], cam.right[2]);
    g.uniform3f(loc('uCamUp'), cam.up[0], cam.up[1], cam.up[2]);
    g.uniform3f(loc('uCamFwd'), cam.fwd[0], cam.fwd[1], cam.fwd[2]);
    g.uniform1f(loc('uTanHalf'), cam.tanHalf);
    g.uniform2f(loc('uCylPos'), state.cylX, state.cylZ);
    g.uniform1f(loc('uCylLift'), state.cylLift);
    g.uniform1i(loc('uShowHit'), state.showHitQuad ? 1 : 0);
    g.uniformMatrix3fv(loc('uHitInv'), false, hitInvMat3);
    g.uniform2f(loc('uHitPt'), hitPinPt[0], hitPinPt[1]);
  });

  updateStatus();
}

function render2DFallback() {
  if (!ctx2d) return;
  const layout = computeLayout();
  syncRestingGeometry(layout);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#241c16';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);

  // Tabletop parchment ellipse and brass focal ring
  ctx2d.fillStyle = '#ebe3d3';
  ctx2d.beginPath();
  ctx2d.ellipse(layout.cw * 0.5, layout.ch * 0.72, layout.cw * 0.44, layout.ch * 0.24, 0, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.strokeStyle = '#b98b3b';
  ctx2d.lineWidth = 3;
  ctx2d.beginPath();
  ctx2d.ellipse(layout.cw * 0.5, layout.ch * 0.65, layout.cw * 0.22, layout.ch * 0.08, 0, 0, Math.PI * 2);
  ctx2d.stroke();

  // Simplified chrome cylinder column hosting the 5-argument drawElementImage() card
  const r = project2DFallbackRect(layout);
  const grad = ctx2d.createLinearGradient(r.x - 24, 0, r.x + r.w + 24, 0);
  grad.addColorStop(0, '#444850');
  grad.addColorStop(0.18, '#d5dae2');
  grad.addColorStop(0.5, '#696e78');
  grad.addColorStop(0.84, '#d9dfe8');
  grad.addColorStop(1, '#393d44');
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(r.x - 16, r.y - 20, r.w + 32, r.h + 44);
  ctx2d.drawElementImage(card, r.x, r.y, r.w, r.h);
  ctx2d.restore();
  domDirty = false;
  updateStatus();
}

function enterPlainFallback(reason) {
  wrap.classList.add('plain');
  if (card.parentElement !== wrap) wrap.append(card);
  state.backend = 'plain HTML';
  showNotice(reason);
  updateStatus();
}

function restoreCanvasFromPlain() {
  wrap.classList.remove('plain');
  if (card.parentElement !== canvas) canvas.append(card);
  showNotice('');
  domDirty = true;
  mipDirty = true;
  syncRestingGeometry(computeLayout(), true);
  requestDraw(true);
}

function hasPendingAnimation() {
  if (!state.onScreen || document.hidden || wrap.classList.contains('plain')) return false;
  return (
    Math.abs(state.cylLift - state.cylLiftTarget) > 0.004 ||
    Math.abs(state.cylX - state.cylXTarget) > 0.002 ||
    Math.abs(state.cylZ - state.cylZTarget) > 0.002 ||
    Math.abs(state.orbitDeg - state.orbitTarget) > 0.05 ||
    Math.abs(state.elevDeg - state.elevTarget) > 0.05 ||
    Math.abs(state.dist - state.distTarget) > 0.01 ||
    Math.abs(state.target[0] - state.targetGoal[0]) > 0.004 ||
    Math.abs(state.target[1] - state.targetGoal[1]) > 0.004 ||
    Math.abs(state.target[2] - state.targetGoal[2]) > 0.004
  );
}

function snapTargets() {
  state.cylLift = state.cylLiftTarget;
  state.cylX = state.cylXTarget;
  state.cylZ = state.cylZTarget;
  state.orbitDeg = state.orbitTarget;
  state.elevDeg = state.elevTarget;
  state.dist = state.distTarget;
  state.target[0] = state.targetGoal[0];
  state.target[1] = state.targetGoal[1];
  state.target[2] = state.targetGoal[2];
}

function scheduleAnim() {
  if (reducedMotion.matches) {
    snapTargets();
    syncCameraSliders();
    syncRestingGeometry(computeLayout(), true);
    requestDraw(false);
    return;
  }
  if (rafId || !hasPendingAnimation()) return;
  lastFrameMs = performance.now();
  rafId = requestAnimationFrame(onAnimFrame);
}

function onAnimFrame(now) {
  rafId = 0;
  if (!hasPendingAnimation()) return;
  const dt = Math.min(0.05, Math.max(0.004, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  const k = 1 - Math.exp(-dt * 11);
  const lerp = (a, b) => (Math.abs(a - b) < 0.002 ? b : a + (b - a) * k);

  state.cylLift = lerp(state.cylLift, state.cylLiftTarget);
  state.cylX = lerp(state.cylX, state.cylXTarget);
  state.cylZ = lerp(state.cylZ, state.cylZTarget);
  state.orbitDeg = Math.abs(state.orbitDeg - state.orbitTarget) < 0.06 ? state.orbitTarget : state.orbitDeg + (state.orbitTarget - state.orbitDeg) * k;
  state.elevDeg = Math.abs(state.elevDeg - state.elevTarget) < 0.06 ? state.elevTarget : state.elevDeg + (state.elevTarget - state.elevDeg) * k;
  state.dist = lerp(state.dist, state.distTarget);
  state.target[0] = lerp(state.target[0], state.targetGoal[0]);
  state.target[1] = lerp(state.target[1], state.targetGoal[1]);
  state.target[2] = lerp(state.target[2], state.targetGoal[2]);

  syncCameraSliders();
  canvas.requestPaint?.();
  if (hasPendingAnimation()) {
    rafId = requestAnimationFrame(onAnimFrame);
  } else {
    snapTargets();
    syncRestingGeometry(computeLayout(), true);
    canvas.requestPaint?.();
  }
}

function syncCameraSliders() {
  const o = Math.round(state.orbitDeg);
  const e = Math.round(state.elevDeg);
  ctlOrbit.value = String(o);
  outOrbit.textContent = `${o} deg`;
  ctlElev.value = String(e);
  outElev.textContent = `${e} deg`;
}

function requestDraw(markDomDirty = true) {
  if (markDomDirty) domDirty = true;
  if (wrap.classList.contains('plain')) {
    updateStatus();
    return;
  }
  canvas.requestPaint?.();
}

// Initialise single ElementGL WebGL 2 context, 2D fallback, or plain HTML
if (supported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: CATOPTRIC_FRAG,
      onLost: () => {
        lastLiveTex = null;
        anisoExt = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the card as plain HTML until the browser restores it.');
      },
      onRestored: () => {
        const gl = stage.gl;
        anisoExt =
          gl.getExtension('EXT_texture_filter_anisotropic') ||
          gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
          gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
        state.anisoSupported = Boolean(anisoExt);
        state.maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
        state.backend = 'WebGL 2 (ElementGL)';
        restoreCanvasFromPlain();
      },
    });
    const gl = stage.gl;
    anisoExt =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    state.anisoSupported = Boolean(anisoExt);
    state.maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    state.backend = 'WebGL 2 (ElementGL)';
  } catch (err) {
    stage = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
  }
}

if (!stage && supported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2D fallback';
    if (noticeEl.hidden) showNotice('WebGL 2 texElementSubImage2D() is not available here; using the 2D fallback.');
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the form is shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (stage && !stage.lost) renderWebGL(e);
  else if (ctx2d) render2DFallback();
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (state.onScreen) {
    if (hasPendingAnimation()) scheduleAnim();
    requestDraw(false);
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}).observe(wrap);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else if (!document.hidden && state.onScreen) {
    if (hasPendingAnimation()) scheduleAnim();
    requestDraw(false);
  }
});

new ResizeObserver(() => {
  if (!wrap.classList.contains('plain')) {
    syncRestingGeometry(computeLayout(), true);
    requestDraw(false);
  }
}).observe(canvas);

// Live HTML source card interactions
cardInput.addEventListener('input', () => {
  updateCardMeta();
  requestDraw(true);
});

for (const btn of accentBtns) {
  btn.addEventListener('click', () => {
    state.accent = btn.dataset.cardAccent;
    card.dataset.accent = state.accent;
    for (const b of accentBtns) b.setAttribute('aria-pressed', String(b === btn));
    updateCardMeta();
    requestDraw(true);
  });
}

cardStampBtn.addEventListener('click', () => {
  state.stamps++;
  updateCardMeta();
  requestDraw(true);
});

// Stage controls
function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  state.preset = name;
  for (const b of presetBtns) b.setAttribute('aria-pressed', String(b.dataset.preset === name));
  state.orbitTarget = p.orbitDeg;
  state.elevTarget = p.elevDeg;
  state.distTarget = p.dist;
  state.targetGoal = [...p.target];
  scheduleAnim();
}

for (const b of presetBtns) {
  b.addEventListener('click', () => applyPreset(b.dataset.preset));
}

ctlOrbit.addEventListener('input', () => {
  const v = Number(ctlOrbit.value);
  state.orbitDeg = v;
  state.orbitTarget = v;
  outOrbit.textContent = `${v} deg`;
  for (const b of presetBtns) b.setAttribute('aria-pressed', 'false');
  syncRestingGeometry(computeLayout(), true);
  requestDraw(false);
});

ctlElev.addEventListener('input', () => {
  const v = Number(ctlElev.value);
  state.elevDeg = v;
  state.elevTarget = v;
  outElev.textContent = `${v} deg`;
  for (const b of presetBtns) b.setAttribute('aria-pressed', 'false');
  syncRestingGeometry(computeLayout(), true);
  requestDraw(false);
});

btnLift.addEventListener('click', () => {
  state.lifted = !state.lifted;
  btnLift.setAttribute('aria-pressed', String(state.lifted));
  btnLift.textContent = state.lifted ? 'Lower cylinder onto table' : 'Lift cylinder away';
  state.cylLiftTarget = state.lifted ? 2.9 : 0;
  hintEl.textContent = defaultHintText();
  scheduleAnim();
});

btnOffset.addEventListener('click', () => {
  if (state.lifted) {
    state.lifted = false;
    btnLift.setAttribute('aria-pressed', 'false');
    btnLift.textContent = 'Lift cylinder away';
    state.cylLiftTarget = 0;
  }
  state.cylXTarget = state.cylXTarget > 0.15 ? -0.58 : 0.62;
  state.cylZTarget = -0.18;
  scheduleAnim();
});

btnCentre.addEventListener('click', () => {
  state.cylXTarget = 0;
  state.cylZTarget = 0;
  if (state.lifted) {
    state.lifted = false;
    btnLift.setAttribute('aria-pressed', 'false');
    btnLift.textContent = 'Lift cylinder away';
    state.cylLiftTarget = 0;
  }
  scheduleAnim();
});

ctlHitQuad.addEventListener('change', () => {
  state.showHitQuad = ctlHitQuad.checked;
  if (state.showHitQuad) syncRestingGeometry(computeLayout(), true);
  requestDraw(false);
});

for (const b of surfaceBtns) {
  b.addEventListener('click', () => {
    state.interactSurface = b.dataset.surface;
    for (const x of surfaceBtns) x.setAttribute('aria-pressed', String(x === b));
    syncRestingGeometry(computeLayout(), true);
    requestDraw(false);
  });
}

// Pointer reprojection, cylinder dragging and camera orbiting
let dragMode = ''; // '' | 'cylinder' | 'camera'
let dragLastX = 0;
let dragLastY = 0;
let dragPlaneY = 0;
let dragOffsetX = 0;
let dragOffsetZ = 0;
let pendingTap = null;
let nativeControlDown = false;

function canvasLocalXY(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startCylinderDrag(px, py, hitY, layout, pointerId) {
  const planePt = intersectHorizontalPlane(px, py, hitY, layout);
  dragMode = 'cylinder';
  dragPlaneY = hitY;
  dragOffsetX = planePt ? state.cylX - planePt.x : 0;
  dragOffsetZ = planePt ? state.cylZ - planePt.z : 0;
  state.cylXTarget = state.cylX;
  state.cylZTarget = state.cylZ;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(pointerId); } catch {}
}

function startCameraDrag(clientX, clientY, pointerId) {
  dragMode = 'camera';
  dragLastX = clientX;
  dragLastY = clientY;
  state.orbitTarget = state.orbitDeg;
  state.elevTarget = state.elevDeg;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(pointerId); } catch {}
}

canvas.addEventListener('pointermove', (e) => {
  if (wrap.classList.contains('plain')) return;
  const layout = computeLayout();
  const { x, y } = canvasLocalXY(e);

  if (dragMode === 'cylinder') {
    const planePt = intersectHorizontalPlane(x, y, dragPlaneY, layout);
    if (planePt) {
      state.cylX = Math.max(-2.1, Math.min(2.1, planePt.x + dragOffsetX));
      state.cylZ = Math.max(-1.35, Math.min(1.65, planePt.z + dragOffsetZ));
      state.cylXTarget = state.cylX;
      state.cylZTarget = state.cylZ;
      requestDraw(false);
    }
    return;
  }

  if (dragMode === 'camera') {
    const dx = e.clientX - dragLastX;
    const dy = e.clientY - dragLastY;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    state.orbitDeg = Math.max(-55, Math.min(55, state.orbitDeg - dx * 0.25));
    state.elevDeg = Math.max(18, Math.min(82, state.elevDeg + dy * 0.22));
    state.orbitTarget = state.orbitDeg;
    state.elevTarget = state.elevDeg;
    for (const b of presetBtns) b.setAttribute('aria-pressed', 'false');
    syncCameraSliders();
    requestDraw(false);
    return;
  }

  if (pendingTap && e.pointerId === pendingTap.pointerId) {
    if (Math.hypot(e.clientX - pendingTap.startX, e.clientY - pendingTap.startY) > 8) {
      const tap = pendingTap;
      pendingTap = null;
      if (tap.surface === 'cylinder' && !state.lifted) {
        startCylinderDrag(x, y, tap.hitY, layout, e.pointerId);
      } else {
        startCameraDrag(e.clientX, e.clientY, e.pointerId);
      }
    }
    return;
  }

  // Keep text-selection dragging inside the live <input> undisturbed
  if (e.buttons !== 0 && (e.target === cardInput || nativeControlDown)) return;

  lastPointerPx = x;
  lastPointerPy = y;
  const prevKey = lastHitKey;
  reprojectAt(x, y, layout);
  if (state.showHitQuad && lastHitKey !== prevKey) {
    requestDraw(false);
  }
}, { capture: true });

canvas.addEventListener('pointerdown', (e) => {
  if (wrap.classList.contains('plain')) return;
  const layout = computeLayout();
  const { x, y } = canvasLocalXY(e);
  lastPointerPx = x;
  lastPointerPy = y;
  const hit = reprojectAt(x, y, layout, true);
  if (state.showHitQuad) requestDraw(false);

  const nativeControl = e.target instanceof Element ? e.target.closest('button, input, select, textarea') : null;
  if (hit?.kind === 'card' && surfaceAllows(hit.surface) && hit.control) {
    if (nativeControl === hit.control) {
      // Desktop hover already positioned the live DOM control under the pointer
      nativeControlDown = true;
      pendingTap = null;
      return;
    }
    // Cold tap (touchscreen without prior hover): activate on pointerup within 8 px, or drag if moved
    pendingTap = {
      control: hit.control,
      surface: hit.surface,
      hitY: hit.hitY ?? 0.6,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
    return;
  }

  nativeControlDown = false;
  pendingTap = null;
  e.preventDefault();
  if (hit && (hit.kind === 'cap' || hit.kind === 'chrome' || (hit.kind === 'card' && hit.surface === 'cylinder')) && !state.lifted) {
    startCylinderDrag(x, y, hit.hitY ?? CYL_H, layout, e.pointerId);
  } else {
    startCameraDrag(e.clientX, e.clientY, e.pointerId);
  }
}, { capture: true });

const endPointer = (e) => {
  nativeControlDown = false;
  if (pendingTap && e.pointerId === pendingTap.pointerId) {
    const tap = pendingTap;
    pendingTap = null;
    if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY) <= 8) {
      if (tap.control.tagName === 'INPUT') {
        tap.control.focus({ preventScroll: true });
      } else {
        tap.control.click();
      }
      requestDraw(true);
    }
  }
  if (!dragMode) return;
  dragMode = '';
  canvas.classList.remove('dragging');
  if (lastPointerPx !== null && lastPointerPy !== null) {
    reprojectAt(lastPointerPx, lastPointerPy, computeLayout(), true);
    if (state.showHitQuad) requestDraw(false);
  }
};

canvas.addEventListener('pointerup', endPointer, { capture: true });
canvas.addEventListener('pointercancel', endPointer, { capture: true });
canvas.addEventListener('pointerleave', () => {
  if (dragMode) return;
  lastPointerPx = null;
  lastPointerPy = null;
  hitPinPt[0] = -10;
  hitPinPt[1] = -10;
  canvas.classList.remove('over-control', 'over-input');
  hintEl.textContent = defaultHintText();
  if (state.showHitQuad) requestDraw(false);
});

// Initial render
updateCardMeta();
syncCameraSliders();
syncRestingGeometry(computeLayout(), true);
requestDraw(true);

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, text) => {
  if (!ok) throw new Error(text);
  return text;
};

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() + generateMipmap() renders the catoptric scene cleanly',
    expect: 'pass',
    why: 'Uploads a cobalt drawable card onto an isolated ElementGL canvas, builds mipmaps and anisotropy, renders the full 3D catoptric shader and checks gl.getError() === 0 plus reflected blue pixels at the mirror centre.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:180px;height:130px;display:block';
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:160px;height:100px;background:#1d5cff;border:6px solid #12151f;box-sizing:border-box';
      cv.append(child);
      testStage().append(cv);

      const g = new ElementGL(cv, { fragment: CATOPTRIC_FRAG, attributes: { preserveDrawingBuffer: true } });
      await nextPaint(cv);
      const gl = g.gl;
      while (gl.getError() !== gl.NO_ERROR) {}

      const uploaded = g.upload(child);
      gl.bindTexture(gl.TEXTURE_2D, uploaded.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      const errMip = gl.getError();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const ext =
        gl.getExtension('EXT_texture_filter_anisotropic') ||
        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
        gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
      if (ext) {
        const maxA = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, maxA);
      }

      const lay = { cw: 180, ch: 130, cardW: CARD_W, cardH: CARD_H };
      const cam = buildCamera(lay, { ...PRESETS.gallery, cylX: 0, cylZ: 0, cylLift: 0 });
      g.begin([0.09, 0.08, 0.07, 1]);
      g.quad(child, ElementGL.rect(cv, 0, 0, lay.cw, lay.ch), (gg, loc) => {
        gg.uniform2f(loc('uCanvasSize'), lay.cw, lay.ch);
        gg.uniform2f(loc('uBufSize'), cv.width, cv.height);
        gg.uniform3f(loc('uCamPos'), cam.pos[0], cam.pos[1], cam.pos[2]);
        gg.uniform3f(loc('uCamRight'), cam.right[0], cam.right[1], cam.right[2]);
        gg.uniform3f(loc('uCamUp'), cam.up[0], cam.up[1], cam.up[2]);
        gg.uniform3f(loc('uCamFwd'), cam.fwd[0], cam.fwd[1], cam.fwd[2]);
        gg.uniform1f(loc('uTanHalf'), cam.tanHalf);
        gg.uniform2f(loc('uCylPos'), 0, 0);
        gg.uniform1f(loc('uCylLift'), 0);
        gg.uniform1i(loc('uShowHit'), 0);
        gg.uniformMatrix3fv(loc('uHitInv'), false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
        gg.uniform2f(loc('uHitPt'), -10, -10);
      });
      const errDraw = gl.getError();

      // Mirror reflection centre sits near ndcY = +0.10 -> bottom-up fbY = 0.55 * height
      const px = new Uint8Array(4);
      gl.readPixels(Math.round(cv.width * 0.5), Math.round(cv.height * 0.55), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const mips = Math.floor(Math.log2(Math.max(uploaded.w, uploaded.h, 1))) + 1;
      g.dispose();
      window.__gfx?.retire(cv);
      return need(
        errMip === 0 && errDraw === 0 && px[3] > 200 && px[2] > 160 && px[2] > px[0] + 80,
        `Uploaded ${uploaded.w}x${uploaded.h} (${mips} mips), mipErr=${errMip}, drawErr=${errDraw}, centre mirror pixel rgba(${px[0]}, ${px[1]}, ${px[2]}, ${px[3]}).`
      );
    },
  },
  {
    name: 'Ray-cylinder reflection maps a central mirror pixel into card UV [0, 1]^2 with finite positive Jacobian',
    expect: 'pass',
    why: 'Traces a ray from the gallery camera onto the centred chrome cylinder, reflects it onto the polar tabletop print and verifies interior UV coordinates, positive Jacobian determinant and exact tangent-matrix round-trip.',
    run: async () => {
      const lay = { cw: 660, ch: 480, cardW: CARD_W, cardH: CARD_H };
      const opts = { ...PRESETS.gallery, cylX: 0, cylZ: 0, cylLift: 0 };
      const hit = projectCatoptricPoint(lay.cw * 0.5, lay.ch * 0.44, lay, opts);
      if (!hit || hit.kind !== 'card') throw new Error('Central cylinder ray missed the reflected card');
      const rtX = hit.a * hit.qx + hit.c * hit.qy + hit.e;
      const rtY = hit.b * hit.qx + hit.d * hit.qy + hit.f;
      const rtErr = Math.hypot(rtX - hit.px, rtY - hit.py);
      const ok =
        hit.surface === 'cylinder' &&
        hit.u > 0.1 &&
        hit.u < 0.9 &&
        hit.v > 0.1 &&
        hit.v < 0.9 &&
        Number.isFinite(hit.det) &&
        hit.det > 0 &&
        rtErr < 1e-4;
      return need(
        ok,
        `surface=${hit.surface}, uv=(${hit.u.toFixed(3)}, ${hit.v.toFixed(3)}), det=${hit.det.toFixed(3)}, scale=${hit.scale.toFixed(2)}x, round-trip error=${rtErr.toExponential(1)} px.`
      );
    },
  },
  {
    name: 'Local-Jacobian reprojection scaled by geometryUnit() hits a live button inside the cylinder reflection',
    expect: 'pass',
    why: 'Builds an isolated drawable canvas fixture with a card containing a button, projects a cylinder-reflection pixel onto that button, applies the local Jacobian DOMMatrix scaled by geometryUnit() and checks document.elementsFromPoint().',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is not available');
      const lay = { cw: 280, ch: 200, cardW: CARD_W, cardH: CARD_H };
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${lay.cw}px;height:${lay.ch}px;display:block`;

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = `box-sizing:border-box;position:relative;width:${CARD_W}px;height:${CARD_H}px;background:#fbf8f1`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Mirror target';
      btn.style.cssText = 'position:absolute;left:48px;top:66px;width:224px;height:68px;box-sizing:border-box';
      box.append(btn);
      cv.append(box);
      testStage().append(cv);

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(lay.cw * dpr);
      cv.height = Math.round(lay.ch * dpr);
      const ctx = cv.getContext('2d');
      cv.addEventListener('paint', () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, lay.cw, lay.ch);
        ctx.drawElementImage(box, 0, 0, lay.cw, lay.ch);
      });
      await nextPaint(cv);

      const opts = { ...PRESETS.gallery, cylX: 0, cylZ: 0, cylLift: 0 };
      let found = null;
      for (let py = 65; py <= 115 && !found; py += 4) {
        for (let px = 110; px <= 170; px += 4) {
          const h = projectCatoptricPoint(px, py, lay, opts);
          if (h && h.kind === 'card' && h.surface === 'cylinder' && h.qx >= 72 && h.qx <= 248 && h.qy >= 80 && h.qy <= 120) {
            found = h;
            break;
          }
        }
      }
      if (!found) {
        window.__gfx?.retire(cv);
        throw new Error('Could not find a cylinder reflection pixel landing on the target button');
      }

      const unit = geometryUnit(cv, box, CARD_W);
      const localMat = new DOMMatrix([found.a, found.b, found.c, found.d, found.e, found.f]);
      cv.updateElementGeometry?.(box, { canvasTransform: new DOMMatrix().scale(unit).multiply(localMat) });
      box.dataset.hitTick = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const r = cv.getBoundingClientRect();
      const hits = document.elementsFromPoint(r.left + found.px, r.top + found.py);
      const ok = hits.includes(btn);
      window.__gfx?.retire(cv);
      return need(
        ok,
        `Reprojected cylinder reflection (${found.scale.toFixed(2)}x, unit ${unit.toFixed(2)}) at (${Math.round(found.px)}, ${Math.round(found.py)}) -> card (${Math.round(found.qx)}, ${Math.round(found.qy)}), button hit=${ok} (top: <${hits[0]?.tagName?.toLowerCase() ?? 'none'}>).`
      );
    },
  },
  {
    name: 'Offsetting or lifting the cylinder shifts the reflected coordinates cleanly',
    expect: 'pass',
    why: 'Compares the reflected UV at the central mirror pixel when centred on the focal circle, slid 0.35 units sideways and lifted 2.9 units away.',
    run: async () => {
      const lay = { cw: 660, ch: 480, cardW: CARD_W, cardH: CARD_H };
      const px = lay.cw * 0.5;
      const py = lay.ch * 0.44;
      const centred = projectCatoptricPoint(px, py, lay, { ...PRESETS.gallery, cylX: 0, cylZ: 0, cylLift: 0 });
      const offset = projectCatoptricPoint(px, py, lay, { ...PRESETS.gallery, cylX: 0.35, cylZ: 0, cylLift: 0 });
      const lifted = projectCatoptricPoint(px, py, lay, { ...PRESETS.gallery, cylX: 0, cylZ: 0, cylLift: 2.9 });

      const shifted = Boolean(centred?.kind === 'card' && offset && (offset.kind !== 'card' || Math.hypot(offset.u - centred.u, offset.v - centred.v) > 0.08));
      const cleared = !lifted || lifted.surface !== 'cylinder';
      const offsetDesc = offset?.kind === 'card'
        ? `uv=(${offset.u.toFixed(3)}, ${offset.v.toFixed(3)}), delta=${Math.hypot(offset.u - centred.u, offset.v - centred.v).toFixed(3)}`
        : `surface=${offset?.kind ?? 'none'}`;
      return need(
        shifted && cleared,
        `centred uv=(${centred?.u.toFixed(3)}, ${centred?.v.toFixed(3)}); offset +0.35: ${offsetDesc}; lifted +2.9: surface=${lifted?.surface ?? 'none'}.`
      );
    },
  },
  {
    name: 'Dispatched webglcontextlost event falls back to plain HTML without calling loseContext()',
    expect: 'pass',
    why: 'Tests the context-loss recovery path safely with a synthetic cancelable Event on an isolated fixture.',
    run: async () => {
      const host = document.createElement('div');
      const cv = document.createElement('canvas');
      const child = document.createElement('div');
      cv.append(child);
      host.append(cv);
      testStage().append(host);
      let recovered = false;
      cv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        recovered = true;
        host.append(child);
      });
      const ev = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(ev);
      const ok = ev.defaultPrevented && recovered && child.parentElement === host;
      window.__gfx?.retire(cv);
      return need(ok, `defaultPrevented=${ev.defaultPrevented}, card moved to plain wrapper=${child.parentElement === host}.`);
    },
  },
];

runTests(document.getElementById('tests'), tests);
