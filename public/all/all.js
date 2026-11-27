const filterEl = document.getElementById('all-filter');
const groupEl = document.getElementById('all-group');
const orderBtn = document.getElementById('all-order');
const countEl = document.getElementById('all-count');
const listEl = document.getElementById('all-list');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

let newestFirst = true;
let query = '';
let selectedGroup = 'all';

function formatDay(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'Earlier / undated';
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function getEntries() {
  const demos = (window.DEMOS || []).filter((d) => d.href && d.href !== '/all/' && d.href !== '/');
  const groupNames = new Map(window.DEMO_GROUPS || []);
  const indexed = demos.map((d, idx) => ({
    ...d,
    groupLabel: groupNames.get(d.group) || d.group || 'Other',
    added: d.added || '',
    orderIdx: idx,
  }));
  indexed.sort((a, b) => {
    const cmpDate = newestFirst
      ? b.added.localeCompare(a.added)
      : a.added.localeCompare(b.added);
    if (cmpDate !== 0) return cmpDate;
    return newestFirst ? b.orderIdx - a.orderIdx : a.orderIdx - b.orderIdx;
  });
  return indexed;
}

function populateGroups() {
  if (groupEl.options.length > 1) return;
  const groups = window.DEMO_GROUPS || [];
  const counts = new Map();
  for (const d of window.DEMOS || []) {
    if (d.href && d.href !== '/all/') counts.set(d.group, (counts.get(d.group) || 0) + 1);
  }
  for (const [key, label] of groups) {
    const n = counts.get(key) || 0;
    if (!n) continue;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${label} (${n})`;
    groupEl.appendChild(opt);
  }
}

function render() {
  const all = getEntries();
  const total = all.length;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = all.filter((d) => {
    if (selectedGroup !== 'all' && d.group !== selectedGroup) return false;
    if (!terms.length) return true;
    const hay = `${d.title} ${d.href} ${d.groupLabel} ${d.added} ${stripHtml(d.blurb)} ${(d.tags || []).join(' ')} ${(d.api || []).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  countEl.textContent = filtered.length === total
    ? `${total} demos sorted ${newestFirst ? 'newest first' : 'oldest first'}.`
    : `Showing ${filtered.length} of ${total} demos (${newestFirst ? 'newest first' : 'oldest first'}).`;

  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state">No demos match that filter. Clear the search box or switch back to all groups.</div>';
    return;
  }

  const byDay = new Map();
  for (const item of filtered) {
    const key = item.added || 'undated';
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }

  const parts = [];
  let rank = newestFirst ? filtered.length : 1;
  const step = newestFirst ? -1 : 1;

  for (const [day, items] of byDay) {
    const cards = items.map((item) => {
      const n = rank;
      rank += step;
      const tags = (item.tags || []).slice(0, 5)
        .map((t) => `<span class="entry-tag">${esc(t)}</span>`)
        .join('');
      return `<li class="entry">
        <div class="entry-meta">
          <span class="entry-num">#${n}</span>
          <span>${esc(item.added || 'undated')}</span>
          <span class="entry-group">${esc(item.groupLabel)}</span>
        </div>
        <h3 class="entry-title"><a href="${esc(item.href)}">${esc(item.title)}</a></h3>
        <div class="entry-path">${esc(item.href)}</div>
        ${item.blurb ? `<p class="entry-blurb">${item.blurb}</p>` : ''}
        ${tags ? `<div class="entry-tags">${tags}</div>` : ''}
      </li>`;
    }).join('');

    parts.push(`<section class="day-group">
      <div class="day-head">
        <h2>${esc(formatDay(day))}</h2>
        <span class="day-count">${items.length} ${items.length === 1 ? 'demo' : 'demos'}</span>
      </div>
      <ol class="day-items">${cards}</ol>
    </section>`);
  }

  listEl.innerHTML = parts.join('');
}

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  populateGroups();
  render();
}

filterEl.addEventListener('input', () => {
  query = filterEl.value;
  render();
});

groupEl.addEventListener('change', () => {
  selectedGroup = groupEl.value || 'all';
  render();
});

orderBtn.addEventListener('click', () => {
  newestFirst = !newestFirst;
  orderBtn.textContent = newestFirst ? 'Newest first' : 'Oldest first';
  orderBtn.setAttribute('aria-pressed', String(newestFirst));
  render();
});

if (window.DEMOS) boot();
else {
  const pagesScript = document.querySelector('script[src$="pages.js"]');
  if (pagesScript) pagesScript.addEventListener('load', boot, { once: true });
  window.addEventListener('load', boot, { once: true });
}
