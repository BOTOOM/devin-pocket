import fs from 'node:fs';
import type {
  ContentBlock,
  PermissionOption,
  RequestPermissionRequest,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type {
  ContentBlock as CB,
  PermissionRequest,
  ServerMessage,
  SessionEvent,
  SessionState,
  SessionSummary,
  ToolCallContent,
  ToolCallLocation,
  TurnStat,
  Workspace,
} from '../shared/protocol.js';
import { applyEvent, initialSessionState } from '../shared/reducer.js';
import type { AgentProcess } from './acp/agent.js';
import { normalizeUpdate } from './acp/normalize.js';
import type { Logger } from './log.js';
import { titlesFile } from './paths.js';

type Send = (msg: ServerMessage) => void;

interface PendingPermission {
  sessionId: string;
  resolve: (resp: {
    outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string };
  }) => void;
}

/** Local title overrides when the agent can't rename (see rename()). */
function loadTitles(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(titlesFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveTitle(sessionId: string, title: string): void {
  try {
    const t = loadTitles();
    t[sessionId] = title;
    fs.writeFileSync(titlesFile(), JSON.stringify(t));
  } catch {
    // best-effort
  }
}

export class SessionManager {
  private sessions = new Map<string, SessionState>();
  private listeners = new Set<Send>();
  private permissions = new Map<string, PendingPermission>();
  private permSeq = 0;
  /** sessionId → prompt text whose user_message_chunk echo should be swallowed */
  private echoExpect = new Map<string, { text: string; buf: string }>();
  private lastList: SessionSummary[] = [];

  constructor(
    private agent: AgentProcess,
    private workspaces: Workspace[],
    private log: Logger,
  ) {
    agent.onStatus((s) => {
      if (s.phase === 'ready') {
        // populate the session list at startup and after (re)authentication
        void this.list().catch((e) => this.log.warn(`session/list: ${(e as Error).message}`));
      } else if (s.phase === 'restarting' || s.phase === 'error' || s.phase === 'starting') {
        // the ACP connection is gone — pending permission RPCs would hang forever
        this.cancelAllPermissions();
      }
    });
  }

  private cancelAllPermissions(): void {
    for (const [id, p] of this.permissions) {
      this.permissions.delete(id);
      p.resolve({ outcome: { outcome: 'cancelled' } });
      this.emitEvent(p.sessionId, { type: 'permissionResolved', requestId: id });
    }
  }

  onEvent(fn: Send): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(msg: ServerMessage): void {
    for (const fn of this.listeners) fn(msg);
  }

  private emitEvent(sessionId: string, ev: SessionEvent): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const next = applyEvent(s, ev);
    this.sessions.set(sessionId, next);
    this.emit({ type: 'session.event', sessionId, seq: next.seq, event: ev });
  }

  private ensure(sessionId: string, cwd?: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = initialSessionState(sessionId, cwd ?? process.cwd());
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** Feed an ACP notification into the matching session state. */
  handleNotification(n: SessionNotification): void {
    const sid = n.sessionId;
    if (n.update.sessionUpdate === 'user_message_chunk') {
      // swallow the live echo of a prompt we already rendered locally
      const block = n.update.content;
      const text = block.type === 'text' ? block.text : '';
      const ex = this.echoExpect.get(sid);
      if (ex) {
        const acc = ex.buf + text;
        if (acc === ex.text) {
          this.echoExpect.delete(sid);
          return;
        }
        if (ex.text.startsWith(acc)) {
          ex.buf = acc;
          return;
        }
        this.echoExpect.delete(sid);
      }
    }
    const events = normalizeUpdate(n.update);
    this.ensure(sid);
    for (const ev of events) this.emitEvent(sid, ev);
  }

  handleTurnStats(sessionId: string, stat: TurnStat): void {
    if (!this.sessions.has(sessionId)) return;
    this.emitEvent(sessionId, { type: 'turnStats', stat });
  }

  openStates(): SessionState[] {
    return [...this.sessions.values()];
  }

  summaries(): SessionSummary[] {
    return this.lastList.map((s) => ({ ...s, open: this.sessions.has(s.sessionId) }));
  }

  /** session/list across configured workspaces (+ cwd when different). */
  async list(cwd?: string): Promise<SessionSummary[]> {
    const cwds = new Set<string>();
    for (const w of this.workspaces) cwds.add(w.path);
    if (cwd) cwds.add(cwd);
    if (cwds.size === 0) cwds.add(process.cwd());
    const titles = loadTitles();
    const out: SessionSummary[] = [];
    for (const c of cwds) {
      try {
        const infos = await this.agent.listSessions(c);
        for (const si of infos) {
          const meta = si._meta ?? {};
          const locked =
            meta['cognition.ai/isLocked'] === true || meta['cognition.ai/isLocked'] === 'true';
          const pid = meta['cognition.ai/lockHolderPid'];
          out.push({
            sessionId: si.sessionId,
            cwd: si.cwd ?? c,
            title: titles[si.sessionId] ?? si.title ?? undefined,
            updatedAt: si.updatedAt ?? undefined,
            locked,
            lockHolderPid: typeof pid === 'number' ? pid : null,
            open: this.sessions.has(si.sessionId),
          });
        }
      } catch (e) {
        this.log.warn(`session/list ${c}: ${(e as Error).message}`);
        if (/not logged in|not authenticated|auth/i.test((e as Error).message)) {
          this.agent.markNeedsAuth((e as Error).message);
          throw e;
        }
      }
    }
    // sessions we just created may not be in the agent's list yet — merge them in
    for (const s of this.sessions.values()) {
      if (!out.some((x) => x.sessionId === s.sessionId)) {
        out.push({
          sessionId: s.sessionId,
          cwd: s.cwd,
          title: s.title,
          locked: false,
          lockHolderPid: null,
          open: true,
        });
      }
    }
    // newest first
    out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    this.lastList = out;
    this.emit({ type: 'sessions.list', sessions: out });
    return out;
  }

  async create(cwd: string): Promise<SessionState> {
    const res = await this.agent.newSession(cwd);
    const _s = this.ensure(res.sessionId, cwd);
    this.agent.trackOpen(res.sessionId, cwd);
    if (res.modes) {
      this.emitEvent(res.sessionId, {
        type: 'modes',
        modes: res.modes.availableModes.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
        })),
        currentMode: res.modes.currentModeId,
      });
    }
    if (res.configOptions) {
      this.emitEvent(res.sessionId, { type: 'configOptions', options: res.configOptions });
    }
    this.emit({ type: 'session.snapshot', state: this.sessions.get(res.sessionId)! });
    void this.list(cwd).catch((e) => this.log.warn(`session/list: ${(e as Error).message}`));
    return this.sessions.get(res.sessionId)!;
  }

  async open(sessionId: string, cwd: string): Promise<SessionState> {
    this.ensure(sessionId, cwd);
    this.emitEvent(sessionId, { type: 'loading', loading: true });
    try {
      const res = await this.agent.loadSession(sessionId, cwd);
      this.agent.trackOpen(sessionId, cwd);
      if (res.modes) {
        this.emitEvent(sessionId, {
          type: 'modes',
          modes: res.modes.availableModes.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
          })),
          currentMode: res.modes.currentModeId,
        });
      }
      if (res.configOptions) {
        this.emitEvent(sessionId, { type: 'configOptions', options: res.configOptions });
      }
      return this.sessions.get(sessionId)!;
    } finally {
      this.emitEvent(sessionId, { type: 'loading', loading: false });
      this.emit({ type: 'session.snapshot', state: this.sessions.get(sessionId)! });
    }
  }

  close(sessionId: string): void {
    // resolve pending permission requests so the agent's turn can unwind
    for (const [id, p] of this.permissions) {
      if (p.sessionId !== sessionId) continue;
      this.permissions.delete(id);
      p.resolve({ outcome: { outcome: 'cancelled' } });
      this.emitEvent(sessionId, { type: 'permissionResolved', requestId: id });
    }
    this.sessions.delete(sessionId);
    this.agent.untrack(sessionId);
    this.emit({ type: 'session.closed', sessionId });
  }

  async delete(sessionId: string): Promise<void> {
    await this.agent.deleteSession(sessionId);
    this.close(sessionId);
    void this.list().catch((e) => this.log.warn(`session/list: ${(e as Error).message}`));
  }

  /** Prefer the agent's own `/rename` slash command; fall back to a local
   *  title override persisted in <state>/titles.json (agent can't rename). */
  async rename(sessionId: string, title: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    const hasRenameCmd = s?.commands.some((c) => c.name === 'rename');
    if (hasRenameCmd && s) {
      await this.prompt(sessionId, [{ type: 'text', text: `/rename ${title}` }]);
      return;
    }
    saveTitle(sessionId, title);
    this.emitEvent(sessionId, { type: 'info', title });
    this.emit({ type: 'sessions.list', sessions: this.summaries() });
  }

  async prompt(sessionId: string, blocks: CB[]): Promise<{ stopReason: string }> {
    this.emitEvent(sessionId, { type: 'turnStarted' });
    // local echo; agent's user_message_chunk echo is suppressed in handleNotification
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (text) this.echoExpect.set(sessionId, { text, buf: '' });
    for (const b of blocks) this.emitEvent(sessionId, { type: 'userChunk', block: b });
    try {
      const res = await this.agent.prompt(sessionId, blocks as ContentBlock[]);
      this.emitEvent(sessionId, { type: 'turnEnded', stopReason: res.stopReason });
      return { stopReason: res.stopReason };
    } catch (e) {
      const msg = (e as Error).message;
      if (/not logged in|not authenticated|unauthoriz|auth/i.test(msg)) {
        this.agent.markNeedsAuth(msg);
      }
      this.emitEvent(sessionId, { type: 'error', message: msg });
      this.emitEvent(sessionId, { type: 'turnEnded', stopReason: 'error' });
      throw e;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.agent.cancel(sessionId);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.agent.setMode(sessionId, modeId);
    this.emitEvent(sessionId, { type: 'mode', modeId });
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    const opts = await this.agent.setConfigOption(sessionId, configId, value);
    if (opts) this.emitEvent(sessionId, { type: 'configOptions', options: opts });
  }

  /** Called by AgentProcess requestPermission handler. */
  requestPermission(
    sessionId: string,
    req: RequestPermissionRequest,
  ): Promise<{ outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } }> {
    const requestId = `perm-${++this.permSeq}`;
    const meta = req.toolCall._meta as Record<string, unknown> | undefined;
    const editable = meta?.['cognition.ai/editableCommand'];
    const request: PermissionRequest = {
      requestId,
      toolCallId: req.toolCall.toolCallId,
      title: req.toolCall.title ?? '',
      toolKind: (req.toolCall.kind as string | undefined) ?? 'other',
      options: req.options as PermissionOption[],
      editableCommand: typeof editable === 'string' ? editable : undefined,
      content: req.toolCall.content as ToolCallContent[] | undefined,
      locations: req.toolCall.locations as ToolCallLocation[] | undefined,
      rawInput: req.toolCall.rawInput,
      at: Date.now(),
    };
    return new Promise((resolve) => {
      this.permissions.set(requestId, { sessionId, resolve });
      this.emitEvent(sessionId, { type: 'permissionRequested', request });
    });
  }

  respondPermission(
    requestId: string,
    outcome: { kind: 'selected'; optionId: string; editedCommand?: string } | { kind: 'cancelled' },
  ): boolean {
    const p = this.permissions.get(requestId);
    if (!p) return false;
    this.permissions.delete(requestId);
    if (outcome.kind === 'cancelled') {
      p.resolve({ outcome: { outcome: 'cancelled' } });
    } else {
      p.resolve({ outcome: { outcome: 'selected', optionId: outcome.optionId } });
    }
    this.emitEvent(p.sessionId, { type: 'permissionResolved', requestId });
    return true;
  }

  /** Re-open sessions after an agent restart, re-broadcasting snapshots. */
  async reopenAll(): Promise<void> {
    const tracked = this.openStates();
    for (const s of tracked) {
      try {
        await this.open(s.sessionId, s.cwd);
      } catch (e) {
        this.emitEvent(s.sessionId, {
          type: 'error',
          message: `reopen failed: ${(e as Error).message}`,
        });
      }
    }
  }
}
