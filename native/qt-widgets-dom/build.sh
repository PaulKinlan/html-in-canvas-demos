#!/bin/sh
# Build the Qt Widgets app with Qt for WebAssembly and put the result in public/qt-widgets-dom/app/.
# Needs Qt 6.10.3 for wasm_singlethread plus the matching desktop Qt (for moc), and Emscripten 4.0.7.
# Set QT to the folder that holds 6.10.3/ and EMSDK to an activated emsdk. See native/qt-dom/build.sh.
set -e
cd "$(dirname "$0")"
: "${QT:?set QT to the folder that holds 6.10.3/}" "${EMSDK:?set EMSDK}"
out=../../public/qt-widgets-dom/app
build=${BUILD_DIR:-/tmp/qt-widgets-dom-build}
"$QT/6.10.3/wasm_singlethread/bin/qt-cmake" -G Ninja -S . -B "$build" -DQT_HOST_PATH="$QT/6.10.3/gcc_64" -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build "$build"
mkdir -p "$out/src"
cp "$build/qtwdom.js" "$build/qtwdom.wasm" "$build/qtloader.js" "$out/"
# The page's "Show the code" listings read the sources from here.
cp domwidget.cpp domwidget.h main.cpp CMakeLists.txt "$out/src/"
ls -la "$out"
