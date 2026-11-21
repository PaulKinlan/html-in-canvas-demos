// main.cpp: a Dear ImGui app whose own widgets each have a DOM node in the canvas.
// ImGui draws the button, checkbox, slider and text field as pixels. After each widget the app
// calls A11y(), which reports the widget's role, name, state and rectangle to the page. The page
// keeps one real element per widget inside the canvas, never draws it, and places it with
// updateElementGeometry(). The browser's accessibility tree, hit testing, Tab order and focus
// then describe ImGui's widgets.
//
// No GLFW or SDL: the WebGL context comes from Emscripten's html5.h and the pointer from the page.

#include "imgui.h"
#include "imgui_internal.h"   // LastItemData, SetFocusID(), the nav activation ids
#include "imgui_impl_opengl3.h"
#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <map>
#include <string>
#include <cstdio>
#include <cstring>

// ---------------------------------------------------------------------------------------
// The browser side. GLctx is Emscripten's WebGL2 context, the one ImGui renders with.

// #region init
EM_JS(void, aria_init, (), {
    const canvas = GLctx.canvas;
    const aria = globalThis.__toolkitAria = {
        canvas, items: new Map(), cursor: 0, frame: 0, moved: false, pointerDown: false, focusId: 0,
        unit: { key: "", value: 1 }, onframe: null,
        stats: { frames: 0, paints: 0, uploads: 0, places: 0, created: 0, removed: 0, error: "" },
        node: (name) => { for (const item of aria.items.values()) if (item.label === name) return item.el; return null; },
        item: (name) => { for (const item of aria.items.values()) if (item.label === name) return item; return null; },
    };
    const call = (fn, id, text) => { const sp = stackSave(); fn(id, stringToUTF8OnStack(text)); stackRestore(sp); };
    const bytes = (text) => new TextEncoder().encode(text).length;
    aria.sendCaret = (id, el) => Module._aria_caret(id, bytes(el.value.slice(0, el.selectionStart)), bytes(el.value.slice(0, el.selectionEnd)));

    // One element per widget. The element type gives the role, so no role attribute is needed
    // except for the status line.
    aria.make = (role, id) => {
        let el;
        if (role === "button" || role === "disclosure") { el = document.createElement("button"); el.type = "button"; }
        else if (role === "status") { el = document.createElement("div"); el.setAttribute("role", "status"); }
        else {
            el = document.createElement("input");
            el.type = role === "checkbox" ? "checkbox" : role === "slider" ? "range" : "text";
            if (role === "textbox") { el.autocomplete = "off"; el.spellcheck = false; el.enterKeyHint = "done"; }
        }
        el.setAttribute("drawable", "");
        el.dataset.aria = role;
        // DOM to ImGui. A click with an empty pointerType came from Enter, Space, click() or
        // assistive technology. A click by pointer has already reached ImGui as pointer input.
        el.addEventListener("click", (event) => {
            if (event.pointerType) return;
            if (role === "checkbox") Module._aria_set(id, el.checked ? 1 : 0);
            else if (role === "button" || role === "disclosure") Module._aria_press(id);
        });
        el.addEventListener("input", () => {
            if (role === "slider" && !aria.pointerDown) Module._aria_set(id, Number(el.value));
            if (role === "textbox") { call(Module._aria_text, id, el.value); aria.sendCaret(id, el); }
        });
        // DOM focus becomes ImGui keyboard focus. ImGui draws the ring when the browser would.
        el.addEventListener("focus", () => {
            aria.focusId = id;
            Module._aria_focus(id, el.matches(":focus-visible") ? 1 : 0);
            if (role === "textbox") aria.sendCaret(id, el);
        });
        el.addEventListener("blur", () => { if (aria.focusId === id) { aria.focusId = 0; Module._aria_focus(0, 0); } });
        return el;
    };
    canvas.ownerDocument.addEventListener("selectionchange", () => {
        const el = canvas.ownerDocument.activeElement, item = aria.items.get(aria.focusId);
        if (item && item.el === el && item.role === "textbox") aria.sendCaret(item.id, el);
    });

    canvas.addEventListener("paint", (event) => {
        aria.stats.paints++;
        const changed = event.changedElements ? new Set(event.changedElements) : null;
        for (const item of aria.items.values()) if (!changed || changed.has(item.el)) item.dirty = true;
        Module._ui_wake();
    });

    // Pointer input for ImGui. The capture phase sees an event before the node under it does.
    const at = (event) => { const r = canvas.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top]; };
    const textAt = (x, y) => {
        for (const item of aria.items.values()) {
            const r = item.rect;
            if (item.role === "textbox" && item.visible && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]) return item;
        }
        return null;
    };
    let touchY = null;
    const guard = (event) => {
        const [x, y] = at(event);
        if (event.type === "pointerdown") {
            const text = textAt(x, y);
            if (text) {
                // The text field is the one widget ImGui does not get the press for. The browser
                // focuses the node (which raises the phone keyboard) and places the caret.
                if (event.target !== text.el) { event.preventDefault(); text.el.focus({ preventScroll: true }); }
                Module._ui_pointer(x, y, -1);
                return;
            }
            aria.pointerDown = true;
            try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
            touchY = event.pointerType === "touch" ? y : null;
            Module._ui_pointer(x, y, 1);
        } else if (event.type === "pointerup") {
            touchY = null;
            setTimeout(() => { aria.pointerDown = false; }, 0);
            Module._ui_pointer(x, y, 0);
        } else {
            Module._ui_pointer(x, y, -1);
            // ImGui has no touch scrolling. A vertical touch drag that is not on a slider or a
            // scrollbar becomes wheel input.
            if (touchY !== null && !Module._ui_item_active()) { Module._ui_wheel((y - touchY) / 60); touchY = y; }
        }
    };
    for (const type of ["pointermove", "pointerdown", "pointerup"]) canvas.addEventListener(type, guard, true);
    canvas.addEventListener("pointercancel", () => { touchY = null; aria.pointerDown = false; Module._ui_pointer(-1e4, -1e4, 0); });
    canvas.addEventListener("pointerleave", (event) => { if (event.pointerType !== "mouse") Module._ui_pointer(-1e4, -1e4, -1); });
    canvas.addEventListener("wheel", (event) => { Module._ui_wheel(-event.deltaY / 100); }, { passive: true });
    new ResizeObserver(() => Module._ui_wake()).observe(canvas);
    canvas.requestPaint?.();
});
// #endregion init

EM_JS(void, aria_begin, (), {
    const aria = __toolkitAria;
    aria.cursor = 0; aria.frame++; aria.moved = false;
});

// #region node
// Called once per widget per frame, in the order ImGui submitted the widgets.
// flags: 1 the widget overlaps its window's clip rectangle, 2 checked, 4 expanded.
EM_JS(void, aria_node, (const char *rolePtr, const char *labelPtr, int id, double x, double y, double w, double h,
                        double cx, double cy, double cw, double ch, int flags, double value, double lo, double hi, const char *textPtr), {
    const aria = __toolkitAria, canvas = aria.canvas;
    const role = UTF8ToString(rolePtr), label = UTF8ToString(labelPtr), text = UTF8ToString(textPtr);
    let item = aria.items.get(id);
    if (!item) {
        item = { id, role, el: aria.make(role, id), key: "", label: null, dirty: false };
        aria.items.set(id, item);
        aria.stats.created++;
    }
    const el = item.el;
    // DOM order is ImGui submission order, and DOM order is the Tab order. A node whose widget
    // has not been submitted yet this frame is taken out; it is put back if the widget follows.
    let next = canvas.children[aria.cursor];
    while (next && next !== el && next.__seen !== aria.frame) { next.remove(); next = canvas.children[aria.cursor]; }
    if (next !== el) canvas.insertBefore(el, next || null);
    el.__seen = aria.frame;
    aria.cursor++;

    // Name and state, ImGui to DOM. Each property is written only when it changed.
    if (item.label !== label) {
        item.label = label;
        if (role === "button" || role === "disclosure") el.textContent = label;
        else if (role !== "status") el.setAttribute("aria-label", label);
    }
    if (role === "status" && el.textContent !== text) el.textContent = text;
    if (role === "checkbox" && el.checked !== !!(flags & 2)) el.checked = !!(flags & 2);
    if (role === "disclosure") {
        const open = flags & 4 ? "true" : "false";
        if (el.getAttribute("aria-expanded") !== open) el.setAttribute("aria-expanded", open);
    }
    if (role === "slider") {
        if (el.min !== String(lo)) el.min = String(lo);
        if (el.max !== String(hi)) el.max = String(hi);
        if (el.value !== String(value)) el.value = String(value);
        if (el.getAttribute("aria-valuetext") !== text) el.setAttribute("aria-valuetext", text);
    }
    // While the text node has focus it holds the text and ImGui follows it.
    if (role === "textbox" && aria.focusId !== id && el.value !== text) el.value = text;
    // The node lays its text out with a browser font, ImGui with its own. For a click to put the
    // caret between the same two letters in both, the node's letter spacing is set so that its
    // text is as wide as ImGui's (value is the width ImGui measured). Exact for fixed-pitch fonts.
    if (role === "textbox" && text && el.value === text && item.spaced !== text) {
        item.spaced = text;
        aria.measure = aria.measure || new OffscreenCanvas(1, 1).getContext("2d");
        aria.measure.font = getComputedStyle(el).font;
        const spacing = (value - aria.measure.measureText(text).width) / text.length;
        el.style.letterSpacing = spacing.toFixed(3) + "px";
        item.spacing = spacing;
    }
    item.visible = !!(flags & 1); item.checked = !!(flags & 2); item.expanded = !!(flags & 4);
    item.value = value; item.text = text; item.rect = [x, y, w, h]; item.clip = [x + cx, y + cy, cw, ch];

    // Geometry. The node is never drawn. Its layout box gets the widget's size, and
    // updateElementGeometry() puts that box at the widget's place with the window's clip.
    const sw = w.toFixed(2) + "px", sh = h.toFixed(2) + "px";
    if (el.style.width !== sw) el.style.width = sw;
    if (el.style.height !== sh) el.style.height = sh;
    const key = [x, y, w, h, cx, cy, cw, ch].map((v) => Math.round(v * 100)).join();
    if (item.key === key) return;
    try {
        // canvasTransform has been seen in CSS px on some canvases and in buffer px on others: measure.
        const ukey = canvas.width + "/" + canvas.clientWidth;
        if (aria.unit.key !== ukey && el.offsetWidth > 0) {
            canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix() });
            const measured = el.getBoundingClientRect().width;
            if (measured > 0) aria.unit = { key: ukey, value: el.offsetWidth * (el.currentCSSZoom || 1) / measured };
        }
        canvas.updateElementGeometry(el, {
            canvasTransform: new DOMMatrix().scale(aria.unit.value).translate(x, y),
            canvasClip: new DOMRect(cx, cy, cw, ch),
        });
        item.key = key;
        aria.stats.places++;
        aria.moved = true;
    } catch (e) {
        // Before the first paint of a new node the call can throw. The next frame tries again.
        aria.stats.error = e.name + ": " + e.message;
        canvas.requestPaint?.();
    }
});
// #endregion node

// #region end
EM_JS(void, aria_end, (), {
    const aria = __toolkitAria, canvas = aria.canvas;
    // A widget that was not submitted this frame no longer exists: remove its node.
    for (const item of aria.items.values()) {
        if (item.el.__seen === aria.frame) continue;
        item.el.remove();
        aria.items.delete(item.id);
        aria.stats.removed++;
        aria.moved = true;
    }
    // Chromium 157 keeps a stale hit-test answer until an attribute on the canvas changes.
    if (aria.moved) canvas.toggleAttribute("data-geometry-tick");
    aria.stats.frames++;
    if (aria.onframe) aria.onframe();
});
// #endregion end

// #region focus-image
// Route (c): while the text node has focus, its own pixels (text, caret, selection, IME marks)
// are uploaded and drawn over the ImGui frame. Size in texels, packed as width * 65536 + height.
EM_JS(int, aria_image_size, (int id), {
    const item = __toolkitAria.items.get(id);
    if (!item) return 0;
    try {
        const size = GLctx.canvas.getElementImageDefaultSize(item.el);
        return Math.max(1, Math.ceil(size.width)) * 65536 + Math.max(1, Math.ceil(size.height));
    } catch (e) {
        GLctx.canvas.requestPaint?.();
        return 0;
    }
});
EM_JS(int, aria_is_dirty, (int id), { return __toolkitAria.items.get(id)?.dirty ? 1 : 0; });
// Copy the node into the texture that C++ bound. ImGui blends straight alpha.
EM_JS(int, aria_upload, (int id), {
    const aria = __toolkitAria, item = aria.items.get(id);
    if (!item) return 0;
    try {
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        GLctx.texElementSubImage2D(GLctx.TEXTURE_2D, 0, 0, 0, item.el);
        item.dirty = false;
        aria.stats.uploads++;
        return 1;
    } catch (e) {
        aria.stats.error = e.name + ": " + e.message;
        GLctx.canvas.requestPaint?.();
        return 0;
    }
});
// #endregion focus-image

EM_JS(void, dom_canvas_size, (double *css, int *buffer), {
    const canvas = GLctx.canvas;
    const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)), h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== w) canvas.width = w;      // assigning clears the canvas, so only on change
    if (canvas.height !== h) canvas.height = h;
    HEAPF64[css >> 3] = canvas.clientWidth; HEAPF64[(css >> 3) + 1] = canvas.clientHeight;
    HEAP32[buffer >> 2] = w; HEAP32[(buffer >> 2) + 1] = h;
});

// ---------------------------------------------------------------------------------------
// The ImGui side.

struct Pending { bool press = false, hasValue = false, hasText = false; double value = 0; std::string text; };
static std::map<ImGuiID, Pending> g_pending;       // changes that came from the DOM, waiting for their widget
static ImGuiID g_focus_request = 0;                // DOM focus moved to this widget's node
static bool g_focus_ring = false;                  // the browser would show a focus ring for it
static bool g_blur_request = false;
static ImGuiID g_dom_focus = 0;                    // the widget whose node has DOM focus now
static int g_caret[2] = { 0, 0 };                  // selection of the focused text node, UTF-8 bytes
static bool g_draw_focused = false;                // route (c)
static GLuint g_focus_texture = 0;
static int g_focus_tw = 0, g_focus_th = 0;
static int g_frames_wanted = 4;

// #region a11y
enum { A_Visible = 1, A_Checked = 2, A_Expanded = 4 };

// Report the widget ImGui has just submitted. Works for any item: the rectangle and the id
// come from ImGui's record of the last item.
static void A11y(const char *role, const char *label, int flags = 0, double value = 0, double lo = 0, double hi = 0, const char *text = "") {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    ImGuiWindow *window = g.CurrentWindow;
    ImGuiID id = g.LastItemData.ID ? g.LastItemData.ID : window->GetID(label);   // plain text has no id
    // NavRect is the frame of a slider or a text field without its label.
    ImRect rect = g.LastItemData.ID ? g.LastItemData.NavRect : g.LastItemData.Rect;
    ImRect clip = window->ClipRect;
    if (rect.Overlaps(clip)) flags |= A_Visible;
    std::string name(label, ImGui::FindRenderedTextEnd(label));                  // "Save##1" is named "Save"

    // DOM focus moved to this widget's node: make it ImGui's focused item and scroll it into view.
    if (g_focus_request == id) {
        ImGui::SetFocusID(id, window);
        g.NavCursorVisible = g_focus_ring;
        ImGui::ScrollToItem(ImGuiScrollFlags_KeepVisibleEdgeY);
        g_focus_request = 0;
    }
    aria_node(role, name.c_str(), (int)id, rect.Min.x, rect.Min.y, rect.GetWidth(), rect.GetHeight(),
              clip.Min.x - rect.Min.x, clip.Min.y - rect.Min.y, clip.GetWidth(), clip.GetHeight(), flags, value, lo, hi, text);
}

static Pending Take(ImGuiID id) {
    auto found = g_pending.find(id);
    if (found == g_pending.end()) return Pending();
    Pending p = found->second;
    g_pending.erase(found);
    return p;
}

// A press from the DOM uses ImGui's own keyboard activation path, so Button() returns true
// and CollapsingHeader() toggles with no change to either.
static void PressFromDom(ImGuiID id) {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    if (Take(id).press) g.NavActivateId = g.NavActivateDownId = g.NavActivatePressedId = id;
}

static bool AButton(const char *label) {
    PressFromDom(ImGui::GetID(label));
    bool pressed = ImGui::Button(label);
    A11y("button", label);
    return pressed;
}

static bool ACheckbox(const char *label, bool *v) {
    Pending p = Take(ImGui::GetID(label));
    if (p.hasValue) *v = p.value != 0;
    bool changed = ImGui::Checkbox(label, v) || p.hasValue;
    A11y("checkbox", label, *v ? A_Checked : 0);
    return changed;
}

static bool ASliderInt(const char *label, int *v, int lo, int hi, const char *format) {
    Pending p = Take(ImGui::GetID(label));
    if (p.hasValue) *v = ImClamp((int)p.value, lo, hi);
    bool changed = ImGui::SliderInt(label, v, lo, hi, format) || p.hasValue;
    char text[64];
    snprintf(text, sizeof text, format, *v);
    A11y("slider", label, 0, *v, lo, hi, text);
    return changed;
}

static bool ACollapsingHeader(const char *label) {
    PressFromDom(ImGui::GetID(label));
    bool open = ImGui::CollapsingHeader(label);
    A11y("disclosure", label, open ? A_Expanded : 0);
    return open;
}

static void AStatus(const char *label, const char *text) {
    ImGui::TextWrapped("%s", text);
    A11y("status", label, 0, 0, 0, 0, text);
}
// #endregion a11y

// #region text
// The text field. ImGui draws the frame and the text. The DOM node takes the typing, so the
// phone keyboard, IME and paste are the browser's. ImGui's own InputText never becomes active.
static bool AInputText(const char *label, char *buf, size_t size) {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    ImGuiID id = ImGui::GetID(label);
    Pending p = Take(id);
    if (p.hasText) snprintf(buf, size, "%s", p.text.c_str());
    bool focused = g_dom_focus == id;

    // Route (c): draw the focused node itself. Route (a): ImGui draws the text and a caret.
    bool image = false;
    if (focused && g_draw_focused) {
        int packed = aria_image_size((int)id);
        if (packed) {
            int tw = packed >> 16, th = packed & 0xffff;
            bool fresh = !g_focus_texture || tw != g_focus_tw || th != g_focus_th;
            if (!g_focus_texture) glGenTextures(1, &g_focus_texture);
            glBindTexture(GL_TEXTURE_2D, g_focus_texture);
            if (fresh) {
                glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, tw, th, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
                g_focus_tw = tw; g_focus_th = th;
            }
            static bool uploaded = false;
            if (fresh) uploaded = false;
            if (fresh || aria_is_dirty((int)id)) uploaded = aria_upload((int)id) || uploaded;
            image = uploaded;
        }
    }

    if (image) ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0, 0, 0, 0));   // the node's text replaces ImGui's
    ImGui::InputText(label, buf, size);
    if (image) ImGui::PopStyleColor();
    ImRect frame = g.LastItemData.NavRect;
    ImDrawList *draw = ImGui::GetWindowDrawList();
    if (image) {
        draw->AddImage((ImTextureID)(intptr_t)g_focus_texture, frame.Min, frame.Max);
        // The clear text colour also hid the label, so it is drawn again.
        draw->AddText(ImVec2(frame.Max.x + g.Style.ItemInnerSpacing.x, frame.Min.y + g.Style.FramePadding.y), ImGui::GetColorU32(ImGuiCol_Text), label, ImGui::FindRenderedTextEnd(label));
    } else if (focused) {
        // The caret and selection of the DOM node, drawn with ImGui's text metrics.
        int len = (int)strlen(buf), a = ImClamp(g_caret[0], 0, len), b = ImClamp(g_caret[1], 0, len);
        float x0 = frame.Min.x + g.Style.FramePadding.x, y0 = frame.Min.y + g.Style.FramePadding.y;
        float xa = x0 + ImGui::CalcTextSize(buf, buf + a).x, xb = x0 + ImGui::CalcTextSize(buf, buf + b).x;
        draw->PushClipRect(frame.Min, frame.Max, true);
        if (b > a) draw->AddRectFilled(ImVec2(xa, y0), ImVec2(xb, y0 + g.FontSize), ImGui::GetColorU32(ImGuiCol_TextSelectedBg));
        draw->AddLine(ImVec2(xb, y0 - 1), ImVec2(xb, y0 + g.FontSize + 1), ImGui::GetColorU32(ImGuiCol_InputTextCursor), 1.5f);
        draw->PopClipRect();
    }
    A11y("textbox", label, 0, ImGui::CalcTextSize(buf).x, 0, 0, buf);
    return p.hasText;
}
// #endregion text

// #region app
static void App() {
    ImGuiIO &io = ImGui::GetIO();
    static char title[64] = "Quarterly report";
    static bool autosave = true, spell = false, notify[8] = { true, false, false, true, false, false, false, false };
    static int volume = 40, saves = 0;
    static char status[160] = "Not saved yet.";

    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::Begin("Document settings, drawn by Dear ImGui", nullptr, ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse);
    ImGui::PushItemWidth(ImGui::GetContentRegionAvail().x * 0.62f);
    AInputText("Title", title, sizeof title);
    ACheckbox("Autosave", &autosave);
    ASliderInt("Volume", &volume, 0, 100, "%d %%");
    if (AButton("Save")) {
        saves++;
        snprintf(status, sizeof status, "Saved %d time%s: \"%s\", volume %d, autosave %s.", saves, saves == 1 ? "" : "s", title, volume, autosave ? "on" : "off");
    }
    AStatus("Status", status);
    if (ACollapsingHeader("Advanced")) {
        ACheckbox("Spell check", &spell);
        if (AButton("Reset")) {
            snprintf(title, sizeof title, "Untitled");
            volume = 40; autosave = true; spell = false;
            snprintf(status, sizeof status, "Reset to the defaults.");
        }
    }
    ImGui::SeparatorText("More rows, so the window scrolls");
    static const char *names[8] = { "Notify by email", "Notify by SMS", "Notify by push", "Weekly summary", "Monthly summary", "Security alerts", "Product news", "Surveys" };
    for (int i = 0; i < 8; i++) ACheckbox(names[i], &notify[i]);
    ImGui::PopItemWidth();
    ImGui::End();
}
// #endregion app

// #region loop
// Called by the browser every animation frame. It draws only when something asked for a frame:
// a pointer event, a change from the DOM, a paint event from the browser, or a resize.
static void Frame() {
    if (g_frames_wanted <= 0) return;
    g_frames_wanted--;
    ImGuiIO &io = ImGui::GetIO();
    double css[2]; int buffer[2];
    dom_canvas_size(css, buffer);
    io.DisplaySize = ImVec2((float)css[0], (float)css[1]);
    io.DisplayFramebufferScale = ImVec2(buffer[0] / (float)css[0], buffer[1] / (float)css[1]);
    io.DeltaTime = 1.0f / 60.0f;

    ImGui_ImplOpenGL3_NewFrame();
    ImGui::NewFrame();
    if (g_blur_request) { ImGui::GetCurrentContext()->NavCursorVisible = false; g_blur_request = false; }
    aria_begin();
    App();
    aria_end();
    ImGui::Render();
    glViewport(0, 0, buffer[0], buffer[1]);
    glClearColor(0.09f, 0.10f, 0.13f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}
// #endregion loop

extern "C" {
EMSCRIPTEN_KEEPALIVE void ui_wake() { if (g_frames_wanted < 4) g_frames_wanted = 4; }

// down: 1 press, 0 release, -1 move only.
EMSCRIPTEN_KEEPALIVE void ui_pointer(double x, double y, int down) {
    ImGuiIO &io = ImGui::GetIO();
    io.AddMousePosEvent((float)x, (float)y);
    if (down >= 0) io.AddMouseButtonEvent(0, down == 1);
    ui_wake();
}
// 1 while a slider, scrollbar or other ImGui control is held.
// A press on a window body also sets an active id (the window's move id), which does not count.
EMSCRIPTEN_KEEPALIVE int ui_item_active() {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    if (g.MovingWindow) return 1;
    return g.ActiveId && !(g.ActiveIdWindow && g.ActiveId == g.ActiveIdWindow->MoveId);
}
EMSCRIPTEN_KEEPALIVE void ui_wheel(double dy) { ImGui::GetIO().AddMouseWheelEvent(0, (float)dy); ui_wake(); }

// #region exports
// DOM to ImGui. Each call is stored and applied when its widget is next submitted.
EMSCRIPTEN_KEEPALIVE void aria_press(int id) { g_pending[(ImGuiID)id].press = true; ui_wake(); }
EMSCRIPTEN_KEEPALIVE void aria_set(int id, double value) { Pending &p = g_pending[(ImGuiID)id]; p.hasValue = true; p.value = value; ui_wake(); }
EMSCRIPTEN_KEEPALIVE void aria_text(int id, const char *text) { Pending &p = g_pending[(ImGuiID)id]; p.hasText = true; p.text = text; ui_wake(); }
EMSCRIPTEN_KEEPALIVE void aria_caret(int id, int start, int end) { g_caret[0] = start; g_caret[1] = end; ui_wake(); }
// id 0: focus left the widgets. ring: the browser matched :focus-visible on the node.
EMSCRIPTEN_KEEPALIVE void aria_focus(int id, int ring) {
    g_dom_focus = (ImGuiID)id;
    if (id) { g_focus_request = (ImGuiID)id; g_focus_ring = ring != 0; g_blur_request = false; }
    else { g_focus_request = 0; g_blur_request = true; }
    ui_wake();
}
// #endregion exports
EMSCRIPTEN_KEEPALIVE void aria_draw_focused(int on) { g_draw_focused = on != 0; ui_wake(); }
// For the live checks: what ImGui says its focused item is, and whether it draws the ring.
EMSCRIPTEN_KEEPALIVE int ui_nav_id() { return (int)ImGui::GetCurrentContext()->NavId; }
EMSCRIPTEN_KEEPALIVE int ui_nav_ring() { return ImGui::GetCurrentContext()->NavCursorVisible ? 1 : 0; }
}

int main() {
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.alpha = false;
    attrs.antialias = false;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = emscripten_webgl_create_context("#aria-app", &attrs);
    if (context <= 0) return 1;
    emscripten_webgl_make_context_current(context);

    ImGui::CreateContext();
    ImGuiIO &io = ImGui::GetIO();
    io.IniFilename = nullptr;
    // ImGui hides its focus ring unless keyboard navigation is on. The page sends ImGui no keys:
    // Tab, Space, Enter and the arrows are handled by the browser on the nodes.
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    ImGuiStyle &style = ImGui::GetStyle();
    ImGui::StyleColorsDark();
    style.FontSizeBase = 15.0f;
    style.ScaleAllSizes(1.4f);                         // larger targets for touch
    style.FramePadding = ImVec2(8, 9);                 // rows 33 px high
    style.ItemSpacing = ImVec2(8, 8);
    ImGui_ImplOpenGL3_Init("#version 300 es");
    aria_init();
    emscripten_set_main_loop(Frame, 0, false);
    return 0;
}
