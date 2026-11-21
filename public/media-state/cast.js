// The sender half of the cast demo. The receiver half is /media-state/receiver.html.
export default function start() {
  const $ = (id) => document.getElementById(id);
  const out = $('castOut'), preview = $('castPreview');
  const lines = [];
  const log = (text) => { lines.push(text); while (lines.length > 9) lines.shift(); out.textContent = lines.join('\n'); };
  let stream = null;

  // #region stream
  // The stream is the first canvas on this page: the film with the controls drawn over it.
  const make = () => {
    if (stream) return stream;
    const canvas = $('barCanvas');
    if (canvas.hidden) { log('The first canvas is showing plain HTML, so there is no picture to send.'); return null; }
    stream = canvas.captureStream(30);
    preview.srcObject = stream;
    preview.play().catch(() => {});
    log(`captureStream(30) gave ${stream.getVideoTracks().length} video track. It carries a frame each time the canvas is painted, so press Play above.`);
    return stream;
  };
  // #endregion stream

  // #region remote
  // Remote Playback API: ask the browser to play this <video> on another device.
  $('castWatch').addEventListener('click', async () => {
    if (!make()) return;
    if (!preview.remote) { log('This browser has no video.remote.'); return; }
    try {
      await preview.remote.watchAvailability((available) => log(`Remote Playback: a device is ${available ? 'available' : 'not available'} for this video.`));
      log(`Remote Playback: watching. State: ${preview.remote.state}.`);
    } catch (e) { log(`Remote Playback: watchAvailability() failed with ${e.name}: ${e.message}`); }
  });
  $('castRemote').addEventListener('click', async () => {
    if (!make()) return;
    if (!preview.remote) { log('This browser has no video.remote.'); return; }
    try { await preview.remote.prompt(); log(`Remote Playback: prompt() resolved. State: ${preview.remote.state}.`); }
    catch (e) { log(`Remote Playback: prompt() failed with ${e.name}: ${e.message}`); }
  });
  // #endregion remote

  // #region send
  // A second screen that shows a web page cannot be handed a MediaStream. The page there gets messages
  // only, so the stream goes over WebRTC and the messages carry the offer and the answer.
  const peers = new Set();
  async function answerTo(post, name) {
    if (!make()) return null;
    const pc = new RTCPeerConnection();
    peers.add(pc);
    for (const track of stream.getVideoTracks()) pc.addTrack(track, stream);
    pc.addEventListener('connectionstatechange', () => log(`${name}: connection ${pc.connectionState}.`));
    await pc.setLocalDescription(await pc.createOffer());
    // Wait for the candidates, at most 2 s, so that one message holds the whole offer.
    if (pc.iceGatheringState !== 'complete') await new Promise((done) => { pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') done(); }); setTimeout(done, 2000); });
    post({ type: 'offer', sdp: pc.localDescription.sdp });
    log(`${name}: offer sent.`);
    return pc;
  }
  // #endregion send

  // #region presentation
  // Presentation API: open receiver.html on a second screen and talk to it over the connection.
  $('castPresent').addEventListener('click', async () => {
    if (typeof PresentationRequest !== 'function') { log('This browser has no PresentationRequest.'); return; }
    try {
      const connection = await new PresentationRequest(['/media-state/receiver.html']).start();
      log(`Presentation: started, connection ${connection.state}.`);
      let pc = null;
      connection.addEventListener('message', async (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'ready') pc = await answerTo((m) => connection.send(JSON.stringify(m)), 'Presentation');
        if (msg.type === 'answer' && pc) await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      });
      connection.addEventListener('close', () => log('Presentation: connection closed.'));
    } catch (e) { log(`Presentation: start() failed with ${e.name}: ${e.message}`); }
  });
  $('castAvailable').addEventListener('click', async () => {
    if (typeof PresentationRequest !== 'function') { log('This browser has no PresentationRequest.'); return; }
    try { const a = await new PresentationRequest(['/media-state/receiver.html']).getAvailability(); log(`Presentation: a screen is ${a.value ? 'available' : 'not available'}.`); }
    catch (e) { log(`Presentation: getAvailability() failed with ${e.name}: ${e.message}`); }
  });
  // #endregion presentation

  // #region tab
  // The same receiver page in another tab, with a BroadcastChannel in place of the presentation
  // connection. This is the part that can be tried with one device.
  const channel = new BroadcastChannel('media-state-cast');
  const tabs = new Map();
  channel.addEventListener('message', async (e) => {
    const msg = e.data;
    if (msg.type === 'ready') { log('Tab: a receiver is ready.'); try { tabs.set(msg.id, await answerTo((m) => channel.postMessage({ ...m, to: msg.id }), 'Tab')); } catch (err) { log(`Tab: ${err.name}: ${err.message}`); } }
    if (msg.type === 'answer' && tabs.get(msg.id)) await tabs.get(msg.id).setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    if (msg.type === 'frame') log(`Tab: the receiver shows the stream at ${msg.width} by ${msg.height}.`);
  });
  // #endregion tab
  $('castMake').addEventListener('click', make);
  log('Nothing is captured until a button is pressed.');
  return {};
}
