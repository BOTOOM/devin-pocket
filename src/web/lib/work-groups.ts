import type { TranscriptItem } from '../../shared/protocol.js';

/** A flat render unit: a single item, or a run of work items in one collapsible. */
export type TranscriptSegment =
  | { type: 'item'; item: TranscriptItem }
  | { type: 'work'; items: TranscriptItem[] };

/** Items the desktop UI nests under the "Working" section — never user-facing text. */
const WORK_KINDS = new Set<TranscriptItem['kind']>(['thought', 'tool']);

/**
 * Consecutive thought/tool runs collapse into a "Working" group, like Devin's
 * desktop chat: agent answers stay flat, everything else nests under the group.
 * System lines (warnings/errors) stay outside — they're for the user.
 */
export function groupWorkItems(items: TranscriptItem[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (WORK_KINDS.has(item.kind)) {
      if (last?.type === 'work') last.items.push(item);
      else out.push({ type: 'work', items: [item] });
    } else {
      out.push({ type: 'item', item });
    }
  }
  return out;
}

/** Timestamp of the first item in a segment — marks when the previous group ended. */
export function segmentStart(seg: TranscriptSegment): number {
  return seg.type === 'item' ? seg.item.at : (seg.items[0]?.at ?? 0);
}

/** Whole seconds a span covered; a finished span shows at least 1s. */
export function spanSeconds(startAt: number, endAt: number): number {
  return Math.max(1, Math.round((endAt - startAt) / 1000));
}
