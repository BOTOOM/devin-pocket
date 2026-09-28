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
  if is_termux_host; then
    say 'Installing Node.js LTS in Termux / Instalando Node.js LTS en Termux…'
    pkg install -y nodejs-lts
  elif [[ "$(uname -s)" == Darwin* ]]; then
    has brew || err 'Install Homebrew first / Instala Homebrew primero: https://brew.sh'
    brew install node@22 || brew upgrade node@22 || true
  elif has apt-get; then
    say 'Installing Node.js 22 (NodeSource) / Instalando Node.js 22…'
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
  else
    err 'Install Node.js 22+ first / Instala Node.js 22+ primero: https://nodejs.org'
  fi
}

if ! has node || [[ "$(node_major)" -lt "$MIN_NODE" ]]; then install_node; fi
[[ "$(node_major)" -ge "$MIN_NODE" ]] || err "Node.js >=${MIN_NODE} required / Se requiere Node.js >=${MIN_NODE}"

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
