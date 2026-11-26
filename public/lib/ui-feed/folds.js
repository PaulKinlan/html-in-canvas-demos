// ui-feed/folds.js: barrel re-export for the five disclosure and tab controls.
// Each control is a standalone module under ./folds/ (only depending on ../kit.js and ../fold.js).

export { Fold, wire, cached, focusRing } from './fold.js';
export { NoteAccordion } from './folds/note-accordion.js';
export { TrailAccordion } from './folds/trail-accordion.js';
export { OrderSummary } from './folds/order-summary.js';
export { BusTabs } from './folds/bus-tabs.js';
export { PosterTabs } from './folds/poster-tabs.js';
