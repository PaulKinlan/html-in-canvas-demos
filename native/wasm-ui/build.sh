#!/bin/sh
# Build ui.c to public/wasm-ui/ui.wasm. Needs clang with the wasm32 target and wasm-ld. No SDK.
set -e
cd "$(dirname "$0")"
clang --target=wasm32 -O2 -nostdlib -fno-builtin -Wall \
  -Wl,--no-entry -Wl,--strip-all -Wl,--allow-undefined \
  -o ../../public/wasm-ui/ui.wasm ui.c
cp ui.c ../../public/wasm-ui/ui.c   # for the page's code listing
ls -la ../../public/wasm-ui/ui.wasm
