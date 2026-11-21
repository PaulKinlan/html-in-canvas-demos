#!/bin/sh
# Build main.cpp to public/toolkit-aria/app/. Needs Emscripten (em++ on PATH) and the Dear ImGui
# sources in $IMGUI (imgui.cpp, imgui_draw.cpp, imgui_tables.cpp, imgui_widgets.cpp and
# backends/imgui_impl_opengl3.cpp, version 1.92.5).
set -e
cd "$(dirname "$0")"
: "${IMGUI:?set IMGUI to the Dear ImGui source folder}"
OUT=../../public/toolkit-aria/app
mkdir -p "$OUT"
em++ -O2 -std=c++17 -fno-exceptions -fno-rtti \
  -DIMGUI_DISABLE_DEMO_WINDOWS -DIMGUI_DISABLE_DEBUG_TOOLS -DIMGUI_DISABLE_OBSOLETE_FUNCTIONS \
  -I"$IMGUI" -I"$IMGUI/backends" \
  main.cpp "$IMGUI/imgui.cpp" "$IMGUI/imgui_draw.cpp" "$IMGUI/imgui_tables.cpp" "$IMGUI/imgui_widgets.cpp" \
  "$IMGUI/backends/imgui_impl_opengl3.cpp" \
  -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web \
  -sMODULARIZE -sEXPORT_NAME=createToolkitAria -sEXPORTED_RUNTIME_METHODS=stringToUTF8OnStack,stackSave,stackRestore \
  -o "$OUT/toolkit_aria.js"
cp main.cpp "$OUT/main.cpp"   # for the page's code listing
cp "$IMGUI/LICENSE.txt" "$OUT/IMGUI-LICENSE.txt"
ls -la "$OUT"
