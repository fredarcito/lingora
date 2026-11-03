"""Step 3 of 3 (see README.md). Turns piper-meta.json and results.json into the
catalogue the app reads (src-tauri/src/piper_voices.json) and the credits text
(public/licenses/Piper-voices.txt)."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
META = json.load(open(os.path.join(HERE, "piper-meta.json")))
RESULTS = json.load(open(os.path.join(HERE, "results.json")))

# The voice "Turn on voice" downloads, per language and gender; elsewhere the
# best understood one goes first.
DEFAULTS = {
    "es": ["es_ES-sharvard-medium:1", "es_ES-sharvard-medium:0"],
    "en": ["en_US-ljspeech-medium:0", "en_US-john-medium:0"],
}
# Several qualities of the same voice: medium is the one that keeps up on a
# modest computer; the others only if there is no medium.
QUALITY = ["medium", "high", "low", "x_low"]


def license_ok(text):
    """Allows commercial use, by the licence of the voice's own recordings."""
    t = text.lower()
    if not t or re.search(r"by-nc|\bnc\b|non-?commercial|agpl", t):
        return False
    return any(x in t for x in ["cc0", "public domain", "by/4.0", "by/3.0", "cc by", "cc-by", "attribution", "apache", "mit", "unlicense", "by-sa"])


def base_and_quality(name):
    parts = name.split("-")
    if parts[-1] in QUALITY:
        return "-".join(parts[:-1]), parts[-1]
    if parts[-1].endswith(("_low", "_medium")):  # "fa-haaniye_low"
        return name, "low"
    return name, "medium"


def pretty(name):
    voice = name.split("-")[1] if "-" in name else name
    return " ".join(w.capitalize() for w in voice.split("_"))


def tag(name):
    m = re.match(r"([a-z]{2,3})_([A-Z]{2})-", name)
    return f"{m.group(1)}-{m.group(2)}" if m else re.match(r"[a-z]{2,3}", name).group(0)


def main():
    # One quality per voice.
    best = {}
    for name, r in RESULTS.items():
        # A few archives name the model differently (a duplicate of another voice).
        if "error" in r or not r.get("speakers") or r.get("onnx") != f"{name}.onnx":
            continue
        base, quality = base_and_quality(name)
        if base not in best or QUALITY.index(quality) < QUALITY.index(base_and_quality(best[base])[1]):
            best[base] = name
    models, voices = [], []
    for name in sorted(best.values()):
        r, m = RESULTS[name], META[name]
        training = m.get("training", "").lower()
        # Fine-tuned from "lessac" (or from davefx, itself from lessac): its
        # recordings forbid commercial use (docs/plan-voz-ligera.md).
        commercial = license_ok(m.get("license", "")) and "lessac" not in training and "davefx" not in training
        models.append({
            "name": name,
            "bytes": m["bytes"],
            "license": m.get("license") or "unknown",
            "commercial": commercial,
            "input": r["phoneme_type"] if r["phoneme_type"] in ("text", "lexicon") else "espeak",
            "espeak": r.get("espeak") or "",
            "files": [f for f in r["files"] if f != "MODEL_CARD"],
        })
        for s in r["speakers"]:
            label = pretty(name) + (f" {s['name'] or s['sid'] + 1}" if r["num_speakers"] > 1 else "")
            voices.append({
                "model": name, "speaker": s["sid"], "lang": r["lang"], "gender": s["gender"],
                "name": label, "tag": tag(name), "score": s["score"] if s["score"] is not None else 1,
            })
    # Order: the defaults, then the best understood, then by name.
    def order(v):
        ids = DEFAULTS.get(v["lang"], [])
        vid = f"{v['model']}:{v['speaker']}"
        return (v["lang"], ids.index(vid) if vid in ids else len(ids), -v["score"], v["name"])
    voices.sort(key=order)
    for v in voices:
        del v["score"]
    out = os.path.join(ROOT, "src-tauri", "src", "piper_voices.json")
    json.dump({"models": models, "voices": voices}, open(out, "w"), ensure_ascii=False, indent=1)
    write_credits(models)
    print(f"{len(models)} modelos, {len(voices)} voces, {sum(m['commercial'] for m in models)} con uso comercial claro")


def write_credits(models):
    lines = [
        "Piper voices (the light voice)",
        "==============================",
        "",
        "Lingora downloads these voices on demand, in the format sherpa-onnx publishes",
        "(https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models), from the Piper",
        "voice catalogue (https://huggingface.co/rhasspy/piper-voices) and its community.",
        "Each voice has its own licence, from the recordings it was trained on; the",
        "details of each are in its MODEL_CARD at",
        "https://huggingface.co/csukuangfj/vits-piper-<voice>.",
        "",
        "Lingora is a demo: some of these voices are for non-commercial use only, and",
        "voices fine-tuned from the 'lessac' voice inherit the non-commercial licence of",
        "its recordings (Blizzard Challenge 2013). They are marked below.",
        "",
    ]
    for m in models:
        lines.append(f"{m['name']}")
        lines.append(f"  Licence: {m['license']}")
        if not m["commercial"]:
            lines.append("  Not for commercial use (or not clear that it is).")
        lines.append("")
    open(os.path.join(ROOT, "public", "licenses", "Piper-voices.txt"), "w").write("\n".join(lines))


if __name__ == "__main__":
    main()
