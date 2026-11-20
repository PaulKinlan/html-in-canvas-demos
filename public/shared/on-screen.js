// Keep on-load checks away from the demo the visitor is looking at.
//
// The checks on a page run on a fixture that sits in the page's own "Live tests" section, and only
// while that fixture is on screen (a canvas that is off screen is not painted, so its checks would
// time out). Nothing is pinned over the page, and nothing runs until the reader scrolls there.
//
//   import { runTests } from '/shared/support.js';
//   import { onScreen } from '/shared/on-screen.js';
//   const rig = onScreen(document.getElementById('rigbox'));
//   rig.reserve(tbody, tests);                 // rows now, so the page does not grow (and scroll) later
//   await rig.seen;                            // first time the fixture scrolls into view
//   await runTests(tbody, rig.gate(tests));    // each check waits while the fixture is out of view
//
// Add ?checks to the URL to scroll to the fixture and start at once (handy for automation).

export function onScreen(el) {
  let visible = false, waiters = [];
  const io = new IntersectionObserver((entries) => {
    visible = entries.at(-1).isIntersecting;
    if (visible) { for (const w of waiters) w(); waiters = []; }
  }, { threshold: 0.6 });
  io.observe(el);
  const wait = () => (visible ? Promise.resolve() : new Promise((r) => waiters.push(r)));
  if (new URLSearchParams(location.search).has('checks')) el.scrollIntoView({ block: 'center' });
  let reserved = null;
  return {
    seen: wait(),
    wait,
    get visible() { return visible; },
    stop: () => io.disconnect(),
    /** Show the list of checks straight away, as waiting rows. runTests() replaces them with its own. */
    reserve(tbody, tests) {
      reserved = tbody;
      tbody.replaceChildren(...tests.map((t) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td class="status pending">… waiting</td><td><strong></strong><div class="note"></div></td><td class="note detail"></td>';
        tr.querySelector('strong').textContent = t.name;
        tr.querySelector('div.note').textContent = t.why ?? '';
        return tr;
      }));
    },
    /** The same tests, each waiting for the fixture to be on screen before it starts. Its own time limit still applies once it runs. */
    gate(tests) {
      // runTests() adds its rows before its first await, so clearing here leaves no gap for the page to jump in.
      reserved?.replaceChildren();
      reserved = null;
      return tests.map((t) => ({
        ...t,
        timeout: 3_600_000,   // the wait is open-ended
        run: async () => {
          await wait();
          const ms = t.timeout ?? 4000;
          return Promise.race([t.run(), new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms}ms`)), ms))]);
        },
      }));
    },
  };
}
