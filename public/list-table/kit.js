// Small colour helpers shared by the demos on /list-table/.

// '#rgb' or '#rrggbb' with an alpha, as a colour a canvas gradient accepts.
export function rgba(hex, alpha) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return `rgba(128,128,128,${alpha})`;
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// True when a '#rrggbb' background is dark, so a light should brighten and not tint.
export function isDark(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
  const n = parseInt(h, 16);
  return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 128;
}
