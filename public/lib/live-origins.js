// The demos are deployed twice (html-in-canvas-demos and html-in-canvas-remote)
// so that cross-origin experiments have a real second origin. Locally, run two
// servers on ports 8001 and 8002.
export function otherOrigin(from = location.href) {
  const u = new URL(from);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
    if (u.port !== '8001' && u.port !== '8002') return null;
    u.port = u.port === '8001' ? '8002' : '8001';
  } else if (u.hostname === 'html-in-canvas.page') {
    return 'https://html-in-canvas-remote.kinlan-test.workers.dev';
  } else if (u.hostname.startsWith('html-in-canvas-demos.')) {
    u.hostname = u.hostname.replace('html-in-canvas-demos.', 'html-in-canvas-remote.');
  } else if (u.hostname.startsWith('html-in-canvas-remote.')) {
    u.hostname = u.hostname.replace('html-in-canvas-remote.', 'html-in-canvas-demos.');
  } else {
    return null;
  }
  return u.origin;
}
