// main.cpp: a Dear ImGui app for /toolkit-occlusion/.
// One ImGui window holds four DOM fields, each shown with one ImGui::Image() call on a texture
// filled by texElementSubImage2D(). Two more ImGui windows can be dragged over the fields.
//
// This file does not decide how a covered field stops taking the pointer. Each frame it reports
// where ImGui drew every field and which rectangle each covering window claims. The page script
// (public/toolkit-occlusion/routes.js) turns that into updateElementGeometry() calls, CSS or
// extra elements, one way per occlusion route.

#include "imgui.h"
#include "imgui_internal.h"   // FindHoveredWindowEx(), ImGuiWindow
#include "imgui_impl_opengl3.h"
#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <map>
#include <string>

// ---------------------------------------------------------------------------------------
// The browser side. GLctx is Emscripten's WebGL2 context, the one ImGui renders with.

EM_JS(void, dom_init, (), {
    const canvas = GLctx.canvas;
    const app = globalThis.__occApp = {
        canvas, items: {}, covers: [],
        stats: { frames: 0, paints: 0, uploads: 0, error: "" },
        onFrame: null,          // set by routes.js: called after every ImGui frame
    };
    canvas.setAttribute("content", "drawable");
    canvas.setAttribute("layoutsubtree", "");
    for (const el of canvas.querySelectorAll("[data-occ]")) {
        el.setAttribute("drawable", "");
        app.items[el.dataset.occ] = { name: el.dataset.occ, el, dirty: true, rect: null, clip: null };
        el.addEventListener("input", () => Module._ui_wake());
        el.addEventListener("change", () => Module._ui_wake());
    }
    // The browser painted canvas children: mark them for upload and ask ImGui for frames.
    canvas.addEventListener("paint", (event) => {
        app.stats.paints++;
        const changed = event.changedElements ? new Set(event.changedElements) : null;
        let any = false;
        for (const item of Object.values(app.items)) if (!changed || changed.has(item.el)) { item.dirty = true; any = true; }
        if (any) Module._ui_wake();
    });
    canvas.addEventListener("focusin", () => Module._ui_wake());
    canvas.addEventListener("focusout", () => Module._ui_wake());
    new ResizeObserver(() => Module._ui_wake()).observe(canvas);
    canvas.requestPaint?.();
});

// The toolkit gives a width, the browser lays the element out and answers with the height.
EM_JS(int, dom_layout, (const char *namePtr, double width), {
    const item = __occApp.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    const px = Math.round(width) + "px";
    if (item.el.style.width !== px) item.el.style.width = px;
    return item.el.offsetHeight;
});

// Size of the element's image in texels, packed as width * 65536 + height. 0 before the first paint.
EM_JS(int, dom_image_size, (const char *namePtr), {
    const item = __occApp.items[UTF8ToString(namePtr)];
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
    return __occApp.items[UTF8ToString(namePtr)]?.dirty ? 1 : 0;
});

// #region upload
// Copy the element's pixels into the texture that C++ has bound to TEXTURE_2D.
// ImGui's OpenGL backend blends straight alpha, so the texels are not premultiplied.
EM_JS(int, dom_upload, (const char *namePtr), {
    const item = __occApp.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    try {
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        GLctx.texElementSubImage2D(GLctx.TEXTURE_2D, 0, 0, 0, item.el);
        item.dirty = false;
        __occApp.stats.uploads++;
        return 1;
    } catch (e) {
        __occApp.stats.error = e.name + ": " + e.message;
        GLctx.canvas.requestPaint?.();
        return 0;
    }
});
// #endregion upload

// #region report
// Where ImGui drew a field (canvas CSS px) and the clip rectangle of its window.
EM_JS(void, dom_field, (const char *namePtr, double x, double y, double w, double h, double cx, double cy, double cw, double ch, int shown), {
    const item = __occApp.items[UTF8ToString(namePtr)];
    if (!item) return;
    item.rect = [x, y, w, h];
    item.clip = shown ? [cx, cy, cw, ch] : null;
});
// The rectangle in which a window above the fields takes the pointer, back to front.
EM_JS(void, dom_cover, (int index, int count, double x, double y, double w, double h), {
    const covers = __occApp.covers;
    covers.length = count;
    if (index < count) covers[index] = [x, y, w, h];
});
// One ImGui frame is done. moved: a covering window changed its rectangle in this frame.
EM_JS(void, dom_frame_done, (int moved), {
    __occApp.stats.frames++;
    __occApp.onFrame?.(!!moved);
});
// #endregion report

EM_JS(void, dom_canvas_size, (double *css, int *buffer), {
    const canvas = GLctx.canvas;
    const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)), h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== w) canvas.width = w;      // assigning clears the canvas, so only on change
    if (canvas.height !== h) canvas.height = h;
    HEAPF64[css >> 3] = canvas.clientWidth; HEAPF64[(css >> 3) + 1] = canvas.clientHeight;
    HEAP32[buffer >> 2] = w; HEAP32[(buffer >> 2) + 1] = h;
});

// For the live checks only: one texel of a field's texture, read through a framebuffer.
// Returns r, g, b, a packed into one number, or -1. u and v are 0 to 1 from the top left.
EM_JS(double, dom_texel, (int texture, int width, int height, double u, double v), {
    const gl = GLctx, tex = GL.textures[texture];
    if (!tex) return -1;
    const fb = gl.createFramebuffer(), px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) gl.readPixels(Math.min(width - 1, Math.floor(u * width)), Math.min(height - 1, Math.floor(v * height)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    return ok ? px[0] * 16777216 + px[1] * 65536 + px[2] * 256 + px[3] : -1;
});

// ---------------------------------------------------------------------------------------
// The ImGui side.

struct DomItem { GLuint texture = 0; int width = 0, height = 0; ImGuiWindow *window = nullptr; ImRect rect; };
static std::map<std::string, DomItem> g_items;
static int g_frames_wanted = 4;
static ImGuiWindow *g_form = nullptr;
struct Cover { bool set = false; ImVec2 pos, size; ImRect last; };
static Cover g_cover[2];

// #region widget
// A DOM element as an ImGui item. Returns false until the browser has painted the element.
static bool DomImage(const char *name, float width) {
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
    ImGui::ImageWithBg((ImTextureID)(intptr_t)item.texture, ImVec2(width, height));

    // Where ImGui put it, and what its window clips, go to the page script.
    ImGuiWindow *window = ImGui::GetCurrentWindow();
    ImRect clip = window->ClipRect;
    item.window = window;
    item.rect = ImRect(pos, ImVec2(pos.x + width, pos.y + height));
    bool shown = ImGui::IsItemVisible() && clip.Overlaps(item.rect);
    dom_field(name, pos.x, pos.y, width, height, clip.Min.x, clip.Min.y, clip.GetWidth(), clip.GetHeight(), shown);
    return true;
}
// #endregion widget

// #region app
static void CoverWindow(int index, const char *title, ImVec2 firstPos) {
    Cover &cover = g_cover[index];
    if (cover.set) {                                    // a preset button or a live check placed it
        ImGui::SetNextWindowPos(cover.pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(cover.size, ImGuiCond_Always);
        cover.set = false;
    } else {
        ImGui::SetNextWindowPos(firstPos, ImGuiCond_FirstUseEver);
        ImGui::SetNextWindowSize(ImVec2(150, 104), ImGuiCond_FirstUseEver);
    }
    ImGui::Begin(title, nullptr, ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextWrapped("Drag me over a field.");
    ImGui::End();
}

static void App() {
    ImGuiIO &io = ImGui::GetIO();
    float w = io.DisplaySize.x - 16 > 420 ? 420 : io.DisplaySize.x - 16;

    // The form stays behind the other windows, so they always cover it.
    ImGui::SetNextWindowPos(ImVec2(8, 8), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(w, 0), ImGuiCond_Always);
    ImGui::Begin("Form: four DOM fields", nullptr,
                 ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
                 ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoScrollbar);
    g_form = ImGui::GetCurrentWindow();
    float inner = ImGui::GetContentRegionAvail().x;
    ImGui::TextDisabled("<input>");
    DomImage("name", inner);
    ImGui::TextDisabled("<textarea>");
    DomImage("notes", inner);
    ImGui::TextDisabled("<select>");
    DomImage("country", inner);
    ImGui::TextDisabled("<p> with a link");
    DomImage("terms", inner);
    ImGui::End();

    float y = io.DisplaySize.y - 116;
    CoverWindow(0, "Window A", ImVec2(8, y));
    CoverWindow(1, "Window B", ImVec2(io.DisplaySize.x - 158, y));
}
// #endregion app

// #region covers
// The rectangle in which ImGui gives the pointer to a window is larger than the window it draws:
// FindHoveredWindowEx() pads it by TouchExtraPadding or WindowBorderHoverPadding. That padded
// rectangle is what covers a field as far as input goes, so that is what the page is told.
static ImRect HitRect(ImGuiWindow *window) {
    ImGuiStyle &style = ImGui::GetStyle();
    ImVec2 pad = style.TouchExtraPadding;
    if (!(window->Flags & (ImGuiWindowFlags_NoResize | ImGuiWindowFlags_AlwaysAutoResize)))
        pad = ImMax(pad, ImVec2(style.WindowBorderHoverPadding, style.WindowBorderHoverPadding));
    ImRect r = window->OuterRectClipped;
    r.Expand(pad);
    return r;
}

// Every root window above the form in ImGui's z-order, back to front. Returns 1 if one moved.
static int ReportCovers() {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    ImGuiWindow *above[8];
    int count = 0;
    bool past = false;
    for (ImGuiWindow *window : g.Windows) {
        if (window == g_form) { past = true; continue; }
        if (!past || !window->Active || window->Hidden || window->RootWindow != window || count == 8) continue;
        above[count++] = window;
    }
    int moved = 0;
    static ImRect last[8];
    static int lastCount = -1;
    if (count != lastCount) moved = 1;
    lastCount = count;
    if (!count) dom_cover(0, 0, 0, 0, 0, 0);
    for (int i = 0; i < count; i++) {
        ImRect r = HitRect(above[i]);
        if (r.Min.x != last[i].Min.x || r.Min.y != last[i].Min.y || r.Max.x != last[i].Max.x || r.Max.y != last[i].Max.y) moved = 1;
        last[i] = r;
        dom_cover(i, count, r.Min.x, r.Min.y, r.GetWidth(), r.GetHeight());
    }
    return moved;
}
// #endregion covers

// #region loop
// Called by the browser every animation frame. It draws only when something asked for a frame:
// a pointer event, a paint event from the browser, or a resize.
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
    dom_frame_done(ReportCovers());
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

// Put covering window 0 or 1 at a place, for the preset buttons and the live checks.
EMSCRIPTEN_KEEPALIVE void ui_set_cover(int index, double x, double y, double w, double h) {
    if (index < 0 || index > 1) return;
    g_cover[index].set = true;
    g_cover[index].pos = ImVec2((float)x, (float)y);
    g_cover[index].size = ImVec2((float)w, (float)h);
    ui_wake();
}

// 1 while a window is being dragged or resized.
EMSCRIPTEN_KEEPALIVE int ui_busy() {
    ImGuiContext &g = *ImGui::GetCurrentContext();
    return g.MovingWindow || g.ActiveId ? 1 : 0;
}

// #region guard
// The guard of /imgui-dom/: is the form, the window that holds the fields, the top one at this
// point? The page asks before an event reaches a field. While a window is dragged, the answer
// is that window everywhere.
EMSCRIPTEN_KEEPALIVE int ui_visible_at(double x, double y) {
    ImGuiWindow *top = nullptr;
    ImGui::FindHoveredWindowEx(ImVec2((float)x, (float)y), false, &top, nullptr);
    return !top || top->RootWindow == g_form;
}
// #endregion guard

// The measurement's ground truth: does a window above the form take the pointer at this point?
// Unlike the guard this ignores a drag in progress.
EMSCRIPTEN_KEEPALIVE int ui_covered_at(double x, double y) {
    ImGuiWindow *top = nullptr;
    ImGui::FindHoveredWindowEx(ImVec2((float)x, (float)y), true, &top, nullptr);
    return top && g_form && top->RootWindow != g_form;
}

// For the live checks: a texel of a field's texture. field: 0 input, 1 textarea, 2 select, 3 paragraph.
EMSCRIPTEN_KEEPALIVE double ui_texel(int field, double u, double v) {
    static const char *names[] = { "name", "notes", "country", "terms" };
    if (field < 0 || field > 3) return -1;
    auto found = g_items.find(names[field]);
    if (found == g_items.end() || !found->second.texture) return -1;
    return dom_texel((int)found->second.texture, found->second.width, found->second.height, u, v);
}
}

int main() {
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.alpha = false;
    attrs.antialias = false;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = emscripten_webgl_create_context("#occlusion-app", &attrs);
    if (context <= 0) return 1;
    emscripten_webgl_make_context_current(context);

    ImGui::CreateContext();
    ImGuiIO &io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigWindowsMoveFromTitleBarOnly = false;      // a finger can drag a window by any part of it
    ImGuiStyle &style = ImGui::GetStyle();
    ImGui::StyleColorsDark();
    style.FontSizeBase = 15.0f;
    style.ScaleAllSizes(1.4f);                         // larger targets for touch
    style.TouchExtraPadding = ImVec2(4, 4);
    style.WindowMinSize = ImVec2(48, 48);
    style.Colors[ImGuiCol_WindowBg].w = 1.0f;          // opaque, so a covered field cannot be seen
    ImGui_ImplOpenGL3_Init("#version 300 es");
    dom_init();
    emscripten_set_main_loop(Frame, 0, false);
    return 0;
}
