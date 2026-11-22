// live-link.js: get a live surface to another device.
//
//   const session = await shareInRoom(surface, 'k3p9x2');     // page with the DOM
//   const session = await watchRoom(liveView, 'k3p9x2');      // phone, other browser…
//
// A "room" is a relay everyone in a session joins. It carries WebRTC
// signalling, then gets out of the way: video goes peer to peer on a
// MediaStreamTrack and input comes back on an RTCDataChannel. If WebRTC
// can't connect (strict NAT, no TURN), frames fall back to JPEGs relayed
// through the room.
//
// Two kinds of room:
//   'ws'  /api/x/room/<id> on the Worker (a Durable Object). Any device.
//   'bc'  BroadcastChannel. Same browser, same origin, no server at all.

let apiBase = new URL('/api/x/', import.meta.url);
/** Point rooms at another deployment's Worker (a viewer on a different origin must use the source's). */
export function setApiOrigin(origin) {
  apiBase = new URL('/api/x/', origin);
  icePromise = undefined;
}

/** Join a room. kind: 'ws' | 'bc' | 'auto' (ws, falling back to bc). */
export async function joinRoom(room, { role = 'peer', kind = 'auto' } = {}) {
  if (kind !== 'bc') {
    try {
      return await joinWs(room, role);
    } catch (err) {
      const why = await whyNoRoom(err);
      if (kind === 'ws') throw new Error(why);
      const signal = joinBc(room, role);
      // Without the server only tabs of this browser can meet. Say so, and why.
      signal.fallback = why;
      return signal;
    }
  }
  return joinBc(room, role);
}

// Events that fire before anyone listens are kept and delivered to the first
// listener, so a caller can await other things before attaching handlers.
function emitter() {
  const handlers = {};
  const early = {};
  return {
    on(type, fn) {
      (handlers[type] ??= []).push(fn);
      for (const args of early[type]?.splice(0) ?? []) fn(...args);
      return this;
    },
    emit(type, ...args) {
      if (!handlers[type]?.length) return void (early[type] ??= []).push(args);
      for (const fn of handlers[type]) fn(...args);
    },
  };
}

// A failed WebSocket handshake tells a page nothing, so ask the API over HTTP.
async function whyNoRoom(err) {
  try {
    const res = await fetch(new URL('status', apiBase), { cache: 'no-store' });
    const status = res.ok && (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
    if (!status) return `${apiBase.host} has no room server (/api/x/status answered ${res.status})`;
    if (!status.rooms) return `${apiBase.host} is deployed without rooms`;
    return `${apiBase.host} has a room server but refused this page (${err.message}); it only accepts its own pages`;
  } catch {
    return `${apiBase.host} could not be reached (${err.message})`;
  }
}

function joinWs(room, role) {
  return new Promise((resolve, reject) => {
    const url = new URL(`room/${room}?role=${role}`, apiBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const e = emitter();
    const signal = {
      kind: 'ws',
      id: null,
      peers: new Map(),
      on: e.on.bind(e),
      send(to, msg) {
        if (ws.readyState === 1) ws.send(JSON.stringify(to ? { ...msg, to } : msg));
      },
      sendBinary(buffer) {
        // Don't queue frames behind a slow socket.
        if (ws.readyState === 1 && ws.bufferedAmount < 500_000) ws.send(buffer);
      },
      close() {
        ws.close();
      },
    };
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('room server did not answer'));
    }, 5000);
    ws.onerror = () => reject(new Error('the WebSocket to ' + url.host + ' failed'));
    ws.onclose = () => {
      reject(new Error('room closed'));
      e.emit('close');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return e.emit('binary', ev.data);
      const msg = JSON.parse(ev.data);
      if (msg.t === 'welcome') {
        clearTimeout(timer);
        signal.id = msg.id;
        for (const p of msg.peers) signal.peers.set(p.id, p.role);
        resolve(signal);
        for (const [id, r] of signal.peers) e.emit('join', id, r);
      } else if (msg.t === 'join') {
        signal.peers.set(msg.from, msg.role);
        e.emit('join', msg.from, msg.role);
      } else if (msg.t === 'leave') {
        signal.peers.delete(msg.from);
        e.emit('leave', msg.from);
      } else {
        e.emit('message', msg.from, msg);
      }
    };
  });
}

function joinBc(room, role) {
  if (typeof BroadcastChannel === 'undefined') throw new Error('no BroadcastChannel');
  const bc = new BroadcastChannel('live-room:' + room);
  const id = Math.random().toString(36).slice(2, 10);
  const e = emitter();
  const signal = {
    kind: 'bc',
    id,
    peers: new Map(),
    on: e.on.bind(e),
    send(to, msg) {
      // RTCSessionDescription and RTCIceCandidate don't structured-clone.
      bc.postMessage({ ...JSON.parse(JSON.stringify(msg)), from: id, to });
    },
    sendBinary(buffer) {
      bc.postMessage({ t: 'bin', from: id, buffer });
    },
    close() {
      bc.postMessage({ t: 'leave', from: id });
      bc.close();
    },
  };
  bc.onmessage = ({ data: msg }) => {
    if (msg.to && msg.to !== id) return;
    if (msg.t === 'join' || msg.t === 'here') {
      if (signal.peers.has(msg.from)) return;
      signal.peers.set(msg.from, msg.role);
      if (msg.t === 'join') bc.postMessage({ t: 'here', from: id, role, to: msg.from });
      e.emit('join', msg.from, msg.role);
    } else if (msg.t === 'leave') {
      if (signal.peers.delete(msg.from)) e.emit('leave', msg.from);
    } else if (msg.t === 'bin') {
      e.emit('binary', msg.buffer);
    } else {
      e.emit('message', msg.from, msg);
    }
  };
  bc.postMessage({ t: 'join', from: id, role });
  addEventListener('pagehide', () => signal.close());
  return signal;
}

const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let icePromise;
/** { iceServers, turn, from }: STUN always, TURN when the deployment has a key. Credentials last five minutes, so ask again after two. */
export function iceConfig() {
  const now = Date.now();
  if (icePromise && now - icePromise.at < 2 * 60_000) return icePromise;
  icePromise = fetch(new URL('ice', apiBase), { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => ({ iceServers: d.iceServers, turn: !!d.turn, from: apiBase.host, note: d.note ?? '' }))
    .catch((err) => ({ iceServers: FALLBACK_ICE, turn: false, from: 'built in', note: `could not ask ${apiBase.host} for servers: ${err.message}` }));
  icePromise.at = now;
  return icePromise;
}
export const iceServers = () => iceConfig().then((c) => c.iceServers);

// ---- Saying what a connection is doing ----
// A phone has no console, so both ends keep a plain-text log a page can show.

const kindOf = (candidate) => {
  // candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> …
  const parts = String(candidate?.candidate ?? candidate ?? '').split(' ');
  const typ = parts.indexOf('typ');
  if (typ < 0) return null;
  const type = parts[typ + 1];
  const proto = (parts[2] ?? '').toLowerCase();
  return `${type}/${proto}`;
};
const NAMES = { host: 'host (this device\'s own address)', srflx: 'srflx (public address, found with STUN)', prflx: 'prflx (found while connecting)', relay: 'relay (through TURN)' };

function describeServers(cfg, policy) {
  const urls = cfg.iceServers.flatMap((s) => [].concat(s.urls));
  const stun = urls.filter((u) => u.startsWith('stun')).length;
  const turn = urls.filter((u) => u.startsWith('turn')).length;
  return `ICE servers from ${cfg.from}: ${stun} STUN, ${turn} TURN${turn ? '' : ' (no TURN: networks that hide devices from each other will not connect directly)'}${policy === 'relay' ? '; forced through TURN only' : ''}${cfg.note ? '. ' + cfg.note : ''}`;
}

/**
 * Report everything an RTCPeerConnection goes through as text lines.
 * Returns { remote(candidate), summary() }.
 */
function watchPeer(pc, log, cfg) {
  const local = new Map();
  const remote = new Map();
  const errors = new Set();
  const count = (map, kind) => {
    if (!kind) return false;
    map.set(kind, (map.get(kind) ?? 0) + 1);
    return map.get(kind) === 1;
  };
  const list = (map) => [...map].map(([k, n]) => `${k}${n > 1 ? ' ×' + n : ''}`).join(', ') || 'none';
  pc.addEventListener('signalingstatechange', () => log(`signalling: ${pc.signalingState}`));
  pc.addEventListener('icegatheringstatechange', () => {
    log(`gathering candidates: ${pc.iceGatheringState}${pc.iceGatheringState === 'complete' ? ` (this end found ${list(local)})` : ''}`);
  });
  pc.addEventListener('iceconnectionstatechange', () => log(`ICE: ${pc.iceConnectionState}`));
  pc.addEventListener('icecandidate', (ev) => {
    const kind = kindOf(ev.candidate);
    if (count(local, kind)) log(`this end has a ${NAMES[kind.split('/')[0]] ?? kind} candidate over ${kind.split('/')[1]}`);
  });
  pc.addEventListener('icecandidateerror', (ev) => {
    // 701 is "could not reach the server"; browsers report it once per network interface.
    const text = `${ev.url || 'server'}: ${ev.errorCode} ${ev.errorText || ''}`.trim();
    if (errors.has(text) || errors.size > 6) return;
    errors.add(text);
    log(`ICE server problem: ${text}`, 'bad');
  });
  pc.addEventListener('connectionstatechange', async () => {
    const state = pc.connectionState;
    if (state === 'connected') {
      log(`connected. ${await selectedPair(pc)}`, 'good');
    } else if (state === 'failed') {
      log(`failed. ${explain()}`, 'bad');
    } else {
      log(`connection: ${state}`);
    }
  });
  const has = (map, type) => [...map.keys()].some((k) => k.startsWith(type));
  function explain() {
    const out = [`This end offered ${list(local)}; the other end offered ${list(remote)}.`];
    if (!remote.size) out.push('No candidates arrived from the other end, so signalling is the problem, not the network.');
    else if (!has(local, 'srflx') && !has(local, 'relay')) out.push('This end never learned its public address: STUN did not answer, which usually means UDP is blocked here.');
    else if (!has(local, 'relay') && !has(remote, 'relay')) out.push(cfg.turn ? 'TURN is configured but gave no relay candidate (see any server problem above).' : 'Both ends found public addresses but could not reach each other, which is what a symmetric NAT (most mobile networks) does. This needs a TURN server, and this deployment has none.');
    else out.push('Even the TURN relay could not be reached from one end.');
    return out.join(' ');
  }
  return {
    remote(candidate) {
      const kind = kindOf(candidate);
      if (count(remote, kind)) log(`other end has a ${NAMES[kind.split('/')[0]] ?? kind} candidate over ${kind.split('/')[1]}`);
    },
    explain,
  };
}

async function selectedPair(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    for (const s of stats.values()) if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    for (const s of stats.values()) if (!pair && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
    if (!pair) return 'Selected route unknown.';
    const a = stats.get(pair.localCandidateId);
    const b = stats.get(pair.remoteCandidateId);
    const side = (c) => (c ? `${c.candidateType}/${c.protocol}${c.candidateType === 'relay' && c.relayProtocol ? ' via TURN over ' + c.relayProtocol : ''}` : '?');
    const direct = a?.candidateType !== 'relay' && b?.candidateType !== 'relay';
    return `Route: ${side(a)} here to ${side(b)} there, ${direct ? 'peer to peer' : 'through the TURN relay'}${pair.currentRoundTripTime != null ? `, ${Math.round(pair.currentRoundTripTime * 1000)} ms round trip` : ''}.`;
  } catch {
    return 'Selected route unknown.';
  }
}

// Candidates can arrive before the description they belong to; adding them
// then throws and the candidate is lost. Hold them until it is set.
function candidateQueue(pc, onError) {
  const waiting = [];
  return {
    async add(candidate) {
      if (!pc.remoteDescription) return void waiting.push(candidate);
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        onError(err);
      }
    },
    async flush() {
      for (const c of waiting.splice(0)) {
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          onError(err);
        }
      }
    },
  };
}

function describeRoom(signal, room) {
  if (signal.kind === 'ws') return `joined room ${room} on ${apiBase.host} as ${signal.id}`;
  return `room ${room} is a BroadcastChannel: only tabs of this browser can join${signal.fallback ? `, because ${signal.fallback}` : ''}`;
}

export function newRoomId() {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => letters[b % letters.length]).join('');
}

// A link (see live-view.js) that starts on the room and moves to an
// RTCDataChannel when one opens.
function upgradableLink(signal, peerId) {
  let channel = null;
  const link = {
    transfers: false,
    onmessage: null,
    via: 'room',
    send(msg) {
      if (channel?.readyState === 'open') channel.send(JSON.stringify(msg));
      else signal.send(peerId, { t: 'live', msg });
    },
    upgrade(dc) {
      dc.addEventListener('message', (e) => link.onmessage?.(JSON.parse(e.data)));
      const open = () => {
        channel = dc;
        link.via = 'datachannel';
        link.onupgrade?.();
      };
      if (dc.readyState === 'open') open();
      else dc.addEventListener('open', open);
      dc.addEventListener('close', () => {
        if (channel === dc) {
          channel = null;
          link.via = 'room';
        }
      });
    },
    deliver(msg) {
      link.onmessage?.(msg);
    },
  };
  return link;
}

/**
 * Share a surface with everyone who joins the room.
 * transport: 'auto' (WebRTC, relay if the viewer asks), 'rtc', or 'relay'.
 * Returns { signal, viewers: Map(id -> { state, pc, link }), stop(), on(type, fn) }.
 *   events: 'viewer' (id, info), 'state' (id, state), 'gone' (id)
 */
// #region share
export async function shareInRoom(surface, room, { kind = 'auto', transport = 'auto', title, serve, role = 'source' } = {}) {
  if (!serve) ({ serve } = await import('./live-surface.js'));
  const signal = await joinRoom(room, { role, kind });
  const e = emitter();
  const viewers = new Map();
  let stream = null;
  const log = (text, tone = '') => e.emit('log', text, tone);
  log(describeRoom(signal, room), signal.kind === 'ws' ? '' : 'bad');
  const cfg = transport === 'relay' ? { iceServers: [], turn: false, from: 'nowhere', note: '' } : await iceConfig();
  const policy = transport === 'turn' ? 'relay' : 'all';
  if (transport !== 'relay') log(describeServers(cfg, policy));
  signal.on('close', () => log('the room connection closed', 'bad'));

  async function addViewer(id) {
    if (viewers.has(id)) return;
    log(`viewer ${id} joined the room`);
    const link = upgradableLink(signal, id);
    const info = { id, link, pc: null, state: 'joining', stop: null };
    viewers.set(id, info);
    info.stop = serve(surface, link, { title, peer: id, sendBinary: (buf) => signal.sendBinary(buf) });
    e.emit('viewer', id, info);
    if (transport === 'relay' || typeof RTCPeerConnection === 'undefined') return;
    stream ??= surface.stream(30);
    const pc = (info.pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: policy }));
    const say = (text, tone) => log(`viewer ${id}: ${text}`, tone);
    info.watch = watchPeer(pc, say, cfg);
    info.candidates = candidateQueue(pc, (err) => say(`a candidate was refused: ${err.message}`, 'bad'));
    for (const track of stream.getTracks()) {
      track.contentHint = 'detail'; // text: prefer sharpness over frame rate
      pc.addTrack(track, stream);
    }
    link.upgrade(pc.createDataChannel('input', { ordered: true }));
    pc.onicecandidate = (ev) => ev.candidate && signal.send(id, { t: 'rtc', ice: ev.candidate });
    pc.onconnectionstatechange = () => {
      info.state = pc.connectionState;
      // A canvas stream only produces a frame when the canvas changes; make
      // sure a viewer that has just connected gets one.
      if (pc.connectionState === 'connected') surface.requestPaint();
      e.emit('state', id, pc.connectionState);
    };
    await pc.setLocalDescription(await pc.createOffer());
    signal.send(id, { t: 'rtc', sdp: pc.localDescription });
  }

  function dropViewer(id) {
    const info = viewers.get(id);
    if (!info) return;
    info.stop?.();
    info.pc?.close();
    viewers.delete(id);
    log(`viewer ${id} left`);
    e.emit('gone', id);
  }

  signal.on('join', (id, r) => r !== role && addViewer(id));
  signal.on('leave', dropViewer);
  signal.on('message', async (from, msg) => {
    const info = viewers.get(from);
    if (!info) return;
    if (msg.t === 'live') info.link.deliver(msg.msg);
    else if (msg.t === 'rtc' && info.pc) {
      try {
        if (msg.sdp) {
          await info.pc.setRemoteDescription(msg.sdp);
          await info.candidates.flush();
        } else if (msg.ice) {
          info.watch.remote(msg.ice);
          await info.candidates.add(msg.ice);
        }
      } catch (err) {
        log(`viewer ${from}: ${err.message}`, 'bad');
        e.emit('error', err);
      }
    } else e.emit('message', from, msg);
  });

  return {
    signal,
    viewers,
    turn: cfg.turn,
    on: e.on.bind(e),
    /** Send an app-level message to every viewer (e.g. chat). */
    broadcast(msg) {
      signal.send(null, msg);
    },
    stop() {
      for (const id of [...viewers.keys()]) dropViewer(id);
      for (const t of stream?.getTracks() ?? []) t.stop();
      signal.close();
    },
  };
}
// #endregion share

/**
 * Watch the surface shared in a room, in a <live-view>.
 * transport: 'auto' waits `patience` ms for WebRTC, then asks for relayed frames.
 * Returns { signal, state, via, stop(), on } ; events: 'state' (text), 'message' (from, msg)
 */
export async function watchRoom(view, room, { kind = 'auto', transport = 'auto', patience = 7000, role = 'viewer' } = {}) {
  const signal = await joinRoom(room, { role, kind });
  const e = emitter();
  const session = { signal, state: 'waiting for the source', via: null, pc: null, on: e.on.bind(e), stop, send: (msg) => signal.send(null, msg) };
  let sourceId = null;
  let link = null;
  let timer = 0;
  let incoming = null;
  let watch = null;
  let candidates = null;
  const log = (text, tone = '') => e.emit('log', text, tone);
  log(describeRoom(signal, room), signal.kind === 'ws' ? '' : 'bad');
  const cfg = transport === 'relay' ? { iceServers: [], turn: false, from: 'nowhere', note: '' } : await iceConfig();
  const policy = transport === 'turn' ? 'relay' : 'all';
  if (transport !== 'relay') log(describeServers(cfg, policy));
  session.turn = cfg.turn;
  signal.on('close', () => {
    log('the room connection closed', 'bad');
    if (session.via !== 'webrtc') setState('lost the room; reload to rejoin', null);
  });

  const setState = (state, via = session.via) => {
    session.state = state;
    session.via = via;
    e.emit('state', state, via);
  };

  function relay(reason) {
    if (session.via === 'relay' || !link) return;
    view.connect(link, { frames: 'blob', fps: 8 });
    log(`showing relayed frames instead: ${reason}`);
    setState(`relayed through the room (${reason})`, 'relay');
  }

  // Video is only real once the connection is up: a track is announced as
  // soon as the offer is read, long before any packet can flow.
  function showVideo() {
    if (!incoming || session.via === 'webrtc') return;
    clearTimeout(timer);
    view.connect(link, { stream: incoming });
    setState('video over WebRTC', 'webrtc');
  }

  function meet(id) {
    if (sourceId) return;
    sourceId = id;
    link = upgradableLink(signal, id);
    link.onupgrade = () => e.emit('upgrade');
    log(`found the source (${id})`);
    setState('found the source, connecting');
    if (transport === 'relay' || typeof RTCPeerConnection === 'undefined') relay(transport === 'relay' ? 'chosen' : 'no WebRTC here');
    // Keep trying WebRTC after this: if it connects later, the video takes over.
    else if (transport === 'auto') timer = setTimeout(() => relay('WebRTC is still connecting'), patience);
    if (transport === 'turn' && !cfg.turn) {
      log('TURN only was asked for, but this site has no TURN server, so nothing can connect', 'bad');
      setState('no TURN server on this site', null);
    } else if (transport === 'rtc' || transport === 'turn') {
      // ICE gives up by itself only once it has something to try. Don't wait for ever on nothing.
      setTimeout(() => {
        if (session.via === 'webrtc' || !sourceId) return;
        session.failure = watch?.explain() ?? 'The source never sent an offer.';
        log(`not connected after 20 s. ${session.failure}`, 'bad');
        setState('WebRTC did not connect', null);
      }, 20000);
    }
  }

  async function onRtc(msg) {
    if (transport === 'relay') return;
    let pc = session.pc;
    if (!pc) {
      pc = session.pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: policy });
      watch = watchPeer(pc, log, cfg);
      candidates = candidateQueue(pc, (err) => log(`a candidate was refused: ${err.message}`, 'bad'));
      pc.onicecandidate = (ev) => ev.candidate && signal.send(sourceId, { t: 'rtc', ice: ev.candidate });
      pc.ondatachannel = (ev) => link.upgrade(ev.channel);
      pc.ontrack = (ev) => {
        incoming = ev.streams[0] ?? new MediaStream([ev.track]);
        if (pc.connectionState === 'connected') showVideo();
        else if (session.via !== 'relay' && !(transport === 'turn' && !cfg.turn)) setState('connecting over WebRTC');
      };
      pc.onconnectionstatechange = () => {
        e.emit('rtc', pc.connectionState);
        if (pc.connectionState === 'connected') showVideo();
        else if (pc.connectionState === 'failed') {
          session.failure = watch.explain();
          if (session.via === 'relay') setState(`relayed through the room (WebRTC failed)`, 'relay');
          else if (transport === 'auto') {
            clearTimeout(timer);
            session.via = null;
            relay('WebRTC failed');
          } else setState('WebRTC failed', null);
        } else if (pc.connectionState === 'disconnected' && session.via === 'webrtc') {
          setState('WebRTC interrupted, waiting for it to come back', 'webrtc');
        }
      };
    }
    try {
      if (msg.sdp) {
        log('got the offer from the source');
        await pc.setRemoteDescription(msg.sdp);
        await candidates.flush();
        await pc.setLocalDescription(await pc.createAnswer());
        signal.send(sourceId, { t: 'rtc', sdp: pc.localDescription });
        log('sent the answer');
      } else if (msg.ice) {
        watch.remote(msg.ice);
        await candidates.add(msg.ice);
      }
    } catch (err) {
      log(`WebRTC error: ${err.message}`, 'bad');
      e.emit('error', err);
    }
  }

  signal.on('join', (id, r) => r === 'source' && meet(id));
  signal.on('leave', (id) => {
    if (id !== sourceId) return;
    sourceId = null;
    link = null;
    incoming = null;
    session.pc?.close();
    session.pc = null;
    log('the source left the room');
    setState('the source left', null);
  });
  signal.on('binary', (buffer) => session.via === 'relay' && view.showBlob(buffer));
  signal.on('message', (from, msg) => {
    if (from === sourceId && msg.t === 'live') link.deliver(msg.msg);
    else if (from === sourceId && msg.t === 'rtc') onRtc(msg);
    else e.emit('message', from, msg);
  });

  function stop() {
    clearTimeout(timer);
    view.disconnect();
    session.pc?.close();
    signal.close();
  }
  return session;
}
