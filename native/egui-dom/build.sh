#!/bin/sh
# Build egui-dom and put the result where the site serves it (public/native-ui/egui/).
# Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.130
# Optional: wasm-opt (cargo install wasm-opt) to shrink the .wasm file.
set -e
cd "$(dirname "$0")"
out=../../public/native-ui/egui
cargo build --release --target wasm32-unknown-unknown
rm -rf "$out"
wasm-bindgen --target web --no-typescript --out-dir "$out" target/wasm32-unknown-unknown/release/egui_dom.wasm
if command -v wasm-opt >/dev/null; then wasm-opt -Os "$out/egui_dom_bg.wasm" -o "$out/egui_dom_bg.wasm"; fi
# The page's "Show the code" listings read the sources from here.
mkdir -p "$out/src"
cp src/lib.rs src/bridge.js "$out/src/"
ls -la "$out"
