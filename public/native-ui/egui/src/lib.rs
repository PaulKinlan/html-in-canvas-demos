//! egui-dom: real DOM elements as widgets inside an egui (Rust, WebAssembly, WebGL2) app.
//!
//! The elements are children of the canvas that egui renders into. egui lays them out like
//! any other widget, the browser paints them, and `texElementSubImage2D` copies that paint
//! into a texture that egui draws in its own WebGL pass. `updateElementGeometry` tells the
//! browser where the widget ended up so that clicks, typing and the accessibility tree use
//! the real element.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use eframe::egui;
use eframe::egui_glow;
use eframe::glow::{self, HasContext as _};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/bridge.js")]
extern "C" {
    fn init(canvas: &web_sys::HtmlCanvasElement, on_change: &JsValue, is_visible_at: &JsValue);
    fn layout(name: &str, width: f32) -> f32;
    fn image_size(name: &str) -> Vec<f32>;
    fn is_dirty(name: &str) -> bool;
    fn upload(name: &str) -> bool;
    #[allow(clippy::too_many_arguments)]
    fn place(name: &str, x: f32, y: f32, scale: f32, clip_x: f32, clip_y: f32, clip_w: f32, clip_h: f32, shown: bool);
    fn pointer_pos() -> Vec<f32>;
    fn value(name: &str) -> String;
    fn set_value(name: &str, text: &str);
    fn dom_has_focus() -> bool;
    fn option(name: &str) -> String;
}

// ----------------------------------------------------------------------------
// The widget

/// How a DOM widget's texture is drawn. Plain is a straight copy.
#[derive(Clone, Copy, PartialEq)]
pub struct Look {
    pub opacity: f32,
    pub wave: f32,
    pub tint: [f32; 3],
}

impl Default for Look {
    fn default() -> Self {
        Self { opacity: 1.0, wave: 0.0, tint: [1.0, 1.0, 1.0] }
    }
}

#[derive(Default)]
struct GlState {
    program: Option<glow::Program>,
    vao: Option<glow::VertexArray>,
    textures: HashMap<String, (glow::Texture, i32, i32)>,
}

/// Where each DOM widget was last drawn: its egui layer and visible rectangle, in points.
type Placements = Arc<Mutex<HashMap<String, (egui::LayerId, egui::Rect)>>>;

#[derive(Clone, Default)]
pub struct DomWidgets {
    gl: Arc<Mutex<GlState>>,
    placements: Placements,
}

impl DomWidgets {
    // #region widget
    /// Add the element `<… data-egui="name">` to the UI at the given width.
    /// The browser decides the height. Returns the egui response for the allocated space.
    pub fn show(&self, ui: &mut egui::Ui, name: &str, width: f32, look: Look) -> egui::Response {
        // 1. Layout: egui picks the width, the browser lays the element out and reports its height.
        let height = layout(name, width).max(1.0);
        let (rect, response) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());

        // 2. Where is it really visible? An egui scroll area can clip it, and another egui
        //    window can be on top of it at the pointer.
        let clip = ui.clip_rect().intersect(rect);
        let mut shown = ui.is_rect_visible(rect) && clip.is_positive();
        let zoom = ui.ctx().zoom_factor();
        if let [px, py] = pointer_pos()[..] {
            let p = egui::pos2(px / zoom, py / zoom);
            if rect.contains(p) && ui.ctx().layer_id_at(p).is_some_and(|top| top != ui.layer_id()) {
                shown = false;
            }
        }
        self.placements.lock().unwrap().insert(name.to_owned(), (ui.layer_id(), clip));

        // 3. Hit testing and accessibility: tell the browser where the element is drawn.
        place(
            name,
            rect.min.x * zoom,
            rect.min.y * zoom,
            zoom,
            clip.min.x - rect.min.x,
            clip.min.y - rect.min.y,
            clip.width(),
            clip.height(),
            shown,
        );

        // 4. Paint: a callback that runs inside egui's WebGL pass, in z-order with egui's own shapes.
        if ui.is_rect_visible(rect) {
            let gl_state = self.gl.clone();
            let name = name.to_owned();
            let time = ui.input(|i| i.time) as f32;
            let callback = egui_glow::CallbackFn::new(move |_info, painter| {
                draw(painter.gl(), &mut gl_state.lock().unwrap(), &name, look, time);
            });
            ui.painter().add(egui::PaintCallback { rect, callback: Arc::new(callback) });
            if look.wave > 0.0 {
                ui.ctx().request_repaint();
            }
        }
        response
    }
    // #endregion widget

    /// Is this widget the top thing at a point (canvas CSS px)? Asked by the bridge before the
    /// browser delivers a pointer event to the element.
    fn visible_at(&self, ctx: &egui::Context, name: &str, x: f32, y: f32) -> bool {
        let zoom = ctx.zoom_factor();
        let p = egui::pos2(x / zoom, y / zoom);
        match self.placements.lock().unwrap().get(name) {
            Some((layer, clip)) => clip.contains(p) && ctx.layer_id_at(p).is_none_or(|top| top == *layer),
            None => false,
        }
    }
}

const VERTEX: &str = r#"#version 300 es
out vec2 uv;
void main() {
    // Two triangles over the viewport, which egui has set to the widget's rectangle.
    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
    uv = vec2(p.x, 1.0 - p.y);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}"#;

const FRAGMENT: &str = r#"#version 300 es
precision mediump float;
uniform sampler2D element;
uniform float opacity;
uniform float wave;
uniform float time;
uniform vec3 tint;
in vec2 uv;
out vec4 color;
void main() {
    vec2 p = uv;
    p.x += wave * 0.02 * sin(p.y * 18.0 + time * 4.0);
    vec4 c = texture(element, p);
    if (p.x < 0.0 || p.x > 1.0) c = vec4(0.0);
    // The element image and egui's framebuffer are both premultiplied sRGB.
    color = vec4(c.rgb * tint, c.a) * opacity;
}"#;

// #region draw
/// Runs inside egui's paint pass. Uploads the element if the browser repainted it, then
/// draws one textured quad over the widget's rectangle.
fn draw(gl: &glow::Context, state: &mut GlState, name: &str, look: Look, time: f32) {
    let [w, h] = image_size(name)[..] else { return }; // not painted by the browser yet
    let (w, h) = (w as i32, h as i32);
    unsafe {
        let program = *state.program.get_or_insert_with(|| compile(gl));
        let vao = *state.vao.get_or_insert_with(|| gl.create_vertex_array().unwrap());

        // One texture per element, reallocated when the element changes size.
        let fresh = match state.textures.get(name) {
            Some(&(_, tw, th)) if tw == w && th == h => false,
            old => {
                if let Some(&(texture, _, _)) = old {
                    gl.delete_texture(texture);
                }
                let texture = gl.create_texture().unwrap();
                gl.bind_texture(glow::TEXTURE_2D, Some(texture));
                gl.tex_storage_2d(glow::TEXTURE_2D, 1, glow::RGBA8, w, h);
                for (key, v) in [
                    (glow::TEXTURE_WRAP_S, glow::CLAMP_TO_EDGE),
                    (glow::TEXTURE_WRAP_T, glow::CLAMP_TO_EDGE),
                    (glow::TEXTURE_MIN_FILTER, glow::LINEAR),
                    (glow::TEXTURE_MAG_FILTER, glow::LINEAR),
                ] {
                    gl.tex_parameter_i32(glow::TEXTURE_2D, key, v as i32);
                }
                state.textures.insert(name.to_owned(), (texture, w, h));
                true
            }
        };
        let texture = state.textures[name].0;
        gl.active_texture(glow::TEXTURE0);
        gl.bind_texture(glow::TEXTURE_2D, Some(texture));
        if fresh || is_dirty(name) {
            // bridge.js: gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, element)
            upload(name);
        }

        gl.use_program(Some(program));
        gl.bind_vertex_array(Some(vao));
        gl.uniform_1_i32(gl.get_uniform_location(program, "element").as_ref(), 0);
        gl.uniform_1_f32(gl.get_uniform_location(program, "opacity").as_ref(), look.opacity);
        gl.uniform_1_f32(gl.get_uniform_location(program, "wave").as_ref(), look.wave);
        gl.uniform_1_f32(gl.get_uniform_location(program, "time").as_ref(), time);
        gl.uniform_3_f32_slice(gl.get_uniform_location(program, "tint").as_ref(), &look.tint);
        // egui has already set the viewport, the scissor (its clip rectangle) and
        // premultiplied-alpha blending. It restores its own state after the callback.
        gl.draw_arrays(glow::TRIANGLE_STRIP, 0, 4);
    }
}
// #endregion draw

unsafe fn compile(gl: &glow::Context) -> glow::Program {
    let program = gl.create_program().unwrap();
    for (kind, source) in [(glow::VERTEX_SHADER, VERTEX), (glow::FRAGMENT_SHADER, FRAGMENT)] {
        let shader = gl.create_shader(kind).unwrap();
        gl.shader_source(shader, source);
        gl.compile_shader(shader);
        if !gl.get_shader_compile_status(shader) {
            web_sys::console::error_1(&gl.get_shader_info_log(shader).into());
        }
        gl.attach_shader(program, shader);
    }
    gl.link_program(program);
    program
}

// ----------------------------------------------------------------------------
// The demo app: a sign-up form that mixes egui widgets and DOM widgets.

struct App {
    dom: DomWidgets,
    nickname: String,
    volume: f32,
    newsletter: bool,
    look: Look,
    show_window: bool,
    submitted: Option<String>,
    egui_clicks: u32,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>, canvas: &web_sys::HtmlCanvasElement) -> Self {
        let dom = DomWidgets::default();
        cc.egui_ctx.set_theme(egui::Theme::Dark);

        let ctx = cc.egui_ctx.clone();
        let on_change = Closure::<dyn Fn()>::new(move || ctx.request_repaint());
        let (ctx, widgets) = (cc.egui_ctx.clone(), dom.clone());
        let is_visible_at =
            Closure::<dyn Fn(String, f32, f32) -> bool>::new(move |name: String, x, y| widgets.visible_at(&ctx, &name, x, y));
        init(canvas, on_change.as_ref(), is_visible_at.as_ref());
        on_change.forget();
        is_visible_at.forget();

        Self {
            dom,
            nickname: "ferris".to_owned(),
            volume: 40.0,
            newsletter: true,
            look: Look::default(),
            show_window: true,
            submitted: None,
            egui_clicks: 0,
        }
    }

    // #region app
    fn form(&mut self, ui: &mut egui::Ui) {
        let width = ui.available_width().min(360.0);
        let look = self.look;

        ui.heading("Sign up");
        ui.label("Rows marked egui are drawn by egui. Rows marked DOM are real elements.");
        ui.add_space(6.0);

        ui.label("Nickname (egui TextEdit)");
        ui.add(egui::TextEdit::singleline(&mut self.nickname).desired_width(width));

        ui.label("Email (DOM <input type=email>)");
        self.dom.show(ui, "email", width, look);

        ui.label("Country (DOM <select>)");
        self.dom.show(ui, "country", width, look);

        ui.label("Date of birth (DOM <input type=date>)");
        self.dom.show(ui, "birthday", width, look);

        ui.label("Volume (egui Slider)");
        ui.add(egui::Slider::new(&mut self.volume, 0.0..=100.0));

        ui.label("About you (DOM <textarea>, spellcheck on)");
        self.dom.show(ui, "about", width, look);

        ui.checkbox(&mut self.newsletter, "Send me the newsletter (egui Checkbox)");

        ui.label("Terms (DOM paragraph with a link, selectable text)");
        self.dom.show(ui, "terms", width, look);

        ui.add_space(6.0);
        if ui.button("Submit (egui Button)").clicked() {
            // Values come straight from the elements.
            self.submitted = Some(format!(
                "nickname={} email={} country={} birthday={} volume={:.0} about={:?}",
                self.nickname,
                value("email"),
                value("country"),
                value("birthday"),
                self.volume,
                value("about"),
            ));
        }
        if let Some(text) = &self.submitted {
            ui.label(egui::RichText::new(text).monospace().small());
        }
    }
    // #endregion app

    fn controls(&mut self, ui: &mut egui::Ui) {
        ui.label("This is an egui window. Drag it over the form: the DOM fields under it stop taking clicks.");
        ui.add(egui::Slider::new(&mut self.look.opacity, 0.2..=1.0).text("DOM opacity"));
        ui.add(egui::Slider::new(&mut self.look.wave, 0.0..=1.0).text("DOM wave"));
        ui.horizontal(|ui| {
            ui.label("DOM tint");
            ui.color_edit_button_rgb(&mut self.look.tint);
        });
        if ui.button(format!("egui button, clicked {} times", self.egui_clicks)).clicked() {
            self.egui_clicks += 1;
        }
        ui.label("A DOM field inside this window:");
        self.dom.show(ui, "search", ui.available_width().min(240.0), Look::default());
        ui.label(format!("Its value, read by Rust: {:?}", value("search")));
        if ui.button("Set it from Rust").clicked() {
            set_value("search", "written by egui");
        }
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        // A real element has keyboard focus: egui must not think one of its widgets has it too.
        if dom_has_focus() {
            if let Some(id) = ui.ctx().memory(|m| m.focused()) {
                ui.ctx().memory_mut(|m| m.surrender_focus(id));
            }
        }

        egui::CentralPanel::default().show_inside(ui, |ui| {
            egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                self.form(ui);
            });
        });

        let mut open = self.show_window;
        let ctx = ui.ctx().clone();
        let screen = ctx.content_rect();
        let wide = screen.width() > 600.0;
        // ?window=over (used by the page's live checks) starts the window on top of the form.
        let over = option("window") == "over";
        let pos = if over {
            egui::pos2(8.0, 96.0)
        } else if wide {
            egui::pos2(screen.width() - 290.0, screen.height() * 0.42)
        } else {
            // On a phone the window starts rolled up at the bottom so it does not cover the form.
            egui::pos2(8.0, screen.height() - 40.0)
        };
        egui::Window::new("egui window")
            .open(&mut open)
            .default_pos(pos)
            .default_width(270.0)
            .default_open(wide || over)
            .show(&ctx, |ui| self.controls(ui));
        self.show_window = open;
    }
}

// #region start
#[wasm_bindgen]
pub async fn start(canvas: web_sys::HtmlCanvasElement) -> Result<(), JsValue> {
    let runner = eframe::WebRunner::new();
    let for_app = canvas.clone();
    runner
        .start(
            canvas,
            eframe::WebOptions::default(),
            Box::new(move |cc| Ok(Box::new(App::new(cc, &for_app)))),
        )
        .await
}
// #endregion start
