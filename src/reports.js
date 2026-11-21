// Crash and error reports from every copy of the site (production, the
// workers.dev host, each preview branch, localhost with `npm run dev`).
//
//   POST /api/reports           A batch of reports. Two senders:
//                               - the browser's Reporting API (Reporting-Endpoints
//                                 in public/_headers): crash, intervention,
//                                 deprecation and CSP reports, as
//                                 application/reports+json;
//                               - /shared/context-guard.js: lost contexts, script
//                                 errors, rejected promises, a tab that died, as
//                                 a text/plain beacon holding JSON.
//   GET  /api/reports           Recent reports as JSON. Query: origin, page,
//                               type, since (ms, or 90m / 6h / 2d), limit, q.
//   GET  /api/reports/summary   Counts by origin, page and type. Same filters.
//
// Stored in D1 (binding REPORTS), one row per report, keyed by the origin of
// the page that the report is about. A preview is a static copy with no
// Worker, so its pages post to the production host and the origin column is
// what keeps them apart. Rows older than 30 days are deleted.
//
// Reading is open: a row holds a page URL of this public site, a message and
// a user agent string. No address and no cookie is stored. Writing is limited
// to pages of this project (ALLOWED below), by size and by count.
//
// Read them with: npm run reports   (tools/reports/list.mjs)

const ALLOWED = /^(localhost|127\.0\.0\.1|([a-z0-9-]+\.)?html-in-canvas\.page|[a-z0-9-]*html-in-canvas-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)$/;
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 25;
const KEEP_DAYS = 30;
const PER_MINUTE = 120; // per sending address, counted in this isolate only

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 1), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
const cut = (value, n) => (value == null ? '' : String(value).slice(0, n));

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL, origin TEXT NOT NULL, page TEXT NOT NULL, type TEXT NOT NULL,
     source TEXT NOT NULL, message TEXT NOT NULL, body TEXT NOT NULL, ua TEXT NOT NULL, visit TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS reports_origin_at ON reports (origin, at)',
  'CREATE INDEX IF NOT EXISTS reports_at ON reports (at)',
];
let ready = null;
const prepare = (db) => (ready ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => { ready = null; throw err; }));

const hits = new Map();
function tooMany(request) {
  const who = request.headers.get('cf-connecting-ip') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const h = hits.get(who);
  if (!h || h.minute !== minute) { if (hits.size > 5000) hits.clear(); hits.set(who, { minute, n: 1 }); return false; }
  return ++h.n > PER_MINUTE;
}

// One stored row from one report of either sender, or null to drop it.
export function rowOf(report, now, fallbackUa) {
  if (!report || typeof report !== 'object') return null;
  let url;
  try { url = new URL(report.url); } catch { return null; }
  if (!ALLOWED.test(url.hostname)) return null;
  const body = report.body && typeof report.body === 'object' ? report.body : {};
  const type = cut(report.type, 40).replace(/[^a-z0-9-]/gi, '') || 'unknown';
  const age = Number.isFinite(report.age) ? Math.max(0, Math.min(report.age, 7 * 864e5)) : 0;
  // The Reporting API has no message field of its own: each type names it differently.
  const message = cut(
    report.message ?? body.message ?? body.reason ??
      (body.effectiveDirective ? `${body.effectiveDirective} blocked ${body.blockedURL ?? ''}` : null) ?? body.id ?? '',
    600,
  );
  return {
    at: Math.round(now - age),
    origin: url.origin,
    page: cut(url.pathname + (report.frame ? ' (frame)' : ''), 200),
    type,
    source: report.source === 'guard' ? 'guard' : 'browser',
    message,
    body: cut(JSON.stringify(body), 6000),
    ua: cut(report.user_agent ?? report.ua ?? fallbackUa, 300),
    visit: cut(report.visit, 40),
  };
}

function since(text, now) {
  const m = /^(\d+)\s*([mhd]?)$/.exec(text ?? '');
  if (!m) return now - 864e5;
  const n = Number(m[1]);
  return m[2] ? now - n * { m: 6e4, h: 36e5, d: 864e5 }[m[2]] : n;
}

function where(url, now) {
  const clauses = ['at >= ?'], args = [since(url.searchParams.get('since'), now)];
  for (const key of ['origin', 'page', 'type', 'source', 'visit']) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    // origin=preview matches every preview branch; a value with * is a pattern.
    if (key === 'origin' && v === 'preview') { clauses.push("origin LIKE '%-preview.%'"); continue; }
    if (v.includes('*')) { clauses.push(`${key} LIKE ?`); args.push(v.replaceAll('%', '').replaceAll('*', '%')); } else if (key === 'page') { clauses.push('(page = ? OR page = ?)'); args.push(v, `${v} (frame)`); } else { clauses.push(`${key} = ?`); args.push(v); }
  }
  const q = url.searchParams.get('q');
  if (q) { clauses.push('(message LIKE ? OR body LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  return { sql: clauses.join(' AND '), args };
}

export async function handleReports(request, env, ctx, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const db = env.REPORTS;
  if (!db) return json({ error: 'this deployment has no REPORTS database' }, 501);
  const now = Date.now();

  if (request.method === 'POST' && url.pathname === '/api/reports') {
    if (tooMany(request)) return new Response(null, { status: 429, headers: cors });
    const text = await request.text();
    if (text.length > MAX_BODY) return new Response(null, { status: 413, headers: cors });
    let list;
    try { list = JSON.parse(text); } catch { return new Response(null, { status: 400, headers: cors }); }
    if (!Array.isArray(list)) list = [list];
    const ua = request.headers.get('user-agent');
    const rows = list.slice(0, MAX_BATCH).map((r) => rowOf(r, now, ua)).filter(Boolean);
    if (rows.length) {
      await prepare(db);
      const insert = db.prepare('INSERT INTO reports (at, origin, page, type, source, message, body, ua, visit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const work = [db.batch(rows.map((r) => insert.bind(r.at, r.origin, r.page, r.type, r.source, r.message, r.body, r.ua, r.visit)))];
      if (Math.random() < 0.02) work.push(db.prepare('DELETE FROM reports WHERE at < ?').bind(now - KEEP_DAYS * 864e5).run());
      await Promise.all(work);
    }
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method === 'GET' && url.pathname === '/api/reports') {
    await prepare(db);
    const w = where(url, now);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 50, 500));
    const { results } = await db.prepare(`SELECT id, at, origin, page, type, source, message, body, ua, visit FROM reports WHERE ${w.sql} ORDER BY at DESC, id DESC LIMIT ?`).bind(...w.args, limit).all();
    for (const r of results) { try { r.body = JSON.parse(r.body); } catch {} }
    return json({ now, count: results.length, reports: results });
  }

  if (request.method === 'GET' && url.pathname === '/api/reports/summary') {
    await prepare(db);
    const w = where(url, now);
    const { results } = await db.prepare(`SELECT origin, page, type, COUNT(*) AS n, MAX(at) AS last, MAX(message) AS example FROM reports WHERE ${w.sql} GROUP BY origin, page, type ORDER BY last DESC LIMIT 500`).bind(...w.args).all();
    return json({ now, groups: results });
  }

  return json({ error: 'not found' }, 404);
}
