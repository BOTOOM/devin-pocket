#!/usr/bin/env bash
# Devin Pocket installer — Termux, proot-distro (Ubuntu/Debian), Linux, macOS.
#   curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install.sh | bash
set -euo pipefail

APP=devin-pocket
MIN_NODE=22
LOCAL=${DEVIN_POCKET_LOCAL:-0}

say() { printf '%s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

# Termux proper has `pkg`; inside proot-distro the Termux dir is still visible but `pkg` is not.
is_termux_host() { [[ -n "${TERMUX_VERSION:-}" ]] && has pkg; }
is_proot() { [[ -d /data/data/com.termux || -n "${TERMUX_VERSION:-}" ]] && ! has pkg; }

SUDO=''
if [[ "$(id -u)" -ne 0 ]] && ! is_termux_host && has sudo; then SUDO=sudo; fi

node_major() { node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0'; }

install_node() {
  local target=$1 formula formula_major formula_prefix
  if is_termux_host; then
    # pkg cannot pin a Node major: use its available LTS for both install and upgrade.
    say 'Installing Node.js LTS in Termux / Instalando Node.js LTS en Termux…'
    pkg install -y nodejs-lts || return 1
  elif [[ "$(uname -s)" == Darwin* ]]; then
    has brew || return 1
    formula="node@$target"
    if ! brew info --formula "$formula" >/dev/null 2>&1; then
      # Active LTS may still be the unversioned formula (currently Node 26).
      formula_major=$(HOMEBREW_NO_COLOR=1 brew info --formula node | sed -n '1s/.*stable \([0-9][0-9]*\)\..*/\1/p') || return 1
      [[ "$formula_major" == "$target" ]] || return 1
      formula=node
    fi
    say "Installing Node.js $target (Homebrew) / Instalando Node.js $target…"
    brew install "$formula" || return 1
    formula_prefix=$(brew --prefix "$formula") || return 1
    export PATH="$formula_prefix/bin:$PATH"
    say "Add to PATH / Añade al PATH: $formula_prefix/bin"
  elif has apt-get; then
    say "Installing Node.js $target (NodeSource) / Instalando Node.js $target…"
    $SUDO apt-get update || return 1
    $SUDO apt-get install -y ca-certificates curl || return 1
    curl -fsSL "https://deb.nodesource.com/setup_${target}.x" | $SUDO bash - || return 1
    $SUDO apt-get install -y nodejs || return 1
  else
    return 1
  fi
}

major=$(node_major)
target=0
if [[ "$major" == 0 ]]; then target=26
elif [[ "$major" -lt 24 ]]; then target=24
fi
if [[ "$target" != 0 ]]; then install_node "$target" || true; fi
major=$(node_major)
[[ "$major" -ge "$MIN_NODE" ]] || err "Node.js >=${MIN_NODE} required / Se requiere Node.js >=${MIN_NODE}. Install Node.js $target manually / Instala Node.js $target manualmente: https://nodejs.org"
if [[ "$major" -lt 24 ]]; then
  say 'Warning: continuing with supported Node.js 22/23. Upgrade manually to Node.js 24 LTS with your package manager or https://nodejs.org / Aviso: se continúa con Node.js 22/23 compatible. Actualiza manualmente a Node.js 24 LTS con tu gestor de paquetes o https://nodejs.org' >&2
fi
has npm || err 'npm is required / Se necesita npm. Repair your Node.js installation / Repara la instalación de Node.js.'

NPM_G=(npm install -g)
# Global npm dir usually needs root outside Termux; fall back to sudo only if not writable.
if [[ -n "$SUDO" && ! -w "$(npm prefix -g)/lib" ]]; then NPM_G=("$SUDO" npm install -g); fi

install_global() {
  # Prefer pnpm global when present; fall back to npm on any failure
  # (e.g. pnpm setup never run → PNPM_HOME/bin missing).
  if has pnpm && pnpm add -g "$1"; then return 0; fi
  "${NPM_G[@]}" "$1"
}

if [[ "$LOCAL" == 1 ]]; then
  ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  install_global "$ROOT"
else
  install_global "$APP@latest"
fi

if ! has devin; then
  say ''
  say 'Devin CLI not found / Devin CLI no encontrado.'
  say 'Install it / Instálalo:  curl -fsSL https://cli.devin.ai/install.sh | bash'
fi

if is_termux_host; then
  if ! has termux-wake-lock; then
    say 'Optional / Opcional: pkg install termux-api  (wake-lock, notifications)'
  fi
  shortcut="$HOME/.shortcuts/Devin Pocket"
  answer=''
  if [[ -d "$HOME/.shortcuts" && -e /dev/tty ]]; then
    read -r -p 'Create Termux:Widget launcher? / ¿Crear lanzador Termux:Widget? [y/N] ' answer </dev/tty || answer=''
  fi
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    cat >"$shortcut" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
exec devin-pocket start
EOF
    chmod +x "$shortcut"
    say "Created / Creado: $shortcut"
  fi
elif is_proot; then
  say ''
  say 'proot-distro detected. To launch from a Termux:Widget, create in Termux (not here):'
  say 'proot-distro detectado. Para lanzar desde Termux:Widget, crea en Termux (no aquí):'
  say '  ~/.shortcuts/Devin Pocket  with / con:'
  say '    termux-wake-lock; proot-distro login ubuntu -- devin-pocket start'
fi

say ''
say '╭──────────────────────────────────────────────╮'
say '│  Devin Pocket installed / instalado          │'
say '│  Start / Inicia:  devin-pocket start         │'
say '╰──────────────────────────────────────────────╯'
