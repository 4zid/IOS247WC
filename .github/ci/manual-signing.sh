#!/usr/bin/env bash
# 247WC iOS — firma manual para el workflow TestFlight (plan B).
#
# Lo normal es la firma en la nube (ver testflight.yml). Si eso no anda, se
# puede firmar con un certificado y un perfil propios cargando tres secretos:
#   DIST_CERT_P12       el certificado «Apple Distribution» (.p12) en base64
#   DIST_CERT_PASSWORD  la contraseña del .p12
#   DIST_PROFILE        el perfil «App Store Connect» (.mobileprovision) en base64
#
#   bash .github/ci/manual-signing.sh install   llavero temporal + perfil + proyecto
#   bash .github/ci/manual-signing.sh cleanup   borra el llavero y el perfil
#
# install valida todo antes de compilar (que el perfil sea de App Store, del
# bundle ID del proyecto y del equipo APPLE_TEAM_ID; que el certificado sea de
# distribución) y deja en $GITHUB_ENV lo que usan los pasos siguientes:
# SIGNING_KEYCHAIN, SIGN_IDENTITY, PROFILE_UUID y PROFILE_BUNDLE_ID. Nunca
# imprime los secretos; los valores derivados (UUID, certificado) van
# enmascarados.

set -euo pipefail

: "${RUNNER_TEMP:?falta RUNNER_TEMP}"
PBXPROJ=${PBXPROJ:-ios/App/App.xcodeproj/project.pbxproj}
PLISTBUDDY=${PLISTBUDDY:-/usr/libexec/PlistBuddy}
KEYCHAIN="$RUNNER_TEMP/247wc-firma.keychain-db"
INSTALLED="$RUNNER_TEMP/247wc-perfiles-instalados.txt"
# Xcode 16 en adelante busca los perfiles en UserData; los anteriores, en
# MobileDevice. Va en los dos, así no depende de la versión de Xcode.
PROFILE_DIRS=(
  "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  "$HOME/Library/MobileDevice/Provisioning Profiles"
)
README_REF='README, sección «Subir sin Mac» → firma manual'

# Corta con un error claro, en la página de la corrida y en el resumen.
fail() {
  local title=$1
  shift
  for line in "$@"; do echo "::error title=$title::$line"; done
  {
    echo "## $title"
    echo
    printf -- '- %s\n' "$@"
    echo
    echo "Paso a paso en el $README_REF."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 1
}

mask() { [[ -z $1 ]] || echo "::add-mask::$1"; }

# Para mostrar textos que vienen de afuera (perfil, errores de macOS) sin
# que GitHub los tome como comandos: ni «::» ni caracteres raros.
shown() { printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9 ._()*:/-' '?' | sed -E 's/:{2,}/:/g'; }

# Los secretos en base64: sin espacios ni saltos de línea, que se cuelan al pegar.
decode() { printf '%s' "${!1}" | tr -d '[:space:]' | base64 --decode > "$2" 2>/dev/null; }

# El bundle ID del proyecto de Xcode (el que tiene que tener el perfil) en
# $BUNDLE. Sin $(…): así fail corta el script y su mensaje se ve.
read_project_bundle_id() {
  # Lectura línea por línea y no mapfile: el bash de macOS (/bin/bash) es 3.2.
  local ids=() found
  while IFS= read -r found; do ids+=("$found"); done < <(sed -nE 's/^[[:space:]]*PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;.*$/\1/p' "$PBXPROJ" | sort -u)
  if [[ ${#ids[@]} -gt 1 ]]; then
    fail "Firma manual" "El proyecto tiene más de un bundle ID ($(shown "${ids[*]}")) y la firma manual de este workflow maneja uno solo (un perfil). Hay que adaptar .github/ci/manual-signing.sh."
  fi
  local id=${ids[0]:-}
  # Si viene de una variable ($(…)), que la resuelva Xcode.
  if [[ -z $id || $id == *'$'* ]]; then
    id=$(xcodebuild -showBuildSettings -project "$(dirname "$PBXPROJ")" -target App -configuration Release 2>/dev/null |
      sed -nE 's/^[[:space:]]*PRODUCT_BUNDLE_IDENTIFIER = (.+)$/\1/p' | head -n 1) || true
  fi
  [[ -n $id ]] || fail "Firma manual" "No pude leer el bundle ID (PRODUCT_BUNDLE_IDENTIFIER) del proyecto de Xcode."
  BUNDLE=$id
}

install() {
  : "${TEAM_ID:?falta TEAM_ID (lo deja el paso «Revisar los secretos»)}"
  local work
  work=$(mktemp -d "$RUNNER_TEMP/firma.XXXXXX")
  # shellcheck disable=SC2064  # $work se fija ahora, a propósito
  trap "rm -rf '$work'" EXIT

  # ── El perfil ──────────────────────────────────────────────────────────
  decode DIST_PROFILE "$work/profile.mobileprovision" ||
    fail "Perfil inválido" "DIST_PROFILE no es base64 válido. En una Mac: base64 -i perfil.mobileprovision | pbcopy, y pegalo entero."
  # El .mobileprovision es un plist firmado (CMS): security lo verifica y lo saca.
  security cms -D -i "$work/profile.mobileprovision" -o "$work/profile.plist" 2>/dev/null ||
    fail "Perfil inválido" "DIST_PROFILE no es un perfil de aprovisionamiento (.mobileprovision). Bajalo de developer.apple.com → Profiles y cargalo en base64."
  pb() { "$PLISTBUDDY" -c "Print :$1" "$work/profile.plist" 2>/dev/null; }

  local uuid name team appid
  uuid=$(pb UUID) || true
  name=$(pb Name) || true
  team=$(pb TeamIdentifier:0) || true
  appid=$(pb Entitlements:application-identifier) || true
  [[ $uuid =~ ^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$ ]] ||
    fail "Perfil inválido" "El perfil de DIST_PROFILE no tiene UUID: no parece un perfil de Apple."
  mask "$uuid"
  mask "$team"

  # De App Store: sin lista de dispositivos (eso es desarrollo o Ad Hoc), sin
  # «todos los dispositivos» (Enterprise) y sin get-task-allow (desarrollo).
  local want_store="Tiene que ser de distribución «App Store Connect»: developer.apple.com → Profiles → «+» → Distribution → App Store Connect."
  if pb ProvisionedDevices >/dev/null; then
    fail "Perfil equivocado" "El perfil de DIST_PROFILE es de desarrollo o Ad Hoc (tiene una lista de iPhones). $want_store"
  fi
  if [[ $(pb Entitlements:get-task-allow || true) == true ]]; then
    fail "Perfil equivocado" "El perfil de DIST_PROFILE es de desarrollo (permite depurar la app). $want_store"
  fi
  if pb ProvisionsAllDevices >/dev/null; then
    fail "Perfil equivocado" "El perfil de DIST_PROFILE es «In House» (Enterprise). $want_store"
  fi

  if [[ $team != "$TEAM_ID" ]]; then
    fail "Perfil de otro equipo" "El perfil de DIST_PROFILE es de otro equipo de Apple que APPLE_TEAM_ID. Tienen que ser del mismo (y la clave de API también)."
  fi

  local bundle suffix
  read_project_bundle_id
  bundle=$BUNDLE
  suffix=${appid#*.}   # application-identifier = <prefijo>.<bundle ID>
  if [[ -z $appid || $suffix == "$appid" ]]; then
    fail "Perfil inválido" "El perfil de DIST_PROFILE no dice para qué app es (falta application-identifier)."
  fi
  # Un perfil comodín (com.ejemplo.*) también sirve si cubre el bundle ID.
  if [[ $suffix != "$bundle" ]] && ! [[ $suffix == *'*' && $bundle == "${suffix%\*}"* ]]; then
    fail "Perfil de otra app" "El perfil de DIST_PROFILE es para «$(shown "$suffix")», pero la app es «$bundle». Creá (o elegí) un perfil App Store Connect para $bundle en developer.apple.com → Profiles."
  fi

  local expires now
  expires=$(plutil -extract ExpirationDate raw -o - "$work/profile.plist" 2>/dev/null) || true
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # plutil da la fecha en ISO 8601 (UTC): se compara como texto.
  if [[ $expires =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] && [[ $expires < $now ]]; then
    fail "Perfil vencido" "El perfil de DIST_PROFILE venció el ${expires%%T*}. En developer.apple.com → Profiles, regeneralo (Edit → Save), bajalo y volvé a cargarlo."
  fi

  # ── El certificado, en un llavero temporal ────────────────────────────
  decode DIST_CERT_P12 "$work/cert.p12" ||
    fail "Certificado inválido" "DIST_CERT_P12 no es base64 válido. En una Mac: base64 -i certificado.p12 | pbcopy, y pegalo entero."

  local kc_pass password
  kc_pass=$(openssl rand -hex 24)
  mask "$kc_pass"
  # Un salto de línea al final de la contraseña (de pegarla) no es parte de ella.
  password=$(printf '%s' "${DIST_CERT_PASSWORD:-}" | tr -d '\r\n')

  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  security create-keychain -p "$kc_pass" "$KEYCHAIN"
  # Que no se bloquee solo durante la corrida (6 horas, como mucho un job).
  security set-keychain-settings -lut 21600 "$KEYCHAIN"
  security unlock-keychain -p "$kc_pass" "$KEYCHAIN"
  if ! security import "$work/cert.p12" -k "$KEYCHAIN" -f pkcs12 -P "$password" \
      -T /usr/bin/codesign -T /usr/bin/security > "$work/import.txt" 2>&1; then
    fail "No se pudo abrir el certificado" \
      "macOS no pudo importar el .p12 de DIST_CERT_P12: $(shown "$(tail -n 1 "$work/import.txt")")." \
      "Lo más común: DIST_CERT_PASSWORD no es la contraseña con la que se exportó el .p12." \
      "Si lo armaste con OpenSSL 3 (no desde Llaveros de una Mac), exportalo de nuevo agregando -legacy: openssl pkcs12 -export -legacy …"
  fi
  rm -f "$work/cert.p12"
  # Sin esto, codesign se queda esperando que alguien apriete «Permitir».
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kc_pass" "$KEYCHAIN" >/dev/null
  # Sumarlo a la lista de búsqueda, sin sacar los que ya estaban.
  local current=() kc
  while IFS= read -r kc; do [[ -n $kc ]] && current+=("$kc"); done < <(security list-keychains -d user | sed -E 's/^[[:space:]]*"?//; s/"?[[:space:]]*$//')
  security list-keychains -d user -s "$KEYCHAIN" ${current[@]+"${current[@]}"}

  # Solo las identidades válidas (certificado vigente, con su clave privada).
  local identities sha='' identity='' kind='' line
  identities=$(security find-identity -v -p codesigning "$KEYCHAIN" || true)
  while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*[0-9]+\)[[:space:]]+([0-9A-Fa-f]{40})[[:space:]]+\"((Apple|iPhone|iOS)[[:space:]]Distribution)(:.*)?\"$ ]]; then
      sha=${BASH_REMATCH[1]}
      identity="${BASH_REMATCH[2]}${BASH_REMATCH[4]}"
      kind=${BASH_REMATCH[2]}
      break
    fi
  done <<< "$identities"
  if [[ -z $sha ]]; then
    if grep -qE '"(Apple|iPhone) Development' <<< "$identities"; then
      fail "Certificado equivocado" "El .p12 de DIST_CERT_P12 es de desarrollo («Apple Development»). Tiene que ser de distribución: «Apple Distribution»."
    fi
    fail "Certificado inválido" "El .p12 de DIST_CERT_P12 no tiene un certificado de distribución válido: puede estar vencido o revocado, o el .p12 se exportó sin la clave privada (en Llaveros hay que exportar el certificado junto con su clave)."
  fi
  mask "$sha"
  mask "$identity"
  if [[ $identity != *"($TEAM_ID)" ]]; then
    fail "Certificado de otro equipo" "El certificado de DIST_CERT_P12 es de otro equipo de Apple que APPLE_TEAM_ID. Tienen que ser del mismo."
  fi

  # ── Instalar el perfil donde lo busca Xcode ───────────────────────────
  local dir
  for dir in "${PROFILE_DIRS[@]}"; do
    mkdir -p "$dir"
    # Anotado antes de copiar, para que cleanup lo borre aunque algo falle.
    echo "$dir/$uuid.mobileprovision" >> "$INSTALLED"
    cp "$work/profile.mobileprovision" "$dir/$uuid.mobileprovision"
  done

  # El perfil va solo en el target App, adentro del proyecto (en este Mac
  # descartable, no se commitea). Por línea de comandos le llegaría también a
  # los paquetes de Swift, y xcodebuild corta con «does not support
  # provisioning profiles».
  local want got
  want=$(grep -cE '^[[:space:]]*PRODUCT_BUNDLE_IDENTIFIER = ' "$PBXPROJ" || true)
  PROFILE_UUID=$uuid perl -ni -e '
    next if /^\s*PROVISIONING_PROFILE_SPECIFIER = /;
    print;
    print "$1PROVISIONING_PROFILE_SPECIFIER = \"$ENV{PROFILE_UUID}\";\n" if /^(\s*)PRODUCT_BUNDLE_IDENTIFIER = /;
  ' "$PBXPROJ"
  got=$(grep -cE '^[[:space:]]*PROVISIONING_PROFILE_SPECIFIER = ' "$PBXPROJ" || true)
  if [[ $want -lt 1 || $got != "$want" ]]; then
    fail "Firma manual" "No pude apuntar el proyecto de Xcode al perfil ($got de $want configuraciones). Hay que revisar .github/ci/manual-signing.sh."
  fi

  {
    echo "SIGNING_KEYCHAIN=$KEYCHAIN"
    echo "SIGN_IDENTITY=$kind"
    echo "PROFILE_UUID=$uuid"
    echo "PROFILE_BUNDLE_ID=$bundle"
  } >> "${GITHUB_ENV:-/dev/null}"

  echo "Firma manual lista:"
  echo "  perfil «$(shown "$name")» (App Store Connect) para $bundle, vence ${expires%%T*}"
  echo "  certificado $kind del equipo, en un llavero temporal"
}

cleanup() {
  if [[ -f $KEYCHAIN ]]; then
    security delete-keychain "$KEYCHAIN" 2>/dev/null || rm -f "$KEYCHAIN"
    echo "Llavero temporal borrado."
  fi
  if [[ -f $INSTALLED ]]; then
    local path
    while IFS= read -r path; do [[ -z $path ]] || rm -f "$path"; done < "$INSTALLED"
    rm -f "$INSTALLED"
    echo "Perfil borrado."
  fi
}

case ${1:-} in
  install) install ;;
  cleanup) cleanup ;;
  *) echo "uso: $0 install|cleanup" >&2; exit 2 ;;
esac
