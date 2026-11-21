// ui.c: a small immediate-mode toolkit written the way a native program is written.
// run() never returns to the browser's event loop on its own: it blocks in wait_event()
// until there is something to draw. JavaScript Promise Integration (JSPI) is what lets a
// blocking call like that suspend the WebAssembly stack and hand control back to the page.
//
// No libc. Build: clang --target=wasm32 -O2 -nostdlib (see build.sh).

#define IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

// ---- provided by ui.js ----
IMPORT(wait_event) int wait_event(void);   // SUSPENDS until a paint, pointer or DOM event. Returns its kind.
IMPORT(canvas_w) float canvas_w(void);     // canvas size in CSS px
IMPORT(canvas_h) float canvas_h(void);
IMPORT(fill_rect) void fill_rect(float x, float y, float w, float h, float radius, int rgba);
IMPORT(dom_height) float dom_height(int id, float width);                 // browser layout: height at this width
// interactive 0: drawn, but takes no pointer, focus or screen reader (it is under a modal dialog).
IMPORT(dom_draw) void dom_draw(int id, float x, float y, float w, float h, float alpha, int interactive);
IMPORT(dom_clicked) int dom_clicked(int id);                              // 1 once after the element was clicked
IMPORT(dom_set_number) void dom_set_number(int id, int value);            // write a number into the element's <output>
IMPORT(pointer_x) float pointer_x(void);
IMPORT(pointer_y) float pointer_y(void);
IMPORT(pointer_down) int pointer_down(void);
IMPORT(report) void report(int frames, int waits, int nested);

// The DOM elements, in the order ui.js lists them.
enum { TITLE, NAME_LABEL, NAME_INPUT, NOTES, FADE_LABEL, DELETE_LABEL, STATUS, DIALOG, DIALOG_OK, DIALOG_CANCEL };
enum { EV_PAINT, EV_POINTER, EV_DOM, EV_RESIZE };

static int frames, waits, nested;
static float fade = 1.0f;   // 0.25 .. 1
static int dragging;
static int was_down;
static int answer = -1;     // -1 not asked, 0 cancelled, 1 deleted

static int inside(float x, float y, float w, float h) {
    float px = pointer_x(), py = pointer_y();
    return px >= x && px <= x + w && py >= y && py <= y + h;
}

// A DOM element as a row: the toolkit gives the width, the browser gives the height.
static float dom_row(int id, float x, float y, float w, float alpha, int interactive) {
    float h = dom_height(id, w);
    dom_draw(id, x, y, w, h, alpha, interactive);
    return y + h + 10;
}

// #region widgets
// Widgets drawn by the toolkit itself. Immediate mode: draw and handle input in one call.
static float slider(float x, float y, float w, float *value, float lo, float hi) {
    float h = 28, t = (*value - lo) / (hi - lo);
    if (pointer_down() && !was_down && inside(x, y, w, h)) dragging = 1;
    if (!pointer_down()) dragging = 0;
    if (dragging) {
        t = (pointer_x() - x - 12) / (w - 24);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        *value = lo + t * (hi - lo);
    }
    fill_rect(x, y + 11, w, 6, 3, 0x3a3f4bff);
    fill_rect(x, y + 11, 12 + t * (w - 24), 6, 3, 0x6aa6ffff);
    fill_rect(x + t * (w - 24), y + 2, 24, 24, 12, dragging ? 0xffffffff : 0xd7dbe4ff);
    return y + h + 12;
}

// A button: the rectangle is the toolkit's, the label on it is a DOM element.
static int button(int label, float x, float y, float w, int rgba, int interactive, float *next_y) {
    float h = 40;
    int hot = inside(x, y, w, h);
    int clicked = hot && was_down && !pointer_down();   // released over the button
    fill_rect(x, y, w, h, 8, hot && pointer_down() ? 0x8a2f2fff : rgba);
    float lh = dom_height(label, w - 24);
    dom_draw(label, x + 12, y + (h - lh) / 2, w - 24, lh, 1, interactive);
    *next_y = y + h + 12;
    return clicked;
}
// #endregion widgets

static void form(float alpha, int interactive) {
    float W = canvas_w(), x = 16, w = W - 32 > 420 ? 420 : W - 32, y = 14;
    fill_rect(0, 0, W, canvas_h(), 0, 0x1b1e26ff);
    y = dom_row(TITLE, x, y, w, 1, interactive);
    y = dom_row(NAME_LABEL, x, y, w, 1, interactive) - 6;
    y = dom_row(NAME_INPUT, x, y, w, alpha, interactive);
    y = dom_row(NOTES, x, y, w, alpha, interactive);
    y = dom_row(FADE_LABEL, x, y, w, 1, interactive) - 8;
    if (interactive) y = slider(x, y, w, &fade, 0.25f, 1.0f);
    else { float keep = fade; int d = dragging; y = slider(x, y, w, &keep, 0.25f, 1.0f); dragging = d; }
    dom_set_number(FADE_LABEL, (int)(fade * 100 + 0.5f));
    float after;
    int pressed = button(DELETE_LABEL, x, y, w, 0x6b2424ff, interactive, &after);
    y = after;
    dom_set_number(STATUS, answer);
    dom_row(STATUS, x, y, w, 1, interactive);
    if (pressed && interactive) answer = -2; // ask
}

// #region modal
// A blocking modal dialog, as a native toolkit writes one: a nested event loop that returns
// the answer. The dialog is a real DOM element with two real <button>s.
static int ask(void) {
    for (;;) {
        frames++;
        form(fade, 0);                                 // the form stays visible but takes no input
        fill_rect(0, 0, canvas_w(), canvas_h(), 0, 0x000000a0);
        float w = canvas_w() - 48 > 340 ? 340 : canvas_w() - 48;
        float h = dom_height(DIALOG, w);
        float x = (canvas_w() - w) / 2, y = (canvas_h() - h) / 2;
        fill_rect(x - 12, y - 12, w + 24, h + 24, 12, 0x2a2f3bff);
        dom_draw(DIALOG, x, y, w, h, 1, 1);
        report(frames, waits, nested);
        was_down = pointer_down();
        if (dom_clicked(DIALOG_OK)) return 1;
        if (dom_clicked(DIALOG_CANCEL)) return 0;
        waits++; nested++;
        wait_event();                                  // suspends here, inside two C calls
    }
}
// #endregion modal

// #region edges
// A Sobel edge filter over RGBA pixels that JavaScript copied into this module's memory.
// The page calls it while run() is suspended, and compares it with the same filter as a WebNN graph.
#define MAX_PIXELS (1024 * 320)
static unsigned char pixels[MAX_PIXELS * 4];
static unsigned char edge[MAX_PIXELS * 4];
__attribute__((export_name("pixels_ptr"))) unsigned char *pixels_ptr(void) { return pixels; }
__attribute__((export_name("edges_ptr"))) unsigned char *edges_ptr(void) { return edge; }
__attribute__((export_name("max_pixels"))) int max_pixels(void) { return MAX_PIXELS; }

static float luma(int w, int h, int x, int y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const unsigned char *p = pixels + (y * w + x) * 4;
    return 0.299f * p[0] + 0.587f * p[1] + 0.114f * p[2];
}

__attribute__((export_name("edges")))
int edges(int w, int h) {
    int lit = 0;
    if (w * h > MAX_PIXELS) return -1;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        float gx = luma(w, h, x + 1, y - 1) + 2 * luma(w, h, x + 1, y) + luma(w, h, x + 1, y + 1)
                 - luma(w, h, x - 1, y - 1) - 2 * luma(w, h, x - 1, y) - luma(w, h, x - 1, y + 1);
        float gy = luma(w, h, x - 1, y + 1) + 2 * luma(w, h, x, y + 1) + luma(w, h, x + 1, y + 1)
                 - luma(w, h, x - 1, y - 1) - 2 * luma(w, h, x, y - 1) - luma(w, h, x + 1, y - 1);
        float m = __builtin_sqrtf(gx * gx + gy * gy);
        unsigned char v = m > 255 ? 255 : (unsigned char)m;
        unsigned char *o = edge + (y * w + x) * 4;
        o[0] = o[1] = o[2] = v; o[3] = 255;
        if (v > 64) lit++;
    }
    return lit;
}
// #endregion edges

// #region loop
// The whole program. Exported as "run" and started once from JavaScript.
__attribute__((export_name("run")))
void run(void) {
    for (;;) {
        frames++;
        form(fade, 1);
        dom_draw(DIALOG, 0, 0, 0, 0, 0, 0);            // not shown
        report(frames, waits, nested);
        was_down = pointer_down();
        if (answer == -2) answer = ask();              // blocks until a dialog button is clicked
        else { waits++; wait_event(); }                // blocks until there is a reason to draw again
    }
}
// #endregion loop
