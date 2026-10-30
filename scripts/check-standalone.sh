#!/bin/bash
# Checks that Lingora.app does not depend on anything from the Mac that built it (without
# Homebrew or development paths). See docs/plan-autonomia.md, Phase 6.
#
#   scripts/check-standalone.sh [ruta/a/Lingora.app]
#
# By default, the .app from `pnpm tauri build`. It fails if:
#   - any executable or library in the .app links something outside the system;
#   - any executable mentions /opt/homebrew or /usr/local;
#   - espeak-ng or its data is missing, or it does not pronounce;
#   - the signature is not valid.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/src-tauri/target/release/bundle/macos/Lingora.app}"
problems=0
fail() { echo "✗ $1"; problems=$((problems + 1)); }
ok() { echo "✓ $1"; }

[ -d "$APP" ] || { echo "No existe $APP (compila antes con pnpm tauri build)"; exit 1; }

# Everything executable or linkable in the .app.
binaries=()
while IFS= read -r f; do
  file -b "$f" | grep -q "Mach-O" && binaries+=("$f")
done < <(find "$APP/Contents" -type f \( -perm -u+x -o -name "*.dylib" \))

for bin in "${binaries[@]}"; do
  name="${bin#"$APP/"}"
  outside=$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/|@rpath/|@executable_path/|@loader_path/)' || true)
  [ -n "$outside" ] && fail "$name enlaza fuera del sistema: $outside" || ok "$name solo enlaza el sistema"
  # espeak-ng comes with its data folder compiled in by default; it does not use it because
  # the app always passes it `--path` with its own.
  found=$(strings "$bin" | grep -E '/opt/homebrew|/usr/local/' | grep -v '^/usr/local/share/espeak-ng-data$' || true)
  [ -n "$found" ] && fail "$name menciona rutas de Homebrew: $(echo "$found" | head -3 | tr '\n' ' ')"
done

ESPEAK="$APP/Contents/MacOS/espeak-ng"
DATA="$APP/Contents/Resources/espeak-ng-data"
if [ -x "$ESPEAK" ] && [ -f "$DATA/phontab" ]; then
  # Like the app: from the data folder, with a relative path.
  if ipa=$(cd "$APP/Contents/Resources" && "$ESPEAK" --path=. -v es -q --ipa "Hola, esto es una prueba." 2>/dev/null) && [ -n "$ipa" ]; then
    ok "espeak-ng pronuncia: $ipa"
  else
    fail "espeak-ng no devuelve fonemas"
  fi
else
  fail "falta espeak-ng ($ESPEAK) o sus datos ($DATA)"
fi

codesign --verify --deep --strict "$APP" 2>/dev/null && ok "firma válida" || fail "firma no válida"

echo
if [ "$problems" -eq 0 ]; then
  echo "Lingora.app no depende de nada de fuera."
else
  echo "$problems problema(s)."
  exit 1
fi
