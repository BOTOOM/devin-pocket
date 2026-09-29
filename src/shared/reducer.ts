import type { SessionEvent, SessionState, TranscriptItem } from './protocol.js';

let counter = 0;
const newId = (): string => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

export function initialSessionState(sessionId: string, cwd: string): SessionState {
  return {
    sessionId,
    cwd,
    turn: 'idle',
    queue: [],
    items: [],
    plan: [],
    commands: [],
    modes: [],
    configOptions: [],
    turnStats: [],
    loading: false,
    seq: 0,
  };
}

/** Pure, immutable at the top level; item arrays are copied on change. */
export function applyEvent(state: SessionState, ev: SessionEvent, now = Date.now()): SessionState {
  const s: SessionState = { ...state, seq: state.seq + 1 };
  switch (ev.type) {
    case 'userChunk': {
      const last = s.items.at(-1);
      if (last?.kind === 'user' && now - last.at < 2000) {
        const merged: TranscriptItem = { ...last, blocks: [...last.blocks, ev.block] };
        s.items = [...s.items.slice(0, -1), merged];
      } else {
        s.items = [...s.items, { kind: 'user', id: newId(), blocks: [ev.block], at: now }];
      }
      return s;
    }
    case 'agentChunk':
      return appendText(s, 'agent', ev.text, now);
    case 'thoughtChunk':
      return appendText(s, 'thought', ev.text, now);
    case 'toolCall': {
      s.items = finishStreaming(s.items);
      const idx = s.items.findIndex((i) => i.kind === 'tool' && i.toolCallId === ev.toolCallId);
      const item: TranscriptItem = {
        kind: 'tool',
        id: idx >= 0 ? (s.items[idx]?.id ?? newId()) : newId(),
        toolCallId: ev.toolCallId,
        toolKind: ev.toolKind,
        title: ev.title,
        status: ev.status,
        content: ev.content ?? [],
        locations: ev.locations ?? [],
        rawInput: ev.rawInput,
        rawOutput: ev.rawOutput,
        exitCode: ev.exitCode,
        cwd: ev.cwd,
        command: ev.command,
        at: now,
      };
      s.items = idx >= 0 ? s.items.with(idx, item) : [...s.items, item];
      return s;
    }
    case 'toolCallUpdate': {
      const idx = s.items.findIndex((i) => i.kind === 'tool' && i.toolCallId === ev.toolCallId);
      const prev = idx >= 0 ? s.items[idx] : undefined;
      if (prev?.kind !== 'tool') {
        // Update for a call we never saw (e.g. replay gap) — synthesize it.
        return applyEvent(
          state,
          {
            type: 'toolCall',
            toolCallId: ev.toolCallId,
            title: ev.title ?? 'Tool',
            toolKind: ev.toolKind ?? 'other',
            status: ev.status ?? 'in_progress',
            content: ev.content,
            locations: ev.locations,
            rawInput: ev.rawInput,
            rawOutput: ev.rawOutput,
            exitCode: ev.exitCode,
            command: ev.command,
          },
          now,
        );
      }
      const next: TranscriptItem = {
        ...prev,
        title: ev.title ?? prev.title,
        toolKind: ev.toolKind ?? prev.toolKind,
        status: ev.status ?? prev.status,
        content: ev.content ?? prev.content,
        locations: ev.locations ?? prev.locations,
        rawInput: ev.rawInput ?? prev.rawInput,
        rawOutput: ev.rawOutput ?? prev.rawOutput,
        exitCode: ev.exitCode ?? prev.exitCode,
        command: ev.command ?? prev.command,
      };
      s.items = s.items.with(idx, next);
      return s;
    }
    case 'plan':
      s.plan = ev.entries;
      return s;
    case 'commands':
      s.commands = ev.commands;
      return s;
    case 'mode':
      s.currentMode = ev.modeId;
      return s;
    case 'modes':
      s.modes = ev.modes;
      if (ev.currentMode !== undefined) s.currentMode = ev.currentMode;
      return s;
    case 'configOptions':
      s.configOptions = ev.options;
      return s;
    case 'usage':
      s.usage = ev.usage;
      return s;
    case 'turnStats':
      if (s.turnStats.some((t) => t.turnRequestId === ev.stat.turnRequestId)) return s;
      s.turnStats = [...s.turnStats, ev.stat];
      return s;
    case 'info':
      if (ev.title !== undefined) s.title = ev.title;
      return s;
    case 'queueChanged':
      s.queue = ev.queue;
      return s;
    case 'asideStarted':
      s.aside = { question: ev.question, answer: '', status: 'working' };
      return s;
    case 'asideChunk':
      if (s.aside) s.aside = { ...s.aside, answer: s.aside.answer + ev.text };
      return s;
    case 'asideEnded':
      if (s.aside) s.aside = { ...s.aside, status: ev.error ? 'error' : 'done', error: ev.error };
      return s;
    case 'turnStarted':
      s.turn = 'working';
      s.error = undefined;
      return s;
    case 'turnEnded':
      s.items = finishStreaming(s.items);
      s.turn = 'idle';
      s.permission = undefined;
      return s;
    case 'permissionRequested':
      s.permission = ev.request;
      s.turn = 'awaitingPermission';
      return s;
    case 'permissionResolved':
      if (s.permission?.requestId === ev.requestId) s.permission = undefined;
      if (s.turn === 'awaitingPermission') s.turn = 'working';
      return s;
    case 'loading':
      s.loading = ev.loading;
      if (ev.loading) {
        s.items = [];
        s.plan = [];
        s.turnStats = [];
      } else {
        s.items = finishStreaming(s.items);
      }
      return s;
    case 'system':
      s.items = [
        ...s.items,
        { kind: 'system', id: newId(), text: ev.text, level: ev.level, at: now },
      ];
      return s;
    case 'error':
      s.error = ev.message;
      s.turn = 'idle';
      s.items = finishStreaming(s.items);
      return s;
    default:
      return s;
  }
}

function appendText(
  s: SessionState,
  kind: 'agent' | 'thought',
  text: string,
  now: number,
): SessionState {
  const last = s.items.at(-1);
  if (last && last.kind === kind && last.streaming) {
    s.items = [...s.items.slice(0, -1), { ...last, text: last.text + text }];
  } else {
    s.items = [
      ...finishStreaming(s.items),
      { kind, id: newId(), text, streaming: true, at: now } as TranscriptItem,
    ];
  }
  return s;
}

function finishStreaming(items: TranscriptItem[]): TranscriptItem[] {
  const last = items.at(-1);
  if (last && (last.kind === 'agent' || last.kind === 'thought') && last.streaming) {
    return [...items.slice(0, -1), { ...last, streaming: false }];
  }
  return items;
}

// ---------------------------------------------------------------------------
// Derived helpers shared by server (doctor/report) and UI
// ---------------------------------------------------------------------------

/** Model + reasoning config options from ACP (`category: 'model'`, id `thought_level`). */
export function pickModelOptions(state: SessionState) {
  const model = state.configOptions.find((o) => o.category === 'model' || o.id === 'model');
  const reasoning = state.configOptions.find(
    (o) =>
      o.id === 'thought_level' || o.category === 'thought_level' || /reason|thought/i.test(o.id),
  );
  const mode = state.configOptions.find((o) => o.id === 'mode' || o.category === 'mode');
  return { model, reasoning, mode };
}

export function sumTurnStats(stats: readonly { input: number; cached: number; output: number }[]) {
  return stats.reduce(
    (acc, t) => ({
      input: acc.input + t.input,
      cached: acc.cached + t.cached,
      output: acc.output + t.output,
    }),
    { input: 0, cached: 0, output: 0 },
  );
}
