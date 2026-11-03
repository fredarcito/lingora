"""Step 1 of 3 (see README.md). Lists the Piper voices sherpa-onnx publishes in
Lingora's languages, with each one's config (espeak voice, speakers) and its
MODEL_CARD (licence, how it was trained). Writes piper-meta.json."""
import concurrent.futures as cf
import json
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# Lingora's languages (`LANGS` in src-tauri/src/config.rs).
LINGORA = "en es fr it pt zh yue ja ko de nl pl cs ru uk tr ar he fa hi bn ur gu mr ta te th vi id ms tl km my bo kk mn".split()


def get(url):
    try:
        return urllib.request.urlopen(url, timeout=30).read().decode()
    except Exception:
        return None


def assets():
    """Every archive of the `tts-models` release, with its size."""
    rel = json.loads(get("https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/tts-models"))
    out, page = {}, 1
    while batch := json.loads(get(f"https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/{rel['id']}/assets?per_page=100&page={page}")):
        out.update({a["name"]: a["size"] for a in batch})
        page += 1
    return out


def meta(name, size):
    repo = f"https://huggingface.co/csukuangfj/vits-piper-{name}/resolve/main"
    config = get(f"{repo}/{name}.onnx.json")
    card = get(f"{repo}/MODEL_CARD") or ""
    info = json.loads(config) if config else {}
    return name, {
        "bytes": size,
        "espeak": (info.get("espeak") or {}).get("voice"),
        "phoneme_type": info.get("phoneme_type"),
        "speakers": info.get("num_speakers"),
        "license": " ".join(l.split(":", 1)[1].strip() for l in card.splitlines() if "icense" in l and ":" in l),
        "training": " ".join(card.split("## Training", 1)[1].split())[:200] if "## Training" in card else "",
        "card": bool(card),
    }


def main():
    sizes = {n[len("vits-piper-"):-len(".tar.bz2")]: s for n, s in assets().items() if n.startswith("vits-piper-") and n.endswith(".tar.bz2")}
    # Each voice also comes as -fp16 (doesn't load in sherpa-onnx 2.0.1) and -int8 (2.4× slower without VNNI).
    names = [n for n in sizes if not n.endswith(("-fp16", "-int8")) and (m := re.match(r"([a-z]{2,3})[_-]", n)) and m.group(1) in LINGORA]
    with cf.ThreadPoolExecutor(24) as ex:
        data = dict(ex.map(lambda n: meta(n, sizes[n]), sorted(names)))
    json.dump(data, open(os.path.join(HERE, "piper-meta.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{len(data)} voces")


if __name__ == "__main__":
    main()
