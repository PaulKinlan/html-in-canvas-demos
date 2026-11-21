// #region fx
// The four numbers a CSS rule on the canvas can set. They are registered in the page's style sheet with
// @property, so a transition on the canvas eases them. A change of a custom property raises no `paint`
// event, so the canvas asks for frames itself between `transitionrun` and `transitionend`.
export function fx(canvas, request) {
  let moving = 0;
  const mine = (e) => e.target === canvas && e.propertyName.startsWith('--fx-');
  canvas.addEventListener('transitionrun', (e) => { if (mine(e)) { moving++; request(); } });
  for (const type of ['transitionend', 'transitioncancel']) canvas.addEventListener(type, (e) => { if (mine(e)) { moving = Math.max(0, moving - 1); request(); } });
  return {
    get moving() { return moving > 0; },
    read() {
      const style = getComputedStyle(canvas), n = (name) => Number(style.getPropertyValue(name)) || 0;
      return { amount: n('--fx-amount'), progress: n('--fx-progress'), x: n('--fx-x'), y: n('--fx-y') };
    },
  };
}
// #endregion fx
