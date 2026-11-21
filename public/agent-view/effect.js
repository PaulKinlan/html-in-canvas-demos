// The "agent" effect for the fx attribute: a panel that leans in perspective,
// with a marker the page moves by setting CSS custom properties.
//
//   --fx-x, --fx-y        lean, -1..1 (0 0 faces the reader)
//   --fx-progress         marker x as a fraction of the element's width; below 0 = no marker
//   --fx-amount           marker y as a fraction of the element's height
//
// The same function is written twice: GLSL for WebGL and WGSL for WebGPU.

import { defineEffect } from '/lib/shader-fx.js';
import { tiltMatrix } from '/lib/effects.js';

// #region effect
defineEffect('agent', {
  bleed: 36,
  animated: true,
  // Where the element appears. The library gives this matrix to
  // canvas.updateElementGeometry(), so clicks and typing follow the lean.
  geometry({ width, height, x, y }) {
    if (!x && !y) return null;
    return tiltMatrix(width, height, -y * 15, x * 15, 800);
  },
  glsl: `vec4 fx(vec2 p) {
    vec2 s = unproject(p);
    float e = min(min(s.x, s.y), min(u_size.x - s.x, u_size.y - s.y));
    float cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    vec4 col = tex(clamp(s, vec2(0.5), u_size - 0.5)) * cover;
    float on = smoothstep(-0.05, 0.02, u_progress);
    float d = length(s - vec2(u_progress, u_amount) * u_size);
    // Dim what is far from the marker, so the eye goes to the field in use.
    col.rgb *= mix(1.0, 0.5 + 0.5 * (1.0 - smoothstep(70.0, 280.0, d)), on);
    // Two rings that grow and fade, and a solid dot.
    float mark = 1.0 - smoothstep(5.5, 7.5, d);
    for (int i = 0; i < 2; i++) {
      float ph = fract(u_time * 0.8 + float(i) * 0.5);
      mark += (1.0 - ph) * (1.0 - smoothstep(0.0, 2.6, abs(d - (9.0 + ph * 44.0))));
    }
    vec3 glow = vec3(0.30, 0.86, 1.0);
    float k = on * cover * clamp(mark, 0.0, 1.0);
    col.rgb = mix(col.rgb, glow * col.a, k) + on * cover * glow * exp(-d * d / 2200.0) * 0.28;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    let s = unproject(p);
    let e = min(min(s.x, s.y), min(u.size.x - s.x, u.size.y - s.y));
    let cover = clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0);
    var col = tex(clamp(s, vec2f(0.5), u.size - 0.5)) * cover;
    let on = smoothstep(-0.05, 0.02, u.progress);
    let d = length(s - vec2f(u.progress, u.amount) * u.size);
    var rgb = col.rgb * mix(1.0, 0.5 + 0.5 * (1.0 - smoothstep(70.0, 280.0, d)), on);
    var mark = 1.0 - smoothstep(5.5, 7.5, d);
    for (var i = 0; i < 2; i++) {
      let ph = fract(u.time * 0.8 + f32(i) * 0.5);
      mark += (1.0 - ph) * (1.0 - smoothstep(0.0, 2.6, abs(d - (9.0 + ph * 44.0))));
    }
    let glow = vec3f(0.30, 0.86, 1.0);
    let k = on * cover * clamp(mark, 0.0, 1.0);
    rgb = mix(rgb, glow * col.a, k) + on * cover * glow * exp(-d * d / 2200.0) * 0.28;
    return vec4f(rgb, col.a);
  }`,
});
// #endregion effect
