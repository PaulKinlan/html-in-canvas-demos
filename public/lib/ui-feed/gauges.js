// ui-feed/gauges.js: barrel re-export for the five scale/gauge controls.
// Each control is a standalone custom element in ./gauges/<tag>.js.

export { FaderBank, faderDb, faderAt } from './gauges/fader-bank.js';
export { TunerSlider } from './gauges/tuner-slider.js';
export { BarbellNumber, platesFor } from './gauges/barbell-number.js';
export { CurtainDrop } from './gauges/curtain-drop.js';
export { ObjectiveTurret } from './gauges/objective-turret.js';
