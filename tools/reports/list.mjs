#!/usr/bin/env node
// Lists the crash and error reports that the site has stored (src/reports.js).
// Run it after a demo on the phone and before replying about a page: the
// reports say what was lost, what threw and which tab died, with the user
// agent, for production and for each preview branch separately.
//
//   npm run reports                                 the last 24 hours, every origin, grouped
//   npm run reports -- --since 2h                   the last two hours (90m, 6h, 3d, or a time in ms)
//   npm run reports -- --origin preview             every preview branch
//   npm run reports -- --origin project-thread-5xa7g6   one branch: any part of the host name
//   npm run reports -- --origin production          https://html-in-canvas.page
//   npm run reports -- --page /hdr-glow/            one page
//   npm run reports -- --type crash                 one type: crash (the browser's own report of a dead tab),
//                                                   tab-died, context-lost, draw-stopped, error,
//                                                   unhandledrejection, intervention, deprecation,
//                                                   csp-violation, over-budget, timed-readback,
//                                                   snapshots-open, trial
//   npm run reports -- --q getImageData             text in the message or the body
//   npm run reports -- --list                       every report with its body, newest first (--limit 50)
//   npm run reports -- --json                       the raw answer
//   npm run reports -- --from http://localhost:8787 another deployment (`npm run dev`)
//
// The same data is at https://html-in-canvas.page/api/reports?since=2h&page=/hdr-glow/
// and /api/reports/summary. Exit code 0 always: an empty list is an answer.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] ?? ''; };
const has = (name) => args.includes(`--${name}`);

const from = opt('from', process.env.REPORTS_URL || 'https://html-in-canvas.page').replace(/\/$/, '');
const list = has('list') || has('json') && !has('summary');
const query = new URLSearchParams();
let origin = opt('origin');
if (origin === 'production') origin = 'https://html-in-canvas.page';
else if (origin && origin !== 'preview' && !origin.startsWith('http')) origin = `*${origin.toLowerCase().replace(/^claude[-/]/, '').replace(/[^a-z0-9]+/g, '-')}*`;
if (origin) query.set('origin', origin);
for (const key of ['page', 'type', 'since', 'q', 'visit', 'source']) if (opt(key)) query.set(key, opt(key));
if (list) query.set('limit', opt('limit', '50'));
const url = `${from}/api/reports${list ? '' : '/summary'}?${query}`;

// fetch() in Node does not use the proxy that some containers need; curl does.
async function get(target) {
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (first) {
    try { return JSON.parse(execFileSync('curl', ['-sS', '--fail', '--max-time', '20', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (second) { throw new Error(`could not read ${target}: ${first.message}; curl: ${String(second.stderr || second.message).trim().split('\n').pop()}`); }
  }
}

let data;
try { data = await get(url); } catch (err) { console.error(err.message); process.exit(0); }
if (has('json')) { console.log(JSON.stringify(data, null, 1)); process.exit(0); }

const ago = (at) => { const s = Math.max(0, (data.now - at) / 1000); return s < 90 ? `${s.toFixed(0)} s ago` : s < 5400 ? `${(s / 60).toFixed(0)} min ago` : s < 172800 ? `${(s / 3600).toFixed(1)} h ago` : `${(s / 86400).toFixed(1)} d ago`; };
const host = (o) => o.replace(/^https?:\/\//, '').replace(/-html-in-canvas-preview\..*$/, ' (preview)');
const browser = (ua) => (/Android/.test(ua) ? 'Android ' : /Mobile/.test(ua) ? 'mobile ' : '') + ((/(Chrome|Firefox|Version)\/(\d+)/.exec(ua) || []).slice(1).join(' ') || ua.slice(0, 40));

if (list) {
  if (!data.reports.length) console.log('No reports match.');
  for (const r of data.reports) {
    console.log(`${ago(r.at).padEnd(11)} ${r.type.padEnd(18)} ${host(r.origin)}${r.page}  [${browser(r.ua)}${r.source === 'browser' ? ', sent by the browser' : ''}${r.visit ? `, visit ${r.visit}` : ''}]`);
    if (r.message) console.log(`            ${r.message}`);
    const body = typeof r.body === 'object' ? r.body : {};
    for (const [k, v] of Object.entries(body)) if (k !== 'message' && v !== '' && v != null && !(Array.isArray(v) && !v.length)) console.log(`            ${k}: ${typeof v === 'string' ? v.replace(/\n/g, '\n              ') : JSON.stringify(v)}`);
  }
} else {
  if (!data.groups.length) console.log('No reports match.');
  let last = '';
  for (const g of data.groups.sort((a, b) => a.origin.localeCompare(b.origin) || b.last - a.last)) {
    if (g.origin !== last) console.log(`\n${host(g.origin)}`);
    last = g.origin;
    console.log(`  ${String(g.n).padStart(4)} × ${g.type.padEnd(18)} ${g.page.padEnd(28)} last ${ago(g.last)}${g.example ? `  ${g.example.slice(0, 90)}` : ''}`);
  }
  console.log(`\nAdd --list for each report with its detail. Source: ${url}`);
}
