# Page flow and browser DSP benchmark

Run `node --test tests/*.test.mjs`. To compare Chrome against the prior release, serve prior `web/` on loopback port 48781 and this checkout's `web/` on 48782, then run `node tests/browser.mjs` using desktop Chrome on macOS.

The DSP estimate is opt-in (menu → **Run DSP Bench**). Stop playback and release held notes first. A separate worker instantiates the same dry engine and renders a snapshot of the current pattern and settings silently. It warms up one pattern and times two pattern loops; it takes the median ratio across three runs. Changing the patch or pattern does not update the last result automatically. Starting audio cancels an in-flight bench. This reports offline browser renderer cost relative to the rendered audio duration; it is neither AudioWorklet callback timing nor physical FM‑1 telemetry.

With the candidate served on loopback, run `node tests/dry-browser.mjs http://127.0.0.1:4190/` to check the dry browser surface, migrated volume, legacy sound import, waveshaper routing, and the 44.1 kHz AudioWorklet.
