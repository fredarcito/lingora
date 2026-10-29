#!/bin/bash
# Comprueba que Lingora.app no dependa de nada del Mac que la compiló (sin
# Homebrew ni rutas de desarrollo). Ver docs/plan-autonomia.md, Fase 6.
#
#   scripts/check-standalone.sh [ruta/a/Lingora.app]
#
# Por defecto, el .app de `pnpm tauri build`. Falla si:
#   - algún ejecutable o librería del .app enlaza algo fuera del sistema;
#   - algún ejecutable menciona /opt/homebrew o /usr/local;
#   - falta espeak-ng o sus datos, o no pronuncia;
#   - la firma no es válida.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/src-tauri/target/release/bundle/macos/Lingora.app}"
problems=0
fail() { echo "✗ $1"; problems=$((problems + 1)); }
ok() { echo "✓ $1"; }

[ -d "$APP" ] || { echo "No existe $APP (compila antes con pnpm tauri build)"; exit 1; }

# Todo lo ejecutable o enlazable del .app.
binaries=()
while IFS= read -r f; do
  file -b "$f" | grep -q "Mach-O" && binaries+=("$f")
done < <(find "$APP/Contents" -type f \( -perm -u+x -o -name "*.dylib" \))

for bin in "${binaries[@]}"; do
  name="${bin#"$APP/"}"
  outside=$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/|@rpath/|@executable_path/|@loader_path/)' || true)
  [ -n "$outside" ] && fail "$name enlaza fuera del sistema: $outside" || ok "$name solo enlaza el sistema"
  # espeak-ng trae compilada su carpeta de datos por defecto; no la usa porque
  # la app siempre le pasa `--path` con la suya.
  found=$(strings "$bin" | grep -E '/opt/homebrew|/usr/local/' | grep -v '^/usr/local/share/espeak-ng-data$' || true)
  [ -n "$found" ] && fail "$name menciona rutas de Homebrew: $(echo "$found" | head -3 | tr '\n' ' ')"
done

ESPEAK="$APP/Contents/MacOS/espeak-ng"
DATA="$APP/Contents/Resources/espeak-ng-data"
if [ -x "$ESPEAK" ] && [ -f "$DATA/phontab" ]; then
  # Como la app: desde la carpeta de los datos, con ruta relativa.
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
