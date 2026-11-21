extends Node3D
# godot-dom: a Godot 4 scene whose central quad shows a live DOM form.
# The form is a child of Godot's own <canvas> in the page. The browser paints it, the page's
# bridge.js copies it into the GL texture this script made, and this script tells the browser
# where the quad is on screen so that taps, focus and the caret land on the real fields.

const FORM_W := 1.6 # width of the quad in world units. Its height follows the form's shape.
const FOV := 50.0

var bridge: JavaScriptObject = null
var dom_event_cb: JavaScriptObject = null # kept in a member: the callback dies with its reference
var route := "gl"
var cam: Camera3D
var panel: Node3D
var quad: MeshInstance3D
var backing: MeshInstance3D
var label: Label3D
var ring: MeshInstance3D
var orbiters: Array[MeshInstance3D] = []
var orbiter_material: StandardMaterial3D
var material: ShaderMaterial
var texture: ImageTexture
var tex_size := Vector2i.ZERO
var shape := 1.25 # height / width of the form
var t := 0.0
var sway := 1.0
var kick := 0.0
var clicks := 0
var last_corners := PackedFloat32Array()

const FORM_SHADER := "
shader_type spatial;
render_mode unshaded;
// source_color: the texels are sRGB, as the browser painted them.
uniform sampler2D form : source_color, filter_linear_mipmap, repeat_disable;
void fragment() {
	ALBEDO = texture(form, UV).rgb;
}
"


func _ready() -> void:
	_build_scene()
	if not OS.has_feature("web"):
		return
	bridge = JavaScriptBridge.get_interface("godotDom")
	if bridge == null:
		return
	route = str(bridge.route())
	_probe_routes()
	dom_event_cb = JavaScriptBridge.create_callback(_on_dom_event)
	bridge.listen(dom_event_cb)


# #region probes
# Which ways lead from GDScript to Emscripten's GL object, which maps GL texture names
# (integers) to WebGLTexture objects. The page shows the answers in its live checks.
func _probe_routes() -> void:
	# eval() with use_global_execution_context false runs inside the engine's module closure.
	bridge.probe("eval_local", bool(JavaScriptBridge.eval("typeof GL === 'object' && typeof GL.textures === 'object'", false)))
	# The same expression in the global scope, where page scripts run.
	bridge.probe("eval_global", bool(JavaScriptBridge.eval("typeof GL === 'object'", true)))
	# get_interface() reads a property of the global object.
	bridge.probe("interface_GL", JavaScriptBridge.get_interface("GL") != null)
	bridge.probe("interface_Module", JavaScriptBridge.get_interface("Module") != null)
	bridge.probe("godot", Engine.get_version_info().string)
	bridge.probe("renderer", RenderingServer.get_current_rendering_method())
# #endregion probes


func _build_scene() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.07, 0.08, 0.1)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.6, 0.75)
	env.ambient_light_energy = 0.6
	var world := WorldEnvironment.new()
	world.environment = env
	add_child(world)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, 30, 0)
	add_child(sun)

	cam = Camera3D.new()
	cam.fov = FOV
	cam.position = Vector3(0, 0, 4)
	add_child(cam)

	# A large ring behind everything, so the scene has depth when the panel sways.
	ring = MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 1.45
	torus.outer_radius = 1.6
	torus.rings = 48
	ring.mesh = torus
	var ring_mat := StandardMaterial3D.new()
	ring_mat.albedo_color = Color(0.2, 0.32, 0.55)
	ring_mat.metallic = 0.3
	ring_mat.roughness = 0.5
	ring.material_override = ring_mat
	ring.position = Vector3(0, 0, -1.8)
	add_child(ring)

	panel = Node3D.new()
	add_child(panel)

	# #region quad
	# The quad that shows the form. Its texture is made in _make_texture() once the
	# browser has said how many texels the form has.
	material = ShaderMaterial.new()
	var shader := Shader.new()
	shader.code = FORM_SHADER
	material.shader = shader
	quad = MeshInstance3D.new()
	quad.mesh = QuadMesh.new()
	quad.material_override = material
	panel.add_child(quad)
	# #endregion quad

	backing = MeshInstance3D.new()
	backing.mesh = BoxMesh.new()
	var back_mat := StandardMaterial3D.new()
	back_mat.albedo_color = Color(0.16, 0.18, 0.24)
	backing.material_override = back_mat
	panel.add_child(backing)

	# Text drawn by Godot, to compare with the text the browser drew on the quad.
	label = Label3D.new()
	label.text = "Godot Label3D: not signed in"
	label.font_size = 40
	label.pixel_size = 0.0022
	label.outline_size = 8
	label.modulate = Color(1.0, 0.86, 0.45)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.width = FORM_W / label.pixel_size
	label.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	panel.add_child(label)

	# Three small objects that orbit the panel. They pass in front of the form and behind it,
	# which shows that the form is depth tested with the rest of the scene.
	orbiter_material = StandardMaterial3D.new()
	orbiter_material.albedo_color = Color(0.95, 0.45, 0.25)
	orbiter_material.roughness = 0.35
	var meshes: Array[Mesh] = [BoxMesh.new(), SphereMesh.new(), PrismMesh.new()]
	for m in meshes:
		var o := MeshInstance3D.new()
		o.mesh = m
		o.scale = Vector3.ONE * 0.13
		o.material_override = orbiter_material
		add_child(o)
		orbiters.append(o)
	_fit_shape()


func _fit_shape() -> void:
	var h := FORM_W * shape
	(quad.mesh as QuadMesh).size = Vector2(FORM_W, h)
	(backing.mesh as BoxMesh).size = Vector3(FORM_W + 0.08, h + 0.08, 0.06)
	backing.position = Vector3(0, 0, -0.035)
	label.position = Vector3(0, h / 2 + 0.07, 0)


# #region texture
# A Godot texture of the form's size, and the WebGLTexture behind it.
func _make_texture(w: int, h: int) -> void:
	tex_size = Vector2i(w, h)
	shape = float(h) / float(w)
	_fit_shape()
	# The pixels route sends whole images, so it has no use for a mip chain that Godot would
	# have to build on the CPU. The two GL routes let the browser's GL build the mips.
	var mips := route != "pixels"
	var img := Image.create_empty(w, h, mips, Image.FORMAT_RGBA8)
	img.fill(Color(0.1, 0.11, 0.14))
	if route == "hook":
		bridge.hookBegin() # the page starts recording gl.createTexture() calls
	texture = ImageTexture.create_from_image(img)
	material.set_shader_parameter("form", texture)
	match route:
		"gl":
			# The OpenGL texture name Godot's renderer gave this texture.
			var id := RenderingServer.texture_get_native_handle(texture.get_rid())
			# Emscripten keeps the WebGLTexture for that name in GL.textures. GL is a local
			# variable of the engine's module, which this eval() can see and page scripts cannot.
			JavaScriptBridge.eval("godotDom.adopt(GL.textures[%d], %d, %d, %d)" % [id, w, h, id], false)
		"hook":
			bridge.hookEnd(w, h) # the page keeps the texture that was created in between
		"pixels":
			bridge.ownTexture(w, h) # the page makes its own texture and reads it back
# #endregion texture


# #region frame
func _process(delta: float) -> void:
	t += delta
	_animate(delta)
	if bridge == null:
		return
	var asked := str(bridge.route()) # the page can switch route while the scene runs
	if asked != route:
		route = asked
		tex_size = Vector2i.ZERO
	var w := int(bridge.imageWidth()) # 0 until the browser has painted the form once
	var h := int(bridge.imageHeight())
	if w > 0 and h > 0:
		if Vector2i(w, h) != tex_size:
			_make_texture(w, h)
		if bridge.dirty(): # the browser repainted the form since the last upload
			if route == "pixels":
				_upload_pixels(w, h)
			else:
				bridge.upload() # texElementSubImage2D() into Godot's texture
	_place()
# #endregion frame


# #region pixels
# The route that needs nothing from Emscripten: the page uploads the form into a texture
# of its own, reads it back, and Godot takes the bytes as an Image.
func _upload_pixels(w: int, h: int) -> void:
	var buffer = bridge.readPixels()
	if buffer == null:
		return
	var bytes := JavaScriptBridge.js_buffer_to_packed_byte_array(buffer)
	if bytes.size() != w * h * 4:
		return
	texture.update(Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, bytes))
# #endregion pixels


# #region place
# Project the quad's corners to the screen and hand them to the page, which turns them into
# one perspective matrix for canvas.updateElementGeometry().
func _place() -> void:
	var view := get_viewport().get_visible_rect().size
	var hw := FORM_W / 2
	var hh := FORM_W * shape / 2
	var c := PackedFloat32Array()
	# Top left, top right, bottom right, bottom left: the order of the form's own corners.
	for p in [Vector3(-hw, hh, 0), Vector3(hw, hh, 0), Vector3(hw, -hh, 0), Vector3(-hw, -hh, 0)]:
		var s := cam.unproject_position(quad.global_transform * p)
		c.append(s.x / view.x) # fractions of the canvas, so the page can use CSS pixels
		c.append(s.y / view.y)
	var moved := last_corners.size() != 8
	if not moved:
		for i in 8:
			if absf(c[i] - last_corners[i]) > 0.0002:
				moved = true
				break
	if moved:
		last_corners = c
		bridge.place(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7])
# #endregion place


func _animate(delta: float) -> void:
	# Fit the panel to the viewport: by width on a phone, by height on a wide screen.
	var view := get_viewport().get_visible_rect().size
	var tan_half := tan(deg_to_rad(FOV) / 2)
	var by_width := FORM_W / (0.84 * 2 * tan_half * view.x / maxf(view.y, 1.0))
	var by_height := (FORM_W * shape + 0.5) / (0.92 * 2 * tan_half)
	cam.position = Vector3(0, 0.12, maxf(by_width, by_height))

	# The panel sways less while a field has focus, so it is easier to hit.
	var busy := bridge != null and bool(bridge.busy())
	sway = lerpf(sway, 0.3 if busy else 1.0, minf(1.0, delta * 3))
	panel.rotation = Vector3(sin(t * 0.43) * 0.1 * sway, sin(t * 0.31) * 0.42 * sway, 0)

	kick = maxf(0.0, kick - delta)
	ring.rotation = Vector3(PI / 2 + sin(t * 0.23) * 0.25, 0, cos(t * 0.19) * 0.25)
	for i in orbiters.size():
		var a := t * (0.5 + kick * 3.0) + i * TAU / orbiters.size()
		var r := FORM_W * 0.62
		orbiters[i].position = Vector3(cos(a) * r, sin(a * 0.7 + i) * FORM_W * shape * 0.45, sin(a) * r)
		orbiters[i].rotation = Vector3(a, a * 1.3, 0)


# #region events
# Called by the page when the form is submitted or a chat line is sent.
func _on_dom_event(args: Array) -> void:
	var kind := str(args[0])
	var text := str(args[1])
	if kind == "signin":
		label.text = "Godot Label3D: signed in as %s" % text
		orbiter_material.albedo_color = Color(0.35, 0.85, 0.5)
	elif kind == "chat":
		label.text = "Godot Label3D: %s" % text
	kick = 1.0
	bridge.probe("label", label.text)


# Godot's own input. A press on the form never arrives here, because the page stops the
# event at the form. A press anywhere else on the canvas does.
func _unhandled_input(event: InputEvent) -> void:
	# A touch also arrives as an emulated mouse button, so counting mouse buttons covers both.
	var pressed: bool = event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT
	if pressed:
		clicks += 1
		orbiter_material.albedo_color = Color.from_hsv(fmod(clicks * 0.17, 1.0), 0.7, 0.95)
		kick = 1.0
		if bridge != null:
			bridge.probe("godot_presses", clicks)
# #endregion events
