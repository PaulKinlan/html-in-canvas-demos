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
      if (kind === 'ws') throw err;
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
    ws.onerror = () => reject(new Error('no room server at ' + url.host));
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

let icePromise;
export function iceServers() {
  icePromise ??= fetch(new URL('ice', apiBase))
    .then((r) => r.json())
    .then((d) => d.iceServers)
    .catch(() => [{ urls: 'stun:stun.cloudflare.com:3478' }]);
  return icePromise;
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
export async function shareInRoom(surface, room, { kind = 'auto', transport = 'auto', title, serve, role = 'source' } = {}) {
  if (!serve) ({ serve } = await import('./live-surface.js'));
  const signal = await joinRoom(room, { role, kind });
  const e = emitter();
  const viewers = new Map();
  let stream = null;
  const ice = transport === 'relay' ? [] : await iceServers();

  async function addViewer(id) {
    if (viewers.has(id)) return;
    const link = upgradableLink(signal, id);
    const info = { id, link, pc: null, state: 'joining', stop: null };
    viewers.set(id, info);
    info.stop = serve(surface, link, { title, peer: id, sendBinary: (buf) => signal.sendBinary(buf) });
    e.emit('viewer', id, info);
    if (transport === 'relay' || typeof RTCPeerConnection === 'undefined') return;
    stream ??= surface.stream(30);
    const pc = (info.pc = new RTCPeerConnection({ iceServers: ice }));
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
        if (msg.sdp) await info.pc.setRemoteDescription(msg.sdp);
        else if (msg.ice) await info.pc.addIceCandidate(msg.ice);
      } catch (err) {
        e.emit('error', err);
      }
    } else e.emit('message', from, msg);
  });

  return {
    signal,
    viewers,
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
  const ice = transport === 'relay' ? [] : await iceServers();

  const setState = (state, via = session.via) => {
    session.state = state;
    session.via = via;
    e.emit('state', state, via);
  };

  function relay(reason) {
    if (session.via === 'relay' || !link) return;
    view.connect(link, { frames: 'blob', fps: 8 });
    setState(`relayed through the room (${reason})`, 'relay');
  }

  function meet(id) {
    if (sourceId) return;
    sourceId = id;
    link = upgradableLink(signal, id);
    link.onupgrade = () => e.emit('upgrade');
    setState('found the source, connecting');
    if (transport === 'relay' || typeof RTCPeerConnection === 'undefined') relay(transport === 'relay' ? 'chosen' : 'no WebRTC here');
    else if (transport === 'auto') timer = setTimeout(() => relay('WebRTC did not connect in time'), patience);
  }

  async function onRtc(msg) {
    if (transport === 'relay') return;
    let pc = session.pc;
    if (!pc) {
      pc = session.pc = new RTCPeerConnection({ iceServers: ice });
      pc.onicecandidate = (ev) => ev.candidate && signal.send(sourceId, { t: 'rtc', ice: ev.candidate });
      pc.ondatachannel = (ev) => link.upgrade(ev.channel);
      pc.ontrack = (ev) => {
        clearTimeout(timer);
        // Keep the relay's hello from being overwritten if it already started.
        if (session.via === 'relay') return;
        view.connect(link, { stream: ev.streams[0] ?? new MediaStream([ev.track]) });
        setState('video over WebRTC', 'webrtc');
      };
      pc.onconnectionstatechange = () => {
        e.emit('rtc', pc.connectionState);
        if (pc.connectionState === 'failed' && transport === 'auto') {
          session.via = null;
          relay('WebRTC failed');
        }
      };
    }
    try {
      if (msg.sdp) {
        await pc.setRemoteDescription(msg.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        signal.send(sourceId, { t: 'rtc', sdp: pc.localDescription });
      } else if (msg.ice) await pc.addIceCandidate(msg.ice);
    } catch (err) {
      e.emit('error', err);
    }
  }

  signal.on('join', (id, r) => r === 'source' && meet(id));
  signal.on('leave', (id) => {
    if (id !== sourceId) return;
    sourceId = null;
    session.pc?.close();
    session.pc = null;
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
