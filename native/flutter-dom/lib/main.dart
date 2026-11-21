// main.dart: a Flutter web app that shows a DOM form as one of its own widgets.
//
// The form is a real <form> on the page. The page (bridge.js) draws it into a 2D canvas with
// drawElementImage() on every paint event. This app turns that canvas into a ui.Image with
// dart:ui_web's createImageFromTextureSource() and shows it in a RawImage, under Flutter's own
// Transform, Opacity and ImageFiltered widgets. It then tells the page where it drew the
// widget, so the page can put the real form there for input.
import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'dart:ui_web' as ui_web;

import 'package:material_ui/material_ui.dart';

// #region interop
/// The page's side, window.flutterDom, made by /flutter-dom/bridge.js before the app starts.
@JS('flutterDom')
external Bridge get bridge;

extension type Bridge._(JSObject _) implements JSObject {
  /// Flutter gives the form a width in logical pixels. The browser answers with its height.
  external double layout(double width);

  /// The texture source for this update, or null when the browser has not painted the form yet.
  external Frame? take();

  /// Where Flutter drew the widget: a 4×4 matrix in view coordinates, column-major, 16 numbers.
  external void place(JSArray<JSNumber> matrix);

  /// One image was made. `ms` is the time createImageFromTextureSource() took.
  external void report(double ms, int width, int height);
  external void fail(String message);

  /// Flutter's own timing of one frame: build and raster, in milliseconds.
  external void frame(double buildMs, double rasterMs);

  /// Set by this app. The page calls wake() after each paint event.
  external set wake(JSFunction f);

  /// Set by this app. The live checks use them: try any object as a texture source, move a control.
  external set tryRoute(JSFunction f);
  external set control(JSFunction f);
}

extension type Frame._(JSObject _) implements JSObject {
  external JSAny get source; // an HTMLCanvasElement or an ImageBitmap
  external int get width; // in pixels of the source
  external int get height;
  external bool get transfer; // passed as transferOwnership
}

@JS('performance.now')
external double now();
// #endregion interop

/// The values of the Flutter sliders.
class Controls extends ChangeNotifier {
  double rotate = -4; // degrees
  double tilt = 0; // degrees
  double opacity = 1;
  double blur = 0; // logical pixels

  void set(String name, double value) {
    switch (name) {
      case 'rotate':
        rotate = value;
      case 'tilt':
        tilt = value;
      case 'opacity':
        opacity = value;
      case 'blur':
        blur = value;
    }
    notifyListeners();
  }
}

final controls = Controls();
final status = ValueNotifier<String>('Waiting for the first paint event.');

void main() {
  bridge.tryRoute = ((JSAny source, int width, int height, bool transfer) =>
      tryRoute(source, width, height, transfer).toJS).toJS;
  bridge.control = ((String name, double value) => controls.set(name, value)).toJS;
  WidgetsFlutterBinding.ensureInitialized().addTimingsCallback((timings) {
    for (final t in timings) {
      bridge.frame(t.buildDuration.inMicroseconds / 1000, t.rasterDuration.inMicroseconds / 1000);
    }
  });
  runApp(const DomApp());
}

// #region try-route
/// Give any object to createImageFromTextureSource() and report what came back, as JSON.
/// CanvasKit uploads lazily, so making the image proves little. The image is read back with
/// toByteData(), which makes the engine use the source.
Future<JSString> tryRoute(JSAny source, int width, int height, bool transfer) async {
  final t0 = now();
  final result = <String, Object?>{'ok': false, 'stage': 'createImageFromTextureSource'};
  try {
    final ui.Image image = await ui_web.createImageFromTextureSource(
      source,
      width: width,
      height: height,
      transferOwnership: transfer,
    );
    result['ms'] = now() - t0;
    result['width'] = image.width;
    result['height'] = image.height;
    result['stage'] = 'toByteData';
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (data == null) throw StateError('toByteData() returned null');
    var inked = 0;
    for (var i = 3; i < data.lengthInBytes; i += 4 * 16) {
      if (data.getUint8(i) > 0) inked++;
    }
    final at = 4 * ((image.height ~/ 2) * image.width + image.width ~/ 2);
    result['centre'] = [for (var k = 0; k < 4; k++) data.getUint8(at + k)];
    result['inked'] = inked;
    result['ok'] = true;
    image.dispose();
  } catch (error) {
    result['error'] = '$error';
  }
  return jsonEncode(result).toJS;
}
// #endregion try-route

class DomApp extends StatelessWidget {
  const DomApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xFF4FA3FF),
        fontFamily: 'Roboto',
      ),
      home: const Scaffold(backgroundColor: Color(0xFF15171C), body: Panel()),
    );
  }
}

class Panel extends StatelessWidget {
  const Panel({super.key});

  Widget slider(String label, String name, double value, double min, double max) {
    return Row(
      children: [
        SizedBox(width: 62, child: Text(label)),
        Expanded(
          child: Slider(value: value, min: min, max: max, onChanged: (v) => controls.set(name, v)),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    return ListenableBuilder(
      listenable: controls,
      builder: (context, _) {
        // #region scene
        // The DOM form is an ordinary widget in this tree. Flutter rotates it, tilts it in
        // perspective, fades it and blurs it, and draws a badge of its own on top.
        final scene = Stack(
          clipBehavior: Clip.none,
          children: [
            Transform(
              alignment: Alignment.center,
              transform: Matrix4.identity()
                ..setEntry(3, 2, 0.0016)
                ..rotateX(controls.tilt * math.pi / 180)
                ..rotateZ(controls.rotate * math.pi / 180),
              child: Opacity(
                opacity: controls.opacity,
                child: ImageFiltered(
                  enabled: controls.blur > 0.05,
                  imageFilter: ui.ImageFilter.blur(sigmaX: controls.blur, sigmaY: controls.blur),
                  child: const DomTexture(),
                ),
              ),
            ),
            const Positioned(right: 6, top: -12, child: IgnorePointer(child: Badge())),
          ],
        );
        // #endregion scene
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Flutter widgets', style: small),
              const SizedBox(height: 8),
              const TextField(
                decoration: InputDecoration(
                  labelText: 'A Flutter TextField',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 4),
              slider('Rotate', 'rotate', controls.rotate, -40, 40),
              slider('Tilt', 'tilt', controls.tilt, 0, 50),
              slider('Opacity', 'opacity', controls.opacity, 0.15, 1),
              slider('Blur', 'blur', controls.blur, 0, 6),
              const SizedBox(height: 4),
              Text('A DOM form, drawn by Flutter from a ui.Image', style: small),
              const SizedBox(height: 30),
              scene,
              const SizedBox(height: 22),
              ValueListenableBuilder(
                valueListenable: status,
                builder: (context, text, _) => Text(text, style: small),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Drawn by Flutter over a corner of the DOM form.
class Badge extends StatelessWidget {
  const Badge({super.key});

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: 0.12,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFFFC857),
          borderRadius: BorderRadius.circular(6),
          boxShadow: const [BoxShadow(color: Color(0x99000000), blurRadius: 8, offset: Offset(0, 3))],
        ),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 9, vertical: 4),
          child: Text(
            'Flutter draws this on top',
            style: TextStyle(color: Color(0xFF1B1300), fontSize: 12, fontWeight: FontWeight.w500),
          ),
        ),
      ),
    );
  }
}

class DomTexture extends StatefulWidget {
  const DomTexture({super.key});

  @override
  State<DomTexture> createState() => _DomTextureState();
}

class _DomTextureState extends State<DomTexture> {
  ui.Image? _image;
  bool _busy = false;
  bool _again = false;
  List<double> _placed = const [];

  @override
  void initState() {
    super.initState();
    bridge.wake = (() {
      _refresh();
    }).toJS;
    WidgetsBinding.instance.addPersistentFrameCallback(_afterFrame);
    _refresh();
  }

  // #region image
  /// The page painted the form into its canvas. Make a ui.Image from it and show it.
  Future<void> _refresh() async {
    if (_busy) {
      _again = true; // one more pass when the image in flight is done
      return;
    }
    _busy = true;
    do {
      _again = false;
      final frame = bridge.take();
      if (frame == null) break;
      final t0 = now();
      try {
        final ui.Image image = await ui_web.createImageFromTextureSource(
          frame.source,
          width: frame.width,
          height: frame.height,
          transferOwnership: frame.transfer,
        );
        final ms = now() - t0;
        if (!mounted) {
          image.dispose();
          break;
        }
        final old = _image;
        setState(() => _image = image);
        old?.dispose();
        bridge.report(ms, image.width, image.height);
        status.value = 'ui.Image ${image.width}×${image.height}, made in ${ms.toStringAsFixed(1)} ms';
      } catch (error) {
        bridge.fail('$error');
        status.value = 'createImageFromTextureSource() failed: $error';
      }
    } while (_again);
    _busy = false;
  }
  // #endregion image

  // #region place
  /// After every Flutter frame: tell the page where this widget was drawn. The matrix takes a
  /// point in the widget to a point in the Flutter view, in logical pixels, which are CSS pixels.
  void _afterFrame(Duration _) {
    if (!mounted) return;
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return;
    final matrix = box.getTransformTo(null).storage;
    var same = matrix.length == _placed.length;
    for (var i = 0; same && i < matrix.length; i++) {
      same = matrix[i] == _placed[i];
    }
    if (same) return;
    _placed = List<double>.of(matrix);
    bridge.place([for (final v in matrix) v.toJS].toJS);
  }
  // #endregion place

  // #region widget
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = math.min(constraints.maxWidth, 420.0).floorToDouble();
        final height = bridge.layout(width); // the browser lays the form out at this width
        return Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: width,
            height: height,
            child: RawImage(image: _image, fit: BoxFit.fill, filterQuality: FilterQuality.medium),
          ),
        );
      },
    );
  }
  // #endregion widget

  @override
  void dispose() {
    _image?.dispose();
    super.dispose();
  }
}
