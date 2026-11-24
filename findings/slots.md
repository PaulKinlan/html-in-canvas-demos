# Slots

| Experiment | Result | Why |
|---|---|---|
| Draw a light-DOM element slotted into a shadow canvas | works | Layout and paint use the flat tree, so the slotted element is a canvas descendant. |
| Slotted element without `drawable` | fails | "Descendants passed to DrawElementImage must have the 'drawable' attribute." |
| `<slot drawable>` | fails | Slots are `display: contents`: no box, so "No cached paint record". |
| `<div drawable><slot></slot></div>` wrapper in the shadow tree | works | Draws everything slotted into it as one image, without touching author markup. |
| Declarative shadow DOM, no custom element | works | Only the `paint` handler needs script. |
| Manual slot assignment (`slot.assign()`) | works | |
| Slot fallback content, several elements per slot, deeply nested slots, slot-through-slot | works | |
| `<slot>` inside a light-DOM canvas picking up `slot="x"` elsewhere | fails | Slots are inert outside a shadow tree. |
| Slotting an element that isn't a child of the host | fails | `assign()` ignores non-children. |
| Shadow root on `<body>` with a canvas and named slots | works | Any top-level element opts in with `slot="…"`. |
| Clicks, focus, typing on slotted elements at their drawn position | works | `drawElementImage` updates element geometry. |
| Content from outside the component: `<canvas-slot from="#promo">`, `adopt()`, `release()` | works | Something has to move the element in. The component leaves a comment where it was and puts it back on release. `/slot/#outside` lists every route. |
| A `<slot name>` in a light-DOM canvas used as a named mount point (Extensible Web Apps pattern) | works | It projects nothing, but an element moved into it is a canvas descendant and draws. No shadow root or component. `/slot/mount.html` |
| `moveBefore()` an element out of a drawable canvas and back in the same task | fails (Chromium 157) | Afterwards drawing throws "The element can only be drawn into its nearest ancestor <canvas>". A plain insert works, so `canvas-slot.js` skips `moveBefore` for an element it moved in the last two frames. |
| Drawing in a canvas that is far off screen (for example in an unscrolled iframe) | fails until visible | "No cached paint record for element". Demos retry on a timer, and live checks run on a fixed on-screen stage (`testStage()`, `stageFrame()` in `shared/support.js`). |
| `<template shadowrootmode>` via `innerHTML` | fails | Only the parser, `setHTMLUnsafe()` and `parseHTMLUnsafe()` build the shadow root. Parsed normally, the template is consumed and the canvas inside is live at once (`/slot-bare/#template`). |
| Continuous `ctx.rotate(Math.sin(t / 900) * 0.04)` with `drawElementImage()` at 60 fps on Metal GPU | flickers (Chrome 157 & 160, Apple M4 Pro, 2026-11-23) | Entire text lines vanish for single frames (20 drops in 1.2 s in Chrome 157, 21 in Chrome 160), both inside `<canvas-slot>` and on a plain `<canvas content="drawable">` with no shadow DOM. Replacing `ctx.reset()` with `clearRect()` did not stop it; keeping rotation fixed per card and animating translation only dropped flickers to 0 across 89 frames (C157) and 87 frames (C160). |
