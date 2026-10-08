/**
 * Fake Devin ACP agent for testing devin-pocket without real Devin.
 * Ported with attribution from devin-tui test/fake-agent.ts (MIT, Mark Fenner).
 *
 * FAKE_AGENT_AUTHED=1 skips the auth gate (session/new works immediately).
 * Otherwise: session/new|list|load reject with "not authenticated" until
 * authenticate() is called.
 */
import { Readable, Writable } from 'node:stream';
import {
  type Agent,
  AgentSideConnection,
  ndJsonStream,
  RequestError,
  type SessionConfigOption,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let authenticated = process.env.FAKE_AGENT_AUTHED === '1';
let sessionId = '';
let cancelled = false;
let promptCount = 0;
let conn: AgentSideConnection;

function update(u: SessionUpdate): Promise<void> {
  if (!sessionId) return Promise.resolve();
  return conn.sessionUpdate({ sessionId, update: u });
}

function text(t: string) {
  return { type: 'text' as const, text: t };
}

async function extLog(message: string): Promise<void> {
  try {
    await conn.extNotification('_cognition.ai/output', {
      channel: 'mcp',
      message,
      level: 'info',
      sessionId,
    });
  } catch {
    // notifications are best-effort
  }
}

const MODES = [
  { id: 'normal', name: 'Normal' },
  { id: 'plan', name: 'Plan' },
  { id: 'accept-edits', name: 'Accept Edits' },
  { id: 'bypass', name: 'Bypass Permissions' },
];

const AVAILABLE_COMMANDS = [
  {
    name: 'btw',
    description: 'ask a side question',
    input: { hint: '[question]' },
    _meta: { 'cognition.ai/category': 'Session' },
  },
  {
    name: 'plan',
    description: 'create an execution plan',
    input: { hint: '[prompt]' },
    _meta: { 'cognition.ai/category': 'Session' },
  },
  {
    name: 'ask',
    description: 'ask a question without editing',
    _meta: { 'cognition.ai/category': 'Session' },
  },
  {
    name: 'compact',
    description: 'compact the conversation context',
    _meta: { 'cognition.ai/category': 'Session' },
  },
  {
    name: 'help',
    description: 'Show available commands',
    _meta: { 'cognition.ai/category': 'System' },
  },
  {
    name: 'bug',
    description: 'report an issue with Devin',
    _meta: { 'cognition.ai/category': 'System' },
  },
  { name: 'recap', description: 'summarize this session' },
];

let currentModel = 'swe-2';
let currentEffort = 'max';
let currentMode = 'normal';

const EFFORT_BY_MODEL: Record<string, { value: string; name: string }[]> = {
  'gpt-6-sol': [
    { value: 'low', name: 'Low' },
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
    { value: 'max', name: 'Max' },
  ],
  'swe-2': [
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
    { value: 'max', name: 'Max' },
  ],
  'opus-5': [
    { value: 'low', name: 'Low' },
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
    { value: 'xhigh', name: 'XHigh' },
    { value: 'max', name: 'Max' },
  ],
  'gemini-4': [],
};

const MODEL_LABELS: Record<string, Record<string, string>> = {
  'gpt-6-sol': {
    low: 'GPT-6 Sol Low Thinking',
    medium: 'GPT-6 Sol Medium Thinking',
    high: 'GPT-6 Sol High Thinking',
    max: 'GPT-6 Sol Max Thinking',
  },
  'swe-2': { medium: 'SWE-2 Medium', high: 'SWE-2 High', max: 'SWE-2 Max' },
  'opus-5': {
    low: 'Claude Opus 5 Low',
    medium: 'Claude Opus 5 Medium',
    high: 'Claude Opus 5 High',
    xhigh: 'Claude Opus 5 XHigh',
    max: 'Claude Opus 5 Max',
  },
  'gemini-4': { '': 'Gemini 4' },
};

const FUSION_OPTS = [
  {
    value: 'fusion-claude-opus-5-5-high-sidekick-swe-2-medium',
    name: 'Fusion (Claude Opus 5.5 High + SWE-2 Medium)',
  },
  {
    value: 'fusion-claude-opus-5-5-high-sidekick-swe-2-high',
    name: 'Fusion (Claude Opus 5.5 High + SWE-2 High)',
  },
];

function modelLabel(): string {
  const per = MODEL_LABELS[currentModel];
  if (per) return per[currentEffort] ?? Object.values(per)[0] ?? currentModel;
  return currentModel;
}

/** `_cognition.ai/turn_stats` — real Devin shape, once per turn. */
async function emitTurnStats(turnIndex: number): Promise<void> {
  if (!sessionId || !conn) return;
  const rid = `fake-${Date.now().toString(36)}-${turnIndex}-${Math.random().toString(36).slice(2, 8)}`;
  const cm = (value: number, tail: string, pluralTail: string) => ({
    type: 'cumulativeMetric',
    value,
    prefix: '',
    tail,
    pluralTail,
  });
  const dims: object[] = [
    {
      uid: 'agent_messages',
      groupTitle: 'Response Statistics',
      label: 'Agent messages',
      kind: cm(turnIndex + 1, ' message', ' messages'),
    },
    {
      uid: 'model',
      groupTitle: 'Response Statistics',
      label: 'Model',
      kind: { type: 'metric', value: modelLabel() },
    },
    {
      uid: 'input_tokens',
      groupTitle: 'Token Usage',
      label: 'Input tokens',
      kind: cm(12000 + turnIndex * 900, ' token', ' tokens'),
    },
    {
      uid: 'output_tokens',
      groupTitle: 'Token Usage',
      label: 'Output tokens',
      kind: cm(400 + turnIndex * 120, ' token', ' tokens'),
    },
    {
      uid: 'cached_input_tokens',
      groupTitle: 'Token Usage',
      label: 'Cached input tokens',
      kind: cm(9000 + turnIndex * 1500, ' token', ' tokens'),
    },
  ];
  try {
    await conn.extNotification('_cognition.ai/turn_stats', {
      sessionId,
      turnClientMessageId: `fake-cm-${rid}`,
      turnRequestId: rid,
      responseDimensions: dims,
    });
  } catch {
    // notifications are best-effort
  }
}

function effortOptions(model: string) {
  return (
    EFFORT_BY_MODEL[model] ?? [
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' },
      { value: 'max', name: 'Max' },
    ]
  );
}

function buildConfig(): SessionConfigOption[] {
  const efforts = effortOptions(currentModel);
  if (!efforts.some((e) => e.value === currentEffort)) currentEffort = 'high';
  return [
    {
      id: 'mode',
      name: 'Mode',
      type: 'select',
      category: 'mode',
      currentValue: currentMode,
      options: MODES.map((m) => ({ value: m.id, name: m.name })),
    },
    {
      id: 'model',
      name: 'Model',
      type: 'select',
      category: 'model',
      currentValue: currentModel,
      options: [
        {
          group: 'devin',
          name: 'Devin',
          options: [
            { value: 'gpt-6-sol', name: 'GPT-6 Sol' },
            { value: 'swe-2', name: 'SWE-2' },
            { value: 'swe-1-6', name: 'SWE-1.6' },
            { value: 'swe-1-6-fast', name: 'SWE-1.6 Fast' },
          ],
        },
        {
          group: 'other',
          name: 'Other models',
          options: [
            { value: 'opus-5', name: 'Claude Opus 5' },
            { value: 'gemini-4', name: 'Gemini 4' },
          ],
        },
        { group: 'fusion', name: 'Fusion', options: FUSION_OPTS },
      ],
    },
    ...(efforts.length > 0
      ? [
          {
            id: 'thought_level',
            name: 'Reasoning effort',
            type: 'select',
            category: 'thought_level',
            currentValue: currentEffort,
            options: efforts,
          } satisfies SessionConfigOption,
        ]
      : []),
  ];
}

const AGENT_CWD = process.cwd();

/** Devin's execute shape: preview resource + editableCommand permission meta. */
const previewResource = (command: string) => ({
  type: 'content' as const,
  content: {
    type: 'resource' as const,
    resource: { mimeType: 'text/x-shellscript', text: command, uri: 'tool://preview' },
    _meta: { 'cognition.ai/preview_is_shell_command': true },
  },
});

const FAST = process.env.FAKE_AGENT_FAST === '1';
const stepMs = (ms: number) => (FAST ? Math.min(ms, 30) : ms);

async function runMainTurn(): Promise<'end_turn' | 'cancelled'> {
  const step = async (fn: () => Promise<unknown>, ms = stepMs(120)) => {
    if (cancelled) return false;
    await fn();
    await sleep(ms);
    return !cancelled;
  };
  const usage = (used: number) => update({ sessionUpdate: 'usage_update', used, size: 262000 });

  if (
    !(await step(() =>
      update({
        sessionUpdate: 'agent_thought_chunk',
        content: text('Let me look at this workspace.\n'),
      }),
    ))
  )
    return 'cancelled';
  if (
    !(await step(() =>
      update({
        sessionUpdate: 'plan',
        entries: [
          { content: 'List the project files', status: 'in_progress', priority: 'high' },
          { content: 'Apply the requested edit', status: 'pending', priority: 'high' },
        ],
      }),
    ))
  )
    return 'cancelled';
  if (
    !(await step(() =>
      update({ sessionUpdate: 'available_commands_update', availableCommands: AVAILABLE_COMMANDS }),
    ))
  )
    return 'cancelled';
  if (!(await step(() => update({ sessionUpdate: 'session_info_update', title: 'Fake Session' }))))
    return 'cancelled';
  if (!(await step(() => extLog('mcp server "devin" connected')))) return 'cancelled';
  if (
    !(await step(
      () => update({ sessionUpdate: 'agent_message_chunk', content: text("I'll take a look.\n") }),
      stepMs(200),
    ))
  )
    return 'cancelled';

  // execute tool call → permission request (editableCommand) → output →
  // terminal_exit → bare completed update
  if (
    !(await step(() =>
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-ls#1',
        title: 'Listed ./src',
        kind: 'execute',
        status: 'pending',
        content: [previewResource('ls ./src')],
        rawInput: { command: 'ls ./src' },
        _meta: { 'cognition.ai/commandNames': ['ls'], 'cognition.ai/inferenceToolName': 'exec' },
      } as never),
    ))
  )
    return 'cancelled';
  if (
    !(await step(
      () =>
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-ls#1',
          status: 'in_progress',
          _meta: { 'cognition.ai/cwd': AGENT_CWD },
        } as never),
      stepMs(200),
    ))
  )
    return 'cancelled';
  const outcome = await conn.requestPermission({
    sessionId,
    toolCall: {
      toolCallId: 'tc-ls#1',
      _meta: { 'cognition.ai/editableCommand': 'ls ./src' },
    } as never,
    options: [
      { optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' },
      {
        optionId: 'opt-allow-session',
        name: 'Yes, allow `ls` commands (this session)',
        kind: 'allow_always',
      },
      { optionId: 'opt-bypass', name: 'Yes, switch to bypass mode', kind: 'allow_always' },
      { optionId: 'opt-reject', name: 'Reject', kind: 'reject_once' },
    ],
  });
  if (cancelled || outcome.outcome.outcome === 'cancelled') {
    await update({ sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'failed' });
    return 'cancelled';
  }
  const allowed =
    outcome.outcome.outcome === 'selected' && outcome.outcome.optionId !== 'opt-reject';
  if (!allowed) {
    await update({ sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'failed' });
    return 'end_turn';
  }
  const lsOut = 'acp\nstate\nui';
  if (
    !(await step(() =>
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-ls#1',
        status: 'in_progress',
        content: [{ type: 'content', content: text(lsOut) }],
        _meta: { 'cognition.ai/terminalPreview': true },
      } as never),
    ))
  )
    return 'cancelled';
  if (
    !(await step(() =>
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-ls#1',
        status: 'in_progress',
        content: [{ type: 'content', content: text(lsOut) }],
        _meta: { terminal_exit: { terminal_id: 'fake-term-1', exit_code: 0, signal: null } },
      } as never),
    ))
  )
    return 'cancelled';
  if (
    !(await step(() =>
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'completed' }),
    ))
  )
    return 'cancelled';
  if (!(await step(() => usage(13127)))) return 'cancelled';

  // edit tool call with a diff
  if (
    !(await step(
      () =>
        update({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-edit#1',
          title: 'Edit src/index.ts',
          kind: 'edit',
          status: 'in_progress',
          locations: [{ path: `${AGENT_CWD}/src/index.ts` }],
        }),
      stepMs(200),
    ))
  )
    return 'cancelled';
  if (
    !(await step(() =>
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-edit#1',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: `${AGENT_CWD}/src/index.ts`,
            oldText: 'const a = 1;',
            newText: 'const a = 2;',
          },
        ],
      }),
    ))
  )
    return 'cancelled';
  if (!(await step(() => usage(16904)))) return 'cancelled';

  // read tool call
  if (
    !(await step(
      () =>
        update({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-read#1',
          title: 'Read file',
          kind: 'read',
          status: 'in_progress',
          locations: [{ path: `${AGENT_CWD}/package.json` }],
          rawInput: { file_path: `${AGENT_CWD}/package.json` },
        }),
      stepMs(200),
    ))
  )
    return 'cancelled';
  if (
    !(await step(() =>
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-read#1',
        status: 'completed',
        content: [{ type: 'content', content: text('22 lines') }],
      }),
    ))
  )
    return 'cancelled';
  if (!(await step(() => usage(18441)))) return 'cancelled';

  await step(() =>
    update({
      sessionUpdate: 'plan',
      entries: [
        { content: 'List the project files', status: 'completed', priority: 'high' },
        { content: 'Apply the requested edit', status: 'completed', priority: 'high' },
      ],
    }),
  );
  await step(
    () =>
      update({
        sessionUpdate: 'agent_message_chunk',
        content: text('\nDone — ./src has 3 entries.'),
      }),
    0,
  );
  return cancelled ? 'cancelled' : 'end_turn';
}

async function runSlowTurn(): Promise<'end_turn' | 'cancelled'> {
  await update({
    sessionUpdate: 'agent_thought_chunk',
    content: text('Streaming a slow reply — press esc to cancel.'),
  });
  for (let i = 1; i <= 40; i++) {
    if (cancelled) return 'cancelled';
    await update({
      sessionUpdate: 'agent_message_chunk',
      content: text(`line ${i} of a slow stream. `),
    });
    await sleep(FAST ? 20 : 250);
  }
  return 'end_turn';
}

// sessions created via session/new are remembered so listSessions can return them
const created: { sessionId: string; cwd: string; title: string | null; updatedAt: string }[] = [];

const FAKE_SESSIONS = () => [
  ...created,
  {
    sessionId: 'fake-session-newest',
    cwd: AGENT_CWD,
    title: 'Weather lookup',
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    _meta: { 'cognition.ai/isLocked': true, 'cognition.ai/lockHolderPid': 4242 },
  },
  {
    sessionId: 'fake-session-middle',
    cwd: AGENT_CWD,
    title: 'Fix the flaky test',
    updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    sessionId: 'fake-session-oldest',
    cwd: AGENT_CWD,
    title: null,
    updatedAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
  },
];

const NOT_AUTHENTICATED = () =>
  new RequestError(
    -32000,
    'ACP host has not authenticated. Call the `authenticate` ACP method (or invoke the browser auth method to start the PKCE browser flow)',
  );

const agent: Agent = {
  async initialize() {
    // pushes account quota like the real agent's billingInformation notification
    setTimeout(
      () =>
        void conn
          ?.extNotification('_cognition.ai/billingInformation', {
            billingInformation: {
              plan_info: {
                plan_name: 'Max',
                account_display_name: 'Fake Dev',
                daily_quota_remaining_percent: 82,
                weekly_quota_remaining_percent: 47,
                daily_quota_reset_at_unix: 1791676800,
                weekly_quota_reset_at_unix: 1792022400,
                acu_consumed: 12.4,
                acu_limit: 100,
                available_prompt_credits: 250,
                used_prompt_credits: 50,
              },
            },
          })
          .catch(() => {}),
      60,
    );
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { list: {}, delete: {} },
        logout: {},
        _meta: {
          'cognition.ai/sessionListOrderBy': ['updated_at', 'created_at'],
        },
      },
      authMethods: authenticated
        ? []
        : [
            {
              id: 'devin-browser',
              name: 'Log in with browser',
              description: 'opens a browser window to authenticate',
            },
          ],
      agentInfo: { name: 'fake-devin', title: 'Devin Agent', version: '0.0.1' },
    };
  },
  async newSession(params) {
    if (!authenticated) throw NOT_AUTHENTICATED();
    sessionId = `fake-${Math.random().toString(36).slice(2, 10)}`;
    created.push({
      sessionId,
      cwd: params?.cwd ?? AGENT_CWD,
      title: null,
      updatedAt: new Date().toISOString(),
    });
    promptCount = 0;
    setTimeout(() => void extLog('mcp servers changed: 1 connected'), 50);
    setTimeout(
      () =>
        void update({
          sessionUpdate: 'available_commands_update',
          availableCommands: AVAILABLE_COMMANDS,
        }),
      40,
    );
    return {
      sessionId,
      modes: { currentModeId: 'normal', availableModes: MODES },
      configOptions: buildConfig(),
    };
  },
  async authenticate() {
    await sleep(FAST ? 50 : 1000);
    authenticated = true;
    return {};
  },
  async listSessions(params) {
    if (!authenticated) throw NOT_AUTHENTICATED();
    const all = FAKE_SESSIONS();
    // no cwd → global list; with cwd → only sessions in that directory
    const sessions = params?.cwd ? all.filter((s) => s.cwd === params.cwd) : all;
    process.stderr.write(
      `fake-agent: list_sessions cwd=${params?.cwd ?? '(all)'} → ${sessions.length} sessions\n`,
    );
    return { sessions };
  },
  async loadSession(params) {
    if (!authenticated) throw NOT_AUTHENTICATED();
    sessionId = params.sessionId;
    promptCount = 0;
    process.stderr.write(`fake-agent: load_session ${params.sessionId}\n`);
    const replay = async (u: SessionUpdate, ms = stepMs(40)) => {
      await update(u);
      await sleep(ms);
    };
    await replay({ sessionUpdate: 'user_message_chunk', content: text('summarize the ') });
    await replay({ sessionUpdate: 'user_message_chunk', content: text('workspace') });
    await replay({
      sessionUpdate: 'agent_thought_chunk',
      content: text('Let me look at the files first.'),
    });
    await replay({
      sessionUpdate: 'agent_message_chunk',
      content: text('I listed ./src and skimmed package.json.'),
    });
    await replay({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-old#1',
      title: 'Listed ./src',
      kind: 'execute',
      status: 'in_progress',
      content: [previewResource('ls ./src')],
      rawInput: { command: 'ls ./src' },
    } as never);
    await replay({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-old#1',
      status: 'in_progress',
      content: [{ type: 'content', content: text('acp\nstate\nui') }],
      _meta: { terminal_exit: { terminal_id: 'fake-term-0', exit_code: 0, signal: null } },
    } as never);
    await replay({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-old#1',
      status: 'completed',
    });
    await replay({
      sessionUpdate: 'agent_message_chunk',
      content: text('Done — ./src has 3 entries.'),
    });
    await emitTurnStats(0);
    await replay({
      sessionUpdate: 'user_message_chunk',
      content: text('thanks — and package.json?'),
    });
    await replay({
      sessionUpdate: 'agent_message_chunk',
      content: text('package.json is 22 lines.'),
    });
    await emitTurnStats(1);
    await replay({ sessionUpdate: 'session_info_update', title: 'Workspace Overview' });
    // FAKE_AGENT_REPLAY_ITEMS=N appends N extra tool calls to simulate a long history.
    const extra = Number(process.env.FAKE_AGENT_REPLAY_ITEMS ?? '0');
    for (let i = 1; i <= extra; i++) {
      await replay(
        {
          sessionUpdate: 'tool_call',
          toolCallId: `tc-fill#${i}`,
          title: `Filler call ${i}`,
          kind: 'read',
          status: 'completed',
        } as never,
        2,
      );
    }
    await replay({
      sessionUpdate: 'available_commands_update',
      availableCommands: AVAILABLE_COMMANDS,
    });
    await replay({ sessionUpdate: 'usage_update', used: 18441, size: 262000 });
    return {
      modes: { currentModeId: 'normal', availableModes: MODES },
      configOptions: buildConfig(),
    };
  },
  async deleteSession(params) {
    process.stderr.write(`fake-agent: delete_session ${params.sessionId}\n`);
    const i = created.findIndex((s) => s.sessionId === params.sessionId);
    if (i >= 0) created.splice(i, 1);
    return {};
  },
  async setSessionMode(params) {
    currentMode = params.modeId;
    setTimeout(
      () => void update({ sessionUpdate: 'current_mode_update', currentModeId: params.modeId }),
      20,
    );
    return {};
  },
  async setSessionConfigOption(params) {
    const v = String(params.value);
    process.stderr.write(`fake-agent: set_config_option ${params.configId}=${v}\n`);
    if (params.configId === 'model') currentModel = v;
    else if (params.configId === 'thought_level') currentEffort = v;
    else if (params.configId === 'mode') currentMode = v;
    const configOptions = buildConfig();
    setTimeout(() => void update({ sessionUpdate: 'config_option_update', configOptions }), 20);
    return { configOptions };
  },
  async logout() {
    process.stderr.write('fake-agent: logout\n');
    authenticated = false;
    sessionId = '';
    return {};
  },
  async prompt(params) {
    if (!authenticated) throw NOT_AUTHENTICATED();
    const ptext = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (ptext.startsWith('/btw ')) {
      const sideMeta = { 'cognition.ai/channel': 'btw' };
      await update({ sessionUpdate: 'user_message_chunk', content: text(ptext), _meta: sideMeta });
      await update({
        sessionUpdate: 'agent_message_chunk',
        content: text(`Side answer: ${ptext.slice(5)}`),
        _meta: sideMeta,
      });
      return { stopReason: 'end_turn' };
    }
    promptCount++;
    process.stderr.write(`fake-agent: prompt #${promptCount}: ${ptext.slice(0, 80)}\n`);
    void update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: ptext } });
    cancelled = false;
    if (ptext === 'QUEUE_SHORT') {
      await sleep(FAST ? 400 : 1500);
      return { stopReason: 'end_turn' };
    }
    if (ptext === 'QUEUE_HOLD') {
      await update({
        sessionUpdate: 'agent_message_chunk',
        content: text('Working on queued task'),
      });
      for (let i = 0; i < 100 && !cancelled; i++) await sleep(FAST ? 40 : 100);
      return { stopReason: cancelled ? 'cancelled' : 'end_turn' };
    }
    if (ptext.startsWith('QUEUE_RESULT_')) {
      await update({ sessionUpdate: 'agent_message_chunk', content: text(`Completed ${ptext}`) });
      return { stopReason: 'end_turn' };
    }
    if (ptext === 'MARKDOWN_FIXTURE') {
      await update({
        sessionUpdate: 'agent_message_chunk',
        content: text(
          '# Título\n\n- primer elemento\n- segundo elemento\n\n| Modelo | Precio |\n|---|---|\n| Rápido | $1 |\n\n```ts\nconst test = "<script>";\n```\n\nArchivo <ref_snippet file="/tmp/proyecto/src/index.ts" lines="10-12" /> y <ref_file file="/tmp/proyecto/README.md" />.\n\n[Web](https://example.com) <script>alert(1)</script>',
        ),
      });
      return { stopReason: 'end_turn' };
    }
    await sleep(FAST ? 100 : 1500);
    const stopReason = promptCount === 1 ? await runMainTurn() : await runSlowTurn();
    await emitTurnStats(promptCount - 1);
    return { stopReason };
  },
  async cancel() {
    cancelled = true;
  },
  extNotification() {},
};

conn = new AgentSideConnection(
  () => agent,
  ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  ),
);

process.stderr.write('fake-agent: listening\n');
await conn.closed;
