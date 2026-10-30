#!/bin/bash
# Leaves in src-tauri/sherpa-libs/ the shared sherpa-onnx libraries that the
# app needs when packaged (not static, so that Mac and Windows link the same way):
#   Mac:     libsherpa-onnx-c-api.dylib, libonnxruntime.dylib  (`bundle.macOS.frameworks`)
#   Windows: sherpa-onnx-c-api.dll, onnxruntime.dll, onnxruntime_providers_shared.dll
#            (`bundle.resources`, in tauri.windows.conf.json)
#
#   scripts/fetch-sherpa.sh
#
# It is called from beforeDevCommand / beforeBuildCommand (tauri.conf.json) and from the
# Windows CI. Tauri requires these files to exist before compiling Rust.
# Uses the same version as the `sherpa-onnx` crate (Cargo.toml).
set -euo pipefail

VERSION=2.0.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/sherpa-libs"
BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/v$VERSION"

case "$(uname -s)" in
  Darwin)
    ARCHIVE="sherpa-onnx-v$VERSION-osx-arm64-shared-lib.tar.bz2"
    SHA256=e2d57ad9c83803d6c48f259caa66e44879bd4c4724c61f0d51a277b411bffb1d
    LIBS=(libsherpa-onnx-c-api.dylib libonnxruntime.dylib)
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ARCHIVE="sherpa-onnx-v$VERSION-win-x64-shared-MT-Release-lib.tar.bz2"
    SHA256=afa4de3ca4ab0afd53bb4aab40d28ee15608364b549ffc0fe0caf6489bfc39a5
    # The .lib files are for linking (SHERPA_ONNX_LIB_DIR in the workflow); the .dll files are for packaging.
    LIBS=(sherpa-onnx-c-api.dll onnxruntime.dll onnxruntime_providers_shared.dll sherpa-onnx-c-api.lib onnxruntime.lib)
    ;;
  *)
    echo "✗ Sistema no soportado: $(uname -s)" >&2
    exit 1
    ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Descargando sherpa-onnx $VERSION (librerías compartidas)"
curl -fsSL -o "$WORK/sherpa.tar.bz2" "$BASE/$ARCHIVE"
if command -v shasum >/dev/null; then SUM="shasum -a 256"; else SUM="sha256sum"; fi
echo "$SHA256  $WORK/sherpa.tar.bz2" | $SUM -c - >/dev/null ||
  { echo "✗ El SHA-256 del archive no coincide" >&2; exit 1; }

tar -xjf "$WORK/sherpa.tar.bz2" -C "$WORK"
SRC="$(find "$WORK" -type d -name lib | head -n 1)"

rm -rf "$OUT"
mkdir -p "$OUT"
for lib in "${LIBS[@]}"; do
  cp "$SRC/$lib" "$OUT/"
done

# On Mac, the author's signature (another Team ID) makes macOS reject loading them inside
# the ad-hoc signed app. They are signed again with the same identity as the app ("-").
if [ "$(uname -s)" = "Darwin" ]; then
  for lib in "${LIBS[@]}"; do
    codesign --force --sign - "$OUT/$lib" >/dev/null
  done
fi
echo "✓ sherpa-onnx $VERSION listo en src-tauri/sherpa-libs (${#LIBS[@]} librerías)"
