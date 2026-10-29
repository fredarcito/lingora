#!/bin/bash
# Deja en src-tauri/sherpa-libs/ las librerías compartidas de sherpa-onnx que la
# app necesita al empaquetarse (no estáticas, para que Mac y Windows se enlacen igual):
#   Mac:     libsherpa-onnx-c-api.dylib, libonnxruntime.dylib  (`bundle.macOS.frameworks`)
#   Windows: sherpa-onnx-c-api.dll, onnxruntime.dll, onnxruntime_providers_shared.dll
#            (`bundle.resources`, en tauri.windows.conf.json)
#
#   scripts/fetch-sherpa.sh
#
# Se llama desde beforeDevCommand / beforeBuildCommand (tauri.conf.json) y desde la
# CI de Windows. Tauri exige que estos archivos existan antes de compilar Rust.
# Usa la misma versión que la crate `sherpa-onnx` (Cargo.toml).
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
    LIBS=(sherpa-onnx-c-api.dll onnxruntime.dll onnxruntime_providers_shared.dll)
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
echo "✓ sherpa-onnx $VERSION listo en src-tauri/sherpa-libs (${#LIBS[@]} librerías)"
