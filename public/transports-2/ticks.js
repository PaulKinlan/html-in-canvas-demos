// Runs as a dedicated worker and as a SharedWorker: a 250 ms timer that
// remembers the longest gap between two of its own ticks. The page asks for
// that number after it has been hidden, to learn whether this thread was
// stopped with it.
let last = Date.now();
let longest = 0;
let ticks = 0;
setInterval(() => {
  const now = Date.now();
  longest = Math.max(longest, now - last);
  last = now;
  ticks++;
}, 250);
const answer = (port, m) => {
  if (m === 'reset') { longest = 0; ticks = 0; last = Date.now(); }
  port.postMessage({ longest, ticks, sinceLast: Date.now() - last });
};
if (typeof SharedWorkerGlobalScope !== 'undefined' && self instanceof SharedWorkerGlobalScope) {
  onconnect = (e) => { const port = e.ports[0]; port.onmessage = (ev) => answer(port, ev.data); };
} else {
  onmessage = (ev) => answer(self, ev.data);
}
