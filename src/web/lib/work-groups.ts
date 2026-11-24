import type { TranscriptItem } from '../../shared/protocol.js';

/** A flat render unit: a single item, or a run of work items in one collapsible.
 *  `key` on work segments is the id of the run's first item in the FULL history
 *  — stable across pagination trims and streaming appends, so React never
 *  remounts a group the user is reading. */
export type TranscriptSegment =
  | { type: 'item'; item: TranscriptItem }
  | { type: 'work'; key: string; items: TranscriptItem[] };

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
      else out.push({ type: 'work', key: item.id, items: [item] });
    } else {
      out.push({ type: 'item', item });
    }
  }
  return out;
}

/**
 * Segments covering only the last `limit` items of a history. Grouping starts
 * at the window start — except when the window opens inside a work run, where
 * it walks back to that run's first item so the boundary group keeps its
 * full-history `key`; groups entirely inside the window never merge backwards.
 */
export function visibleSegments(items: TranscriptItem[], limit: number): TranscriptSegment[] {
  const start = Math.max(0, items.length - limit);
  let runStart = start;
  const boundary = items[start];
  if (start > 0 && boundary && WORK_KINDS.has(boundary.kind)) {
    while (runStart > 0) {
      const prev = items[runStart - 1];
      if (!prev || !WORK_KINDS.has(prev.kind)) break;
      runStart--;
    }
  }
  const all = groupWorkItems(items.slice(runStart));
  const out: TranscriptSegment[] = [];
  let budget = limit;
  for (let i = all.length - 1; i >= 0 && budget > 0; i--) {
    const seg = all[i];
    if (!seg) break;
    if (seg.type === 'item') {
      out.unshift(seg);
      budget -= 1;
      continue;
    }
    if (seg.items.length <= budget) {
      out.unshift(seg);
      budget -= seg.items.length;
    } else {
      out.unshift({ ...seg, items: seg.items.slice(-budget) });
      budget = 0;
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
