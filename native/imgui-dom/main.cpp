// main.cpp: a Dear ImGui app whose windows hold real DOM elements.
// Dear ImGui draws what the application gives it as textures, so a DOM element is shown with
// one ImGui::Image() call. The EM_JS functions below are the browser side: they fill the
// texture with texElementSubImage2D() and report where ImGui drew it with updateElementGeometry().
//
// No GLFW or SDL: the WebGL context comes from Emscripten's html5.h and the pointer from the page.

#include "imgui.h"
#include "imgui_internal.h"   // FindHoveredWindowEx(), for "which window is on top at this point"
#include "imgui_impl_opengl3.h"
#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <map>
#include <string>

// ---------------------------------------------------------------------------------------
// The browser side. GLctx is Emscripten's WebGL2 context, the one ImGui renders with.

// #region init
EM_JS(void, dom_init, (), {
    const canvas = GLctx.canvas;
    const dom = globalThis.__imguiDom = {
        items: {}, unit: { key: "", value: 1 },
        stats: { frames: 0, paints: 0, uploads: 0, places: 0, error: "" },
        element: (name) => dom.items[name]?.el,
        visibleAt: (name, x, y) => !!Module._ui_visible_at(stringToUTF8OnStack(name), x, y),
    };
    canvas.setAttribute("content", "drawable");
    canvas.setAttribute("layoutsubtree", "");
    for (const el of canvas.querySelectorAll("[data-imgui]")) {
        el.setAttribute("drawable", "");
        dom.items[el.dataset.imgui] = { el, dirty: true, key: "", parked: false };
        // ImGui gets its input from listeners on the canvas. An event the browser gave to a real
        // element stops here, unless ImGui has a window over the element at that point.
        for (const type of ["pointerdown", "pointerup", "mousedown", "touchstart", "keydown", "keyup", "wheel", "contextmenu"])
            el.addEventListener(type, (event) => { if (!event.imguiOwns) event.stopPropagation(); });
        el.addEventListener("input", () => Module._ui_wake());
        el.addEventListener("change", () => Module._ui_wake());
    }
    // The browser painted canvas children: mark them for upload and ask ImGui for frames.
    canvas.addEventListener("paint", (event) => {
        dom.stats.paints++;
        const changed = event.changedElements ? new Set(event.changedElements) : null;
        for (const item of Object.values(dom.items)) if (!changed || changed.has(item.el)) item.dirty = true;
        Module._ui_wake();
    });
    canvas.addEventListener("focusin", () => Module._ui_wake());
    canvas.addEventListener("focusout", () => Module._ui_wake());

    // Pointer. The capture phase sees every event before a child element does.
    const at = (event) => { const r = canvas.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top]; };
    let touchY = null;
    const guard = (event) => {
        const [x, y] = at(event);
        const name = event.target?.closest?.("[data-imgui]")?.dataset.imgui;
        if (name && !dom.visibleAt(name, x, y)) {
            // An ImGui window or popup is over the element here. ImGui takes the event.
            event.imguiOwns = true;
            if (event.type === "pointerdown") event.preventDefault();   // no focus, no native picker
            const item = dom.items[name];
            item.parked = true; item.key = "";
            canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix().translate(-100000, -100000) });
            canvas.toggleAttribute("data-geometry-tick");
        }
        // ImGui also hears a press on a visible element: an image is not an ImGui control, so the
        // press only focuses the window and closes an open ImGui popup.
        if (event.type === "pointerdown") {
            if (event.target === canvas) try { canvas.setPointerCapture(event.pointerId); } catch {}
            touchY = event.pointerType === "touch" ? y : null;
            Module._ui_pointer(x, y, 1);
        } else if (event.type === "pointerup") {
            touchY = null;
            Module._ui_pointer(x, y, 0);
        } else {
            Module._ui_pointer(x, y, -1);
            // ImGui has no touch scrolling. A vertical touch drag that is not on a slider, a
            // scrollbar or a title bar becomes wheel input for the window under the finger.
            if (touchY !== null && !Module._ui_item_active()) { Module._ui_wheel((y - touchY) / 60); touchY = y; }
        }
    };
    for (const type of ["pointermove", "pointerdown", "pointerup"]) canvas.addEventListener(type, guard, true);
    canvas.addEventListener("pointercancel", () => { touchY = null; Module._ui_pointer(-1e4, -1e4, 0); });
    canvas.addEventListener("pointerleave", (event) => { if (event.pointerType !== "mouse") Module._ui_pointer(-1e4, -1e4, -1); });
    canvas.addEventListener("wheel", (event) => { Module._ui_wheel(-event.deltaY / 100); }, { passive: true });
    // Keys for ImGui's own widgets, when the canvas itself has focus.
    canvas.addEventListener("keydown", (event) => {
        if (event.target !== canvas) return;
        const named = ({ Backspace: 1, Delete: 2, ArrowLeft: 3, ArrowRight: 4, Enter: 5, Tab: 6, Home: 7, End: 8 })[event.key] || 0;
        if (named) { Module._ui_key(named, 0); if (named !== 6) event.preventDefault(); }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) { Module._ui_key(0, event.key.codePointAt(0)); event.preventDefault(); }
    });
    new ResizeObserver(() => Module._ui_wake()).observe(canvas);
    canvas.requestPaint?.();
});
// #endregion init

// The toolkit gives a width, the browser lays the element out and answers with the height.
EM_JS(int, dom_layout, (const char *namePtr, double width), {
    const item = __imguiDom.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    const px = Math.round(width) + "px";
    if (item.el.style.width !== px) item.el.style.width = px;
    return item.el.offsetHeight;
});

// Size of the element's image in texels, packed as width * 65536 + height. 0 before the first paint.
EM_JS(int, dom_image_size, (const char *namePtr), {
    const item = __imguiDom.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    try {
        const size = GLctx.canvas.getElementImageDefaultSize(item.el);
        return Math.max(1, Math.ceil(size.width)) * 65536 + Math.max(1, Math.ceil(size.height));
    } catch (e) {
        GLctx.canvas.requestPaint?.();
        return 0;
    }
});

EM_JS(int, dom_is_dirty, (const char *namePtr), {
    return __imguiDom.items[UTF8ToString(namePtr)]?.dirty ? 1 : 0;
});

// #region upload
// Copy the element's pixels into the texture that C++ has bound to TEXTURE_2D.
// ImGui's OpenGL backend blends straight alpha, so the texels are not premultiplied.
EM_JS(int, dom_upload, (const char *namePtr), {
    const item = __imguiDom.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    try {
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        GLctx.texElementSubImage2D(GLctx.TEXTURE_2D, 0, 0, 0, item.el);
        item.dirty = false;
        __imguiDom.stats.uploads++;
        return 1;
    } catch (e) {
        __imguiDom.stats.error = e.name + ": " + e.message;
        GLctx.canvas.requestPaint?.();
        return 0;
    }
});
// #endregion upload

// #region place
// Tell the browser where ImGui drew the element (canvas CSS px) and which part its window clips,
// so hit testing, the caret, focus rings and the accessibility tree use that place.
// shown 0: the element is scrolled out of view, in a collapsed window, or under another window.
EM_JS(void, dom_place, (const char *namePtr, double x, double y, double cx, double cy, double cw, double ch, int shown), {
    const dom = __imguiDom, canvas = GLctx.canvas, item = dom.items[UTF8ToString(namePtr)];
    if (!item) return;
    const key = shown ? [x, y, cx, cy, cw, ch].map((v) => Math.round(v * 100)).join() : "off";
    if (item.key === key) return;
    item.key = key;
    item.parked = !shown;
    if (!shown) {
        canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix().translate(-100000, -100000) });
    } else {
        // canvasTransform has been seen in CSS px on some canvases and in buffer px on others: measure.
        const ukey = canvas.width + "/" + canvas.clientWidth + "/" + item.el.offsetWidth;
        if (dom.unit.key !== ukey) {
            canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix() });
            const measured = item.el.getBoundingClientRect().width;
            if (measured > 0 && item.el.offsetWidth > 0) dom.unit = { key: ukey, value: item.el.offsetWidth * (item.el.currentCSSZoom || 1) / measured };
        }
        canvas.updateElementGeometry(item.el, {
            canvasTransform: new DOMMatrix().scale(dom.unit.value).translate(x, y),
            canvasClip: new DOMRect(cx, cy, cw, ch),
        });
        dom.stats.places++;
    }
    canvas.toggleAttribute("data-geometry-tick");   // Chromium 157 keeps a stale hit-test result otherwise
});
// #endregion place

EM_JS(void, dom_canvas_size, (double *css, int *buffer), {
    const canvas = GLctx.canvas;
    const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)), h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== w) canvas.width = w;      // assigning clears the canvas, so only on change
    if (canvas.height !== h) canvas.height = h;
    HEAPF64[css >> 3] = canvas.clientWidth; HEAPF64[(css >> 3) + 1] = canvas.clientHeight;
    HEAP32[buffer >> 2] = w; HEAP32[(buffer >> 2) + 1] = h;
});

EM_JS(void, dom_frame_done, (), { __imguiDom.stats.frames++; });

// ---------------------------------------------------------------------------------------
// The ImGui side.

struct DomItem { GLuint texture = 0; int width = 0, height = 0; ImGuiWindow *window = nullptr; ImRect rect; };
static std::map<std::string, DomItem> g_items;
static int g_frames_wanted = 4;
static int g_cover = 0;

// #region widget
// A DOM element as an ImGui item. Returns false until the browser has painted the element.
static bool DomImage(const char *name, float width, float alpha = 1.0f) {
    DomItem &item = g_items[name];
    float height = (float)dom_layout(name, width);              // the browser's layout answers
    ImVec2 pos = ImGui::GetCursorScreenPos();
    int packed = dom_image_size(name);
    if (!packed) { ImGui::Dummy(ImVec2(width, height)); return false; }
    int tw = packed >> 16, th = packed & 0xffff;
    bool fresh = !item.texture || tw != item.width || th != item.height;
    if (!item.texture) glGenTextures(1, &item.texture);
    if (fresh || dom_is_dirty(name)) {
        glBindTexture(GL_TEXTURE_2D, item.texture);
        if (fresh) {
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, tw, th, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            item.width = tw; item.height = th;
        }
        dom_upload(name);
    }

    // The one ImGui call. Everything ImGui does to an image applies: clipping, scrolling, tint.
    ImGui::ImageWithBg((ImTextureID)(intptr_t)item.texture, ImVec2(width, height), ImVec2(0, 0), ImVec2(1, 1),
                       ImVec4(0, 0, 0, 0), ImVec4(1, 1, 1, alpha));

    // Where ImGui put it, and what its window clips, go back to the browser.
    ImGuiWindow *window = ImGui::GetCurrentWindow();
    ImRect clip = window->ClipRect;
    item.window = window;
    item.rect = ImRect(pos, ImVec2(pos.x + width, pos.y + height));
    ImVec2 mouse = ImGui::GetIO().MousePos;
    bool visible = ImGui::IsItemVisible() && clip.Overlaps(item.rect);
    if (visible && item.rect.Contains(mouse)) {                 // is another window on top at the pointer?
        ImGuiWindow *top = nullptr;
        ImGui::FindHoveredWindowEx(mouse, false, &top, nullptr);
        if (top && top->RootWindow != window->RootWindow) visible = false;
    }
    dom_place(name, pos.x, pos.y, clip.Min.x - pos.x, clip.Min.y - pos.y, clip.GetWidth(), clip.GetHeight(), visible);
    return true;
}
// #endregion widget

// #region app
static void App() {
    ImGuiIO &io = ImGui::GetIO();
    static float alpha = 1.0f;
    static char name[64] = "typed into ImGui::InputText";
    static int corners = 0;
    float w = io.DisplaySize.x - 16 > 400 ? 400 : io.DisplaySize.x - 16;

    ImGui::SetNextWindowPos(ImVec2(8, 8), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(w, io.DisplaySize.y - 110), ImGuiCond_FirstUseEver);
    ImGui::Begin("Account (a Dear ImGui window)");
    float inner = ImGui::GetContentRegionAvail().x;
    ImGui::SeparatorText("Drawn by ImGui");
    ImGui::SetNextItemWidth(inner);
    ImGui::InputText("##name", name, sizeof name);
    ImGui::SetNextItemWidth(inner);
    ImGui::Combo("##corners", &corners, "ImGui::Combo: square corners\0ImGui::Combo: round corners\0ImGui::Combo: rounder corners\0");
    ImGui::SetNextItemWidth(inner);
    ImGui::SliderFloat("##alpha", &alpha, 0.2f, 1.0f, "DOM tint alpha %.2f");
    ImGui::SeparatorText("DOM elements, each one ImGui::Image()");
    DomImage("email", inner, alpha);
    DomImage("country", inner, alpha);
    DomImage("birthday", inner, alpha);
    DomImage("about", inner, alpha);
    DomImage("terms", inner, alpha);
    ImGui::SeparatorText("More ImGui rows, so the window scrolls");
    for (int i = 0; i < 6; i++) ImGui::BulletText("Row %d", i + 1);
    ImGui::End();

    if (g_cover) {                                     // the live checks put this window over the email field
        ImGui::SetNextWindowPos(g_items["email"].rect.Min, ImGuiCond_Always);
        ImGui::SetNextWindowFocus();
        g_cover = 0;
    } else {
        ImGui::SetNextWindowPos(ImVec2(24, io.DisplaySize.y - 96), ImGuiCond_FirstUseEver);
    }
    ImGui::SetNextWindowSize(ImVec2(w - 60, 84), ImGuiCond_FirstUseEver);
    ImGui::Begin("Drag me over the fields");
    ImGui::TextWrapped("A field under this window takes no clicks.");
    ImGui::End();

    ImGui::GetStyle().FrameRounding = ImGui::GetStyle().WindowRounding = corners * 5.0f;
}
// #endregion app

// #region loop
// Called by the browser every animation frame. It draws only when something asked for a frame:
// a pointer or key event, a paint event from the browser, or a resize.
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
    App();
    ImGui::Render();
    glViewport(0, 0, buffer[0], buffer[1]);
    glClearColor(0.09f, 0.10f, 0.13f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
    dom_frame_done();
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
// 1 while a slider, scrollbar or other ImGui control is held, or a window is being moved.
// A press on a window body also sets an active id (the window's move id), which does not count.
EMSCRIPTEN_KEEPALIVE int ui_item_active() {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    if (g.MovingWindow) return 1;
    return g.ActiveId && !(g.ActiveIdWindow && g.ActiveId == g.ActiveIdWindow->MoveId);
}
EMSCRIPTEN_KEEPALIVE void ui_cover() { g_cover = 1; ui_wake(); }
EMSCRIPTEN_KEEPALIVE void ui_wheel(double dy) { ImGui::GetIO().AddMouseWheelEvent(0, (float)dy); ui_wake(); }

EMSCRIPTEN_KEEPALIVE void ui_key(int named, int codepoint) {
    static const ImGuiKey keys[] = { ImGuiKey_None, ImGuiKey_Backspace, ImGuiKey_Delete, ImGuiKey_LeftArrow, ImGuiKey_RightArrow, ImGuiKey_Enter, ImGuiKey_Tab, ImGuiKey_Home, ImGuiKey_End };
    ImGuiIO &io = ImGui::GetIO();
    if (named > 0 && named < 9) { io.AddKeyEvent(keys[named], true); io.AddKeyEvent(keys[named], false); }
    else if (codepoint) io.AddInputCharacter((unsigned)codepoint);
    ui_wake();
}

// Is the element's own ImGui window the top one at this point? Asked by the page before an
// event reaches the element, because the browser does not know what ImGui drew over it.
EMSCRIPTEN_KEEPALIVE int ui_visible_at(const char *name, double x, double y) {
    auto found = g_items.find(name);
    if (found == g_items.end() || !found->second.window) return 1;
    ImGuiWindow *top = nullptr;
    ImGui::FindHoveredWindowEx(ImVec2((float)x, (float)y), false, &top, nullptr);
    return !top || top->RootWindow == found->second.window->RootWindow;
}
}

int main() {
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.alpha = false;
    attrs.antialias = false;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = emscripten_webgl_create_context("#imgui-app", &attrs);
    if (context <= 0) return 1;
    emscripten_webgl_make_context_current(context);

    ImGui::CreateContext();
    ImGuiIO &io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigWindowsMoveFromTitleBarOnly = true;       // a drag on a window body scrolls it on a phone
    ImGuiStyle &style = ImGui::GetStyle();
    ImGui::StyleColorsDark();
    style.FontSizeBase = 15.0f;
    style.ScaleAllSizes(1.4f);                         // larger targets for touch
    style.TouchExtraPadding = ImVec2(4, 4);
    ImGui_ImplOpenGL3_Init("#version 300 es");
    dom_init();
    emscripten_set_main_loop(Frame, 0, false);
    return 0;
}
