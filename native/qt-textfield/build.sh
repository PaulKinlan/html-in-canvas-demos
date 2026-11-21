#!/bin/sh
# Build qt-textfield with Qt for WebAssembly and put the result in public/qt-textfield/app/.
# Needs Qt 6.10.3 for wasm_singlethread plus the matching desktop Qt (for moc and the QML tools),
# and Emscripten 4.0.7, the version Qt 6.10 is built with. See native/qt-dom/build.sh for the
# aqtinstall lines. Set QT to the folder that holds 6.10.3/ and EMSDK to an activated emsdk.
set -e
cd "$(dirname "$0")"
: "${QT:?set QT to the folder that holds 6.10.3/}" "${EMSDK:?set EMSDK}"
out=../../public/qt-textfield/app
build=${BUILD_DIR:-/tmp/qt-textfield-build}
"$QT/6.10.3/wasm_singlethread/bin/qt-cmake" -G Ninja -S . -B "$build" -DQT_HOST_PATH="$QT/6.10.3/gcc_64" -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build "$build"
mkdir -p "$out/src"
cp "$build/qttf.js" "$build/qttf.wasm" "$build/qtloader.js" "$out/"
# The page's "Show the code" listings read the sources from here.
cp domitem.cpp domitem.h Main.qml DomTextField.qml main.cpp CMakeLists.txt "$out/src/"
ls -la "$out"
