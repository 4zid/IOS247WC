#!/usr/bin/env bash
# 247WC iOS — corre xcodebuild en la CI.
#
# Guarda el log crudo completo (se sube como artefacto si algo falla) y en
# pantalla muestra una versión legible con xcbeautify, que además marca
# errores y warnings como anotaciones de GitHub. Si xcbeautify no está
# instalado, o con XCBEAUTIFY=false (la exportación: xcbeautify se come las
# líneas que no reconoce, y ahí están los errores de firma y de subida), sale
# la salida cruda.
#
# El código de salida es siempre el de xcodebuild: un problema de xcbeautify
# no puede dar por fallado (ni por bueno) un build.
#
#   bash .github/ci/xcodebuild.sh <archivo.log> <argumentos de xcodebuild…>

set -u

if [[ $# -lt 2 ]]; then
  echo "uso: $0 <archivo.log> <argumentos de xcodebuild…>" >&2
  exit 2
fi

log=$1
shift
mkdir -p "$(dirname "$log")"

echo "+ xcodebuild $*"

if [[ ${XCBEAUTIFY:-true} != false ]] && command -v xcbeautify >/dev/null 2>&1; then
  xcodebuild "$@" 2>&1 | tee "$log" | xcbeautify --renderer github-actions
  codes=("${PIPESTATUS[@]}")
else
  [[ ${XCBEAUTIFY:-true} == false ]] || echo "::notice::xcbeautify no está instalado: va la salida cruda de xcodebuild."
  xcodebuild "$@" 2>&1 | tee "$log"
  codes=("${PIPESTATUS[@]}")
fi

status=${codes[0]}

if [[ $status -eq 0 && ${codes[2]:-0} -ne 0 ]]; then
  echo "::warning::xcbeautify falló (código ${codes[2]}), pero xcodebuild terminó bien. El log completo está en $log."
fi

if [[ $status -ne 0 ]]; then
  # xcbeautify a veces no muestra errores que no reconoce (dependencias,
  # firma): repetimos las líneas de error del log crudo para que se vean.
  echo
  echo "──── xcodebuild terminó con código $status. Errores en el log crudo ($log):"
  grep -E '(^|[^[:alnum:]_])(fatal )?error:|\*\* [A-Z ]+ FAILED \*\*' "$log" | tail -n 60 || true
fi

exit "$status"
