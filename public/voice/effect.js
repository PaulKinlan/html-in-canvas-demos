// The "voice" effect for the fx attribute: sound bends the panel, and a press
// sends a ring through it.
//
//   --fx-amount     sound level, 0..1: how far the surface is bent
//   --fx-progress   1 while listening: a band of light crosses the panel
//   surface.poke(x, y) starts a ring at a point (the library's u_clicks)
//
// GLSL for WebGL and WGSL for WebGPU.

import { defineEffect } from '/lib/shader-fx.js';

// #region effect
defineEffect('voice', {
  animated: true,
  glsl: `vec4 fx(vec2 p) {
    // Two crossing waves, scaled by the sound level.
    vec2 d = vec2(sin(p.y * 0.05 + u_time * 6.0), cos(p.x * 0.043 + u_time * 5.0)) * 6.0 * u_amount;
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 c = u_clicks[i];
      if (c.z < 0.0 || c.z > 2.0) continue;
      vec2 v = p - c.xy;
      float r = length(v), front = c.z * 420.0;
      float w = exp(-pow((r - front) / 30.0, 2.0)) * exp(-c.z * 1.6);
      d += normalize(v + 1e-4) * sin((r - front) * 0.22) * w * 18.0;
      ring += w;
    }
    vec4 col = tex(p - d);
    // The ring is lit in amber; the listening band in cyan.
    col.rgb += col.a * ring * vec3(1.0, 0.72, 0.25) * 0.55;
    float band = exp(-pow((p.x - fract(u_time * 0.35) * (u_size.x + 240.0) + 120.0) / 60.0, 2.0));
    col.rgb += col.a * band * u_progress * vec3(0.25, 0.75, 1.0) * 0.35;
    return col;
  }`,
  wgsl: `fn fx(p: vec2f) -> vec4f {
    var d = vec2f(sin(p.y * 0.05 + u.time * 6.0), cos(p.x * 0.043 + u.time * 5.0)) * 6.0 * u.amount;
    var ring = 0.0;
    for (var i = 0; i < 4; i++) {
      let c = u.clicks[i];
      if (c.z < 0.0 || c.z > 2.0) { continue; }
      let v = p - c.xy;
      let r = length(v); let front = c.z * 420.0;
      let w = exp(-pow((r - front) / 30.0, 2.0)) * exp(-c.z * 1.6);
      d += normalize(v + 1e-4) * sin((r - front) * 0.22) * w * 18.0;
      ring += w;
    }
    let col = tex(p - d);
    var rgb = col.rgb + col.a * ring * vec3f(1.0, 0.72, 0.25) * 0.55;
    let band = exp(-pow((p.x - fract(u.time * 0.35) * (u.size.x + 240.0) + 120.0) / 60.0, 2.0));
    rgb += col.a * band * u.progress * vec3f(0.25, 0.75, 1.0) * 0.35;
    return vec4f(rgb, col.a);
  }`,
});
// #endregion effect
