// "Show the code": listings that are cut from the files the page is running,
// so they cannot drift from what the demo does.
//
// In the page (static HTML, collapsed, so nothing moves on load):
//
//   <details class="show-code">
//     <summary>Show the code</summary>
//     <ol>
//       <li data-code="#orbit-markup"><b>Put the elements in the canvas.</b> One line of why.</li>
//       <li data-code="/offscreen/renderer.js#draw"><b>Draw them in the worker.</b></li>
//       <li data-code="/lib/canvas-slot.js"><b>The whole library file.</b></li>
//     </ol>
//   </details>
//
// data-code is "file#region". No file means this page; no region means the
// whole file. A region is whatever sits between two marker comments in the
// source, in whichever comment style the file uses there:
//
//   <!-- #region orbit-markup -->   // #region draw      /* #region styles */
//   <!-- #endregion -->             // #endregion        /* #endregion */
//
// The same name may be used more than once in a file: the pieces are shown
// together, in order, which is how a listing skips over test scaffolding.
// Regions may nest or overlap; close an overlapping one by name
// ("#endregion draw"). Marker lines are never shown.
//
// Loaded by /shared/nav.js on every page. The styles are in /shared/style.css.
(function () {
  if (window.__showCode) return;
  window.__showCode = true;

  var REPO = 'https://github.com/PaulKinlan/html-in-canvas-demos/blob/main/public';
  var LONG = 60; // a block longer than this starts cut short, with a button for the rest
  var files = new Map();

  function load(path) {
    if (!files.has(path)) {
      files.set(path, fetch(path, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error(path + ' answered ' + r.status);
        return r.text();
      }));
    }
    return files.get(path);
  }

  var OPEN = /#region\s+([\w-]+)/, CLOSE = /#endregion(?:\s+([\w-]+))?/;

  // Returns { text, first, last, lang } for a region, or the whole file.
  function cut(source, name, path) {
    var lines = source.replace(/\r\n?/g, '\n').split('\n');
    var stack = [], pieces = [], current = null, first = 0, last = 0, style = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m;
      if ((m = CLOSE.exec(line))) {
        var closing = m[1] || stack[stack.length - 1];
        var at = stack.lastIndexOf(closing);
        if (at >= 0) stack.splice(at, 1);
        if (name && closing === name && current) { pieces.push(current); current = null; last = i; }
        continue;
      }
      if ((m = OPEN.exec(line))) {
        stack.push(m[1]);
        if (name && m[1] === name) {
          current = [];
          if (!first) first = i + 2;
          if (!style) style = /<!--/.test(line) ? 'html' : /\/\*/.test(line) ? 'css' : 'js';
        }
        continue;
      }
      if (!name) { (current = current || []).push(line); continue; }
      if (current) current.push(line);
    }
    if (current) { pieces.push(current); last = lines.length; }
    if (!pieces.length) return null;
    var ext = (/\.(\w+)$/.exec(path) || [])[1];
    var lang = ext === 'js' || ext === 'mjs' ? 'js' : ext === 'css' ? 'css' : name ? style : 'html';
    var text = pieces.map(dedent).join('\n\n');
    // A piece cut from a <style> or <script> block in an HTML file may carry either comment style.
    if (lang === 'css' && ext !== 'css' && /(^|\n)\s*(const|let|import|function|await|document\.|\/\/ )/.test(text)) lang = 'js';
    return { text: text, first: name ? first : 1, last: name ? last : lines.length, lang: lang };
  }

  function dedent(block) {
    while (block.length && !block[0].trim()) block.shift();
    while (block.length && !block[block.length - 1].trim()) block.pop();
    var min = Infinity;
    block.forEach(function (l) { if (l.trim()) min = Math.min(min, l.match(/^[ \t]*/)[0].length); });
    return block.map(function (l) { return l.slice(min === Infinity ? 0 : min).replace(/\s+$/, ''); }).join('\n');
  }

  // ---- A small highlighter: comments, strings, keywords, tags. ----
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function span(cls, s) { return '<span class="sc-' + cls + '">' + esc(s) + '</span>'; }
  function scan(s, re, paint) {
    var out = '', at = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
      out += esc(s.slice(at, m.index)) + paint(m);
      at = m.index + m[0].length;
      if (!m[0].length) re.lastIndex++;
    }
    return out + esc(s.slice(at));
  }
  var JS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|\b(async|await|break|case|catch|class|const|continue|default|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|switch|throw|try|typeof|var|while|yield|true|false|null|undefined|this|super)\b|\b(\d[\w.]*)\b/g;
  function js(s) {
    return scan(s, JS, function (m) { return m[1] ? span('c', m[1]) : m[2] ? span('s', m[2]) : m[3] ? span('k', m[3]) : span('n', m[4]); });
  }
  var CSS = /(\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(@[\w-]+)|(--[\w-]+)/g;
  function css(s) {
    return scan(s, CSS, function (m) { return m[1] ? span('c', m[1]) : m[2] ? span('s', m[2]) : m[3] ? span('k', m[3]) : span('n', m[4]); });
  }
  var HTML = /(<!--[\s\S]*?-->)|(<(script|style)\b(?:"[^"]*"|'[^']*'|[^>"'])*>)([\s\S]*?)(<\/\3>)|(<\/?[a-zA-Z](?:"[^"]*"|'[^']*'|[^>"'])*>)/g;
  var ATTR = /([^\s"'=<>\/]+)(?:(=)("[^"]*"|'[^']*'|[^\s>]+))?/g;
  function tag(t) {
    var m = /^(<\/?)([\w-]+)([\s\S]*?)(\/?>)$/.exec(t);
    if (!m) return esc(t);
    return esc(m[1]) + span('k', m[2]) + scan(m[3], ATTR, function (a) {
      return span('a', a[1]) + (a[2] ? '=' + span('s', a[3]) : '');
    }) + esc(m[4]);
  }
  function html(s) {
    return scan(s, HTML, function (m) {
      if (m[1]) return span('c', m[1]);
      if (m[2]) return tag(m[2]) + (m[3] === 'style' ? css(m[4]) : /type=["']?(x-shader|text\/plain)/.test(m[2]) ? esc(m[4]) : js(m[4])) + tag(m[5]);
      return tag(m[6]);
    });
  }
  var paint = { js: js, css: css, html: html };

  function copy(text, button) {
    var done = function (ok) {
      var was = button.dataset.label || (button.dataset.label = button.textContent);
      button.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { button.textContent = was; }, 1600);
    };
    var fallback = function () {
      var t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t);
      t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      t.remove();
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  function el(name, cls, text) {
    var e = document.createElement(name);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fill(item) {
    if (item.__code) return;
    item.__code = true;
    var spec = item.getAttribute('data-code').trim();
    var hash = spec.indexOf('#');
    var path = (hash < 0 ? spec : spec.slice(0, hash)) || location.pathname;
    var name = hash < 0 ? '' : spec.slice(hash + 1);
    var file = path.replace(/\/$/, '/index.html');
    var box = el('figure', 'sc-block');
    var bar = el('figcaption');
    var where = el('a', 'sc-file', file);
    where.href = REPO + file;
    where.target = '_blank';
    where.rel = 'noopener';
    var button = el('button', 'sc-copy', 'Copy');
    button.type = 'button';
    button.disabled = true;
    // Long lines scroll sideways by default; Wrap folds them, which reads better on a phone.
    var wrap = el('button', 'sc-wrap', 'Wrap');
    wrap.type = 'button';
    wrap.setAttribute('aria-pressed', 'false');
    wrap.onclick = function () { wrap.setAttribute('aria-pressed', String(box.classList.toggle('sc-wrapped'))); };
    bar.append(where, wrap, button);
    var pre = el('pre'), code = el('code', '', 'Loading…');
    pre.tabIndex = 0;
    pre.append(code);
    box.append(bar, pre);
    item.append(box);

    load(path).then(function (source) {
      var got = cut(source, name, file);
      if (!got) throw new Error('No region "' + name + '" in ' + file);
      var count = got.text.split('\n').length;
      where.textContent = file + (name ? ' · from line ' + got.first : ' · ' + count + ' lines');
      where.href = REPO + file + (name ? '#L' + got.first + '-L' + got.last : '');
      var lang = item.getAttribute('data-lang') || got.lang;
      code.className = 'sc-' + lang;
      code.innerHTML = (paint[lang] || esc)(got.text);
      button.disabled = false;
      button.onclick = function () { copy(got.text, button); };
      if (count > LONG && !item.hasAttribute('data-code-full')) {
        box.classList.add('sc-short');
        var more = el('button', 'sc-more', 'Show all ' + count + ' lines');
        more.type = 'button';
        more.onclick = function () { box.classList.remove('sc-short'); more.remove(); };
        box.append(more);
      }
    }).catch(function (err) {
      code.textContent = 'Could not load this listing (' + err.message + '). The file is linked above.';
    });
  }

  function open(details) {
    details.querySelectorAll('[data-code]').forEach(fill);
  }

  // The toggle event does not bubble, so listen in the capture phase: one
  // listener covers listings added to the page later too.
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.matches && d.matches('details.show-code') && d.open) open(d);
  }, true);
  function already() { document.querySelectorAll('details.show-code[open]').forEach(open); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', already); else already();

  window.showCode = { cut: cut, highlight: paint };
})();
