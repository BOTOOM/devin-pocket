/**
 * Wire contract between the devin-pocket server and the PWA (WebSocket at /ws).
 *
 * Design:
 *  - The server owns the truth. It talks ACP to `devin acp`, normalizes every
 *    session notification into a `SessionEvent`, applies it to its own store via
 *    the shared reducer (./reducer.ts) and forwards the same event to browsers.
 *  - Browsers apply the identical reducer, so a `session.snapshot` on connect
 *    plus live `session.event`s keeps them in sync — reconnects are cheap.
 *  - Nothing here is raw ACP except a few SDK content types re-exported as-is
 *    (ContentBlock, ToolCallContent…) because the UI renders them directly.
 */
import type {
  ContentBlock,
  PermissionOption,
  PlanEntryStatus,
  SessionConfigOption,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from '@agentclientprotocol/sdk';

export type {
  ContentBlock,
  PermissionOption,
  SessionConfigOption,
  ToolCallContent,
  ToolCallLocation,
};

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Agent (the `devin acp` child process) status
// ---------------------------------------------------------------------------

export type AgentStatus =
  | { phase: 'starting' }
  | { phase: 'needsAuth'; methods: AuthMethod[]; error?: string }
  | { phase: 'authenticating'; methodId: string }
  | { phase: 'ready' }
  | { phase: 'restarting'; attempt: number; inMs: number; reason: string }
  | { phase: 'error'; message: string; hint?: string; code: ErrorCode };

export interface AuthMethod {
  id: string;
  name?: string | null;
  description?: string | null;
}

export interface AgentInfo {
  name?: string;
  title?: string;
  version?: string;
  /** agentCapabilities as reported by initialize (subset the UI cares about) */
  caps: {
    loadSession: boolean;
    listSessions: boolean;
    deleteSessions: boolean;
    image: boolean;
    embeddedContext: boolean;
    rename: boolean;
    editableCommands: boolean;
    /** raw `_meta` from agentCapabilities (cognition.ai/* flags) */
    meta: Record<string, unknown>;
  };
}

export type ErrorCode =
  | 'devin_not_found'
  | 'devin_not_logged_in'
  | 'spawn_failed'
  | 'acp_protocol'
  | 'acp_crashed'
  | 'port_in_use'
  | 'unknown';

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
  locked: boolean;
  lockHolderPid?: number | null;
  /** true when this server process currently has it loaded */
  open: boolean;
}

export type TurnPhase = 'idle' | 'working' | 'awaitingPermission' | 'cancelling';

export type TranscriptItem =
  | { kind: 'user'; id: string; blocks: ContentBlock[]; at: number }
  | { kind: 'agent'; id: string; text: string; streaming: boolean; at: number }
  | { kind: 'thought'; id: string; text: string; streaming: boolean; at: number }
  | {
      kind: 'tool';
      id: string;
      toolCallId: string;
      toolKind: ToolKind | string;
      title: string;
      status: ToolCallStatus | string;
      content: ToolCallContent[];
      locations: ToolCallLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
      exitCode?: number;
      cwd?: string;
      /** _meta["cognition.ai/command"] — the shell command when kind=execute */
      command?: string;
      at: number;
    }
  | { kind: 'system'; id: string; text: string; level: 'info' | 'warn' | 'error'; at: number };

export interface PlanEntry {
  content: string;
  status: PlanEntryStatus | string;
  priority?: string;
}

export interface Command {
  name: string;
  description: string;
  hint?: string;
  /** _meta["cognition.ai/category"] — e.g. skill, mcp, workflow, rule, builtin */
  category?: string;
  /** true for actions handled by devin-pocket itself (not sent to the agent) */
  local?: boolean;
}

export interface ModeInfo {
  id: string;
  name: string;
  description?: string | null;
}

export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  title: string;
  toolKind: string;
  options: PermissionOption[];
  /** _meta["cognition.ai/editableCommand"] — user may edit before approving */
  editableCommand?: string;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  at: number;
}

/** One `_cognition.ai/turn_stats` notification, distilled (tokens are per turn). */
export interface TurnStat {
  turnRequestId: string;
  model?: string;
  input: number;
  cached: number;
  output: number;
  extra: { uid: string; label: string; value: number; tail: string; pluralTail: string }[];
}

export interface UsageInfo {
  used: number;
  size: number;
  /** agent-reported cumulative cost, when the agent sends one */
  cost?: { amount: number; currency: string };
}

export interface QueuedPrompt {
  id: string;
  blocks: ContentBlock[];
}

export interface AsideState {
  question: string;
  answer: string;
  status: 'working' | 'done' | 'error';
  error?: string;
}

export interface SessionState {
  sessionId: string;
  queue: QueuedPrompt[];
  aside?: AsideState;
  cwd: string;
  title?: string;
  turn: TurnPhase;
  items: TranscriptItem[];
  plan: PlanEntry[];
  commands: Command[];
  modes: ModeInfo[];
  currentMode?: string;
  configOptions: SessionConfigOption[];
  permission?: PermissionRequest;
  usage?: UsageInfo;
  turnStats: TurnStat[];
  /** last error surfaced for this session (prompt failed, load failed…) */
  error?: string;
  /** replay in progress (session/load) */
  loading: boolean;
  /** monotonically increasing; browsers drop events with seq <= their own */
  seq: number;
}

// ---------------------------------------------------------------------------
// Session events — normalized ACP, applied by the shared reducer on both ends
// ---------------------------------------------------------------------------

export type SessionEvent =
  | { type: 'userChunk'; block: ContentBlock }
  | { type: 'agentChunk'; text: string }
  | { type: 'thoughtChunk'; text: string }
  | {
      type: 'toolCall';
      toolCallId: string;
      title: string;
      toolKind: string;
      status: string;
      content?: ToolCallContent[];
      locations?: ToolCallLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
      exitCode?: number;
      cwd?: string;
      command?: string;
    }
  | {
      type: 'toolCallUpdate';
      toolCallId: string;
      title?: string;
      toolKind?: string;
      status?: string;
      content?: ToolCallContent[];
      locations?: ToolCallLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
      exitCode?: number;
      command?: string;
    }
  | { type: 'plan'; entries: PlanEntry[] }
  | { type: 'commands'; commands: Command[] }
  | { type: 'mode'; modeId: string }
  | { type: 'modes'; modes: ModeInfo[]; currentMode?: string }
  | { type: 'configOptions'; options: SessionConfigOption[] }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'turnStats'; stat: TurnStat }
  | { type: 'info'; title?: string }
  | { type: 'turnStarted' }
  | { type: 'queueChanged'; queue: QueuedPrompt[] }
  | { type: 'asideStarted'; question: string }
  | { type: 'asideChunk'; text: string }
  | { type: 'asideEnded'; error?: string }
  | { type: 'turnEnded'; stopReason: string }
  | { type: 'permissionRequested'; request: PermissionRequest }
  | { type: 'permissionResolved'; requestId: string }
  | { type: 'loading'; loading: boolean }
  | { type: 'system'; text: string; level: 'info' | 'warn' | 'error' }
  | { type: 'error'; message?: string };

// ---------------------------------------------------------------------------
// Model catalog (from `devin models list --format json`, NOT from ACP)
// ---------------------------------------------------------------------------

export interface CatalogPrices {
  input: number;
  cached?: number;
  output: number;
}

export interface CatalogEntry {
  modelUid: string;
  label: string;
  family?: string;
  familyLabel?: string;
  costTier?: string;
  prices?: CatalogPrices;
  costSummary?: string;
  isNew: boolean;
  isBeta: boolean;
  maxContext?: number;
  /** normalized reasoning level (None|Low|Medium|High|XHigh|Max) */
  level?: string;
  /** label modifiers, e.g. 'Fast', '1M' (context window variant) */
  mods?: string[];
}

export interface CatalogDebug {
  command: string; // e.g. "/path/devin models list --format json"
  exitCode: number | null;
  signal?: string;
  durationMs: number;
  stdoutHead: string; // first 4000 chars
  stderrHead: string; // first 2000 chars
  parseError?: string;
  entryCount: number;
  source: 'cli' | 'cache' | 'fixture' | 'none';
  cacheFile: string;
  cacheAgeMs?: number;
  fetchedAt?: number;
}

export type CatalogState =
  | { status: 'loading' }
  | {
      status: 'ready';
      entries: CatalogEntry[];
      fetchedAt: number;
      fromCache: boolean;
      debug?: CatalogDebug;
    }
  | { status: 'unavailable'; reason: string; debug?: CatalogDebug };

// ---------------------------------------------------------------------------
// Misc server-side facts
// ---------------------------------------------------------------------------

export interface LocalPort {
  port: number;
  pid?: number;
  process?: string;
}

export interface Workspace {
  path: string;
  name: string;
  lastUsedAt?: number;
}

export interface ServerSettings {
  version: string;
  /** server process cwd — default folder for new sessions */
  cwd: string;
  port: number;
  host: string;
  logDir: string;
  agentCommand: string;
  platform: { termux: boolean; proot: boolean; os: string; arch: string; node: string };
}

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

export type ServerMessage =
  | {
      type: 'hello';
      protocol: number;
      settings: ServerSettings;
      agent: AgentStatus;
      agentInfo?: AgentInfo;
      sessions: SessionSummary[];
      catalog: CatalogState;
      workspaces: Workspace[];
      /** sessions this server has open (full state) */
      open: SessionState[];
    }
  | { type: 'agent.status'; status: AgentStatus; info?: AgentInfo }
  | { type: 'sessions.list'; sessions: SessionSummary[] }
  | { type: 'session.snapshot'; state: SessionState }
  | { type: 'session.event'; sessionId: string; seq: number; event: SessionEvent }
  | { type: 'session.closed'; sessionId: string }
  | { type: 'catalog'; catalog: CatalogState }
  | { type: 'ports'; ports: LocalPort[] }
  | { type: 'workspaces'; workspaces: Workspace[] }
  | { type: 'toast'; level: 'info' | 'success' | 'warn' | 'error'; text: string }
  | { type: 'ack'; id: string; ok: true; result?: unknown }
  | { type: 'ack'; id: string; ok: false; error: string; code?: ErrorCode };

export type ClientCommand =
  | { type: 'auth.login'; methodId: string }
  | { type: 'auth.logout' }
  | { type: 'agent.restart' }
  | { type: 'sessions.refresh'; cwd?: string }
  | { type: 'session.new'; cwd: string }
  | { type: 'session.open'; sessionId: string; cwd: string }
  | { type: 'session.close'; sessionId: string }
  | { type: 'session.delete'; sessionId: string; cwd: string }
  | { type: 'session.rename'; sessionId: string; title: string }
  | { type: 'prompt'; sessionId: string; blocks: ContentBlock[] }
  | { type: 'prompt.enqueue'; sessionId: string; blocks: ContentBlock[] }
  | { type: 'prompt.update'; sessionId: string; id: string; blocks: ContentBlock[] }
  | { type: 'prompt.remove'; sessionId: string; id: string }
  | { type: 'prompt.sendNow'; sessionId: string; id: string }
  | { type: 'aside.ask'; sessionId: string; question: string }
  | { type: 'cancel'; sessionId: string }
  | { type: 'mode.set'; sessionId: string; modeId: string }
  | { type: 'config.set'; sessionId: string; configId: string; value: string }
  | {
      type: 'permission.respond';
      sessionId: string;
      requestId: string;
      outcome:
        | { kind: 'selected'; optionId: string; editedCommand?: string }
        | { kind: 'cancelled' };
    }
  | { type: 'catalog.refresh' }
  | { type: 'ports.refresh' };

/** Every client command is wrapped with a correlation id so the UI can await an ack. */
export interface ClientEnvelope {
  id: string;
  cmd: ClientCommand;
}

// ---------------------------------------------------------------------------
// REST (things that don't fit a push model)
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

/** GET /api/fs?cwd=&q= — fuzzy file/folder search for @mentions (git-ignored aware) */
export interface FsSearchResponse {
  entries: FsEntry[];
  truncated: boolean;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail?: string;
  fix?: string;
}

/** GET /api/doctor */
export interface DoctorReport {
  at: number;
  checks: DoctorCheck[];
  summary: 'ok' | 'warn' | 'fail';
}

/** GET /api/logs?lines= */
export interface LogsResponse {
  files: { name: string; size: number }[];
  lines: string[];
}
