#!/usr/bin/env node
// Builds the plan for combining recent web platform features with HTML-in-canvas.
//
//   npm run build:plan            writes public/chrome-apis/data.js and docs/chrome-apis-plan.md
//   npm run build:plan -- --fetch downloads the feature lists from chromestatus.com first
//
// Inputs, all in this folder:
//   features.json  features for Chrome 130 to 160 from the chromestatus.com API (a cache)
//   ideas.json     hand-written: for a feature id, how well it fits (1 to 3), the idea, planned demos, pages to see
//   demos.json     hand-written: the planned demos, in rank order. When a demo is built, add
//                  "built": "/its-page/" to its entry and run this script again.
// and public/chrome-apis/probes-recorded.json from `npm run record:probes`.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const FIRST = 130, LAST = 160;

// ---------------------------------------------------------------- fetch
if (process.argv.includes('--fetch')) {
  const byId = new Map();
  for (let m = FIRST; m <= LAST; m++) {
    const res = await fetch(`https://chromestatus.com/api/v0/features?milestone=${m}`);
    const text = await res.text();
    const data = JSON.parse(text.replace(/^\)\]\}'\n?/, '')); // the API prefixes its JSON with )]}'
    for (const [stage, list] of Object.entries(data.features_by_type)) {
      for (const f of list) {
        const e = byId.get(f.id) ?? { id: f.id, name: f.name.trim(), summary: f.summary.replace(/\s+/g, ' ').trim().slice(0, 420), component: f.blink_components?.[0] ?? '?', stages: {} };
        (e.stages[stage] ??= []).push(m);
        byId.set(f.id, e);
      }
    }
    console.log(`Chrome ${m}: ${byId.size} features so far`);
  }
  const features = [...byId.values()].sort((a, b) => a.id - b.id);
  await writeFile(path.join(here, 'features.json'), JSON.stringify({ source: 'https://chromestatus.com/api/v0/features?milestone=N', milestones: [FIRST, LAST], fetched: new Date().toISOString().slice(0, 10), features }, null, 0) + '\n');
}

const cache = await json(path.join(here, 'features.json'));
const ideas = await json(path.join(here, 'ideas.json'));
const demos = await json(path.join(here, 'demos.json'));
const recorded = await json(path.join(repo, 'public/chrome-apis/probes-recorded.json')).catch(() => null);

// ---------------------------------------------------------------- areas
// [name, test on the Blink component, why features here with no idea have none]
const AREAS = [
  ['Built-in AI and agents', /AI|WebMCP|WebML/, 'No drawing interaction found.'],
  ['Canvas, colour and images', /Canvas|Blink>Image|JPEG XL|Compositing/, 'No drawing interaction found.'],
  ['CSS: values, selectors, shapes and paint', /^Blink>CSS/, 'Changes to parsing, the CSSOM or the cascade. A drawn element is styled like any other, so nothing is specific to a canvas.'],
  ['Layout, text and fonts', /Layout|Fonts|WritingMode|MathML/, 'Layout and text changes apply inside a drawable element as they do anywhere else.'],
  ['Scrolling and animation', /Scroll|Animation/, 'Behaviour fixes with no canvas-specific effect.'],
  ['View transitions and navigation', /ViewTransitions|History|UI>Browser>Navigation/, 'Covered by the view transitions page, or no canvas-specific effect.'],
  ['Shadow DOM and custom elements', /ShadowDOM|CustomElements/, 'No canvas-specific effect.'],
  ['Editing, selection and clipboard', /Editing|DataTransfer/, 'Platform-specific fixes with no canvas-specific effect.'],
  ['Input, focus and sensors', /Blink>Input|Gamepad|HTML>Focus|Vibration|Sensor/, 'Event-model fixes that drawn elements inherit.'],
  ['DOM and HTML', /^Blink>DOM|^Blink>HTML|^Blink>Forms|^Blink>XML/, 'Parser, serialisation or corner-case changes that do not affect drawing.'],
  ['WebGPU and WebGL', /WebGPU|WebGL/, 'No element-texture use found.'],
  ['WebXR', /WebXR/, 'No panel use found.'],
  ['Media, capture, audio and speech', /Media|WebRTC|GetDisplayMedia|WebAudio|Speech|AudioOutput|GetUserMedia|CameraCapture/, 'Codec, negotiation or statistics changes below the level where a drawn element is involved.'],
  ['SVG', /SVG/, 'SVG is drawn as part of an element picture like other content.'],
  ['Accessibility', /Accessibility/, 'See the accessibility audit page.'],
  ['Devices and hardware', /Serial|Blink>HID|Bluetooth|Foldable|SmartCard|Direct Sockets/, 'Device access with no display path.'],
  ['Windows, installed apps and permission elements', /AppManifest|WebAppInstalls|WindowDialog|Notifications|Permissions>Prompts|PermissionElement|ControlledFrame|Content>WebApps|WebAPKs|Fullscreen/, 'Install and manifest behaviour, outside the page.'],
  ['Performance and scheduling', /PerformanceAPIs|Scheduling|DevTools/, 'Reporting changes with no canvas-specific entry.'],
  ['JavaScript and WebAssembly', /JavaScript/, 'Language features. Useful in any code, with no link to drawing.'],
  ['Workers, storage and files', /Workers|ServiceWorker|Storage|BackgroundFetch|PushAPI/, 'Storage and worker lifecycle, away from rendering.'],
  ['Network and loading', /Network|Loader|Preload/, 'Transport and loading below the page. Nothing to draw.'],
  ['Security, privacy, identity, payments and ads', /./, 'These features run in browser UI or below the page: sign-in sheets, payment sheets, headers, policies and ad auctions. A canvas does not draw them and should not be able to.'],
];
const DOM_AREA = AREAS.findIndex(([name]) => name === 'DOM and HTML');
// The bare component "Blink" holds a mix. Its features that have an idea are page features.
const areaOf = (component, hasIdea) => (component === 'Blink' && hasIdea ? DOM_AREA : AREAS.findIndex(([, re]) => re.test(component.replace(/\s/g, ''))));

const STAGES = [
  ['Enabled by default', 'shipped'],
  ['Stepped rollout', 'rollout'],
  ['Origin trial', 'origin trial'],
  ['In developer trial (Behind a flag)', 'developer trial'],
  ['Deprecated', 'deprecated'],
  ['Removed', 'removed'],
];

// ---------------------------------------------------------------- join
const probesByFeature = new Map();
const mainRun = recorded?.runs?.[0];
for (const r of mainRun?.results ?? []) for (const id of r.features) (probesByFeature.get(id) ?? probesByFeature.set(id, []).get(id)).push(r.id);

const demoKeys = new Set(demos.map((d) => d.key));
const features = cache.features.map((f) => {
  const [stageKey, stage] = STAGES.find(([k]) => f.stages[k]);
  const idea = ideas[f.id];
  for (const d of idea?.demos ?? []) if (!demoKeys.has(d)) throw new Error(`ideas.json: unknown demo "${d}" on ${f.name}`);
  return {
    id: f.id, name: f.name, summary: f.summary, area: areaOf(f.component, !!idea), component: f.component,
    milestone: Math.min(...f.stages[stageKey]), stage,
    fit: stage === 'deprecated' || stage === 'removed' ? 0 : idea?.fit ?? 0,
    idea: idea?.idea ?? '', demos: idea?.demos ?? [], see: idea?.see ?? [], probes: probesByFeature.get(f.id) ?? [],
  };
});
for (const id of Object.keys(ideas)) if (!cache.features.some((f) => String(f.id) === id)) throw new Error(`ideas.json: ${id} (${ideas[id].name}) is not in features.json`);

features.sort((a, b) => a.area - b.area || b.fit - a.fit || a.milestone - b.milestone || a.name.localeCompare(b.name));
const live = features.filter((f) => f.stage !== 'deprecated' && f.stage !== 'removed');
const counts = {
  total: features.length,
  shipped: features.filter((f) => f.stage === 'shipped' || f.stage === 'rollout').length,
  trials: features.filter((f) => f.stage === 'origin trial' || f.stage === 'developer trial').length,
  gone: features.length - live.length,
  withIdea: features.filter((f) => f.fit > 0).length,
  direct: features.filter((f) => f.fit === 3).length,
  measured: features.filter((f) => f.probes.length).length,
};

// ---------------------------------------------------------------- data.js
await mkdir(path.join(repo, 'public/chrome-apis'), { recursive: true });
const data = {
  fetched: cache.fetched, milestones: cache.milestones, counts,
  areas: AREAS.map(([name, , none]) => ({ name, none })),
  demos,
  probes: recorded,
  features: features.map((f) => ({ id: String(f.id), n: f.name, s: f.summary.slice(0, 240), a: f.area, m: f.milestone, st: f.stage, f: f.fit, i: f.idea, d: f.demos, see: f.see, p: f.probes })),
};
await writeFile(path.join(repo, 'public/chrome-apis/data.js'), `// Generated by tools/chrome-apis/build.mjs. Edit ideas.json or demos.json there, then run npm run build:plan.\nwindow.CHROME_APIS = ${JSON.stringify(data)};\n`);

// ---------------------------------------------------------------- markdown
const link = (f) => `[${f.name.replace(/\|/g, '\\|').replace(/</g, '&lt;')}](https://chromestatus.com/feature/${f.id})`;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/\n/g, ' ');
const stageNote = (f) => (f.stage === 'shipped' ? `${f.milestone}` : `${f.milestone} (${f.stage})`);
const demoTitle = Object.fromEntries(demos.map((d, i) => [d.key, `${i + 1}`]));
const TIERS = [
  ['next', 'Build next', 'These run in Chrome 157 to 159 today, and most have a measured result behind them.'],
  ['then', 'Then', 'These depend on a model, a trial, a newer Chrome or a larger build.'],
  ['hardware', 'Needs hardware the test browser does not have', 'A headset, a foldable, a real GPU, a peripheral or an installed app.'],
];

let md = `# New platform features and HTML-in-canvas: a plan

This document lists every feature that chromestatus.com records for Chrome ${FIRST} to ${LAST}, says where each one could be combined with the HTML-in-canvas API (\`<canvas content="drawable">\`, \`drawElementImage()\`, \`texElementSubImage2D()\`, \`GPUQueue.drawElementImageToTexture()\`), and plans demos from the combinations.

The same content is on the site at [/chrome-apis/](https://html-in-canvas.page/chrome-apis/), with filters. This file is generated: edit \`tools/chrome-apis/ideas.json\` and \`tools/chrome-apis/demos.json\`, then run \`npm run build:plan\`.

## Method

- Source: \`https://chromestatus.com/api/v0/features?milestone=N\` for N = ${FIRST} to ${LAST}, fetched ${cache.fetched}. Chrome 159 is stable and 160 is beta on that date.
- ${counts.total} features: ${counts.shipped} enabled by default or rolling out, ${counts.trials} in an origin trial or developer trial, ${counts.gone} deprecated or removed.
- ${counts.withIdea} features have an idea below. ${counts.direct} are rated 3 (the feature changes what a canvas draws, or gives a drawn element a new input or output), the rest 2 (useful in a demo) or 1 (a small note).
- "Measured" means a probe on [/chrome-apis/probes.html](https://html-in-canvas.page/chrome-apis/probes.html) drew an element with the feature and read the result back. ${counts.measured} features have a probe. Everything else is inferred from the feature's description.
- Probes ran in two headless Chromium builds: ${(recorded?.runs ?? []).map((r) => r.browser).join('; and ')}. The phone used for testing this site runs Chrome 159, which neither build matches exactly.

## What the probes found

`;
if (recorded) {
  const [a, b] = recorded.runs;
  const bById = new Map((b?.results ?? []).map((r) => [r.id, r]));
  md += `| Probe | ${a.browser} | ${b ? b.browser : ''} | Detail (first build) |\n|---|---|---|---|\n`;
  for (const r of a.results) md += `| ${cell(r.title)} | ${r.status} | ${bById.get(r.id)?.status ?? ''} | ${cell(r.detail)} |\n`;
  const diff = a.results.filter((r) => bById.get(r.id) && bById.get(r.id).status !== r.status);
  md += `\nResults that differ between the builds: ${diff.map((r) => `${r.id} (${r.status} against ${bById.get(r.id).status})`).join(', ') || 'none'}.\n`;
  md += `\nStatus words: *works* means the feature takes effect on the drawn element; *fails* means the browser has the feature and it does not carry into the canvas; *unsupported* means the build lacks the feature; *info* is a measurement with no pass or fail.\n`;
}

md += `\n## Planned demos\n\nRanked. Each demo lists what it shows, how it would be built, what was measured, what is uncertain and the features it uses.\n`;
let n = 0;
for (const [tier, title, note] of TIERS) {
  md += `\n### ${title}\n\n${note}\n`;
  for (const d of demos.filter((x) => x.tier === tier)) {
    n = demos.indexOf(d) + 1;
    const used = features.filter((f) => f.demos.includes(d.key)).sort((x, y) => y.fit - x.fit || x.milestone - y.milestone);
    md += `\n#### ${n}. ${d.title}\n\n`;
    if (d.built) md += `- **Built:** [${d.built}](https://html-in-canvas.page${d.built})\n`;
    md += `- **Shows:** ${d.shows}\n- **Build:** ${d.build}\n`;
    if (d.measured) md += `- **Measured:** ${d.measured}\n`;
    md += `- **Uncertain:** ${d.uncertain}\n`;
    if (d.needs) md += `- **Needs:** ${d.needs}\n`;
    if (d.pages.length) md += `- **Builds on:** ${d.pages.map((p) => `[${p}](https://html-in-canvas.page${p})`).join(', ')}\n`;
    md += `- **Features (${used.length}):** ${used.map((f) => `${link(f)} (${stageNote(f)})`).join(', ')}\n`;
  }
}

md += `\n## Features by area\n\nThe Chrome column is the first milestone in which the feature is enabled by default, or the first milestone of its trial. The Demo column gives the number of the planned demo above.\n`;
AREAS.forEach(([name, , none], i) => {
  const all = features.filter((f) => f.area === i);
  if (!all.length) return;
  const some = all.filter((f) => f.fit > 0), rest = all.filter((f) => f.fit === 0);
  md += `\n### ${name}\n\n${all.length} features, ${some.length} with an idea.\n`;
  if (some.length) {
    md += `\n| Chrome | Feature | Fit | Idea | Demo |\n|---|---|---|---|---|\n`;
    for (const f of some) {
      const notes = [f.probes.length ? '**Measured.**' : '', cell(f.idea), f.see.length ? `See ${f.see.map((p) => `[${p}](https://html-in-canvas.page${p})`).join(', ')}.` : ''].filter(Boolean).join(' ');
      md += `| ${stageNote(f)} | ${link(f)} | ${f.fit} | ${notes} | ${f.demos.map((k) => demoTitle[k]).join(', ')} |\n`;
    }
  }
  if (rest.length) md += `\nNo combination planned (${rest.length}). ${none}\n\n${rest.map((f) => `${link(f)} (${stageNote(f)})`).join(' · ')}\n`;
});

await mkdir(path.join(repo, 'docs'), { recursive: true });
await writeFile(path.join(repo, 'docs/chrome-apis-plan.md'), md);
console.log(`${counts.total} features, ${counts.withIdea} with an idea (${counts.direct} rated 3), ${counts.measured} measured, ${demos.length} demos.`);
console.log('Wrote public/chrome-apis/data.js and docs/chrome-apis-plan.md');
