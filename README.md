# Devin Pocket

[English](https://github.com/BOTOOM/devin-pocket/blob/main/README.md) · [Español](https://github.com/BOTOOM/devin-pocket/blob/main/README.es.md)

[Website](https://devin-pocket.edwardiaz.dev) · [Install guides](https://devin-pocket.edwardiaz.dev/#install) · [npm](https://www.npmjs.com/package/devin-pocket)

A mobile-first browser UI for Devin CLI over ACP, on Android/Termux, Linux and macOS.

[![npm version](https://img.shields.io/npm/v/devin-pocket)](https://www.npmjs.com/package/devin-pocket)
[![npm downloads](https://img.shields.io/npm/dm/devin-pocket)](https://www.npmjs.com/package/devin-pocket)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/BOTOOM/devin-pocket/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/BOTOOM/devin-pocket/ci.yml?branch=main&label=CI)](https://github.com/BOTOOM/devin-pocket/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-green)](https://nodejs.org/)

**Unofficial community project. Not affiliated with Cognition.**

## What it is and features

One local Node.js process serves a React PWA over HTTP/WebSocket and manages a
`devin acp` child over stdio using Agent Client Protocol. After installation,
everyday interaction happens in the browser, not a terminal. The host and CLI
must remain running; the PWA is not an offline agent.

- Create, list, search, resume, rename and close sessions; workspace selection.
- Streaming Markdown, tools/code/diffs, permission requests and task plans.
- Queued messages, cancellation and capability-dependent send-now steering.
- Model, reasoning and Fast controls when exposed by the agent; price comparison.
- File mentions, image attachments and an agent command palette.
- Light/dark/system themes, Spanish and English UI (Spanish by default).
- Diagnostics, logs, model/pricing reports and an installable PWA shell.

Features depend on CLI/model capabilities. Prices come from authenticated
`devin models list --format json`; missing prices are not invented. Session
history comes from ACP, not a separate Pocket database.

## Requirements

- Node.js **22+** for the installed app, npm or pnpm, and a modern browser.
- [Devin CLI](https://cli.devin.ai/) and a Devin account authorized in the app or
  with `devin auth login`. No separate Pocket account or API key.
- Linux/macOS; Android uses Termux with Ubuntu/proot for the glibc CLI.
  The Android installer accepts **ARM64 or x86_64**, not 32-bit devices.
- Internet access for installation, authentication and agent operation.
- Optional Termux:API plus the `termux-api` package for wake lock.

## Installation

### npm, npx or pnpm

```sh
npx devin-pocket
# Or install globally:
npm i -g devin-pocket
# Or:
pnpm add -g devin-pocket
```

For pnpm global-bin/PATH errors, run `pnpm setup`, then open a new shell or load
its environment changes. In proot, `~/.profile` may not be sourced: ensure the
global bin directory is on PATH. npm global installs need a writable prefix.

### General installer

Platform guides: [Linux](https://devin-pocket.edwardiaz.dev/docs/linux) ·
[macOS](https://devin-pocket.edwardiaz.dev/docs/macos).

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install.sh | bash
```

Review scripts before executing them. Supports Linux, macOS, Termux and proot;
installs Node.js if needed (macOS needs Homebrew already installed), prefers pnpm
and falls back to npm. It only prints installation instructions if Devin CLI is
missing; it does **not** install Devin CLI or start Pocket. For complete Android
setup, use the next installer.

### Android/Termux from scratch, without cloning

See the [Android/Termux installation guide](https://devin-pocket.edwardiaz.dev/docs/android-termux)
for the complete walkthrough.

1. Install **Termux** from [official GitHub releases](https://github.com/termux/termux-app/releases).
   Use Android 7+ and ARM64/x86_64. Optional Termux:Widget and Termux:API APKs must
   come from the same source; do not mix GitHub and F-Droid signatures. Installing
   APKs and authorizing your account are manual steps.
2. In **normal Termux**, not Ubuntu/proot, run:

   ```sh
   pkg update -y && pkg install -y curl && \
     curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh | bash
   ```

   Updates Termux, installs `proot-distro`, creates Ubuntu (24.04 with the newer
   proot-distro interface) or reuses it, updates Ubuntu, installs Node.js 22+ and
   build tools, and installs the official Devin CLI if missing. It chooses the
   highest stable npm version at least **seven days old**. Only npm E404 falls
   back to building a `main` source archive. If the package exists but no version
   is old enough, it stops: select `--source` or `--package` explicitly.

   Source builds use the lockfile and supply-chain rules and need more time,
   memory/storage and downloads. No `git clone`, Ubuntu deletion or automatic
   Pocket start/restart. Existing launchers are preserved. If Pocket is running
   in the selected Ubuntu, stop it when safe before retrying. The installer does
   not request/store passwords or API keys; authorization happens later.
3. Start from Termux and open `http://127.0.0.1:7777`:

   ```sh
   devin-pocket-ubuntu
   devin-pocket-ubuntu doctor
   devin-pocket-ubuntu logs
   ```

   The launcher enters Ubuntu with the required PATH. Tap **Inicia sesión en
   Devin** / **Sign in to Devin**.

Download the script to pass installer options:

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh -o install-termux.sh
bash install-termux.sh --help
bash install-termux.sh --source main
bash install-termux.sh --package devin-pocket@0.2.0
bash install-termux.sh --package "$HOME/devin-pocket-0.2.0.tgz"
bash install-termux.sh --source main --distro ubuntu --no-upgrade
```

| Option | Meaning |
| --- | --- |
| `--source REF` | Build a public branch, tag or commit of BOTOOM/devin-pocket. |
| `--package SPEC` | Exact `devin-pocket@VERSION`, HTTPS tarball URL or existing local `.tgz`. |
| `--distro NAME` | Ubuntu name to create/reuse; default `ubuntu`; must be Ubuntu. |
| `--no-upgrade` | Skip general upgrades, still install prerequisites. |
| `--help`, `-h` | Help without installing. |

`--source` and `--package` are mutually exclusive. For a branch-specific installer,
download the script from that branch as well as passing it to `--source`.

### From source or a local tarball

Use a current Node.js 24 release for development/release tools; the packaged app
supports Node.js 22+. Enable Corepack if available or install the pinned pnpm:

```sh
git clone https://github.com/BOTOOM/devin-pocket.git
cd devin-pocket
npm i -g pnpm@12.6.0
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
npm install -g ./devin-pocket-*.tgz
devin-pocket doctor
devin-pocket start
```

Use npm for the tarball's global link: `pnpm add -g <tgz>` has been a silent no-op
in some proot environments. An existing tarball works with
`npm install -g /path/to/devin-pocket-VERSION.tgz`. From a built checkout,
`DEVIN_POCKET_LOCAL=1 bash install.sh` installs the directory containing the
script, **not** an arbitrary local tarball.

## Quick start and first login

```sh
devin-pocket start
# Open http://127.0.0.1:7777 if the browser does not open.
```

No command also means start. Normal start runs a background supervisor that
retries crashes with backoff (not indefinitely). Tap **Inicia sesión en Devin** /
**Sign in to Devin** in the PWA and authorize your account in the browser. If
needed, run `devin auth login` on the server host. Select a workspace/session and
send a prompt. Install the PWA through your browser when supported; the host must
remain running.

## CLI reference

| Command | Behavior |
| --- | --- |
| `start` (default) | Start supervisor and open browser. |
| `stop` | Stop the process tracked by the pidfile. |
| `restart` | Stop it, then start a new supervisor using supplied options. |
| `status` | Report whether the tracked process is running. |
| `logs` | Print the last 100 application log entries by default. |
| `doctor` | Check runtime, CLI/auth/ACP, paths, ports and permissions. |
| `models` | Refresh and print model/pricing diagnostics. |
| `open` | Open `http://127.0.0.1:PORT`, even with a custom host. |
| `version` | Print installed package version. |
| `help` | Show usage. |

| Flag | Use/default |
| --- | --- |
| `--port N` | Server port: config or `7777`; also doctor/open. |
| `--host H` | Listen address: config or `127.0.0.1`; also doctor. |
| `--cwd DIR` | ACP working directory: current directory by default. |
| `--agent CMD` | Agent command: overrides env/config; default `devin acp`. |
| `--no-open` | Do not open browser on start. |
| `--foreground` | Run start in foreground instead of daemonizing. |
| `--dev` | Foreground development start, no automatic browser. |
| `-f`, `--follow` | Follow application logs (`logs`). |
| `-n N` | Log entry count (`logs`), default `100`. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Print version. |

Start options apply to `start`/`restart` where relevant. Restart creates a
supervisor, not an earlier foreground mode, and does not remember earlier flags.

```sh
devin-pocket start --cwd "$HOME/project" --port 7778 --no-open
devin-pocket logs -f -n 50
devin-pocket stop
```

## Per-session working folder

**New session** opens a folder picker before any ACP session or message is created.
Choose a saved folder or browse, review its full path, then select **Start session**.
**Cancel** creates nothing. The chosen folder belongs to that session; changing the
choice for a later session does not move existing sessions. The chat header shows
the session's folder (hover for the full path).

Your browser remembers recent folders and preselects the last one you used. Without
a previous choice, `devin-pocket start --cwd /absolute/path` sets the **suggested
default**, not a global session folder; otherwise the server's launch directory is
suggested. Folders must exist and be inside the server user's home directory or a
workspace listed in `config.json`. Paths and allowed roots are resolved through
symlinks before validation; a symlink cannot escape those allowed roots.

## Configuration and environment

Optional config: `$XDG_CONFIG_HOME/devin-pocket/config.json`, default
`~/.config/devin-pocket/config.json`. Missing/invalid config falls back to defaults.

```json
{
  "port": 7777,
  "host": "127.0.0.1",
  "agentCommand": "devin acp",
  "workspaces": [],
  "theme": "system",
  "showThoughts": false,
  "lang": "es"
}
```

Workspace entries have `path`, `name` and optional numeric `lastUsedAt`. The
schema accepts `theme`, `showThoughts` and `lang`, but UI preferences are managed
in browser storage; do not rely on those config fields to set the UI.

| Variable | Purpose |
| --- | --- |
| `DEVIN_POCKET_AGENT` | Agent command: `--agent` takes precedence, then env, then config. |
| `DEVIN_POCKET_VERBOSE=1` | Also write application logs to stderr. |
| `XDG_CONFIG_HOME` | Config base; default `~/.config`. |
| `XDG_STATE_HOME` | State base; default `~/.local/state`. |
| `XDG_CACHE_HOME` | Cache base; default `~/.cache`. |
| `DEVIN_POCKET_MODELS_FILE` | Development: catalog JSON fixture instead of CLI. |
| `DEVIN_POCKET_LOCAL=1` | General installer: install its own source directory. |

State is in the `devin-pocket` subdirectory: `server.pid`, `titles.json` (rename
fallback), `devin-pocket.log`, `devin-acp.stderr.log`, `daemon.out.log`. Model cache:
`$XDG_CACHE_HOME/devin-pocket/models.json`, default `~/.cache/devin-pocket/models.json`,
fresh for 24 hours. `DEVIN_POCKET_SUPERVISOR` and `DEVIN_POCKET_DAEMON` are internal
process markers, not user settings; Termux/proot also uses platform detection markers.

## Termux tips

- Wake lock is best effort via `termux-wake-lock`; install Termux:API and run
  `pkg install termux-api` in Termux if needed.
- The zero-clone installer creates `~/.shortcuts/Devin Pocket` for optional
  Termux:Widget; existing shortcuts/launchers are not overwritten.
- The general installer offers a direct shortcut only if the shortcuts directory
  exists; in proot it prints instructions instead.
- Disable battery optimization for Termux and Termux:API. Android can still kill
  processes under memory pressure. Termux:Boot can run your launcher if separately
  configured; the installer does not configure boot startup.

## Security and remote access

Default binding: **127.0.0.1:7777**. Devin login authenticates the agent,
**not Pocket clients**. There is no built-in client authentication, pairing or TLS.
`--host 0.0.0.0` exposes the app and agent capabilities to the network; origin
checks are not authentication. Do not expose it to the public internet. If you
deliberately need remote access, use an access-controlled tunnel/proxy. Non-local
HTTP may also lose secure-context/PWA browser features. Review permissions and
reports/logs before sharing: they can contain paths and project information.

## Troubleshooting and FAQ

```sh
devin-pocket doctor
devin-pocket logs -n 100
devin-pocket models
```

**Diagnostics / Diagnóstico** includes checks, logs and a downloadable JSON
report. Model diagnostics show command, source, errors and CLI output. Inspect
reports for sensitive information before attaching them to issues.

- **CLI missing/login blocked?** Install CLI on the host; try `devin auth login`.
- **Port busy?** Stop the existing instance or start with `--port 7778`.
- **Missing prices?** Check authentication and `models`; some models lack prices
  and cached prices can be stale.
- **Missing sessions?** Listings depend on ACP/workspace scope, not a local database.
- **Fast/reasoning/images?** Depend on agent/model capabilities. Images are limited
  to 1.5 MB each; encoded messages also face the server's 2 MiB WebSocket limit.
- **No seven-day-old npm release?** Choose `--source main` or explicit
  `--package devin-pocket@VERSION`; npm/npx direct installs do not apply that filter.
- **Offline or a Devin replacement?** No: Pocket is a Devin CLI client.
- **Windows?** Native Windows is not a documented supported installer target.

## Updating

```sh
devin-pocket update --check
devin-pocket update
devin-pocket update --version 0.5.0 --yes
```

`--check` only reports the installed/latest versions (exit 0 even when an update is
available). Updating detects npm/pnpm global installations and asks for confirmation;
`--yes` skips the prompt. It stops a running Pocket daemon, installs the target version,
then starts it with its recorded launch options, or defaults for older installations.
If installation fails it still attempts to restart the previous version. It never
updates Devin CLI; use that CLI's own installer. Current or newer versions are left alone.

Source checkouts, npx and unknown installations are not modified: rerun your original
installer or rebuild/reinstall the source package. On automated Termux installs, run
`devin-pocket-ubuntu update --check` / `devin-pocket-ubuntu update` from normal Termux.
Alternatively, stop Pocket safely and rerun `install-termux.sh`; its seven-day release
filter still applies, unlike the update command's npm `latest` target.

The server checks for Pocket releases at startup and every 24 hours, caching results in
`~/.cache/devin-pocket/update.json` (or `$XDG_CACHE_HOME/devin-pocket/update.json`).
Settings and Diagnostics show a dismissible notice. Failures are logged without blocking
the app; `DEVIN_POCKET_NO_UPDATE_CHECK=1` disables background checks. Registry requests
honor `npm_config_registry` / `NPM_CONFIG_REGISTRY` and time out after five seconds.

## Roadmap and limitations

Desktop/laptop remote-client workflows are planned. Currently this is a
mobile-first UI served by the local host. Authenticated pairing/remote access
and large-list/transcript virtualization remain work to do. Edited permission
commands are currently displayed read-only; agent-dependent capabilities vary.

## Development

Use the pinned pnpm and a current Node.js 24 release.

```sh
pnpm install --frozen-lockfile
pnpm run dev
# Or server + fake agent without Devin login:
pnpm run dev:fake
pnpm run check
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:e2e
```

`dev` runs Vite on 5173 plus the server. `src/server` owns HTTP/WS and ACP,
`src/shared` the protocol/reducer, `src/web` the React PWA. Rebuild before using
`bin/devin-pocket.mjs`, which loads `dist/server.mjs`.
See [AGENTS.md](https://github.com/BOTOOM/devin-pocket/blob/main/AGENTS.md).

## Contributing

Open [issues](https://github.com/BOTOOM/devin-pocket/issues) with reproduction
steps and sanitized diagnostics; focused PRs are welcome. Keep both READMEs in
sync, use conventional commits and run the checks above. `docs(readme)` triggers
a patch release through semantic-release on main; never hand-edit versions/push tags.
CI commits use `ci:` / `ci(release):` and never release; CI/build/test types and
ci/actions/workflows/release scopes are excluded, including breaking changes.

## License and attribution

Apache License 2.0. See [LICENSE](https://github.com/BOTOOM/devin-pocket/blob/main/LICENSE)
and [NOTICE](https://github.com/BOTOOM/devin-pocket/blob/main/NOTICE). Portions were
ported from **devin-tui**, copyright Mark Fenner, under MIT.
