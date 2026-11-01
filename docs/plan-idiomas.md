# Plan: more languages and downloadable language packs

Status (2026-10-28):

- **Done: 37 languages**, all the ones HY-MT2 translates locally and Whisper
  transcribes (all except Uyghur, which Whisper doesn't have). The list lives in
  a single place, `LANGS` in `src-tauri/src/config.rs`, and the UI requests it with
  the `languages` command, which also says which voices are on the machine.
- **All local (since 2026-10-28), no Groq.**
- **Per language:**
  - Listen: Parakeet for the European languages (en, es, fr, it, pt, de, nl, pl,
    cs, ru, uk) and SenseVoice for zh, zh-hant, yue, ja and ko. The others (22)
    can only be target languages: on the listening side they show as
    "(soon)". To listen to them, a local Whisper (whisper.cpp,
    ~550–830 MB, slower) or Meta's Omnilingual (sherpa-onnx, CTC) would be needed.
  - Voice (since 2026-11-01, `docs/plan-voz-supertonic.md`): Supertonic 3 in en, es,
    fr, it, pt, ja, ko, de, nl, pl, cs, ru, uk, tr, ar, hi, vi and id (before that,
    Kokoro in en, es, fr, it and pt); for the others, the best system voice
    installed (`system_voice.rs`: Premium > Enhanced > normal, and of the
    requested gender or, if there is none, of the other). With no voice installed, the language
    shows as "(no voice)" and there are only captions.
  - On this Mac (macOS 26) there is a voice for 27 of the 37. No voice: Persian,
    Urdu, Gujarati, Marathi, Filipino, Khmer, Burmese, Tibetan, Kazakh and
    Mongolian.
- **Captions:** scripts without spaces (Chinese, Japanese, Thai,
  Lao, Tibetan, Burmese, Khmer) are split into words with `Intl.Segmenter`; Arabic,
  Hebrew and Urdu are shown right to left (`dir="auto"`); sentence breaks understand
  。！？ । ۔ ؟ ။ ། ។.
- **Windows:** `system_voice.rs` already separates the voice list and the synthesis
  by system. It still needs to be implemented with `Windows.Media.SpeechSynthesis`
  (OneCore voices, with language and gender); until then, on Windows only the five
  Kokoro languages would have a voice.
- **Pending:** listen locally to the remaining 22 languages and the downloadable packs.

The packs were not made because the Kokoro model already includes its 54 voices
(`voices.bin`, 27 MB): there is nothing else to download. They make sense
when a language needs heavy pieces (see below).

## Before phase 1

The app only had English and Spanish: the `Lang` type (`config.rs`) only had
`En` and `Es`, and the lanes were fixed EN↔ES.

How many languages each part covers:

| Part | Languages |
|---|---|
| Whisper on Groq (Precise) | ~99 |
| Parakeet v3 (Fast) | 25, European only |
| qwen on Groq (Cloud) | 100+ |
| HY-MT2 (Local) | 33 (includes Chinese, Japanese, Korean, Arabic, Hindi, German…) |
| Kokoro (voice) | 8: English, Spanish, French, Italian, Portuguese, Hindi, Japanese, Chinese |

The limit is set by the voice:

- **All local** (Fast + Local): 5 languages (en, es, fr, it, pt).
- **With Whisper on Groq**: up to 8, but Hindi, Japanese and Chinese are untested. Today
  the phonemes come from espeak-ng, and Kokoro was trained with another
  system for Japanese and Chinese.
- Kokoro doesn't have German, Russian, Arabic or Korean. Piper (in sherpa-onnx) has
  voices for about 40 languages, although less natural ones.

Opening the 5 European languages is little work:

- A language picker per lane.
- Extend `Lang`, the voices and the glossaries.
- Review the filters that only know English and Spanish (filler words and Whisper
  hallucinations).

## Japanese and Chinese

1. **Listening:**
   - Whisper on Groq already works with both.
   - Locally, Parakeet doesn't recognize them. The options:
     - SenseVoice Small (Alibaba; zh, ja, ko, yue, en; ~230 MB). It runs in
       sherpa-onnx, the same library as Parakeet. It still needs to be checked that it gives
       per-word timings.
     - Local Whisper (large-v3-turbo, 834 MB; it was deleted during cleanup and would have to be downloaded again).
2. **Translating:** no change. HY-MT2 is strong in Chinese↔English and includes
   Japanese; qwen does too.
3. **Speaking, which is the hard part:**
   - Kokoro has Japanese (5) and Chinese (8) voices, but it needs the pronunciation
     from its training, and espeak-ng doesn't provide it.
   - **Chinese:** the multilingual Kokoro in sherpa-onnx comes with its own dictionary.
     It is viable and fits with moving Kokoro to sherpa-onnx
     (see [plan-distribucion.md](plan-distribucion.md)).
   - **Japanese:** a kanji analyzer (OpenJTalk/MeCab) is needed. There is no known
     ready-made option for Rust; it is the most costly part.
   - **Alternatives:** MeloTTS (zh+en in sherpa-onnx) and Style-BERT-VITS2 for
     Japanese. The latter is written in Python, so it is not usable in the app.
4. **App adjustments for Chinese and Japanese:**
   - Punctuation `。！？、，` in sentence breaks (`audio.js`, `App.jsx`).
   - No spaces between words: affects the joining of tokens in
     `listener.rs` and the cut between words.
   - Sentence lengths in characters (`MIN_PHRASE_CHARS`,
     `MAX_PHRASE_CHARS`) must be per language.
   - Whisper hallucinations specific to each language, such as
     "字幕由Amara.org社区提供" (subtitles provided by the Amara.org community).

First, two things must be checked:

- Which languages the multilingual Kokoro in sherpa-onnx really reads. If it includes
  Japanese, this is much simpler.
- Whether SenseVoice gives per-word timings.

**Summary:** Chinese is viable in the medium term. Japanese depends on solving
the voice.

## Downloadable language packs

The voice itself barely weighs anything. What is heavy is what each language needs.

| Part | Approx. size | Per language? |
|---|---|---|
| Kokoro model | ~100–330 MB | No, one for all its languages |
| One Kokoro voice | ~0.5 MB | Yes |
| Pronunciation dictionary | Chinese: a few MB. Japanese: ~100 MB | Yes |
| Piper voice (languages without Kokoro) | ~60 MB | Yes |
| Model for listening locally (SenseVoice) | ~230 MB, shared zh/ja/ko | Sometimes |

So, instead of "download a voice", a **language pack** with voices,
dictionary and, if needed, the model for listening locally:

- In the lane you choose the language. If it isn't installed, "Descargar
  japonés" (Download Japanese, ~350 MB) appears with a progress bar.
- The installer only includes English and Spanish. The rest is downloaded when requested,
  like the models of the first start.
- A "Languages" section shows the installed packs and lets you delete them.

Advantages:

- The installer stays small.
- A language can be added or improved by publishing its pack, without releasing a
  new version of the app.

What it doesn't solve: the pack is only a way to distribute. For Japanese,
an engine that reads it well inside the app is needed first.
