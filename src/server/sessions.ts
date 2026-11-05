import fs from 'node:fs';
import path from 'node:path';
import type {
  ContentBlock,
  PermissionOption,
  RequestPermissionRequest,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type {
  ContentBlock as CB,
  PermissionRequest,
  QueuedPrompt,
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
    const f = titlesFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(t));
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
  private active = new Set<string>();
  private interrupting = new Set<string>();
  private sideActive = new Set<string>();
  /** sessionId → counters while a session/load replay is in flight */
  private loadStats = new Map<string, { updates: number; events: number; pipelineMs: number }>();
  /** sessionId → in-flight open() so concurrent requests share one replay */
  private opening = new Map<string, Promise<SessionState>>();

  constructor(
    private agent: AgentProcess,
    private workspaces: Workspace[],
    private log: Logger,
  ) {
    agent.onStatus((s) => {
      if (s.phase === 'ready') {
        // populate the session list at startup and after (re)authentication
        void this.list().catch((e) => this.log.warn(`session/list: ${(e as Error).message}`));
        // never auto-send queued prompts after an agent error — re-render the
        // queue so the UI shows its send-now action
        for (const sess of this.sessions.values()) {
          if (sess.queue.length > 0) {
            this.emitEvent(sess.sessionId, { type: 'queueChanged', queue: [...sess.queue] });
          }
        }
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
    // During a session/load replay thousands of updates would each become a WS
    // message; clients only need the `loading` flag and the final snapshot.
    if (!s.loading || ev.type === 'loading') {
      this.emit({ type: 'session.event', sessionId, seq: next.seq, event: ev });
    }
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
    const stat = this.loadStats.get(sid);
    if (stat) stat.updates++;
    const channel = n.update._meta?.['cognition.ai/channel'] ?? n._meta?.['cognition.ai/channel'];
    const instant = n.update._meta?.['cognition.ai/instant'] === true;
    const isAside =
      this.sideActive.has(sid) && (channel === 'btw' || instant || !this.active.has(sid));
    if (
      isAside &&
      n.update.sessionUpdate === 'agent_message_chunk' &&
      n.update.content.type === 'text'
    ) {
      this.emitEvent(sid, { type: 'asideChunk', text: n.update.content.text });
      return;
    }
    if (n.update.sessionUpdate === 'user_message_chunk' && this.sideActive.has(sid)) {
      const block = n.update.content;
      if (channel === 'btw' || (block.type === 'text' && block.text.startsWith('/btw '))) return;
    }
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
    if (stat) {
      stat.events += events.length;
      const t0 = performance.now();
      for (const ev of events) this.emitEvent(sid, ev);
      stat.pipelineMs += performance.now() - t0;
    } else {
      for (const ev of events) this.emitEvent(sid, ev);
    }
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

  /** session/list globally, then per configured workspace (+ cwd when different). */
  async list(cwd?: string, query?: string): Promise<SessionSummary[]> {
    const cwds = new Set<string>();
    for (const w of this.workspaces) cwds.add(w.path);
    if (cwd) cwds.add(cwd);
    if (cwds.size === 0) cwds.add(process.cwd());
    const titles = loadTitles();
    const out: SessionSummary[] = [];
    const seen = new Set<string>();
    const pushInfos = (infos: Awaited<ReturnType<AgentProcess['listSessions']>>, c?: string) => {
      for (const si of infos) {
        if (seen.has(si.sessionId)) continue;
        seen.add(si.sessionId);
        const meta = si._meta ?? {};
        const locked =
          meta['cognition.ai/isLocked'] === true || meta['cognition.ai/isLocked'] === 'true';
        const pid = meta['cognition.ai/lockHolderPid'];
        const hum = meta['cognition.ai/hasUserMessages'];
        out.push({
          sessionId: si.sessionId,
          cwd: si.cwd ?? c ?? process.cwd(),
          title: titles[si.sessionId] ?? si.title ?? undefined,
          updatedAt: si.updatedAt ?? undefined,
          locked,
          lockHolderPid: typeof pid === 'number' ? pid : null,
          hasUserMessages: typeof hum === 'boolean' ? hum : undefined,
          open: this.sessions.has(si.sessionId),
        });
      }
    };
    // ACP allows omitting cwd — one global query first, then per-cwd merge.
    // `query` searches session content (`cognition.ai/content`), global only.
    const q = query?.trim() || undefined;
    try {
      pushInfos(await this.agent.listSessions(undefined, q));
    } catch (e) {
      this.log.debug(`session/list (no cwd): ${(e as Error).message}`);
    }
    for (const c of q ? [] : cwds) {
      try {
        pushInfos(await this.agent.listSessions(c), c);
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
      if (!seen.has(s.sessionId) && (!q || (s.title ?? '').toLowerCase().includes(q))) {
        seen.add(s.sessionId);
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

  open(sessionId: string, cwd: string): Promise<SessionState> {
    // Clients can send duplicate session.open (effect re-runs, reconnects);
    // a second loadSession would replay the whole history into the same state.
    const pending = this.opening.get(sessionId);
    if (pending) return pending;
    const p = this.doOpen(sessionId, cwd);
    this.opening.set(sessionId, p);
    const clear = () => this.opening.delete(sessionId);
    p.then(clear, clear);
    return p;
  }

  private async doOpen(sessionId: string, cwd: string): Promise<SessionState> {
    this.ensure(sessionId, cwd);
    this.emitEvent(sessionId, { type: 'loading', loading: true });
    const stat = { updates: 0, events: 0, pipelineMs: 0 };
    this.loadStats.set(sessionId, stat);
    const t0 = performance.now();
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
      this.loadStats.delete(sessionId);
      this.log.info(
        `session/load ${sessionId}: ${stat.updates} updates, ${stat.events} events, ` +
          `pipeline ${Math.round(stat.pipelineMs)}ms, total ${Math.round(performance.now() - t0)}ms`,
      );
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
    this.echoExpect.delete(sessionId);
    this.sideActive.delete(sessionId);
    this.agent.untrack(sessionId);
    // release the agent-side lock so other clients can open it (best-effort)
    if (this.agent.agentInfo?.caps.closeSession) {
      void this.agent
        .closeSession(sessionId)
        .catch((e) => this.log.debug(`session/close ${sessionId}: ${(e as Error).message}`));
    }
    this.emit({ type: 'session.closed', sessionId });
  }

  /** Force-close a session held by another process (`cognition.ai/force`),
   *  e.g. a stale lock left by a crashed client. */
  async forceClose(sessionId: string): Promise<void> {
    if (!this.agent.agentInfo?.caps.closeSession) {
      throw new Error('agent does not support session/close');
    }
    await this.agent.closeSession(sessionId, true);
    void this.list().catch((e) => this.log.warn(`session/list: ${(e as Error).message}`));
  }

  async delete(sessionId: string): Promise<void> {
    await this.agent.deleteSession(sessionId);
    this.close(sessionId);
    void this.list().catch((e) => this.log.warn(`session/list: ${(e as Error).message}`));
  }

  /** Prefer the agent's own `/rename` slash command; fall back to a local
   *  title override persisted in <state>/titles.json (agent can't rename).
   *  An empty title asks the agent to generate one (CLI ≥3000.11.205). */
  async rename(sessionId: string, title: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    const hasRenameCmd = s?.commands.some((c) => c.name === 'rename');
    if (hasRenameCmd && s) {
      await this.prompt(sessionId, [
        { type: 'text', text: title ? `/rename ${title}` : '/rename' },
      ]);
      if (!title) return; // agent generates + announces via session_info_update
    } else {
      if (!title) throw new Error('auto-rename requires an open session');
      saveTitle(sessionId, title);
    }
    // update session state + the cached list so clients see the title at once
    this.emitEvent(sessionId, { type: 'info', title });
    this.lastList = this.lastList.map((x) => (x.sessionId === sessionId ? { ...x, title } : x));
    this.emit({ type: 'sessions.list', sessions: this.summaries() });
  }

  askAside(sessionId: string, question: string): void {
    const s = this.sessions.get(sessionId);
    const q = question.trim();
    if (!s || s.loading) throw new Error('session is not open');
    // /btw runs on a side chain; the real agent doesn't list it in
    // availableCommands but accepts it when we declared chains support.
    const chains = this.agent.agentInfo?.caps.chains === true;
    if (!s.commands.some((c) => c.name === 'btw') && !chains) {
      throw new Error('/btw is not available');
    }
    if (!q || q.length > 4000) throw new Error('invalid question');
    if (this.sideActive.has(sessionId)) throw new Error('side question already running');
    if (this.agent.status.phase !== 'ready') throw new Error('agent is not ready');
    this.sideActive.add(sessionId);
    this.emitEvent(sessionId, { type: 'asideStarted', question: q });
    void this.agent
      .prompt(sessionId, [{ type: 'text', text: `/btw ${q}` }], {
        'cognition.ai/chain': 'btw',
      })
      .then(() => {
        this.sideActive.delete(sessionId);
        this.emitEvent(sessionId, { type: 'asideEnded' });
      })
      .catch((e) => {
        this.sideActive.delete(sessionId);
        this.emitEvent(sessionId, { type: 'asideEnded', error: (e as Error).message });
      });
  }

  enqueue(sessionId: string, blocks: CB[]): string {
    const s = this.sessions.get(sessionId);
    if (!s || s.loading) throw new Error('session is not open');
    if (blocks.length === 0) throw new Error('empty prompt');
    if (s.queue.length >= 10) throw new Error('queue is full');
    const item: QueuedPrompt = { id: crypto.randomUUID(), blocks };
    this.emitEvent(sessionId, { type: 'queueChanged', queue: [...s.queue, item] });
    this.startNext(sessionId);
    return item.id;
  }

  removeQueued(sessionId: string, id: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s?.queue.some((p) => p.id === id)) return false;
    this.emitEvent(sessionId, { type: 'queueChanged', queue: s.queue.filter((p) => p.id !== id) });
    return true;
  }

  /** Replace a queued prompt's blocks in place, keeping its position. */
  updateQueued(sessionId: string, id: string, blocks: CB[]): boolean {
    const s = this.sessions.get(sessionId);
    const idx = s?.queue.findIndex((p) => p.id === id) ?? -1;
    if (!s || idx < 0 || blocks.length === 0) return false;
    const queue = [...s.queue];
    queue[idx] = { id, blocks };
    this.emitEvent(sessionId, { type: 'queueChanged', queue });
    return true;
  }

  async sendNow(sessionId: string, id: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    const item = s?.queue.find((p) => p.id === id);
    if (!s || !item) throw new Error('queued message not found');
    // Steering (CLI ≥3000.11.92): a mid-turn prompt joins the running turn —
    // no cancel, no lost progress. Fall back to cancel+resend on old agents.
    if (this.active.has(sessionId) && this.agent.agentInfo?.caps.midTurnPrompts) {
      this.emitEvent(sessionId, {
        type: 'queueChanged',
        queue: s.queue.filter((p) => p.id !== id),
      });
      try {
        await this.steer(sessionId, item.blocks);
      } catch (e) {
        // put it back at the head so the UI still shows the send-now action
        const rest = this.sessions.get(sessionId)?.queue ?? [];
        this.emitEvent(sessionId, { type: 'queueChanged', queue: [item, ...rest] });
        throw e;
      }
      return;
    }
    this.emitEvent(sessionId, {
      type: 'queueChanged',
      queue: [item, ...s.queue.filter((p) => p.id !== id)],
    });
    if (this.active.has(sessionId)) {
      if (this.interrupting.has(sessionId)) return;
      this.interrupting.add(sessionId);
      try {
        await this.cancel(sessionId);
        // wait for the cancelled turn to unwind — prompt's finally clears `active`
        for (let i = 0; i < 100 && this.active.has(sessionId); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } finally {
        this.interrupting.delete(sessionId);
        this.startNext(sessionId);
      }
    } else this.startNext(sessionId);
  }

  private startNext(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (
      !s ||
      s.loading ||
      this.active.has(sessionId) ||
      this.interrupting.has(sessionId) ||
      this.agent.status.phase !== 'ready'
    )
      return;
    const [next, ...rest] = s.queue;
    if (!next) return;
    this.emitEvent(sessionId, { type: 'queueChanged', queue: rest });
    void this.prompt(sessionId, next.blocks).catch((e) => {
      this.log.warn(`queued prompt: ${(e as Error).message}`);
    });
  }

  /** Inject a message into the running turn (steering). Renders the user echo
   *  locally like prompt() but does not take `active` or flip the turn phase —
   *  the owning turn emits turnEnded when the merged turn finishes. */
  private async steer(sessionId: string, blocks: CB[]): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.loading) throw new Error('session is not open');
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (text) this.echoExpect.set(sessionId, { text, buf: '' });
    for (const b of blocks) this.emitEvent(sessionId, { type: 'userChunk', block: b });
    try {
      await this.agent.prompt(sessionId, blocks as ContentBlock[]);
    } catch (e) {
      this.emitEvent(sessionId, { type: 'error', message: (e as Error).message });
      throw e;
    } finally {
      this.echoExpect.delete(sessionId);
    }
  }

  async prompt(sessionId: string, blocks: CB[]): Promise<{ stopReason: string }> {
    if (!this.sessions.has(sessionId) || this.active.has(sessionId))
      throw new Error('session is not open or already working');
    this.active.add(sessionId);
    this.emitEvent(sessionId, { type: 'turnStarted' });
    // local echo; agent's user_message_chunk echo is suppressed in handleNotification
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (text) this.echoExpect.set(sessionId, { text, buf: '' });
    for (const b of blocks) this.emitEvent(sessionId, { type: 'userChunk', block: b });
    let success = false;
    let stopReason: string | undefined;
    try {
      const res = await this.agent.prompt(sessionId, blocks as ContentBlock[]);
      success = true;
      stopReason = res.stopReason;
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
    } finally {
      this.echoExpect.delete(sessionId);
      this.active.delete(sessionId);
      // a cancelled turn (Stop) must not drain the queue — the user resumes
      // via "Enviar ahora"
      if (success && stopReason !== 'cancelled') this.startNext(sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.agent.cancel(sessionId);
    for (const [id, p] of this.permissions) {
      if (p.sessionId !== sessionId) continue;
      this.permissions.delete(id);
      p.resolve({ outcome: { outcome: 'cancelled' } });
      this.emitEvent(sessionId, { type: 'permissionResolved', requestId: id });
    }
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
    const rule = meta?.['cognition.ai/permissionRule'];
    const reason = meta?.['cognition.ai/permissionReason'];
    const request: PermissionRequest = {
      requestId,
      toolCallId: req.toolCall.toolCallId,
      title: req.toolCall.title ?? '',
      toolKind: (req.toolCall.kind as string | undefined) ?? 'other',
      options: req.options as PermissionOption[],
      editableCommand: typeof editable === 'string' ? editable : undefined,
      permissionRule: typeof rule === 'string' ? rule : undefined,
      permissionReason: typeof reason === 'string' ? reason : undefined,
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
