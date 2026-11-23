# BongSynth

BongSynth is GhettoMachine's instrument-track synth as a browser instrument, by BongSoft, provided by BongTech, part of
BongCult. The DSP in `dsp/` is copied unchanged from GhettoMachine `app/dsp` (the commit is in `dsp/UPSTREAM-COMMIT.txt`)
and compiled to WebAssembly with a small bridge (`bridge.c`) that plays one instrument track.

Signal path, in blocks of 32 samples at 44.1 kHz, as on the FM-1:
keys or sequencer → oscillators → voice shaper, drive and filter (voice shaper PRE/POST) → amplitude → dry stereo
level/pan → master volume. The browser engine has no Color insert, reverb, or delay returns.

## Play

    python3 -m http.server 4190 --bind 127.0.0.1 --directory web

then open http://127.0.0.1:4190. Serve it over HTTPS away from localhost; `file://` will not work.

- **SOUND:** 129 factory sounds in six banks, MONO / POLY, and the firmware's pages of four knobs: OSC, TONE, FILTER,
  AMP ENV, FILTER ENV, MORE, VOICE, OSC 2, SHAPER, MOD ENV, LFO 2, MACRO.
- **MATRIX:** the six mod-matrix slots (source, destination, amount).
- **SEQUENCE:** 16 steps with note, accent and slide (slides hold into the next note and glide, as a 303), five
  phrases, a generator and transpose.
- **MIX:** track LFO 1, dry pan and master volume.
- **Keys:** the on-screen keyboard, or `A`–`K` / `W E T Y U` on a computer keyboard, `Z` / `X` for octaves, Shift for
  louder, Space to play / stop, Esc to silence.
- State saves in the browser only. Sounds can be shared as `.txt` from the ☰ menu. Older files keep their voice parameters but ignore their obsolete `COLOR` setting.

## Build

Needs Emscripten 4.0.11 (or `EMCC`) and Python 3: `./build.sh` writes `gen/fe_tables.h` (Felucca-Engines' tables) and
`web/bongsynth.wasm`. `dsp/x0x_drum_tables.h` is BongDrums' checked-in table header (`tools/gen_drum_tables.py`).

## Licence

GPL-3.0-only (see `LICENSE`). The voice is Felucca-Engines' ANALOG by Leo Kuroshita, Hügelton Instruments (MIT,
`dsp/felucca/LICENSE-MIT`); the vendored upstream tree also retains the unlinked X0X effects sources by Charles Vestal (GPL-3.0), after 9W9. Toolchain licences
for the WASM runtime are in `web/licenses/`.
