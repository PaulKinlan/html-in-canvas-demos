// Shows a file's real source under a demo, with a Copy button.
//
//   <details class="source" open data-src="/slot/hello.html">
//     <summary>The complete page</summary>
//   </details>
//
//   import { sourceViews } from '/shared/source-view.js';
//   sourceViews();
//
// The listing has a fixed height and scrolls inside itself, so the page does
// not move when the source arrives.
const LIVE = 'https://html-in-canvas.page';

const css = new CSSStyleSheet();
css.replaceSync(`
  .source { margin: 10px 0 0; }
  .source > summary { cursor: pointer; font-weight: 600; padding: 8px 0; }
  .source .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 4px 0 8px; font-size: 14px; }
  .source pre { margin: 0; height: 22em; overflow: auto; }
`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];

export function sourceViews(scope = document) {
  for (const box of scope.querySelectorAll('details.source[data-src]')) {
    if (box.querySelector('pre')) continue;
    const url = box.dataset.src;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy';
    const open = document.createElement('a');
    open.href = url;
    open.textContent = url.endsWith('.js') ? 'Open the file' : 'Open it on its own';
    bar.append(copy, open);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'Loading…';
    pre.append(code);
    box.append(bar, pre);
    fetch(url).then((r) => r.text()).then((text) => {
      // Point scripts at the public copy, so the paste works from any folder.
      code.textContent = text.replaceAll('src="/lib/', `src="${LIVE}/lib/`).trim();
    }).catch(() => { code.textContent = `Could not load ${url}. Open it and use View Source.`; });
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(code.textContent); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Select the code and copy it'; }
      setTimeout(() => (copy.textContent = 'Copy'), 2000);
    };
  }
}
