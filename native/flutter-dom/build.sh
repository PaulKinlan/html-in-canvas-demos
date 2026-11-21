#!/bin/sh
# Build flutter-dom and put the result where the site serves it (public/flutter-dom/app/).
# Needs the Flutter SDK on PATH (built with 3.50.1 stable, Dart 3.14.0).
#
# The output is cut down to what /flutter-dom/ loads: main.dart.js, flutter_bootstrap.js, the
# Chromium variant of CanvasKit and the font. The page starts the app itself, so index.html,
# the service worker, the full CanvasKit, Skwasm and the licence listing are removed.
set -e
cd "$(dirname "$0")"
out=../../public/flutter-dom/app
flutter pub get
flutter build web --release --no-web-resources-cdn --no-source-maps --base-href /flutter-dom/app/ \
  --no-wasm-dry-run
rm -rf "$out"
mkdir -p "$out/canvaskit/chromium" "$out/src"
cp build/web/main.dart.js build/web/flutter_bootstrap.js "$out/"
cp -r build/web/assets "$out/assets"
rm -f "$out/assets/NOTICES"
cp build/web/canvaskit/chromium/canvaskit.js build/web/canvaskit/chromium/canvaskit.wasm "$out/canvaskit/chromium/"
cp fonts/Roboto_LICENSE.txt "$out/assets/fonts/"
# The page's "Show the code" listings read the sources from here.
cp lib/main.dart web/flutter_bootstrap.js "$out/src/"
find "$out" -type f -exec ls -la {} +
du -sh "$out"
