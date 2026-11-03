# Piper voice catalogue

The light voice (`src-tauri/src/piper.rs`, docs/plan-voz-ligera.md) offers every
Piper voice sherpa-onnx publishes in Lingora's languages. These scripts build its
catalogue. Run them in this order, with Python 3 and `pip install sherpa-onnx numpy`
(the app's sherpa-onnx version), `espeak-ng` on the PATH and the app's listening
models downloaded (they check that each voice is understood):

1. `python3 fetch_meta.py`: lists the voices with their config and licence →
   `piper-meta.json`.
2. `python3 survey.py`: downloads each voice (~10 GB in total, one at a time, deleted
   after), says a sentence with each speaker, measures the pitch (gender) and checks
   it is understood → `results.json` and WAVs in `samples/`. Resumable. ~1 hour.
3. `python3 catalog.py`: writes `src-tauri/src/piper_voices.json` (what the app
   reads) and `public/licenses/Piper-voices.txt` (Credits).

Then check `DICTS` in `scripts/build-espeak.sh` covers the catalogue's espeak voices
and rebuild espeak-ng if it changed.

Choices made in `catalog.py`: medium quality when a voice has several (it keeps up on
a modest computer), up to 3 speakers per gender in multi-speaker models, defaults for
Spanish and English (`DEFAULTS`), and GLaDOS/turret left out (game character voices).
Voices for non-commercial use are included (Lingora is a demo); `commercial` marks
the ones whose licence allows selling it, and voices fine-tuned from "lessac" are not.
