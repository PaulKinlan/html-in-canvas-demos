// What was found for each element, and what could be built with it.
//
//   found     one or two sentences on the result, written from the measurements in recorded.json
//   inferred  what is expected but was not measured (native popups, things that need a person or a phone)
//   idea      something to build with this element in a canvas
//   demos     pages on this site that already use the element this way
//   build     set on the ideas picked for the "not built yet" list: a short name for the list
//
// An element with no entry of its own shows the note for its group.

export const GROUP_NOTES = {
  forms: { idea: 'Form controls keep their state, validation and keyboard behaviour, so a canvas can change how a form looks (bent, lit, in 3D) without re-implementing any control.', demos: ['/three-form/', '/physical/'] },
  inputs: { found: 'Draws the same as outside the canvas, and typing or stepping with the keyboard changes the value.', idea: 'Use the native field for editing and let the canvas decide where and how it is shown.', demos: ['/three-form/', '/start/'] },
  text: { found: 'Draws as part of its parent. As a direct child of the canvas it becomes a block box (computed display is block), so an inline element is best drawn through a block wrapper.', idea: 'Text stays selectable and searchable, so effects on text can work per glyph from Range rectangles instead of from wrapper spans.', demos: ['/particles/'] },
  grouping: { found: 'Draws and hit tests the same as outside the canvas.', idea: 'Each block is one drawable unit: draw blocks at their own depth, angle or time offset while the document order stays intact for reading and tabbing.', demos: ['/slot/', '/transitions/'] },
  sections: { found: 'Draws and hit tests the same as outside the canvas. The element keeps its role in the accessibility tree.', idea: 'Draw each section as one tile of a larger scene (a board, a cube, a carousel) and keep the landmark and heading structure for assistive technology.', demos: ['/board/', '/a11y/'] },
  tables: { found: 'Draws as part of its table. Drawn as a direct child of the canvas, a table part becomes a block box and loses the table layout, so draw the whole table or a wrapper around it.', idea: 'Read cell positions with getBoundingClientRect() and add canvas drawing between and behind the cells.', demos: ['/board/'] },
  edits: { found: 'Draws with its underline or strike-through.', idea: 'Use the element as the marker for an animated edit: the canvas draws the change happening.', demos: ['/particles/'] },
  obsolete: { found: 'Still parsed and drawn by Chromium.', idea: 'Nothing specific.' },
  metadata: { found: 'No box by default (display: none), so there is nothing to draw and drawElementImage() throws "No cached paint record for element".', idea: 'Nothing to draw.' },
  scripting: {},
  embedded: {},
  interactive: {},
};

export const NOTES = {
  // ---------------------------------------------------------------- forms
  form: { found: 'Draws with its controls. A click on the drawn submit button fires submit.', idea: 'A multi-step form on the faces of a rotating prism: each fieldset is one face, requestSubmit() and constraint validation stay native.', demos: ['/three-form/', '/physical/'] },
  label: { found: 'A click on the drawn label text checks its control.', idea: 'Because a label forwards clicks, the label and its control can be drawn far apart. Draw labels as call-outs around an exploded diagram of a form, joined to their fields by canvas lines.' },
  input: { found: 'Typing works at the drawn position. While the field has focus the caret blink fires paint, so a focused field keeps a canvas repainting.', idea: 'The paint event fires on every keystroke without a listener on the field. Use it to draw a per-keystroke effect (ink spreading from the caret, key travel on a drawn keyboard).', demos: ['/start/', '/three-form/'] },
  button: { found: 'Click works. Moving the pointer over it fires paint, because the hover style changes its picture.', idea: 'Hover and :active reach the canvas as paint events, so a shader can react to button state with no pointer listeners: a press that ripples the surface around the button.', demos: ['/shader-css/', '/physical/'] },
  select: { found: 'The closed control draws and takes clicks. ArrowDown then Enter changes the value.', inferred: 'The list is a native popup window, which headless Chromium does not show. It is expected to open at the drawn hit region, upright and unscaled, whatever transform the canvas used. On Android it is a system dialog. Check on a phone.', idea: 'Draw the closed select inside the scene and accept that the open list is native. For a list that stays inside the scene, use select multiple (next row).' },
  'select multiple': { found: 'The whole list box is drawn in the canvas, clicking an option selects it and the mouse wheel scrolls it.', idea: 'The only form of select whose list is drawn in the canvas. Draw it on a cylinder as a picker wheel: the options are real option elements, the selection is form state, and updateElementGeometry() keeps taps on the right option.', build: 'Picker wheel from select multiple' },
  'select (base-select)': { found: 'The button part draws. The picker opens (:open) but is in the top layer: it is not drawn into the canvas, its options could not be hit (elementFromPoint returns the canvas) and ArrowDown then Enter did not change the value, though the same keys work on the same select outside a canvas. Between runs the picker was sometimes painted by the page under the drawn select and sometimes not at all.', idea: 'A customisable select cannot be used inside a drawable canvas in Chromium 157. Until the picker works there, keep the select outside the drawable subtree, or draw the options yourself from select.options.' },
  selectedcontent: { found: 'Draws the copy of the selected option inside the button of a base-select.', idea: 'The selected option\'s markup is cloned into a real element, so a canvas can draw that element large somewhere else (a hero image for the chosen product) with no script copying content.' },
  datalist: { found: 'No box. The input that uses it draws.', inferred: 'The suggestion list is a native popup and was not observed.', idea: 'Read input.list.options and draw the suggestions in the canvas yourself, for example as a ring of chips around the field.' },
  optgroup: { found: 'Draws inside a list box with its label.', idea: 'In a picker wheel, draw each optgroup as its own ring.' },
  option: { found: 'Draws inside a list box and a click selects it.', idea: 'Options have rectangles (getBoundingClientRect), so a canvas can draw a highlight that slides between options.' },
  textarea: { found: 'Typing works, and dragging the resize handle at its drawn position resizes it.', idea: 'A real textarea drawn through a barrel-distortion and scan-line shader, with the hit region re-placed under the pointer so the caret lands where you tap.', demos: ['/three-form/', '/lens/'], build: 'Textarea as a CRT terminal' },
  output: { found: 'Draws its text.', idea: 'Changing output.value fires paint. Draw the value as a split-flap or odometer display where each digit rolls to the new one.' },
  progress: { found: 'Draws the bar.', idea: 'Read progress.value in the paint handler and draw a liquid fill, while the element stays the accessible progress bar.' },
  'progress (indeterminate)': { found: 'Its animation fires paint continuously with no script.', idea: 'An indeterminate progress element is a clock for the canvas: while it is in the tree the canvas repaints, and when loading ends and it gets a value the repaints stop.' },
  meter: { found: 'Draws the gauge, with its low, high and optimum colours.', idea: 'Draw a dial with a needle from meter.value and keep the element for the accessible value.' },
  fieldset: { found: 'Draws its border, legend and controls.', inferred: 'The disabled attribute should disable every control in the drawn panel.', idea: 'One fieldset is one panel of a scene. Set disabled to switch off a whole drawn panel in one step.' },
  legend: { found: 'Draws in the gap of the fieldset border.', idea: 'Draw the legend as the tab of a folder and the fieldset as the folder body.' },

  // ---------------------------------------------------------------- input types
  'input type=password': { found: 'Draws the masking dots, and typing works.', idea: 'The canvas only ever receives the dots, so a drawn password field can be streamed or captured without the value in the pixels.', demos: ['/support/'] },
  'input type=number': { found: 'ArrowUp steps the value.', idea: 'Draw the value on mechanical counter wheels that roll when the value changes.' },
  'input type=range': { found: 'Dragging the thumb at its drawn position changes the value.', idea: 'Draw range inputs rotated 90 degrees as the faders of a mixing desk. The hit region follows the transform, so no writing-mode or custom drag code is needed.', build: 'Mixing desk from rotated range inputs' },
  'input type=date': { found: 'The day, month and year fields take keyboard input at the drawn position.', inferred: 'The calendar popup is native and was not observed. Check where it opens on a phone.', idea: 'Put the date field on a drawn wall calendar and turn the page to the chosen month when the value changes.' },
  'input type=time': { found: 'The fields take keyboard input.', inferred: 'The picker popup is native and was not observed.', idea: 'Draw clock hands from the value around the field.' },
  'input type=datetime-local': { found: 'The fields take keyboard input.', inferred: 'The picker popup is native and was not observed.' },
  'input type=month': { found: 'The fields take keyboard input.', inferred: 'The picker popup is native and was not observed.' },
  'input type=week': { found: 'The fields take keyboard input.', inferred: 'The picker popup is native and was not observed.' },
  'input type=color': { found: 'The swatch draws.', inferred: 'The colour picker is a native window and was not observed.', idea: 'Feed the value to a shader uniform: the swatch sits inside the scene it recolours.', demos: ['/shader-css/'] },
  'input type=checkbox': { found: 'Click toggles it.', idea: 'A grid of real checkboxes drawn as lit pads. The pattern is form state, so it can be submitted, reset and read by a screen reader.', build: 'Step sequencer from a grid of checkboxes' },
  'input type=radio': { found: 'Click checks it.', idea: 'Draw a radio group as a rotary switch: the checked radio decides the knob angle, and arrow keys already move between positions.' },
  'input type=file': { found: 'A click at the drawn position opens the file chooser.', idea: 'Place the file input on an object in a scene (a drawn scanner or letter box) and draw the chosen images into the scene.' },
  'input type=image': { found: 'Draws the image and takes clicks.', inferred: 'It submits the click coordinates. Whether they are in the element\'s own space when the canvas draws it transformed was not measured.' },
  'input type=hidden': { found: 'No box.', idea: 'Nothing to draw.' },

  // ---------------------------------------------------------------- interactive
  details: { found: 'A click on the drawn summary opens it, and the canvas repaints with the taller picture.', idea: 'The toggle event and the size change arrive without script in the canvas, so the canvas can animate the opening (fold out, unroll) between the two pictures.', demos: ['/transitions/'] },
  summary: { found: 'Click toggles its details.', idea: 'Draw summaries as drawer fronts of a cabinet and each details body as the open drawer.' },
  dialog: { found: 'A closed dialog has no box. show() draws only if the dialog stays inside its drawable ancestor\'s box: with the default position: absolute it is laid out outside that box and is clipped away. showModal() moves it to the top layer, where the page paints it centred in the viewport, and nothing is drawn into the canvas (drawElementImage(dialog) throws "No cached paint record").', idea: 'For a dialog that belongs to the scene, use the open attribute with position: static and set inert on the rest. The canvas then owns the backdrop and can do what ::backdrop cannot: blur, desaturate or shatter the pixels of everything behind the dialog.', build: 'In-canvas dialog with a shader backdrop' },
  'dialog open': { found: 'Draws and takes clicks when it is positioned inside its drawable ancestor.', idea: 'See dialog.' },
  '[popover]': { found: 'The popover opens in the top layer and the page paints it; nothing is drawn into the canvas. CSS anchor positioning places it against the drawn position of its anchor, and an open popover moves when the anchor is drawn somewhere else.', idea: 'Anchor popovers to elements drawn on a rotating object. The canvas moves the anchors and the browser keeps upright, sharp labels attached to them, with no positioning script.', build: 'Anchored popover call-outs on drawn elements' },
  '[contenteditable]': { found: 'Click places the caret and typing edits the text.', idea: 'Rich text editing on a surface that is not flat: a page of a book that curls, a note pinned to a board.', demos: ['/particles/', '/board/'] },
  '[title] tooltip': { found: 'The element draws. Its padding overflows the line box and is clipped at the wrapper\'s edge.', inferred: 'The tooltip is native and was not observed.', idea: 'Read the title and draw your own tooltip in the scene.' },
  a: { found: 'A click on the drawn link navigates.', inferred: ':visited styling is not painted into the canvas (the explainer excludes it so pixels can be read back).', idea: 'Links stay links in any projection: text on a 3D object or in a headset can be opened in a new tab, copied and focused with Tab.', demos: ['/particles/', '/xr/'] },
  '[tabindex]': { found: 'Click focuses it, and the focus ring is part of the drawn picture.', idea: 'Make scene objects focusable with a tabindex element drawn on each, so Tab walks the scene in DOM order.', demos: ['/a11y/'] },
  '[draggable]': { found: 'A mouse drag fires dragstart, drag and dragend.', inferred: 'The drag image the browser shows was not observed.', idea: 'Native drag and drop out of a scene: drag a drawn card to another window or the desktop, with setDragImage() given the canvas pixels of the card.' },
  '[inert]': { found: 'A click on a drawn inert subtree goes to what is behind it.', idea: 'FINDINGS.md lists one accessibility hazard: children that are in the canvas but not drawn are still focusable. Setting inert on every child the paint handler did not draw closes it.', demos: ['/a11y/'], build: 'Set inert on undrawn children automatically' },
  '[hidden=until-found]': { found: 'No box while hidden.', inferred: 'Find in page should fire beforematch and reveal the content, after which it has a box and can be drawn. This needs a person: window.find() does not trigger it.', idea: 'Put the text of every panel of a 3D scene in hidden=until-found sections and fly the camera to the panel on beforematch.', build: 'Find in page that moves the camera' },

  // ---------------------------------------------------------------- embedded
  img: { found: 'Draws.', idea: 'Draw the img through a shader and leave the element in place for alt text, the context menu ("Save image as") and drag out.', demos: ['/lens/', '/capture/'] },
  'img (SVG file)': { found: 'Draws.', idea: 'An SVG image is rasterised at the size it is drawn, so it stays sharp when the canvas zooms.', demos: ['/board/'] },
  'img (animated)': { found: 'Draws, and every animation frame fires paint with no script.', idea: 'An animated image keeps the canvas painting at frame rate. Use it as the only moving input to a shader, or remove it to stop the repaints.' },
  'img (other origin, no CORS)': { found: 'Blank. The box is there and takes clicks, but no pixels are drawn.', idea: 'Load cross-origin images with crossorigin="anonymous" and CORS headers when they must appear in a canvas.', demos: ['/capture/'] },
  picture: { found: 'Draws the chosen image.', idea: 'Let the browser pick the texture resolution: set the img width from the size the element has on screen in the 3D scene, and srcset and sizes select the file.' },
  source: { found: 'No box.', idea: 'See picture.' },
  svg: { found: 'Draws, and the shapes inside are hit targets.', idea: 'An SVG chart as a live texture: hover styles and links on its shapes keep working while the canvas tilts or lights it.', demos: ['/board/'] },
  'svg foreignObject': { found: 'HTML inside foreignObject draws, and a click reaches a button inside it. foreignObject cannot be the drawable child itself.', idea: 'Nothing beyond svg.' },
  math: { found: 'Draws MathML.', idea: 'MathML tokens are real boxes with Range rectangles, so a canvas can move each term from its place in one line of a derivation to its place in the next.', demos: ['/particles/'], build: 'MathML terms that move between steps of a derivation' },
  canvas: { found: 'A 2D canvas inside the drawn element is drawn with its content.', inferred: 'WebGL and WebGPU inner canvases were not measured.', idea: 'Compose a canvas-based chart with HTML legends and controls in one outer canvas, then export all of it with one call.', demos: ['/capture/'] },
  'canvas (drawable, nested)': { found: 'A drawable canvas inside a drawable canvas works two levels deep, and a click reaches the innermost button.', idea: 'Give a widget its own canvas and effect, then draw the widget, effect included, inside a scene-level canvas with a second effect.', demos: ['/board/'] },
  video: { found: 'The current frame draws, and each new video frame fires paint.', idea: 'The video sets the repaint rate itself. A television in a 3D room needs a paint handler and no frame loop.', demos: ['/transports/'], build: 'Video with native controls and captions on a drawn screen' },
  'video controls': { found: 'The native controls are drawn, and a click on the drawn play button starts playback.', idea: 'Native controls on a drawn screen: play, scrub, mute and captions menus without building a player UI.' },
  audio: { found: 'No box without the controls attribute.', idea: 'See audio controls.' },
  'audio controls': { found: 'The native controls are drawn, and a click on the drawn play button starts playback.', idea: 'A cassette deck: native audio controls drawn on the deck, with an AnalyserNode spectrum drawn behind them in the same canvas.' },
  track: { found: 'No box. The active cue is drawn as part of the video picture.', idea: 'Captions come from DOM, so they can be restyled with ::cue or read from track.activeCues and drawn separately, sharp, while the video frame goes through a shader.' },
  'iframe (srcdoc)': { found: 'The framed document draws, and a click reaches a button inside it.', idea: 'Whole documents as tiles.', demos: ['/board/'] },
  'iframe (same origin)': { found: 'The framed page draws, and a click reaches a button inside it.', idea: 'A tab switcher: every open page of an app as a live, clickable card in a 3D fan.', demos: ['/board/', '/three-form/'] },
  'iframe (other origin)': { found: 'Blank apart from the iframe\'s own border. A click at the drawn position still reaches the button inside the invisible frame.', idea: 'A hazard: a cross-origin frame in a drawable canvas is invisible and still takes clicks. To show another origin, have it send its pixels.', demos: ['/cross-origin/', '/embed/', '/slot-view/'] },
  embed: { found: 'A same-origin SVG document draws.', idea: 'Nothing beyond iframe.' },
  'embed (PDF)': { found: 'Not measured: headless Chromium has no PDF viewer ("Couldn\'t load plugin").', inferred: 'The PDF viewer runs in a separate process like a cross-origin frame, so it is expected to be blank.', idea: 'If it draws on a real browser: pages of a PDF as a 3D book.' },
  object: { found: 'A same-origin SVG document draws.', idea: 'Nothing beyond iframe.' },
  'object (data: URL)': { found: 'Blank. A data: document has its own origin, so it is treated like a cross-origin frame.', idea: 'Serve the document from the same origin.' },
  'object (fallback)': { found: 'The fallback content draws.', idea: 'Nothing specific.' },
  map: { found: 'No box.', idea: 'See area.' },
  area: { found: 'A click on the mapped part of the drawn image follows the area\'s link.', idea: 'Image maps follow the transform. Draw a floor plan or a map in perspective and each area is a link and a focus stop with no hit-testing code.', build: 'Image map on a perspective floor plan' },
  fencedframe: { found: 'The frame border draws. Content was not tested (it needs a fenced frame config).', idea: 'Nothing specific.' },
  geolocation: { found: 'The button draws, but the element reports isValid false with invalidReason "intersection_occluded_or_distorted" inside a canvas (true outside). The browser will not accept a click on it there.', idea: 'Permission elements must be seen unaltered by the user, so they refuse to work in a canvas. Keep them outside the drawable subtree.' },
  permission: { found: 'An unknown element in Chromium 157: it draws as an inline box with its text.', idea: 'See geolocation.' },

  // ---------------------------------------------------------------- text-level
  ruby: { found: 'Base text and annotations draw.', idea: 'A language reader where the annotation (rt) is drawn only near the pointer, from the rt elements\' own rectangles.' },
  rt: { found: 'Draws above its base text.', idea: 'See ruby.' },
  rp: { found: 'No box where ruby is supported.', idea: 'Nothing to draw.' },
  time: { found: 'Draws its text.', idea: 'A time element updated once a second fires paint once a second: draw it as a flip clock.' },
  kbd: { found: 'Draws its text.', idea: 'A shortcut overlay: draw each kbd as a keycap that goes down while the key is held.' },
  mark: { found: 'Draws with its highlight.', idea: 'Replace the flat highlight with a drawn marker stroke along the mark\'s Range rectangles.', demos: ['/particles/'] },
  code: { found: 'Draws its text.', idea: 'Code on a slide that types itself: reveal glyphs in order from Range rectangles while the text stays copyable.', demos: ['/particles/'] },
  br: { found: 'No box of its own.', idea: 'Nothing to draw.' },
  wbr: { found: 'No box of its own.', idea: 'Nothing to draw.' },
  abbr: { found: 'Draws with its dotted underline.', inferred: 'The title tooltip is native and was not observed.' },
  bdo: { found: 'Draws reversed, as outside the canvas.' },
  bdi: { found: 'Draws with its own direction, as outside the canvas.' },

  // ---------------------------------------------------------------- grouping
  p: { found: 'Draws. Dragging across the drawn text selects it.', idea: 'Selection is drawn by the browser into the element\'s picture, so selected text follows any transform the canvas applies.', demos: ['/particles/', '/a11y/'] },
  hr: { found: 'Draws its line.', idea: 'Use hr elements as cut lines: the paint handler splits the document into the slices between them and draws each slice on its own layer.' },
  pre: { found: 'Draws with its white space.', idea: 'See textarea: a pre is the read-only half of a terminal.' },
  blockquote: { found: 'Draws.', idea: 'Pull quotes that leave the column: draw the blockquote a second time, large, behind the text.', demos: ['/portal/'] },
  ol: { found: 'Draws with its numbers.', idea: 'Draw each li at a delay from its index for a staggered entrance, with the list markers included in each picture.' },
  ul: { found: 'Draws with its bullets.', idea: 'Each li is a card in a 3D row, and Tab and screen-reader order follow the list.', build: 'Cover flow from a ul' },
  menu: { found: 'Draws as a list, and the buttons inside take clicks.', idea: 'Make each button a drawable child and draw them rotated around a centre. The hit regions rotate with them.', build: 'Radial menu from a menu element' },
  li: { found: 'Draws with its marker.', idea: 'See ul.' },
  figure: { found: 'Draws image and caption.', idea: 'Run the image through a shader and leave the figcaption as plain text on top.', demos: ['/lens/'] },
  figcaption: { found: 'Draws.', idea: 'See figure.' },
  dl: { found: 'Draws.', idea: 'Glossary cards: dt on the front, dd on the back, flipped in 3D.' },

  // ---------------------------------------------------------------- sections
  h1: { found: 'Draws.', idea: 'Kinetic headings whose glyphs fly in and settle, with the h1 still in the document outline.', demos: ['/particles/'] },
  nav: { found: 'Draws, and the links inside take clicks.', idea: 'Navigation on a ribbon or dial with every link still a link.' },
  article: { found: 'Draws.', idea: 'A live minimap of a page: draw every article a second time at one tenth of its size beside the scrollbar.', demos: ['/portal/'] },

  // ---------------------------------------------------------------- tables
  table: { found: 'Draws with caption, header, body and footer.', idea: 'Read each cell\'s rectangle and number, and draw a 3D bar rising out of the cell. The table stays the accessible data.', demos: ['/board/'], build: 'Table cells that extrude into a bar chart' },
  col: { found: 'Its background is drawn behind the column\'s cells. Hit testing reports the cell.', idea: 'See table.' },
  colgroup: { found: 'Its background is drawn behind its columns\' cells. Hit testing reports the cell.', idea: 'See table.' },

  // ---------------------------------------------------------------- edits
  ins: { found: 'Draws underlined.', idea: 'Glyphs of ins assemble and glyphs of del burn away, driven by the same markup a static diff uses.', demos: ['/particles/', '/transitions/'], build: 'Animated diff from ins and del' },
  del: { found: 'Draws struck through.', idea: 'See ins.' },

  // ---------------------------------------------------------------- scripting
  script: { found: 'No box by default. With display: block it draws its source text.', idea: 'Show the running code inside the scene it produces by drawing the page\'s own script element.' },
  noscript: { found: 'No box when scripting is on.', idea: 'Nothing to draw.' },
  template: { found: 'No box. Its content is not in the tree.', idea: 'Nothing to draw.', demos: ['/slot-bare/'] },
  slot: { found: 'display: contents, so no box: drawElementImage(slot) throws. With display: block the fallback content draws.', idea: 'Slots are the way to draw content that lives outside the canvas.', demos: ['/slot/', '/slot-bare/'] },
  'custom element': { found: 'The shadow tree draws. A click on a button in the shadow tree arrives retargeted to the host.', idea: 'Package an effect as an element.', demos: ['/slot/', '/portal/', '/lens/'] },
  'custom element (form-associated, built-in button)': { found: 'A customized built-in button draws and takes clicks like a button.' },

  // ---------------------------------------------------------------- root and metadata
  html: { found: 'Built with createElement and put in a canvas, it is an ordinary block box and draws its text.', idea: 'Nothing specific.' },
  body: { found: 'Built with createElement and put in a canvas, it is an ordinary block box and draws its text.', idea: 'Nothing specific.' },
  head: { found: 'No box by default. With display: block it draws its text.', idea: 'Nothing specific.' },
  title: { found: 'No box by default. With display: block it draws its text.', idea: 'Draw the document title into the page: style the real title element as a block and it is both the tab title and a heading in the scene.' },
  style: { found: 'No box by default, and its rules apply to drawn content as usual.', idea: 'See the next row.' },
  'style (display: block, contenteditable)': { found: 'With display: block the stylesheet text is drawn. With contenteditable it can be edited in the canvas, and the rules apply as you type.', idea: 'A stylesheet edited inside the scene it styles. The editor is the style element itself, drawn on a panel next to the content.', build: 'Editable style element drawn in the scene' },

  // ---------------------------------------------------------------- obsolete
  marquee: { found: 'The text scrolls, and each step fires paint with no script.', idea: 'Draw a marquee through a dot-matrix shader. The marquee provides the motion, the repaint signal and the text for screen readers.', demos: ['/shader-css/'], build: 'LED ticker from a marquee' },
  nobr: { found: 'Draws, but text that overflows the drawable ancestor\'s box is clipped.', idea: 'Nothing specific.' },
  frameset: { found: 'Outside a frameset document it gets a viewport-sized box and paints nothing.', idea: 'Nothing to draw.' },
  frame: { found: 'No box.', idea: 'Nothing to draw.' },
  applet: { found: 'An unknown element: draws as an inline box with its text.', idea: 'Nothing specific.' },
  blink: { found: 'An unknown element: draws as an inline box with its text. It does not blink.', idea: 'Nothing specific.' },
  xmp: { found: 'Draws its content as text without parsing the markup.', idea: 'Nothing specific.' },
};

export function noteFor(entry) {
  const group = GROUP_NOTES[entry.group] ?? {};
  const own = NOTES[entry.tag] ?? {};
  return { found: own.found ?? group.found ?? '', inferred: own.inferred ?? '', idea: own.idea ?? group.idea ?? '', demos: own.demos ?? (NOTES[entry.tag] ? [] : group.demos) ?? [], build: own.build ?? null, shared: !NOTES[entry.tag] };
}

// Rules that hold for every element. Each is backed by rows in the table.
export const RULES = [
  ['An element with a box draws and hit tests', 'Every element that lays out a box was drawn by drawElementImage() and was found by elementsFromPoint() at its drawn position. That covers all sectioning, grouping, text-level, table and form elements.'],
  ['A direct child of the canvas becomes a block', 'The computed display of an inline element that is the drawable child is block. Table parts lose their table layout. Draw them through a wrapper when layout matters.'],
  ['The picture is clipped to the element\'s box', 'Content that overflows the drawn element is cut off: an absolutely positioned dialog, overflowing nobr text and inline padding were all clipped.'],
  ['The top layer is not part of the canvas', 'showModal() dialogs, popovers and the base-select picker are painted by the page, upright and unscaled. Anchor positioning does follow the drawn position of an anchor.'],
  ['Other origins draw nothing and still take clicks', 'A cross-origin iframe, a cross-origin image without CORS and a data: document draw nothing. The iframe still takes clicks at its drawn position.'],
  ['Elements that animate drive the paint event', 'video, an animated image, marquee, an indeterminate progress bar and a blinking caret each fire paint on their own. No requestAnimationFrame loop is needed while one is present.'],
  ['No box means nothing to draw', 'Metadata elements, closed dialogs and popovers, datalist, br, wbr, source, track, map, template and audio without controls have no box. Forcing display: block on script, style, title and head draws their text.'],
  ['Permission elements refuse', 'The geolocation element reports itself invalid ("intersection_occluded_or_distorted") inside a canvas.'],
];
