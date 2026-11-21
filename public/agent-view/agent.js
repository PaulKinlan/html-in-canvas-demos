// Tools an agent can call on a form, and the picture of each call.
//
//   const panel = agentPanel(form, { onstep });
//   panel.tools                       // [{ name, description, inputSchema, execute }]
//   await panel.call('fill_field', { field: 'name', value: 'Ada' });
//   registerWithWebMCP(panel.tools)   // navigator.modelContext, when it exists
//
// The form has fx="agent" (see effect.js). A tool does not return until its
// animation is over: the panel turns to face the reader, a marker travels to
// the field, and the value is typed into the real input one character at a
// time. Four CSS custom properties on the form carry all of that to the shader.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calm = matchMedia('(prefers-reduced-motion: reduce)');

export const FIELDS = {
  name: { label: 'Name', type: 'string', description: 'Name the berth is booked under' },
  boat_length: { label: 'Boat length', type: 'number', description: 'Boat length in metres, 4 to 20' },
  berth: { label: 'Berth', type: 'string', enum: ['pontoon', 'buoy', 'quay'], description: 'Kind of berth' },
  nights: { label: 'Nights', type: 'number', description: 'Number of nights, 1 to 14' },
  power: { label: 'Shore power', type: 'boolean', description: 'Whether shore power is wanted' },
};

export function agentPanel(form, { onstep = () => {}, speed = 1 } = {}) {
  const pace = () => (calm.matches ? 0 : speed);
  const control = (field) => form.elements[field];
  let busy = 0, restTimer = 0;

  // #region marker
  // Where a control is inside the form, as fractions of its width and height.
  // Measured from layout (offsetLeft, offsetTop), because getBoundingClientRect()
  // reports the leaning, drawn box. The form must be positioned, so that it is
  // the offsetParent of its controls.
  // --fx-progress and --fx-amount carry the marker position to the shader, and
  // CSS transitions on them (see the page's styles) make the marker travel.
  function pointAt(el) {
    // Near the right end of a wide control, so the marker does not cover the text being typed.
    let x = el.offsetWidth > 90 ? el.offsetWidth - 22 : el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let n = el; n && n !== form; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    form.style.setProperty('--fx-progress', (x / form.offsetWidth).toFixed(4));
    form.style.setProperty('--fx-amount', (y / form.offsetHeight).toFixed(4));
  }
  async function attend(el) {
    clearTimeout(restTimer);
    busy++;
    form.dataset.agent = 'acting';
    // Face the reader: the lean set in CSS goes to zero.
    form.style.setProperty('--fx-x', '0');
    form.style.setProperty('--fx-y', '0');
    pointAt(el);
    el.classList.add('agent-target');
    await sleep(620 * pace());
  }
  function release(el) {
    el.classList.remove('agent-target');
    if (--busy > 0) return;
    // Nothing else queued: after a moment the marker leaves and the panel leans back.
    restTimer = setTimeout(() => {
      delete form.dataset.agent;
      for (const p of ['--fx-x', '--fx-y', '--fx-progress', '--fx-amount']) form.style.removeProperty(p);
    }, 1400 * pace());
  }
  // #endregion marker

  // #region tools
  // One call at a time, so two tool calls from an agent do not fight over the marker.
  let queue = Promise.resolve();
  const inTurn = (fn) => (queue = queue.then(fn, fn));

  const say = (text) => {
    // ariaNotify() tells a screen reader what the canvas is showing. The DOM
    // change itself (a value) is not announced by the browser.
    try { (form.ariaNotify ? form : document).ariaNotify?.(text); } catch {}
    onstep(text);
  };

  async function fill({ field, value }) {
    const el = control(field);
    const spec = FIELDS[field];
    if (!el || !spec) throw new Error(`No field named "${field}". Fields: ${Object.keys(FIELDS).join(', ')}.`);
    await attend(el);
    try {
      if (el.type === 'checkbox') {
        const want = value === true || value === 'true' || value === 'yes' || value === 1;
        if (el.checked !== want) el.click();
      } else if (el.localName === 'select') {
        const option = [...el.options].find((o) => o.value === String(value).toLowerCase() || o.textContent.toLowerCase() === String(value).toLowerCase());
        if (!option) throw new Error(`"${value}" is not one of: ${[...el.options].map((o) => o.value).join(', ')}.`);
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.type === 'range' || el.type === 'number') {
        const n = Math.max(+el.min, Math.min(+el.max, Number(value)));
        if (Number.isNaN(n)) throw new Error(`"${value}" is not a number.`);
        // Count to the value so the slider is seen moving.
        const from = +el.value, steps = pace() ? 10 : 1;
        for (let i = 1; i <= steps; i++) {
          el.value = Math.round(from + ((n - from) * i) / steps);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(30 * pace());
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Type it. focus() is not called: the reader may be typing elsewhere.
        const text = String(value);
        el.value = '';
        for (const ch of text) {
          el.value += ch;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
          await sleep(55 * pace());
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const shown = el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value;
      say(`${spec.label} set to ${shown}`);
      await sleep(260 * pace());
      return `${field} is now ${JSON.stringify(el.type === 'checkbox' ? el.checked : el.value)}`;
    } finally {
      release(el);
    }
  }

  async function submit() {
    const button = form.querySelector('[type=submit]');
    await attend(button);
    try {
      if (!form.reportValidity()) throw new Error('The form is not valid: a required field is empty.');
      form.requestSubmit(button);
      say('Booking submitted');
      await sleep(500 * pace());
      return form.querySelector('output[role=status]')?.textContent || 'submitted';
    } finally {
      release(button);
    }
  }

  function read() {
    const out = {};
    for (const field of Object.keys(FIELDS)) {
      const el = control(field);
      out[field] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
    }
    return out;
  }

  const tools = [
    {
      name: 'fill_field',
      description: 'Set one field of the berth booking form.',
      inputSchema: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: Object.keys(FIELDS), description: Object.entries(FIELDS).map(([k, f]) => `${k}: ${f.description}`).join('. ') },
          value: { description: 'The new value: text, a number, or true/false for power.' },
        },
        required: ['field', 'value'],
      },
      execute: (args) => inTurn(() => fill(args)),
    },
    {
      name: 'submit_booking',
      description: 'Submit the berth booking form and return the confirmation line.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => inTurn(submit),
    },
    {
      name: 'read_form',
      description: 'Return the current value of every field of the berth booking form.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => inTurn(async () => JSON.stringify(read())),
    },
  ];
  // #endregion tools

  return {
    tools,
    read,
    get busy() { return busy > 0; },
    call(name, args = {}) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) return Promise.reject(new Error(`No tool named "${name}".`));
      return tool.execute(args);
    },
  };
}

// #region webmcp
/**
 * Give the tools to the browser's agent through WebMCP. The API has changed
 * shape between Chrome versions, so both spellings are tried:
 * registerTool() once per tool, then provideContext({ tools }).
 * Returns { how, count, error } and never throws.
 */
export function registerWithWebMCP(tools) {
  const mc = navigator.modelContext;
  if (!mc) return { how: '', count: 0, error: 'navigator.modelContext is missing' };
  // WebMCP expects execute() to resolve with content blocks.
  const wrapped = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    async execute(args) {
      const text = await t.execute(args ?? {});
      return { content: [{ type: 'text', text: String(text) }] };
    },
  }));
  const errors = [];
  if (typeof mc.registerTool === 'function') {
    let count = 0;
    for (const tool of wrapped) {
      try { mc.registerTool(tool); count++; } catch (err) { errors.push(`registerTool(${tool.name}): ${err.message}`); }
    }
    if (count) return { how: 'navigator.modelContext.registerTool()', count, error: errors.join('; ') };
  }
  if (typeof mc.provideContext === 'function') {
    try {
      mc.provideContext({ tools: wrapped });
      return { how: 'navigator.modelContext.provideContext()', count: wrapped.length, error: '' };
    } catch (err) {
      errors.push(`provideContext(): ${err.message}`);
    }
  }
  return { how: '', count: 0, error: errors.join('; ') || 'navigator.modelContext has neither registerTool() nor provideContext()' };
}
// #endregion webmcp

// #region plan
/**
 * Turn a sentence into tool calls with the Prompt API. The model is told the
 * tools and must answer with JSON that matches a schema (responseConstraint),
 * so the answer can be run without parsing prose.
 */
export async function planWithModel(sentence, tools, { onprogress } = {}) {
  if (!('LanguageModel' in globalThis)) throw new Error('LanguageModel is missing');
  const session = await LanguageModel.create({
    initialPrompts: [{
      role: 'system',
      content: 'You operate a berth booking form by calling tools. Tools:\n' +
        tools.map((t) => `${t.name}: ${t.description} Arguments: ${JSON.stringify(t.inputSchema.properties)}`).join('\n') +
        '\nAnswer with the list of calls needed to carry out the request, in order. Call submit_booking last only if the user asks to book or submit.',
    }],
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onprogress?.(e.loaded)),
  });
  const schema = {
    type: 'object',
    properties: {
      calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: { tool: { type: 'string', enum: tools.map((t) => t.name) }, field: { type: 'string', enum: Object.keys(FIELDS) }, value: { type: 'string' } },
          required: ['tool'],
        },
      },
    },
    required: ['calls'],
  };
  try {
    const answer = await session.prompt(sentence, { responseConstraint: schema });
    return JSON.parse(answer).calls.map((c) => ({ name: c.tool, args: c.tool === 'fill_field' ? { field: c.field, value: c.value } : {} }));
  } finally {
    session.destroy?.();
  }
}
// #endregion plan

// #region match
/**
 * The stand-in for a model: a pattern matcher that finds field values in a
 * sentence. It understands this form's five fields and nothing else.
 */
export function planWithPatterns(sentence) {
  const s = sentence.toLowerCase();
  const calls = [];
  const fill = (field, value) => calls.push({ name: 'fill_field', args: { field, value } });
  const name = sentence.match(/\bfor ([A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+)?)/u) ?? sentence.match(/\bname(?:d| is)? ([A-Z][\p{L}'-]+)/u);
  if (name) fill('name', name[1]);
  const length = s.match(/(\d+(?:\.\d+)?)\s*(?:m\b|metres?|meters?)/);
  if (length) fill('boat_length', Number(length[1]));
  const berth = s.match(/\b(pontoon|buoy|quay)\b/);
  if (berth) fill('berth', berth[1]);
  const nights = s.match(/(\d+|one|two|three|four|five|six|seven)\s*nights?/);
  if (nights) fill('nights', { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[nights[1]] ?? Number(nights[1]));
  if (/\b(no|without) (shore )?power\b/.test(s)) fill('power', false);
  else if (/\bpower\b/.test(s)) fill('power', true);
  if (/\b(book|submit|confirm|reserve)\b/.test(s)) calls.push({ name: 'submit_booking', args: {} });
  return calls;
}
// #endregion match
