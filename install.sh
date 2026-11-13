#!/usr/bin/env bash
# Devin Pocket installer — Termux, proot-distro (Ubuntu/Debian), Linux, macOS.
#   curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install.sh | bash
set -euo pipefail

APP=devin-pocket
MIN_NODE=24
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
  local target=$1 formula formula_major
  if is_termux_host; then
    # pkg cannot pin a Node major: use its available LTS for both install and upgrade.
    say 'Installing Node.js LTS in Termux / Instalando Node.js LTS en Termux…'
    pkg install -y nodejs-lts
  elif [[ "$(uname -s)" == Darwin* ]]; then
    has brew || err 'Install Homebrew first / Instala Homebrew primero: https://brew.sh'
    formula="node@$target"
    if ! brew info --formula "$formula" >/dev/null 2>&1; then
      # Active LTS may still be the unversioned formula (currently Node 26).
      formula_major=$(HOMEBREW_NO_COLOR=1 brew info --formula node | sed -n '1s/.*stable \([0-9][0-9]*\)\..*/\1/p')
      [[ "$formula_major" == "$target" ]] || err "Install Node.js $target manually / Instala Node.js $target manualmente: https://nodejs.org"
      formula=node
    fi
    say "Installing Node.js $target (Homebrew) / Instalando Node.js $target…"
    brew install "$formula"
    export PATH="$(brew --prefix "$formula")/bin:$PATH"
    say "Add to PATH / Añade al PATH: $(brew --prefix "$formula")/bin"
  elif has apt-get; then
    say "Installing Node.js $target (NodeSource) / Instalando Node.js $target…"
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl
    curl -fsSL "https://deb.nodesource.com/setup_${target}.x" | $SUDO bash -
    $SUDO apt-get install -y nodejs
  else
    err "Install Node.js $target first / Instala Node.js $target primero: https://nodejs.org"
  fi
}

major=$(node_major)
if [[ "$major" == 0 ]]; then install_node 26
elif [[ "$major" -lt "$MIN_NODE" ]]; then install_node 24
fi
[[ "$(node_major)" -ge "$MIN_NODE" ]] || err "Node.js >=${MIN_NODE} required / Se requiere Node.js >=${MIN_NODE}"
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
