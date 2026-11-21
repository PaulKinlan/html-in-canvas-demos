// The "focus" effect for the fx attribute: the panel shows where focus is.
//
//   --fx-progress, --fx-amount   centre of the focused control, as fractions of the panel
//   --fx-x                       0 = focus is not in the panel, 1 = it is
//   --fx-y                       radius of the focused control, as a fraction of the panel width
//   surface.poke(x, y)           a ring from a press (the library's u_clicks)
//
// The page sets the four properties from a focusin listener and CSS
// transitions move them, so the lit area travels from one control to the next.
// The panel leans toward the focused control, and the same matrix goes to
// canvas.updateElementGeometry(), so a tap still lands on the control drawn there.
//
// GLSL for WebGL and WGSL for WebGPU.

import { defineEffect } from '/lib/shader-fx.js';
import { tiltMatrix } from '/lib/effects.js';

// #region effect
defineEffect('focus', {
  bleed: 30,
  animated: true,
  geometry({ width, height, progress, amount, x }) {
    if (!x) return null;
    return tiltMatrix(width, height, (amount - 0.5) * 16 * x, (0.5 - progress) * 20 * x, 800);
  },
  glsl: `vec4 fx(vec2 p) {
    vec2 s = unproject(p);
    float on = clamp(u_xy.x, 0.0, 1.0);
    vec2 f = vec2(u_progress, u_amount) * u_size;
    float R = max(u_xy.y * u_size.x, 24.0) * 1.25;
    vec2 v = s - f;
    float d = length(v);
    // A press sends a ring through the panel.
    vec2 shift = vec2(0.0);
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 c = u_clicks[i];
      if (c.z < 0.0 || c.z > 1.6) continue;
      vec2 w = s - c.xy;
      float r = length(w), front = c.z * 380.0;
      float k = exp(-pow((r - front) / 26.0, 2.0)) * exp(-c.z * 2.2);
      shift += normalize(w + 1e-4) * sin((r - front) * 0.24) * k * 14.0;
      ring += k;
    }
    // Magnify what is under the focus: sample nearer to its centre.
    vec2 q = f + v * (1.0 - 0.2 * on * exp(-d * d / (R * R))) - shift;
    float e = min(min(s.x, s.y), min(u_size.x - s.x, u_size.y - s.y));
    float cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    vec4 col = tex(clamp(q, vec2(0.5), u_size - 0.5)) * cover;
    // Away from the focus: less colour and less light.
    float far = on * smoothstep(R * 0.95, R * 2.3, d);
    float grey = dot(col.rgb, vec3(0.299, 0.587, 0.114));
    col.rgb = mix(col.rgb, vec3(grey) * 0.55, far * 0.85);
    // A soft light on the focused control, slowly pulsing, and the ring.
    float pulse = 0.75 + 0.25 * sin(u_time * 3.0);
    col.rgb += col.a * on * exp(-d * d / (R * R * 0.9)) * vec3(1.0, 0.78, 0.36) * 0.2 * pulse;
    col.rgb += col.a * ring * vec3(1.0, 0.72, 0.25) * 0.6;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let s = unproject(p);
    let on = clamp(u.xy.x, 0.0, 1.0);
    let f = vec2f(u.progress, u.amount) * u.size;
    let R = max(u.xy.y * u.size.x, 24.0) * 1.25;
    let v = s - f;
    let d = length(v);
    var shift = vec2f(0.0);
    var ring = 0.0;
    for (var i = 0; i < 4; i++) {
      let c = u.clicks[i];
      if (c.z < 0.0 || c.z > 1.6) { continue; }
      let w = s - c.xy;
      let r = length(w); let front = c.z * 380.0;
      let k = exp(-pow((r - front) / 26.0, 2.0)) * exp(-c.z * 2.2);
      shift += normalize(w + 1e-4) * sin((r - front) * 0.24) * k * 14.0;
      ring += k;
    }
    let q = f + v * (1.0 - 0.2 * on * exp(-d * d / (R * R))) - shift;
    let e = min(min(s.x, s.y), min(u.size.x - s.x, u.size.y - s.y));
    let cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    let col = tex(clamp(q, vec2f(0.5), u.size - 0.5)) * cover;
    let far = on * smoothstep(R * 0.95, R * 2.3, d);
    let grey = dot(col.rgb, vec3f(0.299, 0.587, 0.114));
    var rgb = mix(col.rgb, vec3f(grey) * 0.55, far * 0.85);
    let pulse = 0.75 + 0.25 * sin(u.time * 3.0);
    rgb += col.a * on * exp(-d * d / (R * R * 0.9)) * vec3f(1.0, 0.78, 0.36) * 0.2 * pulse;
    rgb += col.a * ring * vec3f(1.0, 0.72, 0.25) * 0.6;
    return vec4f(rgb, col.a);
  }`,
});
// #endregion effect
