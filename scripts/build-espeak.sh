#!/bin/bash
# Builds espeak-ng to put it inside Lingora: whoever uses the app does not
# install anything (no Homebrew). It leaves:
#   src-tauri/binaries/espeak-ng-aarch64-apple-darwin  (the program, `externalBin`)
#   src-tauri/resources/espeak-ng-data/                 (its data, `resources`)
#
#   scripts/build-espeak.sh
#
# `cmake` and the Xcode tools are needed only on the Mac that builds it.
#
# It goes as a separate program and not as a library because of its license (GPL v3): this way
# it is only distributed alongside the app (see docs/plan-autonomia.md).
#
# Two quirks of espeak-ng:
#   - Its code has files that are only told apart by case
#     (`e_short_1` and `E_short_1`); the Mac disk does not tell them apart and one
#     would overwrite the other. It is built in a disk image that does tell them apart.
#   - When compiling the phonemes, long paths get cut: the image is mounted
#     at a short path.
set -euo pipefail

VERSION=1.52.0
SHA256=bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23
# Only the languages the voice pronounces (the `espeak` field of LANGS in config.rs).
DICTS=(en es fr it pt)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_BIN="$ROOT/src-tauri/binaries/espeak-ng-aarch64-apple-darwin"
OUT_DATA="$ROOT/src-tauri/resources/espeak-ng-data"
WORK="$(mktemp -d)"
MOUNT="/tmp/lingora-espeak-$$"

cleanup() {
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$WORK" "$MOUNT"
}
trap cleanup EXIT

echo "→ Descargando espeak-ng $VERSION"
curl -fsSL -o "$WORK/espeak.tar.gz" "https://github.com/espeak-ng/espeak-ng/archive/refs/tags/$VERSION.tar.gz"
echo "$SHA256  $WORK/espeak.tar.gz" | shasum -a 256 -c - >/dev/null

echo "→ Preparando un disco que distingue mayúsculas"
hdiutil create -size 600m -fs "Case-sensitive APFS" -volname lingora-espeak -type SPARSE "$WORK/disk" -quiet
mkdir -p "$MOUNT"
hdiutil attach "$WORK/disk.sparseimage" -mountpoint "$MOUNT" -nobrowse -quiet
tar xzf "$WORK/espeak.tar.gz" -C "$MOUNT"

echo "→ Compilando (sin sonido propio ni librerías externas)"
cmake -S "$MOUNT/espeak-ng-$VERSION" -B "$MOUNT/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_TESTING=OFF \
  -DUSE_MBROLA=OFF -DUSE_LIBSONIC=OFF -DUSE_LIBPCAUDIO=OFF \
  -DUSE_ASYNC=OFF -DUSE_KLATT=OFF -DUSE_SPEECHPLAYER=OFF >"$WORK/build.log" 2>&1 &&
  cmake --build "$MOUNT/build" -j "$(sysctl -n hw.ncpu)" >>"$WORK/build.log" 2>&1 ||
  { tail -40 "$WORK/build.log" >&2; echo "✗ No compiló (arriba, el final del registro)" >&2; exit 1; }

echo "→ Copiando a src-tauri"
mkdir -p "$(dirname "$OUT_BIN")"
cp "$MOUNT/build/src/espeak-ng" "$OUT_BIN"
strip "$OUT_BIN"
rm -rf "$OUT_DATA"
mkdir -p "$OUT_DATA"
DATA="$MOUNT/build/espeak-ng-data"
cp -R "$DATA/phontab" "$DATA/phonindex" "$DATA/phondata" "$DATA/intonations" "$DATA/lang" "$DATA/voices" "$OUT_DATA/"
for d in "${DICTS[@]}"; do cp "$DATA/${d}_dict" "$OUT_DATA/"; done
cp "$MOUNT/espeak-ng-$VERSION/COPYING" "$OUT_DATA/COPYING"

# It must depend only on system libraries.
if otool -L "$OUT_BIN" | tail -n +2 | grep -v -E '^\s+/(usr/lib|System)/' | grep -q .; then
  echo "✗ espeak-ng enlaza algo fuera del sistema:" >&2
  otool -L "$OUT_BIN" >&2
  exit 1
fi
"$OUT_BIN" --path="$(dirname "$OUT_DATA")" -v es -q --ipa "Hola, esto es una prueba." >/dev/null
echo "✓ espeak-ng $VERSION listo ($(du -sh "$OUT_DATA" | cut -f1) de datos)"
