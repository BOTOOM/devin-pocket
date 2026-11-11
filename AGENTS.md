# AGENTS.md — devin-pocket handoff

Guidance for developer agents working on this repo. Read this before making changes.

## Purpose & product rules

- **devin-pocket** is a mobile-first PWA that drives the Devin CLI (`devin acp`) over the
  Agent Client Protocol. One local Node.js process serves the web app and owns one ACP
  child process — no TUI, no second server.
- Target users are non-technical and on Android/Termux. UI must be usable one-handed on
  a ~390px phone screen. No terminal knowledge assumed inside the app.
- **Spanish-first**: `src/web/i18n.ts` `es` is the default dict; `en` mirrors every key
  (`Record<keyof typeof es, string>` — a missing en key is a type error).
- **No product login**: authentication is the Devin account itself, via the ACP
  `authenticate` method (browser PKCE, `devin-browser` method). Never add API keys or a
  devin-pocket account.
- License: **Apache-2.0** (`LICENSE`, `package.json`) with `NOTICE` attribution —
  portions ported from devin-tui (Mark Fenner, MIT). Keep `NOTICE` accurate.

## Architecture

```
devin acp child (stdio JSON-RPC)
  → src/server/acp/agent.ts      AgentProcess: spawn, JSON-RPC via @agentclientprotocol/sdk,
                                 status machine, turn_stats, permission bridge
  → src/server/acp/normalize.ts  ACP SessionUpdate → SessionEvent
  → src/server/sessions.ts       SessionManager: open sessions, permissions, session list
  → src/server/http.ts           PocketServer: HTTP static + /api/* + /ws WebSocket
  ↔ src/shared/protocol.ts       wire types (ClientCommand / ServerMessage / CatalogState)
  ↔ src/shared/reducer.ts        pure applyEvent() SessionState reducer (shared client+server)
  → src/web/*                    React 19 PWA (Vite build → dist/web/)
```

- **Model catalog** (`src/server/catalog.ts`) comes from
  `devin models list --format json` — **not** from ACP. Results are cached on disk
  (`~/.cache/devin-pocket/models.json`) for 24h; a fresh cache wins unless
  `catalog.refresh` or the daily `setInterval` in cli.ts fires. Stale cache is the
  fallback on CLI failure. Every load produces a `CatalogDebug` (command, exitCode,
  stderr/stdout heads, parseError, source: `cli|cache|fixture|none`) attached to
  `CatalogState` — inspect it in Diagnostics or via `devin-pocket models`.
  Parsing tolerates `families[]`, top-level arrays, and `{models|variants:[...]}`;
  unknown shapes set `parseError` — **never fabricate prices**.
- **Option↔catalog matching** goes through `src/shared/catalog-match.ts` `matchEntry()`
  (uid exact → uid case-insensitive → label → normalized). Do not re-add ad-hoc
  lowercase-label joins.
- **Supervisor**: `devin-pocket start` daemonizes via a supervisor process
  (`DEVIN_POCKET_SUPERVISOR=1`) that owns the pidfile and respawns the real server
  (`DEVIN_POCKET_DAEMON=1`, `--foreground`) with 1s→30s backoff, reset after 60s uptime,
  give-up after 10 fast crashes. `termux-wake-lock` is spawned best-effort.
- **No local session storage (product rule)**: session lists come only from ACP
  `session/list` — one cwd-less global call plus per-workspace queries, merged/deduped.
  Only `titles.json` (local rename fallback) is persisted, not sessions.
- **Paths**: `src/server/paths.ts` — XDG dirs; state (logs, pidfile, titles) in
  `$XDG_STATE_HOME/devin-pocket` (default `~/.local/state/devin-pocket`), config in
  `~/.config/devin-pocket/config.json`, model cache in `~/.cache/devin-pocket`.

## Repo map

- `bin/devin-pocket.mjs` — CLI entry (runs `dist/server.mjs`; **rebuild after edits**).
- `src/server/cli.ts` — arg dispatch, supervisor, daemonize, runServer, help, `models`.
- `src/server/args.ts` — `parseArgs`/`serializeArgs` (roundtrip-tested).
- `src/server/http.ts` — WS envelope (zod-validated), origin check, `maxPayload` 2MB,
  `/api/health` `/api/doctor` `/api/fs`, static file guard.
- `src/server/acp/agent.ts` — AgentProcess (see ACP facts below).
- `src/server/acp/normalize.ts` — ACP updates → `SessionEvent`s (tool calls, plan,
  thoughts, usage, commands, config options).
- `src/server/sessions.ts` — SessionManager (list/create/open/close/delete/rename/
  prompt/cancel/setMode/setConfigOption, pending permissions).
- `src/server/catalog.ts` — model catalog fetch/parse/cache/debug.
- `src/server/doctor.ts`, `ports.ts`, `fs-search.ts`, `log.ts`, `paths.ts` — diagnostics,
  port checks, workspace search, ring-buffer logger, XDG/config paths.
- `src/shared/protocol.ts` — all wire types; `reducer.ts` — `applyEvent`,
  `initialSessionState`, `pickModelOptions`, `selectOptions`; `catalog-match.ts` —
  `matchEntry`; `cost.ts` — usage/cost math.
- `src/web/` — `app.tsx` routes; `store.ts` zustand store; `lib/ws.ts` WS client;
  `lib/router.ts` hash router (`navigate()` takes paths like `'settings'` → `#/settings`);
  `components/` — Home, Chat, Transcript, ToolCard, Composer, StatusStrip, ModelSheet
  (compare panel + Fast switch), PermissionSheet, PlanPanel, CommandPalette,
  Diagnostics (incl. Models & pricing card), Settings, AgentGate; `components/ui/` —
  shadcn primitives.
- `test/` — vitest; `fake-agent.ts` simulates `devin acp` (`FAKE_AGENT_AUTHED=1`,
  `FAKE_AGENT_FAST=1`); `server.test.ts` boots a real server+fake agent over WS.
- `e2e/smoke.spec.ts` — Playwright, Pixel 7 profile, port 7789.
- `install.sh`, `scripts/shots.mjs`, `.github/workflows/{ci,release}.yml`.

## Conventions

- **pnpm only** (`packageManager: pnpm@12.6.0`, `engine-strict`). `pnpm-workspace.yaml`
  sets `minimumReleaseAge: 10080` (7-day supply-chain guard — do NOT loosen; add to
  `minimumReleaseAgeExclude` per-package if a fresh pin is needed) and `allowBuilds`
  for esbuild/biome/oxide.
- **Biome** for lint+format (`pnpm run check` → `biome check`); strict TS, no `any`.
- UI: Tailwind v4 + shadcn (`components/ui`), `lucide-react` icons, `sonner` toasts.
  All user-facing strings via `t('key')` — add keys to **both** `es` and `en` in i18n.ts.
- Mobile CSS: prefer `min-w-0`, `break-all`/`break-words`, `items-start`, safe-area
  paddings; avoid fixed heights/widths on text rows.
- Tests: `vitest` for unit/integration (reuse the fake agent; don't hit real `devin`
  in tests — `DEVIN_POCKET_MODELS_FILE` fixture for catalog). Playwright for e2e.
- Comments: terse, only where non-obvious; match surrounding style.

## Commands

```sh
pnpm install          # deps
pnpm run dev          # vite dev :5173 + tsx server
pnpm run dev:fake     # server + fake agent, no login needed
pnpm run check        # biome lint/format
pnpm run typecheck    # tsc both tsconfigs
pnpm test             # vitest
pnpm run build        # tsdown server + vite web → dist/
pnpm run test:e2e     # playwright (builds first)

# install from source (global):
pnpm pack && npm install -g ./devin-pocket-*.tgz
# NOTE: `pnpm add -g <tgz>` was a silent no-op on the user's Termux proot —
# use npm for the global link there.

# runtime:
devin-pocket start [--port N] [--host H] [--cwd DIR] [--agent CMD] [--no-open]
devin-pocket stop | restart | status | logs [-f] [-n N] | doctor | models | open
```

## Termux / proot notes

- Devin CLI runs inside Ubuntu/Debian proot (`proot-distro`); the app detects Termux
  and calls `termux-wake-lock` (needs Termux:API). Termux:Boot/Termux:Widget can
  auto-start `devin-pocket`.
- `pnpm add -g` needs `pnpm setup` once so `PNPM_HOME/bin` is on PATH
  (`ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH` otherwise). `~/.profile` is NOT sourced in
  proot shells — set PATH explicitly.
- The box `devin` binary may exist but be **not logged in** — `devin-pocket models`
  will show `stderr: Not logged in` (that output working is the point).

## ACP facts we rely on

Client→agent methods (via `@agentclientprotocol/sdk` `ClientSideConnection`):
`initialize`, `authenticate({methodId})`, `newSession({cwd, mcpServers:[]})`,
`loadSession`, `listSessions({cwd?})` — cwd may be omitted for a global list,
`deleteSession`, `prompt`, `cancel`, `setSessionMode`, `setSessionConfigOption`.

Agent→client: `session/update` notifications, `session/request_permission`,
`fs/read_text_file`, `fs/write_text_file`, `terminal/*`, plus Cognition extension
notifications `_cognition.ai/turn_stats` and `_cognition.ai/output`.

`_meta` keys consumed: `cognition.ai/isLocked`, `cognition.ai/lockHolderPid`,
`cognition.ai/sessionListOrderBy` (initialize caps), `cognition.ai/editableCommand(s)`
(permission tool calls), `cognition.ai/category`, `cognition.ai/cwd`,
`cognition.ai/command`, `cognition.ai/commandNames`, `cognition.ai/rename`,
`cognition.ai/sessionRename`, `cognition.ai/inferenceToolName`,
`cognition.ai/preview_is_shell_command`, `cognition.ai/terminalPreview`.

## Known gaps / TODO

- **Queued messages + "send now"**: `SessionManager` holds a per-session in-memory
  queue (`SessionState.queue`) and serializes normal ACP prompts; Composer shows
  queued drafts with edit/remove/send-now actions. With `midTurnPrompts`
  (CLI ≥3000.11.92) send-now **steers**: `SessionManager.steer()` sends the
  prompt mid-turn without cancelling — one merged turn, one `turnEnded`.
  Stop is separate. Queue survives browser reconnects but not a server restart.
- **`/btw` side questions (verified vs real agent 3000.11.234)**: handshake is
  (1) declare `clientCapabilities._meta['cognition.ai/chains']=true` at
  initialize (the agent logs `chains=true`), and (2) send the `/btw` prompt with
  `_meta['cognition.ai/chain']='<id>'`. Without the chain meta the agent replies
  instantly "needs side-chain support…". `/btw` is NOT in `availableCommands`;
  availability = `agentInfo.caps.chains`. Side-chunk routing: `_meta
  ['cognition.ai/channel']=='btw'` (fake agent), `_meta['cognition.ai/instant']`,
  or no active main turn; unmarked chunks during a main turn stay in the main
  transcript (documented caveat).
- **CLI ≥3000.11.234 surface adopted**: `session/close` on local close +
  `session.forceClose` (`_meta['cognition.ai/force']`) for locks held by other
  processes; `session/list` `_meta['cognition.ai/content']` global content
  search; `_meta['cognition.ai/hasUserMessages']` badge; `speed` config option
  (`category:'model_config'`, standard/fast — the Fast switch is wired to it,
  NOT to `-fast` model values); `_meta['cognition.ai/supportsImages']` per model
  option; `cognition.ai/permissionRule|permissionReason` on permission requests;
  `cognition.ai/timestamp` on streamed chunks → `item.at`; `/rename` with no
  title auto-generates one. `/loop` is gone; `/goal` and `/billing` arrive via
  `availableCommands` for free.
- Real-account catalog/pricing JSON shape is **unverified** — inspect via the
  Diagnostics "Modelos y precios" card or `devin-pocket models`. The parser is
  tolerant (families / array / `{models}`) and reports `parseError` on unknown shapes.
- `devin-pocket models` was reported as "not working well" on the user's Termux —
  output pending; verify on device.
- **Session listing relies solely on ACP `session/list`**; if the Devin agent only
  returns sessions for the given cwd, app-created sessions from other directories will
  not show — verify against the real agent (check `devin acp` behavior with
  `session/list` without cwd) and, if needed, persist **workspaces** (not sessions)
  the user has used. Product rule: no local session storage.
- LAN binding (`--host 0.0.0.0`) is unauthenticated — origin checks only; token/pairing
  auth is a TODO.
- Rename uses the agent's `/rename` slash command or a local `titles.json` override —
  the `cognition.ai/sessionRename` meta path is not wired.
- `editedCommand` can't be sent back in the standard ACP permission response — the
  field is displayed read-only.
- Workflow/elicitation/resource-link ACP shapes are unverified.
- Fake agent `deleteSession` only removes app-created sessions; the fixed demo
  sessions (`fake-session-*`) always remain.

## Releases

- Conventional commits on `main` drive semantic-release versions and npm publishing
  via `.github/workflows/release.yml` after verification. `docs(readme)` also ships a
  patch. Never hand-edit the version or push release tags.
- `package.json` is the runtime version source. Releases update it and `CHANGELOG.md`,
  publish publicly with provenance, and require the `NPM_TOKEN` repo secret.

## Debugging recipe

1. `devin-pocket doctor` — Node/Devin/ACP/ports/disk checks.
2. `devin-pocket logs -f` — ring-buffer log at `$XDG_STATE_HOME/devin-pocket/
   devin-pocket.log`; agent stderr at `devin-acp.stderr.log` (agent stderr goes to the
   log file only — never to the UI).
3. In the app: **Diagnóstico** screen — doctor rerun, log tail, Models & pricing card
   (debug source/command/exit/stderr + option↔catalog matches), "Copiar reporte" for a
   sanitized JSON blob.
4. CLI: `devin-pocket models` for catalog debug from the terminal;
   `DEVIN_POCKET_MODELS_FILE=/path/fixture.json` to inject a catalog fixture;
   `DEVIN_POCKET_VERBOSE=1` to mirror logs to stderr.
