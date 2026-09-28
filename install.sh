#!/usr/bin/env bash
set -euo pipefail

APP=devin-pocket
MIN_NODE=22
LOCAL=${DEVIN_POCKET_LOCAL:-0}

say() { printf '%s\n' "$*"; }
err() { printf 'Error / Error: %s\n' "$*" >&2; exit 1; }
is_termux() { [[ -n "${TERMUX_VERSION:-}" || -d /data/data/com.termux ]]; }
has() { command -v "$1" >/dev/null 2>&1; }

node_major() { node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0'; }
install_node() {
  if is_termux; then
    has pkg || err 'pkg not found; install Termux from F-Droid.'
    say 'Installing Node.js LTS in Termux / Instalando Node.js LTS en Termux…'
    pkg install -y nodejs-lts
  elif [[ "$(uname -s)" == Darwin* ]]; then
    has brew || err 'Install Homebrew first / Instala Homebrew primero: https://brew.sh'
    brew install node@22 || brew upgrade node@22 || true
  elif has apt-get; then
    if ! has curl; then err 'curl is required / curl es necesario'; fi
    if [[ "$(id -u)" -eq 0 ]]; then apt-get update && apt-get install -y ca-certificates curl; else apt-get update && apt-get install -y ca-certificates curl; fi
    apt-get install -y nodejs || {
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
    }
  else
    err 'Install Node.js 22+ first / Instala Node.js 22+ primero: https://nodejs.org'
  fi
}

if ! has node || [[ "$(node_major)" -lt "$MIN_NODE" ]]; then install_node; fi
[[ "$(node_major)" -ge "$MIN_NODE" ]] || err "Node.js >=${MIN_NODE} required / Se requiere Node.js >=${MIN_NODE}"

if [[ "$LOCAL" == 1 ]]; then
  ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  npm install -g "$ROOT"
else
  npm install -g "$APP@latest"
fi

if ! has devin; then
  say 'Devin CLI not found / Devin CLI no encontrado.'
  say 'Install it / Instálalo: curl -fsSL https://cli.devin.ai/install.sh | bash'
fi

if is_termux; then
  if ! has termux-wake-lock || ! has termux-notification; then
    say 'Optional Termux:API / Termux:API opcional: pkg install termux-api'
  fi
  shortcut="$HOME/.shortcuts/Devin Pocket"
  if [[ -t 0 && -t 1 && -d "$HOME/.shortcuts" ]]; then
    read -r -p 'Create Termux:Widget launcher? / ¿Crear lanzador Termux:Widget? [y/N] ' answer || answer=''
    if [[ "$answer" =~ ^[Yy]$ ]]; then
      cat > "$shortcut" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
exec devin-pocket start --no-open
EOF
      chmod +x "$shortcut"
      say "Created / Creado: $shortcut"
    fi
  else
    say 'Termux:Widget launcher skipped / Lanzador Termux:Widget omitido (create ~/.shortcuts/Devin Pocket manually).'
  fi
fi

say ''
say '╭────────────────────────────────────────────╮'
say '│ Devin Pocket installed / instalado          │'
say '│ Start / Inicia: devin-pocket start          │'
say '╰────────────────────────────────────────────╯'
