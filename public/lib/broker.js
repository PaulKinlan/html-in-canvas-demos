// SharedWorker that introduces publishers and viewers on a named channel by
// handing each side one end of a fresh MessageChannel.
const publishers = new Map(); // channel -> Set(port)
const waiting = new Map(); // channel -> Set(port)  viewers that arrived first

function introduce(pubPort, viewPort, channel) {
  const { port1, port2 } = new MessageChannel();
  pubPort.postMessage({ type: 'port', channel, side: 'publisher' }, [port1]);
  viewPort.postMessage({ type: 'port', channel, side: 'viewer' }, [port2]);
}

onconnect = (e) => {
  const port = e.ports[0];
  port.onmessage = ({ data }) => {
    const { type, channel } = data;
    if (type === 'publisher') {
      if (!publishers.has(channel)) publishers.set(channel, new Set());
      publishers.get(channel).add(port);
      for (const v of waiting.get(channel) ?? []) introduce(port, v, channel);
      waiting.delete(channel);
    } else if (type === 'viewer') {
      const pubs = publishers.get(channel);
      if (pubs?.size) {
        // Newest publisher wins.
        introduce([...pubs].at(-1), port, channel);
      } else {
        if (!waiting.has(channel)) waiting.set(channel, new Set());
        waiting.get(channel).add(port);
      }
    }
  };
  port.start();
};
