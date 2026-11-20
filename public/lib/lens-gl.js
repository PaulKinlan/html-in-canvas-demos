// The lens catalogue and the one WebGL context that draws every <dom-lens>.
//
// A lens is a fragment shader. For each pixel of the lens it answers "which
// point of the page do I show, and what do I do to its colour?". The page
// pixels come from a texture that <dom-lens> rasterizes with ONE
// drawElementImage() call, at the lens's own magnification, so text under the
// glass is re-rasterized sharp and not an upscaled bitmap. The pipeline per
// frame is:
//
//   1. 2D canvas: draw the element, magnified, into a square scratch patch
//   2. upload that patch to a texture (GPU to GPU copy)
//   3. run the lens shader into a small shared WebGL canvas
//   4. 2D canvas: repaint the patch with the page at rest, then drawImage()
//      the shader's result where the lens is
//
// So a lens costs two paint-record replays (both clipped to the lens's
// neighbourhood), two copies and one shader pass, whatever its shape. The old
// fisheye replayed the paint record once per triangle of a mesh: up to 200
// clipped draws a frame.
//
// In lens code:
//   p            the pixel, in lens radii from the lens centre (y down)
//   src(q)       page colour at q lens radii from the point the lens looks at
//   srcLod(q, l) the same from mip level l (lenses with mip: true)
//   ring(c, p, edge)  the standard glass rim and round mask around colour c
//   u_zoom, u_time, u_px (lens radius, device px), u_css (device px per CSS px),
//   u_k (per-lens numbers from params()), u_backdrop,
//   u_look (which way the lens is moving, or where the pointer is from a pinned lens; length 0 to 1)
//
// reach(zoom): how far from the centre, in lens radii, the lens can look.
// density(zoom): how many times the screen's resolution the patch needs.

const PRELUDE = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform float u_zoom, u_time, u_reach, u_px, u_css;
uniform vec4 u_k;
uniform vec2 u_look;
uniform vec3 u_backdrop;
in vec2 v_p;
out vec4 o;
const float PI = 3.14159265;
vec4 src(vec2 q) { return texture(u_src, q / u_reach * 0.5 + 0.5); }
vec4 srcLod(vec2 q, float lod) { return textureLod(u_src, q / u_reach * 0.5 + 0.5, lod); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// CSS px inside the lens edge (negative outside).
float inside(vec2 p) { return (1.0 - length(p)) * u_px / u_css; }
float disc(vec2 p, float grow) { float w = 1.0 / u_css; return smoothstep(-grow - w, -grow, inside(p)); }
vec4 ring(vec3 col, vec2 p, vec3 edge) {
  float r = length(p), d = inside(p), w = 1.0 / u_css;
  col += 0.16 * smoothstep(0.5, 0.1, length(p - vec2(-0.35, -0.4)));
  col *= 1.0 - 0.22 * smoothstep(0.85, 1.0, r);
  col = mix(col, vec3(1.0), 0.7 * (1.0 - smoothstep(0.5, 0.5 + w, abs(d - 2.5))));
  col = mix(col, edge, 1.0 - smoothstep(1.5, 1.5 + w, abs(d)));
  return vec4(col, disc(p, 1.5));
}
const vec3 DARK = vec3(0.08);
// Colour col with coverage a, over a black shadow of strength sh.
vec4 withShadow(vec3 col, float a, float sh) { float aa = max(a, sh * (1.0 - a)); return vec4(col * a / max(aa, 1e-4), aa); }
`;

const MAIN = `
void main() {
  vec4 c = lens(v_p);
  o = vec4(clamp(c.rgb, 0.0, 1.0) * c.a, c.a);
}`;

const VERTEX = `#version 300 es
in vec2 a;
uniform float u_box;
out vec2 v_p;
void main() {
  v_p = vec2(a.x, -a.y) * u_box;
  gl_Position = vec4(a, 0.0, 1.0);
}`;

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear light.
const CVD = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

// The magnifying glass is a real biconvex lens: two spherical caps of radius
// GLASS_RC (in lens radii) meeting at the rim. Rays are traced through both
// surfaces with Snell's law and on down to the page.
const GLASS_RC = 3.2;
export const GLASS_N = [1.508, 1.52, 1.534]; // red, green, blue: more dispersion than real crown glass, so the fringes show

/** Distance from the lens's mid plane to the page that gives `zoom` on the axis. */
export function glassDistance(zoom, rc = GLASS_RC, n = GLASS_N[1]) {
  const h = Math.sqrt(rc * rc - 1);
  const r = 0.01;
  const refract = (d, nrm, eta) => {
    const cosi = -(d[0] * nrm[0] + d[1] * nrm[1]);
    const k = 1 - eta * eta * (1 - cosi * cosi);
    const f = eta * cosi - Math.sqrt(Math.max(0, k));
    return [eta * d[0] + f * nrm[0], eta * d[1] + f * nrm[1]];
  };
  const p1 = [r, -h + Math.sqrt(rc * rc - r * r)];
  const d1 = refract([0, -1], [p1[0] / rc, (p1[1] + h) / rc], 1 / n);
  const oc = [p1[0], p1[1] - h];
  const bb = oc[0] * d1[0] + oc[1] * d1[1];
  const t = -bb + Math.sqrt(bb * bb - (oc[0] * oc[0] + oc[1] * oc[1] - rc * rc));
  const p2 = [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
  const d2 = refract(d1, [-p2[0] / rc, (h - p2[1]) / rc], n);
  // The ray reaches the page at p2.x + d2.x / -d2.y * (D + p2.y); solve for r / zoom.
  const D = ((r / zoom - p2[0]) * -d2[1]) / d2[0] - p2[1];
  const sag = rc - h;
  return Math.max(sag + 0.02, D);
}

export const LENSES = {
  // #region magnify
  magnify: {
    label: 'Magnifier',
    blurb: 'A flat loupe: one scale, sharp to the rim.',
    zoom: 3,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) { return ring(src(p / u_zoom).rgb, p, DARK); }`,
  },
  // #endregion magnify

  glass: {
    label: 'Real glass',
    blurb: 'A biconvex glass lens, ray traced: Snell’s law at both curved faces, a different index for red, green and blue.',
    zoom: 2.4,
    mip: true,
    reach: () => 1.15,
    density: (z) => Math.min(z, 4),
    params: (z) => [glassDistance(z), GLASS_RC, 0, 0],
    glsl: `
const vec3 N_RGB = vec3(${GLASS_N.map((n) => n.toFixed(3)).join(', ')});
// Where a ray that enters straight down at p lands on the page. z is up.
// Returns false when the ray cannot leave the glass (total internal reflection).
bool trace(vec2 p, float n, out vec2 q, out vec3 n1) {
  float rc = u_k.y, h = sqrt(rc * rc - 1.0);
  vec3 P1 = vec3(p, -h + sqrt(rc * rc - dot(p, p)));
  n1 = (P1 - vec3(0.0, 0.0, -h)) / rc;
  vec3 d1 = refract(vec3(0.0, 0.0, -1.0), n1, 1.0 / n);
  vec3 cB = vec3(0.0, 0.0, h), oc = P1 - cB;
  float b = dot(oc, d1), t = -b + sqrt(max(0.0, b * b - dot(oc, oc) + rc * rc));
  vec3 P2 = P1 + d1 * t;
  vec3 d2 = refract(d1, (cB - P2) / rc, n);
  if (dot(d2, d2) < 0.5) return false;
  q = P2.xy + d2.xy / -d2.z * (u_k.x + P2.z);
  return true;
}
vec4 lens(vec2 p) {
  float r = length(p), d = inside(p), w = 1.0 / u_css;
  float rimW = 5.0;                                   // CSS px of metal rim
  float g = 1.0 - rimW * u_css / u_px;                // glass radius in lens radii
  vec2 pg = p / g;
  vec3 col = vec3(0.0);
  vec3 n1 = vec3(0.0, 0.0, 1.0);
  if (dot(pg, pg) < 1.0) {
    vec2 q; bool ok;
    ok = trace(pg, N_RGB.r, q, n1); col.r = ok ? src(q * g).r : 0.0;
    ok = trace(pg, N_RGB.g, q, n1); col.g = ok ? src(q * g).g : 0.0;
    ok = trace(pg, N_RGB.b, q, n1); col.b = ok ? src(q * g).b : 0.0;
    // Fresnel: glass reflects more of the room at grazing angles.
    float f0 = 0.04, fres = f0 + (1.0 - f0) * pow(1.0 - n1.z, 5.0);
    vec3 L = normalize(vec3(-0.45, -0.6, 0.66));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n1, H), 0.0), 90.0) + 0.25 * pow(max(dot(n1, normalize(vec3(0.5, 0.62, 0.6))), 0.0), 40.0);
    col = mix(col, vec3(0.82, 0.88, 0.95), fres * 0.55) + spec * 0.9;
    col *= 1.0 - 0.25 * smoothstep(0.8, 1.0, length(pg));
  }
  // A turned metal rim, lit from the top left.
  float rim = smoothstep(rimW + w, rimW, d);
  float bevel = clamp(d / rimW, 0.0, 1.0);
  float lit = 0.5 + 0.5 * dot(normalize(p + 1e-5), normalize(vec2(-0.45, -0.6))) * (bevel * 2.0 - 1.0);
  vec3 metal = mix(vec3(0.12, 0.11, 0.1), vec3(0.93, 0.84, 0.62), lit * lit) * (0.75 + 0.25 * sin(bevel * PI));
  col = mix(col, metal, rim);
  // Soft shadow on the page, down and to the right.
  float sh = 0.28 * smoothstep(7.0, 0.0, (length(p - vec2(0.02, 0.035)) - 1.0) * u_px / u_css);
  float a = disc(p, 0.0);
  return withShadow(col, a, sh);
}`,
  },

  fisheye: {
    label: 'Fisheye',
    blurb: 'Full zoom in the middle, falling smoothly to none at the rim, so nothing is hidden behind the lens.',
    zoom: 3,
    mip: true,
    reach: () => 1,
    density: (z) => Math.min(z, 4),
    glsl: `vec4 lens(vec2 p) {
  float k = 1.0 / u_zoom;
  return ring(src(p * (k + (1.0 - k) * dot(p, p))).rgb, p, DARK);
}`,
  },

  droplet: {
    label: 'Water drop',
    blurb: 'A drop of water sitting on the page: refraction through a spherical cap, with ripples running across it.',
    zoom: 2.5,
    mip: true,
    animated: true,
    reach: () => 1.1,
    density: (z) => Math.min(1 + z * 0.4, 3),
    glsl: `vec4 lens(vec2 p) {
  float r = length(p);
  float sag = clamp(0.18 + 0.11 * u_zoom, 0.2, 0.95);      // how tall the drop is
  float rc = (1.0 + sag * sag) / (2.0 * sag);
  float hgt = sqrt(max(rc * rc - r * r, 0.0)) - (rc - sag);
  vec3 n = normalize(vec3(p, sqrt(max(rc * rc - r * r, 1e-4))));
  // Ripples: a travelling radial wave tilts the surface.
  float wave = sin(r * 22.0 - u_time * 5.0) * 0.07 * smoothstep(0.0, 0.25, r) * (1.0 - r);
  n = normalize(n + vec3(p / max(r, 1e-4) * wave, 0.0));
  vec3 d = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / 1.333);
  vec2 q = p + d.xy / -d.z * hgt * 1.6;
  vec3 col = src(q).rgb;
  vec3 H = normalize(vec3(-0.45, -0.6, 0.66) + vec3(0.0, 0.0, 1.0));
  col += pow(max(dot(n, H), 0.0), 60.0) * 0.9;
  col += 0.12 * smoothstep(0.75, 1.0, r) * smoothstep(-0.2, 0.9, dot(p, vec2(0.6, 0.8)));   // light gathered at the far edge
  col *= 1.0 - 0.35 * smoothstep(0.9, 1.0, r) * smoothstep(0.3, -0.8, dot(p, vec2(0.6, 0.8)));
  return vec4(col, disc(p, 0.0));
}`,
  },

  frosted: {
    label: 'Frosted',
    blurb: 'Privacy glass: every pixel looks through a slightly different facet.',
    zoom: 1.4,
    mip: true,
    reach: (z) => 1 / z + 0.12,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) {
  vec2 q = p / u_zoom;
  vec3 col = vec3(0.0);
  float seed = hash(gl_FragCoord.xy);
  for (int i = 0; i < 10; i++) {
    float a = (float(i) + seed) * 2.39996, rr = sqrt((float(i) + 0.5) / 10.0) * 0.075;
    col += srcLod(q + vec2(cos(a), sin(a)) * rr, 2.5).rgb;
  }
  col = col / 10.0;
  col = mix(col, vec3(1.0), 0.12) + (hash(gl_FragCoord.xy * 1.7) - 0.5) * 0.05;
  return ring(col, p, vec3(0.45, 0.5, 0.55));
}`,
  },

  night: {
    label: 'Night vision',
    blurb: 'An image intensifier: brightness only, green phosphor, grain and scan lines.',
    zoom: 2,
    animated: true,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) {
  float l = luma(src(p / u_zoom).rgb);
  l = pow(l, 0.75) * 1.15;
  float grain = hash(gl_FragCoord.xy + floor(u_time * 24.0) * 17.0) - 0.5;
  float scan = 0.92 + 0.08 * sin(gl_FragCoord.y * PI / max(1.0, floor(u_css * 1.5)));
  vec3 col = vec3(0.08, 1.0, 0.22) * (l + grain * 0.22) * scan;
  col += vec3(0.5, 0.6, 0.5) * smoothstep(0.85, 1.2, l);
  col *= 1.0 - 0.75 * smoothstep(0.55, 1.0, length(p));
  return ring(col, p, vec3(0.02, 0.05, 0.02));
}`,
  },

  thermal: {
    label: 'Thermal',
    blurb: 'A false-colour camera. Ink reads as hot, paper as cold.',
    zoom: 2,
    mip: true,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec3 iron(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.02, 0.01, 0.18), vec3(0.45, 0.02, 0.55), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(0.9, 0.12, 0.2), smoothstep(0.25, 0.5, t));
  c = mix(c, vec3(1.0, 0.6, 0.05), smoothstep(0.5, 0.75, t));
  return mix(c, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, t));
}
vec4 lens(vec2 p) {
  vec2 q = p / u_zoom;
  vec3 c = srcLod(q, 1.5).rgb;
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float heat = (1.0 - luma(c)) * 0.85 + sat * 0.5 + 0.08;
  return ring(iron(heat), p, DARK);
}`,
  },

  xray: {
    label: 'X-ray',
    blurb: 'The live layout box of every element under the lens, interactive ones in amber.',
    zoom: 2,
    reach: (z) => 1 / z,
    density: (z) => z,
    overlay: 'boxes',
    glsl: `vec4 lens(vec2 p) { return ring(src(p / u_zoom).rgb, p, vec3(0.37, 0.82, 1.0)); }`,
  },

  halftone: {
    label: 'Halftone',
    blurb: 'Newsprint: the page becomes dots whose size carries the tone.',
    zoom: 3,
    mip: true,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) {
  float cell = 3.5 * u_css / u_px;                     // dot pitch: 3.5 CSS px, in lens radii
  mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 g = rot * p / cell, id = floor(g) + 0.5;
  vec2 centre = transpose(rot) * id * cell;
  vec3 c = srcLod(centre / u_zoom, log2(max(1.0, 3.5 * u_css))).rgb;
  float tone = 1.0 - luma(c);
  float dotR = sqrt(tone) * 0.72;
  float edge = 0.5 / (3.5 * u_css);
  float ink = 1.0 - smoothstep(dotR - edge, dotR + edge, length(g - id));
  vec3 paper = vec3(0.97, 0.95, 0.9);
  vec3 inkCol = mix(vec3(0.07), c * 0.55, 0.6);
  return ring(mix(paper, inkCol, ink), p, DARK);
}`,
  },

  pixel: {
    label: 'Pixelate',
    blurb: 'A mosaic: each tile is the average of what is under it.',
    zoom: 2,
    mip: true,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) {
  float cell = 8.0 * u_css / u_px;
  vec2 id = (floor(p / cell) + 0.5) * cell;
  vec3 c = srcLod(id / u_zoom, log2(max(1.0, 8.0 * u_css))).rgb;
  vec2 f = abs(fract(p / cell) - 0.5);
  c *= 1.0 - 0.18 * smoothstep(0.42, 0.5, max(f.x, f.y));
  return ring(c, p, DARK);
}`,
  },

  cvd: {
    label: 'Colour blind',
    blurb: 'How the page looks with a colour vision deficiency (protan, deutan or tritan).',
    zoom: 1.5,
    reach: (z) => 1 / z,
    density: (z) => z,
    variants: { protan: 'Protanopia (no red cones)', deutan: 'Deuteranopia (no green cones)', tritan: 'Tritanopia (no blue cones)' },
    matrix: (variant) => CVD[variant] ?? CVD.deutan,
    glsl: `uniform mat3 u_m;
vec4 lens(vec2 p) {
  vec3 c = pow(src(p / u_zoom).rgb, vec3(2.2));
  c = pow(clamp(c * u_m, 0.0, 1.0), vec3(1.0 / 2.2));
  return ring(c, p, DARK);
}`,
  },

  blackhole: {
    label: 'Black hole',
    blurb: 'A point mass bends light by 1/distance: the page wraps into an Einstein ring around the shadow.',
    zoom: 3,
    mip: true,
    animated: true,
    reach: () => 1,
    density: () => 1.5,
    glsl: `vec4 lens(vec2 p) {
  float th = max(length(p), 1e-4);
  float te = clamp(0.2 + 0.06 * u_zoom, 0.22, 0.6);      // Einstein radius
  float fade = smoothstep(1.0, 0.72, th);                 // let go of the page at the rim
  float beta = th - te * te / th * fade;                  // the lens equation
  vec3 col = src(p / th * beta).rgb;
  float shadow = te * 0.52;
  // A thin, lopsided photon ring and a turning glow of infalling matter.
  float a = atan(p.y, p.x);
  float swirl = 0.6 + 0.4 * sin(a * 3.0 - u_time * 1.6 + 6.0 / (th + 0.2));
  float ringGlow = exp(-pow((th - shadow * 1.18) / (shadow * 0.16), 2.0)) * (0.7 + 0.3 * sin(a - u_time * 0.8));
  float halo = exp(-(th - shadow) / (te * 0.55)) * step(shadow, th) * swirl * 0.5;
  col = mix(col, vec3(0.0), smoothstep(shadow * 1.06, shadow * 0.94, th));
  col += vec3(1.0, 0.62, 0.25) * (ringGlow + halo * fade);
  return vec4(col, disc(p, 0.0));
}`,
  },

  kaleidoscope: {
    label: 'Kaleidoscope',
    blurb: 'Six mirrors: the wedge of page under the lens, folded round and slowly turning.',
    zoom: 1.2,
    animated: true,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) {
  float r = length(p), seg = PI / 6.0;
  float a = atan(p.y, p.x) + u_time * 0.12;
  a = abs(mod(a, 2.0 * seg) - seg);
  vec3 col = src(vec2(cos(a - seg * 0.5), sin(a - seg * 0.5)) * r / u_zoom).rgb;
  return ring(col, p, vec3(0.35, 0.2, 0.5));
}`,
  },

  eye: {
    label: 'Fiery eye',
    blurb: 'A lidless eye that sets the page alight: letters stream out from it, catch, and burn away at the rim. It looks where the lens is going (pin it and it watches your pointer).',
    zoom: 1.6,
    mip: true,
    animated: true,
    reach: (z) => 1 / z + 0.08,
    density: (z) => Math.min(z, 3),
    glsl: `
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 x) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(x); x = x * 2.03 + 17.0; a *= 0.5; }
  return s;
}
vec3 fire(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(smoothstep(0.0, 0.4, t), smoothstep(0.22, 0.8, t) * 0.88, smoothstep(0.68, 1.0, t) * 0.75);
}
// How much ink the page has at q: 1 on a dark glyph, 0 on paper.
float inkAt(vec2 q, float lod) { return clamp(1.0 - luma(srcLod(q, lod).rgb) * 1.04, 0.0, 1.0); }
// The page is pushed out from the middle: stretched more and more towards the rim.
float pull(float r) { return r / u_zoom * (1.0 - 0.27 * r * r); }

// The eye itself, in its own unit circle. rgb and how much of it covers the page.
vec4 eyeball(vec2 p, float t) {
  float r = length(p);
  vec2 dir = p / max(r, 1e-4);
  vec2 e = p * vec2(0.8, 1.25);
  float er = length(e), R0 = 0.52;
  vec2 c = u_look * vec2(0.22, 0.1);
  float f = fbm(e * 3.6 - dir * t * 1.6);
  float streak = fbm(normalize(p - c + 1e-5) * 5.0 + vec2(er * 2.0 - t * 0.5, t * 0.2));
  float iris = (0.3 + 1.2 * streak * streak) * (1.25 - er * 1.1);
  float flames = clamp(f * 2.2 - (er - R0) * 2.1, 0.0, 1.0) * (0.45 + f);
  float heat = mix(iris, flames, smoothstep(R0 - 0.1, R0 + 0.06, er));
  heat *= 1.0 - 0.45 * exp(-pow((er - R0 + 0.04) * 14.0, 2.0));
  vec2 q = (p - c) / vec2(0.17 + 0.025 * sin(t * 1.7), 0.56);
  q.x /= 1.0 - 0.75 * q.y * q.y;
  float pd = length(q);
  heat += exp(-pow((pd - 1.0) * 3.0, 2.0)) * 0.35 * step(1.0, pd);
  vec3 col = fire(heat);
  col = mix(col, vec3(0.03, 0.0, 0.0), smoothstep(1.05, 0.9, pd));
  float cover = max(clamp(heat * 1.8, 0.0, 1.0), smoothstep(1.05, 0.9, pd)) * smoothstep(1.25, 0.95, r);
  return vec4(col, cover);
}

vec4 lens(vec2 p) {
  float r = length(p), t = u_time;
  vec2 dir = p / max(r, 1e-4);
  float n1 = fbm(p * 3.0 + vec2(0.0, -t * 0.4));
  // The hole burnt in the page has a ragged, creeping edge.
  float edgeR = min(0.985, 0.87 + 0.24 * (fbm(dir * 2.2 + vec2(t * 0.22, -t * 0.17)) - 0.5));
  float d = edgeR - r;
  // The page under the lens, pushed outward and shimmering in the heat.
  vec2 wob = (vec2(fbm(p * 5.0 + vec2(0.0, -t * 1.4)), fbm(p * 5.0 + vec2(7.0, -t * 1.1))) - 0.5) * 0.06 * r / u_zoom;
  vec2 q = dir * pull(r) + wob;
  vec3 page = src(q).rgb;
  float ink = clamp(1.0 - luma(page) * 1.04, 0.0, 1.0);
  float halo = inkAt(q, 3.0);
  // Every letter throws a flame outward: look back towards the eye for ink.
  float trail = 0.0;
  for (int i = 1; i <= 6; i++) {
    float fi = float(i), rr = max(r - fi * 0.028, 0.0);
    vec2 lick = (vec2(vnoise(p * 13.0 + fi + t * 2.3), vnoise(p * 13.0 - fi - t * 2.0)) - 0.5) * 0.012 * fi / u_zoom;
    trail += inkAt(dir * pull(rr) + wob + lick, 1.5) * (1.0 - fi / 7.0);
  }
  float burn = clamp(smoothstep(0.25, edgeR, r) + (n1 - 0.5) * 0.5, 0.0, 1.0);    // 0 by the eye, 1 at the edge
  trail *= 0.5 * (0.35 + fbm(p * 9.0 - dir * t * 2.6)) * (0.35 + burn);
  // Paper scorches from parchment to char; ink goes from soot through ember to white hot, and crumbles.
  vec3 col = mix(vec3(1.0), page, 0.25) * mix(vec3(0.98, 0.86, 0.66), vec3(0.3, 0.13, 0.05), pow(burn, 1.3));
  float crumble = smoothstep(burn * 1.2 - 0.3, burn * 1.2, 0.3 + vnoise(p * 42.0 + t * 0.6));
  vec3 ember = fire(0.3 + burn * 0.8 + 0.12 * sin(t * 4.0 + n1 * 30.0));
  col = mix(col, vec3(0.07, 0.03, 0.02), ink * (1.0 - burn) * 0.9);
  col = mix(col, ember, ink * smoothstep(0.1, 0.6, burn) * crumble);
  col += vec3(1.0, 0.42, 0.08) * max(halo * 1.6 - ink, 0.0) * (0.25 + burn) * 1.3;   // ember glow round each glyph
  col += fire(0.35 + trail * 1.2) * trail * 1.5;                                      // the flames themselves
  // Char, then a glowing front, at the edge of the hole.
  col *= 1.0 - 0.9 * smoothstep(0.15, 0.02, d);
  col += fire(0.72 + 0.28 * sin(t * 3.0 + n1 * 25.0)) * exp(-pow(d / 0.022, 2.0)) * 1.5;
  // Sparks fly outward and past the edge.
  float sp = clamp(pow(vnoise(p * 60.0 - dir * t * 3.2 + 3.0), 34.0) * 6000.0, 0.0, 1.0) * smoothstep(0.5, 0.9, r) * (0.5 + 0.5 * sin(t * 9.0 + n1 * 40.0));
  col += vec3(1.0, 0.72, 0.3) * sp;
  // The eye in the middle.
  vec4 eye = eyeball(p / 0.4, t);
  col = mix(col, eye.rgb, eye.a);
  float a = smoothstep(0.0, 0.012, d);
  float scorch = 0.7 * smoothstep(-0.07, 0.0, d) + sp;
  vec3 outside = mix(vec3(0.16, 0.06, 0.02), vec3(1.0, 0.6, 0.15), max(sp, exp(-pow(d / 0.022, 2.0))));
  float alpha = max(a, clamp(scorch, 0.0, 1.0) * (1.0 - a));
  return vec4(mix(outside, col, a), alpha * disc(p, 0.0));
}`,
  },

  reading: {
    label: 'Reading bar',
    blurb: 'A bar magnifier for one line at a time: bigger type, more contrast, a warm tint and a guide line.',
    zoom: 2.2,
    reach: (z) => 1 / z,
    density: (z) => z,
    glsl: `vec4 lens(vec2 p) {
  vec2 half_ = vec2(1.0, 0.46);
  float rad = 0.12;
  vec2 dd = abs(p) - half_ + rad;
  float sd = (length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - rad) * u_px / u_css;   // CSS px outside the bar
  float w = 1.0 / u_css;
  vec3 c = src(p / u_zoom).rgb;
  float l = luma(c);
  c = mix(vec3(l), c, 0.85);
  c = clamp((c - 0.5) * 1.5 + 0.5, 0.0, 1.0);                          // more contrast
  c *= vec3(1.0, 0.965, 0.84);                                          // warm paper
  float band = smoothstep(0.2, 0.14, abs(p.y));
  c *= mix(0.9, 1.0, band);
  c = mix(c, vec3(0.1), 1.0 - smoothstep(1.5, 1.5 + w, abs(sd)));
  float a = smoothstep(1.5 + w, 1.5, sd);
  float sh = 0.25 * smoothstep(8.0, 0.0, sd - 1.0) * step(0.0, p.y + 0.3);
  return withShadow(c, a, sh);
}`,
  },
};

/** Names in the order the demo lists them. */
export const LENS_NAMES = Object.keys(LENSES);

const MAX_PATCH = 2048;

class LensRenderer {
  canvas = document.createElement('canvas');
  gl = null;
  dead = false;
  /** Who uploaded the texture last: a lens that only animates can reuse it. */
  owner = null;
  #programs = new Map();
  #texture = null;
  #texSize = 0;
  #scratch = null;

  constructor() {
    this.canvas.width = this.canvas.height = 64;
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) {
      this.dead = true;
      return;
    }
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.dead = true;
      this.owner = null;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.#programs.clear();
      this.#init();
      this.dead = false;
      dispatchEvent(new Event('lensrendererrestored'));
    });
    this.#init();
  }

  #init() {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.#texture = gl.createTexture();
    this.#texSize = 0;
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // The 2D canvas is premultiplied; keep it that way so the copy stays on the GPU.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.BLEND);
  }

  #program(name) {
    let p = this.#programs.get(name);
    if (p !== undefined) return p;
    const gl = this.gl;
    const def = LENSES[name];
    const compile = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        if (log) console.error(`lens "${name}" did not compile:\n${log}`);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, PRELUDE + def.glsl + MAIN);
    p = null;
    if (vs && fs) {
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'a');
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        p = { prog, u: {} };
        for (const n of ['u_src', 'u_zoom', 'u_time', 'u_reach', 'u_px', 'u_css', 'u_k', 'u_backdrop', 'u_box', 'u_m', 'u_look']) p.u[n] = gl.getUniformLocation(prog, n);
      } else console.error(`lens "${name}" did not link: ${gl.getProgramInfoLog(prog)}`);
    }
    // A context on its way out fails to compile with no log; do not cache that.
    if (p || !gl.isContextLost()) this.#programs.set(name, p);
    return p;
  }

  /** True when this lens can be drawn here. */
  can(name) {
    return !this.dead && !!LENSES[name] && !!this.#program(name);
  }

  /**
   * Copy a size x size patch of a 2D canvas, top-left at (x, y), into the lens texture.
   * `via` picks the route (for measuring): 'direct' asks WebGL for the
   * sub-rectangle, 'scratch' goes through a small 2D canvas first.
   */
  // #region upload
  upload(source, x, y, size, mip, owner, via = 'direct') {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    if (via === 'scratch') {
      const sc = (this.#scratch ??= document.createElement('canvas'));
      if (sc.width !== size) sc.width = sc.height = size;
      const c2 = sc.getContext('2d');
      c2.globalCompositeOperation = 'copy';
      c2.drawImage(source, x, y, size, size, 0, 0, size, size);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sc);
    } else {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    }
    this.#texSize = size;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    this.owner = owner;
  }
  // #endregion upload

  /**
   * Run a lens. Returns the rectangle of this.canvas to drawImage() from.
   * o: { name, zoom, time, reach, radiusPx, css, boxPx, backdrop: [r, g, b], variant }
   */
  draw(o) {
    const gl = this.gl;
    const def = LENSES[o.name];
    const p = this.#program(o.name);
    const n = o.boxPx;
    // Grow only: several lenses of different sizes share this canvas.
    if (this.canvas.width < n || this.canvas.height < n) {
      this.canvas.width = this.canvas.height = Math.max(n, this.canvas.width);
    }
    gl.viewport(0, 0, n, n);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, n, n);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(p.u.u_src, 0);
    gl.uniform1f(p.u.u_zoom, o.zoom);
    gl.uniform1f(p.u.u_time, o.time);
    gl.uniform1f(p.u.u_reach, o.reach);
    gl.uniform1f(p.u.u_px, o.radiusPx);
    gl.uniform1f(p.u.u_css, o.css);
    gl.uniform1f(p.u.u_box, n / 2 / o.radiusPx);
    gl.uniform3fv(p.u.u_backdrop, o.backdrop);
    gl.uniform2fv(p.u.u_look, o.look ?? [0, 0]);
    gl.uniform4fv(p.u.u_k, def.params ? def.params(o.zoom, o.variant) : [0, 0, 0, 0]);
    if (p.u.u_m && def.matrix) gl.uniformMatrix3fv(p.u.u_m, false, def.matrix(o.variant));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // GL's origin is the bottom-left; in image space the viewport is the bottom n rows.
    return { x: 0, y: this.canvas.height - n, size: n };
  }
}

let shared;
/** The shared renderer, or null when WebGL 2 is not available (or its context is lost). */
export function lensRenderer() {
  if (shared === undefined) {
    try {
      shared = new LensRenderer();
    } catch {
      shared = null;
    }
  }
  return shared && !shared.dead ? shared : null;
}

export { MAX_PATCH };
