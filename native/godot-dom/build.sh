#!/bin/sh
# Export godot-dom for the web and put the result in public/godot-dom/app/.
# Needs the Godot 4.7.2 editor binary and its web export templates
# (web_nothreads_release.zip in ~/.local/share/godot/export_templates/4.7.2.stable/).
# Set GODOT to the editor binary. Both come from the 4.7.2-stable release assets:
#   Godot_v4.7.2-stable_linux.x86_64.zip and Godot_v4.7.2-stable_export_templates.tpz
#
# The exported index.wasm is 39.5 MB. Cloudflare Workers static assets take at most 25 MiB
# per file, so the file is committed gzip-compressed (about 10 MB) and bridge.js inflates it
# with DecompressionStream before the engine starts.
set -e
cd "$(dirname "$0")"
: "${GODOT:=/opt/godot/godot}"
out=../../public/godot-dom/app
tmp=${BUILD_DIR:-/tmp/godot-dom-build}
rm -rf "$tmp"
mkdir -p "$tmp" "$out/src"
"$GODOT" --headless --path . --import
"$GODOT" --headless --path . --export-release Web "$tmp/index.html"
ls -la "$tmp"
# Only the engine, its two audio worklets and the pack are used. The page is its own shell.
cp "$tmp/index.js" "$tmp/index.pck" "$tmp/index.audio.worklet.js" "$tmp/index.audio.position.worklet.js" "$out/"
gzip -9 -n -c "$tmp/index.wasm" > "$out/index.wasm.gz"
# The page's "Show the code" listings read the sources from here.
cp main.gd project.godot export_presets.cfg "$out/src/"
ls -la "$out"
