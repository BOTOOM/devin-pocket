import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '../src/shared/protocol.js';
import {
  groupWorkItems,
  segmentStart,
  spanSeconds,
  visibleSegments,
} from '../src/web/lib/work-groups.js';

const at = (n: number) => n * 1000;
const user = (n: number): TranscriptItem => ({
  kind: 'user',
  id: `u${n}`,
  blocks: [{ type: 'text', text: 'hi' }],
  at: at(n),
});
const agent = (n: number): TranscriptItem => ({
  kind: 'agent',
  id: `a${n}`,
  text: 'answer',
  streaming: false,
  at: at(n),
});
const thought = (n: number, streaming = false): TranscriptItem => ({
  kind: 'thought',
  id: `t${n}`,
  text: 'thinking',
  streaming,
  at: at(n),
});
const tool = (n: number): TranscriptItem => ({
  kind: 'tool',
  id: `tc${n}`,
  toolCallId: `tc${n}`,
  toolKind: 'execute',
  title: 'ls',
  status: 'completed',
  content: [],
  locations: [],
  at: at(n),
});
const system = (n: number): TranscriptItem => ({
  kind: 'system',
  id: `s${n}`,
  text: 'warn',
  level: 'warn',
  at: at(n),
});

describe('groupWorkItems', () => {
  it('wraps consecutive thought+tool runs, leaves agent/user/system flat', () => {
    const segs = groupWorkItems([
      user(1),
      thought(2),
      tool(3),
      tool(4),
      agent(5),
      thought(6),
      agent(7),
      system(8),
      tool(9),
    ]);
    expect(segs.map((s) => s.type)).toEqual([
      'item',
      'work',
      'item',
      'work',
      'item',
      'item',
      'work',
    ]);
    const g1 = segs[1];
    if (g1?.type !== 'work') throw new Error('expected work segment');
    expect(g1.items).toHaveLength(3);
    const g2 = segs[3];
    if (g2?.type !== 'work') throw new Error('expected work segment');
    expect(g2.items).toHaveLength(1);
  });

  it('returns empty for empty', () => {
    expect(groupWorkItems([])).toEqual([]);
  });

  it('segmentStart returns the first item timestamp', () => {
    const segs = groupWorkItems([agent(5), tool(9)]);
    expect(segmentStart(segs[0] ?? { type: 'item', item: agent(0) })).toBe(at(5));
    expect(segmentStart(segs[1] ?? { type: 'item', item: agent(0) })).toBe(at(9));
  });
});

describe('visibleSegments', () => {
  it('trims the boundary work run but keeps its full-history key', () => {
    const items = [thought(1), tool(2), tool(3), tool(4), agent(5)];
    const segs = visibleSegments(items, 3);
    expect(segs.map((s) => s.type)).toEqual(['work', 'item']);
    const g = segs[0];
    if (g?.type !== 'work') throw new Error('expected work segment');
    // only the last 2 work items fit the budget, but the key is the run's
    // first item in the full history — stable as more items load
    expect(g.items.map((i) => i.id)).toEqual(['tc3', 'tc4']);
    expect(g.key).toBe('t1');
  });

  it('keeps whole segments when they fit', () => {
    const items = [agent(1), thought(2), tool(3), agent(4)];
    const segs = visibleSegments(items, 4);
    expect(segs).toHaveLength(3);
    const g = segs[1];
    if (g?.type !== 'work') throw new Error('expected work segment');
    expect(g.key).toBe('t2');
    expect(g.items).toHaveLength(2);
  });

  it('matches groupWorkItems when nothing is hidden', () => {
    const items = [user(1), thought(2), agent(3)];
    expect(visibleSegments(items, 10)).toEqual(groupWorkItems(items));
  });
});

describe('spanSeconds', () => {
  it('rounds to whole seconds, minimum 1', () => {
    expect(spanSeconds(0, 12_345)).toBe(12);
    expect(spanSeconds(0, 400)).toBe(1);
  });
});
