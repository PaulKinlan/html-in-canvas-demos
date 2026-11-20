// Server side of the cross-context demos (/tear-off/, /remote/, /embed/, /support/).
//
//   GET  /api/x/room/<id>   WebSocket. A Durable Object per room relays messages
//                           between everyone in it: WebRTC signalling, and the
//                           frames themselves when WebRTC can't connect.
//   GET  /api/x/ice         ICE servers for RTCPeerConnection. STUN always; TURN
//                           (Cloudflare Realtime, credentials that last an hour)
//                           if TURN_KEY_ID and TURN_KEY_API_TOKEN secrets are set.
//   POST /api/x/vision      A frame of shared DOM plus a question, answered by a
//                           vision model on Workers AI (binding: AI).
//   GET  /api/x/status      Which of the above this deployment can do.

const MAX_PEERS = 8;
const MAX_TEXT = 64 * 1024; // signalling and input messages
const MAX_BINARY = 400 * 1024; // one relayed frame
// Tried in order. Checked against a real shared frame on 2026-11-20: Mistral
// Small answered in about a second, Llama 4 Scout in about twelve.
const VISION_MODELS = ['@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/meta/llama-4-scout-17b-16e-instruct'];
const VISION_PER_DAY = 60; // per IP
const VISION_MAX_IMAGE = 700 * 1024; // base64 characters

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(init.request), ...(init.headers ?? {}) },
  });

// Who may call the API from a browser: pages served by this same deployment,
// whatever host it is reached on (workers.dev, a custom domain, a preview),
// the sibling Workers (…-demos and …-remote), the custom domain and its
// subdomains, and localhost.
const SITES = /^(html-in-canvas-(demos|remote)\.[a-z0-9-]+\.workers\.dev|([a-z0-9-]+\.)?html-in-canvas\.page)$/;
function allowedOrigin(origin, request) {
  if (!origin) return false;
  try {
    const { hostname, host } = new URL(origin);
    if (request && host === new URL(request.url).host) return true;
    return hostname === 'localhost' || hostname === '127.0.0.1' || SITES.test(hostname);
  } catch {
    return false;
  }
}
function corsHeaders(request) {
  const origin = request?.headers.get('origin');
  return allowedOrigin(origin, request) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
}

export async function handleCrossContextApi(request, env, ctx, url) {
  const path = url.pathname.slice('/api/x/'.length);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' } });
  }

  if (path === 'status') {
    return json({ rooms: !!env.ROOMS, ai: !!env.AI, turn: !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN), models: VISION_MODELS }, { request });
  }

  if (path.startsWith('room/')) {
    const id = path.slice(5);
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return json({ error: 'bad room id' }, { status: 400, request });
    if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'expected a WebSocket' }, { status: 426, request });
    // Browsers always send Origin on WebSocket handshakes, and CORS does not
    // apply to them, so check it here.
    if (!allowedOrigin(request.headers.get('origin'), request)) return json({ error: 'origin not allowed' }, { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName('room:' + id)).fetch(request);
  }

  if (path === 'ice') {
    // TURN credentials cost money to use, so only our own pages get them:
    // a same-origin fetch (no Origin header on a GET) or an allowed origin.
    const origin = request.headers.get('origin');
    const ours = origin ? allowedOrigin(origin, request) : request.headers.get('sec-fetch-site') === 'same-origin';
    return json(await iceServers(env, ours), { request });
  }

  if (path === 'vision' && request.method === 'POST') {
    if (!allowedOrigin(request.headers.get('origin'), request)) return json({ error: 'origin not allowed' }, { status: 403 });
    return vision(request, env);
  }

  return json({ error: 'not found' }, { status: 404, request });
}

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

async function iceServers(env, ours) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { iceServers: STUN, turn: false, note: 'This deployment has no TURN key' };
  if (!ours) return { iceServers: STUN, turn: false, note: 'TURN is only handed to this site\'s own pages' };
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 3600 }),
    });
    if (!res.ok) return { iceServers: STUN, turn: false, note: `The TURN service refused the key (HTTP ${res.status})` };
    const data = await res.json();
    const list = (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers])
      // Browsers refuse to connect to port 53, and wait for it to time out first.
      .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    const turn = list.some((s) => s.urls.some((u) => u.startsWith('turn')));
    return { iceServers: [...list, { urls: 'stun:stun.l.google.com:19302' }], turn, note: turn ? '' : 'The TURN service answered without TURN servers' };
  } catch (err) {
    return { iceServers: STUN, turn: false, note: `The TURN service could not be reached (${String(err?.message ?? err).slice(0, 120)})` };
  }
}

const SYSTEM = `You are a support assistant looking at a live picture of ONE region of the user's web page. The user chose to share that region with you; you cannot see the rest of their screen.
You are also given a list of the interactive elements in that region, read from the real DOM: each has an id, a role, a name and sometimes a value. Black bars in the picture and "[redacted]" values are things the page marked private; never ask for them.
Answer briefly and concretely, in plain text, about what is actually visible.
You may end your answer with at most three action lines, each on its own line, using ids from the list:
POINT <id>            to highlight an element for the user
CLICK <id>            to propose clicking it
FILL <id> <text>      to propose typing text into it
The user must approve CLICK and FILL before anything happens. Only propose an action when it helps answer the question.`;

async function vision(request, env) {
  if (!env.AI) return json({ error: 'This deployment has no Workers AI binding (AI).' }, { status: 501, request });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, { status: 400, request });
  }
  const { image, question, elements = [], history = [] } = body ?? {};
  if (typeof question !== 'string' || !question.trim() || question.length > 1000) return json({ error: 'question must be 1 to 1000 characters' }, { status: 400, request });
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return json({ error: 'image must be a base64 data URL' }, { status: 400, request });
  if (image.length > VISION_MAX_IMAGE) return json({ error: 'image too large' }, { status: 413, request });

  // Daily allowance per client, counted in a Durable Object.
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const gate = await env.ROOMS.get(env.ROOMS.idFromName('quota:' + ip)).fetch('https://quota/hit?limit=' + VISION_PER_DAY);
  const quota = await gate.json();
  if (!quota.ok) return json({ error: `Daily limit of ${VISION_PER_DAY} questions reached. Try again tomorrow.` }, { status: 429, request });

  const list = (Array.isArray(elements) ? elements : [])
    .slice(0, 60)
    .map((e) => `${clip(e.id, 12)} | ${clip(e.role, 20)} | ${clip(e.name, 80)}${e.value != null && e.value !== '' ? ' | value: ' + clip(e.value, 80) : ''}`)
    .join('\n');
  const turns = (Array.isArray(history) ? history : [])
    .slice(-6)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: clip(m.content, 1500) }));
  const messages = [
    { role: 'system', content: `${SYSTEM}\nToday is ${new Date().toISOString().slice(0, 10)}.` },
    ...turns,
    {
      role: 'user',
      content: [
        { type: 'text', text: `Interactive elements (id | role | name | value):\n${list || '(none)'}\n\nQuestion: ${question.trim()}` },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];

  const errors = [];
  for (const model of VISION_MODELS) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: 500, temperature: 0.2 });
      const answer = out?.choices?.[0]?.message?.content ?? out?.response;
      if (typeof answer === 'string' && answer.trim()) return json({ answer: answer.trim(), model, remaining: quota.remaining }, { request });
      errors.push(`${model}: empty answer`);
    } catch (err) {
      errors.push(`${model}: ${String(err?.message ?? err).slice(0, 200)}`);
    }
  }
  return json({ error: 'No vision model answered.', detail: errors }, { status: 502, request });
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);

// One Durable Object class, two uses: a relay room, and a per-client counter.
// Rooms use WebSocket hibernation, so an idle room costs nothing.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/hit') return this.#hit(Number(url.searchParams.get('limit')) || 1);

    const peers = this.ctx.getWebSockets();
    if (peers.length >= MAX_PEERS) return new Response(JSON.stringify({ error: 'room is full' }), { status: 409 });
    const role = (url.searchParams.get('role') ?? 'peer').slice(0, 16).replace(/[^a-z]/g, '');
    const id = crypto.randomUUID().slice(0, 8);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, role });
    server.send(JSON.stringify({ t: 'welcome', id, peers: peers.map((p) => p.deserializeAttachment()).filter(Boolean) }));
    this.#broadcast(server, JSON.stringify({ t: 'join', from: id, role }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const me = ws.deserializeAttachment();
    if (typeof message === 'string') {
      if (message.length > MAX_TEXT) return;
      let data;
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      data.from = me.id;
      const out = JSON.stringify(data);
      if (typeof data.to === 'string') {
        for (const peer of this.ctx.getWebSockets()) {
          if (peer.deserializeAttachment()?.id === data.to) send(peer, out);
        }
      } else {
        this.#broadcast(ws, out);
      }
    } else {
      // Binary: a relayed frame. Goes to everyone else; viewers that are
      // getting video over WebRTC never ask for these, so none are sent.
      if (message.byteLength > MAX_BINARY) return;
      this.#broadcast(ws, message);
    }
  }

  webSocketClose(ws) {
    this.#left(ws);
  }
  webSocketError(ws) {
    this.#left(ws);
  }

  #left(ws) {
    const me = ws.deserializeAttachment();
    try {
      ws.close();
    } catch {}
    if (me) this.#broadcast(ws, JSON.stringify({ t: 'leave', from: me.id }));
  }

  #broadcast(except, message) {
    for (const peer of this.ctx.getWebSockets()) if (peer !== except) send(peer, message);
  }

  async #hit(limit) {
    const day = new Date().toISOString().slice(0, 10);
    const state = (await this.ctx.storage.get('quota')) ?? { day, n: 0 };
    if (state.day !== day) Object.assign(state, { day, n: 0 });
    if (state.n >= limit) return Response.json({ ok: false, remaining: 0 });
    state.n++;
    await this.ctx.storage.put('quota', state);
    return Response.json({ ok: true, remaining: limit - state.n });
  }
}

function send(ws, message) {
  try {
    ws.send(message);
  } catch {}
}
