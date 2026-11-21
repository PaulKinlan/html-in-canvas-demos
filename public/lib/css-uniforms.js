// css-uniforms.js: set a fragment shader's uniforms from CSS custom properties.
//
//   import { cssUniforms } from '/lib/css-uniforms.js';
//   const bound = cssUniforms(FRAGMENT);      // finds `uniform float uWave;` and `uniform vec4 uTint;`
//   bound.register();                         // registers --u-wave as <number> and --u-tint as <color>
//   const { values, changed } = bound.read(element);   // getComputedStyle(), parsed, cached
//   bound.apply(gl, (name) => gl.getUniformLocation(program, name), values);
//
// The page author then writes CSS and nothing else:
//
//   .card { transition: --u-wave .3s; }
//   .card:hover { --u-wave: 6; }
//
// A float uniform named uRgbSplit reads --u-rgb-split. A vec4 uniform reads a colour and gets
// red, green, blue (0 to 1, not premultiplied) and alpha. Registering the properties is what makes
// them animate: an unregistered custom property flips at the halfway point of a transition.
//
// A change to a custom property that no rendering property uses raises no paint event, so the
// page calls read() once a frame and redraws when `changed` is true.

const DECLARATION = /uniform\s+(float|vec4)\s+([^;]+);/g;

/** uRgbSplit -> --u-rgb-split */
export const propertyFor = (uniform, prefix = '--u-') =>
  prefix + uniform.replace(/^u(?=[A-Z])/, '').replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase());

let scratch = null;
const colours = new Map();
/** A computed <color> as [r, g, b, a], each 0 to 1. */
export function parseColour(text) {
  let c = colours.get(text);
  if (c) return c;
  const n = text.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [];
  if (/^rgba?\(/.test(text) && n.length >= 3) c = [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1];
  else if (/^color\(srgb /.test(text) && n.length >= 3) c = [n[0], n[1], n[2], n[3] ?? 1];
  else {
    // Any other form (oklab(), color(display-p3 …)): let a 2D canvas convert it to sRGB.
    scratch ??= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    scratch.clearRect(0, 0, 1, 1); scratch.fillStyle = '#0000'; scratch.fillStyle = text; scratch.fillRect(0, 0, 1, 1);
    const d = scratch.getImageData(0, 0, 1, 1).data;
    c = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  }
  if (colours.size > 2000) colours.clear();
  colours.set(text, c);
  return c;
}

// #region bind
export function cssUniforms(fragment, { prefix = '--u-', skip = ['uTex', 'uSize', 'uTime', 'uMatrix'] } = {}) {
  // Every float and vec4 uniform the shader declares, except the ones the renderer sets itself.
  const list = [];
  for (const [, type, names] of fragment.matchAll(DECLARATION)) {
    for (const uniform of names.split(',').map((s) => s.trim())) {
      if (!skip.includes(uniform)) list.push({ uniform, type, property: propertyFor(uniform, prefix) });
    }
  }
  const cache = new WeakMap();

  return {
    list,
    /** Register each property so that it has a type, a default and can be transitioned. */
    register({ inherits = false } = {}) {
      for (const { type, property } of list) {
        try { CSS.registerProperty({ name: property, syntax: type === 'vec4' ? '<color>' : '<number>', inherits, initialValue: type === 'vec4' ? 'transparent' : '0' }); }
        catch { /* registered already, by this call earlier or by an @property rule */ }
      }
    },
    /** Read the element's computed values. `changed` is true when any differs from the last read of this element. */
    read(element) {
      let entry = cache.get(element);
      if (!entry) { entry = { raw: new Array(list.length).fill(null), values: new Float32Array(list.length * 4) }; cache.set(element, entry); }
      const style = getComputedStyle(element);
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const raw = style.getPropertyValue(list[i].property);
        if (raw === entry.raw[i]) continue;
        entry.raw[i] = raw; changed = true;
        if (list[i].type === 'vec4') entry.values.set(parseColour(raw.trim() || 'transparent'), i * 4);
        else entry.values[i * 4] = parseFloat(raw) || 0;
      }
      return { values: entry.values, changed };
    },
    /** Set the uniforms on the program in use. `location(name)` returns a uniform location. */
    apply(gl, location, values) {
      for (let i = 0; i < list.length; i++) {
        const at = location(list[i].uniform);
        if (at === null) continue;
        if (list[i].type === 'vec4') gl.uniform4f(at, values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]);
        else gl.uniform1f(at, values[i * 4]);
      }
    },
  };
}
// #endregion bind
