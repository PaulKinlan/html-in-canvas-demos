// A long list of things to build with HTML elements in a drawable canvas.
//
// Each idea names the catalogue entries it depends on (`needs`, tag names from data.js). A name that
// starts with "?" is used by the idea but does not have to be drawn (a track, a map, a closed dialog),
// so its result cannot block the idea. The page
// checks those entries against the measurements, recorded or from a run in the reader's browser, and
// marks the idea "possible", "partly" (a needed element failed an input check) or "blocked" (a needed
// element is blank or has no box).
//
//   rank 1  build next: only this API makes it practical, every needed element measured as working, usable by touch
//   rank 2  worth building: a clear demo, but close to something on the site or needs more code around it
//   rank 3  small, speculative, or waiting on something that was not measured
//
// An idea with `built` links to the demo that implements it.

export const THEMES = [
  ['forms', 'Form controls'],
  ['text', 'Text and typography'],
  ['media', 'Video, audio and images'],
  ['data', 'Tables, lists and data'],
  ['structure', 'Documents and structure'],
  ['overlay', 'Dialogs, popovers and the top layer'],
  ['clock', 'Elements that repaint themselves'],
  ['frames', 'Frames, documents and nesting'],
  ['tools', 'Developer tools'],
  ['a11y', 'Accessibility and semantics'],
  ['play', 'Games and toys'],
];

const i = (rank, theme, title, text, needs, built) => ({ rank, theme, title, text, needs, built });
// Set to the demo page's path once it exists; until then built ideas show no link.
export const BUILT_PAGE = null;
const B = '';

export const IDEAS = [
  // ---------------------------------------------------------------- forms
  i(1, 'forms', 'Picker wheel from select multiple', 'Draw a list box on a cylinder. The options are real option elements and the selection is form state.', ['select multiple', 'option'], B + 'wheel'),
  i(1, 'forms', 'Mixing desk from rotated range inputs', 'Range inputs drawn rotated 90 degrees as faders. The hit region follows the transform.', ['input type=range', 'label', 'output'], B + 'desk'),
  i(1, 'forms', 'Step sequencer from a grid of checkboxes', 'Real checkboxes drawn as lit pads. The pattern can be submitted, reset and read by a screen reader.', ['input type=checkbox', 'form', 'fieldset'], B + 'sequencer'),
  i(1, 'forms', 'Textarea as a CRT terminal', 'A real textarea drawn with scan lines and curvature, with the caret landing where you tap.', ['textarea'], B + 'crt'),
  i(1, 'forms', 'Rotary switch from a radio group', 'The checked radio sets the knob angle. Arrow keys already move between positions.', ['input type=radio', 'fieldset', 'label']),
  i(1, 'forms', 'Odometer for a number input', 'Draw the value on counter wheels that roll when the value steps. The field stays editable.', ['input type=number', 'output']),
  i(1, 'forms', 'Form on a prism, one fieldset per face', 'A multi-step form where Next turns the prism. Validation and submit are native.', ['form', 'fieldset', 'legend', 'input', 'button']),
  i(2, 'forms', 'Exploded form diagram', 'Labels drawn as call-outs away from their fields and joined by canvas lines. A tap on a call-out focuses its field.', ['label', 'input', 'input type=checkbox']),
  i(2, 'forms', 'Per-keystroke ink', 'Each paint event after a key press spreads ink from the caret position. No key listener on the field.', ['input', 'textarea']),
  i(2, 'forms', 'Button press that dents the surface', 'Hover and :active change the picture, which fires paint. The canvas ripples the area around the button.', ['button']),
  i(2, 'forms', 'Colour input that recolours its own scene', 'The swatch sits inside the scene and its value tints everything drawn around it.', ['input type=color']),
  i(2, 'forms', 'Liquid progress bar', 'Read progress.value in the paint handler and draw a sloshing fill. The element stays the accessible bar.', ['progress']),
  i(2, 'forms', 'Dial gauge from a meter', 'A needle and coloured arcs from value, low, high and optimum.', ['meter']),
  i(2, 'forms', 'Split-flap output', 'Changing output.value flips each character to the new one.', ['output', 'form']),
  i(2, 'forms', 'Wall calendar around a date input', 'The date field sits on a drawn calendar that turns to the chosen month.', ['input type=date', 'input type=month']),
  i(2, 'forms', 'Clock hands from a time input', 'Hands drawn from the value. Dragging a hand writes the value back.', ['input type=time']),
  i(2, 'forms', 'File input on a drawn letter box', 'Tap the slot to choose files. Chosen images are drawn dropping into the scene.', ['input type=file', 'img']),
  i(2, 'forms', 'Search field that focuses the scene', 'While the field has focus, everything else in the canvas is drawn dimmed and blurred.', ['search', 'input type=search']),
  i(2, 'forms', 'Disabled panel in one step', 'A fieldset with disabled is drawn frosted over, and its controls stop taking input.', ['fieldset', 'input', 'button']),
  i(3, 'forms', 'Suggestion ring from a datalist', 'Read input.list.options and draw the suggestions as chips around the field, since the native list is not in the canvas.', ['?datalist', 'input']),
  i(3, 'forms', 'Password field that can be shared', 'Only the masking dots reach the canvas, so a stream or capture of the form carries no secret.', ['input type=password']),
  i(3, 'forms', 'Customisable select with the picker in the scene', 'Blocked today: the base-select picker is in the top layer and could not be used inside a canvas.', ['select (base-select)', 'selectedcontent']),
  i(3, 'forms', 'Hero picture from selectedcontent', 'Draw the element that mirrors the chosen option a second time, large, as the page hero.', ['select (base-select)', 'selectedcontent']),
  i(3, 'forms', 'Folder tabs from legends', 'Each fieldset is a folder and its legend is the tab. Tapping a tab brings its folder to the front.', ['fieldset', 'legend']),

  // ---------------------------------------------------------------- text
  i(1, 'text', 'Animated diff from ins and del', 'Glyphs of ins assemble and glyphs of del burn away, from the markup a static diff already uses.', ['ins', 'del', 'p'], B + 'diff'),
  i(1, 'text', 'MathML terms that move between steps', 'Each term travels from its place in one line of a derivation to its place in the next.', ['math'], B + 'math'),
  i(1, 'text', 'Marker-pen highlight', 'Replace the flat background of mark with a hand-drawn stroke along its line boxes.', ['mark', 'p']),
  i(1, 'text', 'Keycaps from kbd', 'Each kbd is drawn as a key that goes down while the real key is held. A shortcut cheat sheet that responds.', ['kbd']),
  i(2, 'text', 'Flip clock from a time element', 'Updating the text once a second fires paint once a second. No frame loop.', ['time']),
  i(2, 'text', 'Ruby that appears near the pointer', 'Annotations are drawn only around the pointer, using the rt rectangles. A reading aid for language learners.', ['ruby', 'rt']),
  i(2, 'text', 'Code that types itself', 'Reveal glyphs of a code block in order while the text stays selectable and copyable.', ['pre', 'code']),
  i(2, 'text', 'Pull quote behind the column', 'Draw a blockquote a second time, large and faint, behind the article text.', ['blockquote', 'p']),
  i(2, 'text', 'Selection that glows', 'The browser draws the selection into the element picture. Bloom everything of that colour.', ['p', 'span']),
  i(2, 'text', 'Kinetic heading', 'Heading glyphs fly in and settle. The h1 stays in the document outline.', ['h1']),
  i(2, 'text', 'Footnotes that slide out', 'sup links draw their note beside the line instead of jumping to the foot of the page.', ['sup', 'a', 'small']),
  i(2, 'text', 'Strike-through drawn by hand', 'Animate a pen stroke across s and del when they are added.', ['s', 'del']),
  i(3, 'text', 'Subscripts that settle', 'Chemical formulas where sub and sup drop into place one after another.', ['sub', 'sup']),
  i(3, 'text', 'Bidirectional text explained', 'Draw arrows over bdo and bdi runs showing visual order against logical order.', ['bdo', 'bdi']),
  i(3, 'text', 'Abbreviations expanded in place', 'On tap, the title of an abbr unfolds between the letters, since the native tooltip is not in the canvas.', ['abbr', '[title] tooltip']),
  i(3, 'text', 'Quotation marks as ornaments', 'Draw oversized quote marks around q and cite from their rectangles.', ['q', 'cite']),
  i(3, 'text', 'Variables that light up together', 'Hover one var and every var with the same name is outlined across the page.', ['var', 'code']),
  i(3, 'text', 'Line breaks as cut lines', 'wbr and br have no box. Use Range rectangles of the text around them to fold a paragraph like paper.', ['p', '?br', '?wbr']),

  // ---------------------------------------------------------------- media
  i(1, 'media', 'Television with native controls and captions', 'A video on a drawn screen. Its frames set the repaint rate, and play, scrub and captions are the browser\'s own.', ['video', 'video controls', '?track'], B + 'tv'),
  i(1, 'media', 'Image map on a perspective floor plan', 'Each area is a link and a focus stop on a plan drawn in perspective.', ['?map', '?area', 'img'], B + 'plan'),
  i(1, 'media', 'Cassette deck from audio controls', 'Native audio controls on a drawn deck with spinning reels while it plays.', ['audio controls']),
  i(2, 'media', 'Captions drawn apart from the video', 'Read track.activeCues and draw the text sharp over a video that goes through an effect.', ['video', '?track']),
  i(2, 'media', 'Video wall', 'One video drawn as a grid of tiles that drift apart and close up, with one set of controls.', ['video controls']),
  i(2, 'media', 'Figure with a live caption', 'The image goes through an effect and the figcaption stays plain text on top.', ['figure', 'figcaption', 'img']),
  i(2, 'media', 'Resolution chosen by drawn size', 'Set the img width from its size in the scene and let srcset and sizes pick the file.', ['picture', '?source', 'img']),
  i(2, 'media', 'SVG chart as a live texture', 'Hover styles and links on the shapes keep working while the canvas tilts the chart.', ['svg', 'a']),
  i(2, 'media', 'Chart and legend exported as one picture', 'A canvas-drawn chart and its HTML legend composed in one outer canvas and saved with one call.', ['canvas', 'ul', 'figure']),
  i(2, 'media', 'Animated image as the only clock', 'An animated image fires paint every frame. Use it to drive an effect, and remove it to stop.', ['img (animated)']),
  i(3, 'media', 'Photo gallery with real alt text', 'Images fanned out like prints on a table. Each is still an img with alt text and "Save image as".', ['img', 'figure']),
  i(3, 'media', 'PDF pages as a book', 'Not measured: the PDF viewer is missing in the test browser and is expected to be blank.', ['embed (PDF)']),
  i(3, 'media', 'Cross-origin image wall', 'Blocked without CORS: the images draw blank. Needs crossorigin="anonymous" and headers.', ['img (other origin, no CORS)']),

  // ---------------------------------------------------------------- data
  i(1, 'data', 'Table cells that extrude into a bar chart', 'A bar rises out of each cell from its rectangle and number. The table stays the accessible data.', ['table', 'td', 'th'], B + 'bars'),
  i(1, 'data', 'Cover flow from a ul', 'Each li is a card in a row drawn in depth. Tab and screen-reader order follow the list.', ['ul', 'li'], B + 'flow'),
  i(1, 'data', 'Radial menu from a menu element', 'Buttons drawn rotated around a centre. The hit regions rotate with them.', ['menu', 'button'], B + 'radial'),
  i(1, 'data', 'Sortable table with rows that travel', 'On sort, each row is drawn moving from its old position to its new one.', ['table', 'tr', 'th', 'button']),
  i(2, 'data', 'Column highlight from col', 'A col background follows the pointer across the table, drawn as a soft light instead of a flat fill.', ['table', 'col', 'colgroup']),
  i(2, 'data', 'Glossary cards from a dl', 'dt on the front, dd on the back, flipped in depth.', ['dl', 'dt', 'dd']),
  i(2, 'data', 'Staggered list entrance', 'Each li is drawn at a delay from its index, with its marker in the picture.', ['ol', 'li']),
  i(2, 'data', 'Sticky header that casts a shadow', 'thead drawn last over the scrolled body with a shadow whose depth follows the scroll offset.', ['table', 'thead', 'tbody']),
  i(2, 'data', 'Heat map over table cells', 'Colour each cell from its number, with a smooth gradient drawn between neighbours.', ['table', 'td']),
  i(2, 'data', 'Timeline from an ordered list', 'Items drawn along a curved path, numbered by their own markers.', ['ol', 'li', 'time']),
  i(3, 'data', 'Caption as a rubber stamp', 'The table caption drawn rotated across a corner of the table.', ['table', 'caption']),
  i(3, 'data', 'Footer totals that count up', 'tfoot numbers roll to their value when the table changes.', ['table', 'tfoot']),
  i(3, 'data', 'Machine values next to shown values', 'Hold a key and every data and time element shows its value or datetime attribute beside it.', ['data', 'time']),

  // ---------------------------------------------------------------- structure
  i(1, 'structure', 'Find in page that moves the camera', 'Panels of a scene hold hidden=until-found text. A find match fires beforematch and the camera goes to that panel.', ['?[hidden=until-found]', 'section'], B + 'find'),
  i(1, 'structure', 'Accordion that unfolds', 'The two pictures of a details element, closed and open, are joined by a fold-out animation.', ['details', 'summary']),
  i(1, 'structure', 'Live minimap of a page', 'Every article drawn a second time at a tenth of its size beside the scroll bar, updating as the page does.', ['article', 'section', 'h2']),
  i(2, 'structure', 'Sections on a cube', 'Four sections on four faces. Landmarks and headings stay in the accessibility tree.', ['section', 'h2', 'nav']),
  i(2, 'structure', 'Navigation on a ribbon', 'nav links drawn along a curve. Each is still a link that can be opened in a new tab.', ['nav', 'a']),
  i(2, 'structure', 'Slices between hr elements', 'The paint handler cuts the document at each hr and draws the slices at different depths.', ['hr', 'article']),
  i(2, 'structure', 'Header that folds away', 'The page header drawn folding up as the page scrolls, and folding back down on scroll up.', ['header', 'h1']),
  i(2, 'structure', 'Drawer cabinet from details', 'Summaries are drawer fronts, bodies are the open drawers.', ['details', 'summary']),
  i(2, 'structure', 'Aside as a margin note on a string', 'An aside drawn hanging off the paragraph it annotates, swinging when the page scrolls.', ['aside', 'p']),
  i(3, 'structure', 'Document title as a heading', 'Style the real title element as a block and draw it: one element is both the tab title and the page heading.', ['?title']),
  i(3, 'structure', 'Address on an envelope', 'An address element drawn on an envelope that seals when a form is submitted.', ['address', 'form']),
  i(3, 'structure', 'Footer that is the floor', 'In a scene with depth, draw the footer flat on the ground plane under everything else.', ['footer']),
  i(3, 'structure', 'Subtitle that types under the title', 'An hgroup where the p is revealed glyph by glyph after the heading settles.', ['hgroup', 'h3']),

  // ---------------------------------------------------------------- overlay
  i(1, 'overlay', 'In-canvas dialog with a canvas backdrop', 'A dialog that stays in the scene with open and position: static, while the canvas blurs and dims everything behind it.', ['dialog open', '[inert]', 'button'], B + '?dialog'),
  i(1, 'overlay', 'Anchored popover call-outs on drawn elements', 'Popovers anchored to elements drawn on a turning object. The browser keeps upright, sharp labels attached.', ['?[popover]', 'button'], B + 'callouts'),
  i(2, 'overlay', 'Menu that stays readable on a tilted toolbar', 'Buttons drawn in perspective open popover menus that the page paints flat, anchored to the drawn buttons.', ['?[popover]', 'menu', 'button']),
  i(2, 'overlay', 'Tooltip drawn by the canvas', 'Read title attributes and draw tooltips in the scene, since native tooltips are not in the canvas.', ['[title] tooltip', 'abbr']),
  i(2, 'overlay', 'Modal that leaves the scene', 'showModal() paints in the top layer. Draw the scene receding and darkening behind it from the canvas side.', ['?dialog', 'button']),
  i(3, 'overlay', 'Toast stack in the scene', 'Non-modal dialogs with open, stacked in a corner of the canvas and drawn sliding in.', ['dialog open', 'output']),
  i(3, 'overlay', 'Popover drawn into the canvas', 'Blocked today: a popover is in the top layer and is never part of the element picture.', ['[popover]']),

  // ---------------------------------------------------------------- clock
  i(1, 'clock', 'LED ticker from a marquee', 'A marquee drawn through a dot-matrix mask. It supplies the motion, the repaint signal and the text.', ['marquee'], B + 'ticker'),
  i(2, 'clock', 'Loading state that stops by itself', 'An indeterminate progress bar keeps the canvas repainting while loading. Give it a value and the repaints stop.', ['progress (indeterminate)']),
  i(2, 'clock', 'Caret as a heartbeat', 'A focused field repaints the canvas on each caret blink. Pulse the scene with it while the user is typing.', ['input']),
  i(2, 'clock', 'Video as a frame clock for a whole scene', 'Hide a looping video in the canvas and run every animation from its paint events, so everything is in sync with the film.', ['video']),
  i(3, 'clock', 'Stock ticker with real links', 'A marquee of links, each one clickable while it scrolls.', ['marquee', 'a']),

  // ---------------------------------------------------------------- frames
  i(1, 'frames', 'Tab switcher of live pages', 'Every open page of an app as a live, clickable card in a fan.', ['iframe (same origin)']),
  i(2, 'frames', 'Widget with its own effect inside a scene', 'A drawable canvas inside a drawable canvas: one effect per widget, one for the scene.', ['canvas (drawable, nested)', 'button']),
  i(2, 'frames', 'Email preview on a drawn phone', 'A srcdoc frame of the message, on a phone body, scrollable and clickable.', ['iframe (srcdoc)']),
  i(2, 'frames', 'Custom element that packages an effect', 'One tag that draws its light-DOM children with an effect, shadow tree and all.', ['custom element', '?slot']),
  i(2, 'frames', 'HTML button inside an SVG diagram', 'foreignObject content draws and takes clicks, so a diagram node can hold a real form.', ['svg foreignObject', 'svg']),
  i(3, 'frames', 'Warn about invisible frames', 'A cross-origin frame in a canvas is blank and still takes clicks. Draw a hatched box wherever one is.', ['?iframe (other origin)']),
  i(3, 'frames', 'Template stamped many times', 'Clone one template into many drawable children and draw each with its own transform.', ['?template', 'div']),
  i(3, 'frames', 'Permission button in a scene', 'Blocked: the geolocation element reports itself invalid inside a canvas.', ['geolocation']),

  // ---------------------------------------------------------------- tools
  i(1, 'tools', 'Editable style element drawn in the scene', 'A stylesheet edited inside the scene it styles. The editor is the style element itself.', ['style (display: block, contenteditable)'], B + 'style'),
  i(2, 'tools', 'Script that shows itself', 'Draw the page\'s own script element as a block beside what it produces.', ['?script']),
  i(2, 'tools', 'Layout debugger overlay', 'Draw every child\'s box, margin and baseline over its picture in the same canvas.', ['div', 'p', 'table']),
  i(2, 'tools', 'Paint event inspector', 'Flash the region of whichever element fired paint, with a count per element.', ['input', 'video', 'marquee']),
  i(2, 'tools', 'Hit region viewer', 'Outline where the browser will hit test each drawn element, against where it was drawn.', ['button', 'a', 'input']),
  i(3, 'tools', 'Unknown elements in a design system audit', 'Elements the parser does not know still draw. Outline every HTMLUnknownElement in red.', ['blink', 'applet']),
  i(3, 'tools', 'xmp as a literal code sample', 'xmp shows markup without escaping. Draw it next to the same markup rendered.', ['xmp']),

  // ---------------------------------------------------------------- a11y
  i(1, 'a11y', 'Set inert on undrawn children automatically', 'Children that are in the canvas but not drawn are still focusable. Mark every child the paint handler skipped as inert.', ['[inert]', 'button'], B + 'inert'),
  i(1, 'a11y', 'Focus order shown as a path', 'Draw a numbered line through every focusable element in tab order, live.', ['[tabindex]', 'a', 'button', 'input']),
  i(2, 'a11y', 'Focus ring that leads the eye', 'The focus ring is in the element picture. Draw a trail from the last focused element to the new one.', ['[tabindex]', 'button']),
  i(2, 'a11y', 'Landmark map', 'Tint each landmark region and label it with its role.', ['main', 'nav', 'aside', 'header', 'footer']),
  i(2, 'a11y', 'Heading outline beside the page', 'Draw the heading tree as a live table of contents, built from h1 to h6.', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
  i(3, 'a11y', 'Label coverage check', 'Draw a line from each label to its control and flag controls with none.', ['label', 'input', 'select', 'textarea']),

  // ---------------------------------------------------------------- play
  i(2, 'play', 'Drag a card out of the scene', 'Native drag and drop from a drawn card to another window, with the canvas pixels as the drag image.', ['[draggable]']),
  i(2, 'play', 'Pixel editor from checkboxes', 'A 16 by 16 grid of checkboxes drawn as pixels. The picture is a form value.', ['input type=checkbox', 'form']),
  i(2, 'play', 'Sliding puzzle of a live page', 'A same-origin frame cut into tiles. Every tile still scrolls and clicks.', ['iframe (same origin)']),
  i(2, 'play', 'Contenteditable on a curling page', 'Type on a page of a book and turn it.', ['[contenteditable]']),
  i(3, 'play', 'Minesweeper from a table of buttons', 'Cells are buttons in a table. Reveals ripple outward across the grid.', ['table', 'td', 'button']),
  i(3, 'play', 'Summary as a lever', 'Pull a drawn lever to toggle a details element.', ['details', 'summary']),
  i(3, 'play', 'Old web page in a drawn monitor', 'center, font, big, tt and marquee, drawn on a period monitor.', ['center', 'font', 'big', 'tt', 'marquee']),
];

/**
 * Check one idea against measurements. `verdictOf(tag)` returns the label for a catalogue entry
 * ('works', 'partly', 'blank', 'nobox', ...). Returns { status, why } where `why` lists the entries in the way.
 */
export function evaluate(idea, verdictOf) {
  const partly = [], blocked = [];
  for (const tag of idea.needs) {
    if (tag.startsWith('?')) continue; // used, but it does not have to be drawn
    const v = verdictOf(tag);
    if (v === 'works') continue;
    (v === 'partly' ? partly : blocked).push(tag);
  }
  return { status: blocked.length ? 'blocked' : partly.length ? 'partly' : 'possible', why: [...blocked, ...partly] };
}
