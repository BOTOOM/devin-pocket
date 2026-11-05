import type {
  ContentBlock,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
} from '@agentclientprotocol/sdk';
import type { Command, SessionEvent } from '../../shared/protocol.js';

/** Devin-specific fields in tool_call/tool_call_update `_meta`:
 *  terminal_exit.exit_code, cognition.ai/cwd, cognition.ai/editableCommand. */
function toolMeta(u: { _meta?: unknown }): {
  exitCode?: number;
  cwd?: string;
  editableCommand?: string;
} {
  const m = u._meta as Record<string, unknown> | undefined;
  if (!m) return {};
  const te = m.terminal_exit as { exit_code?: unknown } | undefined;
  const cwd = m['cognition.ai/cwd'];
  const cmd = m['cognition.ai/editableCommand'];
  return {
    exitCode: typeof te?.exit_code === 'number' ? te.exit_code : undefined,
    cwd: typeof cwd === 'string' ? cwd : undefined,
    editableCommand: typeof cmd === 'string' ? cmd : undefined,
  };
}

function commandOf(rawInput: unknown, editable?: string): string | undefined {
  if (editable) return editable;
  const cmd = (rawInput as { command?: unknown } | undefined)?.command;
  return typeof cmd === 'string' ? cmd : undefined;
}

/** _meta["cognition.ai/timestamp"] (CLI ≥3000.11.92) → epoch ms for item.at. */
function metaAt(u: { _meta?: unknown }): number | undefined {
  const t = (u._meta as Record<string, unknown> | undefined)?.['cognition.ai/timestamp'];
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

/** Map one ACP SessionUpdate to zero+ SessionEvents. Unknown variants → []. */
export function normalizeUpdate(update: SessionUpdate): SessionEvent[] {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return [{ type: 'userChunk', block: update.content }];
    case 'agent_message_chunk': {
      const b: ContentBlock = update.content;
      if (b.type === 'text') return [{ type: 'agentChunk', text: b.text, at: metaAt(update) }];
      return [
        {
          type: 'system',
          text: `agent sent ${b.type} content (not rendered)`,
          level: 'info',
        },
      ];
    }
    case 'agent_thought_chunk': {
      const b = update.content;
      if (b.type === 'text') return [{ type: 'thoughtChunk', text: b.text, at: metaAt(update) }];
      return [];
    }
    case 'tool_call': {
      const meta = toolMeta(update);
      return [
        {
          type: 'toolCall',
          toolCallId: update.toolCallId,
          title: update.title ?? '',
          toolKind: update.kind ?? 'other',
          status: update.status ?? 'pending',
          content: update.content as ToolCallContent[] | undefined,
          locations: update.locations as ToolCallLocation[] | undefined,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
          exitCode: meta.exitCode,
          cwd: meta.cwd,
          command: commandOf(update.rawInput, meta.editableCommand),
        },
      ];
    }
    case 'tool_call_update': {
      const meta = toolMeta(update);
      return [
        {
          type: 'toolCallUpdate',
          toolCallId: update.toolCallId,
          title: update.title ?? undefined,
          toolKind: update.kind ?? undefined,
          status: update.status ?? undefined,
          content: update.content as ToolCallContent[] | undefined,
          locations: update.locations as ToolCallLocation[] | undefined,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
          exitCode: meta.exitCode,
          command: commandOf(update.rawInput, meta.editableCommand),
        },
      ];
    }
    case 'plan':
      return [
        {
          type: 'plan',
          entries: update.entries.map((e) => ({
            content: e.content,
            status: e.status,
            priority: e.priority,
          })),
        },
      ];
    case 'available_commands_update':
      return [
        {
          type: 'commands',
          commands: update.availableCommands.map((c): Command => {
            const cat = c._meta?.['cognition.ai/category'];
            return {
              name: c.name,
              description: c.description ?? '',
              hint: c.input?.hint ?? undefined,
              category: typeof cat === 'string' ? cat : undefined,
            };
          }),
        },
      ];
    case 'current_mode_update':
      return [{ type: 'mode', modeId: update.currentModeId }];
    case 'config_option_update':
      return [{ type: 'configOptions', options: update.configOptions }];
    case 'usage_update':
      return [
        {
          type: 'usage',
          usage: {
            used: update.used,
            size: update.size,
            cost: update.cost
              ? { amount: update.cost.amount, currency: update.cost.currency }
              : undefined,
          },
        },
      ];
    case 'session_info_update':
      return [{ type: 'info', title: update.title ?? undefined }];
    default:
      return [];
  }
}
