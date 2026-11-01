#!/bin/bash
# Builds the virtual microphone "Lingora Mic" (driver/LingoraMic.c), an
# AudioServerPlugIn that coreaudiod loads. It leaves:
#   src-tauri/resources/LingoraMic.driver
#
#   scripts/build-mic.sh            # build only
#   scripts/build-mic.sh --install  # build and install on this Mac (asks for the password)
#   scripts/build-mic.sh --uninstall
#
# Only the Xcode command line tools are needed. Universal (arm64 + x86_64) and
# signed ad hoc; the Developer ID signature comes with the app's
# (see docs/plan-distribucion.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/resources/LingoraMic.driver"
HAL=/Library/Audio/Plug-Ins/HAL

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS"
cp "$ROOT/driver/Info.plist" "$OUT/Contents/Info.plist"
clang -bundle -O2 -Wall -Wextra -Werror \
  -arch arm64 -arch x86_64 -mmacosx-version-min=14.0 \
  -framework CoreAudio -framework CoreFoundation \
  -o "$OUT/Contents/MacOS/LingoraMic" "$ROOT/driver/LingoraMic.c"
codesign --force --sign - "$OUT"
echo "Built $OUT"

if [[ "${1:-}" == "--install" ]]; then
  sudo rm -rf "$HAL/LingoraMic.driver"
  sudo cp -R "$OUT" "$HAL/"
  sudo chown -R root:wheel "$HAL/LingoraMic.driver"
  # coreaudiod restarts by itself; the sound cuts out for a second.
  sudo killall coreaudiod
  echo "Installed in $HAL"
elif [[ "${1:-}" == "--uninstall" ]]; then
  sudo rm -rf "$HAL/LingoraMic.driver"
  sudo killall coreaudiod
  echo "Removed from $HAL"
fi
