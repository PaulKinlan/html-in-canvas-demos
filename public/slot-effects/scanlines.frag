// Loaded by effect="url(scanlines.frag)". One function, same contract as
// defineEffect(): p is CSS px from the slot's top-left, tex(p) samples it.
vec4 fx(vec2 p) {
  vec4 col = tex(p + vec2(sin(p.y * 0.35 + u_time * 5.0) * 1.5 * u_amount, 0.0));
  float line = 0.82 + 0.18 * sin(p.y * 3.14159 / 2.0);
  col.rgb *= line;
  return col;
}
