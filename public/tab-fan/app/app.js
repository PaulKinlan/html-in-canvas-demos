// Shared by the pages in /tab-fan/app/. The pages talk over one BroadcastChannel, so a change in one
// card of the fan shows in the others: the accent colour, and the timer's time in every footer.
const room = new URLSearchParams(location.search).get('room') ?? 'main';
export const channel = new BroadcastChannel(`tab-fan-${room}`);
const foot = document.querySelector('footer');
export const state = { accent: '#d2491f', timer: '00:00', unread: 3 };

function show() {
  document.documentElement.style.setProperty('--accent', state.accent);
  if (foot) foot.textContent = `Timer ${state.timer} · ${state.unread} unread`;
  document.dispatchEvent(new CustomEvent('appstate'));
}
export function share(change) {
  Object.assign(state, change);
  channel.postMessage(change);
  show();
}
channel.addEventListener('message', (e) => {
  if (e.data === 'hello') { channel.postMessage({ ...state, reply: true }); return; }   // a page that just opened asks for the state
  Object.assign(state, e.data);
  show();
});
channel.postMessage('hello');
show();
