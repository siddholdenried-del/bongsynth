#!/bin/bash
# Builds web/bongsynth.wasm from the files in this folder (Emscripten 7.0.0, or set EMCC).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p gen
python3 tools/gen_engine_tables.py gen/fe_tables.h
SOURCES=(bridge.c dsp/synth.c)
names=$(sed -nE 's/^(int|void|float|float \*|const char \*) *(gs_[a-z0-9_]+)\(.*/_\2/p' bridge.c | paste -sd, -)
emcc="${EMCC:-emcc}"
"$emcc" -O2 -std=c11 -ffp-contract=off -DPLAT_HOST -Idsp -Igen "${SOURCES[@]}" --no-entry -sSTANDALONE_WASM \
  -sEXPORTED_FUNCTIONS="$names" -o web/bongsynth.wasm
echo "web/bongsynth.wasm: $(wc -c < web/bongsynth.wasm) bytes"
