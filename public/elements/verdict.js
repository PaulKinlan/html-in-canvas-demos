// Turns the measurements for one element into the label shown on its row.
// Used by the page and by tools/elements/record.mjs (for ELEMENTS.md).

export const LABEL = { works: 'Works', partly: 'Partly', blank: 'Blank', nobox: 'No box', error: 'Error', unmeasured: 'Not measured', skipped: 'Skipped' };

/** One label for a result. `r` is a row of recorded.json or of a run in this browser. */
export function verdict(r, tag) {
  if (!r || r.skipped) return 'skipped';
  if (r.crashed) return 'error';
  if (tag === 'embed (PDF)') return 'unmeasured'; // headless Chromium has no PDF viewer
  const m = r.inside;
  // Any failed check with real input makes it "partly", whatever was drawn.
  if (r.tests?.some((t) => t.ok === false)) return 'partly';
  if (m.error) return 'error';
  if (m.box[0] * m.box[1] === 0) return 'nobox';
  // Blank: next to nothing was drawn where the plain copy has a picture, or no ink at all and no animation.
  if (r.picture ? r.picture.plainInk > 50 && r.picture.canvasInk < r.picture.plainInk * 0.2 : m.ink === 0 && !m.selfPaints) return 'blank';
  return 'works';
}
