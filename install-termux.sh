#!/usr/bin/env bash
set -euo pipefail

say() { printf '%s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

usage() {
  say 'Instalación completa de Devin Pocket desde Termux (sin clonar repositorios).'
  say 'Uso: bash install-termux.sh [--source REF | --package SPEC] [--distro NOMBRE] [--no-upgrade]'
  say '  Sin opciones: npm (versión estable publicada hace 7+ días), o código de main si no existe.'
  say '  --source REF     Compila una rama, tag o commit de BOTOOM/devin-pocket.'
  say '  --package SPEC   devin-pocket@VERSION, URL HTTPS de un .tgz o archivo .tgz local.'
  say '  --distro NOMBRE  Nombre de la distro Ubuntu/Debian instalada o a crear (por defecto: ubuntu).'
  say '  --no-upgrade     No actualiza paquetes generales; sí prepara los requisitos de Node.'
  say '  --help           Muestra esta ayuda, sin instalar nada.'
}

distro_install() (
  set -euo pipefail
  local mode=$1 spec=$2 upgrade=$3 fresh=$4 stage pidfile pid node_major node_target package_version ref pkg_name
  local -a required missing=()
  export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
  export DEBIAN_FRONTEND=noninteractive
  pidfile="${XDG_STATE_HOME:-$HOME/.local/state}/devin-pocket/server.pid"
  if [[ -f "$pidfile" ]]; then
    pid=$(cat "$pidfile")
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      err 'Devin Pocket está corriendo. Detén la app cuando sea seguro y repite la instalación.'
    fi
  fi
  [[ -r /etc/os-release ]] || err 'La distro no tiene /etc/os-release.'
  . /etc/os-release
  [[ "${ID:-}" == ubuntu || "${ID:-}" == debian ]] || err 'Este instalador necesita Ubuntu o Debian; la distro elegida es otra.'
  [[ $(id -u) == 0 ]] || err 'Entra a la distro como root (no requiere root en Android).'

  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')
  node_target=0
  if [[ "$node_major" == 0 ]]; then node_target=26
  elif [[ "$node_major" -lt 24 ]]; then node_target=24
  fi

  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  required=(ca-certificates curl git ripgrep jq python3 build-essential tar xz-utils unzip libatomic1 procps)
  for pkg_name in "${required[@]}"; do
    dpkg-query -W -f='${Status}' "$pkg_name" 2>/dev/null | grep -q 'install ok installed' \
      || missing+=("$pkg_name")
  done
  if (( ${#missing[@]} )) || [[ "$upgrade" == 1 && "$fresh" == 1 ]]; then
    say 'Preparando paquetes del sistema…'
    apt-get update
    if [[ "$upgrade" == 1 && "$fresh" == 1 ]]; then apt-get upgrade -y -o Dpkg::Options::=--force-confold; fi
    if (( ${#missing[@]} )); then apt-get install -y "${missing[@]}"; fi
  else
    say 'Los paquetes del sistema ya están instalados; se conservan sin cambios.'
  fi
  if [[ "$node_target" != 0 ]]; then
    say "Instalando Node.js $node_target LTS desde NodeSource…"
    curl --fail --show-error --location --retry 3 --proto '=https' --proto-redir '=https' \
      "https://deb.nodesource.com/setup_${node_target}.x" -o "$stage/node-setup.sh" &&
      bash "$stage/node-setup.sh" &&
      apt-get install -y nodejs || true
  fi
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')
  [[ "$node_major" -ge 22 ]] || err 'Se necesita Node.js 22 o posterior / Node.js 22 or later is required. Revisa los errores de NodeSource / Check the NodeSource errors: https://nodejs.org'
  if [[ "$node_major" -lt 24 ]]; then
    say 'Aviso: se continúa con Node.js 22/23 compatible. Actualiza manualmente a Node.js 24 LTS: curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs / Warning: continuing with supported Node.js 22/23. Upgrade manually to Node.js 24 LTS with that command.' >&2
  fi
  has npm || err 'Se necesita npm. Repara la instalación de Node.js y vuelve a intentarlo.'

  if ! has devin; then
    say 'Instalando Devin CLI con el instalador oficial…'
    curl --fail --show-error --location --retry 3 --proto '=https' --proto-redir '=https' \
      https://cli.devin.ai/install.sh -o "$stage/devin-setup.sh"
    bash "$stage/devin-setup.sh"
  fi
  devin --version

  if [[ "$mode" == auto ]]; then
    if npm view devin-pocket time --json >"$stage/npm-time.json" 2>"$stage/npm-error.log"; then
      package_version=$(node -e '
        const fs = require("node:fs");
        const times = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const versions = Object.keys(times).filter(v => /^\d+\.\d+\.\d+$/.test(v)
          && Date.parse(times[v]) <= Date.now() - 7 * 86400000);
        versions.sort((a, b) => {
          const x = a.split(".").map(Number), y = b.split(".").map(Number);
          return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
        });
        process.stdout.write(versions.at(-1) || "");
      ' "$stage/npm-time.json")
      [[ -n "$package_version" ]] || err 'Todavía no hay una versión npm estable con 7 días. Usa --source REF o --package devin-pocket@VERSION.'
      mode=package
      spec="devin-pocket@$package_version"
    elif grep -q 'E404' "$stage/npm-error.log"; then
      say 'Devin Pocket aún no está en npm; se compilará desde main sin git clone.'
      mode=source
      spec=main
    else
      err 'No se pudo consultar npm. Revisa la conexión o usa --source REF.'
    fi
  fi

  if [[ "$mode" == source ]]; then
    ref=$(node -p 'encodeURIComponent(process.argv[1])' "$spec")
    say "Descargando código de $spec sin clonar…"
    if ! curl --fail --show-error --location --retry 3 --proto '=https' --proto-redir '=https' \
      "https://api.github.com/repos/BOTOOM/devin-pocket/tarball/$ref" -o "$stage/source.tar.gz"; then
      err 'No se pudo descargar el código. --source requiere un repo público y una referencia existente. Para un repo privado usa --package con un .tgz descargado.'
    fi
    mkdir "$stage/source"
    tar -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/source"
    cd "$stage/source"
    [[ -f package.json && -f pnpm-lock.yaml ]] || err 'La referencia no contiene la app. Usa --source con la rama donde está Devin Pocket.'
    package_version=$(node -p 'require("./package.json").packageManager')
    [[ "$package_version" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]] || err 'El repositorio no declara una versión fija de pnpm.'
    npm install -g "$package_version"
    pnpm install --frozen-lockfile
    pnpm pack --pack-destination "$stage"
    set -- "$stage"/devin-pocket-*.tgz
    [[ $# == 1 && -f "$1" ]] || err 'No se generó un único paquete de Devin Pocket.'
    spec=$1
  elif [[ "$spec" == https://* ]]; then
    curl --fail --show-error --location --retry 3 --proto '=https' --proto-redir '=https' \
      "$spec" -o "$stage/devin-pocket.tgz"
    spec="$stage/devin-pocket.tgz"
  fi
  npm install -g "$spec"
  devin-pocket --version
  say 'Devin CLI y Devin Pocket instalados. El inicio de sesión se hace en el navegador de la app.'
)

write_launcher() {
  local target=$1 distro=$2 proot=$3
  if [[ -e "$target" || -L "$target" ]]; then
    say "Conservando el lanzador existente: $target"
    return
  fi
  (
    set -o noclobber
    {
      printf '#!%s/bin/bash\n' "$PREFIX"
      printf '# devin-pocket Termux/proot launcher\n'
      printf 'set -euo pipefail\n'
      printf 'case "${1:-start}" in start|restart) termux-wake-lock 2>/dev/null || true ;; esac\n'
      printf 'exec %q login %q -- /bin/bash -lc ' "$proot" "$distro"
      printf '%q ' 'export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; exec devin-pocket "$@"'
      printf 'devin-pocket "$@"\n'
    } >"$target"
  )
  chmod +x "$target"
}

distro_release_id() {
  local dir=$1 file line
  for file in "$dir/etc/os-release" "$dir/rootfs/etc/os-release"; do
    [[ -r "$file" ]] || continue
    line=$(grep -m1 '^ID=' "$file" 2>/dev/null) || continue
    line=${line#ID=}
    line=${line//\"/}
    [[ -n "$line" ]] && { printf '%s\n' "$line"; return 0; }
  done
  return 1
}

find_compatible_distro() {
  local runtime=$1 want base dir
  for want in ubuntu debian; do
    for base in "$runtime/installed-rootfs" "$runtime/containers"; do
      [[ -d "$base" ]] || continue
      for dir in "$base"/*/; do
        [[ -d "$dir" ]] || continue
        [[ "$(distro_release_id "${dir%/}")" == "$want" ]] || continue
        dir=${dir%/}
        printf '%s\n' "${dir##*/}"
        return 0
      done
    done
  done
  return 1
}

main() {
  local mode=auto spec='' distro=ubuntu distro_explicit=0 upgrade=1 fresh=0 local_package='' proot install_help runtime launch_command=devin-pocket found='' pkg_name
  local -a missing=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h) usage; return ;;
      --source|--package)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || err "Falta el valor de $1."
        [[ "$mode" == auto ]] || err 'Usa solo una de las opciones --source o --package.'
        mode=${1#--}; spec=$2; shift 2 ;;
      --distro)
        [[ $# -ge 2 && -n "$2" ]] || err 'Falta el nombre de la distro.'
        distro=$2; distro_explicit=1; shift 2 ;;
      --no-upgrade) upgrade=0; shift ;;
      *) err "Opción desconocida: $1. Usa --help." ;;
    esac
  done
  [[ "$distro" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ && "$distro" != . && "$distro" != .. ]] || err 'Nombre de distro no válido.'
  if [[ "$mode" == package ]]; then
    if [[ -f "$spec" && "$spec" == *.tgz ]]; then
      local_package=$(realpath -- "$spec")
      [[ "$local_package" != *:* ]] || err 'El nombre del archivo no puede contener dos puntos.'
      spec=/tmp/devin-pocket-package.tgz
    elif [[ ! "$spec" =~ ^devin-pocket@[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ && "$spec" != https://* ]]; then
      err '--package necesita devin-pocket@VERSION, una URL HTTPS o un .tgz local existente.'
    fi
  fi
  [[ -n "${TERMUX_VERSION:-${TERMUX_APP__APP_VERSION_NAME:-}}" && -n "${PREFIX:-}" ]] && has pkg \
    || err 'Ejecuta este script en Termux, no dentro de Ubuntu/proot ni en un PC.'
  [[ $(id -u) != 0 ]] || err 'Ejecuta desde Termux normal, no desde Ubuntu/proot ni como root.'
  case $(uname -m) in
    aarch64|x86_64) ;;
    *) err 'Devin CLI necesita ARM64 o x86_64. Este dispositivo usa otra arquitectura.' ;;
  esac
  say 'Preparando Termux → proot → Node.js → Devin CLI → Devin Pocket…'
  for pkg_name in curl proot-distro; do
    dpkg-query -W -f='${Status}' "$pkg_name" 2>/dev/null | grep -q 'install ok installed' \
      || missing+=("$pkg_name")
  done
  if (( ${#missing[@]} )); then
    pkg update -y
    if [[ "$upgrade" == 1 ]]; then pkg upgrade -y -o Dpkg::Options::=--force-confold; fi
    pkg install -y "${missing[@]}"
  else
    say 'curl y proot-distro ya están instalados en Termux; no se reinstalan.'
  fi
  has proot-distro || err 'proot-distro no está disponible. Instálalo con: pkg install proot-distro'
  proot=$(command -v proot-distro)
  runtime="${TERMUX__PREFIX:-$PREFIX}/var/lib/proot-distro"
  if [[ -d "$runtime/installed-rootfs/$distro" || -d "$runtime/containers/$distro" ]]; then
    say "Reutilizando la distro '$distro' ya instalada; no se descarga ni se reinstala."
  elif [[ "$distro_explicit" == 0 ]] && found=$(find_compatible_distro "$runtime") && [[ -n "$found" ]]; then
    distro=$found
    say "Reutilizando la distro compatible '$distro' ya instalada; no se descarga otra."
  else
    fresh=1
    install_help=$(proot-distro install --help)
    if [[ "$install_help" == *--name* ]]; then
      proot-distro install --override-alias "$distro" ubuntu:24.04
    else
      proot-distro install --override-alias "$distro" ubuntu
    fi
  fi
  local -a login=("$proot" login "$distro")
  if [[ -n "$local_package" ]]; then login+=(--bind "$local_package:$spec"); fi
  {
    printf 'set -euo pipefail\n'
    declare -f say err has distro_install
    printf 'distro_install "$@"\n'
  } | "${login[@]}" -- /bin/bash -ls -- "$mode" "$spec" "$upgrade" "$fresh"

  write_launcher "$PREFIX/bin/devin-pocket-ubuntu" "$distro" "$proot"
  if [[ -e "$PREFIX/bin/devin-pocket" || -L "$PREFIX/bin/devin-pocket" ]] \
    && ! grep -Fxq '# devin-pocket Termux/proot launcher' "$PREFIX/bin/devin-pocket" 2>/dev/null; then
    say "Conservando $PREFIX/bin/devin-pocket: no es uno de nuestros lanzadores. devin-pocket-ubuntu sigue funcionando."
    launch_command=devin-pocket-ubuntu
  else
    write_launcher "$PREFIX/bin/devin-pocket" "$distro" "$proot"
  fi
  mkdir -p "$HOME/.shortcuts"
  write_launcher "$HOME/.shortcuts/Devin Pocket" "$distro" "$proot"
  say ''
  say "Listo. Para abrir la app desde Termux: $launch_command"
  say 'En el navegador: http://127.0.0.1:7777'
  say "Para ver el diagnóstico: $launch_command doctor"
  say 'Pulsa «Inicia sesión en Devin» en la app; el instalador no pide ni guarda contraseñas.'
  say 'Termux:Widget es opcional para el acceso directo. Instálalo desde la misma fuente que Termux.'
  say 'Desactiva la optimización de batería para Termux. No se inicia ni se reinicia la app automáticamente.'
}

main "$@"
