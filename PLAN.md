# Plan

The goals of this project, the strands of work and their status, every open idea with its source, and what is still unverified because it needs real hardware. Status is as of 2026-11-21. Results are in [FINDINGS.md](FINDINGS.md). How the code is organised is in [ARCHITECTURE.md](ARCHITECTURE.md).

This file has one writer at a time. A pull request that adds or changes a page does not edit it: the page's open ideas and unverified items go in its file in [findings/](findings/), and a planning pass copies them here. The reason is in [ARCHITECTURE.md](ARCHITECTURE.md), "Files that parallel branches share".

## Contents

- [Goals](#goals)
- [How the work is run](#how-the-work-is-run)
- [Strands and status](#strands-and-status)
- [Open pull requests](#open-pull-requests)
- [Planned demos from the Chrome APIs plan](#planned-demos-from-the-chrome-apis-plan)
- [Open ideas by strand](#open-ideas-by-strand)
- [Ideas from the element catalogue](#ideas-from-the-element-catalogue)
- [Site-wide work that is open](#site-wide-work-that-is-open)
- [Not verified: needs real hardware or a person](#not-verified-needs-real-hardware-or-a-person)
- [Reports to make upstream](#reports-to-make-upstream)

## Goals

The goals below are Paul Kinlan's, quoted or summarised from the project chat with the date he said them.

1. **A playground for the HTML-in-canvas API** (2026-11-20). The repository is a place to push the limits of the API and try new UI primitives. It is not one demo. His opening brief named slots in a canvas first ("the slot element allows us to reproject DOM inside"), then OffscreenCanvas, reprojecting parts of one DOM into another page or tab, and cross-origin sharing with `postMessage` and transferables.
2. **Explore widely** (2026-11-20). "I want to explore many different types of things we could do with html in canvas and I want you to riff with on it. Start with more ideas. Use your imagination." When given sixteen ideas in five groups he answered "Let's do all of them."
3. **Named areas** (2026-11-20): three.js, WebGL and WebGPU integration; cross-origin reprojection; how accessibility holds up; new application primitives; a drop-in custom element or simple API that any developer could install. He asked that the `<canvas-slot>` element be kept as it is and extended compatibly.
4. **A learning resource and a source of ideas** (2026-11-20). Every demo shows its code: "I need this to be very clear what to do."
5. **Experiments, not lessons** (2026-11-20). "There's a lot of this where I want to push the capabilities and new experiments. Slots, canvas slot, dom-portal are not really learning paths, they are me wanting to experiment with the boundaries of what is possible or not." Only `/start/` is a tutorial. Experiments come first on the homepage and in the menu.
6. **Plain technical writing** (2026-11-20). He objected to the heading "One element, two places" as generated-sounding. Rules are in [DESIGN.md](DESIGN.md).
7. **WebGPU when available** (2026-11-20), with WebGL and then 2D behind it.
8. **It must work on his phone.** He tests every page on Chrome 159 on an Android phone and reports what breaks.
9. **Effects that are dynamic and visually strong** (2026-11-21). He found `/player-parts/` underwhelming because it showed placement of the controls, and asked for effects where the parts act on each other. On the first fiery-eye lens he said it was "not a very good lens": he wanted the page's own letters to burn. An effect should transform the page content, not paint decoration over it.
10. **New strands on 2026-11-21**: a customisable select, a catalogue of every HTML element, research on native UI frameworks (Qt, Flutter and others), video and media, text selection effects, and a survey of the last 20 to 30 Chrome releases for features to combine with the API ("comprehensive and expressive and out there ideas"), followed by building the planned demos.
11. **The repository holds what was learned** (2026-11-21), so other tools can work from it. That request produced this file and its siblings.

## How the work is run

- Build the test even when it is expected to fail. Let it fail visibly, record the finding, then try the alternatives one after another. Try every transport or route, not only the first one that works.
- Do not ask clarifying questions. Make a sensible choice, say which one was made, and carry on.
- When there is a plan, carry it out. Do not hand back a list of decisions.
- Each strand has its own long-running thread and ships small pull requests. Pull requests are merged quickly, often within seconds of opening.
- Ideas are wanted from whoever is doing the work, in addition to the ideas listed here.

## Strands and status

| Strand | Pages | Libraries | Pull requests | Status |
|---|---|---|---|---|
| Slots | `/slot/`, `/slot-bare/`, `/slot-bare/plain.html` | `canvas-slot.js`, `light-slots.js` | #1, #2, #5, #23, #30, #31 | Done. The mount-point pattern from the ExtensibleWebApps repository was studied and added (`/slot/mount.html`). |
| Workers, tabs, origins | `/offscreen/`, `/cross-tab/`, `/cross-origin/`, `/transports/` | `slot-share.js`, `broker.js` | #1, #2, #3, #18 | Done. 49 transport routes tested. New routes are planned (demo 18). |
| Cross-context | `/tear-off/`, `/remote/`, `/embed/`, `/support/`, `/slot-view/`, `/pip/` | `live-*.js`, `slot-view.js`, `slot-provider.js`, `element-pip.js`, `src/cross-context.js` | #9, #15, #26, #35 | Built. Not verified between two real networks or with a real cross-site pair. Demos 18 and 22 are assigned to this thread. |
| UI primitives | `/portal/`, `/lens/`, `/shader-css/`, `/slot-effects/`, `/physical/` | `surface.js`, `dom-portal.js`, `dom-lens.js`, `lens-gl.js`, `lens-gpu.js`, `shader-fx.js`, `effects.js`, `slot-effects.js`, `physical-ui.js`, `fx.js` | #6, #12, #17, #19, #28, #32, #33, #42, #44 | Built. Five pages still gate their checks behind a tap. Demo 21 (component kit) is assigned to this thread. |
| Form controls | `/select/`, `/datalist/`, `/inputs/` | `select-picker.js`, `placed-popover.js`, `datalist-picker.js`, `input-pickers.js` | #45 | Built. Not tried on a phone. |
| Transitions and motion | `/transitions/`, `/view-transitions/`, `/time-scrubber/`, `/particles/` | `live-transition.js`, `dom-rewind.js`, `glyph-field.js` | #4, #8, #10, #20, #27, #43 | Built. |
| WebGPU across the shader pages | the six shader pages and `/lens/` | `shared/backend.js`, `shared/route-switch.js`, `gpu-util.js` | #33, #37, #42 | Built. Confirmed on screen on the phone for `/shader-css/` only. Demo 26 is assigned to this thread. |
| 3D and spatial | `/three-form/`, `/board/`, `/xr/` | `html3d.js`, `check-fixture.js` | #11, #21, #25 | Built. three `WebGPURenderer`, a real headset and Android AR are not verified. Demo 24 is assigned to this thread. |
| Native UI toolkits | `/native-ui/` | `native/egui-dom/`, `native/qt-dom/`, `docs/native-frameworks.md` | #47 | Built for egui and Qt Quick. Eight follow-up experiments are listed below. Demo 28 is assigned to this thread. |
| Video and sound | `/video/`, `/overlay/`, `/audio/`, `/player-parts/`, `/player-fx/` | `video-export.js`, `webm-mux.js` | #46, #51 | Built. Hardware decoding and sound are not verified. Demo 19 (media state) landed in #51 as additions to the media pages. |
| Accessibility, capture, performance | `/a11y/`, `/capture/`, `/perf/` | `a11y-audit.js`, `element-capture.js` | #7, #13, #14, #16, #22, #24 | Built. By-hand results (screen reader, IME, flicker, frame rates) are still wanted. Demos 10, 17 and 20 are assigned to this thread. |
| Pages that hold still | every page | `tools/jank/`, `shared/support.js`, `shared/nav.js` | #29 and the per-page fixes #23 to #28 | Done. All pages hold still on load. Gated pages carry `<meta name="checks" content="tap">`. |
| Show the code | every page | `shared/show-code.js`, `shared/source-view.js` | #30, #34 | Done. The two listing components could be unified. |
| Learning resource | `/start/`, homepage, `shared/learn.js` | | #36, #38, #39, #40, #41 | Done. Open recommendations are listed below. |
| Element catalogue | `/elements/`, `ELEMENTS.md` | `tools/elements/` | #48 (open) | Built, waiting to merge. 121 ideas, none built. |
| Text selection | `/selection/`, `/caret/` | `selection-fx.js` | #49, #52 | Built. Demo 9 (carets and highlights) landed in #52 as `/caret/`. Touch selection is not verified. |
| Chrome APIs plan | `/chrome-apis/`, `/chrome-apis/probes.html`, `/chrome-apis/plan.md` | `tools/chrome-apis/` | #50 | Plan written, 27 probes recorded. Building the 28 demos started on 2026-11-21. |
| AI and input (plan demos 12 to 16) | `/translate-lens/`, `/agent-view/`, `/voice/`, `/nav-shader/`, `/focus-nav/` | `text-twin.js` | #61 | Demos 12 to 16 built. No model, WebMCP or microphone in the test browser, so each page runs on a labelled fallback there. |
| Lost canvases on new pages | new pages | shared fix | none yet | In progress in its own thread. See "Site-wide work that is open". |

## Open pull requests

On 2026-11-21 at 14:40 UTC:

| PR | Title | Adds |
|---|---|---|
| #48 | `/elements/`: every HTML element inside a drawable canvas, measured | `public/elements/`, `ELEMENTS.md`, `tools/elements/record.mjs`, `npm run record:elements` |
| #50 | Plan: Chrome 130 to 160 features combined with HTML-in-canvas, with probes | `public/chrome-apis/`, `docs/chrome-apis-plan.md`, `tools/chrome-apis/`, `npm run build:plan`, `npm run record:probes` |

Each of them appends a section to FINDINGS.md. Merged the same day while this file was being written: #49 (`/selection/`), #51 (`/player-fx/` and the media state additions) and #52 (`/caret/`).

## Planned demos from the Chrome APIs plan

Source: `tools/chrome-apis/demos.json` and `public/chrome-apis/plan.md` (written by `npm run build`). The plan surveys the 678 features that chromestatus.com lists for Chrome 130 to 160, has an idea for 359 of them, and ranks 28 demos in three tiers. The full description of each demo (what it shows, how to build it, what was measured, what is uncertain) is in the plan document. When a demo ships, set `"built": "/path/"` on its entry in `demos.json` and run `npm run build:plan`.

"Thread" is the project thread the demo was assigned to on 2026-11-21. By 14:40 UTC that day two had shipped: demo 9 as `/caret/` (PR #52) and demo 19 as additions to the media pages (PR #51, FINDINGS.md "Media state, lazy loading, the iframe policy, output latency"). Check `demos.json` and the open pull requests for the current state.

| # | Key | Demo | Tier | Thread |
|---|---|---|---|---|
| 1 | `stream-materialise` | Streamed HTML that the canvas draws as it arrives (`streamAppendHTML()`, Prompt API or Workers AI) | next | Build demos from Chrome APIs plan |
| 2 | `carousel-3d` | A CSS-only carousel (`::scroll-marker`, `::scroll-button()`) drawn as a cover flow | next | Build demos from Chrome APIs plan |
| 3 | `popover-tips` | Native popovers, hints (`interestfor`) and commands (`commandfor`) on warped surfaces | next | Build demos from Chrome APIs plan |
| 4 | `hdr-glow` | HDR interface: elements brighter than white in a `float16` canvas | next | Build demos from Chrome APIs plan |
| 5 | `css-uniforms` | Shader uniforms written in CSS only (typed `attr()`, `@function`, `if()`, `sibling-index()`, `random()`) | next | Build demos from Chrome APIs plan |
| 6 | `scroll-fx` | Scroll-linked shaders with no scroll listener | next | Build visual effect demos from plan |
| 7 | `shape-ui` | CSS shapes (`corner-shape`, `border-shape`, `shape()`) lit as solid objects | next | Build visual effect demos from plan |
| 8 | `text-labels` | Text measured by CSS for textures, signs and particles (`text-box-trim`, `text-fit`, `OpaqueRange`) | next | Build visual effect demos from plan |
| 9 | `caret-fx` | Carets, highlights and editing drawn through shaders | next | Build text selection effects |
| 10 | `caps-in-canvas` | What a canvas may not see or wrap: permission elements, `:visited`, system colours, spelling markers, autofill previews, cross-origin iframes | next | Audit accessibility, capture and performance |
| 11 | `sensor-parallax` | Tilt the phone to light a live card | next | Build visual effect demos from plan |
| 12 | `translate-lens` | A lens that translates, simplifies or summarises what is under it | then | Build AI and input demos from plan. Built: `/translate-lens/` |
| 13 | `agent-view` | An agent operating a canvas UI through WebMCP tools, drawn as it happens | then | Build AI and input demos from plan. Built: `/agent-view/` |
| 14 | `voice-ui` | Speak a label to press what the canvas draws | then | Build AI and input demos from plan. Built: `/voice/` |
| 15 | `nav-shader` | Page navigations drawn by a shader that starts at the clicked link (Navigation API) | then | Build AI and input demos from plan. Built: `/nav-shader/` |
| 16 | `focus-nav` | Controller, keyboard (`focusgroup`) and haptic navigation of drawn UI | then | Build AI and input demos from plan. Built: `/focus-nav/` |
| 17 | `perf-latency` | Latency from DOM change to canvas pixels, and a device tier | then | Audit accessibility, capture and performance |
| 18 | `transport-2` | New routes for the transport lab and the remote component (WebTransport, Element Capture, worker input) | then | Share live widgets across contexts |
| 19 | `media-states` | Media state pseudo-classes for canvas-drawn players | then | Explore video and media APIs |
| 20 | `capture-print` | Capture additions: clipboard, print margins, files | then | Audit accessibility, capture and performance |
| 21 | `component-kit` | The custom elements packaged with newer DOM features (scoped registries, Reference Target, `using`, Observable) | then | UI primitives thread |
| 22 | `iframe-tiles` | Iframes as tiles: sizing, prerender and limits | then | Share live widgets across contexts |
| 23 | `foldable` | DOM drawn across a fold | hardware | Build hardware demos from plan |
| 24 | `xr-real` | HTML panels in a real room (hands, planes, depth, quad layers) | hardware | Put live HTML into 3D scenes |
| 25 | `hardware-out` | Live DOM on physical devices (Stream Deck, receipt printer, LED matrix) | hardware | Build hardware demos from plan |
| 26 | `webgpu-pipeline` | WebGPU features for element textures (compatibility mode, dual source blending, `primitive_index`, immediates) | hardware | WebGPU thread |
| 27 | `window-chrome` | An installed app whose window frame is a canvas | hardware | Build hardware demos from plan |
| 28 | `wasm-ui` | WebAssembly toolkits (JSPI) and WebNN models over live elements | hardware | Research native frameworks in canvas |

Guidance given to every thread building these (2026-11-21): ship in small pull requests of two or three demos, let a demo that fails on the API fail visibly with the finding recorded, start each page on its lightest effect, create one graphics context per page where possible, keep live checks behind a tap, recover from a lost context with a message, and favour dynamic, visually strong effects. The hardware-tier demos are built with a simulated fallback (a fold control, a simulated device panel, a simulated title bar) because the cloud browser cannot verify the real thing.

Four probe results differ between the two test browsers (Chromium 157 and 153) and are wanted from Chrome 159 on the phone: anchor positioning from outside the canvas, `interestfor`, `highlightsFromPoint()` and `OpaqueRange` rects. All four are about where the browser thinks a drawn element is.

## Open ideas by strand

Every item here is unbuilt. The source is the FINDINGS.md section, the page, the pull request or the project note that lists it.

### View transitions

Source: FINDINGS.md, "View Transitions API", "Not tried yet".

- Drive a WebGL or WebGPU shader from the canvas-scoped transition clock.
- A scoped transition on an ancestor with a canvas-scoped one nested inside it.
- Navigation API `intercept()` with a shader for single-page route changes (also demo 15).
- `view-transition-class` and nested groups with one canvas per list item.
- One page-wide canvas that draws every transition itself.
- Use a child's group box as a timing source.

### Transitions and motion

- Feed `<dom-rewind>.frames()` to a real video encoder. `encodeFrames()` in `element-capture.js` takes the same `{ time, bitmap }` shape. Source: FINDINGS.md, "Transitions and motion".
- Hit testing for two pointers at once on shards or glyphs. One element has one hit box. Source: FINDINGS.md summary.

### Video and sound

Source: FINDINGS.md, "Video and sound", "Further experiments". Each item has a paragraph there.

- WebGPU external textures (`importExternalTexture(video)`) composed with element textures in one pass.
- A worker as the compositor: `MediaStreamTrackProcessor`, transferred `ElementImage` overlays, `VideoTrackGenerator`.
- A presenter over live slides (alpha or segmented camera over a DOM slide).
- Live captions from `SpeechRecognition`, and the Translator API for a second language.
- Timed comments that cross the video as clickable DOM.
- A title editor: clips, HTML title cards, the `/transitions/` shaders between clips, `exportFrames()`.
- A screen-share telestrator (`getDisplayMedia()` with HTML annotation tools).
- A cinema screen in the `/three-form/` scene with a `PannerNode` at the screen.
- Video as a material for text.
- Animated images (GIF, APNG, WebP, AVIF, SVG SMIL, Lottie) as canvas children: does `paint` fire per frame?
- A `display-p3` canvas with HDR or wide-gamut video.
- Casting the composed stream with the Presentation or Remote Playback API.
- A player skin as a shader on the timeline strip only.
- A proposal to test: `drawElementImage()` taking a pseudo-element or a `::part()`.
- Customisable media controls mocked with a custom element.
- State pseudo-classes on other elements (`:open`, `:popover-open`, `:user-invalid`, `:checked`) driving `--fx-*` through `:has()`.
- Word-by-word highlighting from `SpeechSynthesis` boundary events.
- A WebGPU version of the `/player-fx/` shader. Source: FINDINGS.md, "One shader over the controls and the frame".

### Customisable select, datalist and inputs

Source: the "ideas" lists on `/select/`, `/datalist/` and `/inputs/` (PR #45).

- A lens over a long option list.
- Physical options (cloth or jelly).
- A map or seat plan as a picker.
- A colour select that samples pixels.
- A transition that carries the chosen option into the button.
- `<select multiple>` drawn by a canvas.
- A range input bent round a dial.
- A date range on one calendar.
- A colour wheel that reads its own pixels.
- A week picker on a year view.
- Ghost-text suggestion in the input.
- Rich suggestions through a customisable select with no button.

### Text selection

Source: the ideas list on `/selection/`.

- Other people's selections, selected glyphs as particles, a share card, selection in 3D, a heat map, a minimap, redaction, translate in place, haptics, selection effects for form controls.

### Native UI toolkits

Source: `docs/native-frameworks.md`, "Ideas for further experiments".

1. Flutter web showing a DOM element through `createImageFromTextureSource()`.
2. Qt Widgets: `drawElementImage()` on a raster window's 2D canvas after Qt's flush.
3. A Qt Quick `TextField` backed by an `<input>`, compared for IME and autofill on Android.
4. Dear ImGui with Emscripten: one `ImGui::Image()` call.
5. Unity or Godot: a DOM chat box and login form on a quad in a 3D scene.
6. A framework's ARIA tree inside the canvas, positioned with `updateElementGeometry()`.
7. Occlusion without a guard: can `canvasClip` express "this window covers that field"?
8. Real-device checks: IME in a DOM field inside egui, native pickers for a rotated field in Qt Quick, TalkBack over both apps.

### fx library

Source: PR #44 and the project notes.

- An npm package. Publishing is the project owner's decision.
- TypeScript types.
- A minified build.

### Cross-context

- Safari and Firefox as viewers. The viewer pages are written not to need the API. Source: FINDINGS.md, "Cross-context".
- A real cross-site pair of origins. The two deployed Workers are same-site. Source: project notes.

### 3D and spatial

- The form as an `XRQuadLayer`. Written, opt-in, not verified. Source: FINDINGS.md, "3D and spatial".
- A way to hand the browser a ray hit and receive a trusted event. This is an API request, listed in FINDINGS.md.

## Ideas from the element catalogue

Source: `ELEMENTS.md` (PR #48), generated from `public/elements/notes.js` and `ideas.js`. 121 ideas: 28 at rank 1 (build next), 60 at rank 2, 33 at rank 3 (small, speculative or blocked). Each has the elements it needs and whether the recording says it is possible. None is built.

Rank 1:

- Picker wheel from `select multiple`.
- Mixing desk from rotated range inputs.
- Step sequencer from a grid of checkboxes.
- Textarea as a CRT terminal.
- Rotary switch from a radio group.
- Odometer for a number input.
- Form on a prism, one fieldset per face.
- Animated diff from `ins` and `del`.
- MathML terms that move between steps.
- Marker-pen highlight on `mark`.
- Keycaps from `kbd`.
- Television with native controls and captions.
- Image map on a perspective floor plan.
- Cassette deck from audio controls.
- Table cells that extrude into a bar chart.
- Cover flow from a `ul`.
- Radial menu from a `menu` element.
- Sortable table with rows that travel.
- Find in page that moves the camera (`hidden=until-found`, `beforematch`).
- Accordion that unfolds (`details`).
- Live minimap of a page.
- In-canvas dialog with a canvas backdrop (`dialog open`, `position: static`).
- Anchored popover call-outs on drawn elements.
- LED ticker from a `marquee`.
- Tab switcher of live pages (same-origin iframes).
- Editable `style` element drawn in the scene.
- Set `inert` on undrawn children automatically.
- Focus order shown as a path.

Rank 2 and rank 3 are in `ELEMENTS.md` under "Ideas". Rank 2 includes developer tools drawn by a canvas (layout debugger overlay, paint event inspector, hit region viewer, landmark map, heading outline) that would also serve this project's own testing.

## Site-wide work that is open

| Item | Source | Notes |
|---|---|---|
| Canvases losing their graphics context on load on the phone | Phone reports 2026-11-21, thread "Fix lost canvases on new pages" | New pages showed a white box with a broken-picture icon on Chrome 159 on Android. The suspected cause is several WebGL contexts and a WebGPU device opened at once. The cause is not confirmed. A shared fix is being built. Until it lands, follow the rules in ARCHITECTURE.md, "How to add a page", step 8. |
| Pages whose checks wait for a tap | `<meta name="checks" content="tap">` in each page (`grep -l 'name="checks"' public/*/index.html`) | Nineteen pages on 2026-11-21. `/portal/`, `/lens/`, `/shader-css/`, `/physical/` shift by 0.25 to 1.03 with checks forced on because `#check-bench` grows and shrinks. `/slot-effects/` shifts by 1.40 and covers over 40% of the screen. `/cross-origin/` scrolls 990 px. `/remote/` moves focus four times. A fixed-size bench would probably fix the bench cases. |
| A flaky check | project notes | `/lens/`: "Pinned lens: clicks land on the magnified drawing". |
| `<dom-portal>` in viewport mode resizes its canvas on every `innerHeight` change | project notes | This clears the canvas when a phone's URL bar moves. |
| `testStage()` takes taps while checks run | FINDINGS.md, "Video and sound" | The media pages wrap it with `pointer-events: none`. Other pages still have the problem. |
| `SurfaceElement` listens for `contextlost` only | FINDINGS.md, "Text selection" | WebGL fires `webglcontextlost`. Subclasses listen themselves today. |
| Canvases that go soft at 150% zoom | FINDINGS.md, "Accessibility" | `/slot-bare/`, `/offscreen/`, `/cross-origin/`, `/transitions/`, `/time-scrubber/`, `/particles/` at the time of the audit. PR #43 fixed the motion elements under CSS zoom. Re-run the audit to confirm which remain. |
| No `prefers-reduced-motion` handling | FINDINGS.md, "Accessibility" | `/slot/`, `/transitions/`, `/particles/`. |
| Unlabelled pixel-only canvases | FINDINGS.md, "Accessibility" | `/cross-origin/`, `/transports/`. |
| "Use it" block for every library | learning-resource review, PR #36 | A short "how to use this on your own page" block per library. Only `/shader-css/` has one. |
| Real-GPU recordings for the homepage | learning-resource review | The thumbnails are from software rendering. |
| Check the stated floor of Chrome 148 | learning-resource review | The pages say "Chrome 148+". Nothing older than Chromium 153 was tested. |
| Unify `show-code.js` and `source-view.js` | PR #34 | Two listing components exist. |
| Split FINDINGS.md | learning-resource review | Done 2026-11-21: one file per strand in `findings/`. The index, bug list and API requests in `FINDINGS.md` are not yet split and are updated in a documentation pass. |
| No CI | this document | `check:jank` and `check:fx` are run by hand. A GitHub Action would need Playwright with a Chromium that has the API. |

## Not verified: needs real hardware or a person

The cloud browser that every result was measured in is headless Chromium 157 (and 153 for some probes) with software rendering, no GPU, no sound card, no native popup windows, no outbound UDP and no immersive WebXR. Everything below is unverified for that reason. Each page has live checks or a button that answers the question on the device that opens it.

Confirmed on the phone so far: the jank fixes ("I think it all works", 2026-11-20, no pages named), and WebGPU on screen on `/shader-css/` ("Drawn with WebGPU (6), WebGL (1)", 2026-11-21).

| Area | What is unverified | How to verify |
|---|---|---|
| WebGPU | Every on-screen WebGPU path except `/shader-css/`; its speed against WebGL; three `WebGPURenderer` | Open each shader page and read the "Drawn with" line and the two WebGPU check rows. `/three-form/?renderer=webgpu`. |
| Lens | Frame times on a real GPU; whether Chrome on Android keeps the sub-rectangle canvas-to-texture copy on the GPU | "Measure on this device" on `/lens/`. |
| Built-in AI | `Translator`, `Rewriter`, `Summarizer` filling the lens copy; the Prompt API planning tool calls and describing a picture | `/translate-lens/` and `/agent-view/`: the line under each demo lists what the browser reports; press "Use ... on this device" and run the live checks. |
| WebMCP | Whether Chrome 159 has `registerTool()` or `provideContext()`, and an agent calling the tools | `/agent-view/` with the WebMCP flag on: the first chip under the demo and the first live check. |
| Speech | Recognition, on-device processing, the effect of `phrases`, result timestamps, and whether `SpeechRecognition.available()` crashes outside headless | `/voice/`: press "Listen", say "lamp", and read the line under the demo. |
| Navigation shader | The ink shader in WGSL on screen, the Back gesture of the phone and its preview animation, taps on either view part way through a transition | `/nav-shader/`: tick "Slow", tap a card, tap inside both views while the shader runs, then go Back. Run the live checks for the WebGPU comparison. |
| Controller and focus | A real game controller (mapping, vibration, the `rawgamepadinputchange` origin trial), whether the phone vibrates on each move, the direction pad by thumb, a screen reader on each move | `/focus-nav/`: use the direction pad and the A button, then connect a controller and read the line under the demo. |
| Performance | The real performance wall and frame rates | `/perf/?run=full` on real hardware. |
| Particles | Whether the 2D default fixed the white block on Android; its cause | `/particles/` on the phone, then `engine="webgl"`. |
| Lost contexts | Which cause the phone hit on `/embed/` and `/selection/`; whether a 2D drawable canvas fires `contextlost` on Android | Phone, with the page's messages. |
| Touch | Touch dragging in the select pickers; `touch-action` inside a top-layer canvas; touch selection, handles and the copy menu, on a rotated line and with a transparent `::selection`; the loupe under a finger; a first tap on a curved 3D surface | Phone. |
| Native popups | Where the list of a plain `select`, the date, time and colour pickers, datalist suggestions and `title` tooltips open when the element is drawn transformed; whether `readonly` stops the Android date and time dialogs; the suggestions popover above the on-screen keyboard | Phone or a desktop browser with a window. Each row of `/elements/` has a "Draw it here" canvas. |
| Keyboard and IME | Whether the Android keyboard stays down during checks; IME composition and candidate windows; composition underlines in a drawn field | `/a11y/` section C by hand. |
| Screen readers | TalkBack or another screen reader on any page; the accessible proxy on `/embed/`; both `/native-ui/` apps | By hand. |
| Find in page | Whether the find bar's highlight is painted into an element's picture; `hidden=until-found`; `::target-text`; spelling marks | By hand with the find bar open. |
| Capture | Visible flicker during a capture | "Flicker check" on `/capture/`. |
| Video | Hardware-decoded video in the canvas; Widevine and HDR; audible output and audio timing; `AudioEncoder` and seek accuracy on Android; which media state pseudo-classes Chrome 159 has by default; `texImage2D(video)` with a hardware decoder; the touch layout of the controls | First four checks on `/video/`, fourth check on `/player-parts/`. |
| Remote | Any WebRTC connection between two real networks; TURN; the deployed rooms across devices | `/remote/` on two devices. Both ends have a connection log with a Copy button. |
| Vision endpoint | `/api/x/vision` with its real AI binding | `/support/` on the deployed site. |
| Storage partitioning | The BroadcastChannel bridge and the window-name consent route between two real sites | Needs two origins that are not same-site. |
| Consent window on Android | Android opens the `/slot-view/` consent window as a tab | Phone. |
| WebXR | A real headset or Android AR session; whether `paint` keeps firing behind an immersive session; `XRQuadLayer` | `/xr/` in a headset. The page counts paint events in session and shows the result on a panel. |
| Other browsers | Safari and Firefox as viewers of the cross-context pages | By hand. |
| Chrome version | Chrome 159 against the four probe results that differ between 153 and 157; Chrome 148 as the floor | `/chrome-apis/probes.html` on the phone. |
| Native UI | Qt Widgets (2D canvas route) | Not built. |

## Reports to make upstream

FINDINGS.md has two lists near the top: "Chromium bugs worth filing" (crashes and wrong behaviour with a reproduction page for each) and "API changes that would help" (requests that came out of the experiments). Nothing has been filed. Filing is the project owner's decision.
