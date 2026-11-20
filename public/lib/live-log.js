// live-log.js: a connection log people can read on the page.
//
//   const log = connectionLog(document.querySelector('#log'));
//   session.on('log', log.add);
//
// Phones have no console, so everything shareInRoom() and watchRoom() report
// (room, ICE servers, candidates found, the route chosen, every error) is
// written here as plain lines, with a button to copy them.
export function connectionLog(host, { title = 'Connection log', open = true } = {}) {
  const started = performance.now();
  const lines = [];
  host.innerHTML = '';
  const details = document.createElement('details');
  details.open = open;
  details.className = 'live-log';
  const summary = document.createElement('summary');
  summary.textContent = title;
  const list = document.createElement('ol');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-label', title);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy log';
  copy.onclick = async () => {
    const text = [`${location.href}`, navigator.userAgent, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      // No clipboard permission: select the lines so they can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(list);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      copy.textContent = 'Selected, now copy';
    }
    setTimeout(() => (copy.textContent = 'Copy log'), 2500);
  };
  details.append(summary, list, copy);
  host.append(details);
  if (!document.getElementById('live-log-style')) {
    const style = document.createElement('style');
    style.id = 'live-log-style';
    style.textContent = `
      .live-log { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .live-log summary { cursor: pointer; font: 600 13px system-ui, sans-serif; padding: 6px 0; min-height: 32px; box-sizing: border-box; }
      .live-log ol { list-style: none; margin: 0 0 8px; padding: 8px 10px; max-height: 15em; overflow: auto; overscroll-behavior: contain; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 8px; overflow-wrap: anywhere; }
      .live-log li { padding: 1px 0; }
      .live-log li time { opacity: 0.6; margin-right: 0.6em; }
      .live-log li.bad { color: #e0523d; }
      .live-log li.good { color: #2f9e55; }
      .live-log button { font: 13px system-ui, sans-serif; min-height: 36px; padding: 6px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background: transparent; color: inherit; }
    `;
    document.head.append(style);
  }
  return {
    lines,
    add(text, tone = '') {
      const t = ((performance.now() - started) / 1000).toFixed(1).padStart(5) + 's';
      lines.push(`${t}  ${text}`);
      const li = document.createElement('li');
      if (tone) li.className = tone;
      const time = document.createElement('time');
      time.textContent = t;
      li.append(time, text);
      // Stay at the newest line unless the reader has scrolled up to read.
      const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      list.append(li);
      if (pinned) list.scrollTop = list.scrollHeight;
    },
  };
}
