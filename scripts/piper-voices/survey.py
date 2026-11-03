"""Step 2 of 3 (see README.md). Downloads every Piper voice (sherpa-onnx format) in Lingora's languages, one at a
time: reads its config, says a sentence with each speaker (up to 40), measures the
pitch (gender), checks it is understood with the app's own listener where it can, keeps
a WAV and deletes the model. Writes results.json, resumable."""
import json, os, re, shutil, subprocess, sys, tarfile, time, urllib.request, wave
import concurrent.futures as cf
import numpy as np, sherpa_onnx as s

HERE = os.path.dirname(os.path.abspath(__file__))
META = json.load(open(os.path.join(HERE, "piper-meta.json")))
OUT = os.path.join(HERE, "results.json")
WAVS = os.path.join(HERE, "samples")  # not in git
WORK = os.path.join(HERE, "work")  # not in git
MODELS = os.path.expanduser("~/Library/Application Support/lingora/models")
os.makedirs(WAVS, exist_ok=True); os.makedirs(WORK, exist_ok=True)

TEXT = {
    "en": "Hello, this is a test of the translated voice. It should sound natural and arrive on time.",
    "es": "Hola, esto es una prueba de la voz traducida. Debería sonar natural y llegar a tiempo.",
    "fr": "Bonjour, ceci est un test de la voix traduite. Elle devrait sonner naturelle et arriver à temps.",
    "it": "Ciao, questa è una prova della voce tradotta. Dovrebbe suonare naturale e arrivare in tempo.",
    "pt": "Olá, este é um teste da voz traduzida. Deveria soar natural e chegar a tempo.",
    "de": "Hallo, dies ist ein Test der übersetzten Stimme. Sie sollte natürlich klingen und rechtzeitig ankommen.",
    "nl": "Hallo, dit is een test van de vertaalde stem. Hij moet natuurlijk klinken en op tijd aankomen.",
    "pl": "Cześć, to jest test przetłumaczonego głosu. Powinien brzmieć naturalnie i dotrzeć na czas.",
    "cs": "Ahoj, toto je test přeloženého hlasu. Měl by znít přirozeně a dorazit včas.",
    "ru": "Привет, это проверка переведённого голоса. Он должен звучать естественно и приходить вовремя.",
    "uk": "Привіт, це перевірка перекладеного голосу. Він має звучати природно і приходити вчасно.",
    "tr": "Merhaba, bu çevrilmiş sesin bir testidir. Doğal duyulmalı ve zamanında gelmelidir.",
    "ar": "مرحبا، هذا اختبار للصوت المترجم. يجب أن يبدو طبيعيا وأن يصل في الوقت المناسب.",
    "fa": "سلام، این یک آزمایش صدای ترجمه شده است. باید طبیعی به نظر برسد و به موقع برسد.",
    "hi": "नमस्ते, यह अनुवादित आवाज़ की जाँच है। इसे स्वाभाविक लगना चाहिए और समय पर पहुँचना चाहिए।",
    "ur": "سلام، یہ ترجمہ شدہ آواز کا ٹیسٹ ہے۔ اسے قدرتی لگنا چاہیے اور وقت پر پہنچنا چاہیے۔",
    "kk": "Сәлем, бұл аударылған дауыстың сынағы. Ол табиғи естіліп, уақытында жетуі керек.",
    "vi": "Xin chào, đây là bài kiểm tra giọng nói được dịch. Nó nên nghe tự nhiên và đến đúng lúc.",
    "id": "Halo, ini adalah tes suara terjemahan. Suaranya harus terdengar alami dan tiba tepat waktu.",
    "zh": "你好，这是翻译语音的测试。它应该听起来自然，并且按时到达。",
}
PARAKEET_LANGS = {"en", "es", "fr", "it", "pt", "de", "nl", "pl", "cs", "ru", "uk"}
SKIP = re.compile(r"glados|turret", re.I)
MAX_SPEAKERS = 40
KEEP_PER_GENDER = 3


def family(name):
    return re.match(r"([a-z]{2,3})", name).group(1)


def phonemes(text, voice):
    out = []
    for part in re.split(r"([,.;:?!،؟。，！？])", text):
        part = part.strip()
        if not part:
            continue
        if re.fullmatch(r"[,.;:?!،؟。，！？]", part):
            out.append({"،": ",", "؟": "?", "。": ".", "，": ",", "！": "!", "？": "?"}.get(part, part) + " ")
            continue
        r = subprocess.run(["espeak-ng", "-q", "--ipa", "-v", voice], input=part, capture_output=True, text=True)
        out.append(" ".join(r.stdout.split()))
    return "".join(out).strip()


def f0(x, sr):
    vals, n = [], int(0.04 * sr)
    for i in range(0, len(x) - n, n // 2):
        fr = x[i:i + n]
        if np.sqrt(np.mean(fr ** 2)) < 0.03:
            continue
        fr = fr - fr.mean(); ac = np.correlate(fr, fr, "full")[n - 1:]
        lo, hi = int(sr / 400), int(sr / 70)
        lag = lo + np.argmax(ac[lo:hi])
        if ac[lag] > 0.4 * ac[0]:
            vals.append(sr / lag)
    return float(np.median(vals)) if vals else 0.0


_asr = {}
def recognizer(kind):
    if kind not in _asr:
        if kind == "parakeet":
            d = f"{MODELS}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
            _asr[kind] = s.OfflineRecognizer.from_transducer(f"{d}/encoder.int8.onnx", f"{d}/decoder.int8.onnx", f"{d}/joiner.int8.onnx", f"{d}/tokens.txt", num_threads=2, model_type="nemo_transducer")
        else:
            d = f"{MODELS}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
            _asr[kind] = s.OfflineRecognizer.from_sense_voice(f"{d}/model.int8.onnx", f"{d}/tokens.txt", num_threads=2, use_itn=False)
    return _asr[kind]


def norm(t):
    return re.sub(r"[^\w\s]", " ", t.lower()).split()


import threading
_asr_lock = threading.Lock()


def understood(lang, x, sr):
    with _asr_lock:
        return _understood(lang, x, sr)


def _understood(lang, x, sr):
    kind = "parakeet" if lang in PARAKEET_LANGS else "sensevoice" if lang == "zh" else None
    if not kind:
        return None, ""
    # resample to 16 kHz
    n = int(len(x) * 16000 / sr)
    y = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    st = recognizer(kind).create_stream(); st.accept_waveform(16000, y); recognizer(kind).decode_stream(st)
    got = st.result.text
    if lang == "zh":
        want = [c for c in TEXT[lang] if re.match(r"\w", c)]; have = [c for c in got if re.match(r"\w", c)]
    else:
        want, have = norm(TEXT[lang]), norm(got)
    hit = sum(1 for w in want if w in have)
    return round(hit / max(1, len(want)), 2), got


def survey(name):
    m = META[name]
    lang = family(name)
    url = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-{name}.tar.bz2"
    folder = os.path.join(WORK, f"vits-piper-{name}")
    tmp = folder + ".tar.bz2"
    for attempt in range(3):
        try:
            urllib.request.urlretrieve(url, tmp)
            break
        except Exception as e:
            if attempt == 2:
                return {"error": f"download: {e}"}
            time.sleep(3)
    with tarfile.open(tmp) as tar:
        members = [x for x in tar.getmembers() if "espeak-ng-data" not in x.name and not x.name.endswith((".py", ".sh"))]
        tar.extractall(WORK, members=members, filter="data")
    os.remove(tmp)
    onnx = [f for f in os.listdir(folder) if f.endswith(".onnx")][0]
    cfg_json = [f for f in os.listdir(folder) if f.endswith(".onnx.json")]
    info = json.load(open(os.path.join(folder, cfg_json[0]))) if cfg_json else {}
    espeak = (info.get("espeak") or {}).get("voice") or m.get("espeak")
    ptype = str(info.get("phoneme_type") or m.get("phoneme_type") or "espeak").replace("PhonemeType.", "").lower()
    smap = {v: k for k, v in (info.get("speaker_id_map") or {}).items()}
    lexicon = os.path.exists(f"{folder}/lexicon.txt")
    fsts = ",".join(f"{folder}/{f}" for f in ("phone.fst", "date.fst", "number.fst") if os.path.exists(f"{folder}/{f}"))
    vits = s.OfflineTtsVitsModelConfig(model=f"{folder}/{onnx}", tokens=f"{folder}/tokens.txt", lexicon=f"{folder}/lexicon.txt" if lexicon else "")
    tts = s.OfflineTts(s.OfflineTtsConfig(model=s.OfflineTtsModelConfig(vits=vits, num_threads=2), rule_fsts=fsts))
    text = TEXT[lang]
    if lexicon:
        ptype = "lexicon"
    ph = None if lexicon else [[ord(c) for c in (text if ptype == "text" else phonemes(text, espeak))]]
    n = max(1, tts.num_speakers)
    speakers, females, males = [], 0, 0
    for sid in range(min(n, MAX_SPEAKERS)):
        g = s.GenerationConfig(); g.sid = sid
        if ph: g.phoneme_codepoints = ph
        t0 = time.time(); a = tts.generate(text, g); took = time.time() - t0
        x = np.array(a.samples, dtype=np.float32)
        if len(x) == 0:
            continue
        pitch = f0(x, a.sample_rate)
        gender = "female" if pitch >= 165 else "male" if pitch < 150 else "female" if pitch >= 157 else "male"
        if n > 1 and ((gender == "female" and females >= KEEP_PER_GENDER) or (gender == "male" and males >= KEEP_PER_GENDER)):
            continue
        females += gender == "female"; males += gender == "male"
        score, heard = understood(lang, x, a.sample_rate)
        wav = os.path.join(WAVS, f"{name}-{sid}.wav")
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(a.sample_rate); w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
        speakers.append({"sid": sid, "name": smap.get(sid, ""), "pitch": round(pitch), "gender": gender, "score": score, "heard": heard, "rtf": round(took / (len(x) / a.sample_rate), 3)})
        if n > 1 and females >= KEEP_PER_GENDER and males >= KEEP_PER_GENDER:
            break
    files = sorted(os.listdir(folder))
    shutil.rmtree(folder)
    return {"lang": lang, "espeak": espeak, "phoneme_type": ptype, "num_speakers": n, "sample_rate": info.get("audio", {}).get("sample_rate"), "onnx": onnx, "files": files, "speakers": speakers}


def main():
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [n for n in sorted(META) if n not in done and not SKIP.search(n)]
    print(f"{len(todo)} voces por revisar", flush=True)
    with cf.ThreadPoolExecutor(3) as ex:
        futures = {ex.submit(survey, n): n for n in todo}
        for f in cf.as_completed(futures):
            n = futures[f]
            try:
                done[n] = f.result()
            except Exception as e:
                done[n] = {"error": str(e)}
            r = done[n]
            spk = ", ".join(f"{x['gender'][0]}{x['pitch']}" + (f"/{x['score']}" if x['score'] is not None else "") for x in r.get("speakers", []))
            print(f"[{len(done)}] {n}: {r.get('error') or spk}", flush=True)
            json.dump(done, open(OUT, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
