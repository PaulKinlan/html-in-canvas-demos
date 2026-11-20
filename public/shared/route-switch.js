// The "Drawn with" switch shared by the shader demos.
//
//   routeSwitch($('route'), {
//     targets: () => document.querySelectorAll('physical-ui'),   // the elements to steer
//     attr: 'backend',                                           // the attribute that names a route
//     values: { webgpu: 'webgpu', webgl: 'webgl' },              // what to write for each choice
//     active: (el) => el.backend,                                // 'webgpu' | 'webgl' | '2d' | …
//     note: (el) => el.gpuNote,                                  // why WebGPU is not in use
//   });
//
// "Best available" removes the attribute, so each element picks for itself:
// WebGPU when /shared/backend.js says it is usable, then WebGL, then 2D. The
// line under the switch says what is drawing right now and, when that is not
// WebGPU, why. `?route=webgl` in the address sets the switch on load.

const NAMES = { webgpu: 'WebGPU', webgl: 'WebGL', direct: 'WebGL', shared: 'WebGL (shared context)', gl: 'WebGL', '2d': '2D canvas', worker: 'a worker', starting: 'starting', plain: 'plain DOM' };
const LABELS = { '': 'Best available', webgpu: 'WebGPU', webgl: 'WebGL', '2d': '2D canvas only' };

export function routeSwitch(mount, { targets, attr = 'backend', values = { webgpu: 'webgpu', webgl: 'webgl' }, active = (el) => el.backend, note = (el) => el.gpuNote, apply, param = 'route' } = {}) {
  if (!mount) return null;
  const select = document.createElement('select');
  for (const key of ['', ...Object.keys(values)]) select.add(new Option(LABELS[key] ?? key, key));
  select.style.cssText = 'min-height:40px;font:inherit';
  const label = document.createElement('label');
  label.append('Drawn with ', select);
  const out = document.createElement('span');
  out.className = 'route-note';
  out.setAttribute('role', 'status');
  // Room for two lines, so the text arriving does not move the page.
  mount.style.cssText += ';display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;min-height:4.4em;font-size:14px';
  out.style.cssText = 'flex:1 1 260px;color:var(--muted)';
  mount.append(label, out);

  const all = () => [...(targets?.() ?? [])];
  const set = (choice) => {
    if (apply) return apply(choice);
    for (const el of all()) {
      if (choice) el.setAttribute(attr, values[choice]);
      else el.removeAttribute(attr);
    }
  };
  const asked = new URLSearchParams(location.search).get(param) ?? '';
  if (asked in values) {
    select.value = asked;
    set(asked);
  }
  select.onchange = () => {
    set(select.value);
    const url = new URL(location.href);
    if (select.value) url.searchParams.set(param, select.value);
    else url.searchParams.delete(param);
    history.replaceState(null, '', url);
    show();
  };

  let last = '';
  function show() {
    const els = all();
    const counts = new Map();
    let why = '';
    for (const el of els) {
      const name = NAMES[active(el)] ?? active(el) ?? 'not started';
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (active(el) !== 'webgpu') why ||= note(el) || '';
    }
    let text = '';
    if (counts.size === 1) text = `Drawn with ${[...counts.keys()][0]}.`;
    else if (counts.size) text = 'Drawn with ' + [...counts].map(([name, n]) => `${name} (${n})`).join(', ') + '.';
    if (why && select.value !== 'webgl' && select.value !== '2d') text += ` WebGPU is not in use: ${why.replace(/\.$/, '')}.`;
    if (text !== last) out.textContent = last = text;
  }
  show();
  const timer = setInterval(show, 500);
  return { select, show, stop: () => clearInterval(timer), get value() { return select.value; } };
}
