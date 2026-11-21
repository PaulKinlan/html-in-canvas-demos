# Media controls and element state (`/media-state/`)

Backlog group 23 in PLAN.md, ideas 23.1 to 23.4. Measured in headless Chromium 157 (C157) on 2026-11-21 at 412 px wide. The page's eight live checks pass there, and `node tools/media-state/check.mjs` drives the demos by touch and opens the receiver in a second tab (21 steps, all pass). Nothing here has been run on a phone, and no cast device or second screen was available.

The questions: if media controls were ordinary elements with parts and states, what could a canvas do with them (23.1)? Can element state drive an effect through CSS alone (23.2)? Does `drawElementImage()` take a pseudo-element or a `::part()` (23.3)? Can the composed canvas be cast (23.4)?

| Experiment | Result | Why |
|---|---|---|
| `<media-bar>`, a custom element with four parts in an open shadow tree, as a `drawable` canvas child | drawn as one picture, controls work by touch | The mock of customisable media controls. `public/media-state/media-bar.js`. |
| A part of that shadow tree with the `drawable` attribute, passed to `drawElementImage()` | drawn as its own picture, pixels only at its place | A descendant in an open shadow tree counts as a descendant of the canvas. |
| The play part drawn at 2.2 times its size, the timeline stretched to the canvas width | hit region of the play part more than 55 px tall, of the timeline 335 px wide | Input follows each part's own draw. A tap at three quarters of the stretched timeline moved the film to 7.7 s of 10. |
| A part without `drawable` | `InvalidStateError` | "Descendants passed to DrawElementImage must have the 'drawable' attribute." Only the component can add it. |
| `drawElementImage(element.pseudo('::before'), …)` | `TypeError` | `Element.pseudo()` exists and returns a `CSSPseudoElement`. The method takes `(Element or ElementImage)` only. |
| `drawElementImage(shadowRoot, …)` | `TypeError` | |
| The pseudo-element drawn apart anyway | two clipped draws of the whole element | Works only for a pseudo-element whose box the style sheet fixes. The link in the quote still answers at its drawn place. |
| `canvas:has(media-bar:state(playing)) { --fx-amount: 1 }` | 0 before, 1 while playing, 0 after pause | Custom states from `ElementInternals.states` are selectors like any other. |
| A change of custom state and `paint` | 3 of 14 paint events in 0.4 s of play named the bar | The state change raises `paint` because the play button's label and the time change. A state that changed no pixel would not. |
| `:has(:checked)`, `:has(details:open)`, `:has(:popover-open)` | each number 0, then 1 | The popover is a sibling of the canvas. The rule is on their common ancestor. |
| `:has(:user-invalid)` (tool script, typed text and blur) | `--fx-x` between 0 and 1 after 0.25 s, 1.00 after the transition | Also matches after Save is pressed with the required field empty. |
| A 0.3 s transition of a registered custom property on the canvas | 1 `transitionrun`, 1 `transitionend`, value 0.44 at 150 ms, 0 paint events | The canvas asks for frames between the two events. After them the status line did not change for 0.8 s. |
| `canvas.captureStream()` on a drawable canvas, to a second `RTCPeerConnection` in the page | 200 by 80 video after 106 ms | The cast path without a second screen. |
| The stream of the first demo to `receiver.html` in a second tab, signalling over a BroadcastChannel | 378 by 288 video in the receiver | The same receiver code that a Presentation screen would run. |
| Remote Playback for a `<video>` that shows the canvas stream | "not available", `prompt()` rejected with `NotAllowedError` | No device in the test browser. |
| `PresentationRequest` for the receiver page | `getAvailability()` false, `start()` rejected with `NotFoundError: No screens found` | No screen in the test browser. |
| A lost context | plain HTML | One `contextlost` event stops the three canvases and shows the video, the bar, the form and the quote as plain HTML (3 boxes). Tested by dispatching the event. |

## Things that bit

- The sender waited for `iceGatheringState` to be `complete` before it sent its offer, and in the tool script that never came within 10 s while the receiver tab was in front. The wait is now 2 s at most.
- In one tool run the screenshot of the receiver tab showed the glass boxes without the play, time and timeline parts. Taking the screenshot puts the sending tab in the background. In a single tab the stream had the same number of orange pixels as the canvas, as one picture and as four, with the canvas on screen and off, and after a pause and play off screen.
- The form's grid children needed `min-width: 0`, or the email field was drawn past the edge of the card.
- The status line of the bar ended a number with a full stop, and the tool's pattern `[\d.]+` took the stop as part of the number.

## Not verified

- Chrome 159 on Android: the four demos by touch.
- Remote Playback and Presentation on a network with a Chromecast or a second screen. Whether Remote Playback offers any device for a video whose source is a `MediaStream`.
- The Presentation branch of `receiver.html` (`navigator.presentation.receiver`). Only the tab branch has run.
- The cast between two devices. The offer carries host candidates only and there is no TURN server, so it is expected to work on one network and not across two.
- Why the receiver's frame missed three parts while the sending tab was in the background.
- Whether a `drawable` part is left out of its host's picture when the host is drawn whole. The page never draws both in one frame.

## For the index

- Shadow DOM: an element in an open shadow tree of a canvas child is drawn as its own picture, with its own hit region, when it has `drawable`. Without the attribute `drawElementImage()` throws `InvalidStateError`. C157, `/media-state/`.
- Pseudo-elements: `drawElementImage()` throws `TypeError` for a `CSSPseudoElement` and for a `ShadowRoot`.
- CSS state: `:state()`, `:checked`, `details:open`, `:user-invalid` and `:popover-open` set registered custom properties on a canvas through `:has()`. A transition of such a property raises `transitionrun` and `transitionend` on the canvas and no `paint`.
- Streams: `captureStream()` of a drawable canvas carries the drawn elements and reaches another page over WebRTC.
- Backlog: ideas 23.1 to 23.4 are built on `/media-state/`. Casting to a real device is not verified.

## API requests

- `drawElementImage()` that takes a `CSSPseudoElement`, and a way to draw a named `::part()` of a tree the page cannot open, such as the native media controls.
